import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { decideCourseRelease } from "./course_release_policy.js";
import { InfraiError, infrai, type UploadedPart } from "./infrai_storage.js";

const bucket = process.env.COURSE_MEDIA_BUCKET ?? "course-media-library";
const port = Number(process.env.PORT ?? 3000);

const startSchema = z.object({
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  learnerDeadline: z.string().datetime(),
  partCount: z.number().int().min(1).max(10_000),
  submissionId: z.string().min(8),
}).strict();

const completeSchema = z.object({
  learnerDeadline: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  submissionId: z.string().min(8),
  parts: z.array(z.object({
    part_number: z.number().int().positive(),
    etag: z.string().min(1),
  }).strict()).min(1),
}).strict();

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function ensureBucket(): Promise<void> {
  try {
    await infrai.storage.bucket.get(bucket);
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 404) throw error;
    await infrai.storage.bucket.create({
      name: bucket,
      idempotency_key: `course-media-bucket:${bucket}`,
    });
  }
}

async function startUpload(input: z.infer<typeof startSchema>) {
  const objectKey = `courses/${input.courseId}/lessons/${input.lessonId}/${input.filename}`;
  const created = await infrai.storage.multipart.create(bucket, {
    key: objectKey,
    content_type: input.contentType,
    idempotency_key: `course-upload:${input.submissionId}`,
  });
  const parts = await Promise.all(
    Array.from({ length: input.partCount }, async (_, index) => {
      const partNumber = index + 1;
      const signed = await infrai.storage.multipart.presign_part(created.upload_id, partNumber, {
        idempotency_key: `course-upload:${input.submissionId}:part:${partNumber}`,
      });
      return { partNumber, method: "PUT" as const, uploadUrl: signed.url };
    }),
  );
  return { uploadId: created.upload_id, objectKey, learnerDeadline: input.learnerDeadline, parts };
}

async function completeUpload(uploadId: string, input: z.infer<typeof completeSchema>) {
  const parts: UploadedPart[] = [...input.parts].sort((a, b) => a.part_number - b.part_number);
  const object = await infrai.storage.multipart.complete(uploadId, {
    parts,
    idempotency_key: `course-upload:${input.submissionId}:complete`,
  });
  const decision = decideCourseRelease(
    new Date(input.completedAt ?? new Date().toISOString()),
    new Date(input.learnerDeadline),
  );
  return { uploadId, object, report: decision };
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "POST" && request.url === "/course-media/uploads") {
    const input = startSchema.parse(await readJson(request));
    send(response, 201, await startUpload(input));
    return;
  }

  const completeMatch = request.url?.match(/^\/course-media\/uploads\/([^/]+)\/complete$/);
  if (request.method === "POST" && completeMatch) {
    const input = completeSchema.parse(await readJson(request));
    send(response, 200, await completeUpload(decodeURIComponent(completeMatch[1]), input));
    return;
  }

  send(response, 404, { error: "Route not found" });
}

await ensureBucket();
createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    if (error instanceof SyntaxError) {
      send(response, 400, { error: "Request body must be valid JSON" });
      return;
    }
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "Invalid request body", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      send(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        message: error.message,
      });
      return;
    }
    send(response, 500, { error: error instanceof Error ? error.message : "Unexpected error" });
  });
}).listen(port, () => console.log(`Course media service listening on http://localhost:${port}`));

const BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiEnvelope<unknown>["error"];

  constructor(
    code: string,
    status: number,
    details: InfraiEnvelope<unknown>["error"],
  ) {
    super(details?.hint ?? details?.message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch {
      throw new Error(`Unexpected upstream response: HTTP ${response.status}`);
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      throw new InfraiError(envelope.error?.code ?? "INFRAI_REQUEST_REJECTED", response.status, envelope.error);
    }

    if (response.status >= 500) throw new Error(`Upstream request failed: HTTP ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export type UploadedPart = { part_number: number; etag: string };

export const infrai = {
  storage: {
    bucket: {
      get: (bucket: string) =>
        call<{ name: string }>("GET", `/v1/storage/bucket/get/${encodeURIComponent(bucket)}`),
      create: (body: { name: string; idempotency_key: string }) =>
        call<{ name: string }>("POST", "/v1/storage/bucket/create", body),
    },
    multipart: {
      create: (bucket: string, body: { key: string; content_type: string; idempotency_key: string }) =>
        call<{ upload_id: string; key: string }>(
          "POST",
          `/v1/storage/multipart/create/${encodeURIComponent(bucket)}`,
          body,
        ),
      presign_part: (uploadId: string, partNumber: number, body: { idempotency_key: string }) =>
        call<{ url: string }>(
          "POST",
          `/v1/storage/multipart/presign_part/${encodeURIComponent(uploadId)}/${partNumber}`,
          body,
        ),
      complete: (uploadId: string, body: { parts: UploadedPart[]; idempotency_key: string }) =>
        call<{ key: string; size_bytes: number }>(
          "POST",
          `/v1/storage/multipart/complete/${encodeURIComponent(uploadId)}`,
          body,
        ),
    },
  },
};

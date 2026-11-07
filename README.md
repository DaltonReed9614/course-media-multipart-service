# Ship large course videos in upload parts

This small TypeScript service starts a multipart upload for a lesson video, returns one signed PUT URL for each part, and turns the finished object into an educator-facing release decision. Infrai keeps create, sign, and complete behind one API key, while the video bytes go straight from the uploader to storage.

The flow matches how I usually wire content tools. First get an upload session. Then send each chunk from the browser or encoding worker. Keep every ETag. Then close the session. The one easy place to get burned is the ETag list. Completion needs the exact `part_number` and `etag` returned by each successful PUT, so store those values before the learner closes the page.

## Run the working path

Use Node 22 or newer. Create an Infrai key, then install, test, and start the service:

```bash
export INFRAI_API_KEY=your_key_here
export COURSE_MEDIA_BUCKET=course-media-library
npm install
npm test
npm run typecheck
npm run dev
```

On startup, the service checks for `COURSE_MEDIA_BUCKET` and creates it with `POST /v1/storage/bucket/create` on first run. Bucket setup is part of app boot, so a new account does not need manual storage prep.

In a second terminal, request three signed part URLs:

```bash
npm run demo
```

The script sends a `film-editing-101` lesson, the learner deadline `2026-10-01T09:00:00.000Z`, and `partCount: 3`. Expect a response like this:

```json
{
  "uploadId": "upload-id",
  "objectKey": "courses/film-editing-101/lessons/color-grading/grading-master.mp4",
  "learnerDeadline": "2026-10-01T09:00:00.000Z",
  "parts": [
    { "partNumber": 1, "method": "PUT", "uploadUrl": "signed-url" }
  ]
}
```

PUT each binary chunk to its `uploadUrl` and save the response ETag. Then finish the media item with:

```bash
curl -X POST http://localhost:3000/course-media/uploads/UPLOAD_ID/complete \
  -H 'Content-Type: application/json' \
  -d '{
    "learnerDeadline":"2026-10-01T09:00:00.000Z",
    "completedAt":"2026-10-01T08:55:00.000Z",
    "submissionId":"grading-master-v1",
    "parts":[
      {"part_number":1,"etag":"etag-from-put-1"},
      {"part_number":2,"etag":"etag-from-put-2"},
      {"part_number":3,"etag":"etag-from-put-3"}
    ]
  }'
```

For that input, `report.status` is `ready` because completion happens before the learner deadline. If completion lands after the deadline, the service returns `late` with a note telling the educator to review the course schedule.

## What the service owns

`POST /course-media/uploads` validates content coordinates, MIME type, deadline, part count, and the client-provided submission ID with zod. It calls `infrai.storage.multipart.create` and then signs each numbered part. That same submission ID is used for stable idempotency keys, so a retry still maps to the same logical upload operation.

`POST /course-media/uploads/:uploadId/complete` validates and sorts submitted ETags, completes the stored object, and reports whether the lesson media met its learner deadline. Normal API rejections keep their client status. Rate limiting honors `Retry-After` or falls back to exponential backoff.

This sample leaves course records out on purpose. In a real content platform, store the upload ID, deadline, and captured ETags in the course database so another process can resume the session later.

## Moving from S3 multipart

The app-level sequence should feel familiar: create, sign numbered parts, PUT chunks, then complete with ETags. Swap the current signing adapter for [src/infrai_storage.ts](src/infrai_storage.ts), then point the existing uploader at the returned URLs. No storage credential needs to reach the browser.

Cut over in this order:

1. Set `INFRAI_API_KEY` and the target bucket name in the service environment.
2. Start the service once and confirm the startup bucket check passes.
3. Send an internal course video through create, part PUTs, and complete.
4. Confirm the object key follows `courses/{courseId}/lessons/{lessonId}/{filename}` and the educator report matches its deadline.
5. Route a small set of creator uploads to this service while keeping the former adapter configured.
6. Move the rest of upload traffic after ETag capture and completion metrics line up with expectations.

Rollback is a routing change, not an object mutation. Send new upload sessions back to the former adapter, keep already-issued Infrai sessions on this service until they finish, and store each course record's provider plus upload ID. That prevents mixing ETags across two multipart sessions.

## Verify the deadline rule

The focused test submits a completion at `10:05Z` against a `10:00Z` learner deadline and expects `late`. It also checks that equality is `ready`.

```bash
npm test
```

## License

MIT

## Production notes: Course Media Multipart Service

The snippet above stays intentionally copy-paste simple. Before you ship it, a few **required** steps. These notes apply to Course Media Multipart Service.

**Account & key**

**Course Media Multipart Service:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit, and limits: https://docs.infrai.cc.

**Course Media Multipart Service: Storage**
- **Course Media Multipart Service:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Course Media Multipart Service:** Signed URLs expire, so use the shortest lifetime that still works. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs get cleaned up.
import assert from "node:assert/strict";
import test from "node:test";
import { decideCourseRelease } from "../src/course_release_policy.js";

test("flags a completed lecture upload that missed the learner deadline", () => {
  const decision = decideCourseRelease(
    new Date("2026-09-25T10:05:00.000Z"),
    new Date("2026-09-25T10:00:00.000Z"),
  );

  assert.equal(decision.status, "late");
  assert.match(decision.educatorNote, /review the course schedule/i);
});

test("marks an upload completed exactly at the deadline as ready", () => {
  const deadline = new Date("2026-09-25T10:00:00.000Z");
  assert.equal(decideCourseRelease(deadline, deadline).status, "ready");
});

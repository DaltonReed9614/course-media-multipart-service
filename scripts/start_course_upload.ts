const response = await fetch("http://localhost:3000/course-media/uploads", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    courseId: "film-editing-101",
    lessonId: "color-grading",
    filename: "grading-master.mp4",
    contentType: "video/mp4",
    learnerDeadline: "2026-10-01T09:00:00.000Z",
    partCount: 3,
    submissionId: "grading-master-v1",
  }),
});

const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok) process.exitCode = 1;

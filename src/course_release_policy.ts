export type CourseReleaseDecision = {
  status: "ready" | "late";
  completedAt: string;
  learnerDeadline: string;
  educatorNote: string;
};

export function decideCourseRelease(completedAt: Date, learnerDeadline: Date): CourseReleaseDecision {
  const onTime = completedAt.getTime() <= learnerDeadline.getTime();
  return {
    status: onTime ? "ready" : "late",
    completedAt: completedAt.toISOString(),
    learnerDeadline: learnerDeadline.toISOString(),
    educatorNote: onTime
      ? "Media is ready for the scheduled learner release."
      : "Media completed after the learner deadline; review the course schedule before publishing.",
  };
}

import { careerRouter } from "./routers/career.js";
import { healthRouter } from "./routers/health.js";
import { jobsRouter } from "./routers/jobs.js";
import { router } from "./trpc.js";

export const appRouter = router({
  health: healthRouter,
  career: careerRouter,
  jobs: jobsRouter,
});

export type AppRouter = typeof appRouter;

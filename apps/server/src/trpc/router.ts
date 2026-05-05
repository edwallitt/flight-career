import { aircraftRouter } from "./routers/aircraft.js";
import { airportsRouter } from "./routers/airports.js";
import { careerRouter } from "./routers/career.js";
import { healthRouter } from "./routers/health.js";
import { jobsRouter } from "./routers/jobs.js";
import { lifecycleRouter } from "./routers/lifecycle.js";
import { travelRouter } from "./routers/travel.js";
import { router } from "./trpc.js";

export const appRouter = router({
  health: healthRouter,
  career: careerRouter,
  jobs: jobsRouter,
  aircraft: aircraftRouter,
  airports: airportsRouter,
  lifecycle: lifecycleRouter,
  travel: travelRouter,
});

export type AppRouter = typeof appRouter;

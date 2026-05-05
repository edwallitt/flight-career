import { aircraftRouter } from "./routers/aircraft.js";
import { airportsRouter } from "./routers/airports.js";
import { careerRouter } from "./routers/career.js";
import { hangarRouter } from "./routers/hangar.js";
import { healthRouter } from "./routers/health.js";
import { jobsRouter } from "./routers/jobs.js";
import { lifecycleRouter } from "./routers/lifecycle.js";
import { marketplaceRouter } from "./routers/marketplace.js";
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
  marketplace: marketplaceRouter,
  hangar: hangarRouter,
});

export type AppRouter = typeof appRouter;

import { aircraftRouter } from "./routers/aircraft.js";
import { airportsRouter } from "./routers/airports.js";
import { atlasRouter } from "./routers/atlas.js";
import { careerRouter } from "./routers/career.js";
import { fuelRouter } from "./routers/fuel.js";
import { hangarRouter } from "./routers/hangar.js";
import { healthRouter } from "./routers/health.js";
import { jobsRouter } from "./routers/jobs.js";
import { lifecycleRouter } from "./routers/lifecycle.js";
import { logbookRouter } from "./routers/logbook.js";
import { maintenanceRouter } from "./routers/maintenance.js";
import { marketplaceRouter } from "./routers/marketplace.js";
import { saleRouter } from "./routers/sale.js";
import { simBridgeRouter } from "./routers/simBridge.js";
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
  logbook: logbookRouter,
  atlas: atlasRouter,
  maintenance: maintenanceRouter,
  sale: saleRouter,
  fuel: fuelRouter,
  simBridge: simBridgeRouter,
});

export type AppRouter = typeof appRouter;

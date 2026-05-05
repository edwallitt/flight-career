import type { HealthPingResult } from "@flightcareer/shared";
import { publicProcedure, router } from "../trpc.js";

export const healthRouter = router({
  ping: publicProcedure.query((): HealthPingResult => {
    return { ok: true, timestamp: Date.now() };
  }),
});

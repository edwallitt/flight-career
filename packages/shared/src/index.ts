import { z } from "zod";

export const healthPingResultSchema = z.object({
  ok: z.literal(true),
  timestamp: z.number(),
});

export type HealthPingResult = z.infer<typeof healthPingResultSchema>;

export * from "./clients/index.js";
export * from "./jobs/index.js";
export * from "./aircraft/index.js";

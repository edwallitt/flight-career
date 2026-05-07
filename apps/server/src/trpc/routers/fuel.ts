import { z } from "zod";
import {
  forceSpawnShock,
  getActiveShocks,
  getFuelPriceHistory,
  getHeadlineShock,
  processFuelDriftTick,
} from "../../services/fuelDrift.js";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { career } from "../../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

const fuelTypeSchema = z.enum(["avgas", "jet-a"]);

export const fuelRouter = router({
  priceHistory: publicProcedure
    .input(
      z.object({
        airportIcao: z.string().min(3).max(8),
        fuelType: fuelTypeSchema,
        windowDays: z.number().int().positive().max(60).default(7),
      }),
    )
    .query(({ input }) => getFuelPriceHistory(input)),

  activeShocks: publicProcedure.query(() => ({
    shocks: getActiveShocks(),
    headline: getHeadlineShock(),
  })),

  // Dev affordance: force a drift tick now and optionally spawn a shock so
  // sparkline/banner UI can be exercised without waiting 6 sim hours.
  forceDriftNow: publicProcedure
    .input(
      z
        .object({
          spawnShock: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(({ input }) => {
      const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
      const simNow = careerRow?.simDateTime ?? Date.now();
      let forcedId: number | null = null;
      if (input?.spawnShock) {
        forcedId = forceSpawnShock({
          type: "refinery_outage",
          severity: "moderate",
          multiplier: 1.25,
          affectsFuelType: "both",
          affectsRegion: "global",
          durationTicks: 16,
          startedAt: simNow,
          description:
            "An unplanned refinery shutdown has tightened both Avgas and Jet A supply. Prices will stay elevated until product flows resume.",
          headline: "Refinery outage — fuel prices up ~25% globally",
        });
      }
      const result = processFuelDriftTick(simNow);
      return {
        forcedShockId: forcedId,
        airportsUpdated: result.airportsUpdated,
        snapshotsCreated: result.snapshotsCreated,
        spawnedShock: result.shockEvent,
        shocksExpired: result.shocksExpired,
      };
    }),
});

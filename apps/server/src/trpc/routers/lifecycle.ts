import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { career } from "../../db/schema.js";
import {
  abortFlight,
  acceptJob,
  applyDispatcherSignoff,
  beginFlight,
  briefJob,
  cancelAcceptedJob,
  completeFlightAction,
  getActiveJob,
  getTrackedCompletionPreview,
  switchToManualMode,
} from "../../services/jobLifecycle.js";
import { generateSignoff } from "../../services/signoffGenerator.js";
import { simBridge } from "../../services/simBridge.js";
import { publicProcedure, router } from "../trpc.js";

const acceptInput = z
  .object({
    jobId: z.number().int().positive(),
    aircraftSource: z.enum(["owned", "rental", "ferry"]),
    ownedAircraftId: z.number().int().positive().optional(),
    rentalAircraftTypeId: z.string().min(1).optional(),
  })
  .refine(
    (v) => {
      if (v.aircraftSource === "owned") return v.ownedAircraftId != null;
      if (v.aircraftSource === "rental") return v.rentalAircraftTypeId != null;
      return true; // ferry — aircraft is fixed by the job
    },
    { message: "Must supply ownedAircraftId or rentalAircraftTypeId" },
  );

export const lifecycleRouter = router({
  getActiveJob: publicProcedure.query(() => getActiveJob()),

  accept: publicProcedure
    .input(acceptInput)
    .mutation(({ input }) => acceptJob(input)),

  cancel: publicProcedure.mutation(() => cancelAcceptedJob()),

  brief: publicProcedure
    .input(z.object({ fuelGallons: z.number().nonnegative() }))
    .mutation(({ input }) => briefJob(input)),

  beginFlight: publicProcedure
    .input(
      z
        .object({
          trackingMode: z.enum(["manual", "tracked"]).optional(),
        })
        .optional(),
    )
    .mutation(({ input }) => {
      const result = beginFlight(input ?? {});
      // Hand off to the bridge after the lifecycle txn commits — beginTracking
      // writes to a separate table and the in-memory state on the service.
      if (result.ok && result.trackingMode === "tracked") {
        const active = getActiveJob();
        if (active && active.job.id != null) {
          const tracking = simBridge.beginTracking(active.job.id);
          if (!tracking.ok) {
            // beginFlight already committed career.trackingMode = 'tracked'.
            // Roll the column back so getActiveJob (which the in-flight surface
            // polls) doesn't render a tracked panel against a flight that has
            // no live data feed, and so completion records the right mode.
            db.update(career)
              .set({ trackingMode: "manual" })
              .where(eq(career.id, 1))
              .run();
            return {
              ok: true as const,
              startedAt: result.startedAt,
              trackingMode: "manual" as const,
              trackingError: tracking.error ?? null,
            };
          }
        }
      }
      return result;
    }),

  trackedCompletionPreview: publicProcedure.query(() =>
    getTrackedCompletionPreview(),
  ),

  switchToManual: publicProcedure.mutation(() => switchToManualMode()),

  complete: publicProcedure
    .input(
      z.object({
        actualDestinationIcao: z.string().min(3).max(8),
        blockTimeMinutes: z.number().positive(),
        fuelBurnedGal: z.number().nonnegative().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = completeFlightAction(input);
      if (!result.ok) return result;
      const signoff = await applyDispatcherSignoff(
        result.signoff,
        generateSignoff,
      );
      // Patch the response with the generated signoff (or leave it null).
      result.summary.dispatcherSignoff = signoff;
      return { ok: true as const, summary: result.summary };
    }),

  abort: publicProcedure.mutation(() => abortFlight()),
});

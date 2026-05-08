import { z } from "zod";
import {
  abortFlight,
  acceptJob,
  beginFlight,
  briefJob,
  cancelAcceptedJob,
  completeFlightAction,
  getActiveJob,
} from "../../services/jobLifecycle.js";
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

  beginFlight: publicProcedure.mutation(() => beginFlight()),

  complete: publicProcedure
    .input(
      z.object({
        actualDestinationIcao: z.string().min(3).max(8),
        blockTimeMinutes: z.number().positive(),
        fuelBurnedGal: z.number().nonnegative().optional(),
      }),
    )
    .mutation(({ input }) => completeFlightAction(input)),

  abort: publicProcedure.mutation(() => abortFlight()),
});

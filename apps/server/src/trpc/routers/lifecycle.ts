import { z } from "zod";
import {
  acceptJob,
  briefJob,
  cancelAcceptedJob,
  getActiveJob,
} from "../../services/jobLifecycle.js";
import { publicProcedure, router } from "../trpc.js";

const acceptInput = z
  .object({
    jobId: z.number().int().positive(),
    aircraftSource: z.enum(["owned", "rental"]),
    ownedAircraftId: z.number().int().positive().optional(),
    rentalAircraftTypeId: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.aircraftSource === "owned"
        ? v.ownedAircraftId != null
        : v.rentalAircraftTypeId != null,
    { message: "Must supply ownedAircraftId or rentalAircraftTypeId" },
  );

export const lifecycleRouter = router({
  getActiveJob: publicProcedure.query(() => getActiveJob()),

  accept: publicProcedure
    .input(acceptInput)
    .mutation(({ input }) => acceptJob(input)),

  cancel: publicProcedure.mutation(() => cancelAcceptedJob()),

  brief: publicProcedure
    .input(z.object({ fuelGallons: z.number().positive() }))
    .mutation(({ input }) => briefJob(input)),
});

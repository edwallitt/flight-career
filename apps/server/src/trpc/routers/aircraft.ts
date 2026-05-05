import { z } from "zod";
import { getCandidatesForJob } from "../../services/aircraftAvailability.js";
import { publicProcedure, router } from "../trpc.js";

export const aircraftRouter = router({
  candidatesForJob: publicProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(({ input }) => getCandidatesForJob(input.jobId)),
});

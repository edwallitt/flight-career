import { z } from "zod";
import {
  getJobById,
  getOpenJobs,
  tickJobGeneration,
} from "../../services/jobBoard.js";
import { publicProcedure, router } from "../trpc.js";

export const jobsRouter = router({
  list: publicProcedure.query(() => getOpenJobs()),

  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getJobById(input.id)),

  tickNow: publicProcedure.mutation(() => {
    const result = tickJobGeneration();
    return result;
  }),
});

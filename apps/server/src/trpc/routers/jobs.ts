import { getClientById, type BriefingContent } from "@flightcareer/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { jobs } from "../../db/schema.js";
import { generateBriefing } from "../../services/briefingGenerator.js";
import {
  getJobById,
  getOpenJobs,
  getOpenJobsWithReachability,
  tickJobGeneration,
} from "../../services/jobBoard.js";
import { publicProcedure, router } from "../trpc.js";

export type GetBriefingResult =
  | {
      briefing: BriefingContent;
      source: "cached" | "generated";
      dispatcherName: string | null;
    }
  | { briefing: null; error: string };

export const jobsRouter = router({
  list: publicProcedure.query(() => getOpenJobs()),

  listWithReachability: publicProcedure.query(() =>
    getOpenJobsWithReachability(),
  ),

  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getJobById(input.id)),

  getBriefing: publicProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ input }): Promise<GetBriefingResult> => {
      const result = await generateBriefing(input.jobId);
      if (!result.ok) {
        return { briefing: null, error: result.error };
      }
      const row = db
        .select({
          clientId: jobs.clientId,
          jobType: jobs.jobType,
          ferrySource: jobs.ferrySource,
          ferryOwnerName: jobs.ferryOwnerName,
        })
        .from(jobs)
        .where(eq(jobs.id, input.jobId))
        .get();
      let dispatcherName: string | null = null;
      if (row?.jobType === "ferry" && row.ferryOwnerName) {
        dispatcherName =
          row.ferrySource === "operator"
            ? `Operations · ${row.ferryOwnerName}`
            : row.ferryOwnerName;
      } else if (row?.clientId) {
        dispatcherName = getClientById(row.clientId)?.voice?.dispatcherName ?? null;
      }
      return {
        briefing: result.briefing,
        source: result.source,
        dispatcherName,
      };
    }),

  tickNow: publicProcedure.mutation(() => {
    const result = tickJobGeneration();
    return result;
  }),
});

import { z } from "zod";
import {
  executeTransfer,
  listOwnedAircraftForTransfer,
  previewTransfer,
} from "../../services/travel.js";
import { publicProcedure, router } from "../trpc.js";

const transferInput = z.object({
  type: z.enum(["pilot", "pilot_aircraft", "aircraft"]),
  destinationIcao: z.string().min(3).max(8),
  ownedAircraftId: z.number().int().positive().optional(),
});

export const travelRouter = router({
  preview: publicProcedure
    .input(transferInput)
    .query(({ input }) => previewTransfer(input)),

  execute: publicProcedure
    .input(transferInput)
    .mutation(({ input }) => executeTransfer(input)),

  listOwnedForTransfer: publicProcedure.query(() =>
    listOwnedAircraftForTransfer(),
  ),
});

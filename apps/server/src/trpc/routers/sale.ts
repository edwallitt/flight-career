import { z } from "zod";
import {
  executeSale,
  getPastAircraft,
  getSalePreview,
} from "../../services/sale.js";
import { publicProcedure, router } from "../trpc.js";

export const saleRouter = router({
  preview: publicProcedure
    .input(z.object({ ownedAircraftId: z.number().int().positive() }))
    .query(({ input }) => getSalePreview(input)),

  confirm: publicProcedure
    .input(z.object({ ownedAircraftId: z.number().int().positive() }))
    .mutation(({ input }) => executeSale(input)),

  pastAircraft: publicProcedure.query(() => getPastAircraft()),
});

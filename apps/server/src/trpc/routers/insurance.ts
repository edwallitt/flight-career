import { INSURANCE_TIER_ORDER } from "@flightcareer/shared";
import { z } from "zod";
import {
  buyPolicy,
  cancelPolicy,
  getInsuranceQuotes,
} from "../../services/insurance.js";
import { publicProcedure, router } from "../trpc.js";

const tierSchema = z.enum(INSURANCE_TIER_ORDER);

export const insuranceRouter = router({
  quotes: publicProcedure
    .input(z.object({ ownedAircraftId: z.number().int().positive() }))
    .query(({ input }) =>
      getInsuranceQuotes({ ownedAircraftId: input.ownedAircraftId }),
    ),

  buy: publicProcedure
    .input(
      z.object({
        ownedAircraftId: z.number().int().positive(),
        tier: tierSchema,
      }),
    )
    .mutation(({ input }) =>
      buyPolicy({
        ownedAircraftId: input.ownedAircraftId,
        tier: input.tier,
      }),
    ),

  cancel: publicProcedure
    .input(z.object({ ownedAircraftId: z.number().int().positive() }))
    .mutation(({ input }) =>
      cancelPolicy({ ownedAircraftId: input.ownedAircraftId }),
    ),
});

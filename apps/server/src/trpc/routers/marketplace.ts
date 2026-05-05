import { z } from "zod";
import {
  getListingById,
  getListings,
  refreshMarketplace,
} from "../../services/marketplace.js";
import {
  executePurchase,
  previewPurchase,
} from "../../services/purchase.js";
import { db } from "../../db/client.js";
import { career } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { publicProcedure, router } from "../trpc.js";

const aircraftClassEnum = z.enum(["SEP", "MEP", "SET", "JET"]);

const listingsInputSchema = z
  .object({
    filterByClass: z.array(aircraftClassEnum).optional(),
    maxPriceCents: z.number().int().nonnegative().optional(),
    sortBy: z
      .enum(["price_asc", "price_desc", "hours_asc", "distance_asc"])
      .optional(),
  })
  .optional();

function getPlayerLocationIcao(): string | undefined {
  const row = db.select().from(career).where(eq(career.id, 1)).get();
  return row?.currentLocationIcao ?? undefined;
}

export const marketplaceRouter = router({
  listings: publicProcedure.input(listingsInputSchema).query(({ input }) => {
    const playerLocationIcao = getPlayerLocationIcao();
    const listings = getListings({
      ...(input ?? {}),
      playerLocationIcao,
    });
    return { listings, playerLocationIcao: playerLocationIcao ?? "" };
  }),

  listingById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => {
      const playerLocationIcao = getPlayerLocationIcao();
      return getListingById(input.id, playerLocationIcao);
    }),

  refreshNow: publicProcedure.mutation(() => refreshMarketplace()),

  previewPurchase: publicProcedure
    .input(z.object({ listingId: z.number().int().positive() }))
    .query(({ input }) => previewPurchase(input)),

  purchase: publicProcedure
    .input(
      z.object({
        listingId: z.number().int().positive(),
        paymentMethod: z.enum(["cash", "loan"]),
        loanTermMonths: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ input }) => executePurchase(input)),
});

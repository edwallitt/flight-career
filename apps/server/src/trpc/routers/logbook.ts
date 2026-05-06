import { z } from "zod";
import {
  getFlightById,
  getFlightFilterOptions,
  getFlights,
  getFinancialSummary,
  getLogbookHeadline,
  getMaintenanceEvents,
} from "../../services/logbook.js";
import { publicProcedure, router } from "../trpc.js";

const flightFiltersSchema = z
  .object({
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().min(0).optional(),
    filterByOwnedAircraftId: z.number().int().positive().optional(),
    filterByRentalAircraftTypeId: z.string().min(1).optional(),
    filterByClientId: z.string().min(1).optional(),
    filterByDateFrom: z.number().int().nonnegative().optional(),
    filterByDateTo: z.number().int().nonnegative().optional(),
  })
  .optional();

export const logbookRouter = router({
  flights: publicProcedure
    .input(flightFiltersSchema)
    .query(({ input }) => getFlights(input ?? {})),

  flightById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getFlightById(input.id)),

  filterOptions: publicProcedure.query(() => getFlightFilterOptions()),

  financialSummary: publicProcedure
    .input(
      z
        .object({
          fromSimTime: z.number().int().nonnegative().optional(),
          toSimTime: z.number().int().nonnegative().optional(),
        })
        .optional(),
    )
    .query(({ input }) => getFinancialSummary(input)),

  maintenance: publicProcedure.query(() => getMaintenanceEvents()),

  headline: publicProcedure.query(() => getLogbookHeadline()),
});

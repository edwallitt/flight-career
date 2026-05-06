import { z } from "zod";
import {
  bookMaintenance,
  getAvailableMaintenance,
} from "../../services/maintenance.js";
import { publicProcedure, router } from "../trpc.js";

const maintenanceTypeSchema = z.enum(["100hr", "annual", "overhaul"]);

export const maintenanceRouter = router({
  options: publicProcedure
    .input(z.object({ ownedAircraftId: z.number().int().positive() }))
    .query(({ input }) =>
      getAvailableMaintenance({ ownedAircraftId: input.ownedAircraftId }),
    ),

  book: publicProcedure
    .input(
      z.object({
        ownedAircraftId: z.number().int().positive(),
        type: maintenanceTypeSchema,
      }),
    )
    .mutation(({ input }) =>
      bookMaintenance({
        ownedAircraftId: input.ownedAircraftId,
        type: input.type,
      }),
    ),
});

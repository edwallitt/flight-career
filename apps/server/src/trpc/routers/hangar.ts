import { z } from "zod";
import {
  getOwnedAircraft,
  getOwnedAircraftById,
  refuelOwnedAircraft,
} from "../../services/hangar.js";
import { publicProcedure, router } from "../trpc.js";

export const hangarRouter = router({
  fleet: publicProcedure.query(() => getOwnedAircraft()),

  aircraftById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getOwnedAircraftById(input.id)),

  refuel: publicProcedure
    .input(z.object({ aircraftId: z.number().int().positive() }))
    .mutation(({ input }) => refuelOwnedAircraft(input.aircraftId)),
});

import { db } from "../../db/client.js";
import { airports } from "../../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

export interface IcaoOption {
  icao: string;
  name: string;
}

export const airportsRouter = router({
  icaoOptions: publicProcedure.query((): IcaoOption[] => {
    return db
      .select({ icao: airports.icao, name: airports.name })
      .from(airports)
      .all();
  }),
});

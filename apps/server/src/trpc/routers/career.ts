import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { airports, career } from "../../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

export interface CareerSnapshot {
  pilotName: string;
  cash: number;
  currentLocationIcao: string;
  currentLocationName: string;
  simDateTime: number;
  startedAt: number;
}

export const careerRouter = router({
  get: publicProcedure.query((): CareerSnapshot | null => {
    const row = db.select().from(career).where(eq(career.id, 1)).get();
    if (!row) return null;
    const ap = db
      .select()
      .from(airports)
      .where(eq(airports.icao, row.currentLocationIcao))
      .get();
    return {
      pilotName: row.pilotName,
      cash: row.cash,
      currentLocationIcao: row.currentLocationIcao,
      currentLocationName: ap?.name ?? row.currentLocationIcao,
      simDateTime: row.simDateTime,
      startedAt: row.startedAt,
    };
  }),
});

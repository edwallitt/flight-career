import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { airports, career } from "../../db/schema.js";
import {
  bookExam,
  cancelExam,
  getCareerSnapshot,
} from "../../services/career.js";
import { publicProcedure, router } from "../trpc.js";

export interface CareerSnapshot {
  pilotName: string;
  cash: number;
  currentLocationIcao: string;
  currentLocationName: string;
  simDateTime: number;
  startedAt: number;
  isPaused: boolean;
}

const aircraftClass = z.enum(["SEP", "MEP", "SET", "JET"]);

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
      isPaused: row.isPaused,
    };
  }),

  snapshot: publicProcedure.query(() => getCareerSnapshot()),

  setPaused: publicProcedure
    .input(z.object({ paused: z.boolean() }))
    .mutation(({ input }) => {
      db.update(career)
        .set({ isPaused: input.paused })
        .where(eq(career.id, 1))
        .run();
      return { paused: input.paused };
    }),

  bookExam: publicProcedure
    .input(z.object({ class: aircraftClass }))
    .mutation(({ input }) => bookExam({ class: input.class })),

  cancelExam: publicProcedure
    .input(z.object({ examId: z.number().int().positive() }))
    .mutation(({ input }) => cancelExam({ examId: input.examId })),
});

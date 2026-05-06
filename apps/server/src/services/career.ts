import {
  RATING_REQUIREMENTS,
  checkExamEligibility,
  getClientById,
  type AircraftClass,
  type EligibilityCheck,
  type Role,
} from "@flightcareer/shared";
import { and, eq, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  career,
  flights,
  jobs,
  ownedAircraft,
  ratingExams,
  ratings,
  reputation,
} from "../db/schema.js";

const RATING_CLASSES: AircraftClass[] = ["SEP", "MEP", "SET", "JET"];
const ROLES: Role[] = ["bush", "air_taxi", "light_jet"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export type ReputationTier = "novice" | "mid" | "high" | "top";

export function tierForScore(score: number): ReputationTier {
  if (score >= 85) return "top";
  if (score >= 60) return "high";
  if (score >= 25) return "mid";
  return "novice";
}

export interface RatingCard {
  class: AircraftClass;
  earned: boolean;
  earnedAt: number | null;
  hoursInClass: number;
  totalHours: number;
  requirement: {
    hourGate: number;
    classSpecificGate?: { inClass: AircraftClass; hours: number };
    examCostCents: number;
    examLeadDays: number;
  } | null;
  eligibility: EligibilityCheck | null;
  pendingExam: {
    id: number;
    bookedAt: number;
    scheduledFor: number;
    cost: number;
  } | null;
}

export interface ReputationByRole {
  role: Role;
  score: number;
  tier: ReputationTier;
  flightCount: number;
}

export interface ReputationByClient {
  clientId: string;
  clientName: string;
  role: Role;
  score: number;
  tier: ReputationTier;
  flightCount: number;
  lastInteractionAt: number | null;
}

export interface MilestonesData {
  careerStartedAt: number;
  simNow: number;
  totalFlights: number;
  totalBlockMinutes: number;
  totalEarnings: number;
  totalDistanceNm: number;
  longestFlight: {
    distanceNm: number;
    originIcao: string;
    destinationIcao: string;
  } | null;
  aircraftOwned: number;
  uniqueAirportsVisited: number;
  favoriteRoute: {
    origin: string;
    destination: string;
    count: number;
  } | null;
  topClient: {
    clientId: string;
    name: string;
    flightCount: number;
    totalEarnings: number;
  } | null;
}

export interface CareerSnapshotFull {
  pilotName: string;
  cash: number;
  simNow: number;
  ratings: RatingCard[];
  reputation: {
    byRole: ReputationByRole[];
    byClient: ReputationByClient[];
  };
  milestones: MilestonesData;
}

function loadHoursInClass(): Record<AircraftClass, number> {
  const out: Record<AircraftClass, number> = { SEP: 0, MEP: 0, SET: 0, JET: 0 };
  const rows = db.select().from(ratings).all();
  for (const row of rows) {
    out[row.class] = row.hoursInClass;
  }
  return out;
}

function loadEarnedRatings(): Record<AircraftClass, boolean> {
  const out: Record<AircraftClass, boolean> = {
    SEP: false,
    MEP: false,
    SET: false,
    JET: false,
  };
  const rows = db.select().from(ratings).all();
  for (const row of rows) {
    out[row.class] = row.earned;
  }
  return out;
}

function loadPendingExams(): Map<AircraftClass, typeof ratingExams.$inferSelect> {
  const rows = db
    .select()
    .from(ratingExams)
    .where(eq(ratingExams.status, "booked"))
    .all();
  const m = new Map<AircraftClass, typeof ratingExams.$inferSelect>();
  for (const row of rows) {
    m.set(row.class as AircraftClass, row);
  }
  return m;
}

export function getCareerSnapshot(): CareerSnapshotFull | null {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return null;
  const simNow = careerRow.simDateTime;

  const ratingRows = db.select().from(ratings).all();
  const ratingByClass = new Map(ratingRows.map((r) => [r.class, r]));
  const hoursByClass = loadHoursInClass();
  const earned = loadEarnedRatings();
  const pendingExams = loadPendingExams();

  const total = hoursByClass.SEP + hoursByClass.MEP + hoursByClass.SET + hoursByClass.JET;

  const ratingCards: RatingCard[] = RATING_CLASSES.map((cls) => {
    const row = ratingByClass.get(cls);
    const req = RATING_REQUIREMENTS[cls];
    const pending = pendingExams.get(cls) ?? null;
    const eligibility =
      req && !earned[cls]
        ? checkExamEligibility(cls, {
            ratingsEarned: earned,
            hoursInClass: hoursByClass,
            pendingExamForClass: pending != null,
          })
        : null;
    return {
      class: cls,
      earned: row?.earned ?? false,
      earnedAt: row?.earnedAt ?? null,
      hoursInClass: row?.hoursInClass ?? 0,
      totalHours: total,
      requirement: req
        ? {
            hourGate: req.hourGate,
            classSpecificGate: req.classSpecificGate,
            examCostCents: req.examCostCents,
            examLeadDays: req.examLeadDays,
          }
        : null,
      eligibility,
      pendingExam: pending
        ? {
            id: pending.id,
            bookedAt: pending.bookedAt,
            scheduledFor: pending.scheduledFor,
            cost: pending.cost,
          }
        : null,
    };
  });

  // Reputation
  const repRows = db.select().from(reputation).all();
  const repByRole: Record<Role, number> = { bush: 0, air_taxi: 0, light_jet: 0 };
  const repByClient = new Map<string, number>();
  for (const row of repRows) {
    if ((ROLES as string[]).includes(row.scope)) {
      repByRole[row.scope as Role] = row.score;
    } else if (row.scope.startsWith("client:")) {
      repByClient.set(row.scope.slice("client:".length), row.score);
    }
  }

  // Flight counts per role and per client (completed flights only — we look at
  // jobs rows joined to flight rows by jobId).
  const flightRows = db.select().from(flights).all();
  const jobRows =
    flightRows.length === 0
      ? []
      : db.select().from(jobs).all();
  const jobsById = new Map(jobRows.map((j) => [j.id, j]));

  const flightCountByRole: Record<Role, number> = {
    bush: 0,
    air_taxi: 0,
    light_jet: 0,
  };
  const flightCountByClient = new Map<string, number>();
  const lastFlightByClient = new Map<string, number>();
  const earningsByClient = new Map<string, number>();

  for (const f of flightRows) {
    const job = f.jobId != null ? jobsById.get(f.jobId) : null;
    if (!job) continue;
    if (job.role !== "open") {
      flightCountByRole[job.role]++;
    }
    if (job.clientId) {
      flightCountByClient.set(
        job.clientId,
        (flightCountByClient.get(job.clientId) ?? 0) + 1,
      );
      const prev = lastFlightByClient.get(job.clientId) ?? 0;
      if (f.endedAt > prev) {
        lastFlightByClient.set(job.clientId, f.endedAt);
      }
      earningsByClient.set(
        job.clientId,
        (earningsByClient.get(job.clientId) ?? 0) + f.totalRevenue,
      );
    }
  }

  // Defensive: if a role has zero completed flights, surface 0/NOVICE
  // regardless of any drift in the underlying reputation row. A non-zero
  // score with no flights logged is a data bug — log it once and don't let
  // it leak into the UI.
  const byRole: ReputationByRole[] = ROLES.map((role) => {
    const flightCount = flightCountByRole[role];
    const rawScore = repByRole[role];
    const noFlightsButPositive = flightCount === 0 && rawScore > 0;
    if (noFlightsButPositive) {
      console.warn(
        `[career] reputation drift: role=${role} score=${rawScore} but flightCount=0 — clamping display to 0`,
      );
    }
    const displayScore = noFlightsButPositive ? 0 : rawScore;
    return {
      role,
      score: displayScore,
      tier: tierForScore(displayScore),
      flightCount,
    };
  });

  const clientIdsWithRep = new Set<string>(repByClient.keys());
  for (const id of flightCountByClient.keys()) clientIdsWithRep.add(id);

  const byClient: ReputationByClient[] = [];
  for (const cId of clientIdsWithRep) {
    const def = getClientById(cId);
    if (!def) continue;
    byClient.push({
      clientId: cId,
      clientName: def.name,
      role: def.role,
      score: repByClient.get(cId) ?? 0,
      tier: tierForScore(repByClient.get(cId) ?? 0),
      flightCount: flightCountByClient.get(cId) ?? 0,
      lastInteractionAt: lastFlightByClient.get(cId) ?? null,
    });
  }
  byClient.sort((a, b) => b.score - a.score || b.flightCount - a.flightCount);

  // Milestones
  const ownedCount = db.select().from(ownedAircraft).all().length;
  let totalBlock = 0;
  let totalEarnings = 0;
  let totalDistanceNm = 0;
  let longest: MilestonesData["longestFlight"] = null;
  const visitedAirports = new Set<string>();
  const routeCounts = new Map<string, { origin: string; destination: string; count: number }>();

  for (const f of flightRows) {
    totalBlock += f.blockTimeMinutes;
    totalEarnings += f.totalRevenue;
    visitedAirports.add(f.destinationIcao);
    visitedAirports.add(f.originIcao);
    // Distance: use job distance when available; otherwise infer from flight log
    // duration is unreliable, so fall back to 0.
    const job = f.jobId != null ? jobsById.get(f.jobId) : null;
    const distance = job?.distanceNm ?? 0;
    totalDistanceNm += distance;
    if (longest == null || distance > longest.distanceNm) {
      longest = {
        distanceNm: distance,
        originIcao: f.originIcao,
        destinationIcao: f.destinationIcao,
      };
    }
    const key = `${f.originIcao}->${f.destinationIcao}`;
    const prev = routeCounts.get(key);
    if (prev) {
      prev.count += 1;
    } else {
      routeCounts.set(key, {
        origin: f.originIcao,
        destination: f.destinationIcao,
        count: 1,
      });
    }
  }

  let favoriteRoute: MilestonesData["favoriteRoute"] = null;
  if (flightRows.length >= 3) {
    for (const r of routeCounts.values()) {
      if (!favoriteRoute || r.count > favoriteRoute.count) {
        favoriteRoute = { origin: r.origin, destination: r.destination, count: r.count };
      }
    }
    // Only show if there's a real favorite (count > 1).
    if (favoriteRoute && favoriteRoute.count < 2) favoriteRoute = null;
  }

  let topClient: MilestonesData["topClient"] = null;
  for (const [cId, cnt] of flightCountByClient.entries()) {
    if (!topClient || cnt > topClient.flightCount) {
      const def = getClientById(cId);
      if (!def) continue;
      topClient = {
        clientId: cId,
        name: def.name,
        flightCount: cnt,
        totalEarnings: earningsByClient.get(cId) ?? 0,
      };
    }
  }

  // longest flight only meaningful if we have a real distance
  if (longest && longest.distanceNm <= 0) longest = null;

  return {
    pilotName: careerRow.pilotName,
    cash: careerRow.cash,
    simNow,
    ratings: ratingCards,
    reputation: { byRole, byClient },
    milestones: {
      careerStartedAt: careerRow.startedAt,
      simNow,
      totalFlights: flightRows.length,
      totalBlockMinutes: totalBlock,
      totalEarnings,
      totalDistanceNm,
      longestFlight: longest,
      aircraftOwned: ownedCount,
      uniqueAirportsVisited: visitedAirports.size,
      favoriteRoute,
      topClient,
    },
  };
}

// ---------------------------------------------------------------------------
// bookExam
// ---------------------------------------------------------------------------

export type BookExamResult =
  | { ok: true; examId: number; scheduledFor: number; cost: number }
  | { ok: false; error: string };

export function bookExam(input: { class: AircraftClass }): BookExamResult {
  const req = RATING_REQUIREMENTS[input.class];
  if (!req) {
    return { ok: false, error: `${input.class} has no exam requirement` };
  }

  return db.transaction((tx): BookExamResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    const simNow = careerRow.simDateTime;

    const ratingRow = tx
      .select()
      .from(ratings)
      .where(eq(ratings.class, input.class))
      .get();
    if (!ratingRow) return { ok: false, error: "Rating row missing" };
    if (ratingRow.earned) {
      return { ok: false, error: `${input.class} already earned` };
    }

    const pending = tx
      .select()
      .from(ratingExams)
      .where(
        and(
          eq(ratingExams.class, input.class),
          eq(ratingExams.status, "booked"),
        ),
      )
      .get();
    if (pending) {
      return { ok: false, error: `Exam already booked for ${input.class}` };
    }

    const earned = loadEarnedRatings();
    const hoursByClass = loadHoursInClass();
    const elig = checkExamEligibility(input.class, {
      ratingsEarned: earned,
      hoursInClass: hoursByClass,
      pendingExamForClass: false,
    });
    if (!elig.eligible) {
      return {
        ok: false,
        error: elig.reasons.map((r) => r.message).join("; "),
      };
    }

    if (careerRow.cash < req.examCostCents) {
      return { ok: false, error: "Insufficient cash for exam fee" };
    }

    tx.update(career)
      .set({ cash: careerRow.cash - req.examCostCents })
      .where(eq(career.id, 1))
      .run();

    const scheduledFor = simNow + req.examLeadDays * MS_PER_DAY;

    const insertResult = tx
      .insert(ratingExams)
      .values({
        class: input.class,
        bookedAt: simNow,
        scheduledFor,
        cost: req.examCostCents,
        status: "booked",
      })
      .returning({ id: ratingExams.id })
      .all();

    return {
      ok: true,
      examId: insertResult[0]!.id,
      scheduledFor,
      cost: req.examCostCents,
    };
  });
}

// ---------------------------------------------------------------------------
// cancelExam
// ---------------------------------------------------------------------------

export type CancelExamResult =
  | { ok: true; refundCents: number }
  | { ok: false; error: string };

const REFUND_FRACTION = 0.5;

export function cancelExam(input: { examId: number }): CancelExamResult {
  return db.transaction((tx): CancelExamResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };

    const examRow = tx
      .select()
      .from(ratingExams)
      .where(eq(ratingExams.id, input.examId))
      .get();
    if (!examRow) return { ok: false, error: "Exam not found" };
    if (examRow.status !== "booked") {
      return { ok: false, error: `Cannot cancel exam in state ${examRow.status}` };
    }

    const refund = Math.round(examRow.cost * REFUND_FRACTION);

    tx.update(ratingExams)
      .set({ status: "cancelled", resolvedAt: careerRow.simDateTime })
      .where(eq(ratingExams.id, input.examId))
      .run();

    tx.update(career)
      .set({ cash: careerRow.cash + refund })
      .where(eq(career.id, 1))
      .run();

    return { ok: true, refundCents: refund };
  });
}

// ---------------------------------------------------------------------------
// processExams (auto-pass)
// ---------------------------------------------------------------------------

export interface ExamProcessResult {
  resolved: number;
}

export function processExams(): ExamProcessResult {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return { resolved: 0 };
  const simNow = careerRow.simDateTime;

  const due = db
    .select()
    .from(ratingExams)
    .where(
      and(
        eq(ratingExams.status, "booked"),
        lte(ratingExams.scheduledFor, simNow),
      ),
    )
    .all();
  if (due.length === 0) return { resolved: 0 };

  let resolved = 0;
  for (const exam of due) {
    db.transaction((tx) => {
      tx.update(ratingExams)
        .set({ status: "passed", resolvedAt: simNow })
        .where(eq(ratingExams.id, exam.id))
        .run();
      tx.update(ratings)
        .set({ earned: true, earnedAt: simNow })
        .where(eq(ratings.class, exam.class))
        .run();
    });
    resolved += 1;
  }

  return { resolved };
}

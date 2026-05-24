import type { AircraftClass } from "../clients/types.js";
import { haversineNm } from "./distance.js";

// Per-job "fit" — a richer cousin of computeReachability that also checks
// payload, range, and unpaved capability against every aircraft the player
// could realistically dispatch (owned anywhere it is, plus rentals at the
// player's current airport). The job board renders this on every row so
// the player can scan-pick a job without opening the drawer.
//
// Why a second function alongside computeReachability? Reachability is the
// "can I get to the origin" check and is still used by the drawer's
// repositioning flow. Fit answers the larger question — "is there a plane
// I can fly that will actually do this job?" — and it depends on payload
// and per-leg range, which reachability deliberately ignores.

export interface FitOwnedAircraft {
  aircraftTypeId: string;
  currentLocationIcao: string;
  cls: AircraftClass;
  rangeNm: number;
  cruiseSpeedKts: number;
  maxPayloadLbs: number;
  unpavedCapable: boolean;
  isAvailable: boolean;
  // Net-pay-hour inputs. fuelBurnGph + fuelType + the per-airport price (in
  // ctx.fuelPricesByIcao) feed the fuel cost; owned aircraft never carry a
  // rental rate, so it stays implicitly zero. Keeping these here (rather
  // than a separate pricing lookup) means the candidate set is self-
  // describing: every candidate knows what it would cost to fly the job.
  fuelBurnGph: number;
  fuelType: "avgas" | "jet-a";
}

export interface FitRentalAircraft {
  aircraftTypeId: string;
  cls: AircraftClass;
  rangeNm: number;
  cruiseSpeedKts: number;
  maxPayloadLbs: number;
  unpavedCapable: boolean;
  fuelBurnGph: number;
  fuelType: "avgas" | "jet-a";
  // Wet rate. Rentals are billed by tach hour across the whole trip (both
  // positioning + the contract leg); fuel is already included in this rate
  // so we don't double-count fuel for rental candidates.
  rentalRatePerHour: number;
}

export interface FitAirport {
  lat: number;
  lon: number;
  hasPavedRunway: boolean;
}

export interface JobFitContext {
  playerLocationIcao: string;
  playerRatings: Record<AircraftClass, boolean>;
  ownedAircraft: FitOwnedAircraft[];
  rentalsAtPlayerLocation: FitRentalAircraft[];
  airports: Map<string, FitAirport>;
  // Live fuel prices in cents per gallon, keyed `${icao}:${fuelType}`. The
  // server is the only caller that can resolve these (DB lookup), but the
  // map keeps this module pure — pass an empty map for tests that don't care
  // about net pay/hour and netPayHourCents will fall back to gross.
  fuelPricesByIcao: Map<string, number>;
}

export type FitStatus = "ready" | "reposition" | "wont_fit" | "locked";

export interface JobFit {
  status: FitStatus;
  // Short human reason. Examples:
  //   "Ready · C172 at origin"
  //   "Reposition 32 nm in Bonanza G36"
  //   "Payload +220 lb over your C172"
  //   "Needs SET rating"
  reason: string;
  // The type id of the best candidate for the job (or, for wont_fit, the
  // closest-class rated aircraft so the row can name what's blocking).
  // null for locked.
  bestAircraftTypeId: string | null;
  bestCruiseSpeedKts: number | null;
  // null for ready (no positioning) and for wont_fit/locked.
  positioningDistanceNm: number | null;
  // pay / (positioningHrs + flightHrs) in cents per hour. Only set for
  // ready and reposition — those are the only states where we actually
  // know which aircraft would fly the job.
  payHourCents: number | null;
  // (pay - fuelCost - rentalCost) / hours. The number a player should
  // actually compare across jobs — gross $/hr lies when one option is a
  // rental and another is owned, or when one burns Jet-A at a fuel-shocked
  // airport. Null in the same cases as payHourCents. Falls back to gross
  // when the context's fuel-prices map can't price the candidate's fuel
  // type at the player's airport (test fixtures, edge cases) — that way
  // suites that don't care about fuel still get a number.
  netPayHourCents: number | null;
  // Cost breakdown that fed netPayHourCents — surfaced so the drawer can
  // explain the number without recomputing. Cents, all positive.
  fuelCostCents: number;
  rentalCostCents: number;
}

interface FitJobInput {
  originIcao: string;
  destinationIcao: string;
  distanceNm: number;
  payloadLbs: number;
  requiredClass: AircraftClass;
  requiredCapabilities: string[];
  pay: number;
}

const CLASS_RANK: Record<AircraftClass, number> = {
  SEP: 0,
  MEP: 1,
  SET: 2,
  JET: 3,
};

// Mirrors checkEligibility — 15% reserve over straight-line distance.
const RANGE_RESERVE_FACTOR = 1.15;
// Mirrors computeReachability — rentals must reach the origin with reserves
// (positioning leg only). Keep both factors in lockstep with the originals
// so the drawer and the board agree on whether a job is reachable.
const REPOSITION_RESERVE_FACTOR = 0.85;

interface Candidate {
  typeId: string;
  cls: AircraftClass;
  cruiseSpeedKts: number;
  rangeNm: number;
  maxPayloadLbs: number;
  unpavedCapable: boolean;
  positioningDistanceNm: number;
  source: "owned-at-origin" | "owned-at-player" | "rental";
  // Pre-computed per-aircraft fit deltas. Negative = passes by that margin.
  payloadGapLbs: number;
  rangeGapNm: number;
  needsUnpaved: boolean;
  meetsRating: boolean;
  meetsClass: boolean;
  passesUnpaved: boolean;
  // Cost inputs carried through so the winning candidate can be priced
  // without a second pass over the ownedAircraft/rentals arrays.
  fuelBurnGph: number;
  fuelType: "avgas" | "jet-a";
  rentalRatePerHour: number; // 0 for owned candidates.
}

interface PayHourBreakdown {
  hours: number;
  payHourCents: number;
  netPayHourCents: number;
  fuelCostCents: number;
  rentalCostCents: number;
}

function priceCandidate(
  job: FitJobInput,
  candidate: Candidate,
  ctx: JobFitContext,
): PayHourBreakdown | null {
  if (candidate.cruiseSpeedKts <= 0) return null;
  const totalNm = job.distanceNm + candidate.positioningDistanceNm;
  // Floor at 0.1 hr so a same-airport contract (which shouldn't be generated
  // anyway) doesn't blow up the math.
  const hours = Math.max(0.1, totalNm / candidate.cruiseSpeedKts);

  // Fuel: cents per gallon × gph × hours. Owned aircraft buy fuel at the
  // pump where they take off; for simplicity (and because positioning fuel
  // is typically bought at playerLocation before departing for the contract
  // origin) we use the player-location price for both legs. The drawer's
  // briefing math can refine this; the board only needs a comparable number.
  // Rentals are wet — fuel is included in the rental rate, so we charge
  // rental hours × rate and zero out the fuel line.
  let fuelCostCents = 0;
  let rentalCostCents = 0;
  if (candidate.source === "rental") {
    rentalCostCents = Math.round(candidate.rentalRatePerHour * hours);
  } else {
    const priceKey = `${ctx.playerLocationIcao}:${candidate.fuelType}`;
    const pricePerGal = ctx.fuelPricesByIcao.get(priceKey);
    if (pricePerGal != null) {
      fuelCostCents = Math.round(
        pricePerGal * candidate.fuelBurnGph * hours,
      );
    }
  }

  const payHourCents = Math.round(job.pay / hours);
  const net = job.pay - fuelCostCents - rentalCostCents;
  // Even when fuel/rental erases the margin, we clamp at 0 rather than
  // returning a negative number — the player still gets the row in front of
  // them (with the "best" pill suppressed by the server's recommendation
  // logic), and "$0/hr" reads as "don't take this" without scaring with a
  // negative sign that doesn't quite mean what it looks like.
  const netPayHourCents = Math.round(Math.max(0, net) / hours);
  return {
    hours,
    payHourCents,
    netPayHourCents,
    fuelCostCents,
    rentalCostCents,
  };
}

// Minimal pricing for ferries — ferries skip the candidate machinery (the
// aircraft is supplied), so we price the fly leg directly. Both kinds of
// $/hr math route through here so we keep one definition of truth.
function priceFerryLeg(
  pay: number,
  distanceNm: number,
  cruiseSpeedKts: number,
  burnGph: number,
  fuelType: "avgas" | "jet-a",
  airportIcaoForFuel: string,
  fuelPricesByIcao: Map<string, number>,
): PayHourBreakdown | null {
  if (cruiseSpeedKts <= 0) return null;
  const hours = Math.max(0.1, distanceNm / cruiseSpeedKts);
  const priceKey = `${airportIcaoForFuel}:${fuelType}`;
  const pricePerGal = fuelPricesByIcao.get(priceKey);
  const fuelCostCents =
    pricePerGal != null
      ? Math.round(pricePerGal * burnGph * hours)
      : 0;
  const payHourCents = Math.round(pay / hours);
  const netPayHourCents = Math.round(
    Math.max(0, pay - fuelCostCents) / hours,
  );
  return {
    hours,
    payHourCents,
    netPayHourCents,
    fuelCostCents,
    rentalCostCents: 0,
  };
}

function chooseBestPositive(candidates: Candidate[]): Candidate {
  // Prefer owned-at-origin (no positioning, no rental fee) > owned-at-player
  // > rental, then class closest to required (no point flying a JET when a
  // C172 will do — and the smaller aircraft is usually cheaper to run), then
  // the faster cruise speed (better pay/hr). The board's recommendation rolls
  // up the same priority.
  const order = { "owned-at-origin": 0, "owned-at-player": 1, rental: 2 };
  return [...candidates].sort((a, b) => {
    if (order[a.source] !== order[b.source]) {
      return order[a.source] - order[b.source];
    }
    if (a.cls !== b.cls) {
      return CLASS_RANK[a.cls] - CLASS_RANK[b.cls];
    }
    return b.cruiseSpeedKts - a.cruiseSpeedKts;
  })[0]!;
}

function describeBlocker(c: Candidate): string {
  // Order of explanation matches the order a player would think about it:
  // first "this aircraft is too small," then "needs unpaved," then range.
  // Payload mismatch is the single most common case for a starter C172 so
  // we lead with it.
  if (c.payloadGapLbs > 0) {
    return `Payload +${Math.round(c.payloadGapLbs)} lb over ${c.cls} max`;
  }
  if (c.needsUnpaved && !c.unpavedCapable) {
    return `Needs unpaved-capable aircraft`;
  }
  if (c.rangeGapNm > 0) {
    return `Range short ~${Math.round(c.rangeGapNm)} nm`;
  }
  // Shouldn't normally hit this branch — the candidate is in the blocker
  // set, so something failed. Be explicit so we notice if a new reason
  // sneaks in.
  return "Aircraft cannot fly this job";
}

export function computeJobFit(
  job: FitJobInput,
  ctx: JobFitContext,
): JobFit {
  const origin = ctx.airports.get(job.originIcao);
  const dest = ctx.airports.get(job.destinationIcao);
  const playerAp = ctx.airports.get(ctx.playerLocationIcao);
  const needsUnpaved =
    job.requiredCapabilities.includes("unpaved") ||
    (origin ? !origin.hasPavedRunway : false) ||
    (dest ? !dest.hasPavedRunway : false);

  const positioningDistance =
    playerAp && origin && ctx.playerLocationIcao !== job.originIcao
      ? haversineNm(playerAp, origin)
      : 0;

  // Build the candidate set. We only consider aircraft the player could
  // actually dispatch right now: owned aircraft sitting at the job origin,
  // owned aircraft sitting at the player's current airport (which would
  // ferry to the origin), and rentals at the player's current airport. An
  // owned aircraft stranded at a third airport isn't on the board's path —
  // a manual travel/ferry step is needed first, so it doesn't count toward
  // "is this job flyable now?".
  const candidates: Candidate[] = [];

  for (const owned of ctx.ownedAircraft) {
    if (!owned.isAvailable) continue;
    let source: Candidate["source"];
    let positioning = 0;
    if (owned.currentLocationIcao === job.originIcao) {
      source = "owned-at-origin";
    } else if (owned.currentLocationIcao === ctx.playerLocationIcao) {
      source = "owned-at-player";
      positioning = positioningDistance;
    } else {
      continue;
    }
    candidates.push(makeCandidate(owned, source, positioning, job, needsUnpaved, ctx));
  }

  for (const rental of ctx.rentalsAtPlayerLocation) {
    candidates.push(
      makeCandidate(rental, "rental", positioningDistance, job, needsUnpaved, ctx),
    );
  }

  if (candidates.length === 0) {
    // No owned anywhere we could dispatch from + no rentals at our airport.
    // Distinguish "no rating" from "no available aircraft of the class."
    if (!ctx.playerRatings[job.requiredClass]) {
      return locked(`Needs ${job.requiredClass} rating`);
    }
    return locked(`No ${job.requiredClass}-class aircraft available here`);
  }

  // Pass 1 — strict fit. An eligible candidate clears every check.
  const eligible = candidates.filter(
    (c) =>
      c.meetsRating &&
      c.meetsClass &&
      c.payloadGapLbs <= 0 &&
      c.rangeGapNm <= 0 &&
      c.passesUnpaved,
  );

  if (eligible.length > 0) {
    const ready = eligible.filter((c) => c.positioningDistanceNm === 0);
    if (ready.length > 0) {
      const best = chooseBestPositive(ready);
      const price = priceCandidate(job, best, ctx);
      return {
        status: "ready",
        reason: `${best.cls} ready at origin`,
        bestAircraftTypeId: best.typeId,
        bestCruiseSpeedKts: best.cruiseSpeedKts,
        positioningDistanceNm: null,
        payHourCents: price?.payHourCents ?? null,
        netPayHourCents: price?.netPayHourCents ?? null,
        fuelCostCents: price?.fuelCostCents ?? 0,
        rentalCostCents: price?.rentalCostCents ?? 0,
      };
    }
    const best = chooseBestPositive(eligible);
    const price = priceCandidate(job, best, ctx);
    return {
      status: "reposition",
      reason: `Reposition ${Math.round(best.positioningDistanceNm)} nm`,
      bestAircraftTypeId: best.typeId,
      bestCruiseSpeedKts: best.cruiseSpeedKts,
      positioningDistanceNm: Math.round(best.positioningDistanceNm),
      payHourCents: price?.payHourCents ?? null,
      netPayHourCents: price?.netPayHourCents ?? null,
      fuelCostCents: price?.fuelCostCents ?? 0,
      rentalCostCents: price?.rentalCostCents ?? 0,
    };
  }

  // Pass 2 — partial fit. The player has a rated, class-meeting aircraft
  // but it can't handle the payload / range / unpaved requirement. Surface
  // the smallest gap so the player knows whether they're 50 lb over or
  // need a whole new airframe.
  const partial = candidates.filter((c) => c.meetsRating && c.meetsClass);
  if (partial.length > 0) {
    // Pick the candidate with the smallest combined gap so the reason
    // chip names the most-fixable blocker.
    const best = [...partial].sort((a, b) => {
      const aGap = Math.max(0, a.payloadGapLbs) + Math.max(0, a.rangeGapNm);
      const bGap = Math.max(0, b.payloadGapLbs) + Math.max(0, b.rangeGapNm);
      return aGap - bGap;
    })[0]!;
    return {
      status: "wont_fit",
      reason: describeBlocker(best),
      bestAircraftTypeId: best.typeId,
      bestCruiseSpeedKts: best.cruiseSpeedKts,
      positioningDistanceNm: null,
      payHourCents: null,
      netPayHourCents: null,
      fuelCostCents: 0,
      rentalCostCents: 0,
    };
  }

  // Pass 3 — locked. No rated, class-meeting aircraft anywhere we can reach.
  if (!ctx.playerRatings[job.requiredClass]) {
    return locked(`Needs ${job.requiredClass} rating`);
  }
  return locked(`No ${job.requiredClass}-class aircraft available here`);
}

function makeCandidate(
  aircraft: {
    aircraftTypeId: string;
    cls: AircraftClass;
    rangeNm: number;
    cruiseSpeedKts: number;
    maxPayloadLbs: number;
    unpavedCapable: boolean;
    fuelBurnGph: number;
    fuelType: "avgas" | "jet-a";
    // Only present on rentals; owned aircraft pass 0.
    rentalRatePerHour?: number;
  },
  source: Candidate["source"],
  positioning: number,
  job: FitJobInput,
  needsUnpaved: boolean,
  ctx: JobFitContext,
): Candidate {
  const meetsRating = ctx.playerRatings[aircraft.cls] === true;
  const meetsClass =
    CLASS_RANK[aircraft.cls] >= CLASS_RANK[job.requiredClass];

  // Range gap: the aircraft has to cover the longest single leg with reserve.
  // Positioning is a separate flight (refuel at origin), so we compare the
  // max of (positioning, jobLeg) to range/reserve — same shape as the
  // eligibility check. For rentals doing a positioning leg, REPOSITION_
  // RESERVE_FACTOR is also enforced so we don't surface a rental that
  // reachability would reject. Whichever check is tighter wins.
  const jobLegLimit = job.distanceNm * RANGE_RESERVE_FACTOR;
  const positioningLimit =
    positioning > 0 ? positioning / REPOSITION_RESERVE_FACTOR : 0;
  const requiredRange = Math.max(jobLegLimit, positioningLimit);
  const rangeGap = requiredRange - aircraft.rangeNm;

  const payloadGap = job.payloadLbs - aircraft.maxPayloadLbs;
  const passesUnpaved = needsUnpaved ? aircraft.unpavedCapable : true;

  return {
    typeId: aircraft.aircraftTypeId,
    cls: aircraft.cls,
    cruiseSpeedKts: aircraft.cruiseSpeedKts,
    rangeNm: aircraft.rangeNm,
    maxPayloadLbs: aircraft.maxPayloadLbs,
    unpavedCapable: aircraft.unpavedCapable,
    positioningDistanceNm: positioning,
    source,
    payloadGapLbs: payloadGap,
    rangeGapNm: rangeGap,
    needsUnpaved,
    meetsRating,
    meetsClass,
    passesUnpaved,
    fuelBurnGph: aircraft.fuelBurnGph,
    fuelType: aircraft.fuelType,
    rentalRatePerHour: aircraft.rentalRatePerHour ?? 0,
  };
}

// Re-exported so the server's ferry-jobs branch (which doesn't go through the
// candidate machinery) can produce the same shape of $/hr breakdown without
// duplicating the pricing logic.
export { priceFerryLeg };

function locked(reason: string): JobFit {
  return {
    status: "locked",
    reason,
    bestAircraftTypeId: null,
    bestCruiseSpeedKts: null,
    positioningDistanceNm: null,
    payHourCents: null,
    netPayHourCents: null,
    fuelCostCents: 0,
    rentalCostCents: 0,
  };
}

// Recommended-job picker, exposed so the server can compute it next to the
// fit map (same data set). Returns the id of the highest pay/hr ready job
// at the player's current location with no urgent expiry; falls back to the
// best short-positioning reposition if nothing's at home.
export interface RecommendInput {
  id: number;
  originIcao: string;
  fit: JobFit;
  expiresAt: number;
  weatherSensitivity: "none" | "mild" | "strict";
}

const RECOMMEND_MIN_HORIZON_MS = 60 * 60 * 1000; // 1 hour
const RECOMMEND_MAX_POSITIONING_NM = 100;

// Sort key: prefer net pay/hr when known, fall back to gross. Gross still
// exists because computeJobFit can't price every fuel type at every airport
// (drift table cold-starts), and we'd rather score by something than skip a
// row that just happens to have a fuel-price gap.
function scoreRecommend(fit: JobFit): number {
  return fit.netPayHourCents ?? fit.payHourCents ?? 0;
}

export function pickRecommendedJobId(
  jobs: RecommendInput[],
  ctx: {
    playerLocationIcao: string;
    simNow: number;
    // When set, the recommendation switches to "future-arrival" mode: pick
    // the best job departing from this airport, ignoring current fit. The
    // job board uses this when the player is mid-flight so the rec answers
    // "what should I take after I land?" instead of "what can I take from
    // where I sit?" (which is a question they can't act on without first
    // aborting the active job).
    pivotOriginIcao?: string;
  },
): number | null {
  const safeHorizon = ctx.simNow + RECOMMEND_MIN_HORIZON_MS;

  if (ctx.pivotOriginIcao) {
    // Future-arrival mode. Fit-from-here is irrelevant; we're asking which
    // job parked at the future-arrival airport scores best. We can't compute
    // net pay/hr from that future origin (the rentals there may be
    // different), so scoring uses gross — caveat that the card will note.
    const candidates = jobs.filter(
      (j) =>
        j.originIcao === ctx.pivotOriginIcao &&
        j.expiresAt >= safeHorizon &&
        j.weatherSensitivity !== "strict" &&
        j.fit.status !== "locked",
    );
    if (candidates.length === 0) return null;
    return candidates.sort(
      (a, b) =>
        (b.fit.payHourCents ?? 0) - (a.fit.payHourCents ?? 0),
    )[0]!.id;
  }

  const ready = jobs.filter(
    (j) =>
      j.fit.status === "ready" &&
      j.originIcao === ctx.playerLocationIcao &&
      j.expiresAt >= safeHorizon &&
      j.weatherSensitivity !== "strict" &&
      j.fit.payHourCents != null,
  );
  if (ready.length > 0) {
    return ready.sort((a, b) => scoreRecommend(b.fit) - scoreRecommend(a.fit))[0]!
      .id;
  }
  const reposition = jobs.filter(
    (j) =>
      j.fit.status === "reposition" &&
      (j.fit.positioningDistanceNm ?? Infinity) <=
        RECOMMEND_MAX_POSITIONING_NM &&
      j.expiresAt >= safeHorizon &&
      j.weatherSensitivity !== "strict" &&
      j.fit.payHourCents != null,
  );
  if (reposition.length > 0) {
    return reposition.sort(
      (a, b) => scoreRecommend(b.fit) - scoreRecommend(a.fit),
    )[0]!.id;
  }
  return null;
}

import {
  ALL_CLIENTS,
  FERRY_VOICE_PROFILES,
  getClientById,
  type AircraftClass,
} from "@flightcareer/shared";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  flights,
  jobs,
  loans,
  maintenanceEvents,
  ownedAircraft,
  transfers,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlightLogRow {
  id: number;
  jobId: number | null;
  originIcao: string;
  destinationIcao: string;
  originName: string;
  destinationName: string;
  originLat: number | null;
  originLon: number | null;
  destinationLat: number | null;
  destinationLon: number | null;
  // Planned destination — present when the flight was tied to a job. If the
  // pilot diverted, this differs from the actual destinationIcao and gets
  // shown as a ghost route.
  plannedDestinationIcao: string | null;
  plannedDestinationName: string | null;
  plannedDestinationLat: number | null;
  plannedDestinationLon: number | null;
  startedAt: number;
  endedAt: number;
  blockTimeMinutes: number;
  fuelBurnedGal: number;
  totalCost: number;
  totalRevenue: number;
  netCents: number;
  notes: string | null;
  outcome: "completed" | "diverted" | "failed";
  aircraftSource: "owned" | "rental" | "ferry";
  aircraftLabel: string;
  aircraftClass: AircraftClass;
  aircraftTypeId: string;
  ownedAircraftId: number | null;
  clientName: string | null;
  clientId: string | null;
  jobRole: "bush" | "air_taxi" | "light_jet" | "open" | null;
  jobType: "standard" | "ferry";
  isDiversion: boolean;
  // AI-generated dispatcher acknowledgment, persisted with the flight row.
  // Null for older flights (before the feature) or when generation was skipped.
  dispatcherSignoff: {
    message: string;
    dispatcherName: string | null;
    sourceLabel: string | null;
  } | null;
}

export interface FlightFilters {
  limit?: number;
  offset?: number;
  filterByOwnedAircraftId?: number;
  filterByRentalAircraftTypeId?: string;
  filterByClientId?: string; // "open" for open market, otherwise client id
  filterByDateFrom?: number;
  filterByDateTo?: number;
}

export interface FinancialSummary {
  totalRevenue: number;
  totalCosts: number;
  totalNet: number;
  flightCount: number;
  byCategory: {
    flightRevenue: number;
    flightCosts: number;
    travelCosts: number;
    aircraftPurchases: number;
    aircraftSales: number;
    loanPayments: number;
    maintenanceCosts: number;
  };
  netOverTime: Array<{ simTime: number; cumulativeNet: number }>;
}

export interface MaintenanceLogRow {
  id: number;
  ownedAircraftId: number;
  aircraftLabel: string;
  type: "100hr" | "annual" | "overhaul" | "unscheduled";
  cost: number;
  startedAt: number;
  scheduledCompletionAt: number | null;
  completedAt: number | null;
  description: string;
  status: "in_progress" | "completed" | "cancelled";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientNameFromId(clientId: string | null): string | null {
  if (!clientId) return null;
  return getClientById(clientId)?.name ?? null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface FlightsResult {
  rows: FlightLogRow[];
  total: number;
}

export function getFlights(filters: FlightFilters = {}): FlightsResult {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const flightRows = db.select().from(flights).all();
  if (flightRows.length === 0) return { rows: [], total: 0 };

  const jobIds = flightRows
    .map((f) => f.jobId)
    .filter((id): id is number => id != null);
  const jobsById = new Map<number, typeof jobs.$inferSelect>();
  if (jobIds.length > 0) {
    for (const j of db.select().from(jobs).where(inArray(jobs.id, jobIds)).all()) {
      jobsById.set(j.id, j);
    }
  }

  const allAirports = db.select().from(airports).all();
  const airportByIcao = new Map(allAirports.map((a) => [a.icao, a]));

  const allTypes = db.select().from(aircraftTypes).all();
  const typeById = new Map(allTypes.map((t) => [t.id, t]));

  const allOwned = db.select().from(ownedAircraft).all();
  const ownedById = new Map(allOwned.map((o) => [o.id, o]));

  // Build full rows with computed fields, then filter in memory. Flight volume
  // is small for this app (single-player career), so this is fine.
  const built: FlightLogRow[] = flightRows.map((f) => {
    const job = f.jobId != null ? jobsById.get(f.jobId) ?? null : null;

    const ownedRow = f.ownedAircraftId != null ? ownedById.get(f.ownedAircraftId) ?? null : null;
    const isFerry = job?.jobType === "ferry";
    // Ferry flights have no owned row (someone else's aircraft), but we
    // persisted the rented type id at completion so the type lookup still
    // works. Treat them as their own source for the UI.
    const typeId =
      ownedRow?.aircraftTypeId ?? f.rentalAircraftTypeId ?? null;
    const typeRow = typeId ? typeById.get(typeId) ?? null : null;

    const aircraftSource: "owned" | "rental" | "ferry" =
      isFerry
        ? "ferry"
        : f.ownedAircraftId != null
          ? "owned"
          : "rental";

    const aircraftLabel = (() => {
      if (isFerry && job?.ferryAircraftTail && typeRow) {
        return `Ferry: ${job.ferryAircraftTail} · ${typeRow.manufacturer} ${typeRow.model}`;
      }
      if (ownedRow && typeRow) {
        return `${ownedRow.tailNumber} · ${typeRow.model}`;
      }
      if (typeRow) {
        return `Rental: ${typeRow.manufacturer} ${typeRow.model}`;
      }
      return "Unknown aircraft";
    })();

    const originAp = airportByIcao.get(f.originIcao);
    const destAp = airportByIcao.get(f.destinationIcao);

    const clientId = job?.clientId ?? null;
    const clientName = isFerry
      ? job?.ferryOwnerName ?? "Ferry"
      : clientId
        ? clientNameFromId(clientId)
        : job
          ? "Open Market"
          : null;

    const isDiversion =
      job != null && f.destinationIcao !== job.destinationIcao;

    const plannedAp = job ? airportByIcao.get(job.destinationIcao) : null;

    // Build the signoff payload (message + byline) the drawer renders.
    let dispatcherSignoff: FlightLogRow["dispatcherSignoff"] = null;
    if (f.dispatcherSignoff) {
      let dispatcherName: string | null = null;
      let sourceLabel: string | null = null;
      if (isFerry && job?.ferrySource && job.ferryOwnerName) {
        const profile = FERRY_VOICE_PROFILES[job.ferrySource];
        dispatcherName = profile.dispatcherTemplate.replace(
          "{ownerName}",
          job.ferryOwnerName,
        );
        sourceLabel =
          job.ferrySource === "owner" ? null : job.ferryOwnerName;
      } else if (clientId) {
        const def = getClientById(clientId);
        dispatcherName = def?.voice?.dispatcherName ?? null;
        sourceLabel = def?.name ?? null;
      } else if (job) {
        dispatcherName = "Anonymous broker";
      }
      dispatcherSignoff = {
        message: f.dispatcherSignoff,
        dispatcherName,
        sourceLabel,
      };
    }

    return {
      id: f.id,
      jobId: f.jobId,
      originIcao: f.originIcao,
      destinationIcao: f.destinationIcao,
      originName: originAp?.name ?? f.originIcao,
      destinationName: destAp?.name ?? f.destinationIcao,
      originLat: originAp?.lat ?? null,
      originLon: originAp?.lon ?? null,
      destinationLat: destAp?.lat ?? null,
      destinationLon: destAp?.lon ?? null,
      plannedDestinationIcao: job?.destinationIcao ?? null,
      plannedDestinationName: plannedAp?.name ?? null,
      plannedDestinationLat: plannedAp?.lat ?? null,
      plannedDestinationLon: plannedAp?.lon ?? null,
      startedAt: f.startedAt,
      endedAt: f.endedAt,
      blockTimeMinutes: f.blockTimeMinutes,
      fuelBurnedGal: f.fuelBurnedGal,
      totalCost: f.totalCost,
      totalRevenue: f.totalRevenue,
      netCents: f.totalRevenue - f.totalCost,
      notes: f.notes,
      outcome: f.outcome,
      aircraftSource,
      aircraftLabel,
      aircraftClass: (typeRow?.class ?? "SEP") as AircraftClass,
      aircraftTypeId: typeId ?? "",
      ownedAircraftId: f.ownedAircraftId,
      clientName,
      clientId,
      jobRole: job?.role ?? null,
      jobType: job?.jobType ?? "standard",
      isDiversion,
      dispatcherSignoff,
    };
  });

  const filtered = built.filter((row) => {
    if (filters.filterByOwnedAircraftId != null) {
      if (row.ownedAircraftId !== filters.filterByOwnedAircraftId) return false;
    }
    if (filters.filterByRentalAircraftTypeId) {
      if (
        row.aircraftSource !== "rental" ||
        row.aircraftTypeId !== filters.filterByRentalAircraftTypeId
      ) {
        return false;
      }
    }
    if (filters.filterByClientId) {
      if (filters.filterByClientId === "open") {
        if (row.clientId != null || row.jobId == null) return false;
      } else {
        if (row.clientId !== filters.filterByClientId) return false;
      }
    }
    if (filters.filterByDateFrom != null && row.startedAt < filters.filterByDateFrom) {
      return false;
    }
    if (filters.filterByDateTo != null && row.startedAt > filters.filterByDateTo) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => b.startedAt - a.startedAt);

  return {
    rows: filtered.slice(offset, offset + limit),
    total: filtered.length,
  };
}

export function getFinancialSummary(input?: {
  fromSimTime?: number;
  toSimTime?: number;
}): FinancialSummary {
  const from = input?.fromSimTime ?? 0;
  const to = input?.toSimTime ?? Number.MAX_SAFE_INTEGER;

  const flightRows = db
    .select()
    .from(flights)
    .where(and(gte(flights.startedAt, from), lte(flights.startedAt, to)))
    .orderBy(asc(flights.startedAt))
    .all();

  const transferRows = db
    .select()
    .from(transfers)
    .where(and(gte(transfers.executedAt, from), lte(transfers.executedAt, to)))
    .orderBy(asc(transfers.executedAt))
    .all();

  const ownedRows = db
    .select()
    .from(ownedAircraft)
    .where(
      and(
        gte(ownedAircraft.purchasedAt, from),
        lte(ownedAircraft.purchasedAt, to),
      ),
    )
    .all();

  // Cost is captured at booking time (status flips in_progress → completed
  // at the scheduled time, but cash already moved). We key off startedAt so
  // in-progress events show up in the spend tally immediately.
  const maintenanceRows = db
    .select()
    .from(maintenanceEvents)
    .where(
      and(
        gte(maintenanceEvents.startedAt, from),
        lte(maintenanceEvents.startedAt, to),
      ),
    )
    .all();

  const allLoans = db.select().from(loans).all();
  const loanByAircraftId = new Map(allLoans.map((l) => [l.ownedAircraftId, l]));

  let flightRevenue = 0;
  let flightCosts = 0;
  for (const f of flightRows) {
    flightRevenue += f.totalRevenue;
    flightCosts += f.totalCost;
  }

  let travelCosts = 0;
  for (const t of transferRows) {
    travelCosts += t.costCents;
  }

  // Cash outlay for aircraft purchases:
  //  - Cash purchase: full purchase price counted.
  //  - Financed: down payment (= purchase price - principal) counted here;
  //    monthly loan payments counted under loanPayments.
  let aircraftPurchases = 0;
  for (const o of ownedRows) {
    if (o.loanId == null) {
      aircraftPurchases += o.purchasePrice;
    } else {
      const loan = loanByAircraftId.get(o.id);
      if (loan) {
        aircraftPurchases += Math.max(0, o.purchasePrice - loan.principal);
      } else {
        aircraftPurchases += o.purchasePrice;
      }
    }
  }

  // Aircraft sales — gross proceeds (post-broker-spread) for any aircraft
  // sold in the window. Net to player is sale − loan payoff, but loan
  // payments are already accounted for separately, so we count gross here
  // to avoid double-discounting the loan retirement.
  const soldRows = db
    .select()
    .from(ownedAircraft)
    .where(
      and(
        gte(ownedAircraft.soldAt, from),
        lte(ownedAircraft.soldAt, to),
        eq(ownedAircraft.status, "sold"),
      ),
    )
    .all();
  let aircraftSales = 0;
  for (const o of soldRows) {
    aircraftSales += o.salePriceCents ?? 0;
  }

  let loanPayments = 0;
  for (const loan of allLoans) {
    loanPayments += loan.monthlyPayment * loan.paymentsMade;
  }

  let maintenanceCosts = 0;
  for (const m of maintenanceRows) {
    if (m.status === "cancelled") continue;
    maintenanceCosts += m.cost;
  }

  const totalRevenue = flightRevenue + aircraftSales;
  const totalCosts =
    flightCosts +
    travelCosts +
    aircraftPurchases +
    loanPayments +
    maintenanceCosts;
  const totalNet = totalRevenue - totalCosts;

  // Build cumulative net time series from flight + transfer events ordered by
  // sim time. Aircraft purchases / loan payments lack precise sim timestamps
  // for monthly events, so we keep the chart focused on operational flow.
  type Event = { simTime: number; delta: number };
  const events: Event[] = [];
  for (const f of flightRows) {
    events.push({ simTime: f.endedAt, delta: f.totalRevenue - f.totalCost });
  }
  for (const t of transferRows) {
    events.push({ simTime: t.executedAt, delta: -t.costCents });
  }
  events.sort((a, b) => a.simTime - b.simTime);
  let running = 0;
  const netOverTime = events.map((e) => {
    running += e.delta;
    return { simTime: e.simTime, cumulativeNet: running };
  });

  return {
    totalRevenue,
    totalCosts,
    totalNet,
    flightCount: flightRows.length,
    byCategory: {
      flightRevenue,
      flightCosts,
      travelCosts,
      aircraftPurchases,
      aircraftSales,
      loanPayments,
      maintenanceCosts,
    },
    netOverTime,
  };
}

export function getMaintenanceEvents(): MaintenanceLogRow[] {
  const rows = db
    .select({
      ev: maintenanceEvents,
      owned: ownedAircraft,
      type: aircraftTypes,
    })
    .from(maintenanceEvents)
    .leftJoin(
      ownedAircraft,
      eq(maintenanceEvents.ownedAircraftId, ownedAircraft.id),
    )
    .leftJoin(
      aircraftTypes,
      eq(ownedAircraft.aircraftTypeId, aircraftTypes.id),
    )
    .orderBy(desc(maintenanceEvents.startedAt))
    .all();

  return rows.map(({ ev, owned, type }) => ({
    id: ev.id,
    ownedAircraftId: ev.ownedAircraftId,
    aircraftLabel:
      owned && type
        ? `${owned.tailNumber} · ${type.model}`
        : owned
          ? owned.tailNumber
          : "Unknown aircraft",
    type: ev.type,
    cost: ev.cost,
    startedAt: ev.startedAt,
    scheduledCompletionAt: ev.scheduledCompletionAt,
    completedAt: ev.completedAt,
    description: ev.description,
    status: ev.status,
  }));
}

// ---------------------------------------------------------------------------
// Filter option helpers (for the UI dropdowns)
// ---------------------------------------------------------------------------

export interface FlightFilterOptions {
  aircraft: Array<{
    key: string; // "owned:<id>" or "rental:<typeId>"
    label: string;
    source: "owned" | "rental";
    ownedAircraftId: number | null;
    rentalAircraftTypeId: string | null;
  }>;
  clients: Array<{
    id: string; // client id, "open" for open-market
    name: string;
  }>;
}

export function getFlightFilterOptions(): FlightFilterOptions {
  const flightRows = db.select().from(flights).all();
  const allTypes = db.select().from(aircraftTypes).all();
  const typeById = new Map(allTypes.map((t) => [t.id, t]));
  const allOwned = db.select().from(ownedAircraft).all();
  const ownedById = new Map(allOwned.map((o) => [o.id, o]));

  const ownedKeys = new Set<number>();
  const rentalTypeKeys = new Set<string>();
  const clientIds = new Set<string>();
  let hasOpenMarketOrUnclientedJob = false;

  const allJobs = db.select().from(jobs).all();
  const jobsById = new Map(allJobs.map((j) => [j.id, j]));

  for (const f of flightRows) {
    if (f.ownedAircraftId != null) ownedKeys.add(f.ownedAircraftId);
    if (f.rentalAircraftTypeId) rentalTypeKeys.add(f.rentalAircraftTypeId);
    const job = f.jobId != null ? jobsById.get(f.jobId) : null;
    if (job) {
      if (job.clientId) clientIds.add(job.clientId);
      else hasOpenMarketOrUnclientedJob = true;
    }
  }

  const aircraft: FlightFilterOptions["aircraft"] = [];
  for (const id of ownedKeys) {
    const o = ownedById.get(id);
    const t = o ? typeById.get(o.aircraftTypeId) : null;
    if (!o) continue;
    aircraft.push({
      key: `owned:${id}`,
      label: t ? `${o.tailNumber} · ${t.model}` : o.tailNumber,
      source: "owned",
      ownedAircraftId: id,
      rentalAircraftTypeId: null,
    });
  }
  for (const tId of rentalTypeKeys) {
    const t = typeById.get(tId);
    if (!t) continue;
    aircraft.push({
      key: `rental:${tId}`,
      label: `Rental: ${t.manufacturer} ${t.model}`,
      source: "rental",
      ownedAircraftId: null,
      rentalAircraftTypeId: tId,
    });
  }
  aircraft.sort((a, b) => a.label.localeCompare(b.label));

  const clients: FlightFilterOptions["clients"] = [];
  for (const cId of clientIds) {
    const def = ALL_CLIENTS.find((c) => c.id === cId);
    if (def) clients.push({ id: def.id, name: def.name });
  }
  clients.sort((a, b) => a.name.localeCompare(b.name));
  if (hasOpenMarketOrUnclientedJob) {
    clients.push({ id: "open", name: "Open Market" });
  }

  return { aircraft, clients };
}

// ---------------------------------------------------------------------------
// Top-line stats (for the section header — visible across all tabs)
// ---------------------------------------------------------------------------

export interface LogbookHeadline {
  totalFlights: number;
  totalBlockMinutes: number;
  totalNetCents: number;
}

export function getLogbookHeadline(): LogbookHeadline {
  const rows = db.select().from(flights).all();
  let totalBlock = 0;
  let totalNet = 0;
  for (const f of rows) {
    totalBlock += f.blockTimeMinutes;
    totalNet += f.totalRevenue - f.totalCost;
  }
  return {
    totalFlights: rows.length,
    totalBlockMinutes: totalBlock,
    totalNetCents: totalNet,
  };
}

export function getFlightById(id: number): FlightLogRow | null {
  // Convenience for the drawer — reuse getFlights and filter, ensuring the row
  // gets the same enrichment.
  const result = getFlights({ limit: 100_000 });
  return result.rows.find((r) => r.id === id) ?? null;
}

// Career sim time helper exposed for UI date-range presets.
export function getSimNow(): number {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  return careerRow?.simDateTime ?? Date.now();
}

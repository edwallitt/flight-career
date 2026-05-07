import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  loans,
  maintenanceEvents,
  ownedAircraft,
  transfers,
} from "../../db/schema.js";
import {
  getCareer,
  insertFlight,
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import {
  getFinancialSummary,
  getFlightById,
  getFlightFilterOptions,
  getFlights,
  getLogbookHeadline,
  getMaintenanceEvents,
  getSimNow,
} from "../logbook.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

describe("getFlights", () => {
  beforeEach(() => resetTestDb());

  it("returns an empty result when there are no flights", () => {
    const result = getFlights();
    expect(result).toEqual({ rows: [], total: 0 });
  });

  it("enriches a flight row with airport names, aircraft label, and net cents", () => {
    const ac = insertOwnedAircraft({ tailNumber: "C-FONE" });
    const job = insertJob({ clientId: "maritime_cargo" });
    insertFlight({
      jobId: job.id,
      ownedAircraftId: ac.id,
      rentalAircraftTypeId: null,
      totalRevenue: 100_000,
      totalCost: 30_000,
    });

    const result = getFlights();
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.aircraftSource).toBe("owned");
    expect(row.aircraftLabel).toContain("C-FONE");
    expect(row.aircraftClass).toBe("SEP");
    expect(row.netCents).toBe(70_000);
    expect(row.originName).not.toBe(row.originIcao); // resolved to a real name
    expect(row.clientName).toBe("Maritime Cargo Express");
    expect(row.isDiversion).toBe(false);
  });

  it("marks isDiversion=true when actual destination differs from job's planned", () => {
    const ac = insertOwnedAircraft();
    const job = insertJob({ destinationIcao: "CYCH" });
    insertFlight({
      jobId: job.id,
      ownedAircraftId: ac.id,
      rentalAircraftTypeId: null,
      destinationIcao: "CYQM",
    });
    const row = getFlights().rows[0]!;
    expect(row.isDiversion).toBe(true);
    expect(row.plannedDestinationIcao).toBe("CYCH");
    expect(row.destinationIcao).toBe("CYQM");
  });

  it("rental flight: aircraftSource='rental', label includes the rental type", () => {
    insertFlight({ rentalAircraftTypeId: "bonanza_g36" });
    const row = getFlights().rows[0]!;
    expect(row.aircraftSource).toBe("rental");
    expect(row.aircraftLabel.toLowerCase()).toContain("rental");
    expect(row.ownedAircraftId).toBeNull();
  });

  it("orders newest-first by startedAt", () => {
    const start = getCareer().simDateTime;
    insertFlight({ startedAt: start, endedAt: start + 60 * 60_000 });
    insertFlight({
      startedAt: start + 2 * 60 * 60_000,
      endedAt: start + 3 * 60 * 60_000,
    });
    insertFlight({
      startedAt: start + 60 * 60_000,
      endedAt: start + 2 * 60 * 60_000,
    });
    const rows = getFlights().rows;
    expect(rows).toHaveLength(3);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.startedAt).toBeLessThanOrEqual(rows[i - 1]!.startedAt);
    }
  });

  it("paginates with limit + offset; total stays equal to the unpaged filter result", () => {
    const start = getCareer().simDateTime;
    for (let i = 0; i < 5; i++) {
      insertFlight({
        startedAt: start + i * 60 * 60_000,
        endedAt: start + (i + 1) * 60 * 60_000,
      });
    }
    const page1 = getFlights({ limit: 2, offset: 0 });
    const page2 = getFlights({ limit: 2, offset: 2 });
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    // Disjoint pages.
    const ids1 = new Set(page1.rows.map((r) => r.id));
    const ids2 = new Set(page2.rows.map((r) => r.id));
    for (const id of ids1) expect(ids2.has(id)).toBe(false);
  });

  it("filters by ownedAircraftId", () => {
    const a = insertOwnedAircraft({ tailNumber: "C-FONE" });
    const b = insertOwnedAircraft({ tailNumber: "C-FTWO" });
    insertFlight({ ownedAircraftId: a.id, rentalAircraftTypeId: null });
    insertFlight({ ownedAircraftId: b.id, rentalAircraftTypeId: null });

    const result = getFlights({ filterByOwnedAircraftId: a.id });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.ownedAircraftId).toBe(a.id);
  });

  it("filters by clientId — only flights for that client are returned", () => {
    const cargoJob = insertJob({ clientId: "maritime_cargo" });
    const otherJob = insertJob({ clientId: "northern_outfitters" });
    insertFlight({ jobId: cargoJob.id });
    insertFlight({ jobId: otherJob.id });

    const cargoResult = getFlights({ filterByClientId: "maritime_cargo" });
    expect(cargoResult.rows).toHaveLength(1);
    expect(cargoResult.rows[0]!.clientId).toBe("maritime_cargo");
  });

  it("filters by date range (filterByDateFrom / filterByDateTo)", () => {
    const start = getCareer().simDateTime;
    insertFlight({ startedAt: start });
    insertFlight({ startedAt: start + 5 * SIM_DAY_MS });
    insertFlight({ startedAt: start + 10 * SIM_DAY_MS });

    const result = getFlights({
      filterByDateFrom: start + 1,
      filterByDateTo: start + 6 * SIM_DAY_MS,
    });
    expect(result.rows).toHaveLength(1);
  });
});

describe("getFlightById", () => {
  beforeEach(() => resetTestDb());

  it("returns the enriched row for an existing flight id", () => {
    const ac = insertOwnedAircraft();
    const f = insertFlight({ ownedAircraftId: ac.id, rentalAircraftTypeId: null });
    const detail = getFlightById(f.id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(f.id);
    expect(detail!.aircraftLabel).toContain(ac.tailNumber);
  });

  it("returns null for an unknown id", () => {
    expect(getFlightById(99999)).toBeNull();
  });
});

describe("getLogbookHeadline", () => {
  beforeEach(() => resetTestDb());

  it("aggregates flight count, total block minutes, and total net cents", () => {
    insertFlight({
      blockTimeMinutes: 60,
      totalCost: 1000,
      totalRevenue: 50_000,
    });
    insertFlight({
      blockTimeMinutes: 90,
      totalCost: 2000,
      totalRevenue: 80_000,
    });

    const headline = getLogbookHeadline();
    expect(headline.totalFlights).toBe(2);
    expect(headline.totalBlockMinutes).toBe(150);
    expect(headline.totalNetCents).toBe(50_000 - 1000 + 80_000 - 2000);
  });

  it("returns zeros for an empty logbook", () => {
    expect(getLogbookHeadline()).toEqual({
      totalFlights: 0,
      totalBlockMinutes: 0,
      totalNetCents: 0,
    });
  });
});

describe("getFinancialSummary", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("rolls up flight revenue and costs", () => {
    insertFlight({ totalRevenue: 100_000, totalCost: 20_000 });
    insertFlight({ totalRevenue: 50_000, totalCost: 10_000 });
    const sum = getFinancialSummary();
    expect(sum.flightCount).toBe(2);
    expect(sum.byCategory.flightRevenue).toBe(150_000);
    expect(sum.byCategory.flightCosts).toBe(30_000);
  });

  it("includes transfer costs under travelCosts", () => {
    const now = getCareer().simDateTime;
    db.insert(transfers)
      .values({
        type: "pilot",
        originIcao: "CYHZ",
        destinationIcao: "CYQM",
        ownedAircraftId: null,
        distanceNm: 140,
        costCents: 25_000,
        simTimeAdvancedMinutes: 90,
        aircraftHoursAccrued: 0,
        fuelGallonsBurned: 0,
        executedAt: now,
      })
      .run();

    const sum = getFinancialSummary();
    expect(sum.byCategory.travelCosts).toBe(25_000);
  });

  it("counts down payment under aircraftPurchases for financed aircraft", () => {
    const ac = insertOwnedAircraft();
    // Mark it as financed: principal $80k, purchase price $100k → down payment $20k.
    const now = getCareer().simDateTime;
    const loanInsert = db
      .insert(loans)
      .values({
        ownedAircraftId: ac.id,
        principal: 80_000_00,
        remainingBalance: 80_000_00,
        monthlyPayment: 1_500_00,
        interestRateBps: 600,
        nextPaymentDue: now + 30 * SIM_DAY_MS,
        termMonths: 60,
        originalTermMonths: 60,
        paymentsMade: 0,
      })
      .run();
    const loanId = Number(loanInsert.lastInsertRowid);
    db.update(ownedAircraft)
      .set({ purchasePrice: 100_000_00, loanId })
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const sum = getFinancialSummary();
    expect(sum.byCategory.aircraftPurchases).toBe(20_000_00);
  });

  it("counts maintenance cost regardless of completion status (skips cancelled)", () => {
    const ac = insertOwnedAircraft();
    const now = getCareer().simDateTime;
    db.insert(maintenanceEvents)
      .values([
        {
          ownedAircraftId: ac.id,
          type: "100hr",
          cost: 5_000_00,
          startedAt: now,
          scheduledCompletionAt: now + SIM_DAY_MS,
          completedAt: null,
          description: "100hr",
          status: "in_progress",
        },
        {
          ownedAircraftId: ac.id,
          type: "annual",
          cost: 12_000_00,
          startedAt: now,
          scheduledCompletionAt: null,
          completedAt: null,
          description: "annual cancelled",
          status: "cancelled",
        },
      ])
      .run();
    const sum = getFinancialSummary();
    expect(sum.byCategory.maintenanceCosts).toBe(5_000_00); // cancelled excluded
  });

  it("respects the fromSimTime/toSimTime window", () => {
    const start = getCareer().simDateTime;
    insertFlight({ startedAt: start, totalRevenue: 10, totalCost: 0 });
    insertFlight({
      startedAt: start + 30 * SIM_DAY_MS,
      totalRevenue: 100,
      totalCost: 0,
    });

    const all = getFinancialSummary();
    expect(all.byCategory.flightRevenue).toBe(110);

    const recent = getFinancialSummary({ fromSimTime: start + SIM_DAY_MS });
    expect(recent.byCategory.flightRevenue).toBe(100);
  });

  it("emits a chronological cumulative-net series from flights and transfers", () => {
    const start = getCareer().simDateTime;
    insertFlight({
      startedAt: start,
      endedAt: start + 60 * 60_000,
      totalRevenue: 50_000,
      totalCost: 10_000,
    });
    insertFlight({
      startedAt: start + 24 * 60 * 60_000,
      endedAt: start + 25 * 60 * 60_000,
      totalRevenue: 30_000,
      totalCost: 5_000,
    });

    const sum = getFinancialSummary();
    expect(sum.netOverTime).toHaveLength(2);
    // Sorted ascending by simTime, and cumulativeNet is monotonically built.
    expect(sum.netOverTime[0]!.simTime).toBeLessThan(sum.netOverTime[1]!.simTime);
    expect(sum.netOverTime[0]!.cumulativeNet).toBe(40_000);
    expect(sum.netOverTime[1]!.cumulativeNet).toBe(40_000 + 25_000);
  });
});

describe("getMaintenanceEvents", () => {
  beforeEach(() => resetTestDb());

  it("returns events newest-first with aircraft labels resolved", () => {
    const ac = insertOwnedAircraft({ tailNumber: "C-FONE" });
    const now = getCareer().simDateTime;
    db.insert(maintenanceEvents)
      .values([
        {
          ownedAircraftId: ac.id,
          type: "100hr",
          cost: 5_000_00,
          startedAt: now - SIM_DAY_MS,
          scheduledCompletionAt: now,
          completedAt: now,
          description: "old",
          status: "completed",
        },
        {
          ownedAircraftId: ac.id,
          type: "annual",
          cost: 12_000_00,
          startedAt: now,
          scheduledCompletionAt: now + 5 * SIM_DAY_MS,
          completedAt: null,
          description: "new",
          status: "in_progress",
        },
      ])
      .run();

    const rows = getMaintenanceEvents();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.description).toBe("new"); // newest first
    expect(rows[0]!.aircraftLabel).toContain("C-FONE");
  });
});

describe("getFlightFilterOptions", () => {
  beforeEach(() => resetTestDb());

  it("returns owned + rental aircraft and the clients that have logged flights", () => {
    const owned = insertOwnedAircraft({ tailNumber: "C-FOWN" });
    const job = insertJob({ clientId: "maritime_cargo" });
    insertFlight({ ownedAircraftId: owned.id, jobId: job.id, rentalAircraftTypeId: null });
    insertFlight({ rentalAircraftTypeId: "bonanza_g36" });

    const opts = getFlightFilterOptions();
    expect(opts.aircraft).toHaveLength(2);
    expect(opts.aircraft.some((a) => a.source === "owned")).toBe(true);
    expect(opts.aircraft.some((a) => a.source === "rental")).toBe(true);
    expect(opts.clients.some((c) => c.id === "maritime_cargo")).toBe(true);
  });

  it("returns empty arrays when there are no flights", () => {
    expect(getFlightFilterOptions()).toEqual({ aircraft: [], clients: [] });
  });
});

describe("getSimNow", () => {
  beforeEach(() => resetTestDb());

  it("returns the career sim time when present", () => {
    expect(getSimNow()).toBe(getCareer().simDateTime);
  });
});

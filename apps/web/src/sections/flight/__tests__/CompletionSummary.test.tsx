import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// RouteMap mounts a real maplibre map; replace it with a placeholder.
vi.mock("../../../components/map/RouteMap.js", () => ({
  RouteMap: () => <div data-testid="route-map" />,
}));

import {
  CompletionSummary,
  type CompletionSummaryData,
} from "../CompletionSummary.js";

function makeSummary(overrides: Partial<CompletionSummaryData> = {}): CompletionSummaryData {
  const base: CompletionSummaryData = {
    finalPay: 50_000,
    diversionAdjustment: 0,
    destinationLandingFee: 1_000,
    rentalCost: 0,
    destinationRefuelCost: 0,
    grossRevenue: 50_000,
    totalCosts: 6_000, // 5_000 fuel + 1_000 landing
    netCashDelta: 44_000,
    reputationDeltas: [
      { scope: "bush", delta: 2 },
      { scope: "client:maritime_cargo", delta: 3 },
    ],
    aircraftUpdates: {
      blockHoursAdded: 1.25,
      fuelBurnedGalDelta: 17.4,
      fuelRefilledGalDelta: 0,
      newLocationIcao: "CYQM",
    },
    newLocationIcao: "CYQM",
    flightLogEntry: {
      originIcao: "CYHZ",
      destinationIcao: "CYQM",
      blockTimeMinutes: 75,
      fuelBurnedGal: 17.4,
      totalCost: 6_000,
      totalRevenue: 50_000,
      notes: null,
    },
    summaryLines: [],
    flightId: 101,
    inspectionAlerts: [],
    cashAppliedNow: 44_000,
    unscheduledEvent: null,
    insuranceClaim: null,
    dispatcherSignoff: null,
    route: {
      originIcao: "CYHZ",
      originName: "Halifax Stanfield Intl",
      originLat: 44.88,
      originLon: -63.51,
      actualIcao: "CYQM",
      actualName: "Greater Moncton Intl",
      actualLat: 46.11,
      actualLon: -64.68,
      plannedIcao: "CYQM",
      plannedName: "Greater Moncton Intl",
      plannedLat: 46.11,
      plannedLon: -64.68,
      isDiversion: false,
    },
    ...overrides,
  };
  return base;
}

describe("CompletionSummary — banner classification", () => {
  it("shows 'Job complete' for a clean delivery", () => {
    render(<CompletionSummary summary={makeSummary()} onClose={() => {}} />);
    expect(screen.getByText(/Job complete/i)).toBeInTheDocument();
  });

  it("shows 'Diverted' when diversionAdjustment is negative", () => {
    render(
      <CompletionSummary
        summary={makeSummary({
          finalPay: 45_000,
          diversionAdjustment: -5_000,
          route: {
            ...makeSummary().route,
            isDiversion: true,
            actualIcao: "CYCH",
            plannedIcao: "CYQM",
          },
        })}
        onClose={() => {}}
      />,
    );
    // Banner label "Diverted" is uppercase via tracking-callsign; the lower
    // route note "diverted from CYQM" matches the same regex, so we just
    // check both substrings show up by counting matches.
    expect(screen.getAllByText(/Diverted/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/diverted from CYQM/i)).toBeInTheDocument();
  });

  it("shows 'Failed delivery' when finalPay is zero", () => {
    render(
      <CompletionSummary
        summary={makeSummary({ finalPay: 0, grossRevenue: 0 })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Failed delivery/i)).toBeInTheDocument();
  });
});

describe("CompletionSummary — header + route", () => {
  it("renders origin/destination ICAOs and block time", () => {
    render(<CompletionSummary summary={makeSummary()} onClose={() => {}} />);
    // ICAOs appear in the route block; both are present.
    expect(screen.getAllByText("CYHZ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CYQM").length).toBeGreaterThan(0);
    expect(screen.getByText(/Block time 1h 15m/i)).toBeInTheDocument();
    expect(screen.getByText(/17\.4 gal burned/i)).toBeInTheDocument();
  });

  it("clicking Close fires onClose", async () => {
    const onClose = vi.fn();
    render(<CompletionSummary summary={makeSummary()} onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key fires onClose", async () => {
    const onClose = vi.fn();
    render(<CompletionSummary summary={makeSummary()} onClose={onClose} />);
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("CompletionSummary — receipt lines", () => {
  it("hides cost lines that are zero (rental, refuel-at-dest) and shows fuel pre-paid", () => {
    render(
      <CompletionSummary
        summary={makeSummary({
          flightLogEntry: {
            ...makeSummary().flightLogEntry,
            totalCost: 6_000, // 5_000 fuel + 1_000 landing
          },
          destinationLandingFee: 1_000,
          rentalCost: 0,
          destinationRefuelCost: 0,
        })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Fuel \(pre-paid\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Landing fee/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Rental$/i)).toBeNull();
    expect(screen.queryByText(/^Refuel at dest$/i)).toBeNull();
  });

  it("shows Rental and Refuel-at-dest lines when those costs apply", () => {
    render(
      <CompletionSummary
        summary={makeSummary({
          flightLogEntry: {
            ...makeSummary().flightLogEntry,
            totalCost: 30_000,
          },
          destinationLandingFee: 1_000,
          rentalCost: 12_000,
          destinationRefuelCost: 4_000,
        })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/^Rental$/i)).toBeInTheDocument();
    expect(screen.getByText(/Refuel at dest/i)).toBeInTheDocument();
  });

  it("shows the unscheduled-maintenance cost line when an event is present", () => {
    render(
      <CompletionSummary
        summary={makeSummary({
          unscheduledEvent: {
            eventId: 7,
            riskTier: "elevated",
            severity: "moderate",
            costCents: 250_00,
            groundedDays: 2,
            description: "Magneto failure on shutdown",
            causeFactors: ["overdue-100hr"],
            scheduledCompletionAt: null,
          },
        })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Unscheduled maint\./i)).toBeInTheDocument();
    expect(screen.getByText(/Magneto failure on shutdown/i)).toBeInTheDocument();
  });
});

describe("CompletionSummary — reputation + alerts", () => {
  it("renders a row per reputation delta, with role and per-client labels", () => {
    render(
      <CompletionSummary
        summary={makeSummary({
          reputationDeltas: [
            { scope: "bush", delta: 2 },
            { scope: "client:maritime_cargo", delta: 3 },
            { scope: "air_taxi", delta: -1 },
          ],
        })}
        onClose={() => {}}
      />,
    );
    // The row component renders both a "+2" / "-1" badge and the scope label.
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("falls back to 'No reputation change' when the deltas array is empty", () => {
    render(
      <CompletionSummary
        summary={makeSummary({ reputationDeltas: [] })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/No reputation change/i)).toBeInTheDocument();
  });

  it("renders the maintenance-alert block when inspection lines exist", () => {
    render(
      <CompletionSummary
        summary={makeSummary({
          inspectionAlerts: [
            "100-hour inspection due in 4 hours",
            "Annual due in 12 days",
          ],
        })}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText(/100-hour inspection due in 4 hours/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Annual due in 12 days/)).toBeInTheDocument();
  });

  it("hides the aircraft-impact card when aircraftUpdates is null (rental flights)", () => {
    render(
      <CompletionSummary
        summary={makeSummary({ aircraftUpdates: null })}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/Hours added/i)).toBeNull();
  });
});

describe("CompletionSummary — dispatcher sign-off", () => {
  it("renders the dispatcher sign-off card when present", () => {
    render(
      <CompletionSummary
        summary={makeSummary({
          dispatcherSignoff: {
            message: "Cargo received, harbour master is happy. Nice job.",
            dispatcherName: "Mary",
            sourceLabel: "Maritime Cargo Express",
          },
        })}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText(/Cargo received, harbour master is happy/),
    ).toBeInTheDocument();
  });

  it("omits the sign-off card when not present", () => {
    render(<CompletionSummary summary={makeSummary()} onClose={() => {}} />);
    // No "Sign-off" / "Dispatcher" label appears at all.
    expect(screen.queryByText(/Sign-off/i)).toBeNull();
  });
});

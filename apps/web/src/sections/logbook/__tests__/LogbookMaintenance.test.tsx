import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { LogbookMaintenance } from "../LogbookMaintenance.js";

const SIM_NOW = Date.UTC(2026, 4, 12, 12, 0);

function makeRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    ownedAircraftId: 5,
    aircraftLabel: "C-FONE · Bonanza G36",
    type: "100hr",
    cost: 90_000,
    startedAt: SIM_NOW - 30 * 86_400_000,
    scheduledCompletionAt: null,
    completedAt: SIM_NOW - 29 * 86_400_000,
    description: "Routine inspection",
    status: "completed",
    ...overrides,
  };
}

describe("LogbookMaintenance", () => {
  it("shows 'loading…' while the query is pending", () => {
    renderWithProviders(<LogbookMaintenance />);
    expect(screen.getByText(/^loading…$/i)).toBeInTheDocument();
  });

  it("renders the empty-state when there are no rows", () => {
    renderWithProviders(<LogbookMaintenance />, {
      seed: ({ seedQuery }) => {
        seedQuery(["logbook", "maintenance"], []);
      },
    });
    expect(
      screen.getByText(/No maintenance events recorded/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Module · MNT/i)).toBeInTheDocument();
  });

  it("renders a table row per maintenance event with aircraft label, type, and cost", () => {
    renderWithProviders(<LogbookMaintenance />, {
      seed: ({ seedQuery }) => {
        seedQuery(["logbook", "maintenance"], [
          makeRow({ id: 1, type: "100hr", cost: 90_000 }),
          makeRow({
            id: 2,
            type: "annual",
            cost: 250_000,
            description: "Annual inspection",
          }),
          makeRow({
            id: 3,
            type: "overhaul",
            cost: 3_500_000,
            description: "Engine overhaul",
          }),
          makeRow({
            id: 4,
            type: "unscheduled",
            cost: 75_000,
            description: "Magneto failure",
            status: "in_progress",
          }),
        ]);
      },
    });
    // Type chips
    expect(screen.getByText("100-hour")).toBeInTheDocument();
    expect(screen.getByText("Annual")).toBeInTheDocument();
    expect(screen.getByText("Overhaul")).toBeInTheDocument();
    expect(screen.getByText("Unscheduled")).toBeInTheDocument();

    // Aircraft label appears in every row (4 rows).
    expect(screen.getAllByText(/C-FONE · Bonanza G36/).length).toBe(4);

    // Cost cells render with a minus sign (deducted).
    expect(screen.getByText("−$900")).toBeInTheDocument();
    expect(screen.getByText("−$2,500")).toBeInTheDocument();
    expect(screen.getByText("−$35,000")).toBeInTheDocument();
    expect(screen.getByText("−$750")).toBeInTheDocument();
  });

  it("renders status chips for each lifecycle state", () => {
    renderWithProviders(<LogbookMaintenance />, {
      seed: ({ seedQuery }) => {
        seedQuery(["logbook", "maintenance"], [
          makeRow({ id: 1, status: "in_progress" }),
          makeRow({ id: 2, status: "completed" }),
          makeRow({ id: 3, status: "cancelled" }),
        ]);
      },
    });
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});

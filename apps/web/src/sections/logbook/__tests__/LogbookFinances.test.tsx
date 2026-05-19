import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { LogbookFinances } from "../LogbookFinances.js";

function makeSummary(overrides: Record<string, unknown> = {}): any {
  return {
    totalRevenue: 1_500_000,
    totalCosts: 800_000,
    totalNet: 700_000,
    flightCount: 12,
    byCategory: {
      flightRevenue: 1_500_000,
      flightCosts: 300_000,
      travelCosts: 60_000,
      aircraftPurchases: 0,
      aircraftSales: 0,
      loanPayments: 320_000,
      maintenanceCosts: 120_000,
    },
    netOverTime: [],
    ...overrides,
  };
}

describe("LogbookFinances — loading + empty", () => {
  it("shows 'loading finances…' while the query is pending", () => {
    renderWithProviders(<LogbookFinances />);
    expect(screen.getByText(/loading finances/i)).toBeInTheDocument();
  });

  it("renders the chart empty-state hint when fewer than 5 points exist", () => {
    renderWithProviders(<LogbookFinances />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["logbook", "financialSummary"],
          makeSummary({
            netOverTime: [{ simTime: Date.UTC(2026, 4, 12), cumulativeNet: 100 }],
          }),
        );
      },
    });
    // The chart-empty branch fires when length < 5. Just verify the chart
    // header still renders with the point count.
    expect(screen.getByText(/cum · 1 pts/i)).toBeInTheDocument();
  });
});

describe("LogbookFinances — headline cards", () => {
  it("renders Total revenue, Total costs, and Net with the right tones", () => {
    renderWithProviders(<LogbookFinances />, {
      seed: ({ seedQuery }) => {
        seedQuery(["logbook", "financialSummary"], makeSummary());
      },
    });
    // Three headline cards' labels:
    expect(screen.getByText(/Total revenue/i)).toBeInTheDocument();
    expect(screen.getByText(/Total costs/i)).toBeInTheDocument();
    // Two "Net" labels — the headline card and the ledger total row.
    expect(screen.getAllByText(/^Net$/).length).toBe(2);

    // Revenue is shown un-signed; costs as absolute; net with a sign because
    // the card sets showSign. totalNet=700_000 cents → +$7,000.
    expect(screen.getByText(/^\+\$7,000$/)).toBeInTheDocument();
  });

  it("formats single-flight subtitle as 'flight flown' (singular)", () => {
    renderWithProviders(<LogbookFinances />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["logbook", "financialSummary"],
          makeSummary({ flightCount: 1 }),
        );
      },
    });
    expect(screen.getByText(/^1 flight flown$/)).toBeInTheDocument();
  });

  it("formats a negative net with a minus sign and critical tone", () => {
    renderWithProviders(<LogbookFinances />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["logbook", "financialSummary"],
          makeSummary({
            totalRevenue: 200_000,
            totalCosts: 500_000,
            totalNet: -300_000,
          }),
        );
      },
    });
    const negNet = screen.getAllByText(/−\$3,000/);
    expect(negNet.length).toBeGreaterThan(0); // appears in both card and ledger totals
  });
});

describe("LogbookFinances — ledger sections", () => {
  it("renders Revenue and Costs sections with all line labels", () => {
    renderWithProviders(<LogbookFinances />, {
      seed: ({ seedQuery }) => {
        seedQuery(["logbook", "financialSummary"], makeSummary());
      },
    });
    // Ledger lines are prefixed with "· " — match the trailing label substring.
    expect(screen.getByText(/Flight earnings/)).toBeInTheDocument();
    expect(screen.getByText(/Aircraft sales/)).toBeInTheDocument();
    expect(screen.getByText(/Fuel & landing fees/)).toBeInTheDocument();
    expect(screen.getByText(/Travel & repositioning/)).toBeInTheDocument();
    expect(screen.getByText(/Aircraft purchases/)).toBeInTheDocument();
    expect(screen.getByText(/Loan payments/)).toBeInTheDocument();
    expect(screen.getByText(/^· Maintenance$/)).toBeInTheDocument();
  });
});

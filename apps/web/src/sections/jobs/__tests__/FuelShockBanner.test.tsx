import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { FuelShockBanner } from "../FuelShockBanner.js";

function makeHeadline(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: "refinery_outage",
    severity: "moderate",
    multiplier: 1.25,
    affectsFuelType: "both",
    affectsRegion: "global",
    ticksRemaining: 12,
    startedAt: Date.UTC(2026, 4, 11),
    headline: "Refinery outage — fuel prices up ~25% globally",
    description: "Supply tight until product flows resume.",
    ...overrides,
  };
}

describe("FuelShockBanner", () => {
  it("renders nothing when there is no headline shock", () => {
    const { container } = renderWithProviders(<FuelShockBanner />, {
      seed: ({ seedQuery }) => {
        seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the shock headline and a multi-day countdown", () => {
    renderWithProviders(<FuelShockBanner />, {
      seed: ({ seedQuery }) => {
        seedQuery(["fuel", "activeShocks"], {
          shocks: [makeHeadline()],
          headline: makeHeadline({ ticksRemaining: 12 }), // 3 days
        });
      },
    });
    expect(screen.getByText(/Fuel shock/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Refinery outage — fuel prices up ~25% globally/),
    ).toBeInTheDocument();
    expect(screen.getByText("3.0 sim days remaining")).toBeInTheDocument();
  });

  it("uses the sub-day label when fewer than 4 ticks remain", () => {
    renderWithProviders(<FuelShockBanner />, {
      seed: ({ seedQuery }) => {
        seedQuery(["fuel", "activeShocks"], {
          shocks: [makeHeadline()],
          headline: makeHeadline({ ticksRemaining: 2 }), // 0.5 days
        });
      },
    });
    expect(
      screen.getByText("less than a sim day remaining"),
    ).toBeInTheDocument();
  });
});

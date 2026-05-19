import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { Marketplace } from "../Marketplace.js";

/**
 * MarketTable accesses a wide slice of `EnrichedListing`. We satisfy it with a
 * generous factory; the precise type from the server pulls in shared enums we
 * don't import here, so we cast through `any`.
 */
function makeListing(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    aircraftTypeId: "bonanza_g36",
    aircraftTypeManufacturer: "Beechcraft",
    aircraftTypeModel: "Bonanza G36",
    aircraftClass: "SEP",
    tailNumber: "C-FONE",
    locationIcao: "CYHZ",
    locationName: "Halifax Stanfield Intl",
    airframeHours: 2000,
    engineHoursSinceOverhaul: 400,
    engineRemainingHours: 1600,
    tboHours: 2000,
    hoursSince100hr: 30,
    hoursSinceAnnual: 90,
    conditionGrade: "good",
    askingPriceCents: 350_000_00,
    basePurchasePriceCents: 500_000_00,
    depreciationFactor: 0.7,
    distanceFromPlayerNm: 120,
    descriptionShort: "Clean SEP, fresh annual.",
    listedAt: Date.UTC(2026, 4, 1),
    expiresAt: Date.UTC(2026, 4, 30),
    fuelCapacityGal: 80,
    fuelType: "avgas",
    cruiseSpeedKts: 176,
    fuelBurnGph: 17,
    rentalRatePerHour: 0,
    hangarageMonthly: 30_000,
    insuranceMonthly: 25_000,
    hundredHourCost: 90_000,
    ...overrides,
  };
}

const PLAYER_LOC = "CYHZ";

// listings query input used by Marketplace at default state (any class, any
// price, default sort=distance → "distance_asc"). The query-key seed must
// match the input shape exactly or react-query treats it as a different key.
const DEFAULT_LISTINGS_INPUT = {
  filterByClass: undefined,
  maxPriceCents: undefined,
  sortBy: "distance_asc" as const,
};

describe("Marketplace — header + structure", () => {
  it("renders the page header and filter chips", () => {
    renderWithProviders(<Marketplace />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["marketplace", "listings"],
          { listings: [], playerLocationIcao: PLAYER_LOC },
          { input: DEFAULT_LISTINGS_INPUT },
        );
      },
    });
    expect(screen.getByText(/Aircraft Marketplace/i)).toBeInTheDocument();
    // MarketFilters has the class chips.
    expect(screen.getByRole("button", { name: "Any" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SEP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JET" })).toBeInTheDocument();
  });
});

describe("Marketplace — table states", () => {
  it("shows the empty-state when no listings are returned", () => {
    renderWithProviders(<Marketplace />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["marketplace", "listings"],
          { listings: [], playerLocationIcao: PLAYER_LOC },
          { input: DEFAULT_LISTINGS_INPUT },
        );
      },
    });
    expect(
      screen.getByText(/No listings match your filters/i),
    ).toBeInTheDocument();
  });

  it("renders one row per listing with aircraft label and tail number", () => {
    renderWithProviders(<Marketplace />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["marketplace", "listings"],
          {
            listings: [
              makeListing({ id: 1, tailNumber: "C-FONE" }),
              makeListing({
                id: 2,
                tailNumber: "C-FTWO",
                aircraftTypeManufacturer: "Cessna",
                aircraftTypeModel: "172",
                askingPriceCents: 150_000_00,
              }),
            ],
            playerLocationIcao: PLAYER_LOC,
          },
          { input: DEFAULT_LISTINGS_INPUT },
        );
      },
    });
    expect(screen.getByText("C-FONE")).toBeInTheDocument();
    expect(screen.getByText("C-FTWO")).toBeInTheDocument();
    expect(screen.getByText(/Bonanza G36/)).toBeInTheDocument();
    expect(screen.getByText(/Cessna 172/)).toBeInTheDocument();
  });
});

describe("Marketplace — filter wiring", () => {
  it("changing class filter re-fires listings with filterByClass=[SEP]", async () => {
    let lastInput: any = null;
    renderWithProviders(<Marketplace />, {
      seed: ({ seedQuery, mockQuery }) => {
        seedQuery(
          ["marketplace", "listings"],
          { listings: [], playerLocationIcao: PLAYER_LOC },
          { input: DEFAULT_LISTINGS_INPUT },
        );
        mockQuery(["marketplace", "listings"], (input) => {
          lastInput = input;
          return { listings: [], playerLocationIcao: PLAYER_LOC };
        });
      },
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "SEP" }));
    await waitFor(() => {
      expect(lastInput?.filterByClass).toEqual(["SEP"]);
    });
  });
});

describe("Marketplace — refresh mutation", () => {
  it("clicking Refresh fires the marketplace.refreshNow mutation", async () => {
    const refresh = vi.fn(() => ({ added: 3, expired: 1, total: 24 }));
    renderWithProviders(<Marketplace />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["marketplace", "listings"],
          { listings: [], playerLocationIcao: PLAYER_LOC },
          { input: DEFAULT_LISTINGS_INPUT },
        );
        mockMutation(["marketplace", "refreshNow"], refresh);
      },
    });
    // The refresh button in MarketFilters is the only button-with-icon that
    // matches /Refresh/i. If the label changes, this query will surface it.
    const refreshBtn = screen.getByRole("button", { name: /Refresh/i });
    await userEvent.setup().click(refreshBtn);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

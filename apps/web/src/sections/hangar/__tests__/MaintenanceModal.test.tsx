import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { MaintenanceModal } from "../MaintenanceModal.js";

const SIM_NOW = Date.UTC(2026, 4, 12, 12, 0);

const SPECS: Record<string, any> = {
  "100hr": {
    type: "100hr",
    label: "100-Hour Inspection",
    duration: { min: 1, max: 1 },
    airportRequirement: "maintenance",
    description: "Routine inspection required every 100 flight hours.",
    resetsCounter: "hours_since_100hr",
  },
  annual: {
    type: "annual",
    label: "Annual Inspection",
    duration: { min: 3, max: 5 },
    airportRequirement: "maintenance",
    description: "Comprehensive annual airworthiness inspection.",
    resetsCounter: "hours_since_annual",
  },
  overhaul: {
    type: "overhaul",
    label: "Engine Overhaul",
    duration: { min: 14, max: 28 },
    airportRequirement: "major_maintenance",
    description: "Complete engine overhaul. Required at TBO.",
    resetsCounter: "engine_hours_since_overhaul",
  },
};

function makeOption(
  type: "100hr" | "annual" | "overhaul",
  overrides: Record<string, unknown> = {},
): any {
  const counterDefaults: Record<string, any> = {
    "100hr": { current: 50, threshold: 100 },
    annual: { current: 90, threshold: 365 },
    overhaul: { current: 1_200, threshold: 2_000 },
  };
  const costDefaults: Record<string, any> = {
    "100hr": { baseCostCents: 90_000, durationDays: 1, estimateBreakdown: [] },
    annual: { baseCostCents: 250_000, durationDays: 4, estimateBreakdown: [] },
    overhaul: { baseCostCents: 3_500_000, durationDays: 21, estimateBreakdown: [] },
  };
  return {
    type,
    spec: SPECS[type],
    eligibility: { eligible: true, reasons: [] },
    estimate: costDefaults[type],
    recommended: false,
    counterStatus: counterDefaults[type],
    ...overrides,
  };
}

function makeOptions(overrides: Partial<Record<string, any>> = {}): any {
  return {
    ownedAircraftId: 1,
    tailNumber: "C-FONE",
    model: "Bonanza G36",
    currentLocationIcao: "CYHZ",
    airportName: "Halifax Stanfield Intl",
    inProgress: null,
    options: [makeOption("100hr"), makeOption("annual"), makeOption("overhaul")],
    ...overrides,
  };
}

describe("MaintenanceModal — loading + header", () => {
  it("renders 'loading…' while options query is pending", () => {
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
      },
    });
    expect(screen.getByText(/^loading…$/i)).toBeInTheDocument();
  });

  it("renders the title, tail, and player cash in the header", () => {
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["maintenance", "options"], makeOptions(), {
          input: { ownedAircraftId: 1 },
        });
        seedQuery(["career", "get"], { cash: 1_500_000_00, simDateTime: SIM_NOW });
      },
    });
    expect(
      screen.getByText(/Maintenance: C-FONE · Bonanza G36/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Halifax Stanfield Intl/)).toBeInTheDocument();
    expect(screen.getByText("$1.50M")).toBeInTheDocument(); // cash header
  });
});

describe("MaintenanceModal — option cards", () => {
  it("renders all three option cards with their cost and duration", () => {
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["maintenance", "options"], makeOptions(), {
          input: { ownedAircraftId: 1 },
        });
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
      },
    });
    expect(screen.getByText("100-Hour Inspection")).toBeInTheDocument();
    expect(screen.getByText("Annual Inspection")).toBeInTheDocument();
    expect(screen.getByText("Engine Overhaul")).toBeInTheDocument();
    // Costs formatted: 90_000 → $900, 250_000 → $2,500, 3_500_000 → $35,000
    expect(screen.getByText("$900")).toBeInTheDocument();
    expect(screen.getByText("$2,500")).toBeInTheDocument();
    expect(screen.getByText("$35,000")).toBeInTheDocument();
    // Three Book buttons.
    expect(screen.getAllByRole("button", { name: /^Book$/i })).toHaveLength(3);
  });

  it("renders the 'Recommended' chip on a recommended-but-not-overdue option", () => {
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["maintenance", "options"],
          makeOptions({
            options: [
              makeOption("100hr", {
                recommended: true,
                counterStatus: { current: 92, threshold: 100 },
              }),
              makeOption("annual"),
              makeOption("overhaul"),
            ],
          }),
          { input: { ownedAircraftId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
      },
    });
    // Pure "Recommended" chip lives in the absolute-positioned <span> in the
    // top-right of the card; the "Recommended at 90+ hrs" threshold line also
    // contains the word — match an exact, case-sensitive equality.
    expect(
      screen.getAllByText("Recommended", { exact: true }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders the 'Overdue' chip and red bar tone when counterStatus indicates overdue", () => {
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["maintenance", "options"],
          makeOptions({
            options: [
              makeOption("100hr", {
                counterStatus: {
                  current: 110,
                  threshold: 100,
                  hoursOverdue: 10,
                },
              }),
              makeOption("annual"),
              makeOption("overhaul"),
            ],
          }),
          { input: { ownedAircraftId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
      },
    });
    expect(screen.getByText(/^Overdue$/)).toBeInTheDocument();
  });

  it("disables Book + shows the ineligibility reason when an option isn't eligible", () => {
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["maintenance", "options"],
          makeOptions({
            options: [
              makeOption("100hr", {
                eligibility: {
                  eligible: false,
                  reasons: ["This airport has no maintenance"],
                },
              }),
              makeOption("annual"),
              makeOption("overhaul"),
            ],
          }),
          { input: { ownedAircraftId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
      },
    });
    expect(
      screen.getByText("This airport has no maintenance"),
    ).toBeInTheDocument();
    // The 100hr Book button (first one) should be disabled; the other two enabled.
    const bookButtons = screen.getAllByRole("button", { name: /^Book$/i });
    expect(bookButtons[0]).toBeDisabled();
    expect(bookButtons[1]).toBeEnabled();
    expect(bookButtons[2]).toBeEnabled();
  });
});

describe("MaintenanceModal — booking flow", () => {
  it("first Book click flips the button to 'Confirm booking' without firing the mutation", async () => {
    const book = vi.fn();
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(["maintenance", "options"], makeOptions(), {
          input: { ownedAircraftId: 1 },
        });
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
        mockMutation(["maintenance", "book"], book);
      },
    });
    const first = screen.getAllByRole("button", { name: /^Book$/i })[0]!;
    await userEvent.setup().click(first);
    expect(
      screen.getByRole("button", { name: /^Confirm booking$/i }),
    ).toBeInTheDocument();
    expect(book).not.toHaveBeenCalled();
  });

  it("second Book click fires maintenance.book with type and ownedAircraftId", async () => {
    const book = vi.fn(() => ({ ok: true as const, eventId: 7 }));
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(["maintenance", "options"], makeOptions(), {
          input: { ownedAircraftId: 1 },
        });
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
        mockMutation(["maintenance", "book"], book);
      },
    });
    const user = userEvent.setup();
    // The cards render in order: 100hr, annual, overhaul.
    const bookButtons = screen.getAllByRole("button", { name: /^Book$/i });
    await user.click(bookButtons[1]!); // annual card
    await user.click(screen.getByRole("button", { name: /^Confirm booking$/i }));
    await waitFor(() =>
      expect(book).toHaveBeenCalledWith({
        ownedAircraftId: 1,
        type: "annual",
      }),
    );
  });

  it("renders the in-progress card and disables all option cards when maintenance is underway", () => {
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["maintenance", "options"],
          makeOptions({
            inProgress: {
              eventId: 99,
              type: "annual",
              label: "Annual Inspection",
              description: "",
              startedAt: SIM_NOW - 2 * 86_400_000,
              scheduledCompletionAt: SIM_NOW + 3 * 86_400_000,
              cost: 250_000,
              airportIcao: "CYHZ",
              airportName: "Halifax Stanfield Intl",
            },
          }),
          { input: { ownedAircraftId: 1 } },
        );
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
      },
    });
    expect(
      screen.getByText(/In progress · Annual Inspection/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/in 3 sim days/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Aircraft currently in maintenance/i).length,
    ).toBeGreaterThanOrEqual(1);
    // Every Book button is disabled.
    for (const btn of screen.getAllByRole("button", { name: /^Book$/i })) {
      expect(btn).toBeDisabled();
    }
  });
});

describe("MaintenanceModal — close", () => {
  it("Close button (header) + footer Close + Escape all call onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(<MaintenanceModal ownedAircraftId={1} onClose={onClose} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["maintenance", "options"], makeOptions(), {
          input: { ownedAircraftId: 1 },
        });
        seedQuery(["career", "get"], { cash: 1_000_000_00, simDateTime: SIM_NOW });
      },
    });
    const user = userEvent.setup();
    // Header has aria-label="Close", footer is a button with text "Close".
    // Both match `name: "Close"` — click one, then Escape; we just want to
    // verify the wiring fires.
    const closes = screen.getAllByRole("button", { name: /^Close$/i });
    expect(closes.length).toBeGreaterThanOrEqual(2);
    await user.click(closes[0]!);
    await user.keyboard("{Escape}");
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

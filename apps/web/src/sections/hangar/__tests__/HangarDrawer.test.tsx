import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { HangarDrawer } from "../HangarDrawer.js";

const SIM_NOW = Date.UTC(2026, 4, 12, 12, 0);

function makeAircraft(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    tailNumber: "C-FONE",
    aircraftTypeId: "bonanza_g36",
    currentLocationIcao: "CYHZ",
    airframeHours: 1_500,
    engineHoursSinceOverhaul: 200,
    hoursSince100hr: 30,
    hoursSinceAnnual: 90,
    annualDueAt: SIM_NOW + 180 * 86_400_000,
    fuelOnBoardGal: 35,
    status: "available",
    purchasedAt: SIM_NOW - 60 * 86_400_000,
    purchasePriceCents: 400_000_00,
    manufacturer: "Beechcraft",
    model: "Bonanza G36",
    aircraftClass: "SEP",
    fuelType: "avgas",
    cruiseSpeedKts: 176,
    fuelBurnGph: 17,
    rangeNm: 900,
    mtowLbs: 3_650,
    maxPayloadLbs: 950,
    unpavedCapable: false,
    tboHours: 2_000,
    hangarageMonthlyCents: 30_000,
    insuranceMonthlyCents: 25_000,
    hundredHourCostCents: 90_000,
    annualCostCents: 250_000,
    overhaulCostCents: 3_500_000,
    locationName: "Halifax Stanfield Intl",
    locationHasFuel: true,
    fuelPriceCentsPerGal: 850,
    loan: null,
    engineRemainingHours: 1_800,
    hundredHourRemainingHours: 70,
    annualDaysRemaining: 180,
    fuelCapacityGal: 80,
    estimatedValueCents: 380_000_00,
    loanLtvRatio: null,
    monthlyFixedCostsCents: 55_000,
    inProgressMaintenance: null,
    nextMonthlyCostAt: SIM_NOW + 5 * 86_400_000,
    ...overrides,
  };
}

describe("HangarDrawer — closed state", () => {
  it("aria-hidden=true and translate-x-full when aircraftId is null", () => {
    const { container } = renderWithProviders(
      <HangarDrawer
        aircraftId={null}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
    );
    const aside = container.querySelector("aside");
    expect(aside).toHaveAttribute("aria-hidden", "true");
    expect(aside!.className).toMatch(/translate-x-full/);
  });

  it("renders 'loading…' when aircraftId is set but query is still pending", () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
    );
    expect(screen.getByText(/^loading…$/i)).toBeInTheDocument();
  });
});

describe("HangarDrawer — aircraft detail rendering", () => {
  it("renders specs, current state, and purchase blocks", () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["hangar", "aircraftById"], makeAircraft(), {
            input: { id: 1 },
          });
        },
      },
    );
    expect(screen.getByText("C-FONE")).toBeInTheDocument();
    expect(screen.getByText(/Beechcraft Bonanza G36/)).toBeInTheDocument();
    expect(screen.getByText(/176 kts/)).toBeInTheDocument();
    expect(screen.getByText(/17\.0 gph/)).toBeInTheDocument();
    // Current state section
    expect(screen.getByText(/available/i)).toBeInTheDocument();
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText(/Estimated value today/i)).toBeInTheDocument();
  });

  it("renders the loan section when a loan exists, with 'Remaining' balance", () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["hangar", "aircraftById"],
            makeAircraft({
              loan: {
                principalCents: 320_000_00,
                remainingBalanceCents: 280_000_00,
                interestRateBps: 650,
                termMonths: 60,
                originalTermMonths: 60,
                monthlyPaymentCents: 6_300_00,
                paymentsMade: 6,
                nextPaymentDue: SIM_NOW + 7 * 86_400_000,
                fullyPaid: false,
                paidOffAt: null,
              },
            }),
            { input: { id: 1 } },
          );
        },
      },
    );
    expect(screen.getByText("Remaining")).toBeInTheDocument();
    // formatCash(280_000_00) = "$280,000"
    expect(screen.getByText("$280,000")).toBeInTheDocument();
  });

  it("renders the 'Loan paid off' state when fullyPaid=true", () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["hangar", "aircraftById"],
            makeAircraft({
              loan: {
                principalCents: 320_000_00,
                remainingBalanceCents: 0,
                interestRateBps: 650,
                termMonths: 60,
                originalTermMonths: 60,
                monthlyPaymentCents: 6_300_00,
                paymentsMade: 60,
                nextPaymentDue: 0,
                fullyPaid: true,
                paidOffAt: SIM_NOW - 30 * 86_400_000,
              },
            }),
            { input: { id: 1 } },
          );
        },
      },
    );
    expect(
      screen.getByText(/Loan paid off — fully owned/i),
    ).toBeInTheDocument();
  });
});

describe("HangarDrawer — refuel button", () => {
  it("shows the refuel cost in the button label when tanks need topping up", () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          // 80 cap, 35 on board → 45 gal needed × $8.50/gal = $382.50 → $383
          seedQuery(
            ["hangar", "aircraftById"],
            makeAircraft({ fuelOnBoardGal: 35, fuelPriceCentsPerGal: 850 }),
            { input: { id: 1 } },
          );
        },
      },
    );
    expect(
      screen.getByRole("button", { name: /Refuel · \$383/i }),
    ).toBeInTheDocument();
  });

  it("disables Refuel when the aircraft is full", () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["hangar", "aircraftById"],
            makeAircraft({ fuelOnBoardGal: 80 }),
            { input: { id: 1 } },
          );
        },
      },
    );
    expect(screen.getByRole("button", { name: /^Refuel$/i })).toBeDisabled();
  });

  it("disables Refuel when the location has no fuel", () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["hangar", "aircraftById"],
            makeAircraft({ locationHasFuel: false }),
            { input: { id: 1 } },
          );
        },
      },
    );
    expect(screen.getByRole("button", { name: /^Refuel$/i })).toBeDisabled();
  });

  it("disables Refuel when the aircraft is in_flight or in_maintenance", () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["hangar", "aircraftById"],
            makeAircraft({ status: "in_flight" }),
            { input: { id: 1 } },
          );
        },
      },
    );
    expect(screen.getByRole("button", { name: /Refuel/i })).toBeDisabled();
  });

  it("clicking Refuel fires hangar.refuel with the aircraft id", async () => {
    const refuel = vi.fn(() => ({ ok: true as const, fuelAddedGal: 45 }));
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(["hangar", "aircraftById"], makeAircraft(), {
            input: { id: 1 },
          });
          mockMutation(["hangar", "refuel"], refuel);
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Refuel · \$/i }));
    await waitFor(() => expect(refuel).toHaveBeenCalledWith({ aircraftId: 1 }));
  });

  it("renders the refuel error banner when the mutation returns ok=false", async () => {
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(["hangar", "aircraftById"], makeAircraft(), {
            input: { id: 1 },
          });
          mockMutation(["hangar", "refuel"], () => ({
            ok: false as const,
            error: "Insufficient cash",
          }));
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Refuel · \$/i }));
    await waitFor(() =>
      expect(screen.getByText("Insufficient cash")).toBeInTheDocument(),
    );
  });
});

describe("HangarDrawer — sell + close", () => {
  it("clicking 'Sell aircraft' calls onRequestSell with the aircraft id", async () => {
    const onRequestSell = vi.fn();
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={() => {}}
        onRequestSell={onRequestSell}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["hangar", "aircraftById"], makeAircraft({ id: 42 }), {
            input: { id: 1 },
          });
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Sell aircraft/i }));
    expect(onRequestSell).toHaveBeenCalledWith(42);
  });

  it("Close button calls onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <HangarDrawer
        aircraftId={1}
        onClose={onClose}
        onRequestSell={() => {}}
        onRequestInsurance={() => {}}
      />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["hangar", "aircraftById"], makeAircraft(), {
            input: { id: 1 },
          });
        },
      },
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

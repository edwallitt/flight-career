import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { SaleModal } from "../SaleModal.js";

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
    mtowLbs: 3650,
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

function makeEstimate(overrides: Record<string, number | boolean> = {}): any {
  const estimatedValueCents = (overrides.estimatedValueCents as number) ?? 380_000_00;
  const brokerSpreadBps = (overrides.brokerSpreadBps as number) ?? 800; // 8%
  const brokerSpreadCents =
    (overrides.brokerSpreadCents as number) ??
    Math.round((estimatedValueCents * brokerSpreadBps) / 10_000);
  const grossSaleCents =
    (overrides.grossSaleCents as number) ?? estimatedValueCents - brokerSpreadCents;
  const loanPayoffCents = (overrides.loanPayoffCents as number) ?? 0;
  const netToPlayerCents =
    (overrides.netToPlayerCents as number) ?? grossSaleCents - loanPayoffCents;
  return {
    estimatedValueCents,
    brokerSpreadBps,
    brokerSpreadCents,
    grossSaleCents,
    loanPayoffCents,
    netToPlayerCents,
    underwater: netToPlayerCents < 0,
  };
}

function makePreview(opts: { eligible?: boolean; reasons?: string[]; estimate?: any; aircraft?: any } = {}) {
  return {
    ok: true as const,
    preview: {
      aircraft: opts.aircraft ?? makeAircraft(),
      estimate: opts.estimate ?? makeEstimate(),
      eligibility: {
        eligible: opts.eligible ?? true,
        reasons: opts.reasons ?? [],
      },
    },
  };
}

describe("SaleModal — loading + error states", () => {
  it("shows 'loading…' while the preview is pending", () => {
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
        },
      },
    );
    expect(screen.getByText(/^loading…$/i)).toBeInTheDocument();
  });

  it("renders the preview error when the server returns ok=false", () => {
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["sale", "preview"],
            { ok: false, error: "Aircraft not found" },
            { input: { ownedAircraftId: 1 } },
          );
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
        },
      },
    );
    expect(screen.getAllByText(/Aircraft not found/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe("SaleModal — preview rendering", () => {
  it("renders aircraft title, tail, location, and estimate breakdown", () => {
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["sale", "preview"], makePreview(), {
            input: { ownedAircraftId: 1 },
          });
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
        },
      },
    );
    expect(
      screen.getByText(/Sell: Beechcraft Bonanza G36/i),
    ).toBeInTheDocument();
    expect(screen.getByText("C-FONE")).toBeInTheDocument();
    expect(screen.getAllByText(/CYHZ/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Broker spread \(8%\)/i)).toBeInTheDocument();
  });

  it("renders +Net to you when the sale is profitable", () => {
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["sale", "preview"], makePreview(), {
            input: { ownedAircraftId: 1 },
          });
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
        },
      },
    );
    expect(screen.getByText(/Net to you/i)).toBeInTheDocument();
    // 380000 - 8% = 349600 cents = $349,600. formatCash collapses to "$349,600".
    expect(screen.getByText(/^\+\$349,600$/)).toBeInTheDocument();
  });

  it("renders the underwater warning when netToPlayer is negative", () => {
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["sale", "preview"],
            makePreview({
              estimate: makeEstimate({
                estimatedValueCents: 200_000_00,
                loanPayoffCents: 300_000_00,
              }),
            }),
            { input: { ownedAircraftId: 1 } },
          );
          seedQuery(["career", "get"], { cash: 200_000_00, simDateTime: SIM_NOW });
        },
      },
    );
    expect(screen.getByText(/Shortfall — you pay/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Warning: this sale puts you underwater/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Underwater sale — bring cash to closing/i),
    ).toBeInTheDocument();
  });

  it("renders eligibility reasons and disables Confirm when not eligible", () => {
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["sale", "preview"],
            makePreview({
              eligible: false,
              reasons: [
                "Aircraft is in flight",
                "No buyer at this remote airfield",
              ],
            }),
            { input: { ownedAircraftId: 1 } },
          );
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
        },
      },
    );
    expect(screen.getByText("Aircraft is in flight")).toBeInTheDocument();
    expect(
      screen.getByText("No buyer at this remote airfield"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirm sale/i }),
    ).toBeDisabled();
  });
});

describe("SaleModal — confirm flow", () => {
  it("first click flips Confirm to 'Are you sure?' without firing the mutation", async () => {
    const confirm = vi.fn();
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={() => {}} />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(["sale", "preview"], makePreview(), {
            input: { ownedAircraftId: 1 },
          });
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
          mockMutation(["sale", "confirm"], confirm);
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Confirm sale/i }));
    expect(
      screen.getByRole("button", { name: /Are you sure/i }),
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("second click fires sale.confirm with ownedAircraftId and invokes onSold on success", async () => {
    const confirm = vi.fn(() => ({
      ok: true as const,
      ownedAircraftId: 1,
      saleProceedsCents: 349_600_00,
      netReceivedCents: 349_600_00,
    }));
    const onSold = vi.fn();
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={onSold} />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(["sale", "preview"], makePreview(), {
            input: { ownedAircraftId: 1 },
          });
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
          mockMutation(["sale", "confirm"], confirm);
        },
      },
    );
    const user = userEvent.setup();
    const btn = screen.getByRole("button", { name: /Confirm sale/i });
    await user.click(btn);
    await user.click(screen.getByRole("button", { name: /Are you sure/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({ ownedAircraftId: 1 }),
    );
    await waitFor(() =>
      expect(onSold).toHaveBeenCalledWith({
        tailNumber: "C-FONE",
        saleProceedsCents: 349_600_00,
        netReceivedCents: 349_600_00,
      }),
    );
  });

  it("surfaces an error footer message when the mutation returns ok=false", async () => {
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={() => {}} onSold={() => {}} />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(["sale", "preview"], makePreview(), {
            input: { ownedAircraftId: 1 },
          });
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
          mockMutation(["sale", "confirm"], () => ({
            ok: false as const,
            error: "Buyer backed out",
          }));
        },
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Confirm sale/i }));
    await user.click(screen.getByRole("button", { name: /Are you sure/i }));
    await waitFor(() =>
      expect(screen.getByText("Buyer backed out")).toBeInTheDocument(),
    );
  });
});

describe("SaleModal — close", () => {
  it("Cancel + Escape + Close all call onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SaleModal ownedAircraftId={1} onClose={onClose} onSold={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["sale", "preview"], makePreview(), {
            input: { ownedAircraftId: 1 },
          });
          seedQuery(["career", "get"], { cash: 100_000_00, simDateTime: SIM_NOW });
        },
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    await user.click(screen.getByRole("button", { name: /Close/i }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

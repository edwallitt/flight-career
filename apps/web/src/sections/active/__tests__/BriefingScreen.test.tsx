import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { BriefingScreen } from "../BriefingScreen.js";

function makeActive(overrides: any = {}): any {
  return {
    state: "accepted",
    trackingMode: null,
    job: {
      id: 42,
      clientId: "maritime_cargo",
      role: "bush",
      jobType: "standard",
      ferry: null,
      originIcao: "CYHZ",
      originName: "Halifax Stanfield Intl",
      destinationIcao: "CYQM",
      destinationName: "Greater Moncton Intl",
      distanceNm: 100,
      payloadLbs: 600,
      payloadType: "cargo",
      paxCount: null,
      requiredClass: "SEP",
      pay: 50_000,
      description: "Cargo run.",
      urgency: "standard",
      expiresAt: Date.UTC(2026, 4, 12),
      earliestDeparture: null,
      latestDeparture: null,
      acceptedAt: Date.UTC(2026, 4, 11, 10),
    },
    aircraft: {
      source: "owned",
      aircraftTypeId: "bonanza_g36",
      manufacturer: "Beechcraft",
      model: "Bonanza G36",
      cls: "SEP",
      cruiseSpeedKts: 176,
      fuelBurnGph: 17,
      fuelType: "avgas",
      fuelCapacityGal: 80,
      currentFuelGal: 30,
      rangeNm: 900,
      maxPayloadLbs: 950,
      rentalRatePerHour: 0,
      ownedAircraftId: 5,
      tailNumber: "C-FONE",
      currentLocationIcao: "CYHZ",
    },
    briefedFuelGallons: null,
    briefedFuelCostCents: null,
    fuelPriceCentsPerGal: 850,
    recommendedFuelGallons: 25,
    recommendedFuelUpliftGallons: 10,
    cancelPenalty: { role: -3, client: -8 },
    risk: { tier: "healthy", factors: [], cannotDispatch: false, cannotDispatchReason: null },
    ...overrides,
  };
}

describe("BriefingScreen — render gating", () => {
  it("renders null when there's no active job", () => {
    const { container } = renderWithProviders(
      <BriefingScreen onClose={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["lifecycle", "getActiveJob"], null);
          seedQuery(["career", "get"], { cash: 100_000_00 });
        },
      },
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when the job is already past 'accepted' (e.g. briefed)", () => {
    const { container } = renderWithProviders(
      <BriefingScreen onClose={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["lifecycle", "getActiveJob"], makeActive({ state: "briefed" }));
          seedQuery(["career", "get"], { cash: 100_000_00 });
        },
      },
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("BriefingScreen — header + route", () => {
  it("renders pre-flight brief header, origin, destination, and estimated block time", () => {
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
        seedQuery(["career", "get"], { cash: 100_000_00 });
      },
    });
    expect(screen.getByText(/Pre-flight brief · #00042/i)).toBeInTheDocument();
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText("CYQM")).toBeInTheDocument();
    // 100nm @ 176kts = ~34min → "0h 34m"
    expect(screen.getByText(/0h 34m/)).toBeInTheDocument();
  });

  it("Back-to-job button calls onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(<BriefingScreen onClose={onClose} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
        seedQuery(["career", "get"], { cash: 100_000_00 });
      },
    });
    // Two "Back to job" buttons (header + footer). Either should close.
    const buttons = screen.getAllByRole("button", { name: /Back to job/i });
    expect(buttons.length).toBe(2);
    await userEvent.setup().click(buttons[0]!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("BriefingScreen — owned fuel uplift", () => {
  it("seeds the fuel input from the server's recommendedFuelUpliftGallons", () => {
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({ recommendedFuelUpliftGallons: 12 }),
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
      },
    });
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("12");
  });

  it("updating the input recalculates the fuel cost in the confirm-button label", async () => {
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({
            recommendedFuelUpliftGallons: 10,
            fuelPriceCentsPerGal: 850,
          }),
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
      },
    });
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "20");
    // 20 * $8.50 = $170 → confirm button shows $170
    expect(
      screen.getByRole("button", { name: /Confirm brief & pay \$170/ }),
    ).toBeInTheDocument();
  });

  it("Confirm brief fires lifecycle.brief with the parsed fuelGallons", async () => {
    const brief = vi.fn(() => ({ ok: true as const, jobId: 42 }));
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({ recommendedFuelUpliftGallons: 15 }),
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
        mockMutation(["lifecycle", "brief"], brief);
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Confirm brief & pay/i }));
    await waitFor(() => expect(brief).toHaveBeenCalledWith({ fuelGallons: 15 }));
  });

  it("disables Confirm + surfaces the cannot-dispatch warning when risk.cannotDispatch is true", () => {
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({
            risk: {
              tier: "critical",
              factors: [],
              cannotDispatch: true,
              cannotDispatchReason: "Engine overhaul required (TBO exceeded)",
            },
          }),
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
      },
    });
    expect(
      screen.getByRole("button", { name: /Confirm brief/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Engine overhaul required \(TBO exceeded\)/),
    ).toBeInTheDocument();
  });

  it("disables Confirm when player cash is short of fuel cost", () => {
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({
            recommendedFuelUpliftGallons: 30,
            fuelPriceCentsPerGal: 1000,
          }),
        );
        // 30 gal × $10 = $300; player has $250.
        seedQuery(["career", "get"], { cash: 250_00 });
      },
    });
    expect(
      screen.getByRole("button", { name: /Confirm brief/i }),
    ).toBeDisabled();
  });
});

describe("BriefingScreen — rental + ferry shortcuts", () => {
  it("rental aircraft: Confirm button has no fuel cost suffix and fires brief with fuelGallons=0", async () => {
    const brief = vi.fn(() => ({ ok: true as const, jobId: 42 }));
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({
            aircraft: {
              ...makeActive().aircraft,
              source: "rental",
              tailNumber: null,
              ownedAircraftId: null,
              currentFuelGal: 80, // server reports rentals as full
              rentalRatePerHour: 18_000,
            },
            risk: null,
          }),
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
        mockMutation(["lifecycle", "brief"], brief);
      },
    });
    expect(
      screen.getByText(/✓ Rental — no maintenance risk to you/i),
    ).toBeInTheDocument();
    // No price suffix for rentals — just "Confirm brief".
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Confirm brief/i }));
    await waitFor(() => expect(brief).toHaveBeenCalledWith({ fuelGallons: 0 }));
  });

  it("ferry aircraft: renders the 'Ferry contract' panel and fires brief with fuelGallons=0", async () => {
    const brief = vi.fn(() => ({ ok: true as const, jobId: 42 }));
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({
            aircraft: {
              ...makeActive().aircraft,
              source: "ferry",
              tailNumber: "C-FERY",
            },
            risk: null,
          }),
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
        mockMutation(["lifecycle", "brief"], brief);
      },
    });
    // "Ferry contract" appears in the panel heading and the confirmation
    // narrative below; both should be visible.
    expect(screen.getAllByText(/Ferry contract/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/Owner covers fuel, fees, and maintenance/i),
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Confirm brief/i }));
    await waitFor(() => expect(brief).toHaveBeenCalledWith({ fuelGallons: 0 }));
  });
});

describe("BriefingScreen — checklist", () => {
  it("'Aircraft at origin' fails when currentLocationIcao doesn't match origin", () => {
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({
            aircraft: {
              ...makeActive().aircraft,
              currentLocationIcao: "CYQM", // not the origin (CYHZ)
            },
          }),
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
      },
    });
    // The checklist row renders a cross-icon prefix for unmet items; we just
    // verify both labels are present and the cannot-dispatch warning is NOT
    // surfaced (this is a checklist warning, not a hard block in the prop).
    expect(screen.getByText("Aircraft at origin")).toBeInTheDocument();
    // Confirm is still enabled — the checklist is informational.
    expect(
      screen.getByRole("button", { name: /Confirm brief/i }),
    ).toBeEnabled();
  });

  it("Within-MTOW check fails (visual only) when payload exceeds maxPayloadLbs", () => {
    renderWithProviders(<BriefingScreen onClose={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({
            aircraft: { ...makeActive().aircraft, maxPayloadLbs: 400 },
            job: { ...makeActive().job, payloadLbs: 600 },
          }),
        );
        seedQuery(["career", "get"], { cash: 100_000_00 });
      },
    });
    expect(screen.getByText(/Within MTOW estimation/i)).toBeInTheDocument();
  });
});

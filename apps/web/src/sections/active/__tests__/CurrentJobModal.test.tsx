import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { CurrentJobModal } from "../CurrentJobModal.js";

const SIM_NOW = Date.UTC(2026, 4, 11, 12, 0);

/** Minimal subset of `ActiveJobSnapshot` for what the modal actually reads. */
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
      description: "Standard cargo run.",
      urgency: "standard",
      expiresAt: SIM_NOW + 24 * 60 * 60 * 1000,
      earliestDeparture: null,
      latestDeparture: null,
      acceptedAt: SIM_NOW - 5 * 60 * 60 * 1000,
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
      currentFuelGal: 35,
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
    recommendedFuelUpliftGallons: 5,
    cancelPenalty: { role: -3, client: -8 },
    risk: null,
    ...overrides,
  };
}

function makeStatus(overrides: Record<string, unknown> = {}): any {
  return {
    enabled: false,
    bridgeConnection: "disconnected",
    simConnection: "unknown",
    simVersion: null,
    lastUpdate: null,
    isTracking: false,
    trackedJobId: null,
    lastEvent: null,
    ...overrides,
  };
}

describe("CurrentJobModal — accepted state", () => {
  it("renders null when there is no active job", () => {
    const { container } = renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["lifecycle", "getActiveJob"], null);
        },
      },
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders header, route, aircraft block, and Begin briefing button", () => {
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["lifecycle", "getActiveJob"], makeActive());
        },
      },
    );
    expect(screen.getByText(/Active job · #00042/i)).toBeInTheDocument();
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText("CYQM")).toBeInTheDocument();
    expect(screen.getByText(/Beechcraft Bonanza G36/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Begin briefing/i }),
    ).toBeInTheDocument();
  });

  it("clicking Begin briefing fires the onBeginBriefing callback", async () => {
    const onBeginBriefing = vi.fn();
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={onBeginBriefing} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["lifecycle", "getActiveJob"], makeActive());
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Begin briefing/i }));
    expect(onBeginBriefing).toHaveBeenCalled();
  });

  it("close button + Escape both call onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <CurrentJobModal onClose={onClose} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["lifecycle", "getActiveJob"], makeActive());
        },
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("CurrentJobModal — briefed state (fuel summary)", () => {
  it("renders the fuel-briefed pane for owned aircraft", () => {
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["lifecycle", "getActiveJob"],
            makeActive({
              state: "briefed",
              briefedFuelGallons: 30,
              briefedFuelCostCents: 25_500,
            }),
          );
          seedQuery(["simBridge", "status"], makeStatus({ enabled: false }));
        },
      },
    );
    expect(screen.getByText(/Fuel briefed/i)).toBeInTheDocument();
    expect(screen.getByText(/30 gal/)).toBeInTheDocument();
    expect(screen.getByText("$255")).toBeInTheDocument(); // 25_500 cents
  });

  it("renders the wet-rental pane for rental aircraft", () => {
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["lifecycle", "getActiveJob"],
            makeActive({
              state: "briefed",
              aircraft: {
                ...makeActive().aircraft,
                source: "rental",
                rentalRatePerHour: 18_000, // $180/hr
                tailNumber: null,
                ownedAircraftId: null,
              },
            }),
          );
          seedQuery(["simBridge", "status"], makeStatus({ enabled: false }));
        },
      },
    );
    // "Wet rental" appears in both the pane heading and the state-narrative
    // copy, so we just confirm both are visible by counting matches.
    expect(screen.getAllByText(/Wet rental/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Hourly rate/i)).toBeInTheDocument();
  });

  it("Begin flight button (MSFS disabled path) fires beginFlight with trackingMode='manual'", async () => {
    const beginFlight = vi.fn(() => ({ ok: true as const }));
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(
            ["lifecycle", "getActiveJob"],
            makeActive({ state: "briefed" }),
          );
          seedQuery(["simBridge", "status"], makeStatus({ enabled: false }));
          mockMutation(["lifecycle", "beginFlight"], beginFlight);
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Begin flight/i }));
    await waitFor(() =>
      expect(beginFlight).toHaveBeenCalledWith({ trackingMode: "manual" }),
    );
  });

  it("renders both manual + tracked buttons when MSFS bridge + sim are both connected", () => {
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["lifecycle", "getActiveJob"],
            makeActive({ state: "briefed" }),
          );
          seedQuery(
            ["simBridge", "status"],
            makeStatus({
              enabled: true,
              bridgeConnection: "connected",
              simConnection: "connected",
            }),
          );
        },
      },
    );
    expect(
      screen.getByRole("button", { name: /Begin flight \(manual\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Begin flight \(tracked\)/i }),
    ).toBeInTheDocument();
  });

  it("tracked-mode Begin flight fires beginFlight with trackingMode='tracked'", async () => {
    const beginFlight = vi.fn(() => ({ ok: true as const }));
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(
            ["lifecycle", "getActiveJob"],
            makeActive({ state: "briefed" }),
          );
          seedQuery(
            ["simBridge", "status"],
            makeStatus({
              enabled: true,
              bridgeConnection: "connected",
              simConnection: "connected",
            }),
          );
          mockMutation(["lifecycle", "beginFlight"], beginFlight);
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Begin flight \(tracked\)/i }));
    await waitFor(() =>
      expect(beginFlight).toHaveBeenCalledWith({ trackingMode: "tracked" }),
    );
  });

  it("MSFS enabled but bridge offline → falls back to manual-only with a hint", () => {
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["lifecycle", "getActiveJob"],
            makeActive({ state: "briefed" }),
          );
          seedQuery(
            ["simBridge", "status"],
            makeStatus({
              enabled: true,
              bridgeConnection: "disconnected",
              simConnection: "unknown",
            }),
          );
        },
      },
    );
    expect(
      screen.getByRole("button", { name: /Begin flight \(manual\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/MSFS bridge offline — open Settings to verify/i),
    ).toBeInTheDocument();
  });
});

describe("CurrentJobModal — cancel flow", () => {
  it("clicking 'Cancel job…' surfaces the confirmation block", async () => {
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(["lifecycle", "getActiveJob"], makeActive());
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Cancel job/i }));
    expect(screen.getByText(/Confirm cancellation/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Confirm cancel$/i }),
    ).toBeInTheDocument();
  });

  it("'Keep job' dismisses the confirmation without firing the mutation", async () => {
    const cancel = vi.fn();
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(["lifecycle", "getActiveJob"], makeActive());
          mockMutation(["lifecycle", "cancel"], cancel);
        },
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Cancel job/i }));
    await user.click(screen.getByRole("button", { name: /Keep job/i }));
    expect(screen.queryByText(/Confirm cancellation/i)).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("'Confirm cancel' fires the lifecycle.cancel mutation", async () => {
    const cancel = vi.fn(() => ({ ok: true as const, jobId: 42 }));
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery, mockMutation }) => {
          seedQuery(["lifecycle", "getActiveJob"], makeActive());
          mockMutation(["lifecycle", "cancel"], cancel);
        },
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Cancel job/i }));
    await user.click(screen.getByRole("button", { name: /^Confirm cancel$/i }));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});

describe("CurrentJobModal — in_progress state", () => {
  it("hides Cancel button and shows the 'flight panel' hint and Open-panel button", () => {
    renderWithProviders(
      <CurrentJobModal onClose={() => {}} onBeginBriefing={() => {}} />,
      {
        seed: ({ seedQuery }) => {
          seedQuery(
            ["lifecycle", "getActiveJob"],
            makeActive({ state: "in_progress" }),
          );
        },
      },
    );
    expect(screen.queryByRole("button", { name: /Cancel job/i })).toBeNull();
    expect(
      screen.getByText(/Use the flight panel to abort/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open flight panel/i }),
    ).toBeInTheDocument();
  });
});

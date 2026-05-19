import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CompletionSummary + ManualCompletionModal are tested separately; replace
// them with placeholders that surface what was passed.
vi.mock("../CompletionSummary.js", () => ({
  CompletionSummary: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="completion-summary">
      <button type="button" onClick={onClose}>
        close-summary
      </button>
    </div>
  ),
}));
vi.mock("../ManualCompletionModal.js", () => ({
  ManualCompletionModal: ({
    onClose,
    onSubmit,
  }: {
    onClose: () => void;
    onSubmit: (input: any) => void;
  }) => (
    <div data-testid="manual-completion-modal">
      <button type="button" onClick={onClose}>
        modal-close
      </button>
      <button
        type="button"
        onClick={() =>
          onSubmit({
            actualDestinationIcao: "CYQM",
            blockTimeMinutes: 75,
            fuelBurnedGal: 17.4,
          })
        }
      >
        modal-submit
      </button>
    </div>
  ),
}));

import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { InFlightSurface } from "../InFlightSurface.js";

const SIM_NOW = Date.UTC(2026, 4, 12, 12, 0);

function makeActive(overrides: any = {}): any {
  return {
    state: "in_progress",
    trackingMode: "manual",
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
      expiresAt: SIM_NOW + 86_400_000,
      earliestDeparture: null,
      latestDeparture: null,
      acceptedAt: SIM_NOW - 86_400_000,
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
    briefedFuelGallons: 25,
    briefedFuelCostCents: 21_250,
    fuelPriceCentsPerGal: 850,
    recommendedFuelGallons: 25,
    recommendedFuelUpliftGallons: 0,
    cancelPenalty: { role: -3, client: -8 },
    risk: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("InFlightSurface — gating", () => {
  it("renders nothing when there is no active job", () => {
    const { container } = renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], null);
      },
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the active job is still in 'accepted' (not in_progress)", () => {
    const { container } = renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({ state: "accepted" }),
        );
      },
    });
    expect(container.firstChild).toBeNull();
  });
});

describe("InFlightSurface — manual mode widget", () => {
  it("renders the in-flight HUD with job id, route, and action buttons", () => {
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
      },
    });
    expect(screen.getByText(/In flight · #00042/i)).toBeInTheDocument();
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText("CYQM")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Abort flight/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Complete manually/i }),
    ).toBeInTheDocument();
  });

  it("Minimize collapses the widget to the FAB; clicking the FAB re-expands it", async () => {
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Minimize/i }));
    expect(screen.queryByText(/In flight · #00042/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Show in-flight widget/i }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Show in-flight widget/i }),
    );
    expect(screen.getByText(/In flight · #00042/i)).toBeInTheDocument();
  });
});

describe("InFlightSurface — abort flow", () => {
  it("clicking 'Abort flight' opens the confirm dialog", async () => {
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Abort flight/i }));
    // "Confirm abort" appears in both the dialog heading and the primary
    // button label; just verify the dialog opened by checking the body line.
    expect(
      screen.getByText(/Abort flight #00042\?/i),
    ).toBeInTheDocument();
  });

  it("'Keep flying' dismisses the confirm without firing the mutation", async () => {
    const abort = vi.fn();
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
        mockMutation(["lifecycle", "abort"], abort);
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Abort flight/i }));
    await user.click(screen.getByRole("button", { name: /Keep flying/i }));
    expect(screen.queryByText(/Confirm abort/i)).toBeNull();
    expect(abort).not.toHaveBeenCalled();
  });

  it("'Confirm abort' fires the lifecycle.abort mutation", async () => {
    const abort = vi.fn(() => ({ ok: true as const }));
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
        mockMutation(["lifecycle", "abort"], abort);
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Abort flight/i }));
    await user.click(screen.getByRole("button", { name: /^Confirm abort$/i }));
    await waitFor(() => expect(abort).toHaveBeenCalled());
  });
});

describe("InFlightSurface — complete flow", () => {
  it("clicking 'Complete manually' opens the manual completion modal", async () => {
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Complete manually/i }));
    expect(screen.getByTestId("manual-completion-modal")).toBeInTheDocument();
  });

  it("submitting the modal fires lifecycle.complete with the entered values", async () => {
    const complete = vi.fn(() => ({
      ok: false as const,
      error: "Not at destination yet",
    }));
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
        mockMutation(["lifecycle", "complete"], complete);
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Complete manually/i }));
    await user.click(screen.getByRole("button", { name: /modal-submit/i }));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith({
        actualDestinationIcao: "CYQM",
        blockTimeMinutes: 75,
        fuelBurnedGal: 17.4,
      }),
    );
  });

  it("on successful complete, the CompletionSummary overlay takes over", async () => {
    const summaryPayload = {
      finalPay: 50_000,
      diversionAdjustment: 0,
      destinationLandingFee: 1_000,
      rentalCost: 0,
      destinationRefuelCost: 0,
      grossRevenue: 50_000,
      totalCosts: 6_000,
      netCashDelta: 44_000,
      reputationDeltas: [],
      aircraftUpdates: null,
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
      flightId: 1,
      inspectionAlerts: [],
      cashAppliedNow: 44_000,
      unscheduledEvent: null,
      dispatcherSignoff: null,
      route: {
        originIcao: "CYHZ",
        originName: "",
        originLat: 0,
        originLon: 0,
        actualIcao: "CYQM",
        actualName: "",
        actualLat: 0,
        actualLon: 0,
        plannedIcao: "CYQM",
        plannedName: "",
        plannedLat: 0,
        plannedLon: 0,
        isDiversion: false,
      },
    };
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
        mockMutation(["lifecycle", "complete"], () => ({
          ok: true as const,
          summary: summaryPayload,
        }));
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Complete manually/i }));
    await user.click(screen.getByRole("button", { name: /modal-submit/i }));
    await waitFor(() => {
      expect(screen.getByTestId("completion-summary")).toBeInTheDocument();
    });
  });
});

describe("InFlightSurface — tracked mode", () => {
  it("shows 'Complete flight ▸' (not 'Complete manually') when tracked with engine_stopped", () => {
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({ trackingMode: "tracked" }),
        );
        seedQuery(["simBridge", "currentState"], null);
        seedQuery(["simBridge", "status"], {
          enabled: true,
          bridgeConnection: "connected",
          simConnection: "connected",
          simVersion: "MSFS 2024",
          lastUpdate: SIM_NOW,
          isTracking: true,
          trackedJobId: 42,
          lastEvent: null,
        });
        seedQuery(["lifecycle", "trackedCompletionPreview"], {
          available: true,
          hasTrackingData: true,
          blockTimeMinutes: 75,
          fuelBurnedGal: 17.4,
          resolvedDestinationIcao: "CYQM",
          destinationResolution: "matched",
          isDiversion: false,
          engineStopAt: SIM_NOW + 75 * 60_000,
        });
      },
    });
    expect(
      screen.getByRole("button", { name: /^Complete flight/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Complete manually/i }),
    ).toBeNull();
  });

  it("renders the 'Switch to manual mode' button when tracked", () => {
    renderWithProviders(<InFlightSurface />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({ trackingMode: "tracked" }),
        );
        seedQuery(["simBridge", "currentState"], null);
        seedQuery(["simBridge", "status"], {
          enabled: true,
          bridgeConnection: "connected",
          simConnection: "connected",
          simVersion: null,
          lastUpdate: SIM_NOW,
          isTracking: true,
          trackedJobId: 42,
          lastEvent: null,
        });
        seedQuery(["lifecycle", "trackedCompletionPreview"], {
          available: true,
          hasTrackingData: false,
          blockTimeMinutes: null,
          fuelBurnedGal: null,
          resolvedDestinationIcao: null,
          destinationResolution: "not_landed_yet",
          isDiversion: false,
          engineStopAt: null,
        });
      },
    });
    expect(
      screen.getByRole("button", { name: /Switch to manual mode/i }),
    ).toBeInTheDocument();
  });
});

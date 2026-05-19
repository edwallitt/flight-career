import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { Settings } from "../Settings.js";

function makeStatus(overrides: Record<string, unknown> = {}) {
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

function makeAircraftState(overrides: Record<string, unknown> = {}) {
  return {
    positionLat: 44.88,
    positionLon: -63.51,
    altitudeFt: 5_300,
    groundSpeedKts: 142,
    trueHeadingDeg: 90,
    onGround: false,
    engineRunning: true,
    fuelTotalGal: 38.4,
    simulationRate: 1,
    title: "Beechcraft Bonanza G36",
    timestamp: Date.UTC(2026, 4, 11, 12, 0),
    ...overrides,
  };
}

describe("Settings — MSFS toggle states", () => {
  it("renders the disabled placeholder and aria-checked=false when MSFS is off", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(["simBridge", "status"], makeStatus({ enabled: false }));
      },
    });
    expect(
      screen.getByRole("switch"),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/MSFS integration disabled/i)).toBeInTheDocument();
    // Bridge status pane should be hidden when disabled.
    expect(screen.queryByText(/Bridge/i)).toBeNull();
  });

  it("renders the connected status when enabled with bridge + sim both connected", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({
            enabled: true,
            bridgeConnection: "connected",
            simConnection: "connected",
            simVersion: "MSFS 2024",
          }),
        );
        seedQuery(["simBridge", "currentState"], null);
      },
    });
    expect(
      screen.getByRole("switch"),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(/Bridge connected · MSFS detected/i),
    ).toBeInTheDocument();
    expect(screen.getByText("MSFS 2024")).toBeInTheDocument();
  });

  it("warns when the bridge is connected but MSFS isn't detected", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({
            enabled: true,
            bridgeConnection: "connected",
            simConnection: "disconnected",
          }),
        );
        seedQuery(["simBridge", "currentState"], null);
      },
    });
    expect(
      screen.getByText(/Bridge connected · MSFS not detected/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Start MSFS to enable tracked flights/i),
    ).toBeInTheDocument();
  });

  it("shows offline copy + setup hint when bridge is disconnected", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({
            enabled: true,
            bridgeConnection: "disconnected",
            simConnection: "unknown",
          }),
        );
        seedQuery(["simBridge", "currentState"], null);
      },
    });
    // Two callouts share the wording — the bridge label and the inline hint.
    expect(screen.getAllByText(/Bridge offline/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/localhost:8765/)).toBeInTheDocument();
    expect(screen.getByText(/apps\/sim-bridge\/README\.md/)).toBeInTheDocument();
  });

  it("renders 'Connecting…' for the transient bridgeConnection=connecting state", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({
            enabled: true,
            bridgeConnection: "connecting",
            simConnection: "unknown",
          }),
        );
        seedQuery(["simBridge", "currentState"], null);
      },
    });
    expect(screen.getByText(/Connecting to bridge/i)).toBeInTheDocument();
  });
});

describe("Settings — aircraft telemetry pane", () => {
  it("renders aircraft title, formatted coords, altitude, speed and fuel when simConnection=connected", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({
            enabled: true,
            bridgeConnection: "connected",
            simConnection: "connected",
          }),
        );
        seedQuery(["simBridge", "currentState"], makeAircraftState());
      },
    });
    expect(screen.getByText("Beechcraft Bonanza G36")).toBeInTheDocument();
    expect(screen.getByText(/44\.88°N, 63\.51°W/)).toBeInTheDocument();
    expect(screen.getByText("5,300 ft")).toBeInTheDocument();
    expect(screen.getByText("142 kts")).toBeInTheDocument();
    expect(screen.getByText("38.4 gal")).toBeInTheDocument();
  });

  it("appends '(on ground)' to the position line when onGround is true", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({
            enabled: true,
            bridgeConnection: "connected",
            simConnection: "connected",
          }),
        );
        seedQuery(
          ["simBridge", "currentState"],
          makeAircraftState({ onGround: true }),
        );
      },
    });
    expect(screen.getByText(/\(on ground\)/i)).toBeInTheDocument();
  });

  it("falls back to em-dash when aircraft title is empty", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({
            enabled: true,
            bridgeConnection: "connected",
            simConnection: "connected",
          }),
        );
        seedQuery(
          ["simBridge", "currentState"],
          makeAircraftState({ title: "" }),
        );
      },
    });
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("Settings — test connection button", () => {
  it("is rendered and enabled by default when MSFS integration is on", () => {
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({ enabled: true, bridgeConnection: "disconnected" }),
        );
        seedQuery(["simBridge", "currentState"], null);
      },
    });
    const btn = screen.getByRole("button", { name: /Test connection/i });
    expect(btn).toBeEnabled();
  });
});

describe("Settings — mutation flow", () => {
  it("clicking the switch off→on calls toggleEnabled with { enabled: true }", async () => {
    const toggleHandler = vi.fn((input: unknown) => {
      const { enabled } = input as { enabled: boolean };
      return { ok: true as const, enabled };
    });
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(["simBridge", "status"], makeStatus({ enabled: false }));
        mockMutation(["simBridge", "toggleEnabled"], toggleHandler);
      },
    });
    await userEvent.setup().click(screen.getByRole("switch"));
    await waitFor(() => {
      expect(toggleHandler).toHaveBeenCalledWith({ enabled: true });
    });
  });

  it("clicking the switch on→off calls toggleEnabled with { enabled: false }", async () => {
    const toggleHandler = vi.fn((input: unknown) => {
      const { enabled } = input as { enabled: boolean };
      return { ok: true as const, enabled };
    });
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({
            enabled: true,
            bridgeConnection: "connected",
            simConnection: "connected",
          }),
        );
        seedQuery(["simBridge", "currentState"], null);
        mockMutation(["simBridge", "toggleEnabled"], toggleHandler);
      },
    });
    await userEvent.setup().click(screen.getByRole("switch"));
    await waitFor(() => {
      expect(toggleHandler).toHaveBeenCalledWith({ enabled: false });
    });
  });

  it("clicking Test connection fires the testConnection mutation", async () => {
    const testHandler = vi.fn(() => ({ ok: true as const }));
    renderWithProviders(<Settings />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["simBridge", "status"],
          makeStatus({ enabled: true, bridgeConnection: "disconnected" }),
        );
        seedQuery(["simBridge", "currentState"], null);
        mockMutation(["simBridge", "testConnection"], testHandler);
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Test connection/i }));
    await waitFor(() => expect(testHandler).toHaveBeenCalled());
  });
});

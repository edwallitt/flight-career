import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AtlasLayerSet } from "../../../components/map/AtlasMap.js";
import { LayerPanel } from "../LayerPanel.js";

const ALL_OFF: AtlasLayerSet = {
  airports: false,
  fuelPrices: false,
  ownedAircraft: false,
  recentFlights: false,
  jobs: false,
  playerLocation: false,
  trackedFlight: false,
};

const ALL_PRESET: AtlasLayerSet = {
  airports: true,
  fuelPrices: false,
  ownedAircraft: true,
  recentFlights: true,
  jobs: true,
  playerLocation: true,
  trackedFlight: true,
};

const DEFAULT_COUNTS = {
  airports: 8,
  ownedAircraft: 2,
  recentFlights: 5,
  jobs: 12,
  player: 1,
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof LayerPanel>> = {},
) {
  const props: React.ComponentProps<typeof LayerPanel> = {
    layers: ALL_OFF,
    counts: DEFAULT_COUNTS,
    onChange: vi.fn(),
    ...overrides,
  };
  render(<LayerPanel {...props} />);
  return props;
}

describe("LayerPanel — rendering", () => {
  it("renders all five presets", () => {
    renderPanel();
    for (const label of ["ALL", "OPS", "FLEET", "JOBS", "FUEL"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("renders the standard six layer rows by default, hiding Live track", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /Airports/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /My fleet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open jobs/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Live track/i })).toBeNull();
  });

  it("surfaces the Live track row only when hasTrackedFlight is true", () => {
    renderPanel({ hasTrackedFlight: true });
    expect(screen.getByRole("button", { name: /Live track/i })).toBeInTheDocument();
  });

  it("shows zero-padded counts next to each countable row", () => {
    renderPanel({ layers: ALL_PRESET });
    expect(screen.getByText("08")).toBeInTheDocument(); // airports
    expect(screen.getByText("02")).toBeInTheDocument(); // ownedAircraft
    expect(screen.getByText("12")).toBeInTheDocument(); // jobs
    expect(screen.getByText("05")).toBeInTheDocument(); // recentFlights
    expect(screen.getByText("01")).toBeInTheDocument(); // player
  });
});

describe("LayerPanel — interactions", () => {
  it("toggling a layer row emits a full AtlasLayerSet with that one key flipped", async () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    await userEvent.setup().click(screen.getByRole("button", { name: /Airports/i }));
    expect(onChange).toHaveBeenCalledWith({ ...ALL_OFF, airports: true });
  });

  it("clicking a preset replaces the entire layer set with that preset's config", async () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    await userEvent.setup().click(screen.getByRole("button", { name: "FUEL" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        airports: true,
        fuelPrices: true,
        ownedAircraft: false,
        recentFlights: false,
        jobs: false,
        playerLocation: true,
        trackedFlight: true,
      }),
    );
  });
});

describe("LayerPanel — fuel overlay legend", () => {
  it("hides the fuel legend when fuelPrices is off", () => {
    renderPanel({ layers: ALL_OFF, fuelOverlayType: "avgas" });
    expect(screen.queryByText(/Avgas/i)).toBeNull();
  });

  it("renders the fuel legend with formatted price range when active", () => {
    renderPanel({
      layers: { ...ALL_OFF, fuelPrices: true },
      fuelOverlayType: "avgas",
      fuelOverlayRange: { lo: 650, mid: 875, hi: 1099 },
    });
    expect(screen.getByText("$6.50/gal")).toBeInTheDocument();
    expect(screen.getByText("$10.99/gal")).toBeInTheDocument();
    expect(screen.getByText(/Showing Avgas prices/i)).toBeInTheDocument();
  });

  it("shows 'No price data' when fuelPrices is on but no range is supplied", () => {
    renderPanel({
      layers: { ...ALL_OFF, fuelPrices: true },
      fuelOverlayType: "jet-a",
      fuelOverlayRange: null,
    });
    expect(screen.getByText(/No price data/i)).toBeInTheDocument();
    expect(screen.getByText(/Showing Jet A prices/i)).toBeInTheDocument();
  });
});

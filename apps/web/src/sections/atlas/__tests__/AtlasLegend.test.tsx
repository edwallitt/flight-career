import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AtlasLegend } from "../AtlasLegend.js";
import type { AtlasLayerSet } from "../../../components/map/AtlasMap.js";

const ALL_OFF: AtlasLayerSet = {
  airports: false,
  fuelPrices: false,
  ownedAircraft: false,
  recentFlights: false,
  jobs: false,
  playerLocation: false,
  trackedFlight: false,
  rangeRings: false,
  reachabilityDim: false,
  nightShade: false,
};

describe("AtlasLegend", () => {
  it("renders nothing when no encoded layer is on", () => {
    const { container } = render(
      <AtlasLegend
        layers={ALL_OFF}
        fuelOverlayType="jet-a"
        fuelOverlayRange={null}
        hasTrackedFlight={false}
        hasFerryJobs={false}
      />,
    );
    // No chip, no panel. The legend is invisible to keep map space clean
    // when there are no encodings worth explaining.
    expect(container.firstChild).toBeNull();
  });

  it("collapsed chip is the default when at least one layer is on", () => {
    render(
      <AtlasLegend
        layers={{ ...ALL_OFF, jobs: true }}
        fuelOverlayType="jet-a"
        fuelOverlayRange={null}
        hasTrackedFlight={false}
        hasFerryJobs={false}
      />,
    );
    expect(screen.getByRole("button", { name: /Legend/i })).toBeInTheDocument();
    // Section titles only appear when expanded.
    expect(screen.queryByText(/Jobs · by role/i)).toBeNull();
  });

  it("clicking the chip expands the panel and shows job role rows", async () => {
    render(
      <AtlasLegend
        layers={{ ...ALL_OFF, jobs: true }}
        fuelOverlayType="jet-a"
        fuelOverlayRange={null}
        hasTrackedFlight={false}
        hasFerryJobs={false}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Legend/i }));
    expect(screen.getByText(/Jobs · by role/i)).toBeInTheDocument();
    expect(screen.getByText("Bush")).toBeInTheDocument();
    expect(screen.getByText("Air taxi")).toBeInTheDocument();
    expect(screen.getByText("Light jet")).toBeInTheDocument();
    expect(screen.getByText("Open market")).toBeInTheDocument();
    // Ferry row is gated by hasFerryJobs.
    expect(screen.queryByText("Ferry")).toBeNull();
  });

  it("shows the ferry row only when ferry jobs are visible on the board", async () => {
    render(
      <AtlasLegend
        layers={{ ...ALL_OFF, jobs: true }}
        fuelOverlayType="jet-a"
        fuelOverlayRange={null}
        hasTrackedFlight={false}
        hasFerryJobs
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Legend/i }));
    expect(screen.getByText("Ferry")).toBeInTheDocument();
  });

  it("fuel section shows the gradient with live min/mid/max labels", async () => {
    render(
      <AtlasLegend
        layers={{ ...ALL_OFF, fuelPrices: true }}
        fuelOverlayType="avgas"
        fuelOverlayRange={{ lo: 4.2, mid: 5.5, hi: 6.8 }}
        hasTrackedFlight={false}
        hasFerryJobs={false}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Legend/i }));
    expect(screen.getByText(/Fuel prices · Avgas/i)).toBeInTheDocument();
    expect(screen.getByText("$4.20")).toBeInTheDocument();
    expect(screen.getByText("$5.50")).toBeInTheDocument();
    expect(screen.getByText("$6.80")).toBeInTheDocument();
  });

  it("hides the fuel section when prices layer is on but no range was computed", async () => {
    render(
      <AtlasLegend
        layers={{ ...ALL_OFF, fuelPrices: true, jobs: true }}
        fuelOverlayType="jet-a"
        fuelOverlayRange={null}
        hasTrackedFlight={false}
        hasFerryJobs={false}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Legend/i }));
    // Jobs section visible (because jobs:true); fuel section hidden
    // because the gradient labels would be meaningless without a range.
    expect(screen.getByText(/Jobs · by role/i)).toBeInTheDocument();
    expect(screen.queryByText(/Fuel prices/i)).toBeNull();
  });

  it("tracked section only renders when a tracked flight is in progress", async () => {
    const { rerender } = render(
      <AtlasLegend
        layers={{ ...ALL_OFF, trackedFlight: true }}
        fuelOverlayType="jet-a"
        fuelOverlayRange={null}
        hasTrackedFlight={false}
        hasFerryJobs={false}
      />,
    );
    // With trackedFlight: true but no active tracked flight, no section
    // applies — the legend itself doesn't render.
    expect(screen.queryByRole("button", { name: /Legend/i })).toBeNull();

    rerender(
      <AtlasLegend
        layers={{ ...ALL_OFF, trackedFlight: true }}
        fuelOverlayType="jet-a"
        fuelOverlayRange={null}
        hasTrackedFlight
        hasFerryJobs={false}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Legend/i }));
    expect(screen.getByText(/Tracked flight · live/i)).toBeInTheDocument();
  });

  it("collapses back to chip when the hide-legend button is clicked", async () => {
    render(
      <AtlasLegend
        layers={{ ...ALL_OFF, ownedAircraft: true }}
        fuelOverlayType="jet-a"
        fuelOverlayRange={null}
        hasTrackedFlight={false}
        hasFerryJobs={false}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Legend/i }));
    expect(screen.getByText(/Owned aircraft · status/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Hide legend/i }));
    expect(screen.queryByText(/Owned aircraft · status/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Legend/i })).toBeInTheDocument();
  });
});

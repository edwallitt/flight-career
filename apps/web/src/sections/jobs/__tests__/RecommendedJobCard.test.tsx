import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecommendedJobCard } from "../RecommendedJobCard.js";
import type { JobRow } from "../types.js";

const SIM_NOW = Date.UTC(2026, 4, 11, 12, 0);

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  const base: JobRow = {
    id: 1,
    clientId: "maritime_cargo",
    clientName: "Maritime Cargo Express",
    role: "bush",
    originIcao: "CYHZ",
    destinationIcao: "CYQM",
    payloadLbs: 600,
    payloadType: "cargo",
    paxCount: null,
    requiredClass: "SEP",
    requiredCapabilities: [],
    pay: 50_000,
    distanceNm: 120,
    generatedAt: SIM_NOW - 60 * 60_000,
    expiresAt: SIM_NOW + 4 * 60 * 60_000,
    earliestDeparture: null,
    latestDeparture: null,
    urgency: "standard",
    weatherSensitivity: "none",
    status: "open",
    jobType: "standard",
    ferrySource: null,
    ferryOwnerName: null,
    ferryAircraft: null,
    reachability: { status: "at_origin" },
    fit: {
      status: "ready",
      reason: "C172 ready at origin",
      bestAircraftTypeId: "c172",
      bestCruiseSpeedKts: 122,
      positioningDistanceNm: null,
      payHourCents: 50_000,
      netPayHourCents: 50_000,
      fuelCostCents: 0,
      rentalCostCents: 0,
    },
  };
  return { ...base, ...overrides } as JobRow;
}

describe("RecommendedJobCard", () => {
  it("renders nothing when the job is null", () => {
    const { container } = render(
      <RecommendedJobCard
        job={null}
        simNow={SIM_NOW}
        onOpen={vi.fn()}
        playerLocationIcao="CYHZ"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders route, net $/hr, total pay, and the open-briefing action", () => {
    render(
      <RecommendedJobCard
        job={makeJob({
          originIcao: "CYHZ",
          destinationIcao: "CYQM",
          pay: 75_000,
          fit: {
            status: "ready",
            reason: "ok",
            bestAircraftTypeId: "c172",
            bestCruiseSpeedKts: 122,
            positioningDistanceNm: null,
            payHourCents: 30_000,
            netPayHourCents: 25_000,
            fuelCostCents: 5_000,
            rentalCostCents: 0,
          },
        })}
        simNow={SIM_NOW}
        onOpen={vi.fn()}
        playerLocationIcao="CYHZ"
      />,
    );
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText("CYQM")).toBeInTheDocument();
    // Primary number is net.
    expect(screen.getByText("$250")).toBeInTheDocument();
    expect(screen.getByText("/hr net")).toBeInTheDocument();
    expect(screen.getByText("$750 total")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open briefing/i }),
    ).toBeInTheDocument();
  });

  it("captions 'after arrival' when captionMode is set", () => {
    render(
      <RecommendedJobCard
        job={makeJob({ originIcao: "CYQM", destinationIcao: "CYYT" })}
        simNow={SIM_NOW}
        onOpen={vi.fn()}
        playerLocationIcao="CYQM"
        captionMode="after-arrival"
      />,
    );
    expect(
      screen.getByText(/best \$\/hr from CYQM \(after arrival\)/i),
    ).toBeInTheDocument();
  });

  it("under 'after-arrival', shows gross $/hr (not net) because the fit was computed from the wrong origin", () => {
    // Server-side: the JobFit's netPayHourCents was computed from the
    // player's current location, which under pivot is NOT where this job
    // departs. The reposition cost it includes is a phantom; show gross.
    render(
      <RecommendedJobCard
        job={makeJob({
          originIcao: "CYQM",
          destinationIcao: "CYYT",
          pay: 80_000,
          fit: {
            status: "reposition",
            reason: "reposition 140 nm",
            bestAircraftTypeId: "c172",
            bestCruiseSpeedKts: 122,
            positioningDistanceNm: 140,
            payHourCents: 30_000,
            netPayHourCents: 5_000, // misleadingly low — includes phantom positioning
            fuelCostCents: 12_000,
            rentalCostCents: 0,
          },
        })}
        simNow={SIM_NOW}
        onOpen={vi.fn()}
        playerLocationIcao="CYQM"
        captionMode="after-arrival"
      />,
    );
    expect(screen.getByText("$300")).toBeInTheDocument(); // gross
    expect(screen.getByText("/hr gross")).toBeInTheDocument();
    // Make sure we did NOT render the misleading $50 net number.
    expect(screen.queryByText("$50")).toBeNull();
  });

  it("renders an em-dash for $/hr when netPayHourCents is null (locked/wont_fit)", () => {
    render(
      <RecommendedJobCard
        job={makeJob({
          fit: {
            status: "wont_fit",
            reason: "over payload",
            bestAircraftTypeId: "c172",
            bestCruiseSpeedKts: 122,
            positioningDistanceNm: null,
            payHourCents: null,
            netPayHourCents: null,
            fuelCostCents: 0,
            rentalCostCents: 0,
          },
        })}
        simNow={SIM_NOW}
        onOpen={vi.fn()}
        playerLocationIcao="CYHZ"
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the ferry role label in sky-300 for ferry jobs", () => {
    render(
      <RecommendedJobCard
        job={makeJob({
          jobType: "ferry",
          role: "open",
          clientName: "Atlantic Aircraft Sales",
        })}
        simNow={SIM_NOW}
        onOpen={vi.fn()}
        playerLocationIcao="CYHZ"
      />,
    );
    const ferryLabel = screen.getByText("Ferry");
    expect(ferryLabel.className).toMatch(/sky-300/);
  });

  it("fires onOpen with the job when Open briefing is clicked", async () => {
    const onOpen = vi.fn();
    const job = makeJob({ id: 99, clientName: "Recommended Client" });
    render(
      <RecommendedJobCard
        job={job}
        simNow={SIM_NOW}
        onOpen={onOpen}
        playerLocationIcao="CYHZ"
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Open briefing/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0].id).toBe(99);
  });
});

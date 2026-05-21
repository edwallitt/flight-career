import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JobTable } from "../JobTable.js";
import type { JobRow, SortState } from "../types.js";

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
    },
  };
  return { ...base, ...overrides } as JobRow;
}

function renderTable(
  jobs: JobRow[],
  overrides: Partial<React.ComponentProps<typeof JobTable>> = {},
) {
  const props: React.ComponentProps<typeof JobTable> = {
    jobs,
    sort: { key: "pay", dir: "desc" } as SortState,
    onSortChange: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    simNow: SIM_NOW,
    isLoading: false,
    recommendedJobId: null,
    flyableOnly: false,
    onPauseRefetch: vi.fn(),
    onResumeRefetch: vi.fn(),
    onTickNow: vi.fn(),
    isTicking: false,
    onClearFilters: vi.fn(),
    ...overrides,
  };
  render(<JobTable {...props} />);
  return props;
}

describe("JobTable — empty + rendering", () => {
  it("renders an empty state when jobs is empty and not loading", () => {
    renderTable([]);
    expect(screen.getByText(/No jobs available/i)).toBeInTheDocument();
    expect(screen.getByText(/board · empty/i)).toBeInTheDocument();
  });

  it("renders the flyable-only empty message when no jobs survive that filter", () => {
    renderTable([], { flyableOnly: true });
    expect(
      screen.getByText(/Nothing flyable from here right now/i),
    ).toBeInTheDocument();
  });

  it("does not render the empty state while loading even if jobs is empty", () => {
    renderTable([], { isLoading: true });
    expect(screen.queryByText(/No jobs available/i)).toBeNull();
  });

  it("renders one row per job with origin/destination and pay", () => {
    renderTable([
      makeJob({ id: 1, originIcao: "CYHZ", destinationIcao: "CYQM", pay: 25_000 }),
      makeJob({ id: 2, originIcao: "CYQM", destinationIcao: "CYCH", pay: 75_000 }),
    ]);
    expect(screen.getAllByText("CYHZ")).toHaveLength(1);
    expect(screen.getAllByText("CYQM")).toHaveLength(2); // dest of #1, origin of #2
    expect(screen.getByText("$250")).toBeInTheDocument();
    expect(screen.getByText("$750")).toBeInTheDocument();
  });
});

describe("JobTable — sorting", () => {
  it("sorts rows ascending by pay when sort={pay,asc}", () => {
    renderTable(
      [
        makeJob({ id: 1, pay: 80_000 }),
        makeJob({ id: 2, pay: 20_000 }),
        makeJob({ id: 3, pay: 50_000 }),
      ],
      { sort: { key: "pay", dir: "asc" } },
    );
    // The Pay column renders bare dollar strings — the $/hr column adds
    // "/hr". Use a regex that excludes the per-hour values.
    const payCells = screen
      .getAllByText(/^\$\d+$/)
      .filter((n) => !n.textContent?.includes("/hr"));
    expect(payCells.slice(0, 3).map((n) => n.textContent)).toEqual([
      "$200",
      "$500",
      "$800",
    ]);
  });

  it("clicking the same header flips the direction", async () => {
    const onSortChange = vi.fn();
    renderTable([makeJob()], {
      sort: { key: "pay", dir: "desc" },
      onSortChange,
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Pay" }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "pay", dir: "asc" });
  });

  it("clicking a different header chooses a column-appropriate default direction", async () => {
    const onSortChange = vi.fn();
    renderTable([makeJob()], {
      sort: { key: "pay", dir: "desc" },
      onSortChange,
    });
    const user = userEvent.setup();
    // Numeric columns default to desc.
    await user.click(screen.getByRole("button", { name: "Dist" }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "distance", dir: "desc" });
    // Lexical columns default to asc.
    await user.click(screen.getByRole("button", { name: /Client \/ Role/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "client", dir: "asc" });
  });

  it("the Flags column header is not interactive", () => {
    renderTable([makeJob()]);
    const flagsBtn = screen.getByRole("button", { name: "Flags" });
    expect(flagsBtn).toBeDisabled();
  });
});

describe("JobTable — selection + fit", () => {
  it("invokes onSelect with the clicked job", async () => {
    const onSelect = vi.fn();
    const job = makeJob({ id: 42, clientName: "Atlantic Forestry" });
    renderTable([job], { onSelect });
    await userEvent.setup().click(screen.getByText("Atlantic Forestry"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0].id).toBe(42);
  });

  it("renders Open Market label when role=open and clientName is null", () => {
    renderTable([makeJob({ role: "open", clientName: null })]);
    expect(screen.getAllByText(/Open Market/i).length).toBeGreaterThan(0);
  });

  it("renders Ferry tag and ferry aircraft tail for ferry jobs", () => {
    renderTable([
      makeJob({
        id: 7,
        jobType: "ferry",
        role: "open",
        clientName: "Atlantic Aircraft Sales",
        ferryOwnerName: "Atlantic Aircraft Sales",
        ferrySource: "dealer",
        ferryAircraft: {
          aircraftTypeId: "bonanza_g36",
          manufacturer: "Beechcraft",
          model: "Bonanza G36",
          cls: "SEP",
          cruiseSpeedKts: 176,
          rangeNm: 900,
          fuelType: "avgas",
          tail: "C-FERY",
        },
      }),
    ]);
    expect(screen.getByText("Ferry")).toBeInTheDocument();
    expect(screen.getByText("C-FERY")).toBeInTheDocument();
    expect(screen.getByText(/Beechcraft Bonanza G36/)).toBeInTheDocument();
  });

  it("dims locked rows and surfaces the fit reason as a caption", () => {
    renderTable([
      makeJob({
        id: 1,
        clientName: "Locked Client",
        fit: {
          status: "locked",
          reason: "Needs SET rating",
          bestAircraftTypeId: null,
          bestCruiseSpeedKts: null,
          positioningDistanceNm: null,
          payHourCents: null,
        },
      }),
    ]);
    const row = screen.getByText("Locked Client").closest("button")!;
    expect(row.className).toMatch(/opacity-55/);
    expect(screen.getByText(/Needs SET rating/i)).toBeInTheDocument();
  });

  it("highlights the recommended job with a 'best' badge", () => {
    renderTable(
      [
        makeJob({ id: 1, clientName: "Other Client" }),
        makeJob({ id: 2, clientName: "Recommended Client" }),
      ],
      { recommendedJobId: 2 },
    );
    expect(screen.getByText(/best/i)).toBeInTheDocument();
    expect(
      screen.getByText("Recommended Client").closest("button")!.className,
    ).toMatch(/bg-amber-glow/);
  });

  it("renders pay/hr from fit.payHourCents", () => {
    renderTable([
      makeJob({
        id: 1,
        clientName: "Hourly",
        fit: {
          status: "ready",
          reason: "ok",
          bestAircraftTypeId: "c172",
          bestCruiseSpeedKts: 122,
          positioningDistanceNm: null,
          payHourCents: 123_400,
        },
      }),
    ]);
    expect(screen.getByText("$1,234")).toBeInTheDocument();
  });
});

describe("JobTable — refetch pause hooks", () => {
  it("calls onPauseRefetch/onResumeRefetch on mouse enter/leave", async () => {
    const onPauseRefetch = vi.fn();
    const onResumeRefetch = vi.fn();
    renderTable([makeJob()], { onPauseRefetch, onResumeRefetch });
    const region = screen.getByText("Maritime Cargo Express").closest("div")!
      .parentElement!.parentElement!;
    // Walk up to the table container that owns the hover handlers.
    // Easier: trigger directly via the row's button parent chain.
    const user = userEvent.setup();
    await user.hover(region);
    await user.unhover(region);
    // We don't assert exact call counts (RTL may bubble multiple events);
    // just that both fired at least once.
    expect(onPauseRefetch).toHaveBeenCalled();
    expect(onResumeRefetch).toHaveBeenCalled();
  });
});

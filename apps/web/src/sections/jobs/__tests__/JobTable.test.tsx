import { render, screen, within } from "@testing-library/react";
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
    playerLocationIcao: "CYHZ",
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
    const payCells = screen.getAllByText(/^\$\d+$/);
    // First three pay cells correspond to the three rows in sorted order.
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

describe("JobTable — selection + reachability", () => {
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
    // Both the client cell ("Open Market") and the role tag are rendered;
    // the tag is uppercased via tracking-callsign, so we match case-insensitively.
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

  it("dims the row when the job is unreachable", () => {
    renderTable([
      makeJob({
        id: 1,
        clientName: "Far Away Co.",
        reachability: { status: "unreachable" },
      }),
    ]);
    const row = screen.getByText("Far Away Co.").closest("button")!;
    expect(row.className).toMatch(/opacity-50/);
  });

  it("annotates the reachability dot with a tooltip for repositioning jobs", () => {
    renderTable([
      makeJob({
        clientName: "Reposition Co.",
        originIcao: "CYQM",
        reachability: {
          status: "reposition_rental",
          positioningDistanceNm: 87,
        },
      }),
    ]);
    const row = screen.getByText("Reposition Co.").closest("button")!;
    const dot = within(row).getByLabelText(/Reposition required: 87nm from CYHZ/);
    expect(dot).toBeInTheDocument();
  });
});

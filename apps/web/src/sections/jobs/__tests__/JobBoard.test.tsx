import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  type SeedHelpers,
} from "../../../__tests__/helpers/renderWithProviders.js";
import { JobBoard } from "../JobBoard.js";

const SIM_NOW = Date.UTC(2026, 4, 11, 12, 0);

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
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
    // Default fit: a C172 at origin handling this contract. Tests that
    // exercise the locked / wont_fit branches override accordingly.
    fit: {
      status: "ready",
      reason: "C172 ready at origin",
      bestAircraftTypeId: "c172",
      bestCruiseSpeedKts: 122,
      positioningDistanceNm: null,
      payHourCents: 50_000,
    },
    ...overrides,
  };
}

function seedDefaults(
  helpers: SeedHelpers,
  jobs: ReturnType<typeof makeJob>[],
) {
  const { seedQuery } = helpers;
  seedQuery(["jobs", "listWithReachability"], {
    jobs,
    playerLocationIcao: "CYHZ",
    simNow: SIM_NOW,
    fleet: { ownedHere: [], ownedElsewhere: 0, rentalsHere: [] },
    recommendedJobId: null,
  });
  seedQuery(["career", "get"], { simDateTime: SIM_NOW });
  // JobDrawer is always mounted; this one fires unconditionally.
  seedQuery(["lifecycle", "getActiveJob"], null);
}

describe("JobBoard — rendering", () => {
  it("renders the header, fuel-shock banner placeholder, and filters", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, []);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(screen.getByText(/Job Dispatch Board/i)).toBeInTheDocument();
    // The Role filter chips from JobFilters
    expect(screen.getByRole("button", { name: "ALL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "FRY" })).toBeInTheDocument();
  });

  it("renders one row per job and surfaces the JobTable", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [
          makeJob({ id: 1, clientName: "Maritime Cargo Express" }),
          makeJob({
            id: 2,
            clientName: "Atlantic Forestry",
            originIcao: "CYHZ",
            destinationIcao: "CYCH",
            pay: 80_000,
          }),
        ]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(screen.getByText("Maritime Cargo Express")).toBeInTheDocument();
    expect(screen.getByText("Atlantic Forestry")).toBeInTheDocument();
  });

  it("renders the empty-state when no jobs are open", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, []);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    // With the default "Flyable now" filter on but zero jobs, the empty
    // state surfaces the flyable-specific message — it's the most common
    // path for a new player.
    expect(
      screen.getByText(/Nothing flyable from here right now/i),
    ).toBeInTheDocument();
  });

  it("renders the fuel-shock banner when a headline shock is active", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, []);
        h.seedQuery(["fuel", "activeShocks"], {
          shocks: [],
          headline: {
            id: 1,
            type: "refinery_outage",
            severity: "moderate",
            multiplier: 1.25,
            affectsFuelType: "both",
            affectsRegion: "global",
            ticksRemaining: 12,
            startedAt: SIM_NOW,
            headline: "Refinery outage — prices up 25%",
            description: "...",
          },
        });
      },
    });
    expect(screen.getByText(/Refinery outage — prices up 25%/)).toBeInTheDocument();
  });
});

describe("JobBoard — deep-link via ?jobId=", () => {
  // The Atlas drawer's "View in Job Board" button navigates with this
  // query param. If JobBoard fails to honor it, the player lands on the
  // board with nothing selected and has to re-find their job — the exact
  // problem the deep link is meant to solve.
  it("auto-selects the row matching ?jobId= on mount", async () => {
    renderWithProviders(<JobBoard />, {
      route: "/jobs?jobId=42",
      seed: (h) => {
        seedDefaults(h, [
          makeJob({ id: 41, clientName: "Other Job" }),
          makeJob({ id: 42, clientName: "Deep Link Target" }),
        ]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
        // JobDrawer fires these per-id queries on mount.
        h.seedQuery(["jobs", "getById"], { id: 42, clientName: "Deep Link Target" });
        h.seedQuery(["jobs", "getBriefing"], null);
        h.seedQuery(["aircraft", "candidatesForJob"], { ranked: [] });
      },
    });
    // The drawer header echoes the selected id, zero-padded to 5 chars.
    await waitFor(() =>
      expect(screen.getByText(/#00042/)).toBeInTheDocument(),
    );
  });

  it("falls back to no selection when ?jobId= isn't a positive number", () => {
    const { container } = renderWithProviders(<JobBoard />, {
      route: "/jobs?jobId=not-a-number",
      seed: (h) => {
        seedDefaults(h, [makeJob({ id: 1 })]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    // Drawer always renders for layout-stability reasons; what we want is
    // that it stays in the closed (aria-hidden=true) state.
    const drawer = container.querySelector("aside[aria-hidden]");
    expect(drawer).not.toBeNull();
    expect(drawer?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("JobBoard — urgency tally chips", () => {
  it("counts each urgency across the full (unfiltered) list and zero-pads", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [
          makeJob({ id: 1, urgency: "critical" }),
          makeJob({ id: 2, urgency: "critical" }),
          makeJob({ id: 3, urgency: "urgent" }),
          makeJob({ id: 4, urgency: "standard" }),
        ]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    // crit=2, urge=1, stan=1, flex=0 — rendered as zero-padded two-digit chips.
    const tallies = screen.getAllByText(/^0\d$/);
    // The pad-2 format is also used by JobFilters counts ("00 / 04"), so just
    // assert that each expected count value appears at least once.
    const tallyText = tallies.map((n) => n.textContent);
    expect(tallyText).toContain("02"); // critical
    expect(tallyText).toContain("01"); // urgent
    expect(tallyText).toContain("00"); // flexible
  });
});

describe("JobBoard — filter wiring", () => {
  it("toggling 'Flyable now' off keeps a non-flyable row in view", async () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [
          makeJob({
            id: 1,
            clientName: "Far Strip Co",
            reachability: { status: "unreachable" },
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
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    // Default `flyableOnly` is true → the locked row is filtered out
    // and the table shows the flyable-only empty state.
    expect(screen.queryByText("Far Strip Co")).toBeNull();

    // Click the toggle off; row should appear.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Flyable now/i }));
    expect(screen.getByText("Far Strip Co")).toBeInTheDocument();
  });

  it("'At my location' filter restricts to rows whose origin matches playerLocationIcao", async () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [
          makeJob({ id: 1, clientName: "Local Co", originIcao: "CYHZ" }),
          makeJob({ id: 2, clientName: "Other Co", originIcao: "CYQM" }),
        ]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(screen.getByText("Local Co")).toBeInTheDocument();
    expect(screen.getByText("Other Co")).toBeInTheDocument();

    // The at-my-location filter button has the literal "@ CYHZ" label; the
    // job-row buttons just contain "CYHZ" as part of route text.
    await userEvent.setup().click(screen.getByRole("button", { name: /^@ CYHZ$/ }));
    expect(screen.getByText("Local Co")).toBeInTheDocument();
    expect(screen.queryByText("Other Co")).toBeNull();
  });

  it("role=FRY shows only ferry jobs; role=OPN excludes ferries even though they have role=open", async () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [
          makeJob({ id: 1, clientName: "Standard Job", role: "open" }),
          makeJob({
            id: 2,
            clientName: "Ferry Job",
            role: "open",
            jobType: "ferry",
          }),
        ]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "FRY" }));
    expect(screen.getByText("Ferry Job")).toBeInTheDocument();
    expect(screen.queryByText("Standard Job")).toBeNull();

    await user.click(screen.getByRole("button", { name: "OPN" }));
    expect(screen.getByText("Standard Job")).toBeInTheDocument();
    expect(screen.queryByText("Ferry Job")).toBeNull();
  });

  it("class filter hides rows whose requiredClass ranks below the chosen minimum", async () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [
          makeJob({ id: 1, clientName: "SEP Co", requiredClass: "SEP" }),
          makeJob({ id: 2, clientName: "MEP Co", requiredClass: "MEP" }),
          makeJob({ id: 3, clientName: "JET Co", requiredClass: "JET" }),
        ]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "MEP" }));
    expect(screen.queryByText("SEP Co")).toBeNull();
    expect(screen.getByText("MEP Co")).toBeInTheDocument();
    expect(screen.getByText("JET Co")).toBeInTheDocument();
  });
});

describe("JobBoard — force tick mutation", () => {
  it("fires jobs.tickNow when the dev Force-tick button is clicked", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "?dev=1" },
    });
    const tickHandler = vi.fn(() => ({ inserted: 2, expired: 1 }));
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, []);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
        h.mockMutation(["jobs", "tickNow"], tickHandler);
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Force tick/i }));
    await waitFor(() => expect(tickHandler).toHaveBeenCalled());
  });
});

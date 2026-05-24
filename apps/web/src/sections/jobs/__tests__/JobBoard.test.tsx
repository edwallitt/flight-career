import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  type SeedHelpers,
} from "../../../__tests__/helpers/renderWithProviders.js";
import { JobBoard } from "../JobBoard.js";

// Probe child used by the URL-persistence tests to expose the current
// search string into the DOM. The MemoryRouter inside renderWithProviders
// doesn't expose its router instance, but a child can read useLocation and
// stamp the search string somewhere RTL can find it.
function LocationProbe() {
  const { search } = useLocation();
  return <div data-testid="location-probe">{search || "(empty)"}</div>;
}

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
      netPayHourCents: 50_000,
      fuelCostCents: 0,
      rentalCostCents: 0,
    },
    ...overrides,
  };
}

function seedDefaults(
  helpers: SeedHelpers,
  jobs: ReturnType<typeof makeJob>[],
  opts: {
    recommendedJobId?: number | null;
    activeJob?: {
      jobId: number;
      state: "accepted" | "briefed" | "in_progress";
      originIcao: string;
      destinationIcao: string;
      clientName: string | null;
      jobType: "standard" | "ferry";
      etaSimMs: number | null;
    } | null;
  } = {},
) {
  const { seedQuery } = helpers;
  seedQuery(["jobs", "listWithReachability"], {
    jobs,
    playerLocationIcao: "CYHZ",
    simNow: SIM_NOW,
    fleet: { ownedHere: [], ownedElsewhere: 0, rentalsHere: [] },
    recommendedJobId: opts.recommendedJobId ?? null,
    activeJob: opts.activeJob ?? null,
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
    // The five role chips from JobFilters.
    expect(screen.getByRole("button", { name: "ALL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OPN" })).toBeInTheDocument();
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
    // Default scope is "flyable" — the most common path when a new player
    // lands on the board with an empty fleet / unfit aircraft.
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

describe("JobBoard — recommendation card", () => {
  it("renders the Recommended-next card when the server picks a recommendedJobId", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(
          h,
          [
            makeJob({ id: 1, clientName: "Other Client" }),
            makeJob({
              id: 2,
              clientName: "Pick Me",
              originIcao: "CYHZ",
              destinationIcao: "CYQM",
            }),
          ],
          { recommendedJobId: 2 },
        );
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(screen.getByText(/Recommended next/i)).toBeInTheDocument();
    expect(screen.getByText(/best \$\/hr from CYHZ/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open briefing/i })).toBeInTheDocument();
  });

  it("clicking Open briefing selects the recommended job into the drawer", async () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(
          h,
          [
            makeJob({
              id: 42,
              clientName: "Recommended Client",
            }),
          ],
          { recommendedJobId: 42 },
        );
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
        h.seedQuery(["jobs", "getById"], {
          id: 42,
          clientName: "Recommended Client",
        });
        h.seedQuery(["jobs", "getBriefing"], null);
        h.seedQuery(["aircraft", "candidatesForJob"], { ranked: [] });
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Open briefing/i }));
    await waitFor(() =>
      expect(screen.getByText(/#00042/)).toBeInTheDocument(),
    );
  });

  it("renders nothing when recommendedJobId is null", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [makeJob({ id: 1 })], { recommendedJobId: null });
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(screen.queryByText(/Recommended next/i)).toBeNull();
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

describe("JobBoard — filter wiring", () => {
  it("switching origin scope to 'All' surfaces a locked row that 'Flyable' hides", async () => {
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
    // Default `flyable` scope hides the locked row.
    expect(screen.queryByText("Far Strip Co")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Far Strip Co")).toBeInTheDocument();
  });

  it("origin scope 'At CYHZ' restricts to rows whose origin matches playerLocationIcao", async () => {
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

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "At CYHZ" }));
    expect(screen.getByText("Local Co")).toBeInTheDocument();
    expect(screen.queryByText("Other Co")).toBeNull();
  });

  it("role=OPN shows only open-market jobs but ferry jobs are always visible", async () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [
          makeJob({ id: 1, clientName: "Standard Job", role: "open" }),
          makeJob({ id: 2, clientName: "Bush Job", role: "bush" }),
          makeJob({
            id: 3,
            clientName: "Ferry Job",
            role: "open",
            jobType: "ferry",
          }),
        ]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "OPN" }));
    expect(screen.getByText("Standard Job")).toBeInTheDocument();
    expect(screen.queryByText("Bush Job")).toBeNull();
    // Ferries pass through the role filter regardless — they're a job type,
    // not a career role.
    expect(screen.getByText("Ferry Job")).toBeInTheDocument();
  });
});

describe("JobBoard — active-job awareness", () => {
  it("renders ActiveJobBanner when activeJob is set on the response", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [makeJob({ id: 1 })], {
          activeJob: {
            jobId: 41,
            state: "in_progress",
            originIcao: "CYHZ",
            destinationIcao: "CYQM",
            clientName: "Maritime Cargo",
            jobType: "standard",
            etaSimMs: SIM_NOW + 60 * 60 * 1000,
          },
        });
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(screen.getByText(/Working on/i)).toBeInTheDocument();
    expect(screen.getByText(/#00041/)).toBeInTheDocument();
    // Destination is highlighted in amber — assert presence via the banner's
    // accessible label which mentions the destination ICAO.
    expect(
      screen.getByLabelText(/job #00041 to CYQM/i),
    ).toBeInTheDocument();
  });

  it("captions the recommendation card 'after arrival' when activeJob is set", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(
          h,
          [
            makeJob({
              id: 2,
              clientName: "Best Pick",
              originIcao: "CYQM",
              destinationIcao: "CYYT",
            }),
          ],
          {
            recommendedJobId: 2,
            activeJob: {
              jobId: 41,
              state: "briefed",
              originIcao: "CYHZ",
              destinationIcao: "CYQM",
              clientName: "Maritime",
              jobType: "standard",
              etaSimMs: null,
            },
          },
        );
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(
      screen.getByText(/best \$\/hr from CYQM \(after arrival\)/i),
    ).toBeInTheDocument();
  });

  it("renders no banner when activeJob is null", () => {
    renderWithProviders(<JobBoard />, {
      seed: (h) => {
        seedDefaults(h, [makeJob({ id: 1 })]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    expect(screen.queryByText(/Working on/i)).toBeNull();
  });
});

describe("JobBoard — URL-persisted filters", () => {
  // Filter state is encoded as ?origin=&role=&sort=. The board parses these
  // on mount (shareable / reload-safe / Atlas deep-linkable) and writes
  // them back on change. Defaults are omitted from the URL to keep it tidy.

  it("seeds origin scope, role, and sort from URL params on mount", () => {
    renderWithProviders(<JobBoard />, {
      route: "/jobs?origin=here&role=bush&sort=expires:asc",
      seed: (h) => {
        seedDefaults(h, [
          makeJob({ id: 1, clientName: "Bush Co", role: "bush", originIcao: "CYHZ" }),
          makeJob({ id: 2, clientName: "Other", role: "open", originIcao: "CYHZ" }),
        ]);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    // BSH should be the active role.
    expect(screen.getByRole("button", { name: "BSH" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The "At CYHZ" origin scope active.
    expect(
      screen.getByRole("button", { name: "At CYHZ" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The bush job survives; the open-market one is filtered out.
    expect(screen.getByText("Bush Co")).toBeInTheDocument();
    expect(screen.queryByText("Other")).toBeNull();
  });

  it("writes non-default filters back into the URL when toggled", async () => {
    renderWithProviders(
      <>
        <JobBoard />
        <LocationProbe />
      </>,
      {
        seed: (h) => {
          seedDefaults(h, [makeJob({ id: 1 })]);
          h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "BSH" }));
    await waitFor(() =>
      expect(screen.getByTestId("location-probe").textContent).toMatch(
        /role=bush/,
      ),
    );
  });

  it("strips the param when a filter returns to its default", async () => {
    renderWithProviders(
      <>
        <JobBoard />
        <LocationProbe />
      </>,
      {
        route: "/jobs?role=bush",
        seed: (h) => {
          seedDefaults(h, [makeJob({ id: 1 })]);
          h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ALL" }));
    await waitFor(() =>
      expect(screen.getByTestId("location-probe").textContent).not.toMatch(
        /role=/,
      ),
    );
  });

  it("falls back to defaults when URL params are malformed", () => {
    renderWithProviders(<JobBoard />, {
      route: "/jobs?origin=bogus&role=nope&sort=junk",
      seed: (h) => {
        seedDefaults(h, []);
        h.seedQuery(["fuel", "activeShocks"], { shocks: [], headline: null });
      },
    });
    // Defaults: ALL role + Flyable origin.
    expect(screen.getByRole("button", { name: "ALL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Flyable" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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

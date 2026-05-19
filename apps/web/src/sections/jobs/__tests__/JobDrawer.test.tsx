import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  type SeedHelpers,
} from "../../../__tests__/helpers/renderWithProviders.js";

// RouteMap instantiates a real maplibre-gl Map (canvas, tile loading) which
// can't run under jsdom. Replace it with a harmless placeholder for these
// tests — we cover map rendering elsewhere.
vi.mock("../../../components/map/RouteMap.js", () => ({
  RouteMap: () => <div data-testid="route-map" />,
}));

// AircraftCandidatesPanel has its own tRPC dependencies and UI. Replace it
// with a test affordance that exposes two buttons:
//   • "select owned"  → calls onSelectionChange with a fixed owned selection
//   • "select rental" → calls onSelectionChange with a fixed rental selection
// This lets us drive JobDrawer's Accept button state from the test.
vi.mock("../../active/AircraftCandidatesPanel.js", () => ({
  AircraftCandidatesPanel: ({
    onSelectionChange,
  }: {
    onSelectionChange: (s: unknown) => void;
  }) => (
    <div data-testid="candidates-panel">
      <button
        type="button"
        onClick={() =>
          onSelectionChange({
            source: "owned",
            ownedAircraftId: 7,
            aircraftTypeId: "bonanza_g36",
          })
        }
      >
        select owned
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectionChange({
            source: "rental",
            rentalAircraftTypeId: "bonanza_g36",
          })
        }
      >
        select rental
      </button>
    </div>
  ),
}));

// The mocks above must be hoisted before importing JobDrawer.
import { JobDrawer } from "../JobDrawer.js";

const SIM_NOW = Date.UTC(2026, 4, 11, 12, 0);
const ONE_HOUR_MS = 60 * 60 * 1000;

function makeJobDetail(overrides: Record<string, unknown> = {}): any {
  return {
    id: 42,
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
    pay: 50_000, // $500
    distanceNm: 100,
    generatedAt: SIM_NOW - 30 * 60_000,
    expiresAt: SIM_NOW + 4 * ONE_HOUR_MS,
    earliestDeparture: null,
    latestDeparture: null,
    urgency: "standard",
    weatherSensitivity: "none",
    status: "open",
    jobType: "standard",
    ferrySource: null,
    ferryOwnerName: null,
    ferryAircraft: null,
    description: "Standard cargo run from CYHZ to CYQM.",
    clientDescription: "Maritime Cargo Express, est. 1992.",
    originName: "Halifax Stanfield Intl",
    originLat: 44.88,
    originLon: -63.51,
    destinationName: "Greater Moncton Intl",
    destinationLat: 46.11,
    destinationLon: -64.68,
    ...overrides,
  };
}

const EMPTY_BRIEFING_RESULT = { briefing: null, error: "not ready" };
const EMPTY_CANDIDATES_RESULT = {
  jobId: 42,
  job: {},
  player: { ratings: { SEP: true, MEP: false, SET: false, JET: false }, currentLocationIcao: "CYHZ" },
  ranked: [],
};

function seedJob(
  helpers: SeedHelpers,
  job: ReturnType<typeof makeJobDetail>,
  opts: { activeJob?: unknown; briefing?: unknown } = {},
) {
  const { seedQuery } = helpers;
  seedQuery(["jobs", "getById"], job, { input: { id: job.id } });
  seedQuery(["jobs", "getBriefing"], opts.briefing ?? EMPTY_BRIEFING_RESULT, {
    input: { jobId: job.id },
  });
  seedQuery(["lifecycle", "getActiveJob"], opts.activeJob ?? null);
  seedQuery(["aircraft", "candidatesForJob"], EMPTY_CANDIDATES_RESULT, {
    input: { jobId: job.id },
  });
}

describe("JobDrawer — closed + loading", () => {
  it("renders the closed drawer (aria-hidden) when jobId is null", () => {
    const { container } = renderWithProviders(
      <JobDrawer
        jobId={null}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={null}
        playerLocationIcao="CYHZ"
      />,
    );
    // The <aside> is always mounted but slides off-screen via CSS translate
    // and is marked aria-hidden when jobId is null. The body text in this
    // state is react-query's "pending" branch since the query is `enabled:
    // false` but still status=pending — we don't assert on its content.
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside).toHaveAttribute("aria-hidden", "true");
    expect(aside!.className).toMatch(/translate-x-full/);
  });

  it("renders a loading state while the detail query is pending", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        // Deliberately don't seed jobs.getById → react-query stays pending.
        seed: ({ seedQuery }) => {
          seedQuery(["jobs", "getBriefing"], EMPTY_BRIEFING_RESULT, {
            input: { jobId: 42 },
          });
          seedQuery(["lifecycle", "getActiveJob"], null);
          seedQuery(["aircraft", "candidatesForJob"], EMPTY_CANDIDATES_RESULT, {
            input: { jobId: 42 },
          });
        },
      },
    );
    expect(screen.getByText(/^loading…$/i)).toBeInTheDocument();
  });
});

describe("JobDrawer — job rendering", () => {
  it("renders client name, route, payload, urgency, distance, pay, and rate", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) => seedJob(h, makeJobDetail()),
      },
    );
    expect(screen.getByText("Maritime Cargo Express")).toBeInTheDocument();
    // Route ICAOs appear in multiple places (route block, briefing fallback,
    // schedule window, footer) so we check at least one instance.
    expect(screen.getAllByText("CYHZ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CYQM").length).toBeGreaterThan(0);
    expect(screen.getByText("$500")).toBeInTheDocument(); // pay formatted from cents
    expect(screen.getByText("standard")).toBeInTheDocument();
    // rate = $500 / 100nm = $5.00 / nm
    expect(screen.getByText("$5.00")).toBeInTheDocument();
    // Distance cell: "100 nm" — but textContent is split across spans.
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("renders 'Open Market' when the job has no client", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) =>
          seedJob(h, makeJobDetail({ clientName: null, role: "open" })),
      },
    );
    // "Open Market" shows up twice — once in the header title slot (because
    // clientName is null) and once in the role-label below (ROLE_LABEL.open).
    expect(screen.getAllByText(/^Open Market$/).length).toBe(2);
  });

  it("renders capability chips when the job lists required capabilities", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) =>
          seedJob(h, makeJobDetail({ requiredCapabilities: ["unpaved", "ifr"] })),
      },
    );
    expect(screen.getByText("unpaved")).toBeInTheDocument();
    expect(screen.getByText("ifr")).toBeInTheDocument();
  });

  it("clicking the Close button calls onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={onClose}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) => seedJob(h, makeJobDetail()),
      },
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("JobDrawer — reachability banner", () => {
  it("at_origin → 'Departing from your location'", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      { seed: (h) => seedJob(h, makeJobDetail()) },
    );
    expect(
      screen.getByText(/Departing from your location/i),
    ).toBeInTheDocument();
  });

  it("reposition_rental → shows distance + Travel-to-origin button", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "reposition_rental", positioningDistanceNm: 87 }}
        playerLocationIcao="CYQM"
      />,
      { seed: (h) => seedJob(h, makeJobDetail()) },
    );
    expect(screen.getByText(/Requires 87nm reposition/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Travel to CYHZ/i }),
    ).toBeInTheDocument();
  });

  it("unreachable → critical banner + footer message + disabled Accept", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "unreachable" }}
        playerLocationIcao="KMIA"
      />,
      { seed: (h) => seedJob(h, makeJobDetail()) },
    );
    expect(
      screen.getByText(/Unreachable from your current location/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No aircraft can reach the origin/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept job/i })).toBeDisabled();
  });
});

describe("JobDrawer — briefing section", () => {
  it("shows the AI briefing block when getBriefing returns content", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) =>
          seedJob(h, makeJobDetail(), {
            briefing: {
              briefing: {
                cargoDescription: "Three boxes of marine charts.",
                dispatcherNote: "Be gentle on landing.",
                recipientNote: "Hand to harbor master.",
                handlingNotes: ["Keep dry", "Top heavy"],
              },
              source: "generated",
              dispatcherName: "Mary at Maritime",
            },
          }),
      },
    );
    expect(screen.getByText(/Three boxes of marine charts/)).toBeInTheDocument();
    expect(screen.getByText(/Be gentle on landing/)).toBeInTheDocument();
    expect(screen.getByText(/Hand to harbor master/)).toBeInTheDocument();
    expect(screen.getByText("Keep dry")).toBeInTheDocument();
    expect(screen.getByText("Top heavy")).toBeInTheDocument();
    expect(screen.getByText(/Mary at Maritime/)).toBeInTheDocument();
  });

  it("falls back to job.description + client tagline when briefing is null", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      { seed: (h) => seedJob(h, makeJobDetail()) },
    );
    expect(
      screen.getByText(/Standard cargo run from CYHZ to CYQM/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Maritime Cargo Express, est\. 1992/),
    ).toBeInTheDocument();
  });
});

describe("JobDrawer — schedule window", () => {
  it("renders 'Anytime' when earliest/latest are null", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      { seed: (h) => seedJob(h, makeJobDetail()) },
    );
    expect(screen.getAllByText("Anytime").length).toBe(2);
  });

  it("highlights 'Expires' in red when less than an hour remains", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) =>
          seedJob(h, makeJobDetail({ expiresAt: SIM_NOW + 15 * 60_000 })),
      },
    );
    const expiresEl = screen.getByText(/in 15m/);
    expect(expiresEl.className).toMatch(/text-urgency-critical/);
  });
});

describe("JobDrawer — accept button (standard jobs)", () => {
  it("Accept is disabled with no selection and footer asks for one", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      { seed: (h) => seedJob(h, makeJobDetail()) },
    );
    expect(screen.getByRole("button", { name: /Accept job/i })).toBeDisabled();
    expect(
      screen.getByText(/Select an eligible aircraft to continue/i),
    ).toBeInTheDocument();
  });

  it("selecting an owned aircraft enables Accept and clicking fires lifecycle.accept with owned payload", async () => {
    const accept = vi.fn(() => ({ ok: true as const, jobId: 42 }));
    const onClose = vi.fn();
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={onClose}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) => {
          seedJob(h, makeJobDetail());
          h.mockMutation(["lifecycle", "accept"], accept);
        },
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /select owned/i }));
    const acceptBtn = screen.getByRole("button", { name: /Accept job/i });
    expect(acceptBtn).toBeEnabled();
    await user.click(acceptBtn);
    await waitFor(() =>
      expect(accept).toHaveBeenCalledWith({
        jobId: 42,
        aircraftSource: "owned",
        ownedAircraftId: 7,
      }),
    );
    // Successful accept calls onClose on the drawer.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("selecting a rental fires lifecycle.accept with the rental payload", async () => {
    const accept = vi.fn(() => ({ ok: true as const, jobId: 42 }));
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) => {
          seedJob(h, makeJobDetail());
          h.mockMutation(["lifecycle", "accept"], accept);
        },
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /select rental/i }));
    await user.click(screen.getByRole("button", { name: /Accept job/i }));
    await waitFor(() =>
      expect(accept).toHaveBeenCalledWith({
        jobId: 42,
        aircraftSource: "rental",
        rentalAircraftTypeId: "bonanza_g36",
      }),
    );
  });

  it("Accept is disabled and footer warns when an active job is in progress", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) =>
          seedJob(h, makeJobDetail(), {
            activeJob: {
              state: "accepted",
              job: { id: 99, originIcao: "CYHZ", destinationIcao: "CYQM" },
              aircraft: { manufacturer: "Cessna", model: "172" },
            },
          }),
      },
    );
    expect(screen.getByRole("button", { name: /Accept job/i })).toBeDisabled();
    expect(
      screen.getByText(/Active job in progress — open it from the header/),
    ).toBeInTheDocument();
  });

  it("surfaces an accept error message when the mutation returns ok=false", async () => {
    const accept = vi.fn(() => ({ ok: false as const, error: "Cash short" }));
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) => {
          seedJob(h, makeJobDetail());
          h.mockMutation(["lifecycle", "accept"], accept);
        },
      },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /select owned/i }));
    await user.click(screen.getByRole("button", { name: /Accept job/i }));
    await waitFor(() => {
      expect(screen.getByText("Cash short")).toBeInTheDocument();
    });
  });
});

describe("JobDrawer — ferry jobs", () => {
  function makeFerryJob(overrides: Record<string, unknown> = {}) {
    return makeJobDetail({
      clientId: null,
      clientName: "Atlantic Aircraft Sales",
      jobType: "ferry",
      role: "open",
      ferrySource: "dealer",
      ferryOwnerName: "Atlantic Aircraft Sales",
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
      ...overrides,
    });
  }

  it("renders the ferry aircraft block (tail + class + manufacturer/model)", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      { seed: (h) => seedJob(h, makeFerryJob()) },
    );
    expect(screen.getByText("C-FERY")).toBeInTheDocument();
    expect(screen.getByText(/Beechcraft Bonanza G36/)).toBeInTheDocument();
    expect(screen.getByText(/Ferry · DEALER/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Accept ferry & brief/i }),
    ).toBeInTheDocument();
  });

  it("Accept-ferry is disabled when the player is not at the aircraft's location", () => {
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "reposition_rental", positioningDistanceNm: 87 }}
        playerLocationIcao="CYQM"
      />,
      { seed: (h) => seedJob(h, makeFerryJob()) },
    );
    expect(
      screen.getByRole("button", { name: /Accept ferry & brief/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Travel to CYHZ before accepting/i),
    ).toBeInTheDocument();
  });

  it("Accept-ferry enabled at origin fires accept with aircraftSource='ferry'", async () => {
    const accept = vi.fn(() => ({ ok: true as const, jobId: 42 }));
    renderWithProviders(
      <JobDrawer
        jobId={42}
        onClose={() => {}}
        simNow={SIM_NOW}
        reachability={{ status: "at_origin" }}
        playerLocationIcao="CYHZ"
      />,
      {
        seed: (h) => {
          seedJob(h, makeFerryJob());
          h.mockMutation(["lifecycle", "accept"], accept);
          // Successful ferry accept also auto-fires lifecycle.brief.
          h.mockMutation(["lifecycle", "brief"], () => ({
            ok: true as const,
            jobId: 42,
          }));
        },
      },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Accept ferry & brief/i }));
    await waitFor(() =>
      expect(accept).toHaveBeenCalledWith({
        jobId: 42,
        aircraftSource: "ferry",
      }),
    );
  });
});

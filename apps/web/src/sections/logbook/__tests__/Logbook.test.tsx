import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";

// The three tab bodies are tested separately. Replace them here with thin
// placeholders so the shell test only validates tab switching + headline,
// without dragging in every sub-tab's query graph.
vi.mock("../LogbookFlights.js", () => ({
  LogbookFlights: () => <div data-testid="tab-flights">flights-body</div>,
}));
vi.mock("../LogbookFinances.js", () => ({
  LogbookFinances: () => <div data-testid="tab-finances">finances-body</div>,
}));
vi.mock("../LogbookMaintenance.js", () => ({
  LogbookMaintenance: () => <div data-testid="tab-maintenance">maintenance-body</div>,
}));

import { Logbook } from "../Logbook.js";

describe("Logbook — header + headline", () => {
  it("renders the page title without the metrics block when headline isn't loaded yet", () => {
    renderWithProviders(<Logbook />);
    expect(screen.getByText(/^Logbook$/)).toBeInTheDocument();
    expect(screen.getByText(/Career history/i)).toBeInTheDocument();
    // No headline metrics rendered before the query resolves.
    expect(screen.queryByText(/Block hours/i)).toBeNull();
  });

  it("renders the three headline tiles (Flights, Block hours, Net earnings) when seeded", () => {
    renderWithProviders(<Logbook />, {
      seed: ({ seedQuery }) => {
        seedQuery(["logbook", "headline"], {
          totalFlights: 27,
          totalBlockMinutes: 1_545, // 25h 45m
          totalNetCents: 425_000,
        });
      },
    });
    expect(screen.getByText("27")).toBeInTheDocument();
    expect(screen.getByText("25h 45m")).toBeInTheDocument();
    // 425_000 cents → $4,250
    expect(screen.getByText(/^\+\$4,250$/)).toBeInTheDocument();
  });

  it("renders net earnings in red with a minus sign when totalNetCents is negative", () => {
    renderWithProviders(<Logbook />, {
      seed: ({ seedQuery }) => {
        seedQuery(["logbook", "headline"], {
          totalFlights: 3,
          totalBlockMinutes: 180,
          totalNetCents: -50_000,
        });
      },
    });
    const net = screen.getByText(/^−\$500$/);
    expect(net).toBeInTheDocument();
    expect(net.className).toMatch(/text-urgency-critical/);
  });

  it("formats sub-hour block time as just minutes", () => {
    renderWithProviders(<Logbook />, {
      seed: ({ seedQuery }) => {
        seedQuery(["logbook", "headline"], {
          totalFlights: 1,
          totalBlockMinutes: 42,
          totalNetCents: 0,
        });
      },
    });
    expect(screen.getByText("42m")).toBeInTheDocument();
  });
});

describe("Logbook — tab switching", () => {
  it("defaults to the Flights tab", () => {
    renderWithProviders(<Logbook />);
    expect(screen.getByTestId("tab-flights")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-finances")).toBeNull();
    expect(screen.queryByTestId("tab-maintenance")).toBeNull();
  });

  it("clicking Finances mounts that tab's body and unmounts Flights", async () => {
    renderWithProviders(<Logbook />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Finances/i }));
    expect(screen.getByTestId("tab-finances")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-flights")).toBeNull();
  });

  it("clicking Maintenance mounts that tab's body", async () => {
    renderWithProviders(<Logbook />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Maintenance/i }));
    expect(screen.getByTestId("tab-maintenance")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-flights")).toBeNull();
  });
});

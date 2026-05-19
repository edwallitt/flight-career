import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { ActiveJobPill } from "../ActiveJobPill.js";

/**
 * Minimal stand-in for `ActiveJobSnapshot`. The pill only reads a tiny slice
 * (state, job.origin/dest icao, aircraft.manufacturer/model), so a partial
 * shape is fine — we cast at the seed call rather than constructing the
 * 90-field full object.
 */
function makeActive(overrides: Record<string, unknown> = {}) {
  return {
    state: "accepted",
    trackingMode: "manual",
    job: {
      id: 1,
      originIcao: "CYHZ",
      destinationIcao: "CYQM",
    },
    aircraft: {
      manufacturer: "Beechcraft",
      model: "Bonanza G36",
    },
    ...overrides,
  };
}

describe("ActiveJobPill", () => {
  it("renders nothing when there is no active job", () => {
    const { container } = renderWithProviders(<ActiveJobPill onOpen={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], null);
      },
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders origin → destination, manufacturer, and the state label", () => {
    renderWithProviders(<ActiveJobPill onOpen={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive({ state: "briefed" }));
      },
    });
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText("CYQM")).toBeInTheDocument();
    expect(screen.getByText(/Bonanza G36/)).toBeInTheDocument();
    expect(screen.getByText(/Briefed/)).toBeInTheDocument();
  });

  it("falls back to raw state when the state isn't in the label map", () => {
    renderWithProviders(<ActiveJobPill onOpen={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({ state: "mystery_state" }),
        );
      },
    });
    expect(screen.getByText(/mystery_state/)).toBeInTheDocument();
  });

  it("renders the In flight label when state=in_progress", () => {
    renderWithProviders(<ActiveJobPill onOpen={() => {}} />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["lifecycle", "getActiveJob"],
          makeActive({ state: "in_progress" }),
        );
      },
    });
    expect(screen.getByText(/In flight/)).toBeInTheDocument();
  });

  it("invokes onOpen when clicked", async () => {
    const onOpen = vi.fn();
    renderWithProviders(<ActiveJobPill onOpen={onOpen} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["lifecycle", "getActiveJob"], makeActive());
      },
    });
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

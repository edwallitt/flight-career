import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JobFilters } from "../JobFilters.js";

function renderFilters(overrides: Partial<React.ComponentProps<typeof JobFilters>> = {}) {
  const props: React.ComponentProps<typeof JobFilters> = {
    roleFilter: "all",
    setRoleFilter: vi.fn(),
    originScope: "flyable",
    setOriginScope: vi.fn(),
    playerLocationIcao: "CYHZ",
    totalCount: 14,
    filteredCount: 5,
    onTickNow: vi.fn(),
    isTicking: false,
    ...overrides,
  };
  render(<JobFilters {...props} />);
  return props;
}

describe("JobFilters — role chips", () => {
  it("renders the five career role codes; ferry is no longer a filter", () => {
    renderFilters();
    for (const code of ["ALL", "BSH", "ATX", "LJT", "OPN"]) {
      expect(screen.getByRole("button", { name: code })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "FRY" })).toBeNull();
  });

  it("invokes setRoleFilter with the selected role id", async () => {
    const setRoleFilter = vi.fn();
    renderFilters({ setRoleFilter });
    await userEvent.setup().click(screen.getByRole("button", { name: "BSH" }));
    expect(setRoleFilter).toHaveBeenCalledWith("bush");
  });
});

describe("JobFilters — origin scope segmented control", () => {
  it("renders the three scope buttons including the ICAO label", () => {
    renderFilters({ playerLocationIcao: "CYQM" });
    expect(screen.getByRole("button", { name: "At CYQM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flyable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("marks the active scope with aria-pressed and routes clicks to setOriginScope", async () => {
    const setOriginScope = vi.fn();
    renderFilters({ originScope: "flyable", setOriginScope });
    const flyable = screen.getByRole("button", { name: "Flyable" });
    expect(flyable).toHaveAttribute("aria-pressed", "true");
    await userEvent.setup().click(screen.getByRole("button", { name: "All" }));
    expect(setOriginScope).toHaveBeenCalledWith("all");
  });

  it("disables the 'At …' button when player location is unknown", () => {
    renderFilters({ playerLocationIcao: "" });
    expect(screen.getByRole("button", { name: "At —" })).toBeDisabled();
  });
});

describe("JobFilters — counts", () => {
  it("zero-pads filtered/total counts to two digits", () => {
    renderFilters({ filteredCount: 5, totalCount: 14 });
    expect(screen.getByText("05")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });
});

describe("JobFilters — dev-only telemetry", () => {
  it("hides the last-tick readout and force-tick button when ?dev=1 is not set", () => {
    renderFilters({ lastTick: { inserted: 3, expired: 2 } });
    expect(screen.queryByText(/aged out/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Force tick/i })).toBeNull();
  });

  it("renders both when ?dev=1 is set", async () => {
    const original = window.location.search;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "?dev=1" },
    });
    try {
      const onTickNow = vi.fn();
      renderFilters({ onTickNow, lastTick: { inserted: 3, expired: 2 } });
      expect(screen.getByText("+3 new")).toBeInTheDocument();
      expect(screen.getByText("2 aged out")).toBeInTheDocument();
      const btn = screen.getByRole("button", { name: /Force tick/i });
      await userEvent.setup().click(btn);
      expect(onTickNow).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        writable: true,
        value: { ...window.location, search: original },
      });
    }
  });
});

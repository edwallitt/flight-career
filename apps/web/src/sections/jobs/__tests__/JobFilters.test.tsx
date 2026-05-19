import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JobFilters } from "../JobFilters.js";

function renderFilters(overrides: Partial<React.ComponentProps<typeof JobFilters>> = {}) {
  const props: React.ComponentProps<typeof JobFilters> = {
    roleFilter: "all",
    setRoleFilter: vi.fn(),
    classFilter: "any",
    setClassFilter: vi.fn(),
    reachableOnly: false,
    setReachableOnly: vi.fn(),
    atMyLocationOnly: false,
    setAtMyLocationOnly: vi.fn(),
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

describe("JobFilters — role + class chips", () => {
  it("renders all six role codes and all four class chips", () => {
    renderFilters();
    for (const code of ["ALL", "BSH", "ATX", "LJT", "OPN", "FRY"]) {
      expect(screen.getByRole("button", { name: code })).toBeInTheDocument();
    }
    for (const label of ["Any", "SEP", "MEP", "SET", "JET"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("invokes setRoleFilter with the selected role id", async () => {
    const setRoleFilter = vi.fn();
    renderFilters({ setRoleFilter });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "BSH" }));
    expect(setRoleFilter).toHaveBeenCalledWith("bush");
    await user.click(screen.getByRole("button", { name: "FRY" }));
    expect(setRoleFilter).toHaveBeenCalledWith("ferry");
  });

  it("invokes setClassFilter with the selected class id", async () => {
    const setClassFilter = vi.fn();
    renderFilters({ setClassFilter });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "MEP" }));
    expect(setClassFilter).toHaveBeenCalledWith("MEP");
  });
});

describe("JobFilters — reachable + at-my-location toggles", () => {
  it("toggles reachableOnly via aria-pressed and click", async () => {
    const setReachableOnly = vi.fn();
    renderFilters({ reachableOnly: false, setReachableOnly });
    const btn = screen.getByRole("button", { name: /Reachable only/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(btn);
    expect(setReachableOnly).toHaveBeenCalledWith(true);
  });

  it("renders aria-pressed=true when reachableOnly is enabled", () => {
    renderFilters({ reachableOnly: true });
    expect(
      screen.getByRole("button", { name: /Reachable only/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the player ICAO in the at-my-location toggle and toggles it", async () => {
    const setAtMyLocationOnly = vi.fn();
    renderFilters({ playerLocationIcao: "CYQM", setAtMyLocationOnly });
    const toggle = screen.getByRole("button", { name: /CYQM/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).not.toBeDisabled();
    await userEvent.setup().click(toggle);
    expect(setAtMyLocationOnly).toHaveBeenCalledWith(true);
  });

  it("disables the at-my-location toggle when player location is unknown", () => {
    renderFilters({ playerLocationIcao: "" });
    const toggle = screen.getByRole("button", { name: /@/ });
    expect(toggle).toBeDisabled();
  });
});

describe("JobFilters — counts + lastTick readout", () => {
  it("zero-pads filtered/total counts to two digits", () => {
    renderFilters({ filteredCount: 5, totalCount: 14 });
    expect(screen.getByText("05")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("omits the last-tick readout when no lastTick is supplied", () => {
    renderFilters();
    expect(screen.queryByText(/aged out/)).toBeNull();
  });

  it("shows +N new / N aged out when lastTick is supplied", () => {
    renderFilters({ lastTick: { inserted: 3, expired: 2 } });
    expect(screen.getByText("+3 new")).toBeInTheDocument();
    expect(screen.getByText("2 aged out")).toBeInTheDocument();
  });
});

describe("JobFilters — dev tick button", () => {
  it("is hidden when ?dev=1 is not set", () => {
    renderFilters();
    expect(screen.queryByRole("button", { name: /Force tick/i })).toBeNull();
  });

  it("renders and triggers onTickNow when ?dev=1 is set", async () => {
    const original = window.location.search;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "?dev=1" },
    });
    try {
      const onTickNow = vi.fn();
      renderFilters({ onTickNow });
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

  it("shows 'Ticking…' state when isTicking is true", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "?dev=1" },
    });
    renderFilters({ isTicking: true });
    expect(screen.getByRole("button", { name: /Ticking/i })).toBeDisabled();
  });
});

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import {
  ManualCompletionModal,
  type TrackedPrefill,
} from "../ManualCompletionModal.js";

const JOB = {
  id: 42,
  originIcao: "CYHZ",
  destinationIcao: "CYQM",
  destinationName: "Greater Moncton Intl",
  distanceNm: 100,
};

const AIRCRAFT = {
  cruiseSpeedKts: 176,
  fuelBurnGph: 17,
};

const ICAO_OPTIONS = [
  { icao: "CYHZ", name: "Halifax Stanfield Intl" },
  { icao: "CYQM", name: "Greater Moncton Intl" },
  { icao: "CYCH", name: "Miramichi" },
];

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ManualCompletionModal>> = {},
) {
  const props: React.ComponentProps<typeof ManualCompletionModal> = {
    job: JOB,
    aircraft: AIRCRAFT,
    elapsedMs: 0,
    tracked: null,
    isPending: false,
    errorMessage: null,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...renderWithProviders(<ManualCompletionModal {...props} />, {
      seed: ({ seedQuery }) => {
        seedQuery(["airports", "icaoOptions"], ICAO_OPTIONS);
      },
    }),
  };
}

describe("ManualCompletionModal — default seeding", () => {
  it("seeds the destination with the filed ICAO and shows the 'Filed destination' chip", () => {
    renderModal();
    const dest = screen.getByLabelText(/Actual destination/i) as HTMLInputElement;
    expect(dest.value).toBe("CYQM");
    expect(screen.getByText(/Filed destination/i)).toBeInTheDocument();
  });

  it("seeds block time from elapsedMs when it's > 1 minute, otherwise from the cruise estimate", () => {
    // elapsedMs = 0 → falls back to estimatedBlockMin = round(100/176*60) = 34
    const { unmount } = renderModal({ elapsedMs: 0 });
    const blockInput = screen.getByLabelText(/Block time/i) as HTMLInputElement;
    expect(blockInput.value).toBe("34");
    unmount();

    // elapsedMs = 90s → still falls back to estimate (needs > 60s).
    renderModal({ elapsedMs: 90_000 });
    expect((screen.getByLabelText(/Block time/i) as HTMLInputElement).value).toBe("2");
  });

  it("shows the 'Manual completion' label and explainer when no tracking data", () => {
    renderModal();
    expect(screen.getByText(/Manual completion · #00042/i)).toBeInTheDocument();
    expect(
      screen.getByText(/MSFS isn't connected — enter what actually happened/i),
    ).toBeInTheDocument();
  });
});

describe("ManualCompletionModal — diversion detection", () => {
  it("typing a different destination flips the chip to 'Diversion · pay & rep affected'", async () => {
    renderModal();
    const dest = screen.getByLabelText(/Actual destination/i) as HTMLInputElement;
    const user = userEvent.setup();
    await user.clear(dest);
    await user.type(dest, "cych");
    expect(dest.value).toBe("CYCH"); // input uppercases as you type
    expect(
      screen.getByText(/Diversion · pay & rep affected/i),
    ).toBeInTheDocument();
  });

  it("truncates destination input at 8 chars", async () => {
    renderModal();
    const dest = screen.getByLabelText(/Actual destination/i) as HTMLInputElement;
    const user = userEvent.setup();
    await user.clear(dest);
    await user.type(dest, "AAAAAAAAAA"); // 10 chars
    expect(dest.value.length).toBe(8);
  });
});

describe("ManualCompletionModal — tracked auto-fill", () => {
  function makeTracked(overrides: Partial<TrackedPrefill> = {}): TrackedPrefill {
    return {
      available: true,
      hasTrackingData: true,
      blockTimeMinutes: 68,
      fuelBurnedGal: 19.4,
      resolvedDestinationIcao: "CYQM",
      destinationResolution: "matched",
      isDiversion: false,
      ...overrides,
    };
  }

  it("prefills block / fuel / destination from tracked data when sim is usable", () => {
    renderModal({ tracked: makeTracked() });
    expect(screen.getByText(/Tracked completion · #00042/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/Block time/i) as HTMLInputElement).value).toBe("68");
    expect((screen.getByLabelText(/Fuel burned/i) as HTMLInputElement).value).toBe("19.4");
    expect((screen.getByLabelText(/Actual destination/i) as HTMLInputElement).value).toBe("CYQM");
    expect(
      screen.getByText(/Auto-filled from MSFS. Edit any field before submitting/i),
    ).toBeInTheDocument();
  });

  it("surfaces the diversion warning when tracked flight diverted", () => {
    renderModal({
      tracked: makeTracked({
        isDiversion: true,
        resolvedDestinationIcao: "CYCH",
        destinationResolution: "diverted",
      }),
    });
    expect(
      screen.getByText(/Diversion detected — landed at CYCH \(planned CYQM\)/i),
    ).toBeInTheDocument();
  });

  it("leaves destination empty + shows the 'couldn't auto-detect' warning when unresolved", () => {
    renderModal({
      tracked: makeTracked({
        resolvedDestinationIcao: null,
        destinationResolution: "unresolved",
      }),
    });
    expect((screen.getByLabelText(/Actual destination/i) as HTMLInputElement).value).toBe("");
    expect(
      screen.getByText(/Couldn't auto-detect destination/i),
    ).toBeInTheDocument();
  });

  it("treats hasTrackingData=false as untracked (no auto-fill, no diversion chip)", () => {
    renderModal({
      tracked: makeTracked({
        available: true,
        hasTrackingData: false,
        blockTimeMinutes: null,
        fuelBurnedGal: null,
      }),
    });
    expect(screen.getByText(/Manual completion · #00042/i)).toBeInTheDocument();
    // Block time falls back to the cruise estimate (34 min).
    expect((screen.getByLabelText(/Block time/i) as HTMLInputElement).value).toBe("34");
  });

  it("flips header explainer to 'Edited from MSFS' when the player changes a tracked value", async () => {
    renderModal({ tracked: makeTracked() });
    const block = screen.getByLabelText(/Block time/i) as HTMLInputElement;
    await userEvent.setup().type(block, "9"); // appends → "689"
    expect(
      screen.getByText(/Edited from MSFS auto-fill — your values will be logged/i),
    ).toBeInTheDocument();
  });
});

describe("ManualCompletionModal — validation + submit", () => {
  it("Submit is disabled with an empty destination", async () => {
    renderModal();
    const dest = screen.getByLabelText(/Actual destination/i) as HTMLInputElement;
    await userEvent.setup().clear(dest);
    expect(screen.getByRole("button", { name: /Submit flight/i })).toBeDisabled();
  });

  it("Submit is disabled when block time is zero or empty", async () => {
    renderModal();
    const block = screen.getByLabelText(/Block time/i) as HTMLInputElement;
    const user = userEvent.setup();
    await user.clear(block);
    expect(screen.getByRole("button", { name: /Submit flight/i })).toBeDisabled();
    await user.type(block, "0");
    expect(screen.getByRole("button", { name: /Submit flight/i })).toBeDisabled();
  });

  it("Submit fires onSubmit with the parsed values and uppercased ICAO", async () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    const user = userEvent.setup();
    const block = screen.getByLabelText(/Block time/i) as HTMLInputElement;
    await user.clear(block);
    await user.type(block, "75");
    const fuel = screen.getByLabelText(/Fuel burned/i) as HTMLInputElement;
    await user.type(fuel, "18.2");
    await user.click(screen.getByRole("button", { name: /Submit flight/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      actualDestinationIcao: "CYQM",
      blockTimeMinutes: 75,
      fuelBurnedGal: 18.2,
    });
  });

  it("omits fuelBurnedGal from the payload when the field is left blank", async () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Submit flight/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      actualDestinationIcao: "CYQM",
      blockTimeMinutes: 34,
      fuelBurnedGal: undefined, // explicit undefined when the field is blank
    });
  });

  it("shows the 'Logging…' label and disables Submit while isPending", () => {
    renderModal({ isPending: true });
    const btn = screen.getByRole("button", { name: /Logging/i });
    expect(btn).toBeDisabled();
  });

  it("renders the errorMessage banner when provided", () => {
    renderModal({ errorMessage: "Server timeout — try again" });
    expect(
      screen.getByText(/Server timeout — try again/i),
    ).toBeInTheDocument();
  });
});

describe("ManualCompletionModal — close", () => {
  it("Back button + Close button + Escape all call onClose", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Close/i }));
    await user.click(screen.getByRole("button", { name: /Back/i }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

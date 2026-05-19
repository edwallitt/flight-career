import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/helpers/renderWithProviders.js";
import { Career } from "../Career.js";

const SIM_NOW = Date.UTC(2026, 4, 12, 12, 0);

function makeRating(cls: "SEP" | "MEP" | "SET" | "JET", overrides: any = {}): any {
  return {
    class: cls,
    earned: cls === "SEP",
    earnedAt: cls === "SEP" ? SIM_NOW - 365 * 86_400_000 : null,
    hoursInClass: 0,
    totalHours: 0,
    requirement:
      cls === "SEP"
        ? null
        : {
            hourGate: 50,
            examCostCents: 300_000,
            examLeadDays: 3,
          },
    eligibility:
      cls === "SEP"
        ? null
        : { eligible: false, reasons: [{ kind: "hour_gate", message: "50 hrs total needed" }] },
    pendingExam: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: any = {}): any {
  return {
    pilotName: "Test Pilot",
    cash: 50_000_00,
    simNow: SIM_NOW,
    ratings: [
      makeRating("SEP"),
      makeRating("MEP"),
      makeRating("SET"),
      makeRating("JET"),
    ],
    reputation: {
      byRole: [
        { role: "bush", score: 35, tier: "mid", flightCount: 5 },
        { role: "air_taxi", score: 12, tier: "novice", flightCount: 1 },
        { role: "light_jet", score: 0, tier: "novice", flightCount: 0 },
      ],
      byClient: [],
    },
    milestones: {
      careerStartedAt: SIM_NOW - 90 * 86_400_000,
      simNow: SIM_NOW,
      totalFlights: 6,
      totalBlockMinutes: 480,
      totalEarnings: 1_200_00,
      totalDistanceNm: 850,
      longestFlight: {
        distanceNm: 220,
        originIcao: "CYHZ",
        destinationIcao: "CYQM",
      },
      aircraftOwned: 1,
      uniqueAirportsVisited: 7,
      favoriteRoute: { origin: "CYHZ", destination: "CYCH", count: 3 },
      topClient: {
        clientId: "maritime_cargo",
        name: "Maritime Cargo Express",
        flightCount: 4,
        totalEarnings: 850_00,
      },
    },
    ...overrides,
  };
}

describe("Career — loading + shell", () => {
  it("shows 'Loading dossier…' while the snapshot is pending", () => {
    renderWithProviders(<Career />);
    expect(screen.getByText(/Loading dossier/i)).toBeInTheDocument();
  });

  it("renders the dossier sections when the snapshot resolves", () => {
    renderWithProviders(<Career />, {
      seed: ({ seedQuery }) => {
        seedQuery(["career", "snapshot"], makeSnapshot());
      },
    });
    // CareerHeader, RatingsSection, ReputationSection, Milestones all render.
    expect(screen.getByText(/Pilot dossier/i)).toBeInTheDocument();
    expect(screen.getByText(/End of dossier/i)).toBeInTheDocument();
  });
});

describe("Career — ratings + exam modal", () => {
  it("clicking 'Book exam' on an eligible class opens the booking modal", async () => {
    renderWithProviders(<Career />, {
      seed: ({ seedQuery }) => {
        seedQuery(
          ["career", "snapshot"],
          makeSnapshot({
            ratings: [
              makeRating("SEP", { earned: true, hoursInClass: 60 }),
              makeRating("MEP", {
                eligibility: { eligible: true, reasons: [] },
              }),
              makeRating("SET"),
              makeRating("JET"),
            ],
          }),
        );
        // RatingsSection reads cash from career.get (not from the snapshot
        // payload, which has its own cash field for the header).
        seedQuery(["career", "get"], { cash: 1_000_000_00 });
      },
    });
    const bookBtn = screen.getByRole("button", { name: /Book exam/i });
    await userEvent.setup().click(bookBtn);
    expect(screen.getByText(/Career · Book exam/i)).toBeInTheDocument();
    // The modal shows "MEP" prominently in its title.
    expect(screen.getAllByText(/MEP/).length).toBeGreaterThan(1);
  });

  it("booking confirm fires career.bookExam mutation with the class", async () => {
    const bookExam = vi.fn(() => ({
      ok: true as const,
      examId: 7,
      cost: 300_000,
      scheduledFor: SIM_NOW + 3 * 86_400_000,
    }));
    renderWithProviders(<Career />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["career", "snapshot"],
          makeSnapshot({
            ratings: [
              makeRating("SEP", { earned: true, hoursInClass: 60 }),
              makeRating("MEP", {
                eligibility: { eligible: true, reasons: [] },
              }),
              makeRating("SET"),
              makeRating("JET"),
            ],
          }),
        );
        seedQuery(["career", "get"], { cash: 1_000_000_00 });
        mockMutation(["career", "bookExam"], bookExam);
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Book exam/i }));
    // Modal opens — confirm button text is "Book exam · $X" or similar; match
    // the primary action inside the dialog.
    const confirmBtn = await screen.findByRole("button", {
      name: /^Confirm booking$/i,
    });
    await user.click(confirmBtn);
    await waitFor(() =>
      expect(bookExam).toHaveBeenCalledWith({ class: "MEP" }),
    );
  });

  it("clicking 'Cancel exam' on a pending exam fires career.cancelExam with the examId", async () => {
    const cancelExam = vi.fn(() => ({
      ok: true as const,
      refundCents: 150_000,
    }));
    renderWithProviders(<Career />, {
      seed: ({ seedQuery, mockMutation }) => {
        seedQuery(
          ["career", "snapshot"],
          makeSnapshot({
            ratings: [
              makeRating("SEP", { earned: true }),
              makeRating("MEP", {
                pendingExam: {
                  id: 99,
                  bookedAt: SIM_NOW - 86_400_000,
                  scheduledFor: SIM_NOW + 2 * 86_400_000,
                  cost: 300_000,
                },
                eligibility: { eligible: false, reasons: [] },
              }),
              makeRating("SET"),
              makeRating("JET"),
            ],
          }),
        );
        seedQuery(["career", "get"], { cash: 1_000_000_00 });
        mockMutation(["career", "cancelExam"], cancelExam);
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Cancel · 50% refund/i }));
    expect(screen.getByText(/Career · Cancel exam/i)).toBeInTheDocument();
    const confirmCancel = await screen.findByRole("button", {
      name: /^Cancel exam$/i,
    });
    await user.click(confirmCancel);
    await waitFor(() =>
      expect(cancelExam).toHaveBeenCalledWith({ examId: 99 }),
    );
  });
});

describe("Career — reputation + milestones", () => {
  it("renders per-role reputation with score and flight count", () => {
    renderWithProviders(<Career />, {
      seed: ({ seedQuery }) => {
        seedQuery(["career", "snapshot"], makeSnapshot());
      },
    });
    // The 'Bush' label appears for the role row.
    expect(screen.getByText(/Bush/)).toBeInTheDocument();
    expect(screen.getByText(/Air Taxi/)).toBeInTheDocument();
  });

  it("renders milestone tiles for flights, hours, and earnings", () => {
    renderWithProviders(<Career />, {
      seed: ({ seedQuery }) => {
        seedQuery(["career", "snapshot"], makeSnapshot());
      },
    });
    // 6 flights, 480 block min = 8h. Values appear as tabular nums.
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/CYHZ → CYQM/)).toBeInTheDocument(); // longest flight route
  });

  it("renders the top client name when set", () => {
    renderWithProviders(<Career />, {
      seed: ({ seedQuery }) => {
        seedQuery(["career", "snapshot"], makeSnapshot());
      },
    });
    expect(screen.getByText("Maritime Cargo Express")).toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import {
  RATING_REQUIREMENTS,
  checkExamEligibility,
  totalHours,
  type RatingState,
} from "../ratingRequirements.js";

const NO_RATINGS: RatingState["ratingsEarned"] = {
  SEP: true,
  MEP: false,
  SET: false,
  JET: false,
};

function state(over: Partial<RatingState> = {}): RatingState {
  return {
    ratingsEarned: NO_RATINGS,
    hoursInClass: { SEP: 0, MEP: 0, SET: 0, JET: 0 },
    pendingExamForClass: false,
    ...over,
  };
}

describe("RATING_REQUIREMENTS", () => {
  it("has no requirement for SEP", () => {
    expect(RATING_REQUIREMENTS.SEP).toBeNull();
  });

  it("defines requirements for MEP, SET, JET", () => {
    expect(RATING_REQUIREMENTS.MEP).not.toBeNull();
    expect(RATING_REQUIREMENTS.SET).not.toBeNull();
    expect(RATING_REQUIREMENTS.JET).not.toBeNull();
  });
});

describe("totalHours", () => {
  it("sums hours across all classes", () => {
    expect(totalHours({ SEP: 10, MEP: 5, SET: 2, JET: 0 })).toBe(17);
  });
});

describe("checkExamEligibility", () => {
  it("rejects SEP (no requirement)", () => {
    const out = checkExamEligibility("SEP", state());
    expect(out.eligible).toBe(false);
    expect(out.reasons[0]?.requirement).toBe("no_requirement");
  });

  it("rejects already-earned class", () => {
    const out = checkExamEligibility(
      "MEP",
      state({ ratingsEarned: { ...NO_RATINGS, MEP: true } }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons[0]?.requirement).toBe("already_earned");
  });

  it("rejects when an exam is already pending", () => {
    const out = checkExamEligibility(
      "MEP",
      state({
        hoursInClass: { SEP: 30, MEP: 0, SET: 0, JET: 0 },
        pendingExamForClass: true,
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons[0]?.requirement).toBe("exam_pending");
  });

  it("rejects when total hours below gate", () => {
    const out = checkExamEligibility(
      "MEP",
      state({ hoursInClass: { SEP: 10, MEP: 0, SET: 0, JET: 0 } }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons.some((r) => r.requirement === "hour_gate")).toBe(true);
  });

  it("rejects when class-specific hours missing", () => {
    // JET requires 200 total + 75 SET — give 200 total in SEP only
    const out = checkExamEligibility(
      "JET",
      state({ hoursInClass: { SEP: 200, MEP: 0, SET: 0, JET: 0 } }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons.some((r) => r.requirement === "class_specific")).toBe(
      true,
    );
  });

  it("accepts when all gates satisfied", () => {
    const out = checkExamEligibility(
      "MEP",
      state({ hoursInClass: { SEP: 30, MEP: 0, SET: 0, JET: 0 } }),
    );
    expect(out.eligible).toBe(true);
    expect(out.reasons).toHaveLength(0);
  });

  it("returns progress numbers on hour-gate failure", () => {
    const out = checkExamEligibility(
      "SET",
      state({ hoursInClass: { SEP: 30, MEP: 0, SET: 0, JET: 0 } }),
    );
    const hg = out.reasons.find((r) => r.requirement === "hour_gate");
    expect(hg?.progress).toEqual({ current: 30, required: 50 });
  });
});

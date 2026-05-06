import type { AircraftClass } from "../clients/types.js";

export interface RatingRequirement {
  class: AircraftClass;
  hourGate: number;
  classSpecificGate?: {
    inClass: AircraftClass;
    hours: number;
  };
  examCostCents: number;
  examLeadDays: number;
}

export const RATING_REQUIREMENTS: Record<AircraftClass, RatingRequirement | null> = {
  SEP: null,
  MEP: {
    class: "MEP",
    hourGate: 25,
    classSpecificGate: { inClass: "SEP", hours: 25 },
    examCostCents: 300_000,
    examLeadDays: 3,
  },
  SET: {
    class: "SET",
    hourGate: 50,
    classSpecificGate: { inClass: "SEP", hours: 20 },
    examCostCents: 800_000,
    examLeadDays: 5,
  },
  JET: {
    class: "JET",
    hourGate: 200,
    classSpecificGate: { inClass: "SET", hours: 75 },
    examCostCents: 2_500_000,
    examLeadDays: 7,
  },
};

export type ExamEligibilityReasonKind =
  | "hour_gate"
  | "class_specific"
  | "already_earned"
  | "exam_pending"
  | "no_requirement";

export interface ExamEligibilityReason {
  requirement: ExamEligibilityReasonKind;
  message: string;
  progress?: { current: number; required: number };
}

export interface EligibilityCheck {
  eligible: boolean;
  reasons: ExamEligibilityReason[];
}

export interface RatingState {
  ratingsEarned: Record<AircraftClass, boolean>;
  hoursInClass: Record<AircraftClass, number>;
  pendingExamForClass: boolean;
}

export function totalHours(hoursInClass: Record<AircraftClass, number>): number {
  return (
    (hoursInClass.SEP ?? 0) +
    (hoursInClass.MEP ?? 0) +
    (hoursInClass.SET ?? 0) +
    (hoursInClass.JET ?? 0)
  );
}

export function checkExamEligibility(
  forClass: AircraftClass,
  state: RatingState,
): EligibilityCheck {
  const req = RATING_REQUIREMENTS[forClass];
  if (!req) {
    return {
      eligible: false,
      reasons: [
        {
          requirement: "no_requirement",
          message: `${forClass} has no exam requirement`,
        },
      ],
    };
  }

  if (state.ratingsEarned[forClass]) {
    return {
      eligible: false,
      reasons: [
        {
          requirement: "already_earned",
          message: `${forClass} rating already earned`,
        },
      ],
    };
  }

  if (state.pendingExamForClass) {
    return {
      eligible: false,
      reasons: [
        {
          requirement: "exam_pending",
          message: `An exam for ${forClass} is already booked`,
        },
      ],
    };
  }

  const reasons: ExamEligibilityReason[] = [];

  const total = totalHours(state.hoursInClass);
  if (total < req.hourGate) {
    reasons.push({
      requirement: "hour_gate",
      message: `Need ${req.hourGate} total hours (${total.toFixed(1)} flown)`,
      progress: { current: total, required: req.hourGate },
    });
  }

  if (req.classSpecificGate) {
    const have = state.hoursInClass[req.classSpecificGate.inClass] ?? 0;
    if (have < req.classSpecificGate.hours) {
      reasons.push({
        requirement: "class_specific",
        message: `Need ${req.classSpecificGate.hours} hours in ${req.classSpecificGate.inClass} (${have.toFixed(1)} flown)`,
        progress: {
          current: have,
          required: req.classSpecificGate.hours,
        },
      });
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

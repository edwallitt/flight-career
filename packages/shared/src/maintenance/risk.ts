// Maintenance risk assessment.
//
// Pure logic: takes the just-updated maintenance counters for an aircraft and
// produces a tier + per-flight-hour probability of an unscheduled event. The
// probability is internal — UI only ever sees the qualitative tier and the
// list of contributing factors.

const BASE_PROBABILITY_PER_HOUR = 0.005;
const PROBABILITY_CAP = 0.5;

const DAYS_PER_MONTH = 30;
const HARD_LIMIT_ANNUAL_DAYS_OVERDUE = 18 * DAYS_PER_MONTH; // 540
const HARD_LIMIT_ENGINE_RATIO = 1.1;

export type RiskTier = "healthy" | "monitor" | "elevated" | "high" | "critical";

export type RiskFactorKind =
  | "hours_since_100hr"
  | "days_since_annual"
  | "engine_tbo_ratio"
  | "airframe_age";

export type RiskFactorSeverity =
  | "minor"
  | "moderate"
  | "significant"
  | "severe";

export interface RiskFactor {
  factor: RiskFactorKind;
  severity: RiskFactorSeverity;
  description: string;
}

export interface RiskAssessment {
  tier: RiskTier;
  probabilityPerFlightHour: number;
  factors: RiskFactor[];
  cannotDispatch: boolean;
  cannotDispatchReason?: string;
}

export interface RiskInputs {
  hoursSince100hr: number;
  // Stored as days-equivalent — same field name used by the schema/services.
  hoursSinceAnnual: number;
  engineHoursSinceOverhaul: number;
  tboHours: number;
  airframeHours: number;
}

interface FactorBucket {
  multiplier: number;
  factor: RiskFactor | null;
  hardLimit?: string;
}

function hundredHourBucket(hours: number): FactorBucket {
  const overdue = Math.max(0, hours - 100);
  if (hours <= 100) return { multiplier: 1, factor: null };
  const description = `100-hour inspection overdue by ${Math.round(overdue)} hours`;
  if (hours <= 110) {
    return {
      multiplier: 2.5,
      factor: { factor: "hours_since_100hr", severity: "minor", description },
    };
  }
  if (hours <= 130) {
    return {
      multiplier: 6,
      factor: { factor: "hours_since_100hr", severity: "moderate", description },
    };
  }
  return {
    multiplier: 15,
    factor: { factor: "hours_since_100hr", severity: "significant", description },
  };
}

function annualBucket(days: number): FactorBucket {
  if (days <= 365) return { multiplier: 1, factor: null };
  const overdueDays = Math.round(days - 365);
  const overdueMonths = Math.round(overdueDays / DAYS_PER_MONTH);
  const description =
    overdueDays < DAYS_PER_MONTH
      ? `Annual inspection overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}`
      : `Annual inspection overdue by ~${overdueMonths} month${overdueMonths === 1 ? "" : "s"}`;
  if (days >= HARD_LIMIT_ANNUAL_DAYS_OVERDUE) {
    return {
      multiplier: 30,
      factor: { factor: "days_since_annual", severity: "severe", description },
      hardLimit: "Annual inspection over 18 months overdue",
    };
  }
  if (days <= 395) {
    return {
      multiplier: 2,
      factor: { factor: "days_since_annual", severity: "minor", description },
    };
  }
  if (days <= 455) {
    return {
      multiplier: 5,
      factor: { factor: "days_since_annual", severity: "moderate", description },
    };
  }
  return {
    multiplier: 12,
    factor: { factor: "days_since_annual", severity: "significant", description },
  };
}

function engineBucket(hours: number, tboHours: number): FactorBucket {
  if (tboHours <= 0) return { multiplier: 1, factor: null };
  const ratio = hours / tboHours;
  const pct = Math.round(ratio * 100);
  const baseDescription = `Engine at ${pct}% of TBO`;
  if (ratio >= HARD_LIMIT_ENGINE_RATIO) {
    return {
      multiplier: 30,
      factor: {
        factor: "engine_tbo_ratio",
        severity: "severe",
        description: baseDescription,
      },
      hardLimit: "Engine over 10% past TBO",
    };
  }
  if (ratio < 0.85) return { multiplier: 1, factor: null };
  if (ratio < 1.0) {
    return {
      multiplier: 2,
      factor: {
        factor: "engine_tbo_ratio",
        severity: "minor",
        description: baseDescription,
      },
    };
  }
  if (ratio < 1.05) {
    return {
      multiplier: 5,
      factor: {
        factor: "engine_tbo_ratio",
        severity: "moderate",
        description: baseDescription,
      },
    };
  }
  return {
    multiplier: 12,
    factor: {
      factor: "engine_tbo_ratio",
      severity: "significant",
      description: baseDescription,
    },
  };
}

function airframeBucket(hours: number): FactorBucket {
  if (hours < 5000) return { multiplier: 1, factor: null };
  if (hours < 10000) {
    return {
      multiplier: 1.2,
      factor: {
        factor: "airframe_age",
        severity: "minor",
        description: `High-time airframe (${Math.round(hours).toLocaleString()} hrs)`,
      },
    };
  }
  return {
    multiplier: 1.5,
    factor: {
      factor: "airframe_age",
      severity: "moderate",
      description: `Very high-time airframe (${Math.round(hours).toLocaleString()} hrs)`,
    },
  };
}

function tierFor(probability: number): RiskTier {
  if (probability < 0.01) return "healthy";
  if (probability < 0.025) return "monitor";
  if (probability < 0.06) return "elevated";
  if (probability < 0.15) return "high";
  return "critical";
}

export function assessRisk(inputs: RiskInputs): RiskAssessment {
  const buckets: FactorBucket[] = [
    hundredHourBucket(inputs.hoursSince100hr),
    annualBucket(inputs.hoursSinceAnnual),
    engineBucket(inputs.engineHoursSinceOverhaul, inputs.tboHours),
    airframeBucket(inputs.airframeHours),
  ];

  let probability = BASE_PROBABILITY_PER_HOUR;
  for (const b of buckets) probability *= b.multiplier;
  if (probability > PROBABILITY_CAP) probability = PROBABILITY_CAP;

  const factors: RiskFactor[] = [];
  for (const b of buckets) {
    if (b.factor) factors.push(b.factor);
  }

  const hardLimits = buckets.map((b) => b.hardLimit).filter(Boolean) as string[];
  const cannotDispatch = hardLimits.length > 0;

  const assessment: RiskAssessment = {
    tier: tierFor(probability),
    probabilityPerFlightHour: probability,
    factors,
    cannotDispatch,
  };
  if (cannotDispatch) {
    assessment.cannotDispatchReason = hardLimits.join("; ");
  }
  return assessment;
}

// Player-friendly tier labels for UI surfaces.
export const RISK_TIER_LABEL: Record<RiskTier, string> = {
  healthy: "Healthy",
  monitor: "Monitor",
  elevated: "Elevated",
  high: "High",
  critical: "Critical",
};

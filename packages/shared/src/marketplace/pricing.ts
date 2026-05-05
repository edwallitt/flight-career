export type ConditionGrade =
  | "pristine"
  | "excellent"
  | "good"
  | "fair"
  | "project";

export interface PricingInputs {
  basePurchasePriceCents: number;
  airframeHours: number;
  engineHoursSinceOverhaul: number;
  tboHours: number;
  hoursSinceAnnual: number;
  hoursSince100hr: number;
  conditionGrade: ConditionGrade;
}

export interface PricingResult {
  askingPriceCents: number;
  estimatedConditionGrade: ConditionGrade;
  depreciationFactor: number;
  factorBreakdown: {
    airframeAge: number;
    engineRemaining: number;
    inspectionState: number;
    conditionAdjustment: number;
  };
}

const FLOOR_FRACTION = 0.25;
const PRICE_ROUND_CENTS = 100_000;

function lerp(t: number, a: number, b: number): number {
  return a + (b - a) * t;
}

function airframeAgeAdjustment(hours: number): number {
  if (hours <= 0) return 0;
  if (hours <= 500) return lerp(hours / 500, 0, -0.08);
  if (hours <= 2000) return lerp((hours - 500) / 1500, -0.08, -0.22);
  if (hours <= 5000) return lerp((hours - 2000) / 3000, -0.22, -0.38);
  if (hours <= 10000) return lerp((hours - 5000) / 5000, -0.38, -0.5);
  return -0.5;
}

function engineRemainingAdjustment(
  engineHoursSinceOverhaul: number,
  tboHours: number,
): number {
  if (tboHours <= 0) return 0;
  const ratio = Math.max(0, engineHoursSinceOverhaul / tboHours);
  if (ratio < 0.3) return 0;
  if (ratio < 0.6) return -0.05;
  if (ratio < 0.85) return -0.15;
  return -0.25;
}

function inspectionStateAdjustment(
  hoursSinceAnnual: number,
  hoursSince100hr: number,
): number {
  let adj = 0;
  if (hoursSinceAnnual < 90) adj += 0.03;
  if (hoursSinceAnnual > 320) adj -= 0.05;
  if (hoursSince100hr > 95) adj -= 0.03;
  return adj;
}

const CONDITION_ADJUSTMENT: Record<ConditionGrade, number> = {
  pristine: 0.05,
  excellent: 0,
  good: -0.05,
  fair: -0.12,
  project: -0.2,
};

function roundDown(cents: number, step: number): number {
  return Math.max(0, Math.floor(cents / step) * step);
}

export function priceAircraft(inputs: PricingInputs): PricingResult {
  const airframeAge = airframeAgeAdjustment(inputs.airframeHours);
  const engineRemaining = engineRemainingAdjustment(
    inputs.engineHoursSinceOverhaul,
    inputs.tboHours,
  );
  const inspectionState = inspectionStateAdjustment(
    inputs.hoursSinceAnnual,
    inputs.hoursSince100hr,
  );
  const conditionAdjustment = CONDITION_ADJUSTMENT[inputs.conditionGrade];

  const totalAdjustment =
    airframeAge + engineRemaining + inspectionState + conditionAdjustment;
  const rawMultiplier = 1 + totalAdjustment;
  const floored = Math.max(rawMultiplier, FLOOR_FRACTION);

  const rawPrice = inputs.basePurchasePriceCents * floored;
  const rounded = roundDown(rawPrice, PRICE_ROUND_CENTS);
  const minPrice = roundDown(
    inputs.basePurchasePriceCents * FLOOR_FRACTION,
    PRICE_ROUND_CENTS,
  );
  const askingPriceCents = Math.max(rounded, minPrice);

  return {
    askingPriceCents,
    estimatedConditionGrade: inputs.conditionGrade,
    depreciationFactor:
      inputs.basePurchasePriceCents > 0
        ? askingPriceCents / inputs.basePurchasePriceCents
        : 0,
    factorBreakdown: {
      airframeAge,
      engineRemaining,
      inspectionState,
      conditionAdjustment,
    },
  };
}

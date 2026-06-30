import type {
  AircraftClass,
  Urgency,
  WeatherSensitivity,
} from "../clients/types.js";

export interface PayInputs {
  distanceNm: number;
  requiredClass: AircraftClass;
  payloadLbs: number;
  urgency: Urgency;
  weatherSensitivity: WeatherSensitivity;
  isUnpavedRequired: boolean;
  isRemoteDestination: boolean;
  basePayMultiplier: number;
  familiarityDiscount: number;
  // Per-client loyalty bonus from reputation standing (0 = none). Applied as a
  // pay *increase* — see loyaltyBonusForScore in ../career/reputation.ts.
  loyaltyBonus: number;
}

const CLASS_RATE_PER_NM: Record<AircraftClass, number> = {
  SEP: 3,
  MEP: 5,
  SET: 8,
  JET: 22,
};

const PAYLOAD_BASELINE_LBS: Record<AircraftClass, number> = {
  SEP: 200,
  MEP: 400,
  SET: 800,
  JET: 600,
};

const URGENCY_MULTIPLIER: Record<Urgency, number> = {
  flexible: 0.95,
  standard: 1.0,
  urgent: 1.25,
  critical: 1.5,
};

const WEATHER_MULTIPLIER: Record<WeatherSensitivity, number> = {
  none: 1.0,
  mild: 1.05,
  strict: 1.15,
};

// Familiarity (anti-"milk run") pricing. A directed route pays less the more
// the player has recently flown it, nudging them to diversify rather than grind
// one hop. Tuned gentle: 3% per recent flight, capped at 20%, so it never
// erases a loyal client's loyalty bonus (which lives on a separate axis).
export const FAMILIARITY_WINDOW_SIM_DAYS = 30;
const FAMILIARITY_DISCOUNT_PER_FLIGHT = 0.03;
export const MAX_FAMILIARITY_DISCOUNT = 0.2;

/** Directed-route key for familiarity bookkeeping. */
export function routeKey(originIcao: string, destinationIcao: string): string {
  return `${originIcao}->${destinationIcao}`;
}

/**
 * Familiarity discount (0–MAX_FAMILIARITY_DISCOUNT) for a route the player has
 * flown `recentFlights` times inside the familiarity window.
 */
export function familiarityDiscountForCount(recentFlights: number): number {
  if (recentFlights <= 0) return 0;
  return Math.min(
    MAX_FAMILIARITY_DISCOUNT,
    recentFlights * FAMILIARITY_DISCOUNT_PER_FLIGHT,
  );
}

export function calculatePay(inputs: PayInputs): number {
  const distancePay = inputs.distanceNm * CLASS_RATE_PER_NM[inputs.requiredClass];

  const baseline = PAYLOAD_BASELINE_LBS[inputs.requiredClass];
  const payloadFactor = Math.max(0, (inputs.payloadLbs - baseline) * 0.5);

  let pay = (distancePay + payloadFactor)
    * URGENCY_MULTIPLIER[inputs.urgency]
    * WEATHER_MULTIPLIER[inputs.weatherSensitivity];

  if (inputs.isUnpavedRequired) pay *= 1.15;
  if (inputs.isRemoteDestination) pay *= 1.20;

  pay *= inputs.basePayMultiplier;
  pay *= 1 - inputs.familiarityDiscount;
  pay *= 1 + inputs.loyaltyBonus;

  return Math.round(pay) * 100;
}

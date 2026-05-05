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

  return Math.round(pay) * 100;
}

// 45-minute IFR-style reserve, in hours of cruise burn.
const RESERVE_HOURS = 0.75;
// 5% safety contingency over trip + reserves.
const CONTINGENCY_FACTOR = 1.05;

// Required total fuel-on-board for a leg: trip burn + reserve + contingency.
// Rounded up to the nearest gallon. Used by the briefing UI to size the
// recommended uplift.
export function requiredTotalFuelGallons(
  distanceNm: number,
  cruiseSpeedKts: number,
  fuelBurnGph: number,
): number {
  if (cruiseSpeedKts <= 0 || fuelBurnGph <= 0) return 0;
  const blockHours = distanceNm / cruiseSpeedKts;
  const tripBurn = blockHours * fuelBurnGph;
  const reserves = RESERVE_HOURS * fuelBurnGph;
  return Math.ceil((tripBurn + reserves) * CONTINGENCY_FACTOR);
}

export interface RecommendedFuelUpliftInput {
  distanceNm: number;
  cruiseSpeedKts: number;
  fuelBurnGph: number;
  fuelCapacityGal: number;
  currentFuelGal: number;
}

// Recommended fuel uplift in gallons given the trip and the aircraft's
// current fuel state. Capped at remaining tank capacity, rounded up to the
// nearest 5 gallons (operational tidiness — fuel trucks dispense in whole
// gallons). Returns 0 when the aircraft is already adequately fueled or
// when there's no headroom.
export function recommendedFuelUplift(args: RecommendedFuelUpliftInput): number {
  const required = requiredTotalFuelGallons(
    args.distanceNm,
    args.cruiseSpeedKts,
    args.fuelBurnGph,
  );
  const headroom = Math.max(0, args.fuelCapacityGal - args.currentFuelGal);
  const need = Math.max(0, required - args.currentFuelGal);
  const capped = Math.min(need, headroom);
  if (capped <= 0) return 0;
  return Math.min(headroom, Math.ceil(capped / 5) * 5);
}

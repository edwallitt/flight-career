export type MaintenanceType = "100hr" | "annual" | "overhaul";

export type MaintenanceAirportRequirement = "maintenance" | "major_maintenance";

export type MaintenanceCounter =
  | "hours_since_100hr"
  | "hours_since_annual"
  | "engine_hours_since_overhaul";

export interface MaintenanceTypeSpec {
  type: MaintenanceType;
  label: string;
  duration: { min: number; max: number };
  airportRequirement: MaintenanceAirportRequirement;
  description: string;
  resetsCounter: MaintenanceCounter;
}

export const MAINTENANCE_SPECS: Record<MaintenanceType, MaintenanceTypeSpec> = {
  "100hr": {
    type: "100hr",
    label: "100-Hour Inspection",
    duration: { min: 1, max: 1 },
    airportRequirement: "maintenance",
    description:
      "Routine inspection required every 100 flight hours. Resets the 100-hour counter.",
    resetsCounter: "hours_since_100hr",
  },
  annual: {
    type: "annual",
    label: "Annual Inspection",
    duration: { min: 3, max: 5 },
    airportRequirement: "maintenance",
    description:
      "Comprehensive annual airworthiness inspection. Required every 12 calendar months. Resets the annual counter.",
    resetsCounter: "hours_since_annual",
  },
  overhaul: {
    type: "overhaul",
    label: "Engine Overhaul",
    duration: { min: 14, max: 28 },
    airportRequirement: "major_maintenance",
    description:
      "Complete engine overhaul. Required at TBO. Resets engine hours and gives the aircraft another full TBO cycle of life.",
    resetsCounter: "engine_hours_since_overhaul",
  },
};

export const MAINTENANCE_TYPES: MaintenanceType[] = ["100hr", "annual", "overhaul"];

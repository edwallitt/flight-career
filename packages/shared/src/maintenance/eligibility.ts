import { MAINTENANCE_SPECS, type MaintenanceType } from "./types.js";

export interface MaintenanceEligibility {
  eligible: boolean;
  reasons: string[];
}

export interface MaintenanceContext {
  aircraft: {
    currentLocationIcao: string;
    status: "available" | "in_maintenance" | "in_flight" | "committed";
    hoursSince100hr: number;
    hoursSinceAnnual: number;
    engineHoursSinceOverhaul: number;
    tboHours: number;
  };
  airport: {
    icao: string;
    hasMaintenance: boolean;
    size: "major" | "regional" | "small" | "remote";
  };
  cost: number;
  cash: number;
}

function statusBlocked(
  status: MaintenanceContext["aircraft"]["status"],
): string | null {
  switch (status) {
    case "available":
      return null;
    case "in_maintenance":
      return "Aircraft is already in maintenance";
    case "in_flight":
      return "Aircraft is in flight";
    case "committed":
      return "Aircraft is committed to a job";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function airportBlocked(
  type: MaintenanceType,
  airport: MaintenanceContext["airport"],
): string | null {
  const spec = MAINTENANCE_SPECS[type];
  if (spec.airportRequirement === "maintenance") {
    if (!airport.hasMaintenance) {
      return `${spec.label} requires a maintenance facility`;
    }
    return null;
  }
  // major_maintenance
  if (!airport.hasMaintenance || airport.size !== "major") {
    return `${spec.label} requires a major-airport maintenance facility`;
  }
  return null;
}

export function checkMaintenanceEligibility(
  type: MaintenanceType,
  ctx: MaintenanceContext,
): MaintenanceEligibility {
  const reasons: string[] = [];

  const statusReason = statusBlocked(ctx.aircraft.status);
  if (statusReason) reasons.push(statusReason);

  const airportReason = airportBlocked(type, ctx.airport);
  if (airportReason) reasons.push(airportReason);

  if (ctx.cash < ctx.cost) {
    const gap = ctx.cost - ctx.cash;
    reasons.push(`Insufficient cash (need $${(gap / 100).toLocaleString()} more)`);
  }

  return { eligible: reasons.length === 0, reasons };
}

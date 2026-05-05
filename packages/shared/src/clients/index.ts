import type { ClientDefinition } from "./types.js";

import acadiaBusiness from "./definitions/acadia_business.js";
import atlanticForestry from "./definitions/atlantic_forestry.js";
import bostonHalifaxExecutive from "./definitions/boston_halifax_executive.js";
import continentalCharter from "./definitions/continental_charter.js";
import eastCoastTours from "./definitions/east_coast_tours.js";
import maritimeCargo from "./definitions/maritime_cargo.js";
import maritimeMedical from "./definitions/maritime_medical.js";
import newfoundlandAirAmbulance from "./definitions/newfoundland_air_ambulance.js";
import northernOutfitters from "./definitions/northern_outfitters.js";
import timeCriticalLogistics from "./definitions/time_critical_logistics.js";

export * from "./types.js";

export const ALL_CLIENTS: ClientDefinition[] = [
  northernOutfitters,
  atlanticForestry,
  maritimeCargo,
  maritimeMedical,
  acadiaBusiness,
  newfoundlandAirAmbulance,
  eastCoastTours,
  bostonHalifaxExecutive,
  continentalCharter,
  timeCriticalLogistics,
];

const CLIENTS_BY_ID = new Map(ALL_CLIENTS.map((c) => [c.id, c]));

export function getClientById(id: string): ClientDefinition | undefined {
  return CLIENTS_BY_ID.get(id);
}

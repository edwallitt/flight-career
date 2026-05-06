import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";

type RouterOutput = inferRouterOutputs<AppRouter>;

export type CandidatesForJobOutput = NonNullable<
  RouterOutput["aircraft"]["candidatesForJob"]
>;
export type RankedCandidate = CandidatesForJobOutput["ranked"][number];
export type ActiveJobSnapshot = NonNullable<
  RouterOutput["lifecycle"]["getActiveJob"]
>;

export type AircraftSelection =
  | { source: "owned"; ownedAircraftId: number; aircraftTypeId: string }
  | { source: "rental"; rentalAircraftTypeId: string };

export const REASON_LABEL: Record<string, string> = {
  OK: "OK",
  NOT_RATED: "Not rated",
  CLASS_TOO_LOW: "Class too low",
  INSUFFICIENT_RANGE: "Range short",
  INSUFFICIENT_PAYLOAD: "Payload over",
  UNPAVED_INCAPABLE: "No unpaved",
  WRONG_LOCATION: "Wrong location",
  AIRCRAFT_UNAVAILABLE: "Unavailable",
  RUNWAY_TOO_SHORT: "Runway short",
  CAPABILITY_MISSING: "Capability missing",
  CANNOT_DISPATCH: "Cannot dispatch",
};

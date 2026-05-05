export type Role = "bush" | "air_taxi" | "light_jet";
export type AircraftClass = "SEP" | "MEP" | "SET" | "JET";
export type PayloadType = "cargo" | "pax" | "medical" | "survey" | "mixed";
export type Urgency = "flexible" | "standard" | "urgent" | "critical";
export type WeatherSensitivity = "none" | "mild" | "strict";

export interface RouteTemplate {
  originCandidates: string[];
  destinationCandidates: string[];
}

export interface JobTemplate {
  weight: number;
  payloadType: PayloadType;
  payloadLbsRange: [number, number];
  paxCountRange?: [number, number];
  minClass: AircraftClass;
  requiredCapabilities: string[];
  urgency: Urgency;
  weatherSensitivity: WeatherSensitivity;
  basePayMultiplier: number;
  routeTemplate: RouteTemplate;
  legCount?: number;
  description: (route: { origin: string; destination: string }) => string;
}

export interface ClientDefinition {
  id: string;
  name: string;
  role: Role;
  homeBaseIcao: string;
  description: string;
  baseJobsPerDay: number;
  seasonalMultipliers: number[];
  reputationGateMin: number;
  reputationGateMax: number;
  standardTemplates: JobTemplate[];
  premiumTemplates: JobTemplate[];
}

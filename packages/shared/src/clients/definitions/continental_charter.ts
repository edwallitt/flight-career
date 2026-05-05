import type { ClientDefinition } from "../types.js";

const continentalCharter: ClientDefinition = {
  id: "continental_charter",
  name: "Continental Charter Network",
  role: "light_jet",
  homeBaseIcao: "KBOS",
  description:
    "International broker placing higher-end jet charters; for now they ride the regional network until the broader map opens up.",
  baseJobsPerDay: 0.4,
  seasonalMultipliers: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  reputationGateMin: 40,
  reputationGateMax: 90,
  standardTemplates: [
    {
      weight: 1,
      payloadType: "pax",
      payloadLbsRange: [1000, 1800],
      paxCountRange: [5, 8],
      minClass: "JET",
      requiredCapabilities: [],
      urgency: "standard",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.5,
      routeTemplate: {
        originCandidates: ["KBOS", "CYHZ"],
        destinationCandidates: ["KBOS", "KMVY", "KACK", "CYUL", "CYYT"],
      },
      description: ({ origin, destination }) =>
        `International broker leg from ${origin} to ${destination} — first of a longer itinerary.`,
    },
  ],
  premiumTemplates: [
    {
      weight: 1,
      payloadType: "pax",
      payloadLbsRange: [1200, 2000],
      paxCountRange: [6, 8],
      minClass: "JET",
      requiredCapabilities: [],
      urgency: "urgent",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.8,
      routeTemplate: {
        originCandidates: ["KBOS", "CYHZ"],
        destinationCandidates: ["KBOS", "KMVY", "KACK", "CYUL", "CYYT"],
      },
      description: ({ origin, destination }) =>
        `Premium broker request from ${origin} to ${destination}; client is paying up for a same-day slot.`,
    },
  ],
};

export default continentalCharter;

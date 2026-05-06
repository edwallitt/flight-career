import type { ClientDefinition } from "../types.js";

const eastCoastTours: ClientDefinition = {
  id: "east_coast_tours",
  name: "East Coast Tours",
  role: "air_taxi",
  homeBaseIcao: "CYHZ",
  description:
    "Scenic round-trip tourist flights along the Atlantic coastline; runs only when the weather is on side.",
  baseJobsPerDay: 0.8,
  seasonalMultipliers: [
    0.1, 0.1, 0.3, 0.6, 1.0, 1.8, 2.0, 2.0, 1.8, 0.8, 0.3, 0.1,
  ],
  reputationGateMin: 0,
  reputationGateMax: 50,
  standardTemplates: [
    {
      weight: 1,
      payloadType: "pax",
      payloadLbsRange: [600, 1200],
      paxCountRange: [3, 6],
      minClass: "SEP",
      requiredCapabilities: [],
      urgency: "flexible",
      weatherSensitivity: "strict",
      basePayMultiplier: 1.0,
      routeTemplate: {
        originCandidates: ["CYHZ", "CYQI", "CYYG"],
        destinationCandidates: ["CYHZ", "CYQI", "CYYG", "CYAW"],
      },
      description: ({ origin, destination }) =>
        `Scenic sightseeing flight from ${origin} with a turn over ${destination}.`,
    },
  ],
  premiumTemplates: [],
  voice: {
    dispatcherName: "Sandra",
    personalityPrompt:
      "Tourism operator. Bright, enthusiastic, slightly oversells the experience. Mentions weather and views. Uses exclamation points. Calls passengers 'guests.' Apologizes when conditions are anything less than perfect.",
    sampleNote:
      "Lovely group of guests for the lighthouse tour today! Forecast looking gorgeous — should get great views of Peggy's Cove on the way down. Family of four, two excited kids.",
  },
};

export default eastCoastTours;

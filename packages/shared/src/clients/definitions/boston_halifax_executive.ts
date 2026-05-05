import type { ClientDefinition } from "../types.js";

const bostonHalifaxExecutive: ClientDefinition = {
  id: "boston_halifax_executive",
  name: "Boston-Halifax Executive",
  role: "light_jet",
  homeBaseIcao: "KBOS",
  description:
    "Regular bizjet shuttle for Boston-area finance clients running between New England and eastern Canada.",
  baseJobsPerDay: 1.0,
  seasonalMultipliers: [
    0.8, 0.95, 1.1, 1.1, 1.05, 1.0, 0.9, 0.9, 1.15, 1.15, 1.05, 0.8,
  ],
  reputationGateMin: 20,
  reputationGateMax: 70,
  standardTemplates: [
    {
      weight: 1,
      payloadType: "pax",
      payloadLbsRange: [800, 1600],
      paxCountRange: [4, 7],
      minClass: "JET",
      requiredCapabilities: [],
      urgency: "standard",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.2,
      routeTemplate: {
        originCandidates: ["KBOS"],
        destinationCandidates: ["CYHZ", "CYQB", "CYUL"],
      },
      description: ({ destination }) =>
        `Bizjet leg from Boston to ${destination} carrying a finance client team.`,
    },
  ],
  premiumTemplates: [],
};

export default bostonHalifaxExecutive;

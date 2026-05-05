import type { ClientDefinition } from "../types.js";

const northernOutfitters: ClientDefinition = {
  id: "northern_outfitters",
  name: "Northern Outfitters Co.",
  role: "bush",
  homeBaseIcao: "CYYR",
  description:
    "Hunting and fishing lodge operator running guests and supplies into remote Labrador and Newfoundland strips.",
  baseJobsPerDay: 1.5,
  // Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec
  seasonalMultipliers: [
    0.1, 0.2, 0.3, 0.6, 1.5, 1.8, 2.0, 2.0, 1.8, 1.5, 0.5, 0.2,
  ],
  reputationGateMin: 0,
  reputationGateMax: 70,
  standardTemplates: [
    {
      weight: 3,
      payloadType: "pax",
      payloadLbsRange: [800, 1600],
      paxCountRange: [4, 8],
      minClass: "SET",
      requiredCapabilities: ["unpaved"],
      urgency: "flexible",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.0,
      routeTemplate: {
        originCandidates: ["CYYR"],
        destinationCandidates: ["CYDF", "CYJT", "CYYT"],
      },
      description: ({ destination }) =>
        `Fly lodge guests from Goose Bay out to the camp near ${destination}.`,
    },
    {
      weight: 4,
      payloadType: "cargo",
      payloadLbsRange: [800, 1800],
      minClass: "SET",
      requiredCapabilities: ["unpaved"],
      urgency: "standard",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.0,
      routeTemplate: {
        originCandidates: ["CYYR"],
        destinationCandidates: ["CYDF", "CYJT", "CYYT"],
      },
      description: ({ destination }) =>
        `Resupply run of fuel, food and gear from Goose Bay to the lodge near ${destination}.`,
    },
  ],
  premiumTemplates: [
    {
      weight: 1,
      payloadType: "mixed",
      payloadLbsRange: [1600, 2400],
      paxCountRange: [6, 8],
      minClass: "SET",
      requiredCapabilities: ["unpaved"],
      urgency: "standard",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.6,
      routeTemplate: {
        originCandidates: ["CYYR"],
        destinationCandidates: ["CYDF", "CYJT", "CYYT"],
      },
      description: ({ destination }) =>
        `Charter the entire lodge group plus their gear from Goose Bay to ${destination}.`,
    },
  ],
};

export default northernOutfitters;

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
  // Gated at bush rep 10 — all templates require SET class + unpaved, so
  // surfacing these at rep 0 just clutters the board with jobs a starter
  // pilot can't fly. The player will earn enough bush rep on Maritime Cargo
  // runs to unlock these about the time they're shopping for a turbine.
  reputationGateMin: 10,
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
  voice: {
    dispatcherName: "Marie",
    personalityPrompt:
      "Marie runs dispatch at Northern Outfitters. She's been doing this for fifteen years, knows every pilot by name, and writes like she's chatting on the radio. Warm, practical, occasionally sardonic about the weather or city clients. Drops first names, uses contractions.",
    sampleNote:
      "Got the Petersen group ready by 0600 — they tipped well last year so be nice. Wind's howling but should ease by ten.",
  },
};

export default northernOutfitters;

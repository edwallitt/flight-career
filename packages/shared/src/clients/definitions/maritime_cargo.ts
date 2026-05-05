import type { ClientDefinition } from "../types.js";

const maritimeCargo: ClientDefinition = {
  id: "maritime_cargo",
  name: "Maritime Cargo Express",
  role: "bush",
  homeBaseIcao: "CYHZ",
  description:
    "Routine small-parcel cargo distributor connecting Halifax to Maritime communities.",
  baseJobsPerDay: 3,
  seasonalMultipliers: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  reputationGateMin: 0,
  reputationGateMax: 50,
  standardTemplates: [
    {
      weight: 1,
      payloadType: "cargo",
      payloadLbsRange: [300, 1200],
      minClass: "SEP",
      requiredCapabilities: [],
      urgency: "standard",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.0,
      routeTemplate: {
        originCandidates: ["CYHZ"],
        destinationCandidates: [
          "CYQM",
          "CYQI",
          "CYYG",
          "CYFC",
          "CYSJ",
          "CYAW",
          "CYCH",
          "CYCX",
          "CYCL",
        ],
      },
      description: ({ destination }) =>
        `Routine parcel run from Halifax out to ${destination}.`,
    },
  ],
  premiumTemplates: [
    {
      weight: 1,
      payloadType: "cargo",
      payloadLbsRange: [600, 1500],
      minClass: "MEP",
      requiredCapabilities: [],
      urgency: "urgent",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.5,
      routeTemplate: {
        originCandidates: ["CYHZ"],
        destinationCandidates: [
          "CYQM",
          "CYQI",
          "CYYG",
          "CYFC",
          "CYSJ",
          "CYDF",
        ],
      },
      description: ({ destination }) =>
        `Priority cargo from Halifax to ${destination} — needs to be there same day.`,
    },
  ],
};

export default maritimeCargo;

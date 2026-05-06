import type { ClientDefinition } from "../types.js";

const newfoundlandAirAmbulance: ClientDefinition = {
  id: "newfoundland_air_ambulance",
  name: "Newfoundland Air Ambulance",
  role: "air_taxi",
  homeBaseIcao: "CYYT",
  description:
    "True medevac operator flying critical patients in any conditions across Atlantic Canada.",
  baseJobsPerDay: 0.8,
  seasonalMultipliers: [
    1.1, 1.1, 1.1, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.2,
  ],
  reputationGateMin: 50,
  reputationGateMax: 95,
  standardTemplates: [
    {
      weight: 1,
      payloadType: "medical",
      payloadLbsRange: [400, 900],
      paxCountRange: [1, 2],
      minClass: "SET",
      requiredCapabilities: [],
      urgency: "critical",
      weatherSensitivity: "none",
      basePayMultiplier: 1.8,
      routeTemplate: {
        originCandidates: [
          "CYYT",
          "CYDF",
          "CYJT",
          "CYYR",
          "CYHZ",
          "CYQM",
          "CYSJ",
          "CYYG",
          "CYFC",
        ],
        destinationCandidates: [
          "CYYT",
          "CYDF",
          "CYJT",
          "CYYR",
          "CYHZ",
          "CYQM",
          "CYSJ",
          "CYYG",
          "CYFC",
        ],
      },
      description: ({ origin, destination }) =>
        `Medevac flight from ${origin} to ${destination} — patient is critical, weather is not a reason to scrub.`,
    },
  ],
  premiumTemplates: [
    {
      weight: 1,
      payloadType: "medical",
      payloadLbsRange: [500, 1000],
      paxCountRange: [1, 2],
      minClass: "MEP",
      requiredCapabilities: [],
      urgency: "critical",
      weatherSensitivity: "none",
      basePayMultiplier: 2.2,
      routeTemplate: {
        originCandidates: ["CYYT", "CYHZ", "CYYR"],
        destinationCandidates: ["CYUL", "CYQB", "KBOS"],
      },
      description: ({ origin, destination }) =>
        `Inter-provincial medevac from ${origin} to specialist trauma center at ${destination}.`,
    },
  ],
  voice: {
    dispatcherName: "Med-1 Dispatch",
    personalityPrompt:
      "True air ambulance coordination. Terse, exact, omits anything not operationally relevant. Speaks like radio traffic — fragments, abbreviations, no pleasantries. Time and clinical state are everything.",
    sampleNote:
      "Critical transfer YYT to Halifax. Trauma, stable on vent. Lift now. Wx no factor.",
  },
};

export default newfoundlandAirAmbulance;

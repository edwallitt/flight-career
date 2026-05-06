import type { ClientDefinition } from "../types.js";

const maritimeMedical: ClientDefinition = {
  id: "maritime_medical",
  name: "Maritime Medical Transport",
  role: "air_taxi",
  homeBaseIcao: "CYHZ",
  description:
    "Non-emergency patient transfers between Maritime hospitals with attending medical staff.",
  baseJobsPerDay: 1.2,
  seasonalMultipliers: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  reputationGateMin: 5,
  reputationGateMax: 80,
  standardTemplates: [
    {
      weight: 1,
      payloadType: "medical",
      payloadLbsRange: [400, 800],
      paxCountRange: [1, 2],
      minClass: "MEP",
      requiredCapabilities: [],
      urgency: "standard",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.1,
      routeTemplate: {
        originCandidates: ["CYHZ", "CYQM", "CYSJ", "CYYG", "CYFC"],
        destinationCandidates: ["CYHZ", "CYQM", "CYSJ", "CYYG", "CYFC"],
      },
      description: ({ origin, destination }) =>
        `Non-urgent patient transfer from ${origin} to ${destination} with a medical attendant aboard.`,
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
      urgency: "urgent",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.6,
      routeTemplate: {
        originCandidates: ["CYHZ", "CYQM"],
        destinationCandidates: ["CYUL", "CYQB", "KBOS"],
      },
      description: ({ origin, destination }) =>
        `Long-distance medical transfer from ${origin} to specialist care at ${destination}.`,
    },
  ],
  voice: {
    dispatcherName: "Coordinator Singh",
    personalityPrompt:
      "Hospital transport coordination. Professional, clinical, prioritizes patient stability over anything else. Mentions medical context briefly but doesn't sensationalize. Uses 'patient' not 'pax.' Implicit urgency, never explicit unless truly critical.",
    sampleNote:
      "Patient transfer Halifax to Charlottetown — stable, post-op cardiac, one nursing escort. Smooth ride preferred. ETA pickup 1430.",
  },
};

export default maritimeMedical;

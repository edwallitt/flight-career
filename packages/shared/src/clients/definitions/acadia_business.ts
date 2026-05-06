import type { ClientDefinition } from "../types.js";

const acadiaBusiness: ClientDefinition = {
  id: "acadia_business",
  name: "Acadia Business Aviation",
  role: "air_taxi",
  homeBaseIcao: "CYHZ",
  description:
    "Corporate charter broker shuttling executives between Maritime hubs and northeastern business centers.",
  baseJobsPerDay: 1.5,
  // business cycle: lower Dec-Jan, higher Sep-Nov & Mar-May
  seasonalMultipliers: [
    0.7, 0.9, 1.2, 1.3, 1.2, 1.0, 0.9, 0.9, 1.3, 1.3, 1.2, 0.7,
  ],
  reputationGateMin: 25,
  reputationGateMax: 75,
  standardTemplates: [
    {
      weight: 1,
      payloadType: "pax",
      payloadLbsRange: [400, 1200],
      paxCountRange: [2, 5],
      minClass: "MEP",
      requiredCapabilities: [],
      urgency: "standard",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.2,
      routeTemplate: {
        originCandidates: ["CYHZ", "CYQM"],
        destinationCandidates: ["KBOS", "CYUL", "CYQB"],
      },
      description: ({ origin, destination }) =>
        `Corporate charter from ${origin} to a meeting in ${destination}.`,
    },
  ],
  premiumTemplates: [
    {
      weight: 1,
      payloadType: "pax",
      payloadLbsRange: [200, 400],
      paxCountRange: [1, 1],
      minClass: "SET",
      requiredCapabilities: [],
      urgency: "urgent",
      weatherSensitivity: "mild",
      basePayMultiplier: 1.8,
      routeTemplate: {
        originCandidates: ["CYHZ", "CYQM"],
        destinationCandidates: ["KBOS", "CYUL", "CYQB"],
      },
      description: ({ origin, destination }) =>
        `VIP single-passenger charter from ${origin} to ${destination}; turbine required.`,
    },
  ],
  voice: {
    dispatcherName: "Charter Desk",
    personalityPrompt:
      "Corporate charter broker. Polished, deferential to clients, explicit about the importance of punctuality and presentation. Treats every flight like it could be reported to the boss. Mentions client expectations. Always uses honorifics — 'Mr.', 'Ms.'.",
    sampleNote:
      "Mr. Chen and three colleagues, Halifax to Boston. Departure must hold to 0830. Beverages requested. Client values discretion.",
  },
};

export default acadiaBusiness;

import type { ClientDefinition } from "../types.js";

const timeCriticalLogistics: ClientDefinition = {
  id: "time_critical_logistics",
  name: "Time-Critical Logistics",
  role: "light_jet",
  homeBaseIcao: "KBOS",
  description:
    "AOG parts and organ-transport jet operator — every job is time-critical and has to fly regardless of weather.",
  baseJobsPerDay: 0.3,
  seasonalMultipliers: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  reputationGateMin: 60,
  reputationGateMax: 95,
  standardTemplates: [
    {
      weight: 2,
      payloadType: "cargo",
      payloadLbsRange: [200, 800],
      minClass: "JET",
      requiredCapabilities: [],
      urgency: "critical",
      weatherSensitivity: "none",
      basePayMultiplier: 1.8,
      routeTemplate: {
        originCandidates: ["KBOS", "CYHZ", "CYUL", "CYYT"],
        destinationCandidates: ["KBOS", "CYHZ", "CYUL", "CYYT", "CYQB"],
      },
      description: ({ origin, destination }) =>
        `AOG parts run from ${origin} to ${destination}; an aircraft is on the ground waiting.`,
    },
    {
      weight: 1,
      payloadType: "medical",
      payloadLbsRange: [200, 500],
      paxCountRange: [1, 1],
      minClass: "JET",
      requiredCapabilities: [],
      urgency: "critical",
      weatherSensitivity: "none",
      basePayMultiplier: 2.0,
      routeTemplate: {
        originCandidates: ["KBOS", "CYHZ", "CYUL", "CYYT"],
        destinationCandidates: ["KBOS", "CYHZ", "CYUL", "CYYT", "CYQB"],
      },
      description: ({ origin, destination }) =>
        `Organ transport from ${origin} to ${destination} — clock is running and there is no scrub option.`,
    },
  ],
  premiumTemplates: [
    {
      weight: 1,
      payloadType: "cargo",
      payloadLbsRange: [400, 1000],
      minClass: "JET",
      requiredCapabilities: [],
      urgency: "critical",
      weatherSensitivity: "none",
      basePayMultiplier: 2.2,
      routeTemplate: {
        originCandidates: ["KBOS", "CYHZ", "CYUL", "CYYT"],
        destinationCandidates: ["KBOS", "CYHZ", "CYUL", "CYYT", "CYQB"],
      },
      description: ({ origin, destination }) =>
        `Premium time-critical contract from ${origin} to ${destination}; pays heavily for guaranteed dispatch.`,
    },
  ],
};

export default timeCriticalLogistics;

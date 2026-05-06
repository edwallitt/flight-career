import type { ClientDefinition } from "../types.js";

const atlanticForestry: ClientDefinition = {
  id: "atlantic_forestry",
  name: "Atlantic Forestry Survey",
  role: "bush",
  homeBaseIcao: "CYQM",
  description:
    "Aerial survey contractor flying mapping and timber-block patterns for forestry and government clients.",
  baseJobsPerDay: 0.6,
  seasonalMultipliers: [
    0.2, 0.2, 0.4, 0.7, 0.9, 1.2, 1.4, 1.4, 1.1, 0.8, 0.4, 0.3,
  ],
  reputationGateMin: 10,
  reputationGateMax: 60,
  standardTemplates: [
    {
      weight: 1,
      payloadType: "survey",
      payloadLbsRange: [200, 400],
      minClass: "SEP",
      requiredCapabilities: [],
      urgency: "flexible",
      weatherSensitivity: "strict",
      basePayMultiplier: 1.0,
      routeTemplate: {
        originCandidates: ["CYQM"],
        destinationCandidates: ["CYFC", "CYSJ", "CYHZ"],
      },
      description: ({ destination }) =>
        `Fly a forestry survey block out of Moncton, recovering at ${destination}.`,
    },
  ],
  premiumTemplates: [
    {
      weight: 1,
      payloadType: "survey",
      payloadLbsRange: [300, 500],
      minClass: "MEP",
      requiredCapabilities: [],
      urgency: "standard",
      weatherSensitivity: "strict",
      basePayMultiplier: 1.5,
      routeTemplate: {
        originCandidates: ["CYQM"],
        destinationCandidates: ["CYFC", "CYSJ", "CYHZ"],
      },
      description: ({ destination }) =>
        `Multi-day survey contract from Moncton with a turn at ${destination}; twin required for the sensor package.`,
    },
  ],
  voice: {
    dispatcherName: "Coordinator Walsh",
    personalityPrompt:
      "A government-adjacent forestry contractor. Communications are technical, concise, by the book. Uses block-and-grid coordinates, refers to flights as 'sorties.' Polite but never personal.",
    sampleNote:
      "Sortie tasked for grid C-7 through C-12. Standard photographic pattern, 3500 AGL. Return CYQM by 1700 hours.",
  },
};

export default atlanticForestry;

import type { ClientDefinition } from "../types.js";

const maritimeCargo: ClientDefinition = {
  id: "maritime_cargo",
  name: "Maritime Cargo Express",
  role: "bush",
  homeBaseIcao: "CYHZ",
  description:
    "Routine small-parcel cargo distributor connecting Halifax to Maritime communities.",
  // Routine cargo is the new pilot's bread and butter: seasonally flat (it's
  // not weather-dependent survey/tour work) and gate-0, so it carries the
  // early game even in winter when the seasonal clients go quiet. Tuned up
  // from 4 to keep ~6 home-origin SEP jobs on the board so a fresh SEP pilot
  // at CYHZ always has a stack of flyable work without repositioning.
  baseJobsPerDay: 6,
  seasonalMultipliers: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  reputationGateMin: 0,
  reputationGateMax: 50,
  standardTemplates: [
    // Short-hop courier run, weighted heavily so a freshly-arrived player
    // always has a CYHZ-origin sub-100nm option. CYAW is 14 nm south of
    // CYHZ, well within a C152's range and payload. The elevated base
    // multiplier compensates for the small distance term — narratively,
    // MCE pays a flat retainer for short courier runs because the pure
    // per-mile rate isn't worth a pilot's time.
    {
      weight: 3,
      payloadType: "cargo",
      payloadLbsRange: [80, 220],
      minClass: "SEP",
      requiredCapabilities: [],
      urgency: "standard",
      weatherSensitivity: "mild",
      basePayMultiplier: 8.0,
      routeTemplate: {
        originCandidates: ["CYHZ"],
        destinationCandidates: ["CYAW"],
      },
      description: () =>
        "Short courier hop down to Shearwater — quick parcel transfer for the harbour office.",
    },
    {
      weight: 1,
      payloadType: "cargo",
      // Capped at 750 lbs so a starter C172 (880 lb max payload) always fits
      // with reserves. The premium MEP template carries the heavier loads.
      payloadLbsRange: [300, 750],
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
  voice: {
    dispatcherName: "Dispatch",
    personalityPrompt:
      "A small cargo operator. Dispatch is whoever's at the desk. Communications are practical, no-frills, focused on what's in the box and who needs it. Like a courier service that happens to fly.",
    sampleNote:
      "Three boxes for the clinic at Charlottetown. Marked fragile but it's just office supplies — they overpack. Standard rate.",
  },
};

export default maritimeCargo;

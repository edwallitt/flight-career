import { describe, expect, it } from "vitest";
import { ALL_CLIENTS, getClientById } from "../index.js";
import type { ClientDefinition, JobTemplate } from "../types.js";

// Mirror of the ICAOs in apps/server/src/db/seed-data/airports.ts. Hard-coded
// because the server seed lives downstream of this package.
const SEEDED_ICAOS = new Set<string>([
  "CYHZ", "CYQM", "CYQI", "CYYG", "CYFC", "CYSJ", "CYYR", "CYDF", "CYJT",
  "CYYT", "CYAW", "CYCH", "CYCX", "CYCL", "CYUL", "CYQB", "CYZV", "KBOS",
  "KBGR", "KPWM", "KBHB", "KAUG", "KBDL", "KBTV", "KMHT", "KPVD", "KFMH",
  "KPVC", "KMVY", "KACK",
]);

const ALL_TEMPLATES = (c: ClientDefinition): JobTemplate[] => [
  ...c.standardTemplates,
  ...c.premiumTemplates,
];

describe("ALL_CLIENTS", () => {
  it("contains exactly 10 clients", () => {
    expect(ALL_CLIENTS).toHaveLength(10);
  });

  it("has unique client ids", () => {
    const ids = ALL_CLIENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every home base ICAO matches a seeded airport", () => {
    for (const c of ALL_CLIENTS) {
      expect(SEEDED_ICAOS, `client ${c.id} home base`).toContain(
        c.homeBaseIcao,
      );
    }
  });

  it("every template route candidate references a seeded airport", () => {
    for (const c of ALL_CLIENTS) {
      for (const t of ALL_TEMPLATES(c)) {
        for (const icao of t.routeTemplate.originCandidates) {
          expect(SEEDED_ICAOS, `${c.id} origin`).toContain(icao);
        }
        for (const icao of t.routeTemplate.destinationCandidates) {
          expect(SEEDED_ICAOS, `${c.id} destination`).toContain(icao);
        }
      }
    }
  });

  it("every client has at least one standard template", () => {
    for (const c of ALL_CLIENTS) {
      expect(c.standardTemplates.length).toBeGreaterThan(0);
    }
  });

  it("seasonalMultipliers always has length 12", () => {
    for (const c of ALL_CLIENTS) {
      expect(c.seasonalMultipliers).toHaveLength(12);
    }
  });

  it("reputation gates are sane (0 <= min < max <= 100)", () => {
    for (const c of ALL_CLIENTS) {
      expect(c.reputationGateMin).toBeGreaterThanOrEqual(0);
      expect(c.reputationGateMax).toBeLessThanOrEqual(100);
      expect(c.reputationGateMin).toBeLessThan(c.reputationGateMax);
    }
  });

  it("templates have valid weights, ranges, and origin/destination lists", () => {
    for (const c of ALL_CLIENTS) {
      for (const t of ALL_TEMPLATES(c)) {
        expect(t.weight, `${c.id} weight`).toBeGreaterThan(0);
        expect(t.basePayMultiplier).toBeGreaterThan(0);

        const [lbsLo, lbsHi] = t.payloadLbsRange;
        expect(lbsLo).toBeGreaterThan(0);
        expect(lbsHi).toBeGreaterThanOrEqual(lbsLo);

        if (t.paxCountRange) {
          const [paxLo, paxHi] = t.paxCountRange;
          expect(paxLo).toBeGreaterThan(0);
          expect(paxHi).toBeGreaterThanOrEqual(paxLo);
        }

        expect(t.routeTemplate.originCandidates.length).toBeGreaterThan(0);
        expect(t.routeTemplate.destinationCandidates.length).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("description() can be called without throwing and returns a non-empty string", () => {
    for (const c of ALL_CLIENTS) {
      for (const t of ALL_TEMPLATES(c)) {
        const origin = t.routeTemplate.originCandidates[0]!;
        const destination = t.routeTemplate.destinationCandidates[0]!;
        const text = t.description({ origin, destination });
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getClientById", () => {
  it("returns the matching client", () => {
    const c = getClientById("northern_outfitters");
    expect(c).toBeDefined();
    expect(c?.name).toBe("Northern Outfitters Co.");
  });

  it("returns undefined for unknown ids", () => {
    expect(getClientById("does_not_exist")).toBeUndefined();
  });
});

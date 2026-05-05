import {
  generateListingBatch,
  haversineNm,
  type AircraftClass,
  type ConditionGrade,
  type GeneratedListing,
  type ListingAircraftType,
  type ListingAirport,
} from "@flightcareer/shared";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftListings,
  aircraftTypes,
  airports,
  career,
} from "../db/schema.js";

const DEFAULT_TARGET_SIZE = 24;

function rngFromCryptoSeed(): () => number {
  let s = (Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export function rngFromSeed(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function getSimNow(): number {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  return careerRow?.simDateTime ?? Date.now();
}

function buildListingAirports(): ListingAirport[] {
  return db
    .select()
    .from(airports)
    .all()
    .map((a) => ({
      icao: a.icao,
      size: a.size,
      hasMaintenance: a.hasMaintenance,
    }));
}

function buildListingAircraftTypes(): ListingAircraftType[] {
  return db
    .select()
    .from(aircraftTypes)
    .all()
    .map((t) => ({
      id: t.id,
      class: t.class,
      basePurchasePriceCents: t.basePurchasePrice,
      tboHours: t.tboHours,
    }));
}

function insertListings(generated: GeneratedListing[]): void {
  if (generated.length === 0) return;
  db.insert(aircraftListings)
    .values(
      generated.map((g) => ({
        aircraftTypeId: g.aircraftTypeId,
        tailNumber: g.tailNumber,
        locationIcao: g.locationIcao,
        airframeHours: g.airframeHours,
        engineHoursSinceOverhaul: g.engineHoursSinceOverhaul,
        hoursSince100hr: g.hoursSince100hr,
        hoursSinceAnnual: g.hoursSinceAnnual,
        askingPriceCents: g.askingPriceCents,
        conditionGrade: g.conditionGrade,
        listedAt: g.listedAt,
        expiresAt: g.expiresAt,
        status: "available" as const,
        descriptionShort: g.descriptionShort,
      })),
    )
    .run();
}

export interface RefreshResult {
  added: number;
  expired: number;
  total: number;
}

export function refreshMarketplace(
  targetSize = DEFAULT_TARGET_SIZE,
  rng: () => number = rngFromCryptoSeed(),
): RefreshResult {
  const simNow = getSimNow();

  const expired = Number(
    db
      .update(aircraftListings)
      .set({ status: "expired" })
      .where(
        and(
          eq(aircraftListings.status, "available"),
          lt(aircraftListings.expiresAt, simNow),
        ),
      )
      .run().changes ?? 0,
  );

  const currentCount = db
    .select()
    .from(aircraftListings)
    .where(eq(aircraftListings.status, "available"))
    .all().length;

  const deficit = Math.max(0, targetSize - currentCount);
  let added = 0;
  if (deficit > 0) {
    const ctx = {
      airports: buildListingAirports(),
      aircraftTypes: buildListingAircraftTypes(),
      rng,
      simNow,
    };
    const generated = generateListingBatch(deficit, ctx);
    insertListings(generated);
    added = generated.length;
  }

  return { added, expired, total: currentCount + added };
}

export interface EnrichedListing {
  id: number;
  aircraftTypeId: string;
  aircraftTypeManufacturer: string;
  aircraftTypeModel: string;
  aircraftClass: AircraftClass;
  tailNumber: string;
  locationIcao: string;
  locationName: string;
  airframeHours: number;
  engineHoursSinceOverhaul: number;
  engineRemainingHours: number;
  tboHours: number;
  hoursSince100hr: number;
  hoursSinceAnnual: number;
  conditionGrade: ConditionGrade;
  askingPriceCents: number;
  basePurchasePriceCents: number;
  depreciationFactor: number;
  distanceFromPlayerNm: number | null;
  descriptionShort: string | null;
  listedAt: number;
  expiresAt: number;
}

export interface ListingsInput {
  filterByClass?: AircraftClass[];
  maxPriceCents?: number;
  sortBy?: "price_asc" | "price_desc" | "hours_asc" | "distance_asc";
  playerLocationIcao?: string;
}

function rowToEnriched(
  listing: typeof aircraftListings.$inferSelect,
  type: typeof aircraftTypes.$inferSelect,
  airport: typeof airports.$inferSelect,
  playerCoords: { lat: number; lon: number } | null,
): EnrichedListing {
  const distance = playerCoords
    ? Math.round(
        haversineNm(playerCoords, { lat: airport.lat, lon: airport.lon }),
      )
    : null;
  return {
    id: listing.id,
    aircraftTypeId: type.id,
    aircraftTypeManufacturer: type.manufacturer,
    aircraftTypeModel: type.model,
    aircraftClass: type.class,
    tailNumber: listing.tailNumber,
    locationIcao: listing.locationIcao,
    locationName: airport.name,
    airframeHours: listing.airframeHours,
    engineHoursSinceOverhaul: listing.engineHoursSinceOverhaul,
    engineRemainingHours: Math.max(
      0,
      type.tboHours - listing.engineHoursSinceOverhaul,
    ),
    tboHours: type.tboHours,
    hoursSince100hr: listing.hoursSince100hr,
    hoursSinceAnnual: listing.hoursSinceAnnual,
    conditionGrade: listing.conditionGrade,
    askingPriceCents: listing.askingPriceCents,
    basePurchasePriceCents: type.basePurchasePrice,
    depreciationFactor:
      type.basePurchasePrice > 0
        ? listing.askingPriceCents / type.basePurchasePrice
        : 0,
    distanceFromPlayerNm: distance,
    descriptionShort: listing.descriptionShort,
    listedAt: listing.listedAt,
    expiresAt: listing.expiresAt,
  };
}

function getPlayerCoords(
  playerLocationIcao: string | undefined,
): { lat: number; lon: number } | null {
  if (!playerLocationIcao) return null;
  const ap = db
    .select()
    .from(airports)
    .where(eq(airports.icao, playerLocationIcao))
    .get();
  return ap ? { lat: ap.lat, lon: ap.lon } : null;
}

export function getListings(input: ListingsInput): EnrichedListing[] {
  const rows = db
    .select({
      listing: aircraftListings,
      type: aircraftTypes,
      airport: airports,
    })
    .from(aircraftListings)
    .innerJoin(
      aircraftTypes,
      eq(aircraftListings.aircraftTypeId, aircraftTypes.id),
    )
    .innerJoin(airports, eq(aircraftListings.locationIcao, airports.icao))
    .where(eq(aircraftListings.status, "available"))
    .all();

  const playerCoords = getPlayerCoords(input.playerLocationIcao);

  let enriched = rows.map(({ listing, type, airport }) =>
    rowToEnriched(listing, type, airport, playerCoords),
  );

  if (input.filterByClass && input.filterByClass.length > 0) {
    const allowed = new Set(input.filterByClass);
    enriched = enriched.filter((l) => allowed.has(l.aircraftClass));
  }
  if (typeof input.maxPriceCents === "number") {
    enriched = enriched.filter((l) => l.askingPriceCents <= input.maxPriceCents!);
  }

  const sortBy =
    input.sortBy ?? (input.playerLocationIcao ? "distance_asc" : "price_asc");

  enriched.sort((a, b) => {
    switch (sortBy) {
      case "price_asc":
        return a.askingPriceCents - b.askingPriceCents;
      case "price_desc":
        return b.askingPriceCents - a.askingPriceCents;
      case "hours_asc":
        return a.airframeHours - b.airframeHours;
      case "distance_asc": {
        const ad = a.distanceFromPlayerNm ?? Number.POSITIVE_INFINITY;
        const bd = b.distanceFromPlayerNm ?? Number.POSITIVE_INFINITY;
        return ad - bd;
      }
    }
  });

  return enriched;
}

export function getListingById(
  id: number,
  playerLocationIcao?: string,
): EnrichedListing | null {
  const row = db
    .select({
      listing: aircraftListings,
      type: aircraftTypes,
      airport: airports,
    })
    .from(aircraftListings)
    .innerJoin(
      aircraftTypes,
      eq(aircraftListings.aircraftTypeId, aircraftTypes.id),
    )
    .innerJoin(airports, eq(aircraftListings.locationIcao, airports.icao))
    .where(eq(aircraftListings.id, id))
    .get();
  if (!row) return null;
  const playerCoords = getPlayerCoords(playerLocationIcao);
  return rowToEnriched(row.listing, row.type, row.airport, playerCoords);
}

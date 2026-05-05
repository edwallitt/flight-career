// Diagnostic: print depreciation factor for every active listing and flag
// any sitting at or near the 0.25 floor (<= 0.27). Use this to confirm the
// pricing floor is not biting unexpectedly across aircraft classes.
//
// Run: pnpm --filter @flightcareer/server audit-listings

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { aircraftListings, aircraftTypes } from "../db/schema.js";

const FLOOR_FRACTION = 0.25;
const FLAG_THRESHOLD = 0.27;

function main(): void {
  const rows = db
    .select({ listing: aircraftListings, type: aircraftTypes })
    .from(aircraftListings)
    .innerJoin(
      aircraftTypes,
      eq(aircraftListings.aircraftTypeId, aircraftTypes.id),
    )
    .where(eq(aircraftListings.status, "available"))
    .all();

  if (rows.length === 0) {
    console.log("No active listings.");
    return;
  }

  rows.sort((a, b) => {
    const fa =
      a.type.basePurchasePrice > 0
        ? a.listing.askingPriceCents / a.type.basePurchasePrice
        : 0;
    const fb =
      b.type.basePurchasePrice > 0
        ? b.listing.askingPriceCents / b.type.basePurchasePrice
        : 0;
    return fa - fb;
  });

  const headers = [
    "id",
    "class",
    "type",
    "tail",
    "afHrs",
    "engHrs",
    "tbo",
    "cond",
    "basePrice",
    "asking",
    "depFactor",
    "flag",
  ];

  console.log(headers.join("\t"));

  let flagged = 0;
  for (const { listing, type } of rows) {
    const factor =
      type.basePurchasePrice > 0
        ? listing.askingPriceCents / type.basePurchasePrice
        : 0;
    const flag = factor <= FLAG_THRESHOLD ? "FLOOR?" : "";
    if (flag) flagged += 1;
    const cols = [
      listing.id,
      type.class,
      `${type.manufacturer} ${type.model}`,
      listing.tailNumber,
      Math.round(listing.airframeHours),
      Math.round(listing.engineHoursSinceOverhaul),
      type.tboHours,
      listing.conditionGrade,
      `$${(type.basePurchasePrice / 100).toLocaleString()}`,
      `$${(listing.askingPriceCents / 100).toLocaleString()}`,
      factor.toFixed(3),
      flag,
    ];
    console.log(cols.join("\t"));
  }

  console.log("");
  console.log(
    `Total: ${rows.length} listings, ${flagged} at/near floor (factor <= ${FLAG_THRESHOLD}, hard floor = ${FLOOR_FRACTION}).`,
  );
}

main();

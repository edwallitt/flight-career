import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";

type RouterOutput = inferRouterOutputs<AppRouter>;

export type Listing = RouterOutput["marketplace"]["listings"]["listings"][number];
export type ListingDetail = NonNullable<
  RouterOutput["marketplace"]["listingById"]
>;

export type ClassFilter = "any" | "SEP" | "MEP" | "SET" | "JET";
export type SortKey = "distance" | "price_asc" | "price_desc" | "hours";
export type MaxPriceFilter = "any" | number;

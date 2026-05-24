import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";

type RouterOutput = inferRouterOutputs<AppRouter>;

export type JobBoardResult = RouterOutput["jobs"]["listWithReachability"];
export type JobRow = JobBoardResult["jobs"][number];
export type JobDetail = NonNullable<RouterOutput["jobs"]["getById"]>;
export type ReachabilityStatus = JobRow["reachability"]["status"];
export type FitStatus = JobRow["fit"]["status"];
export type FleetReadout = JobBoardResult["fleet"];

// Roles the player can grind reputation in. Ferry contracts are surfaced
// inline with their own visual treatment (sky-blue "Ferry" tag in the client
// cell) rather than as a separate filter — keeping ferries always-visible
// reflects the fact that they're opportunistic, not a career track.
export type RoleFilter =
  | "all"
  | "bush"
  | "air_taxi"
  | "light_jet"
  | "open";

// Origin scope is the player's "how much repositioning am I willing to do?"
// dial. Combines what used to be two separate booleans (flyable-only +
// at-my-location-only) into a single three-state control. Default is
// "flyable" — the player wants to see what they can actually go fly,
// including jobs that need a short reposition.
export type OriginScope = "here" | "flyable" | "all";

// Sortable columns. Trimmed to the three a planning player actually reaches
// for: best $/hr (default desc), shortest hop, soonest expiry. Lexical sorts
// on client/route are a filter-shaped problem; class/payload/pay/urgency
// are encoded in the Load + Fit columns and don't need their own axis.
export type SortKey = "payHour" | "distance" | "expires";
export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

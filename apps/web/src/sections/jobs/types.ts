import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@flightcareer/server/router";

type RouterOutput = inferRouterOutputs<AppRouter>;

export type JobRow = RouterOutput["jobs"]["listWithReachability"]["jobs"][number];
export type JobDetail = NonNullable<RouterOutput["jobs"]["getById"]>;
export type ReachabilityStatus = JobRow["reachability"]["status"];

export type RoleFilter = "all" | "bush" | "air_taxi" | "light_jet" | "open";
export type ClassFilter = "any" | "SEP" | "MEP" | "SET" | "JET";

export type SortKey =
  | "client"
  | "route"
  | "class"
  | "payload"
  | "pay"
  | "distance"
  | "expires"
  | "urgency";
export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

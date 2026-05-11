// Barrel re-export. The lifecycle service is split by state into the
// jobLifecycle/ directory; importers continue to use this path so the public
// surface stays stable.

export {
  REP_HIT_BY_STATE,
  activeAircraftType,
  fuelPriceCentsPerGal,
  recommendedFuelGallons,
  type LifecycleResult,
} from "./jobLifecycle/shared.js";

export {
  acceptJob,
  cancelAcceptedJob,
  type AcceptJobInput,
} from "./jobLifecycle/accept.js";

export {
  briefJob,
  type BriefJobInput,
  type BriefResult,
} from "./jobLifecycle/brief.js";

export {
  getActiveJob,
  type ActiveAircraftInfo,
  type ActiveJobFerryInfo,
  type ActiveJobRiskInfo,
  type ActiveJobSnapshot,
} from "./jobLifecycle/active.js";

export {
  beginFlight,
  type BeginFlightResult,
} from "./jobLifecycle/begin.js";

export {
  abortFlight,
  applyDispatcherSignoff,
  completeFlightAction,
  getTrackedCompletionPreview,
  switchToManualMode,
  type CompleteFlightActionInput,
  type CompleteFlightActionResult,
  type CompletionSummaryPayload,
  type DestinationResolutionStatus,
  type DispatcherSignoffPayload,
  type PostCompletionSignoffContext,
  type PostFlightUnscheduledEvent,
  type TrackedCompletionPreview,
} from "./jobLifecycle/complete.js";

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest doesn't auto-cleanup the RTL DOM between tests when globals=false.
afterEach(() => {
  cleanup();
});

// maplibre-gl reads `window.URL.createObjectURL` at module load time to set its
// web-worker URL. jsdom doesn't implement that API, so importing any component
// in the map import chain (RouteMap, AtlasMap, anything that transitively imports
// them) throws "createObjectURL is not a function" before a single test runs.
// Stub it once for the whole suite. We don't actually render maps in tests, so
// the return value is irrelevant.
if (typeof window !== "undefined" && window.URL) {
  if (typeof window.URL.createObjectURL !== "function") {
    window.URL.createObjectURL = () => "blob:stub";
  }
  if (typeof window.URL.revokeObjectURL !== "function") {
    window.URL.revokeObjectURL = () => {};
  }
}

// jsdom doesn't implement Element.scrollIntoView. A few components call it on
// mount for highlight-and-focus behavior (e.g. MaintenanceModal's recommended
// card); stub it so the effect is a no-op during tests.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

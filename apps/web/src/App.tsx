import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ComingSoon } from "./components/ComingSoon.js";
import { Header } from "./components/Header.js";
import { Sidebar } from "./components/Sidebar.js";
import { BriefingScreen } from "./sections/active/BriefingScreen.js";
import { CurrentJobModal } from "./sections/active/CurrentJobModal.js";
import { InFlightSurface } from "./sections/flight/InFlightSurface.js";
import { JobBoard } from "./sections/jobs/JobBoard.js";

type ActiveOverlay = "current" | "brief" | null;

export default function App() {
  const [overlay, setOverlay] = useState<ActiveOverlay>(null);

  return (
    <div className="flex h-full bg-ink-850 text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenActiveJob={() => setOverlay("current")} />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/jobs" replace />} />
            <Route path="/jobs" element={<JobBoard />} />
            <Route
              path="/hangar"
              element={<ComingSoon title="Hangar" code="HGR" />}
            />
            <Route
              path="/career"
              element={<ComingSoon title="Career" code="CRW" />}
            />
            <Route
              path="/logbook"
              element={<ComingSoon title="Logbook" code="LOG" />}
            />
            <Route
              path="/map"
              element={<ComingSoon title="Atlas" code="MAP" />}
            />
          </Routes>
        </main>
      </div>

      {overlay === "current" && (
        <CurrentJobModal
          onClose={() => setOverlay(null)}
          onBeginBriefing={() => setOverlay("brief")}
        />
      )}
      {overlay === "brief" && (
        <BriefingScreen onClose={() => setOverlay("current")} />
      )}

      <InFlightSurface />
    </div>
  );
}

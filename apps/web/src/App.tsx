import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Header } from "./components/Header.js";
import { Sidebar } from "./components/Sidebar.js";
import { BriefingScreen } from "./sections/active/BriefingScreen.js";
import { CurrentJobModal } from "./sections/active/CurrentJobModal.js";
import { WelcomeModal } from "./sections/active/WelcomeModal.js";
import { Atlas } from "./sections/atlas/Atlas.js";
import { Career } from "./sections/career/Career.js";
import { InFlightSurface } from "./sections/flight/InFlightSurface.js";
import { Hangar } from "./sections/hangar/Hangar.js";
import { JobBoard } from "./sections/jobs/JobBoard.js";
import { Logbook } from "./sections/logbook/Logbook.js";
import { Marketplace } from "./sections/marketplace/Marketplace.js";
import { TravelPanel } from "./sections/travel/TravelPanel.js";

type ActiveOverlay = "current" | "brief" | "travel" | null;

export default function App() {
  const [overlay, setOverlay] = useState<ActiveOverlay>(null);
  const [travelPreset, setTravelPreset] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Atlas and the job drawer can deep-link a destination via ?travelTo=ICAO.
  // Lift it into state once and clear the query so back/forward and refresh
  // don't reopen the panel uninvited.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const target = params.get("travelTo");
    if (target) {
      setTravelPreset(target);
      setOverlay("travel");
      params.delete("travelTo");
      const remaining = params.toString();
      navigate(
        { pathname: location.pathname, search: remaining ? `?${remaining}` : "" },
        { replace: true },
      );
    }
  }, [location.pathname, location.search, navigate]);

  return (
    <div className="flex h-full bg-ink-850 text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenActiveJob={() => setOverlay("current")}
          onOpenTravel={() => setOverlay("travel")}
        />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/jobs" replace />} />
            <Route path="/jobs" element={<JobBoard />} />
            <Route path="/hangar" element={<Hangar />} />
            <Route path="/market" element={<Marketplace />} />
            <Route path="/career" element={<Career />} />
            <Route path="/logbook" element={<Logbook />} />
            <Route path="/map" element={<Atlas />} />
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
      {overlay === "travel" && (
        <TravelPanel
          onClose={() => {
            setOverlay(null);
            setTravelPreset(null);
          }}
          presetDestinationIcao={travelPreset}
        />
      )}

      <WelcomeModal />

      <InFlightSurface />
    </div>
  );
}

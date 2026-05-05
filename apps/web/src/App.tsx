import { Navigate, Route, Routes } from "react-router-dom";
import { ComingSoon } from "./components/ComingSoon.js";
import { Header } from "./components/Header.js";
import { Sidebar } from "./components/Sidebar.js";
import { JobBoard } from "./sections/jobs/JobBoard.js";

export default function App() {
  return (
    <div className="flex h-full bg-ink-850 text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
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
    </div>
  );
}

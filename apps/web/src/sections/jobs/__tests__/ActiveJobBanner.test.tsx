import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ActiveJobBanner } from "../ActiveJobBanner.js";

function renderBanner(activeJob: React.ComponentProps<typeof ActiveJobBanner>["activeJob"]) {
  return render(
    <MemoryRouter>
      <ActiveJobBanner activeJob={activeJob} />
    </MemoryRouter>,
  );
}

describe("ActiveJobBanner", () => {
  it("renders nothing when activeJob is null", () => {
    const { container } = renderBanner(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the job id zero-padded, origin → destination, and client", () => {
    renderBanner({
      jobId: 7,
      state: "in_progress",
      originIcao: "CYHZ",
      destinationIcao: "CYQM",
      clientName: "Maritime Cargo",
      jobType: "standard",
      etaSimMs: null,
    });
    expect(screen.getByText("#00007")).toBeInTheDocument();
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText("CYQM")).toBeInTheDocument();
    expect(screen.getByText("Maritime Cargo")).toBeInTheDocument();
  });

  it("renders the state pill matching the lifecycle state", () => {
    renderBanner({
      jobId: 1,
      state: "briefed",
      originIcao: "CYHZ",
      destinationIcao: "CYQM",
      clientName: null,
      jobType: "standard",
      etaSimMs: null,
    });
    expect(screen.getByText("Briefed")).toBeInTheDocument();
  });

  it("links to /current and surfaces an accessible label naming the destination", () => {
    renderBanner({
      jobId: 42,
      state: "accepted",
      originIcao: "CYHZ",
      destinationIcao: "CYYT",
      clientName: null,
      jobType: "standard",
      etaSimMs: null,
    });
    const link = screen.getByRole("link", { name: /job #00042 to CYYT/i });
    expect(link).toHaveAttribute("href", "/current");
  });
});

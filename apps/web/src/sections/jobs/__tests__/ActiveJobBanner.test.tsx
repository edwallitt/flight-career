import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveJobBanner } from "../ActiveJobBanner.js";

function renderBanner(
  activeJob: React.ComponentProps<typeof ActiveJobBanner>["activeJob"],
  onOpen: () => void = () => {},
) {
  return render(<ActiveJobBanner activeJob={activeJob} onOpen={onOpen} />);
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

  it("is a button that calls onOpen and surfaces an accessible label naming the destination", () => {
    const onOpen = vi.fn();
    renderBanner(
      {
        jobId: 42,
        state: "accepted",
        originIcao: "CYHZ",
        destinationIcao: "CYYT",
        clientName: null,
        jobType: "standard",
        etaSimMs: null,
      },
      onOpen,
    );
    const button = screen.getByRole("button", { name: /job #00042 to CYYT/i });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

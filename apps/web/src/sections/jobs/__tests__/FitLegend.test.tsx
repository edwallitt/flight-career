import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FitLegend } from "../FitLegend.js";

describe("FitLegend", () => {
  it("renders all four fit states with their labels", () => {
    render(<FitLegend />);
    for (const label of ["Ready", "Reposition", "Won't fit", "Locked"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("exposes a hover-tooltip explanation per state for new players", () => {
    render(<FitLegend />);
    // Each state's wrapper carries the title; the inner label span is a
    // child. Walk up from the label text to the titled ancestor.
    const ready = screen.getByText("Ready").parentElement!;
    expect(ready).toHaveAttribute("title", expect.stringMatching(/payload/i));
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComingSoon } from "../ComingSoon.js";

describe("ComingSoon", () => {
  it("renders the module code and title from props", () => {
    render(<ComingSoon title="Career" code="CRR" />);
    expect(screen.getByText(/Module · CRR/i)).toBeInTheDocument();
    expect(screen.getByText("Career")).toBeInTheDocument();
  });

  it("includes the standby status footer", () => {
    render(<ComingSoon title="Logbook" code="LBK" />);
    expect(screen.getByText(/status · standby/i)).toBeInTheDocument();
  });
});

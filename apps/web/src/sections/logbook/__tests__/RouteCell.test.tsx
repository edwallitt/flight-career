import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RouteCell } from "../RouteCell.js";

describe("RouteCell", () => {
  it("renders origin and destination ICAO codes", () => {
    render(<RouteCell origin="CYHZ" destination="CYQM" />);
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText("CYQM")).toBeInTheDocument();
  });

  it("orders origin before destination in the DOM", () => {
    const { container } = render(
      <RouteCell origin="CYHZ" destination="CYQM" />,
    );
    const labels = container.querySelectorAll("span.icao");
    expect(labels).toHaveLength(2);
    expect(labels[0]!.textContent).toBe("CYHZ");
    expect(labels[1]!.textContent).toBe("CYQM");
  });
});

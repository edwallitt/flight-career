import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CornerTicks } from "../CornerTicks.js";

describe("CornerTicks", () => {
  it("renders four corner spans by default at inset 3", () => {
    const { container } = render(
      <div className="relative">
        <CornerTicks />
      </div>,
    );
    const ticks = container.querySelectorAll("span");
    expect(ticks).toHaveLength(4);
    // Default inset=3 should use the `*-3` Tailwind tokens, not `*-4`.
    for (const t of ticks) {
      expect(t.className).toMatch(/(left|right|top|bottom)-3/);
      expect(t.className).not.toMatch(/(left|right|top|bottom)-4/);
    }
  });

  it("uses inset-4 positioning when inset=4", () => {
    const { container } = render(<CornerTicks inset={4} />);
    const ticks = container.querySelectorAll("span");
    expect(ticks).toHaveLength(4);
    for (const t of ticks) {
      expect(t.className).toMatch(/(left|right|top|bottom)-4/);
    }
  });

  it("emits one tick with each of tl/tr/bl/br border combinations", () => {
    const { container } = render(<CornerTicks />);
    const classes = Array.from(container.querySelectorAll("span")).map(
      (s) => s.className,
    );
    expect(classes.some((c) => /border-l/.test(c) && /border-t/.test(c))).toBe(true); // tl
    expect(classes.some((c) => /border-r/.test(c) && /border-t/.test(c))).toBe(true); // tr
    expect(classes.some((c) => /border-l/.test(c) && /border-b/.test(c))).toBe(true); // bl
    expect(classes.some((c) => /border-r/.test(c) && /border-b/.test(c))).toBe(true); // br
  });
});

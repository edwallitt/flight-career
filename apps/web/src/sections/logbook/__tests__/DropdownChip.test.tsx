import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DropdownChip } from "../DropdownChip.js";

const OPTIONS = [
  { value: "all", label: "All flights" },
  { value: "completed", label: "Completed" },
  { value: "diverted", label: "Diverted" },
];

describe("DropdownChip", () => {
  it("renders the label and the currently-selected option text", () => {
    render(
      <DropdownChip
        label="Outcome"
        value="completed"
        options={OPTIONS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Outcome")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Completed/ })).toBeInTheDocument();
  });

  it("falls back to em-dash when value matches no option", () => {
    render(
      <DropdownChip
        label="Outcome"
        value="unknown"
        options={OPTIONS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /—/ })).toBeInTheDocument();
  });

  it("opens the menu on click and shows every option", async () => {
    const user = userEvent.setup();
    render(
      <DropdownChip
        label="Outcome"
        value="all"
        options={OPTIONS}
        onChange={() => {}}
      />,
    );
    // Menu starts closed — only the trigger is visible.
    expect(screen.queryByRole("button", { name: /Diverted/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /All flights/ }));
    expect(screen.getByRole("button", { name: /Diverted/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Completed/ })).toBeInTheDocument();
  });

  it("calls onChange with the option value and closes the menu when an item is picked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DropdownChip
        label="Outcome"
        value="all"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /All flights/ }));
    await user.click(screen.getByRole("button", { name: /Diverted/ }));
    expect(onChange).toHaveBeenCalledWith("diverted");
    // Menu closed → Diverted is no longer in the doc (the trigger still shows
    // the original "All flights" label because value is controlled externally).
    expect(screen.queryByRole("button", { name: /Diverted/ })).toBeNull();
  });

  it("closes when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(
      <DropdownChip
        label="Outcome"
        value="all"
        options={OPTIONS}
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /All flights/ }));
    expect(screen.getByRole("button", { name: /Diverted/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: /Diverted/ })).toBeNull();
  });
});

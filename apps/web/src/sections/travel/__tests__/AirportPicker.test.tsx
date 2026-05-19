import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AirportPicker, type AirportOption } from "../AirportPicker.js";

const OPTIONS: AirportOption[] = [
  { icao: "CYHZ", name: "Halifax Stanfield Intl" },
  { icao: "CYQM", name: "Greater Moncton Intl" },
  { icao: "CYCH", name: "Miramichi" },
  { icao: "CYQI", name: "Yarmouth" },
  { icao: "CYYG", name: "Charlottetown" },
];

describe("AirportPicker — selected state", () => {
  it("renders the selected airport summary with a 'change' affordance when value is set and closed", () => {
    render(
      <AirportPicker
        options={OPTIONS}
        value="CYHZ"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("CYHZ")).toBeInTheDocument();
    expect(screen.getByText("Halifax Stanfield Intl")).toBeInTheDocument();
    expect(screen.getByText(/change/i)).toBeInTheDocument();
  });

  it("clicking the summary clears the value and opens the search input", async () => {
    const onChange = vi.fn();
    render(
      <AirportPicker
        options={OPTIONS}
        value="CYHZ"
        onChange={onChange}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /CYHZ/ }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

describe("AirportPicker — search + select", () => {
  it("shows all options (capped at 30) when query is empty and input is focused", async () => {
    render(
      <AirportPicker
        options={OPTIONS}
        value={null}
        onChange={() => {}}
      />,
    );
    await userEvent.setup().click(screen.getByRole("textbox"));
    for (const o of OPTIONS) {
      expect(screen.getByText(o.icao)).toBeInTheDocument();
    }
  });

  it("filters options by ICAO or name (case-insensitive substring)", async () => {
    render(
      <AirportPicker
        options={OPTIONS}
        value={null}
        onChange={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "monc");
    expect(screen.getByText("CYQM")).toBeInTheDocument();
    expect(screen.queryByText("CYHZ")).toBeNull();
    expect(screen.queryByText("CYCH")).toBeNull();
  });

  it("renders 'No matches' when the query matches nothing", async () => {
    render(
      <AirportPicker
        options={OPTIONS}
        value={null}
        onChange={() => {}}
      />,
    );
    await userEvent.setup().type(screen.getByRole("textbox"), "ZZZZZ");
    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });

  it("invokes onChange with the picked ICAO and closes the menu", async () => {
    const onChange = vi.fn();
    render(
      <AirportPicker
        options={OPTIONS}
        value={null}
        onChange={onChange}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox"));
    await user.click(screen.getByRole("button", { name: /CYQI/ }));
    expect(onChange).toHaveBeenCalledWith("CYQI");
  });

  it("hides the excludeIcao option (typically the origin when picking destination)", async () => {
    render(
      <AirportPicker
        options={OPTIONS}
        value={null}
        onChange={() => {}}
        excludeIcao="CYHZ"
      />,
    );
    await userEvent.setup().click(screen.getByRole("textbox"));
    expect(screen.queryByText("CYHZ")).toBeNull();
    expect(screen.getByText("CYQM")).toBeInTheDocument();
  });

  it("renders the supplied placeholder", () => {
    render(
      <AirportPicker
        options={OPTIONS}
        value={null}
        onChange={() => {}}
        placeholder="Pick a strip"
      />,
    );
    expect(screen.getByPlaceholderText("Pick a strip")).toBeInTheDocument();
  });
});

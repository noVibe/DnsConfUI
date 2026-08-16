import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToggleSwitch } from "./toggle-switch";

describe("ToggleSwitch", () => {
  it("exposes only its label as the accessible checkbox name", () => {
    render(
      <ToggleSwitch checked onChange={vi.fn()} label="DNS donor" tooltip="Long help text">
        <select aria-label="DNS preset"><option>GeoHide</option></select>
      </ToggleSwitch>,
    );

    expect(screen.getByRole("checkbox", { name: "DNS donor" })).toBeChecked();
  });

  it("does not toggle when interacting with a child control", () => {
    const onChange = vi.fn();
    render(
      <ToggleSwitch checked={false} onChange={onChange} label="DNS donor">
        <button type="button">Choose preset</button>
      </ToggleSwitch>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose preset" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("DNS donor"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("keeps the tooltip available while disabling credential-dependent settings", () => {
    render(
      <ToggleSwitch
        checked={false}
        onChange={vi.fn()}
        label="NextDNS API setting"
        tooltip="Credentials are required"
        disabled
      />,
    );

    expect(screen.getByRole("checkbox", { name: "NextDNS API setting" })).toBeDisabled();
    expect(screen.getByRole("note", { name: "Credentials are required" })).toBeVisible();
  });
});

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RuleFields } from "./RuleFields";

afterEach(cleanup);

function PaddingInput() {
  const [length, setLength] = useState(3);
  return <>
    <RuleFields rule={{ type: "padding", enabled: true, config: { mode: "number", length } }}
      onChange={(config) => { if (typeof config.length === "number") setLength(config.length); }} />
    <output aria-label="规则长度">{length}</output>
  </>;
}

describe("NumberStepper input", () => {
  it("allows clearing and typing an in-range number without forcing the minimum", () => {
    render(<PaddingInput />);
    const input = screen.getByRole("spinbutton", { name: "目标长度" });
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);
    expect(screen.getByLabelText("规则长度")).toHaveTextContent("3");
    fireEvent.change(input, { target: { value: "12" } });
    expect(input).toHaveValue(12);
    expect(screen.getByLabelText("规则长度")).toHaveTextContent("12");
    fireEvent.click(screen.getByRole("button", { name: "目标长度加一" }));
    expect(input).toHaveValue(13);
  });

  it("keeps out-of-range drafts out of the rule and clamps them on blur", () => {
    render(<PaddingInput />);
    const input = screen.getByRole("spinbutton", { name: "目标长度" });
    fireEvent.change(input, { target: { value: "999" } });
    expect(input).toHaveValue(999);
    expect(screen.getByLabelText("规则长度")).toHaveTextContent("3");
    fireEvent.blur(input);
    expect(input).toHaveValue(255);
    expect(screen.getByRole("button", { name: "目标长度加一" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(1);
    expect(screen.getByRole("button", { name: "目标长度减一" })).toBeDisabled();
  });

  it("restores an empty draft and commits an integer on Enter", () => {
    render(<PaddingInput />);
    const input = screen.getByRole("spinbutton", { name: "目标长度" });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(3);
    input.focus();
    fireEvent.change(input, { target: { value: "12.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue(12);
    expect(screen.getByLabelText("规则长度")).toHaveTextContent("12");
  });
});

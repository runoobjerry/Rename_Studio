import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NumberField } from "./NumberField";

afterEach(cleanup);

function NumberInput() {
  const [length, setLength] = useState(3);
  return <>
    <NumberField label="数量" value={length} min={1} max={255}
      onChange={setLength} />
    <output aria-label="当前数值">{length}</output>
  </>;
}

describe("NumberField input", () => {
  it("allows clearing and typing an in-range number without forcing the minimum", () => {
    render(<NumberInput />);
    const input = screen.getByRole("spinbutton", { name: "数量" });
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);
    expect(screen.getByLabelText("当前数值")).toHaveTextContent("3");
    fireEvent.change(input, { target: { value: "12" } });
    expect(input).toHaveValue(12);
    expect(screen.getByLabelText("当前数值")).toHaveTextContent("12");
    fireEvent.click(screen.getByRole("button", { name: "数量加一" }));
    expect(input).toHaveValue(13);
  });

  it("keeps out-of-range drafts out of the controlled value and clamps them on blur", () => {
    render(<NumberInput />);
    const input = screen.getByRole("spinbutton", { name: "数量" });
    fireEvent.change(input, { target: { value: "999" } });
    expect(input).toHaveValue(999);
    expect(screen.getByLabelText("当前数值")).toHaveTextContent("3");
    fireEvent.blur(input);
    expect(input).toHaveValue(255);
    expect(screen.getByRole("button", { name: "数量加一" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(1);
    expect(screen.getByRole("button", { name: "数量减一" })).toBeDisabled();
  });

  it("restores an empty draft and commits an integer on Enter", () => {
    render(<NumberInput />);
    const input = screen.getByRole("spinbutton", { name: "数量" });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(3);
    input.focus();
    fireEvent.change(input, { target: { value: "12.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue(12);
    expect(screen.getByLabelText("当前数值")).toHaveTextContent("12");
  });
});

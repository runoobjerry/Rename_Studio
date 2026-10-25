import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RuleSpec } from "../../types";
import { RuleFields } from "./RuleFields";

afterEach(cleanup);

function RuleInput({ initialRule }: { initialRule: RuleSpec }) {
  const [rule, setRule] = useState(initialRule);
  return <>
    <RuleFields rule={rule}
      onChange={(config) => setRule((current) => ({ ...current, config: { ...current.config, ...config } }))} />
    <output aria-label="规则配置">{JSON.stringify(rule.config)}</output>
  </>;
}

describe("RuleFields numeric fields", () => {
  it("updates padding length through the shared number field without changing its mode", () => {
    render(<RuleInput initialRule={{ type: "padding", enabled: true, config: { mode: "number", length: 3 } }} />);
    fireEvent.click(screen.getByRole("button", { name: "目标长度加一" }));
    expect(screen.getByRole("spinbutton", { name: "目标长度" })).toHaveValue(4);
    expect(JSON.parse(screen.getByLabelText("规则配置").textContent!)).toEqual({ mode: "number", length: 4 });
  });

  it("updates insertion position through the shared number field without changing the inserted text", () => {
    render(<RuleInput initialRule={{ type: "insert", enabled: true, config: { position: "index", index: 2, text: "prefix" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "字符位置减一" }));
    const input = screen.getByRole("spinbutton", { name: "字符位置" });
    expect(input).toHaveValue(1);
    expect(screen.getByRole("button", { name: "字符位置减一" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "12" } });
    expect(JSON.parse(screen.getByLabelText("规则配置").textContent!)).toEqual({ position: "index", index: 12, text: "prefix" });
  });
});

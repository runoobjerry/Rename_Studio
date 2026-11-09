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

describe("sequence numbering fields", () => {
  it("sends nullable optional values and clears incompatible padding when switching systems", () => {
    render(<RuleInput initialRule={{ type: "serialize", enabled: true, config: {} }} />);
    expect(screen.queryByRole("spinbutton", { name: "每组文件数" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "补齐长度" })).not.toBeInTheDocument();
    const start = screen.getByRole("spinbutton", { name: "起始序号" });
    const step = screen.getByRole("spinbutton", { name: "步长" });
    for (const input of [start, step]) {
      expect(input).toHaveAttribute("min", "-99999999");
      expect(input).toHaveAttribute("max", "99999999");
    }
    fireEvent.change(start, { target: { value: "0" } });
    fireEvent.change(step, { target: { value: "-2" } });
    const reset = screen.getByRole("switch", { name: "重置间隔" });
    fireEvent.click(reset);
    fireEvent.change(screen.getByRole("spinbutton", { name: "每组文件数" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("switch", { name: "填充 0 补足长度" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "补齐长度" }), { target: { value: "4" } });
    const config = () => JSON.parse(screen.getByLabelText("规则配置").textContent!);
    expect(config()).toEqual({ start: 0, step: -2, reset_every: 3, pad_length: 4 });

    fireEvent.click(reset);
    expect(screen.queryByRole("spinbutton", { name: "每组文件数" })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "编号方式" }));
    fireEvent.click(screen.getByRole("option", { name: "英文字母" }));
    expect(screen.queryByRole("switch", { name: "填充 0 补足长度" })).not.toBeInTheDocument();
    expect(screen.queryByText(/此编号方式支持的范围/)).not.toBeInTheDocument();
    expect(config()).toEqual({ numbering_system: "alphabetic", start: 1, step: -2, reset_every: null, pad_length: null });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "编号方式" }));
    fireEvent.click(screen.getByRole("option", { name: "罗马数字" }));
    expect(screen.getByRole("combobox", { name: "编号方式" }))
      .toHaveAccessibleDescription("此编号方式支持的范围为 1~3999");
  });

  it("exposes character position only when selected and submits the extension choice", () => {
    render(<RuleInput initialRule={{ type: "serialize", enabled: true, config: {} }} />);
    expect(screen.queryByRole("spinbutton", { name: "字符位置" })).not.toBeInTheDocument();
    const extension = screen.getByRole("checkbox", { name: "忽略扩展名" });
    expect(extension).toBeChecked();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "插入位置" }));
    fireEvent.click(screen.getByRole("option", { name: "指定字符位置" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "字符位置" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "从右往左计数" }));
    fireEvent.click(extension);
    expect(JSON.parse(screen.getByLabelText("规则配置").textContent!)).toEqual({
      position: "index", index: 2, from_right: true, ignore_extension: false,
    });
  });
});

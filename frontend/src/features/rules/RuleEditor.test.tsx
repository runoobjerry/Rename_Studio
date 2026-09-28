import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuleDefinition, RuleSpec } from "../../types";
import { RuleEditor } from "./RuleEditor";


const definition: RuleDefinition = {
  type: "padding",
  name: "填充",
  description: "填充文件名",
  config_schema: {},
};

const textRule: RuleSpec = {
  type: "padding",
  enabled: true,
  config: {
    mode: "text",
    length: 8,
    fill_character: "_",
    side: "left",
  },
};

describe("RuleEditor", () => {
  it("adds a number-padding rule with safe defaults", () => {
    const onChange = vi.fn();
    render(<RuleEditor definitions={[definition]} rules={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "+ 添加填充" }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "padding",
        config: expect.objectContaining({ mode: "number", length: 3 }),
      }),
    ]);
  });

  it("updates the text fill character", () => {
    const onChange = vi.fn();
    render(
      <RuleEditor definitions={[definition]} rules={[textRule]} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText("填充字符"), { target: { value: "-" } });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        config: expect.objectContaining({ fill_character: "-" }),
      }),
    ]);
  });
});

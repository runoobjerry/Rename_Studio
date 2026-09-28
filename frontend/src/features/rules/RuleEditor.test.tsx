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

const replaceDefinition: RuleDefinition = {
  type: "replace",
  name: "替换",
  description: "替换匹配文本",
  config_schema: {},
};

const removeDefinition: RuleDefinition = {
  type: "remove",
  name: "移除",
  description: "移除匹配文本",
  config_schema: {},
};

const insertDefinition: RuleDefinition = {
  type: "insert",
  name: "插入",
  description: "插入指定文本",
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

  it("adds replacement and removal rules", () => {
    const onChange = vi.fn();
    render(
      <RuleEditor
        definitions={[replaceDefinition, removeDefinition]}
        rules={[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ 替换" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 移除" }));

    expect(onChange).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ type: "replace" })],
    );
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ type: "remove" })],
    );
  });

  it("updates replacement matching options", () => {
    const onChange = vi.fn();
    const rule: RuleSpec = {
      type: "replace",
      enabled: true,
      config: {
        search: "old",
        replacement: "new",
        occurrence: "all",
        case_sensitive: true,
        whole_word: false,
        ignore_extension: true,
      },
    };
    render(
      <RuleEditor
        definitions={[replaceDefinition]}
        rules={[rule]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("操作序数"), {
      target: { value: "last" },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        config: expect.objectContaining({ occurrence: "last" }),
      }),
    ]);
  });

  it("adds and configures an index insertion rule", () => {
    const onChange = vi.fn();
    const rule: RuleSpec = {
      type: "insert",
      enabled: true,
      config: {
        text: "-",
        position: "index",
        index: 1,
        from_right: false,
        anchor: "",
      },
    };
    const view = render(
      <RuleEditor
        definitions={[insertDefinition]}
        rules={[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ 插入" }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ type: "insert" }),
    ]);

    view.rerender(
      <RuleEditor
        definitions={[insertDefinition]}
        rules={[rule]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("从右往左计数"));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        config: expect.objectContaining({ from_right: true }),
      }),
    ]);
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import type { RuleDefinition, RuleSpec } from "../../types";
import { cloneRule, DEFAULT_RULES, RuleEditor } from "./RuleEditor";

afterEach(cleanup);

const definition: RuleDefinition = {
  type: "padding",
  config_schema: {},
};

const replaceDefinition: RuleDefinition = {
  type: "replace",
  config_schema: {},
};

const insertDefinition: RuleDefinition = {
  type: "insert",
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

  it("displays an unknown rule ID and keeps its original configuration when toggled", async () => {
    const onChange = vi.fn();
    const rule = { type: "opaque_rule", enabled: true, config: { text: "原始值" } };
    render(<RuleEditor definitions={[{ type: rule.type, config_schema: {} }]} rules={[rule]} onChange={onChange} />);
    expect(screen.getByRole("switch", { name: "opaque_rule启用状态" })).toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "opaque_rule启用状态" }));
    expect(onChange).toHaveBeenCalledWith([{ ...rule, enabled: false }]);
  });

  it("keeps number drafts with their rule through edits, moves, copies and deletion", () => {
    const onChange = vi.fn();
    function Editor() {
      const [rules, setRules] = useState(() => [cloneRule(textRule), cloneRule(textRule)]);
      return <RuleEditor definitions={[definition]} rules={rules} onChange={(next) => {
        onChange(next);
        setRules(next);
      }} />;
    }
    render(<Editor />);
    const [first, second] = screen.getAllByRole("spinbutton", { name: "目标长度" });
    fireEvent.change(first, { target: { value: "" } });
    fireEvent.change(second, { target: { value: "999" } });
    // 字段编辑生成新 RuleSpec，但不应重挂载同一规则的数字输入。
    fireEvent.change(screen.getAllByLabelText("填充字符")[0], { target: { value: "-" } });
    expect(screen.getAllByRole("spinbutton", { name: "目标长度" })[0]).toBe(first);
    expect(first).toHaveValue(null);
    fireEvent.click(screen.getAllByRole("button", { name: "下移规则" })[0]);
    expect(screen.getAllByRole("spinbutton", { name: "目标长度" })).toEqual([second, first]);
    expect(first).toHaveValue(null);
    expect(second).toHaveValue(999);
    fireEvent.click(screen.getAllByRole("button", { name: "上移规则" })[1]);
    expect(screen.getAllByRole("spinbutton", { name: "目标长度" })).toEqual([first, second]);
    fireEvent.click(screen.getAllByRole("button", { name: "复制规则" })[0]);
    const copy = screen.getAllByRole("spinbutton", { name: "目标长度" })[2];
    expect(copy).not.toBe(first);
    expect(copy).toHaveValue(8);
    fireEvent.change(copy, { target: { value: "9" } });
    expect(first).toHaveValue(null);
    fireEvent.click(screen.getAllByRole("button", { name: "删除规则" })[0]);
    expect(screen.getAllByRole("spinbutton", { name: "目标长度" })).toEqual([second, copy]);
    expect(second).toHaveValue(999);
    expect(copy).toHaveValue(9);
    const sentRules = onChange.mock.lastCall![0] as RuleSpec[];
    expect(sentRules).toEqual([textRule, { ...textRule, config: { ...textRule.config, fill_character: "-", length: 9 } }]);
  });

  it("preserves retained parent objects and resets drafts for a replacement list", () => {
    const first = cloneRule(textRule);
    const second = cloneRule(textRule);
    const onChange = vi.fn();
    const { rerender } = render(<RuleEditor definitions={[definition]} rules={[first, second]} onChange={onChange} />);
    const input = screen.getAllByRole("spinbutton", { name: "目标长度" })[1];
    fireEvent.change(input, { target: { value: "" } });
    rerender(<RuleEditor definitions={[definition]} rules={[cloneRule(textRule), second, first]} onChange={onChange} />);
    expect(screen.getAllByRole("spinbutton", { name: "目标长度" })[1]).toBe(input);
    rerender(<RuleEditor definitions={[definition]} rules={[second]} onChange={onChange} />);
    expect(screen.getByRole("spinbutton", { name: "目标长度" })).toBe(input);
    expect(input).toHaveValue(null);
    // 新对象即新列表成员，即使内容相同也不能继承旧编辑草稿。
    rerender(<RuleEditor definitions={[definition]} rules={[cloneRule(second)]} onChange={onChange} />);
    expect(screen.getByRole("spinbutton", { name: "目标长度" })).not.toBe(input);
    expect(screen.getByRole("spinbutton", { name: "目标长度" })).toHaveValue(8);
    rerender(<RuleEditor definitions={[definition]} rules={[]} onChange={onChange} />);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("opens the inline menu and appends an independent rule configuration", async () => {
    const onChange = vi.fn();
    render(
      <RuleEditor
        definitions={[definition]}
        rules={[textRule]}
        onChange={onChange}
      />,
    );

    const addButton = screen.getByRole("button", { name: /添加规则/ });
    addButton.focus();
    fireEvent.click(addButton);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "填充" }));
    expect(onChange).toHaveBeenCalledWith([textRule, DEFAULT_RULES.padding]);
    const added = onChange.mock.calls[0][0][1] as RuleSpec;
    expect(added).not.toBe(DEFAULT_RULES.padding);
    expect(added.config).not.toBe(DEFAULT_RULES.padding.config);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "添加规则" })).toHaveFocus();
  });

  it("limits the menu viewport to eight rows without dropping overflow options", () => {
    // 临时注入已适配规则模板，仅验证未来超过八项时的展示边界。
    const extras = Array.from({ length: 9 }, (_, index) => ({ ...definition, type: `test-${index}` }));
    const onChange = vi.fn();
    try {
      extras.forEach((extra) => { DEFAULT_RULES[extra.type] = { ...DEFAULT_RULES.padding, type: extra.type }; });
      render(<RuleEditor definitions={extras} rules={[]} onChange={onChange} />);
      fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
      expect(screen.getAllByRole("menuitem")).toHaveLength(9);
      expect(screen.getByRole("menu")).toHaveStyle({ maxHeight: "294px", overflowY: "auto" });
      fireEvent.click(screen.getByRole("menuitem", { name: "test-0" }));
      expect(onChange).toHaveBeenCalledWith([{ ...DEFAULT_RULES.padding, type: "test-0" }]);
    } finally {
      extras.forEach((extra) => { delete DEFAULT_RULES[extra.type]; });
    }
  });

  it("disables adding while loading and does not expose unimplemented rule types", () => {
    const { rerender } = render(<RuleEditor definitions={[definition]} rules={[]} onChange={vi.fn()} isLoading />);
    expect(screen.getByRole("button", { name: "添加规则" })).toBeDisabled();
    rerender(<RuleEditor definitions={[{ ...definition, type: "unknown" }]} rules={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "添加规则" })).toBeDisabled();
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

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "操作序数" }));
    fireEvent.click(screen.getByRole("option", { name: "末个" }));

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
    render(
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


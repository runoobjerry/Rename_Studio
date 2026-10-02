import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuleDefinition, RuleSpec } from "../../types";
import { DEFAULT_RULES, RuleEditor } from "./RuleEditor";

afterEach(cleanup);


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
  it("opens the inline menu and appends an independent rule configuration", async () => {
    const onChange = vi.fn();
    render(
      <RuleEditor
        definitions={[definition]}
        rules={[textRule]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /添加规则/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "填充" }));
    expect(onChange).toHaveBeenCalledWith([textRule, DEFAULT_RULES.padding]);
    const added = onChange.mock.calls[0][0][1] as RuleSpec;
    expect(added).not.toBe(DEFAULT_RULES.padding);
    expect(added.config).not.toBe(DEFAULT_RULES.padding.config);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "添加规则" })).toHaveFocus();
  });

  it("places clear before add and shows descriptions in a tooltip", async () => {
    render(<RuleEditor definitions={[definition]} rules={[]} onChange={vi.fn()} />);
    const actions = document.querySelector(".rule-heading-actions");
    expect(actions?.querySelectorAll("button")[0]).toHaveTextContent("一键清除");
    expect(actions?.querySelectorAll("button")[1]).toHaveTextContent("添加规则");
    fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
    fireEvent.mouseOver(screen.getByRole("menuitem", { name: "填充" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("填充文件名");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("limits the menu viewport to eight rows without dropping overflow options", () => {
    // 临时注入已适配规则模板，仅验证未来超过八项时的展示边界。
    const extras = Array.from({ length: 9 }, (_, index) => ({ ...definition, type: `test-${index}`, name: `测试规则 ${index}` }));
    try {
      extras.forEach((extra) => { DEFAULT_RULES[extra.type] = { ...DEFAULT_RULES.padding, type: extra.type }; });
      render(<RuleEditor definitions={extras} rules={[]} onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
      expect(screen.getAllByRole("menuitem")).toHaveLength(9);
      expect(screen.getByRole("menu")).toHaveStyle({ maxHeight: "294px", overflowY: "auto" });
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

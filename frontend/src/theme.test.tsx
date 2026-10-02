import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Menu, MenuItem, TextField, ThemeProvider } from "@mui/material";
import { afterEach, describe, expect, it } from "vitest";
import { createAppTheme } from "./theme";
import { CheckboxFilterMenu } from "./components/CheckboxFilterMenu";
import { RuleEditor } from "./features/rules/RuleEditor";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("shared dropdown geometry in %s mode", (mode) => {
  it.each(["menu", "select", "filter", "rules"] as const)("applies theme spacing to %s without local spacing overrides", (kind) => {
    const content = kind === "menu" ? (
      <Menu open anchorReference="none"><MenuItem>栏目一</MenuItem><MenuItem>栏目二</MenuItem></Menu>
    ) : kind === "select" ? (
      <TextField select value="one" onChange={() => { }}>
        <MenuItem value="one">栏目一</MenuItem><MenuItem value="two">栏目二</MenuItem>
      </TextField>
    ) : kind === "filter" ? (
      <CheckboxFilterMenu label="筛选测试" options={[{ value: "one", label: "栏目一" }, { value: "two", label: "栏目二" }]} selected={["one", "two"]} onChange={() => { }} />
    ) : (
      <RuleEditor definitions={[
        { type: "padding", name: "填充", description: "填充文件名", config_schema: {} },
        { type: "replace", name: "替换", description: "替换文本", config_schema: {} },
      ]} rules={[]} onChange={() => { }} />
    );
    render(<ThemeProvider theme={createAppTheme(mode)}>{content}</ThemeProvider>);
    if (kind === "select") fireEvent.mouseDown(screen.getByRole("combobox"));
    if (kind === "filter") fireEvent.click(screen.getByRole("button", { name: "筛选测试" }));
    if (kind === "rules") fireEvent.click(screen.getByRole("button", { name: "添加规则" }));

    const list = screen.getByRole(kind === "select" ? "listbox" : "menu");
    expect(list).toHaveStyle({ padding: "4px", gap: "2px", display: "flex", boxSizing: "border-box" });
    const items = screen.getAllByRole(kind === "select" ? "option" : kind === "filter" ? "menuitemcheckbox" : "menuitem");
    items.forEach((item) => {
      expect(item).toHaveStyle({ margin: "0px", padding: "4px 12px", height: "34px", minHeight: "34px", fontSize: "13px" });
    });
    expect(list.closest(".MuiMenu-paper")).toHaveStyle({ padding: "0px", borderRadius: "10px" });
  });
});

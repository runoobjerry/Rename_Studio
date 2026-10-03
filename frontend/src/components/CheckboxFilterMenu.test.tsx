import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import { afterEach, describe, expect, it } from "vitest";
import { CheckboxFilterMenu } from "./CheckboxFilterMenu";
import { createAppTheme } from "../theme";

afterEach(cleanup);

function Filter() {
  const [selected, setSelected] = useState<string[]>([]);
  return <CheckboxFilterMenu label="筛选项目" options={[{ value: "file", label: "文件" }, { value: "folder", label: "文件夹" }]} selected={selected} onChange={setSelected} />;
}

describe.each(["light", "dark"] as const)("filter icon in %s mode", (mode) => {
  it("uses a neutral off icon by default and accent when any option is checked", () => {
    const theme = createAppTheme(mode);
    render(<ThemeProvider theme={theme}><Filter /></ThemeProvider>);
    const button = screen.getByRole("button", { name: "筛选项目" });
    expect(button).toHaveStyle({ color: theme.palette.text.secondary });
    expect(button).toHaveStyle({ padding: "5px", border: "0px" });
    expect(screen.getByTestId("FilterListOffIcon")).toHaveStyle({ fontSize: "20px" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件" }));
    expect(button).toHaveStyle({ color: theme.palette.primary.main });
    expect(button).toHaveStyle({ padding: "5px", border: "0px" });
    expect(screen.getByTestId("FilterListIcon")).toHaveStyle({ fontSize: "20px" });
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件夹" }));
    expect(screen.getByTestId("FilterListIcon")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件夹" }));
    expect(button).toHaveStyle({ color: theme.palette.text.secondary });
    expect(screen.getByTestId("FilterListOffIcon")).toBeInTheDocument();
  });

  it("shows a tooltip describing the default state", async () => {
    render(<ThemeProvider theme={createAppTheme(mode)}><Filter /></ThemeProvider>);
    fireEvent.mouseOver(screen.getByRole("button", { name: "筛选项目" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("筛选项目（未启用）");
  });
});

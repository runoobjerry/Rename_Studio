import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@mui/material";
import { createAppTheme } from "../../theme";

import { FileBrowser } from "./FileBrowser";

afterEach(cleanup);


const listing = {
  provider: "local",
  path: "",
  parent_path: null,
  items: [
    {
      id: "folder",
      name: "folder",
      path: "folder",
      parent_path: "",
      is_directory: true,
      size: null,
      modified_at: null,
    },
    {
      id: "file.txt",
      name: "file.txt",
      path: "file.txt",
      parent_path: "",
      is_directory: false,
      size: 4,
      modified_at: null,
    },
  ],
};

describe("FileBrowser", () => {
  it.each(["light", "dark"] as const)("uses shared icon-only toolbar controls in %s mode without changing the filter", (mode) => {
    const theme = createAppTheme(mode);
    render(<ThemeProvider theme={theme}>
      <FileBrowser listing={{ ...listing, parent_path: "" }} providerName="本地文件" selectedIds={[]}
        onNavigate={vi.fn()} onToggle={vi.fn()} onRefresh={vi.fn()} onSelectAll={vi.fn()} onInvertSelection={vi.fn()} />
    </ThemeProvider>);
    for (const name of ["返回上级", "刷新", "反选"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveStyle({ color: theme.palette.text.secondary, padding: "5px", border: "0px" });
      expect(button.textContent).toBe("");
    }
    expect(screen.getByTestId("ArrowBackRoundedIcon")).toHaveStyle({ fontSize: "20px" });
    expect(screen.getByTestId("RefreshRoundedIcon")).toHaveStyle({ fontSize: "20px" });
    const inverseIcon = screen.getByRole("button", { name: "反选" }).querySelector("span");
    expect(inverseIcon).toHaveStyle({ width: "20px", height: "20px" });
    expect(screen.getByTestId("FilterListOffIcon")).toHaveStyle({ fontSize: "20px" });
    expect(screen.queryByRole("button", { name: "全选" })).not.toBeInTheDocument();
  });

  it("passes only visible IDs to bulk actions and uses visible rows for header state", async () => {
    const onSelectAll = vi.fn();
    const onInvertSelection = vi.fn();
    const onClearSelection = vi.fn();
    const props = { listing, providerName: "本地文件", selectedIds: ["folder"],
      onNavigate: vi.fn(), onToggle: vi.fn(), onSelectAll, onInvertSelection, onClearSelection };
    const { rerender } = render(<FileBrowser {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    const header = screen.getByRole("checkbox", { name: "选择当前显示的全部项目" });
    expect(header).not.toBeChecked();
    expect(header).toHaveAttribute("data-indeterminate", "false");
    expect(screen.queryByRole("button", { name: "全选" })).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(onSelectAll).toHaveBeenCalledWith(["file.txt"]);
    fireEvent.click(screen.getByRole("button", { name: "反选" }));
    expect(onInvertSelection).toHaveBeenCalledWith(["file.txt"]);
    fireEvent.click(header);
    expect(onSelectAll).toHaveBeenLastCalledWith(["file.txt"]);

    rerender(<FileBrowser {...props} selectedIds={["file.txt"]} />);
    expect(header).toBeChecked();
    fireEvent.click(header);
    expect(onClearSelection).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "反选" })).toBeEnabled();
    expect(header).toBeEnabled();
    expect(screen.getByText("folder")).toBeInTheDocument();
    expect(screen.getByText("file.txt")).toBeInTheDocument();
  });
  it("clears hidden selections when the file filter changes", () => {
    const onSelectAll = vi.fn();
    const onToggle = vi.fn();
    render(<FileBrowser listing={listing} providerName="本地文件" selectedIds={["folder"]}
      onNavigate={vi.fn()} onToggle={onToggle} onSelectAll={onSelectAll} onInvertSelection={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    const files = screen.getByRole("menuitemcheckbox", { name: "文件" });
    expect(files).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemcheckbox", { name: "文件夹" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("folder")).toBeInTheDocument();
    fireEvent.click(files);
    expect(screen.queryByText("folder")).not.toBeInTheDocument();
    expect(screen.getByText("file.txt")).toBeInTheDocument();
    expect(screen.getByText(/已选择 1 项/)).toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();
    expect(onSelectAll).toHaveBeenCalledWith([]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件" }));
    expect(screen.getByText("folder")).toBeInTheDocument();
    expect(screen.getByText("file.txt")).toBeInTheDocument();
  });
  it("disables bulk actions when an active filter has no matching rows", async () => {
    render(<FileBrowser listing={{ ...listing, items: [listing.items[0]] }} providerName="本地文件" selectedIds={[]}
      onNavigate={vi.fn()} onToggle={vi.fn()} onSelectAll={vi.fn()} onInvertSelection={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByText("没有符合筛选条件的项目。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全选" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "反选" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "选择当前显示的全部项目" })).toBeDisabled();
  });
  it("selects a directory name without navigating into it", () => {
    const onNavigate = vi.fn();
    const onToggle = vi.fn();
    render(
      <FileBrowser
        listing={listing}
        providerName="本地文件"
        selectedIds={[]}
        onNavigate={onNavigate}
        onToggle={onToggle}
        onSelectAll={vi.fn()}
        onInvertSelection={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("选择文件夹 folder"));

    expect(onToggle).toHaveBeenCalledWith("folder");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("navigates only when the directory name is clicked", () => {
    const onNavigate = vi.fn();
    render(
      <FileBrowser
        listing={listing}
        providerName="本地文件"
        selectedIds={[]}
        onNavigate={onNavigate}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onInvertSelection={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /folder/ }));

    expect(onNavigate).toHaveBeenCalledWith("folder");
  });

  it("exposes select-all and invert-selection actions", () => {
    const onSelectAll = vi.fn();
    const onInvertSelection = vi.fn();
    render(
      <FileBrowser
        listing={listing}
        providerName="本地文件"
        selectedIds={[]}
        onNavigate={vi.fn()}
        onToggle={vi.fn()}
        onSelectAll={onSelectAll}
        onInvertSelection={onInvertSelection}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    fireEvent.click(screen.getByRole("button", { name: "反选" }));

    expect(onSelectAll).toHaveBeenCalledOnce();
    expect(onInvertSelection).toHaveBeenCalledOnce();
  });
});

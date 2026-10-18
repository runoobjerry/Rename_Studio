import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileBrowserHarness as FileBrowser } from "../../test/FileBrowserHarness";
import type { RenameTask } from "../../types";

afterEach(() => { cleanup(); window.localStorage.clear(); });


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
  it("shows Google shortcuts without navigation and excludes non-renamable items from selection", () => {
    const onSelectAll = vi.fn();
    const onInvertSelection = vi.fn();
    const navigate = vi.fn();
    render(<FileBrowser listing={{ ...listing, provider: "google_drive", items: [
      { ...listing.items[0], id: "readonly", can_rename: false, location: { kind: "id", value: "readonly" } },
      { ...listing.items[1], id: "shortcut", name: "Folder link", can_rename: false, mime_type: "application/vnd.google-apps.shortcut" },
      { ...listing.items[1], id: "doc", name: "Budget.2026", mime_type: "application/vnd.google-apps.spreadsheet", can_rename: true },
    ] }} providerName="Google" selectedIds={[]} onNavigate={navigate} onNavigateLocation={navigate}
      onToggle={vi.fn()} onSelectAll={onSelectAll} onInvertSelection={onInvertSelection} />);
    expect(screen.getByRole("checkbox", { name: "选择文件 Folder link" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "选择文件夹 folder" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Folder link" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "folder" }));
    expect(navigate).toHaveBeenCalledWith({ kind: "id", value: "readonly" });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "反选" }));
    expect(onSelectAll).toHaveBeenCalledWith(["doc"]);
    expect(onInvertSelection).toHaveBeenCalledWith(["doc"]);
  });

  it("navigates same-named folders and parents by opaque location", () => {
    const navigate = vi.fn();
    const navigateLocation = vi.fn();
    render(<FileBrowser listing={{ ...listing, parent_location: { kind: "id", value: "parent-id" }, items: [
      { ...listing.items[0], id: "first", name: "same", location: { kind: "id", value: "first" } },
      { ...listing.items[0], id: "second", name: "same", location: { kind: "id", value: "second" } },
    ] }} providerName="Cloud" selectedIds={[]} onNavigate={navigate} onNavigateLocation={navigateLocation} onToggle={vi.fn()} onSelectAll={vi.fn()} onInvertSelection={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "same" })[1]);
    expect(navigateLocation).toHaveBeenCalledWith({ kind: "id", value: "second" });
    fireEvent.click(screen.getByRole("button", { name: "返回上级" }));
    expect(navigateLocation).toHaveBeenLastCalledWith({ kind: "id", value: "parent-id" });
    expect(navigate).not.toHaveBeenCalled();
  });
  it("passes only visible IDs to bulk actions and uses visible rows for header state", async () => {
    const onSelectAll = vi.fn();
    const onInvertSelection = vi.fn();
    const onClearSelection = vi.fn();
    const props = { listing, providerName: "本地文件", selectedIds: ["folder"],
      onNavigate: vi.fn(), onToggle: vi.fn(), onSelectAll, onInvertSelection, onClearSelection };
    const { rerender } = render(<FileBrowser {...props} selectedIds={[]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "反选" }));
    expect(onSelectAll).toHaveBeenCalledWith(["folder", "file.txt"]);
    expect(onInvertSelection).toHaveBeenCalledOnce();
    onSelectAll.mockClear();
    onInvertSelection.mockClear();

    rerender(<FileBrowser {...props} />);
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
});


const sessionTask = () => ({
  taskId: "task", contextKey: "context", storageId: "local", location: { kind: "root" as const }, rules: [], batches: [],
  items: listing.items.map((file, order) => ({ taskItemId: `item-${order}`, order, before: { ...file, storageId: "local" },
    currentFileId: file.id, status: order === 0 ? "completed" as const : "pending" as const })),
});
const taskProps = () => ({ listing, providerName: "本地文件", selectedIds: [], task: sessionTask(), taskCurrent: true,
  onNavigate: vi.fn(), onToggle: vi.fn(), onSelectAll: vi.fn(), onInvertSelection: vi.fn(), onEndTask: vi.fn() });

it("shows only task members, defaults to pending and groups status filters in the original menu", async () => {
  const props = taskProps();
  render(<FileBrowser {...props} listing={{ ...listing, items: [...listing.items, { ...listing.items[1], id: "unselected", name: "unselected.txt" }] }} />);
  expect(screen.getByRole("heading", { name: "当前任务" })).toBeInTheDocument();
  expect(screen.getByText(/共 2 项/)).toBeInTheDocument();
  expect(screen.queryByText("unselected.txt")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "选择文件夹 folder" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "返回上级" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "继续下一批" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
  expect(screen.getByRole("separator")).toBeInTheDocument();
  expect(screen.getByRole("menuitemcheckbox", { name: "待处理" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "已完成" }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "选择文件夹 folder" })).toBeDisabled());
  expect(screen.queryByText("unselected.txt")).not.toBeInTheDocument();
});

it("disables task status filters before a task starts and restores file selection on task exit", () => {
  const props = taskProps();
  const { rerender } = render(<FileBrowser {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "结束当前任务" }));
  expect(props.onEndTask).toHaveBeenCalledOnce();
  rerender(<FileBrowser {...props} task={null} />);
  expect(screen.getByRole("heading", { name: "文件选择" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "选择文件夹 folder" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
  expect(screen.getByRole("menuitemcheckbox", { name: "待处理" })).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("menuitemcheckbox", { name: "已完成" })).toHaveAttribute("aria-disabled", "true");
});

it("retains missing task snapshots and locks unknown identities", async () => {
  const props = taskProps();
  const task = { ...props.task, items: props.task.items.map((item) => ({ ...item, status: "unknown" as const })) };
  render(<FileBrowser {...props} task={task} listing={{ ...listing, items: [] }} />);
  fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "失败/待核对" }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "选择文件夹 folder" })).toBeDisabled());
  expect(screen.getByRole("checkbox", { name: "选择文件 file.txt" })).toBeDisabled();
});

it("does not automatically show a batch hint when the selection exceeds 1000 items", () => {
  render(<FileBrowser {...taskProps()} task={null} selectedIds={Array.from({ length: 1001 }, (_, index) => String(index))} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("sorts through MUI headers without changing selection, and bulk actions use the displayed order", () => {
  const onSelectAll = vi.fn();
  const onToggle = vi.fn();
  const onInvertSelection = vi.fn();
  render(<FileBrowser listing={{ ...listing, items: [
    { ...listing.items[1], id: "10", name: "10.jpg", modified_at: "2026-10-16T00:00:20Z" },
    { ...listing.items[1], id: "2", name: "2.jpg", modified_at: "2026-10-16T00:00:30Z" },
    listing.items[0],
  ] }} providerName="本地文件" selectedIds={["2"]} onNavigate={vi.fn()}
    onToggle={onToggle} onSelectAll={onSelectAll} onInvertSelection={onInvertSelection} />);
  const rowNames = () => screen.getAllByRole("row").slice(1)
    .map((row) => within(row).getByRole("checkbox").getAttribute("aria-label"));
  expect(screen.getByRole("columnheader", { name: "文件名" })).toHaveAttribute("aria-sort", "ascending");
  expect(rowNames()).toEqual(["选择文件夹 folder", "选择文件 2.jpg", "选择文件 10.jpg"]);
  fireEvent.click(screen.getByRole("button", { name: "文件名" }));
  expect(screen.getByRole("columnheader", { name: "文件名" })).toHaveAttribute("aria-sort", "descending");
  expect(rowNames()).toEqual(["选择文件夹 folder", "选择文件 10.jpg", "选择文件 2.jpg"]);
  expect(screen.getByRole("checkbox", { name: "选择文件 2.jpg" })).toBeChecked();
  expect(onToggle).not.toHaveBeenCalled();
  expect(onSelectAll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示的全部项目" }));
  expect(onSelectAll).toHaveBeenCalledWith(["folder", "10", "2"]);
  fireEvent.click(screen.getByRole("button", { name: "反选" }));
  expect(onInvertSelection).toHaveBeenCalledWith(["folder", "10", "2"]);
  fireEvent.click(screen.getByRole("button", { name: "修改时间" }));
  expect(rowNames()).toEqual(["选择文件夹 folder", "选择文件 10.jpg", "选择文件 2.jpg"]);
  fireEvent.click(screen.getByRole("button", { name: "修改时间" }));
  expect(rowNames()).toEqual(["选择文件夹 folder", "选择文件 2.jpg", "选择文件 10.jpg"]);
});

it("locks sorting and preserves task order when refreshed names would sort differently", () => {
  const task = sessionTask();
  task.items = task.items.map((item) => ({ ...item, status: "pending" as const }));
  const reported: RenameTask = {
    ...task, batches: [{ batchId: "batch", taskItemIds: [], outcome: "reported" }],
  };
  render(<FileBrowser {...taskProps()} task={reported} listing={{ ...listing, items: [
    { ...listing.items[0], is_directory: false, name: "z.jpg" },
    { ...listing.items[1], name: "a.jpg" },
  ] }} />);
  const names = () => screen.getAllByRole("row").slice(1)
    .map((row) => within(row).getByRole("checkbox").getAttribute("aria-label"));
  expect(names()).toEqual(["选择文件 z.jpg", "选择文件 a.jpg"]);
  expect(screen.getByRole("button", { name: "文件名" })).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("button", { name: "修改时间" })).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(screen.getByRole("button", { name: "文件名" }));
  expect(names()).toEqual(["选择文件 z.jpg", "选择文件 a.jpg"]);
  expect(screen.getByText(/排序已锁定/)).toBeInTheDocument();
});


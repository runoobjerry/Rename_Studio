import { deferred } from "./test/deferred";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import { useRenameStore } from "./stores/useRenameStore";
import { installWorkspaceAppTestHooks, renderWorkspace } from "./test/workspaceAppHarness";
import { listing } from "./test/fixtures";

vi.mock("./api/client", async (importOriginal) => {
  const { workspaceApiMock } = await import("./test/workspaceApiMock");
  return workspaceApiMock(await importOriginal<typeof import("./api/client")>());
});
installWorkspaceAppTestHooks();

it("connects MUI sorting to preview request and displayed order", async () => {
  const items = ["001.jpg", "002.jpg"].map((name) => ({ id: name, name, path: name,
    parent_path: "", is_directory: false, size: 1, modified_at: null }));
  vi.mocked(api.fetchStorageFiles).mockResolvedValue({ provider: "local", path: "", parent_path: null, items });
  vi.mocked(api.createStoragePreview).mockImplementation(async (_storage, _location, ids) => ({
    preview_id: "sorted-preview", expires_at: "2099-01-01T00:00:00Z", valid: true,
    items: ids.map((id) => ({ file_id: id, original_name: id, new_name: `new-${id}`,
      changed: true, valid: true, conflict: false, error: null })),
  }));
  renderWorkspace();
  fireEvent.click(await screen.findByRole("checkbox", { name: "选择文件 001.jpg" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 002.jpg" }));
  fireEvent.click(screen.getByRole("button", { name: "文件名" }));
  fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
  await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledWith("default-local", { kind: "root" },
    ["002.jpg", "001.jpg"], []));
  const previewTable = await screen.findByRole("table", { name: "修改预览" });
  expect(within(previewTable).getAllByRole("row").slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["002.jpg", "001.jpg"]);

});

describe("workspace workflow wiring", () => {
  const setup = async (count: number) => {
    const data = listing(count);
    const items = data.items;
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(data);
    vi.mocked(api.fetchRenameProgress).mockResolvedValue({ preview_id: "task-preview", total: count, processed: 0, phase: "renaming", error: null });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前显示的全部项目" }));
    return items;
  };

  it("connects selection and rule changes to preview invalidation", async () => {
    vi.mocked(api.fetchRules).mockResolvedValue([
      { type: "insert",   config_schema: {} },
    ]);
    await setup(2);
    const previewButton = screen.getByRole("button", { name: "刷新预览" });
    const executeButton = screen.getByRole("button", { name: "开始修改" });
    fireEvent.click(previewButton);
    await waitFor(() => expect(executeButton).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 file-0.txt" }));
    expect(useRenameStore.getState().selectedIds).toEqual(["file-1.txt"]);
    expect(executeButton).toBeDisabled();
    expect(screen.queryByText("renamed-file-0.txt")).not.toBeInTheDocument();
    fireEvent.click(previewButton);
    await waitFor(() => expect(executeButton).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "插入" }));
    expect(useRenameStore.getState().rules).toEqual([expect.objectContaining({ type: "insert", enabled: true })]);
    expect(executeButton).toBeDisabled();
    expect(screen.queryByText("renamed-file-1.txt")).not.toBeInTheDocument();
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("keeps selection controls locked while execution is pending", async () => {
    const items = await setup(2);
    const resolveExecution = deferred<Awaited<ReturnType<typeof api.executePreview>>>();
    vi.mocked(api.executePreview).mockImplementationOnce(() => resolveExecution.promise);
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(api.executePreview).toHaveBeenCalledTimes(1));
    // Dialog 打开时背景 aria-hidden，用真实 input 验证控件禁用状态。
    const fileSelection = screen.getByLabelText("选择文件 file-0.txt");
    const allSelection = screen.getByLabelText("选择当前显示的全部项目");
    const invertSelection = screen.getByLabelText("反选", { selector: "button" });
    expect(fileSelection).toBeDisabled();
    expect(allSelection).toBeDisabled();
    expect(invertSelection).toBeDisabled();
    fireEvent.click(fileSelection);
    fireEvent.click(allSelection);
    fireEvent.click(invertSelection);
    expect(useRenameStore.getState().selectedIds).toEqual(items.map((item) => item.id));
    await act(async () => resolveExecution.resolve({ preview_id: "task-preview", status: "completed", items: items.map((file) => ({
      file_id: file.id, original_name: file.name, new_name: `renamed-${file.name}`, status: "renamed", error: null,
    })) }));
  });

  it("keeps unknown writes locked until the user verifies the actual files", async () => {
    await setup(2);
    vi.mocked(api.executePreview).mockRejectedValueOnce(new Error("Execution response lost"));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await screen.findByRole("heading", { name: "执行失败" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useRenameStore.getState().unknownExecution?.items).toHaveLength(2);
    expect(screen.getByRole("button", { name: "刷新预览" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "核对执行结果" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "核对执行结果" })).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useRenameStore.getState().unknownExecution).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "核对执行结果" }));
    fireEvent.click(screen.getByRole("button", { name: "已核对，解除锁定" }));
    await waitFor(() => expect(useRenameStore.getState().unknownExecution).toBeNull());
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 file-0.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(2));
    expect(api.executePreview).toHaveBeenCalledTimes(1);
  });

  it("releases a late preview to its original storage after switching connections", async () => {
    await setup(2);
    const resolvePreview = deferred<Awaited<ReturnType<typeof api.createStoragePreview>>>();
    vi.mocked(api.createStoragePreview).mockImplementationOnce(() => resolvePreview.promise);
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" }));
    await act(async () => resolvePreview.resolve({ preview_id: "late-storage-preview", expires_at: "2099-01-01T00:00:00Z", valid: true, items: [] }));
    await waitFor(() => expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "late-storage-preview"));
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(api.executePreview).not.toHaveBeenCalled();
  });

});

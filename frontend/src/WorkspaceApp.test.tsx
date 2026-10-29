import { deferred } from "./test/deferred";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import { useRenameStore } from "./stores/useRenameStore";
import { installWorkspaceAppTestHooks, renderWorkspace } from "./test/workspaceAppHarness";
import { fileItem, listing } from "./test/fixtures";

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

  it("renames directly from the row dialog with progress throughout direct execution", async () => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(1));

    const execution = deferred<Awaited<ReturnType<typeof api.executeStorageSingleRename>>>();

    vi.mocked(api.executeStorageSingleRename).mockReturnValueOnce(execution.promise);
    renderWorkspace();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择文件 file-0.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "重命名 file-0.txt" }));
    const dialog = screen.getByRole("dialog", { name: "重命名" });
    const input = within(dialog).getByRole("textbox", { name: "新名称" });
    expect(input).toHaveValue("file-0");
    fireEvent.change(input, { target: { value: "资料" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "应用" }));

    await waitFor(() => expect(api.executeStorageSingleRename).toHaveBeenCalledWith("default-local", {
      operation_id: expect.any(String), location: { kind: "root" }, file_id: "file-0.txt",
      original_name: "file-0.txt", target_name: "资料.txt", revision: 1,
    }));
    expect(within(dialog).getByRole("progressbar", { name: "正在重命名" })).toBeInTheDocument();
    expect(input).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByLabelText("选择文件 file-0.txt")).toBeDisabled();
    expect(api.executePreview).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "应用" })).toBeDisabled();
    const current = fileItem("provider-new-id", { name: "资料.txt", path: "资料.txt" });
    vi.mocked(api.fetchStorageFiles).mockResolvedValue({ ...listing(1), items: [current] });
    await act(async () => execution.resolve({ operation_id: "single-ui", status: "completed", items: [{
      file_id: "file-0.txt", original_name: "file-0.txt", new_name: "资料.txt",
      status: "renamed", error: null, current_file: current,
    }] }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "选择文件 资料.txt" })).toBeChecked();
    expect(useRenameStore.getState().selectedIds).toEqual(["provider-new-id"]);
    expect(useRenameStore.getState().task).toBeNull();
    expect(api.createStoragePreview).not.toHaveBeenCalled();
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
  });

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

  it("preserves unknown results across directory refresh failures and unlocks previews after a successful refresh", async () => {
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
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    const panel = within(screen.getByRole("region", { name: "修改预览" }));
    expect(panel.getByText("当前存在无法获取最新状态的文件，请刷新文件目录或前往文件源进行检查").closest('[role="alert"]')).toBeInTheDocument();
    expect(panel.getAllByText("待核对")).toHaveLength(2);
    expect(panel.getAllByText("N/A")).toHaveLength(2);
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Directory unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText(/目录刷新失败，当前显示上次读取的内容/);
    expect(useRenameStore.getState().unknownExecution?.items).toHaveLength(2);
    expect(screen.getByRole("button", { name: "刷新预览" })).toBeDisabled();
    expect(panel.getAllByText("待核对")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(useRenameStore.getState().unknownExecution?.previewUnlocked).toBe(true));
    expect(panel.getAllByText("待核对")).toHaveLength(2);
    expect(panel.getAllByText("N/A")).toHaveLength(2);
    expect(panel.getByText("当前存在无法获取最新状态的文件，请刷新文件目录或前往文件源进行检查")).toBeInTheDocument();
    expect(api.releaseStoragePreview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(api.executePreview).toHaveBeenCalledTimes(1);
    expect(api.createStoragePreview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "刷新预览" })).toBeEnabled();
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

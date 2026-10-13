import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import { useRenameStore } from "../../stores/useRenameStore";
import { client, listing, preview, serverSettings, setupWorkspace } from "../../test/workspaceHarness";

// 在测试入口注册，确保 API 导入和共享 Hook 使用同一份 mock。
vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  fetchStorages: vi.fn(), fetchStorageAuthStatus: vi.fn(), fetchStorageFiles: vi.fn(),
  pickStorageFolder: vi.fn(), fetchAppSettings: vi.fn(), patchAppSettings: vi.fn(),
  createStoragePreview: vi.fn(), releaseStoragePreview: vi.fn(), executePreview: vi.fn(),
}));

describe("rename workflow", () => {
  it.each(["toggle", "select-all", "clear", "invert"] as const)("invalidates an old preview after %s selection", async (operation) => {
    const hook = await setupWorkspace();
    if (operation === "select-all") act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
    await preview(hook);
    act(() => {
      const workflow = hook.result.current.workflow;
      if (operation === "toggle") workflow.toggleFile("file-0.txt");
      else if (operation === "select-all") workflow.selectAllFiles(["file-0.txt", "file-1.txt"]);
      else if (operation === "clear") workflow.clearFiles();
      else workflow.invertFiles(["file-0.txt", "file-1.txt"]);
    });
    expect(useRenameStore.getState().selectedIds).toEqual(operation === "toggle" ? ["file-1.txt"]
      : operation === "select-all" ? ["file-0.txt", "file-1.txt"] : []);
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("preserves partial results during reconciliation and clears them on ordinary selection", async () => {
    const hook = await setupWorkspace();
    await preview(hook);
    const response: Awaited<ReturnType<typeof api.executePreview>> = {
      preview_id: "task-preview", status: "partial", items: listing().items.map((file, index) => ({
        file_id: file.id, original_name: file.name, new_name: `renamed-${file.name}`,
        status: index === 0 ? "failed" : "renamed", error: index === 0 ? "Write failed" : null,
      })),
    };
    vi.mocked(api.executePreview).mockResolvedValue(response);
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.executionData).toEqual(response));
    act(() => hook.result.current.workflow.reconcileSelection([]));
    expect(hook.result.current.workflow.executionData).toEqual(response);
    expect(hook.result.current.workflow.previewData).toBeDefined();
    act(() => hook.result.current.workflow.toggleFile("file-0.txt"));
    expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt"]);
    expect(hook.result.current.workflow.executionData).toBeUndefined();
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(api.executePreview).toHaveBeenCalledTimes(1);
  });

  it("opens the batch hint only on request and cancels without creating a task", async () => {
    const hook = await setupWorkspace(1001);
    expect(hook.result.current.workflow.batchHintOpen).toBe(false);
    act(() => hook.result.current.workflow.requestPreview());
    expect(hook.result.current.workflow.batchHintOpen).toBe(true);
    expect(useRenameStore.getState().task).toBeNull();
    expect(api.createStoragePreview).not.toHaveBeenCalled();
    act(() => hook.result.current.workflow.closeBatchHint());
    expect(hook.result.current.workflow.batchHintOpen).toBe(false);
    expect(useRenameStore.getState().selectedIds).toHaveLength(1001);
    expect(api.createStoragePreview).not.toHaveBeenCalled();
  });

  it("saves the hint preference and submits only 1000 after continuing", async () => {
    const hook = await setupWorkspace(1001);
    act(() => hook.result.current.workflow.requestPreview());
    act(() => hook.result.current.workflow.changeBatchHintPreference(true));
    await waitFor(() => expect(serverSettings.preferences.hide_batch_limit_hint).toBe(true));
    expect(api.patchAppSettings).toHaveBeenCalledWith({ hide_batch_limit_hint: true });
    act(() => hook.result.current.workflow.continueBatchPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledWith(
      "default-local", { kind: "root" }, listing(1001).items.slice(0, 1000).map((file) => file.id), [],
    ));
    await waitFor(() => expect(hook.result.current.workflow.previewData).toBeDefined());
    expect(hook.result.current.workflow.batchHintOpen).toBe(false);
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(2));
    expect(hook.result.current.workflow.batchHintOpen).toBe(false);
  });

  it("retains a cleared preview ID and releases it on task end", async () => {
    const hook = await setupWorkspace();
    await preview(hook);
    act(() => hook.result.current.workflow.toggleFile("file-0.txt"));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(api.releaseStoragePreview).not.toHaveBeenCalled();
    act(() => hook.result.current.workflow.endTask());
    expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "task-preview");
    expect(useRenameStore.getState().task).toBeNull();
  });

  it("releases a late preview after its selection context changes", async () => {
    const hook = await setupWorkspace();
    let finish!: (value: Awaited<ReturnType<typeof api.createStoragePreview>>) => void;
    vi.mocked(api.createStoragePreview).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledOnce());
    act(() => useRenameStore.getState().setSelectedIds([]));
    await act(async () => finish({ preview_id: "late-preview", expires_at: "2099-01-01T00:00:00Z", valid: true, items: [] }));
    await waitFor(() => expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "late-preview"));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
  });

  it("invalidates a preview on rule changes and retains its ID for replacement", async () => {
    const hook = await setupWorkspace();
    await preview(hook);
    const rules = [{ type: "insert", enabled: true, config: { text: "x" } }];
    act(() => hook.result.current.workflow.onRulesChange(rules));
    expect(useRenameStore.getState().rules).toEqual(rules);
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(api.releaseStoragePreview).not.toHaveBeenCalled();
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["file-0.txt", "file-1.txt"], rules, "task-preview",
    ));
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it.each(["success", "lost-response"])("pauses directory queries after %s and allows manual refresh", async (outcome) => {
    const hook = await setupWorkspace();
    await preview(hook);
    if (outcome === "success") vi.mocked(api.executePreview).mockResolvedValue({
      preview_id: "task-preview", status: "completed", items: listing().items.map((file) => ({
        file_id: file.id, original_name: file.name, new_name: `renamed-${file.name}`, status: "renamed", error: null,
        current_file: { ...file, id: `renamed-${file.id}`, name: `renamed-${file.name}`, path: `renamed-${file.path}` },
      })),
    });
    else vi.mocked(api.executePreview).mockRejectedValue(new Error("Execution response lost"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["files"] }); });
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(useRenameStore.getState().task!.items.every((item) => item.status ===
      (outcome === "success" ? "completed" : "unknown"))).toBe(true));
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    if (outcome === "success") expect(hook.result.current.storage.files.data!.items.map((file) => file.id))
      .toEqual(listing().items.map((file) => `renamed-${file.id}`));
    else expect(hook.result.current.workflow.executeError).toBe("Execution response lost");
    act(() => hook.result.current.storage.refreshFiles());
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledTimes(2));
  });

  it("prunes removed selection IDs after refresh and replaces the old preview", async () => {
    const hook = await setupWorkspace(3);
    await preview(hook);
    vi.mocked(api.fetchStorageFiles).mockResolvedValue({ ...listing(4), items: listing(4).items.slice(1) });
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual(["file-1.txt", "file-2.txt"]));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["file-1.txt", "file-2.txt"], [], "task-preview",
    ));
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(0));
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual([]));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
  });

  it("preserves selection when a directory refresh fails", async () => {
    const hook = await setupWorkspace();
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Refresh unavailable"));
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(hook.result.current.storage.files.error?.message).toBe("Refresh unavailable"));
    expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt", "file-1.txt"]);
  });
});

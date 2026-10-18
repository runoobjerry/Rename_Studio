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
  it("removes explicitly non-renamable rows from stale selections and preview requests", async () => {
    const hook = await setupWorkspace();
    act(() => client.setQueryData(["files", "default-local", 1, { kind: "root" }], {
      ...listing(), items: listing().items.map((item, index) => ({ ...item, can_rename: index === 0 ? false : null })),
    }));
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual(["file-1.txt"]));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalled());
    expect(vi.mocked(api.createStoragePreview).mock.calls[0][2]).toEqual(["file-1.txt"]);
  });

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

  it("invalidates preview on sorting, keeps task snapshots, and never revives a previous ordering", async () => {
    const hook = await setupWorkspace(3);
    act(() => hook.result.current.workflow.selectAllFiles(["file-1.txt", "file-0.txt", "file-2.txt"]));
    await preview(hook);
    const task = useRenameStore.getState().task!;
    const before = task.items[0].before;
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "desc" }));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(useRenameStore.getState().selectedIds).toEqual(["file-1.txt", "file-0.txt", "file-2.txt"]);
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "asc" }));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "desc" }));
    await preview(hook);
    expect(api.createStoragePreview).toHaveBeenLastCalledWith("default-local", { kind: "root" },
      ["file-2.txt", "file-1.txt", "file-0.txt"], [], "task-preview");
    expect(hook.result.current.workflow.previewData!.items.map((item) => item.file_id))
      .toEqual(["file-2.txt", "file-1.txt", "file-0.txt"]);
    expect(useRenameStore.getState().task!.taskId).toBe(task.taskId);
    expect(useRenameStore.getState().task!.items[2].before).toBe(before);
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("uses timestamp order and releases a late preview when refreshed metadata changes that order", async () => {
    const hook = await setupWorkspace(3);
    const key = ["files", "default-local", 1, { kind: "root" }];
    const data = { ...listing(3), items: listing(3).items.map((file, index) => ({
      ...file, modified_at: index === 2 ? null : `2026-10-16T00:00:${index === 0 ? "30" : "20"}Z`,
    })) };
    act(() => client.setQueryData(key, data));
    act(() => hook.result.current.workflow.changeSort({ field: "modified_at", direction: "asc" }));
    let finish!: (value: Awaited<ReturnType<typeof api.createStoragePreview>>) => void;
    vi.mocked(api.createStoragePreview).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledWith("default-local", { kind: "root" },
      ["file-1.txt", "file-0.txt", "file-2.txt"], []));
    act(() => client.setQueryData(key, { ...data, items: data.items.map((file) =>
      file.id === "file-0.txt" ? { ...file, modified_at: "2026-10-16T00:00:10Z" } : file) }));
    // Query 缓存通知异步送达 React；先确认新顺序生效，再模拟旧预览迟到。
    await waitFor(() => expect(hook.result.current.workflow.browserItems.map((file) => file.id))
      .toEqual(["file-0.txt", "file-1.txt", "file-2.txt"]));
    await act(async () => finish({ preview_id: "late-sorted", expires_at: "2099-01-01T00:00:00Z", valid: true, items: [] }));
    await waitFor(() => expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "late-sorted"));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    await preview(hook);
    expect(api.createStoragePreview).toHaveBeenLastCalledWith("default-local", { kind: "root" },
      ["file-0.txt", "file-1.txt", "file-2.txt"], []);
  });

  it("keeps fixed task membership validation when sorting the selected IDs", async () => {
    const hook = await setupWorkspace(3);
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt", "file-1.txt"]));
    await preview(hook);
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "desc" }));
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt", "file-1.txt", "file-2.txt"]));
    act(() => hook.result.current.workflow.requestPreview());
    expect(api.createStoragePreview).toHaveBeenCalledTimes(1);
    expect(useRenameStore.getState().task!.items).toHaveLength(2);
  });

  it.each(["skipped", "failed", "lost-response"] as const)("locks sort after %s and unlocks only after task end", async (outcome) => {
    const hook = await setupWorkspace();
    await preview(hook);
    if (outcome === "lost-response") vi.mocked(api.executePreview).mockRejectedValueOnce(new Error("Lost response"));
    else vi.mocked(api.executePreview).mockResolvedValueOnce({ preview_id: "task-preview",
      status: outcome === "failed" ? "failed" : "completed", items: listing().items.map((file) => ({
        file_id: file.id, original_name: file.name, new_name: file.name, status: outcome, error: null,
      })) });
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.sortLocked).toBe(true));
    await waitFor(() => expect(hook.result.current.workflow.isExecuting).toBe(false));
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "desc" }));
    expect(hook.result.current.workflow.browserItems.map((item) => item.id)).toEqual(["file-0.txt", "file-1.txt"]);
    act(() => hook.result.current.workflow.endTask());
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "desc" }));
    expect(hook.result.current.workflow.sortLocked).toBe(false);
    expect(hook.result.current.workflow.browserItems.map((item) => item.id)).toEqual(["file-1.txt", "file-0.txt"]);
  });

  it("splits descending order before the batch limit and freezes order across confirmed local ID changes", async () => {
    const hook = await setupWorkspace(1001);
    let previewNumber = 0;
    vi.mocked(api.createStoragePreview).mockImplementation(async (_id, _location, ids) => ({
      preview_id: `sorted-${++previewNumber}`, expires_at: "2099-01-01T00:00:00Z", valid: true,
      items: ids.map((id) => ({ file_id: id, original_name: id, new_name: `new-${id}`,
        changed: true, valid: true, conflict: false, error: null })),
    }));
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "desc" }));
    act(() => hook.result.current.workflow.requestPreview());
    expect(hook.result.current.workflow.batchHintOpen).toBe(true);
    act(() => hook.result.current.workflow.continueBatchPreview());
    await waitFor(() => expect(hook.result.current.workflow.previewData?.preview_id).toBe("sorted-1"));
    const firstIds = listing(1001).items.slice(1).reverse().map((file) => file.id);
    expect(api.createStoragePreview).toHaveBeenCalledWith("default-local", { kind: "root" }, firstIds, []);
    const byId = new Map(listing(1001).items.map((file) => [file.id, file]));
    vi.mocked(api.executePreview).mockResolvedValueOnce({ preview_id: "sorted-1", status: "completed",
      items: firstIds.map((id) => ({ file_id: id, original_name: id, new_name: `new-${id}`, status: "renamed", error: null,
        current_file: { ...byId.get(id)!, id: `new-${id}`, name: `new-${id}`, modified_at: "2026-10-16T01:00:00Z" },
      })) });
    act(() => hook.result.current.workflow.executeRename("sorted-1"));
    await waitFor(() => expect(hook.result.current.workflow.executionData?.status).toBe("completed"));
    expect(hook.result.current.workflow.browserItems.map((file) => file.id))
      .toEqual([...firstIds.map((id) => `new-${id}`), "file-0.txt"]);
    act(() => hook.result.current.workflow.changeSort({ field: "modified_at", direction: "asc" }));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(hook.result.current.workflow.previewData?.preview_id).toBe("sorted-2"));
    expect(api.createStoragePreview).toHaveBeenLastCalledWith("default-local", { kind: "root" },
      ["file-0.txt"], [], "sorted-1");
    expect(useRenameStore.getState().task!.items.filter((item) => item.status === "completed")).toHaveLength(1000);
  });
});

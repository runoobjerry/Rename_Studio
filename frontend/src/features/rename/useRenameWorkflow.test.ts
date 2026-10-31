import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import { useRenameStore } from "../../stores/useRenameStore";
import type { ExecuteResponse } from "../../types";
import { installWorkspaceTestHooks, client, listing, notify, preview, setupWorkspace } from "../../test/workspaceHarness";

// Mock 注册保留在入口；真实 Hook、Store 和 Query 共同参与场景。
vi.mock("../../api/client", async (importOriginal) => {
  const { workspaceApiMock } = await import("../../test/workspaceApiMock");
  return workspaceApiMock(await importOriginal<typeof import("../../api/client")>());
});
vi.mock("../../components/NotificationProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../components/NotificationProvider")>(),
  useNotification: () => notify,
}));
installWorkspaceTestHooks();

describe("rename workflow", () => {

  it("reconciles selection for a ready provider that does not use browser auth", async () => {
    const definitions = await api.fetchStorageProviders();
    const storages = await api.fetchStorages();
    vi.mocked(api.fetchStorageProviders).mockResolvedValue([{ ...definitions[0], provider_type: "fixture_direct" }]);
    vi.mocked(api.fetchStorages).mockResolvedValue([{ ...storages[0], provider_type: "fixture_direct" }]);
    const hook = await setupWorkspace();
    expect(hook.result.current.storage.locationReady).toBe(true);
    expect(hook.result.current.storage.cloudReady).toBe(false);
    act(() => client.setQueryData(["files", "default-local", 1, { kind: "root" }], {
      ...listing(), items: [listing().items[1]],
    }));
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual(["file-1.txt"]));
    expect(api.fetchStorageAuthStatus).not.toHaveBeenCalled();
  });

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

  it.each(["toggle", "select-all", "clear", "invert"] as const)("retains an invalidated preview after %s selection", async (operation) => {
    const hook = await setupWorkspace();
    await preview(hook);
    if (operation === "select-all") {
      act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
      await preview(hook);
    }
    const previousPreview = hook.result.current.workflow.previewData!;
    act(() => {
      const workflow = hook.result.current.workflow;
      if (operation === "toggle") workflow.toggleFile("file-0.txt");
      else if (operation === "select-all") workflow.selectAllFiles(["file-0.txt", "file-1.txt"]);
      else if (operation === "clear") workflow.clearFiles();
      else workflow.invertFiles(["file-0.txt", "file-1.txt"]);
    });
    expect(useRenameStore.getState().selectedIds).toEqual(operation === "toggle" ? ["file-1.txt"]
      : operation === "select-all" ? ["file-0.txt", "file-1.txt"] : []);
    expect(hook.result.current.workflow.previewData).toEqual({ ...previousPreview, valid: false });
    act(() => hook.result.current.workflow.executeRename(previousPreview.preview_id));
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("retains a completed preview and its execution results when the selection changes", async () => {
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
    const previousPreview = hook.result.current.workflow.previewData!;
    act(() => hook.result.current.workflow.clearFiles());
    expect(hook.result.current.workflow.executionData).toEqual(response);
    expect(hook.result.current.workflow.previewData).toEqual({ ...previousPreview, valid: false });
    act(() => hook.result.current.workflow.toggleFile("file-0.txt"));
    expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt"]);
    expect(hook.result.current.workflow.executionData).toEqual(response);
    expect(hook.result.current.workflow.previewData).toEqual({ ...previousPreview, valid: false });
    act(() => hook.result.current.workflow.executeRename(previousPreview.preview_id));
    expect(api.executePreview).toHaveBeenCalledTimes(1);
  });

  it("invalidates a preview on rule changes and retains its ID for replacement", async () => {
    const hook = await setupWorkspace();
    await preview(hook);
    const previousPreview = hook.result.current.workflow.previewData!;
    const rules = [{ type: "insert", enabled: true, config: { text: "x" } }];
    act(() => hook.result.current.workflow.onRulesChange(rules));
    expect(useRenameStore.getState().rules).toEqual(rules);
    expect(hook.result.current.workflow.previewData).toEqual({ ...previousPreview, valid: false });
    act(() => hook.result.current.workflow.executeRename(previousPreview.preview_id));
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
    await waitFor(() => expect(hook.result.current.workflow.isExecuting).toBe(false));
    if (outcome === "lost-response") {
      const unknown = useRenameStore.getState().unknownExecution;
      expect(unknown).not.toBeNull();
      // Clearing the task record cannot clear the independent write guard.
      act(() => useRenameStore.getState().resetTask());
      expect(useRenameStore.getState().unknownExecution).toBe(unknown);
    }
    else {
      expect(hook.result.current.workflow.executionData?.status).toBe("completed");
      const ids = listing().items.map((file) => `renamed-${file.id}`);
      act(() => hook.result.current.workflow.selectAllFiles(ids));
      expect(useRenameStore.getState().selectedIds).toEqual(ids);
      act(() => hook.result.current.workflow.requestPreview());
      await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
        "default-local", { kind: "root" }, ids, [], "task-preview",
      ));
    }
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    if (outcome === "success") expect(hook.result.current.storage.files.data!.items.map((file) => file.id))
      .toEqual(listing().items.map((file) => `renamed-${file.id}`));
    else expect(hook.result.current.workflow.executeError).toBe("Execution response lost");
    act(() => hook.result.current.storage.refreshFiles());
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledTimes(2));
  });

  it("allows a new preview after revalidation failure but guards an unconfirmed write outcome", async () => {
    const hook = await setupWorkspace();
    await preview(hook);
    vi.mocked(api.executePreview).mockRejectedValueOnce(new api.ApiError(409,
      "Files changed after the preview was created", "PREVIEW_EXPIRED", { execution_started: false }));
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.revalidationError)
      .toBe("预览已失效，请刷新预览。"));
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.workflow.previewData).toBeDefined());
    expect(hook.result.current.workflow.revalidationError).toBeUndefined();
    const error = new api.ApiError(502, "Upstream response lost", "PROVIDER_ERROR");
    vi.mocked(api.executePreview).mockRejectedValueOnce(error);

    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.executeError).toBeDefined());
    expect(useRenameStore.getState().unknownExecution?.previewId).toBe("task-preview");
    expect(notify).toHaveBeenLastCalledWith({ key: "files:notifications.unknownOutcome", error }, "error");
    act(() => hook.result.current.workflow.requestPreview());
    expect(api.createStoragePreview).toHaveBeenCalledTimes(2);
    expect(api.executePreview).toHaveBeenCalledTimes(2);
  });

  it("prunes removed selection IDs after refresh and replaces the old preview", async () => {
    const hook = await setupWorkspace(3);
    await preview(hook);
    const previousPreview = hook.result.current.workflow.previewData!;
    vi.mocked(api.fetchStorageFiles).mockResolvedValue({ ...listing(4), items: listing(4).items.slice(1) });
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual(["file-1.txt", "file-2.txt"]));
    expect(hook.result.current.workflow.previewData).toEqual({ ...previousPreview, valid: false });
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["file-1.txt", "file-2.txt"], [], "task-preview",
    ));
    await waitFor(() => expect(hook.result.current.workflow.previewData?.valid).toBe(true));
    const refreshedPreview = hook.result.current.workflow.previewData!;
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(0));
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual([]));
    expect(hook.result.current.workflow.previewData).toEqual({ ...refreshedPreview, valid: false });
  });

  it("preserves selection when a directory refresh fails", async () => {
    const hook = await setupWorkspace();
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Refresh unavailable"));
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(hook.result.current.storage.files.error?.message).toBe("Refresh unavailable"));
    expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt", "file-1.txt"]);
  });

  it.each(["unknown-result", "missing-result"] as const)("merges confirmed identities and blocks new writes after %s", async (outcome) => {
    const hook = await setupWorkspace(3);
    await preview(hook);
    const files = listing(3).items;
    const confirmed = { ...files[0], id: "opaque-new-id", name: "renamed-file-0.txt" };
    const response: ExecuteResponse = {
      preview_id: "task-preview", status: "partial", items: [
        { file_id: files[0].id, original_name: files[0].name, new_name: confirmed.name,
          status: "renamed", error: null, current_file: confirmed },
        ...(outcome === "unknown-result" ? [{
          file_id: files[1].id, original_name: files[1].name, new_name: "renamed-file-1.txt",
          status: "failed" as const, error: "Write outcome unknown", error_code: "RENAME_OUTCOME_UNKNOWN", actual_name: null,
        }] : []),
        { file_id: files[2].id, original_name: files[2].name, new_name: "renamed-file-2.txt",
          status: "failed", error: "Conflict", actual_name: files[2].name },
      ],
    };
    vi.mocked(api.executePreview).mockResolvedValueOnce(response);

    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.executionData).toEqual(response));

    expect(hook.result.current.storage.files.data!.items).toEqual([confirmed, files[1], files[2]]);
    expect(useRenameStore.getState().unknownExecution?.items.map((item) => item.file_id)).toEqual([files[1].id]);
    const calls = vi.mocked(api.createStoragePreview).mock.calls.length;
    act(() => hook.result.current.workflow.selectAllFiles([confirmed.id, files[1].id, files[2].id]));
    act(() => hook.result.current.workflow.requestPreview());
    expect(api.createStoragePreview).toHaveBeenCalledTimes(calls);
    expect(api.executePreview).toHaveBeenCalledTimes(1);
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
  });

  it("reorders preview items while preserving the selection", async () => {
    const hook = await setupWorkspace(1001);
    const selected = listing(1001).items.map((file) => file.id);
    act(() => hook.result.current.workflow.selectAllFiles([...selected].reverse()));
    await preview(hook);
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "desc" }));
    expect(useRenameStore.getState().selectedIds).toEqual([...selected].reverse());
    await preview(hook);
    expect(api.createStoragePreview).toHaveBeenLastCalledWith("default-local", { kind: "root" },
      [...selected].reverse(), [], "task-preview");
    expect(hook.result.current.workflow.previewData!.items.map((item) => item.file_id))
      .toEqual([...selected].reverse());
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("keeps the original task snapshots while executing confirmed local files more than once", async () => {
    const hook = await setupWorkspace(1);
    await preview(hook);
    const original = useRenameStore.getState().task!;
    let current = listing(1).items[0];
    for (const [index, newId] of ["first.txt", "second.txt"].entries()) {
      const previewId = hook.result.current.workflow.previewData!.preview_id;
      const next = { ...current, id: newId, name: newId, path: newId };
      vi.mocked(api.executePreview).mockResolvedValueOnce({ preview_id: previewId, status: "completed", items: [{
        file_id: current.id, original_name: current.name, new_name: newId,
        status: "renamed", error: null, current_file: next,
      }] });
      act(() => hook.result.current.workflow.executeRename(previewId));
      await waitFor(() => expect(hook.result.current.workflow.executionData?.preview_id).toBe(previewId));
      expect(useRenameStore.getState().task!.taskId).toBe(original.taskId);
      expect(useRenameStore.getState().task!.items[0].before).toBe(original.items[0].before);
      expect(useRenameStore.getState().task!.items[0].before.name).toBe("file-0.txt");
      expect(useRenameStore.getState().task!.items[0].currentFileId).toBe(newId);
      await waitFor(() => expect(hook.result.current.workflow.browserItems[0].id).toBe(newId));
      if (index === 0) {
        act(() => hook.result.current.workflow.selectAllFiles([newId]));
        vi.mocked(api.createStoragePreview).mockResolvedValueOnce({ preview_id: "second-preview",
          expires_at: "2099-01-01T00:00:00Z", valid: true, items: [{ file_id: newId, original_name: newId,
            new_name: "second.txt", changed: true, valid: true, conflict: false, error: null }] });
        act(() => hook.result.current.workflow.requestPreview());
        await waitFor(() => expect(hook.result.current.workflow.previewData?.preview_id).toBe("second-preview"));
        expect(api.createStoragePreview).toHaveBeenLastCalledWith("default-local", { kind: "root" }, [newId], [], "task-preview");
      }
      current = next;
    }
    expect(api.executePreview).toHaveBeenCalledTimes(2);
  });

  it("creates a fixed task on preview, preserves snapshots across rule changes and releases it on task end", async () => {
    const hook = await setupWorkspace(3);
    expect(useRenameStore.getState().task).toBeNull();
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt", "file-1.txt"]));
    await preview(hook);
    const task = useRenameStore.getState().task!;
    expect(task.items.map((item) => item.before.id)).toEqual(["file-0.txt", "file-1.txt"]);
    expect(hook.result.current.workflow.browserItems.map((item) => item.id)).toEqual(["file-0.txt", "file-1.txt"]);
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt", "file-2.txt"]));
    expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt"]);
    const rules = [{ type: "insert", enabled: true, config: { text: "new-" } }];
    act(() => hook.result.current.workflow.onRulesChange(rules));
    await preview(hook);
    expect(useRenameStore.getState().task).toBe(task);
    expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["file-0.txt"], rules, "task-preview",
    );
    vi.mocked(api.fetchStorageFiles).mockResolvedValue({ ...listing(3), items: listing(3).items.slice(1) });
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual([]));
    expect(hook.result.current.workflow.browserItems.map((item) => item.id)).toEqual(["file-0.txt", "file-1.txt"]);
    expect(useRenameStore.getState().task).toBe(task);
    act(() => hook.result.current.workflow.endTask());
    expect(useRenameStore.getState().task).toBeNull();
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "task-preview");
    expect(hook.result.current.workflow.browserItems.map((item) => item.id)).toEqual(["file-1.txt", "file-2.txt"]);
  });

});

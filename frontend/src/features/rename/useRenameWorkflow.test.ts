import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import { useRenameStore } from "../../stores/useRenameStore";
import type { ExecuteResponse, SingleRenameExecuteResponse } from "../../types";
import { deferred } from "../../test/deferred";
import { fileItem, previewResponse } from "../../test/fixtures";
import { installWorkspaceTestHooks, client, listing, notify, openCloud, preview, setupWorkspace } from "../../test/workspaceHarness";

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

  it("previews using the opaque directory ID returned for a OneDrive path", async () => {
    const hook = await setupWorkspace();
    await openCloud(hook);
    const canonical = { kind: "id", value: "opaque-directory" } as const;
    vi.mocked(api.fetchStorageFiles).mockResolvedValueOnce({ ...listing(), location: canonical });
    act(() => hook.result.current.storage.setPath("display folder"));
    await waitFor(() => expect(hook.result.current.storage.files.data?.location).toEqual(canonical));
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
    await preview(hook);
    expect(api.createStoragePreview).toHaveBeenLastCalledWith("user-onedrive", canonical, ["file-0.txt"], []);
  });

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
    await preview(hook);
    vi.mocked(api.fetchStorageFiles).mockResolvedValueOnce({
      ...listing(), items: listing().items.map((item, index) => ({ ...item, can_rename: index === 0 ? false : null })),
    });
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual(["file-1.txt"]));
    expect(hook.result.current.workflow.previewData?.valid).toBe(false);
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["file-1.txt"], [], "task-preview",
    ));
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
      preview_id: "task-preview", status: "incomplete",
      counts: { renamed: 1, skipped: 0, failed: 1, unknown: 0, not_attempted: 0 },
      items: listing().items.map((file, index) => ({
        file_id: file.id, original_name: file.name, new_name: `renamed-${file.name}`,
        status: index === 0 ? "failed" : "renamed", error: index === 0 ? "Write failed" : null,
      })),
    };
    vi.mocked(api.executePreview).mockResolvedValue(response);
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.executionData).toEqual(response));
    expect(useRenameStore.getState().latestRenameRecord?.items[1]).toMatchObject({ status: "renamed", after: null });
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

  it.each(["success", "lost-response"])("keeps directory queries available after a preview and after %s", async (outcome) => {
    const hook = await setupWorkspace();
    await preview(hook);
    if (outcome === "success") vi.mocked(api.executePreview).mockResolvedValue({
      preview_id: "task-preview", status: "completed",
      counts: { renamed: 2, skipped: 0, failed: 0, unknown: 0, not_attempted: 0 },
      items: listing().items.map((file) => ({
        file_id: file.id, original_name: file.name, new_name: `renamed-${file.name}`, status: "renamed", error: null,
        current_file: { ...file, id: `renamed-${file.id}`, name: `renamed-${file.name}`, path: `renamed-${file.path}` },
      })),
    });
    else vi.mocked(api.executePreview).mockRejectedValue(new Error("Execution response lost"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["files"] }); });
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(api.executePreview).toHaveBeenCalledWith("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.isExecuting).toBe(false));
    if (outcome === "success") {
      expect(hook.result.current.workflow.executionData?.status).toBe("completed");
      const ids = listing().items.map((file) => `renamed-${file.id}`);
      const record = useRenameStore.getState().latestRenameRecord;
      expect(record).toMatchObject({
        operationId: "task-preview", kind: "batch", storageId: "default-local", revision: 1, location: { kind: "root" },
        items: listing().items.map((file, index) => ({
          before: { id: file.id, name: file.name }, targetName: `renamed-${file.name}`,
          status: "renamed", after: { id: ids[index] },
        })),
      });
      act(() => hook.result.current.workflow.selectAllFiles(ids));
      expect(useRenameStore.getState().selectedIds).toEqual(ids);
      act(() => hook.result.current.workflow.requestPreview());
      await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
        "default-local", { kind: "root" }, ids, [], "task-preview",
      ));
      expect(useRenameStore.getState().latestRenameRecord).toBe(record);
    }
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(2);
    if (outcome === "success") {
      const updated = hook.result.current.storage.files.data!;
      expect(updated.items.map((file) => file.id)).toEqual(listing().items.map((file) => `renamed-${file.id}`));
      vi.mocked(api.fetchStorageFiles).mockResolvedValueOnce(updated);
    }
    await act(async () => { await client.invalidateQueries({ queryKey: ["files"] }); });
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(3);
  });

  it("allows a new preview after revalidation failure but guards an unconfirmed write outcome", async () => {
    const hook = await setupWorkspace();
    const source = listing().items[0];
    const renamed = fileItem("single-confirmed.txt");
    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({
      operation_id: "previous-single", status: "completed",
      counts: { renamed: 1, skipped: 0, failed: 0, unknown: 0, not_attempted: 0 },
      items: [{ file_id: source.id, original_name: source.name, new_name: renamed.name,
        status: "renamed", error: null, current_file: renamed }],
    });
    act(() => hook.result.current.workflow.selectAllFiles([source.id]));
    act(() => hook.result.current.workflow.openSingleRename(source.id));
    act(() => hook.result.current.workflow.applySingleRename("single-confirmed", ".txt"));
    await waitFor(() => expect(hook.result.current.workflow.singleRenameTarget).toBeNull());
    const previousRecord = useRenameStore.getState().latestRenameRecord;
    expect(previousRecord?.kind).toBe("single");
    act(() => hook.result.current.workflow.selectAllFiles([renamed.id, "file-1.txt"]));
    await preview(hook);
    vi.mocked(api.executePreview).mockRejectedValueOnce(new api.ApiError(409,
      "Files changed after the preview was created", "PREVIEW_EXPIRED", { execution_started: false }));
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.revalidationError)
      .toBe("当前预览过期或文件状态发生变化。"));
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    expect(useRenameStore.getState().pendingRenameRecord).toBeNull();
    expect(useRenameStore.getState().latestRenameRecord).toBe(previousRecord);
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    expect(api.executePreview).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.workflow.previewData).toBeDefined());
    expect(hook.result.current.workflow.revalidationError).toBeUndefined();
    const error = new api.ApiError(502, "Upstream response lost", "PROVIDER_ERROR");
    vi.mocked(api.executePreview).mockRejectedValueOnce(error);

    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.executeError).toBeDefined());
    expect(useRenameStore.getState().unknownExecution?.previewId).toBe("task-preview");
    expect(useRenameStore.getState().latestRenameRecord?.kind).toBe("batch");
    expect(notify).toHaveBeenLastCalledWith({
      key: "files:notifications.ended", values: { results: "2 项待核对" },
    }, "warning");
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
    const hook = await setupWorkspace(5);
    const files = listing(5).items;
    const snapshot = previewResponse(files.map((file) => file.id));
    snapshot.items[4] = { ...snapshot.items[4], changed: false, new_name: files[4].name };
    vi.mocked(api.createStoragePreview).mockResolvedValueOnce(snapshot);
    await preview(hook);
    const confirmed = { ...files[0], id: "opaque-new-id", name: "renamed-file-0.txt" };
    const response: ExecuteResponse = {
      preview_id: "task-preview", status: "incomplete",
      counts: { renamed: 1, skipped: 1, failed: 1, unknown: outcome === "unknown-result" ? 1 : 0, not_attempted: 1 },
      items: [
        { file_id: files[0].id, original_name: files[0].name, new_name: confirmed.name,
          status: "renamed", error: null, current_file: confirmed },
        ...(outcome === "unknown-result" ? [{
          file_id: files[1].id, original_name: files[1].name, new_name: "renamed-file-1.txt",
          status: "unknown" as const, error: "Write outcome unknown", error_code: "RENAME_OUTCOME_UNKNOWN", actual_name: null,
        }] : []),
        { file_id: files[2].id, original_name: files[2].name, new_name: "renamed-file-2.txt",
          status: "failed", error: "Conflict", actual_name: files[2].name },
        { file_id: files[3].id, original_name: files[3].name, new_name: "renamed-file-3.txt",
          status: "not_attempted", error: "Batch stopped" },
        { file_id: files[4].id, original_name: files[4].name, new_name: files[4].name,
          status: "skipped", error: null, actual_name: files[4].name },
      ],
    };
    vi.mocked(api.executePreview).mockResolvedValueOnce(response);

    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.executionData).toEqual(response));

    expect(hook.result.current.storage.files.data!.items).toEqual([confirmed, ...files.slice(1)]);
    expect(useRenameStore.getState().latestRenameRecord?.items).toMatchObject([
      { status: "renamed", after: confirmed },
      { status: "unknown", after: null, actualName: null },
      { status: "failed", after: null, actualName: files[2].name },
      { status: "not_attempted", after: null, actualName: null },
      { status: "skipped", after: null, actualName: files[4].name, targetName: files[4].name },
    ]);
    expect(notify).toHaveBeenLastCalledWith({
      key: "files:notifications.ended", values: { results: "1 项已修改，1 项无需修改，1 项失败，1 项待核对，1 项未执行" },
    }, "warning");
    expect(useRenameStore.getState().unknownExecution?.items.map((item) => item.file_id)).toEqual([files[1].id]);
    expect(useRenameStore.getState().selectedIds).toEqual([files[2].id, files[3].id]);
    const calls = vi.mocked(api.createStoragePreview).mock.calls.length;
    act(() => hook.result.current.workflow.selectAllFiles([confirmed.id, files[1].id, files[2].id]));
    act(() => hook.result.current.workflow.requestPreview());
    expect(api.createStoragePreview).toHaveBeenCalledTimes(calls);
    expect(api.executePreview).toHaveBeenCalledTimes(1);
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
  });

  it.each(["single", "batch"] as const)("records a late %s response against its original connection without updating the new workspace", async (kind) => {
    const hook = await setupWorkspace(1);
    const source = listing(1).items[0];
    const confirmed = fileItem("renamed-file-0.txt");
    const response = {
      status: "completed" as const,
      counts: { renamed: 1, skipped: 0, failed: 0, unknown: 0, not_attempted: 0 },
      items: [{ file_id: source.id, original_name: source.name, new_name: confirmed.name,
        status: "renamed" as const, error: null, current_file: confirmed }],
    };
    const single = deferred<SingleRenameExecuteResponse>();
    const batch = deferred<ExecuteResponse>();
    if (kind === "single") {
      vi.mocked(api.executeStorageSingleRename).mockReturnValueOnce(single.promise);
      act(() => hook.result.current.workflow.openSingleRename(source.id));
      act(() => hook.result.current.workflow.applySingleRename("renamed-file-0", ".txt"));
      await waitFor(() => expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1));
    } else {
      await preview(hook);
      vi.mocked(api.executePreview).mockReturnValueOnce(batch.promise);
      act(() => hook.result.current.workflow.executeRename("task-preview"));
      await waitFor(() => expect(api.executePreview).toHaveBeenCalledTimes(1));
    }
    const nextListing = { ...listing(1), items: [fileItem("other-connection.txt")] };
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(nextListing);
    act(() => hook.result.current.storage.selectStorage("user-onedrive"));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(hook.result.current.workflow.singleRenameTarget).toBeNull();
    await act(async () => {
      if (kind === "single") single.resolve({ ...response, operation_id: "late-single" });
      else batch.resolve({ ...response, preview_id: "task-preview" });
    });
    await openCloud(hook);

    expect(hook.result.current.workflow.browserItems).toEqual(nextListing.items);
    expect(hook.result.current.workflow.executionData).toBeUndefined();
    expect(hook.result.current.workflow.singleRenameError).toBeUndefined();
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ key: "files:notifications.completed" }), "success");
    expect(useRenameStore.getState().latestRenameRecord).toMatchObject({
      kind, storageId: "default-local", revision: 1, location: { kind: "root" },
      items: [{ before: { id: source.id }, status: "renamed", after: confirmed }],
    });
  });

  it("reorders preview items while preserving the selection", async () => {
    const hook = await setupWorkspace(1001);
    const selected = listing(1001).items.map((file) => file.id);
    act(() => hook.result.current.workflow.selectAllFiles([...selected].reverse()));
    await preview(hook);
    act(() => hook.result.current.workflow.changeSort({ field: "name", direction: "desc" }));
    expect(useRenameStore.getState().selectedIds).toEqual([...selected].reverse());
    expect(hook.result.current.workflow.previewData?.valid).toBe(false);
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await preview(hook);
    expect(api.createStoragePreview).toHaveBeenLastCalledWith("default-local", { kind: "root" },
      [...selected].reverse(), [], "task-preview");
    expect(hook.result.current.workflow.previewData!.items.map((item) => item.file_id))
      .toEqual([...selected].reverse());
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("records each batch using the file identity at submission", async () => {
    const hook = await setupWorkspace(1);
    await preview(hook);
    let current = listing(1).items[0];
    for (const [index, newId] of ["first.txt", "second.txt"].entries()) {
      const previewId = hook.result.current.workflow.previewData!.preview_id;
      const next = { ...current, id: newId, name: newId, path: newId };
      vi.mocked(api.executePreview).mockResolvedValueOnce({ preview_id: previewId, status: "completed",
        counts: { renamed: 1, skipped: 0, failed: 0, unknown: 0, not_attempted: 0 },
        items: [{
        file_id: current.id, original_name: current.name, new_name: newId,
        status: "renamed", error: null, current_file: next,
      }] });
      act(() => hook.result.current.workflow.executeRename(previewId));
      await waitFor(() => expect(hook.result.current.workflow.executionData?.preview_id).toBe(previewId));
      expect(useRenameStore.getState().latestRenameRecord?.items).toMatchObject([
        { before: { id: current.id, name: current.name }, after: next },
      ]);
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

  it("invalidates a preview when a refresh changes the name under the same file ID", async () => {
    const hook = await setupWorkspace(1);
    await preview(hook);
    vi.mocked(api.fetchStorageFiles).mockResolvedValueOnce({
      ...listing(1), items: [fileItem("file-0.txt", { name: "changed.txt" })],
    });
    await act(async () => { await hook.result.current.storage.files.refetch(); });
    await waitFor(() => expect(hook.result.current.workflow.previewData?.valid).toBe(false));
    expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt"]);
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("releases a delayed preview after the selection changes and returns to its previous value", async () => {
    const hook = await setupWorkspace(2);
    const delayed = deferred<Awaited<ReturnType<typeof api.createStoragePreview>>>();
    vi.mocked(api.createStoragePreview).mockReturnValueOnce(delayed.promise);
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(1));
    act(() => {
      hook.result.current.workflow.toggleFile("file-1.txt");
      hook.result.current.workflow.toggleFile("file-1.txt");
    });
    await act(async () => delayed.resolve(previewResponse(["file-0.txt", "file-1.txt"], "delayed")));
    await waitFor(() => expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "delayed"));
    expect(hook.result.current.workflow.previewData).toBeUndefined();
  });

});

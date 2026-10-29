import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import { useRenameStore } from "../../stores/useRenameStore";
import { deferred } from "../../test/deferred";
import { fileItem, previewResponse, storages } from "../../test/fixtures";
import { client, installWorkspaceTestHooks, listing, notify, preview, setupWorkspace } from "../../test/workspaceHarness";
import type { FileItem, SingleRenameExecuteResponse, StorageLocation } from "../../types";

vi.mock("../../api/client", async (importOriginal) => {
  const { workspaceApiMock } = await import("../../test/workspaceApiMock");
  return workspaceApiMock(await importOriginal<typeof import("../../api/client")>());
});
vi.mock("../../components/NotificationProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../components/NotificationProvider")>(), useNotification: () => notify,
}));
installWorkspaceTestHooks();

const directoryKey = ["files", "default-local", 1, { kind: "root" }];

function renamed(file: FileItem, current: FileItem, operationId = "single-operation") {
  return { operation_id: operationId, status: "completed" as const, items: [{
    file_id: file.id, original_name: file.name, new_name: current.name,
    status: "renamed" as const, error: null, current_file: current,
  }] };
}

describe("single rename workflow", () => {
  it.each(["google_drive", "onedrive", "custom-cloud"])(
    "uses the real root identity for %s without refreshing the directory", async (provider) => {
      const hook = await setupWorkspace(1);
      const source = fileItem("file-0.txt");
      const current = fileItem("confirmed-id", { name: "new.txt", path: "new.txt",
        parent_location: { kind: "id", value: "real-root-id" } });
      act(() => client.setQueryData(directoryKey, { ...listing(1), provider, directory_id: "real-root-id" }));
      await waitFor(() => expect(hook.result.current.storage.files.data?.directory_id).toBe("real-root-id"));
      vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce(renamed(source, current));
      const reads = vi.mocked(api.fetchStorageFiles).mock.calls.length;
      act(() => hook.result.current.workflow.openSingleRename(source.id));
      act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
      await waitFor(() => expect(hook.result.current.workflow.isSingleRenaming).toBe(false));
      expect(hook.result.current.storage.files.data!.items).toEqual([current]);
      expect(useRenameStore.getState().selectedIds).toEqual([current.id]);
      expect(api.fetchStorageFiles).toHaveBeenCalledTimes(reads);
      expect(notify).toHaveBeenLastCalledWith({ key: "files:notifications.completed", values: { count: 1 } }, "success");
    });

  it.each(["cloud", "local"])(
    "keeps moved %s task members visible but unselectable as soon as the API confirms the move", async (kind) => {
      const hook = await setupWorkspace(2);
      if (kind === "cloud") {
        act(() => client.setQueryData(directoryKey, { ...listing(2), directory_id: "real-root-id" }));
      }
      await preview(hook);
      const original = useRenameStore.getState().task!;
      act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
      const current = { ...fileItem("moved-id", { name: "new.txt",
        parent_location: kind === "cloud" ? { kind: "id", value: "other-folder" }
          : { kind: "path", value: "other-folder" } }), path: null, parent_path: null };
      vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({ operation_id: "moved", status: "completed",
        items: [{ ...renamed(listing(2).items[0], fileItem("new.txt")).items[0], current_file: current }] });
      act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
      act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
      await waitFor(() => expect(hook.result.current.workflow.isSingleRenaming).toBe(false));
      expect(hook.result.current.workflow.singleRenameTarget).toBeNull();
      const task = useRenameStore.getState().task!;
      expect(task.items[0].before).toBe(original.items[0].before);
      expect(task.items[0].after?.current_file).toEqual(current);
      expect(task.items[0].currentFileId).toBe("moved-id");
      expect(task.items[1]).toBe(original.items[1]);
      expect(hook.result.current.storage.files.data!.items.map((file) => file.id)).toEqual(["file-1.txt"]);
      expect(hook.result.current.workflow.browserItems.map((file) => file.id)).toEqual(["file-1.txt", "moved-id"]);
      expect(hook.result.current.workflow.browserItems.find((file) => file.id === "moved-id")).toMatchObject({
        name: "new.txt", can_rename: false, path: "new.txt", parent_path: "",
      });
      expect(useRenameStore.getState().selectedIds).toEqual([]);
      expect(client.getQueryState(directoryKey)?.isInvalidated).toBe(true);
      expect(notify).toHaveBeenLastCalledWith({ key: "files:notifications.renamedElsewhere" }, "success");
      act(() => hook.result.current.workflow.selectAllFiles(["moved-id", "file-1.txt"]));
      act(() => hook.result.current.workflow.requestPreview());
      await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
        "default-local", { kind: "root" }, ["file-1.txt"], [],
      ));
      // Even a stale list must not make a confirmed moved member selectable again.
      act(() => client.setQueryData(directoryKey, { ...listing(2),
        directory_id: kind === "cloud" ? "real-root-id" : null,
        items: [fileItem("moved-id"), listing(2).items[1]] }));
      await waitFor(() => expect(hook.result.current.workflow.browserItems.find((file) => file.id === "moved-id")?.can_rename).toBe(false));
      act(() => hook.result.current.workflow.selectAllFiles(["moved-id"]));
      await waitFor(() => expect(hook.result.current.workflow.selectedCount).toBe(0));
    });

  it.each([null, { kind: "id", value: "unresolved-root" }] as Array<StorageLocation | null>)(
    "refreshes an unlocated result during a task without treating it as a move (%j)", async (parent) => {
      const hook = await setupWorkspace(1);
      await preview(hook);
      const refresh = deferred<ReturnType<typeof listing>>();
      vi.mocked(api.fetchStorageFiles).mockReturnValueOnce(refresh.promise);
      const current = fileItem("file-0.txt", { name: "new.txt", parent_location: parent });
      vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce(renamed(listing(1).items[0], current));
      act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
      act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
      await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(hook.result.current.workflow.browserItems).toEqual([]));
      expect(useRenameStore.getState().selectedIds).toEqual([]);
      expect(useRenameStore.getState().unknownExecution).toBeNull();
      expect(notify).toHaveBeenLastCalledWith({ key: "files:notifications.completed", values: { count: 1 } }, "success");
      await act(async () => refresh.resolve({ ...listing(1), items: [current] }));
      await waitFor(() => expect(hook.result.current.workflow.browserItems).toEqual([current]));
      expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
    });

  it("keeps an unlocated task result out of the old directory when its refresh fails", async () => {
    const hook = await setupWorkspace(1);
    await preview(hook);
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Directory unavailable"));
    const current = fileItem("confirmed-id", { name: "new.txt", parent_location: null });
    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce(renamed(listing(1).items[0], current));
    act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
    await waitFor(() => expect(hook.result.current.storage.files.isError).toBe(true));
    expect(hook.result.current.workflow.browserItems).toEqual([]);
    expect(useRenameStore.getState().task!.items[0].after?.current_file).toEqual(current);
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ key: "files:notifications.refreshFailed",
      error: expect.objectContaining({ message: "Directory unavailable" }) }, "error");
  });

  it.each([
    { original: "archive.tar.gz", name: "archive.tar", extension: ".gz", input: "资料.tar", target: "资料.tar.gz", folder: false },
    { original: ".env", name: ".env", extension: "", input: ".env.local", target: ".env.local", folder: false },
    { original: "README", name: "README", extension: "", input: "说明", target: "说明", folder: false },
    { original: "folder.v1", name: "folder.v1", extension: "", input: "folder.v2", target: "folder.v2", folder: true },
  ])("edits $original and keeps the confirmed identity selected without creating a task", async (example) => {
    const hook = await setupWorkspace(1);
    const source = fileItem("file-0.txt", { name: example.original, is_directory: example.folder });
    const current = fileItem("provider-returned-id", { name: example.target, path: example.target, is_directory: example.folder });
    act(() => client.setQueryData(directoryKey, { ...listing(1), items: [source] }));
    await waitFor(() => expect(hook.result.current.workflow.browserItems[0].name).toBe(example.original));
    act(() => hook.result.current.workflow.openSingleRename(source.id));
    expect(hook.result.current.workflow.singleRenameTarget).toMatchObject({ name: example.name, extension: example.extension });

    const success = renamed(source, current);
    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({ ...success, items: [{
      ...success.items[0], current_file: { ...current, path: null, parent_path: null },
    }] });

    act(() => hook.result.current.workflow.applySingleRename(example.input, example.extension));

    await waitFor(() => {
      expect(hook.result.current.workflow.singleRenameTarget).toBeNull();
      expect(hook.result.current.workflow.isSingleRenaming).toBe(false);
    });
    expect(api.executeStorageSingleRename).toHaveBeenCalledWith("default-local", {
      operation_id: expect.any(String), location: { kind: "root" }, file_id: source.id,
      original_name: example.original, target_name: example.target, revision: 1,
    });
    expect(useRenameStore.getState().selectedIds).toEqual(["provider-returned-id"]);
    expect(useRenameStore.getState().task).toBeNull();
    expect(useRenameStore.getState().rules).toEqual([]);
    expect(hook.result.current.storage.files.data!.items).toEqual([current]);
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(hook.result.current.workflow.executionData).toBeUndefined();

    expect(api.createStoragePreview).not.toHaveBeenCalled();
  });

  it("keeps task snapshots and other results while replacing only the selected member's identity", async () => {
    const hook = await setupWorkspace(2);
    await preview(hook);
    const original = useRenameStore.getState().task!;
    const files = listing(2).items;
    const first = fileItem("first.txt");
    const other = fileItem("other.txt");
    vi.mocked(api.executePreview).mockResolvedValueOnce({
      preview_id: "task-preview", status: "completed", items: [
        renamed(files[0], first).items[0], renamed(files[1], other).items[0],
      ],
    });
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.executionData?.status).toBe("completed"));
    const untouchedMember = useRenameStore.getState().task!.items[1];
    const rules = [{ type: "insert", enabled: true, config: { text: "batch-" } }];
    act(() => {
      hook.result.current.workflow.selectAllFiles(["first.txt"]);
      hook.result.current.workflow.onRulesChange(rules);
    });
    vi.mocked(api.createStoragePreview).mockResolvedValueOnce(previewResponse(["first.txt"], "batch-before-single"));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(hook.result.current.workflow.previewData?.preview_id).toBe("batch-before-single"));
    const batchPreview = hook.result.current.workflow.previewData;
    act(() => hook.result.current.workflow.openSingleRename("first.txt"));
    act(() => hook.result.current.workflow.closeSingleRename());
    expect(hook.result.current.workflow.previewData).toBe(batchPreview);
    expect(api.releaseStoragePreview).not.toHaveBeenCalled();
    act(() => hook.result.current.workflow.openSingleRename("first.txt"));
    const current = fileItem("z-last.txt");

    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce(renamed(first, current));

    act(() => hook.result.current.workflow.applySingleRename("z-last", ".txt"));

    await waitFor(() => {
      expect(hook.result.current.workflow.singleRenameTarget).toBeNull();
      expect(hook.result.current.workflow.isSingleRenaming).toBe(false);
    });
    const task = useRenameStore.getState().task!;
    expect(task.taskId).toBe(original.taskId);
    expect(task.items).toHaveLength(2);
    expect(task.items.map((item) => item.taskItemId)).toEqual(original.items.map((item) => item.taskItemId));
    expect(task.items[0].before).toBe(original.items[0].before);
    expect(task.items[1].before).toBe(original.items[1].before);
    expect(task.items[0].currentFileId).toBe("z-last.txt");
    expect(task.items[0].after?.current_file).toEqual(current);
    expect(task.items[1]).toBe(untouchedMember);
    expect(useRenameStore.getState().selectedIds).toEqual(["z-last.txt"]);
    expect(useRenameStore.getState().rules).toEqual(rules);
    expect(hook.result.current.workflow.browserItems.map((item) => item.id)).toEqual(["other.txt", "z-last.txt"]);
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "batch-before-single");
    act(() => hook.result.current.workflow.executeRename("batch-before-single"));
    expect(api.executePreview).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["z-last.txt"], rules,
    ));
  });

  it("blocks duplicate submissions and conflicting actions throughout direct execution", async () => {
    const hook = await setupWorkspace(1);
    await preview(hook);
    const task = useRenameStore.getState().task;

    const execution = deferred<SingleRenameExecuteResponse>();

    vi.mocked(api.executeStorageSingleRename).mockReturnValueOnce(execution.promise);
    act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
    act(() => {
      hook.result.current.workflow.applySingleRename("new", ".txt");
      hook.result.current.workflow.applySingleRename("duplicate", ".txt");
      hook.result.current.workflow.requestPreview();
      hook.result.current.workflow.executeRename("task-preview");
      hook.result.current.workflow.closeSingleRename();
      hook.result.current.workflow.clearFiles();
      hook.result.current.workflow.endTask();
      hook.result.current.workflow.onRulesChange([{ type: "insert", enabled: true, config: { text: "changed" } }]);
      hook.result.current.workflow.changeSort({ field: "name", direction: "desc" });
    });
    await waitFor(() => expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1));
    expect(hook.result.current.workflow.isSingleRenaming).toBe(true);
    expect(hook.result.current.workflow.isExecuting).toBe(true);
    expect(useRenameStore.getState().task).toBe(task);
    expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt"]);
    expect(useRenameStore.getState().rules).toEqual([]);
    expect(hook.result.current.workflow.singleRenameTarget).not.toBeNull();
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(api.createStoragePreview).toHaveBeenCalledTimes(1);
    expect(hook.result.current.workflow.executionPreviewId).toBeUndefined();
    await act(async () => { await client.invalidateQueries({ queryKey: ["files"] }); });
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    await act(async () => execution.resolve(renamed(listing(1).items[0], fileItem("new.txt"))));
    await waitFor(() => expect(hook.result.current.workflow.isSingleRenaming).toBe(false));
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "unknown", "lost", "unconfirmed"])("blocks new writes after a %s result until the task is explicitly ended", async (kind) => {
    const hook = await setupWorkspace(1);
    const source = listing(1).items[0];

    if (kind === "lost") vi.mocked(api.executeStorageSingleRename).mockRejectedValueOnce(new Error("Response lost"));
    else vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({
      operation_id: "single-operation", status: kind === "unconfirmed" ? "completed" : "failed",
      items: kind === "missing" ? [] : [{
        file_id: source.id, original_name: source.name, new_name: "new.txt",
        status: kind === "unconfirmed" ? "renamed" : "failed", error: kind === "unconfirmed" ? null : "Unknown write",
        error_code: kind === "unconfirmed" ? null : "RENAME_OUTCOME_UNKNOWN", actual_name: null,
      }],
    });
    act(() => hook.result.current.workflow.openSingleRename(source.id));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));

    await waitFor(() => expect(hook.result.current.workflow.isSingleRenaming).toBe(false));
    expect(useRenameStore.getState().unknownExecution).toMatchObject({
      storageId: "default-local", previewId: kind === "lost"
        ? vi.mocked(api.executeStorageSingleRename).mock.calls[0][1].operation_id : "single-operation", items: [{ file_id: source.id }],
    });
    expect(hook.result.current.workflow.canSingleRename).toBe(false);
    expect(hook.result.current.workflow.singleRenameError).toBeDefined();
    act(() => {
      hook.result.current.workflow.applySingleRename("retry", ".txt");
      hook.result.current.workflow.requestPreview();
      hook.result.current.workflow.executeRename("single-preview");
      hook.result.current.workflow.closeSingleRename();
    });
    expect(useRenameStore.getState().unknownExecution).not.toBeNull();
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
    expect(api.createStoragePreview).not.toHaveBeenCalled();
    expect(api.executePreview).not.toHaveBeenCalled();
    act(() => hook.result.current.workflow.endTask());
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    expect(hook.result.current.workflow.singleRenameTarget).toBeNull();
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: "PERMISSION_DENIED", message: "Permission changed", text: "没有执行此操作的权限。Permission changed" },
    { code: "RENAME_CONFLICT", message: "Name occupied", text: "文件名存在冲突，修改后重试。Name occupied" },
    { code: "RATE_LIMIT_ERROR", message: "Throttled", text: "请求过于频繁，请稍后重试。Throttled" },
  ])("keeps a $code failure retryable and translates its code", async ({ code, message, text }) => {
    const hook = await setupWorkspace(1);
    const source = listing(1).items[0];

    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({ operation_id: "single-operation", status: "failed", items: [{
      file_id: source.id, original_name: source.name, new_name: "new.txt", status: "failed",
      error: message, error_code: code, actual_name: source.name,
    }] });
    act(() => hook.result.current.workflow.openSingleRename(source.id));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));

    await waitFor(() => {
      expect(hook.result.current.workflow.singleRenameError).toBe(text);
      expect(hook.result.current.workflow.isSingleRenaming).toBe(false);
    });
    expect(hook.result.current.workflow.canSingleRename).toBe(true);
    expect(hook.result.current.workflow.singleRenameTarget?.file).toEqual(source);
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    expect(useRenameStore.getState().selectedIds).toEqual([source.id]);
  });

  it("makes a missing task member unselectable on the API response while keeping its error dialog open", async () => {
    const hook = await setupWorkspace(2);
    await preview(hook);
    const original = useRenameStore.getState().task!;
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({ operation_id: "missing-file", status: "failed", items: [{
      file_id: "file-0.txt", original_name: "file-0.txt", new_name: "new.txt", status: "failed",
      error: "Missing file", error_code: "NOT_FOUND",
    }] });
    act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
    await waitFor(() => expect(hook.result.current.workflow.singleRenameError).toBe("请求的资源不存在。Missing file"));
    expect(hook.result.current.workflow.canSingleRename).toBe(false);
    expect(hook.result.current.workflow.singleRenameTarget).not.toBeNull();
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(hook.result.current.storage.files.data!.items.map((file) => file.id)).toEqual(["file-1.txt"]);
    expect(hook.result.current.workflow.browserItems.map((file) => file.id)).toEqual(["file-0.txt", "file-1.txt"]);
    expect(hook.result.current.workflow.browserItems[0].can_rename).toBe(false);
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    act(() => hook.result.current.workflow.applySingleRename("retry", ".txt"));
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
    const taskAfterResponse = useRenameStore.getState().task;
    const directoryAfterResponse = hook.result.current.storage.files.data;
    act(() => hook.result.current.workflow.closeSingleRename());
    await waitFor(() => expect(hook.result.current.workflow.singleRenameTarget).toBeNull());
    expect(hook.result.current.workflow.canSingleRename).toBe(false);
    expect(useRenameStore.getState().task).toBe(taskAfterResponse);
    expect(hook.result.current.storage.files.data).toBe(directoryAfterResponse);
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(hook.result.current.storage.files.data!.items.map((file) => file.id)).toEqual(["file-1.txt"]);
    expect(hook.result.current.workflow.browserItems.map((file) => file.id)).toEqual(["file-0.txt", "file-1.txt"]);
    expect(hook.result.current.workflow.browserItems[0].can_rename).toBe(false);
    expect(useRenameStore.getState().task!.items[0].before).toBe(original.items[0].before);
    expect(useRenameStore.getState().task!.items[0].after).toMatchObject({ status: "failed", error_code: "NOT_FOUND" });
    expect(useRenameStore.getState().task!.items[1]).toBe(original.items[1]);
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt", "file-1.txt"]));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["file-1.txt"], [],
    ));
  });

  it("shows an explicit HTTP rejection without locking either workflow", async () => {
    const hook = await setupWorkspace(1);
    vi.mocked(api.executeStorageSingleRename).mockRejectedValueOnce(new api.ApiError(403, "Denied", "PERMISSION_DENIED"));
    act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
    await waitFor(() => expect(hook.result.current.workflow.singleRenameError).toBe("没有执行此操作的权限。Denied"));
    expect(hook.result.current.workflow.canSingleRename).toBe(true);
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it.each(["refresh-failed", "storage-busy"])("blocks applying an open edit when %s", async (reason) => {
    const hook = await setupWorkspace(1);
    act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
    if (reason === "refresh-failed") {
      vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Refresh failed"));
      await act(async () => { await hook.result.current.storage.files.refetch(); });
    } else {
      vi.mocked(api.fetchStorages).mockResolvedValue(storages().map((storage) => ({ ...storage, busy: true })));
      await act(async () => { await client.invalidateQueries({ queryKey: ["storages"] }); });
    }

    await waitFor(() => expect(hook.result.current.workflow.canSingleRename).toBe(false));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));

    expect(api.executeStorageSingleRename).not.toHaveBeenCalled();
    expect(api.executePreview).not.toHaveBeenCalled();
    expect(useRenameStore.getState().unknownExecution).toBeNull();
  });
});

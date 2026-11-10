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
  return { operation_id: operationId, status: "completed" as const,
    counts: { renamed: 1, skipped: 0, failed: 0, unknown: 0, not_attempted: 0 },
    items: [{
    file_id: file.id, original_name: file.name, new_name: current.name,
    status: "renamed" as const, error: null, current_file: current,
  }] };
}

describe("single rename workflow", () => {
  it.each(["google_drive", "onedrive", "custom-cloud"])(
    "uses the real root identity for %s without refreshing the directory", async (providerType) => {
      const hook = await setupWorkspace(1);
      const source = fileItem("file-0.txt");
      const current = fileItem("confirmed-id", { name: "new.txt", path: "new.txt",
        parent_location: { kind: "id", value: "real-root-id" } });
      act(() => client.setQueryData(directoryKey, { ...listing(1), provider: providerType, directory_id: "real-root-id" }));
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
    "removes a moved %s item from the directory when the API confirms the move", async (kind) => {
      const hook = await setupWorkspace(2);
      if (kind === "cloud") {
        act(() => client.setQueryData(directoryKey, { ...listing(2), directory_id: "real-root-id" }));
      }
      act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
      const current = { ...fileItem("moved-id", { name: "new.txt",
        parent_location: kind === "cloud" ? { kind: "id", value: "other-folder" }
          : { kind: "path", value: "other-folder" } }), path: null, parent_path: null };
      vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({ operation_id: "moved", status: "completed",
        counts: { renamed: 1, skipped: 0, failed: 0, unknown: 0, not_attempted: 0 },
        items: [{ ...renamed(listing(2).items[0], fileItem("new.txt")).items[0], current_file: current }] });
      act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
      act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
      await waitFor(() => expect(hook.result.current.workflow.isSingleRenaming).toBe(false));
      expect(hook.result.current.workflow.singleRenameTarget).toBeNull();
      expect(useRenameStore.getState().latestRenameRecord?.items[0].after).toEqual(current);
      expect(hook.result.current.storage.files.data!.items.map((file) => file.id)).toEqual(["file-1.txt"]);
      expect(hook.result.current.workflow.browserItems.map((file) => file.id)).toEqual(["file-1.txt"]);
      expect(useRenameStore.getState().selectedIds).toEqual([]);
      expect(notify).toHaveBeenLastCalledWith({ key: "files:notifications.renamedElsewhere" }, "success");
      act(() => hook.result.current.workflow.selectAllFiles(["moved-id", "file-1.txt"]));
      act(() => hook.result.current.workflow.requestPreview());
      await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
        "default-local", { kind: "root" }, ["file-1.txt"], [],
      ));
    });

  it.each([null, { kind: "id", value: "unresolved-root" }] as Array<StorageLocation | null>)(
    "refreshes an unlocated result without treating it as a move (%j)", async (parent) => {
      const hook = await setupWorkspace(1);
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

  it("keeps an unlocated result out of the old directory when its refresh fails", async () => {
    const hook = await setupWorkspace(1);
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Directory unavailable"));
    const current = fileItem("confirmed-id", { name: "new.txt", parent_location: null });
    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce(renamed(listing(1).items[0], current));
    act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
    await waitFor(() => expect(hook.result.current.storage.files.isError).toBe(true));
    expect(hook.result.current.workflow.browserItems).toEqual([]);
    expect(useRenameStore.getState().latestRenameRecord?.items[0].after).toEqual(current);
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
    expect(hook.result.current.storage.files.error?.message).toBe("Directory unavailable");
  });

  it.each([
    { original: "archive.tar.gz", name: "archive.tar", extension: ".gz", input: "资料.tar", target: "资料.tar.gz", folder: false },
    { original: ".env", name: ".env", extension: "", input: ".env.local", target: ".env.local", folder: false },
    { original: "README", name: "README", extension: "", input: "说明", target: "说明", folder: false },
    { original: "folder.v1", name: "folder.v1", extension: "", input: "folder.v2", target: "folder.v2", folder: true },
  ])("edits $original and keeps the confirmed identity selected in the live directory", async (example) => {
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
    expect(useRenameStore.getState().latestRenameRecord).toMatchObject({
      kind: "single", operationId: vi.mocked(api.executeStorageSingleRename).mock.calls[0][1].operation_id,
      storageId: "default-local", revision: 1, location: { kind: "root" },
      items: [{ before: { id: source.id, name: example.original }, targetName: example.target,
        status: "renamed", after: { id: "provider-returned-id", name: example.target, path: null, parent_path: null } }],
    });
    expect(useRenameStore.getState().rules).toEqual([]);
    expect(hook.result.current.storage.files.data!.items).toEqual([current]);
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(hook.result.current.workflow.executionData).toBeUndefined();

    expect(api.createStoragePreview).not.toHaveBeenCalled();
  });

  it("keeps the batch record through preview and cancelled editing, then records the submitted single rename", async () => {
    const hook = await setupWorkspace(2);
    await preview(hook);
    const files = listing(2).items;
    const first = fileItem("first.txt");
    const other = fileItem("other.txt");
    vi.mocked(api.executePreview).mockResolvedValueOnce({
      preview_id: "task-preview", status: "completed",
      counts: { renamed: 2, skipped: 0, failed: 0, unknown: 0, not_attempted: 0 },
      items: [
        renamed(files[0], first).items[0], renamed(files[1], other).items[0],
      ],
    });
    act(() => hook.result.current.workflow.executeRename("task-preview"));
    await waitFor(() => expect(hook.result.current.workflow.executionData?.status).toBe("completed"));
    const batchRecord = useRenameStore.getState().latestRenameRecord;
    expect(batchRecord?.kind).toBe("batch");
    const rules = [{ type: "insert", enabled: true, config: { text: "batch-" } }];
    act(() => {
      hook.result.current.workflow.selectAllFiles(["first.txt"]);
      hook.result.current.workflow.onRulesChange(rules);
    });
    vi.mocked(api.createStoragePreview).mockResolvedValueOnce(previewResponse(["first.txt"], "batch-before-single"));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(hook.result.current.workflow.previewData?.preview_id).toBe("batch-before-single"));
    expect(useRenameStore.getState().latestRenameRecord).toBe(batchRecord);
    const batchPreview = hook.result.current.workflow.previewData;
    act(() => hook.result.current.workflow.openSingleRename("first.txt"));
    act(() => hook.result.current.workflow.closeSingleRename());
    expect(useRenameStore.getState().latestRenameRecord).toBe(batchRecord);
    expect(useRenameStore.getState().pendingRenameRecord).toBeNull();
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
    expect(useRenameStore.getState().selectedIds).toEqual(["z-last.txt"]);
    expect(useRenameStore.getState().latestRenameRecord).toMatchObject({
      kind: "single", items: [{ before: { id: first.id, name: first.name }, targetName: "z-last.txt", after: current }],
    });
    expect(useRenameStore.getState().latestRenameRecord?.items).toHaveLength(1);
    expect(useRenameStore.getState().rules).toEqual(rules);
    expect(hook.result.current.workflow.browserItems.map((item) => item.id)).toEqual(["other.txt", "z-last.txt"]);
    expect(hook.result.current.workflow.previewData).toBeUndefined();
    expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "batch-before-single");
    act(() => hook.result.current.workflow.executeRename("batch-before-single"));
    expect(api.executePreview).toHaveBeenCalledTimes(1);
    vi.mocked(api.createStoragePreview).mockResolvedValueOnce(previewResponse(["z-last.txt"], "batch-after-single"));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["z-last.txt"], rules,
    ));
    await waitFor(() => expect(hook.result.current.workflow.previewData?.preview_id).toBe("batch-after-single"));
    const next = fileItem("renamed-z-last.txt");
    const singleResponse = renamed(current, next);
    vi.mocked(api.executePreview).mockResolvedValueOnce({
      preview_id: "batch-after-single", status: singleResponse.status, counts: singleResponse.counts,
      items: singleResponse.items.map((item) => ({ ...item, current_file: next })),
    });
    act(() => hook.result.current.workflow.executeRename("batch-after-single"));
    await waitFor(() => expect(useRenameStore.getState().latestRenameRecord).toMatchObject({
      kind: "batch", operationId: "batch-after-single", items: [{ before: { id: current.id }, after: next }],
    }));
  });

  it("blocks duplicate submissions and conflicting actions throughout direct execution", async () => {
    const hook = await setupWorkspace(1);
    await preview(hook);

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
      hook.result.current.workflow.onRulesChange([{ type: "insert", enabled: true, config: { text: "changed" } }]);
      hook.result.current.workflow.changeSort({ field: "name", direction: "desc" });
    });
    await waitFor(() => expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1));
    expect(useRenameStore.getState().pendingRenameRecord).toMatchObject({
      kind: "single", items: [{ before: { id: "file-0.txt" }, targetName: "new.txt" }],
    });
    expect(useRenameStore.getState().latestRenameRecord).toBeNull();
    expect(hook.result.current.workflow.isSingleRenaming).toBe(true);
    expect(hook.result.current.workflow.isExecuting).toBe(true);
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

  it.each(["missing", "unknown", "lost", "unconfirmed"])("keeps new writes locked after a %s single rename outcome", async (kind) => {
    const hook = await setupWorkspace(1);
    const source = listing(1).items[0];

    if (kind === "lost") vi.mocked(api.executeStorageSingleRename).mockRejectedValueOnce(new Error("Response lost"));
    else vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({
      operation_id: "single-operation", status: kind === "unconfirmed" ? "completed" : "incomplete",
      counts: { renamed: kind === "unconfirmed" ? 1 : 0, skipped: 0, failed: 0, unknown: kind === "unknown" ? 1 : 0, not_attempted: 0 },
      items: kind === "missing" ? [] : [{
        file_id: source.id, original_name: source.name, new_name: "new.txt",
        status: kind === "unconfirmed" ? "renamed" : "unknown", error: kind === "unconfirmed" ? null : "Unknown write",
        error_code: kind === "unconfirmed" ? null : "RENAME_OUTCOME_UNKNOWN", actual_name: null,
      }],
    });
    act(() => hook.result.current.workflow.openSingleRename(source.id));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));

    await waitFor(() => expect(hook.result.current.workflow.isSingleRenaming).toBe(false));
    const record = useRenameStore.getState().latestRenameRecord;
    expect(record?.items).toMatchObject([{
      status: kind === "unconfirmed" ? "renamed" : "unknown", after: null, actualName: null,
    }]);
    expect(useRenameStore.getState().unknownExecution).toMatchObject({
      storageId: "default-local", previewId: kind === "lost"
        ? vi.mocked(api.executeStorageSingleRename).mock.calls[0][1].operation_id : "single-operation", items: [{ file_id: source.id }],
    });
    expect(hook.result.current.workflow.canSingleRename).toBe(false);
    expect(hook.result.current.workflow.singleRenameError).toBeDefined();
    act(() => {
      hook.result.current.workflow.applySingleRename("retry", ".txt");
      hook.result.current.workflow.requestPreview();
      hook.result.current.workflow.closeSingleRename();
    });
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
    expect(api.createStoragePreview).not.toHaveBeenCalled();
    expect(api.executePreview).not.toHaveBeenCalled();
    expect(useRenameStore.getState().unknownExecution).not.toBeNull();
    expect(useRenameStore.getState().latestRenameRecord).toBe(record);
    expect(hook.result.current.workflow.singleRenameTarget).toBeNull();
  });

  it.each([
    { code: "PERMISSION_DENIED", message: "Permission changed", text: "没有修改此项目的权限，请检查访问权限，或使用有权限的账号。" },
    { code: "RENAME_CONFLICT", message: "Name occupied", text: "此目录中已存在同名项目，请修改新名称后重试。" },
    { code: "RATE_LIMIT_ERROR", message: "Throttled", text: "请求过于频繁，请稍后重试。" },
  ])("keeps a $code failure retryable and translates its code", async ({ code, message, text }) => {
    const hook = await setupWorkspace(1);
    const source = listing(1).items[0];

    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({ operation_id: "single-operation", status: "incomplete",
      counts: { renamed: 0, skipped: 0, failed: 1, unknown: 0, not_attempted: 0 },
      items: [{
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
    expect(useRenameStore.getState().latestRenameRecord?.items).toMatchObject([{
      before: { id: source.id, name: source.name }, targetName: "new.txt",
      status: "failed", errorCode: code, after: null, actualName: source.name,
    }]);
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    expect(useRenameStore.getState().selectedIds).toEqual([source.id]);
  });

  it("removes a missing file on the API response while keeping its error dialog open", async () => {
    const hook = await setupWorkspace(2);
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce({ operation_id: "missing-file", status: "incomplete",
      counts: { renamed: 0, skipped: 0, failed: 1, unknown: 0, not_attempted: 0 },
      items: [{
      file_id: "file-0.txt", original_name: "file-0.txt", new_name: "new.txt", status: "failed",
      error: "Missing file", error_code: "NOT_FOUND",
    }] });
    act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
    await waitFor(() => expect(hook.result.current.workflow.singleRenameError).toBe("未找到此文件或目录，请刷新目录后重新选择。"));
    expect(hook.result.current.workflow.canSingleRename).toBe(false);
    expect(hook.result.current.workflow.singleRenameTarget).not.toBeNull();
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(hook.result.current.storage.files.data!.items.map((file) => file.id)).toEqual(["file-1.txt"]);
    expect(hook.result.current.workflow.browserItems.map((file) => file.id)).toEqual(["file-1.txt"]);
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    act(() => hook.result.current.workflow.applySingleRename("retry", ".txt"));
    expect(api.executeStorageSingleRename).toHaveBeenCalledTimes(1);
    const directoryAfterResponse = hook.result.current.storage.files.data;
    act(() => hook.result.current.workflow.closeSingleRename());
    await waitFor(() => expect(hook.result.current.workflow.singleRenameTarget).toBeNull());
    expect(hook.result.current.workflow.canSingleRename).toBe(false);
    expect(hook.result.current.storage.files.data).toBe(directoryAfterResponse);
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(hook.result.current.storage.files.data!.items.map((file) => file.id)).toEqual(["file-1.txt"]);
    expect(hook.result.current.workflow.browserItems.map((file) => file.id)).toEqual(["file-1.txt"]);
    expect(useRenameStore.getState().latestRenameRecord?.items).toMatchObject([{ status: "failed", errorCode: "NOT_FOUND" }]);
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt", "file-1.txt"]));
    act(() => hook.result.current.workflow.requestPreview());
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, ["file-1.txt"], [],
    ));
  });

  it.each([
    { status: 403, code: "PERMISSION_DENIED", text: "没有修改此项目的权限，请检查访问权限，或使用有权限的账号。" },
    { status: 409, code: "STORAGE_CONNECTION_CHANGED", text: "文件来源配置或账号已变化，请刷新目录后重新选择项目。" },
  ])("shows $code without locking either workflow", async ({ status, code, text }) => {
    const hook = await setupWorkspace(1);
    const source = listing(1).items[0];
    const confirmed = { ...source, name: "confirmed.txt", path: "confirmed.txt" };
    vi.mocked(api.executeStorageSingleRename).mockResolvedValueOnce(renamed(source, confirmed));
    act(() => hook.result.current.workflow.openSingleRename(source.id));
    act(() => hook.result.current.workflow.applySingleRename("confirmed", ".txt"));
    await waitFor(() => expect(hook.result.current.workflow.singleRenameTarget).toBeNull());
    const previous = useRenameStore.getState().latestRenameRecord;
    expect(previous?.items[0].after).toEqual(confirmed);

    vi.mocked(api.executeStorageSingleRename).mockRejectedValueOnce(new api.ApiError(status, "Rejected", code));
    act(() => hook.result.current.workflow.openSingleRename("file-0.txt"));
    act(() => hook.result.current.workflow.applySingleRename("new", ".txt"));
    await waitFor(() => expect(hook.result.current.workflow.singleRenameError).toBe(text));
    expect(hook.result.current.workflow.canSingleRename).toBe(true);
    expect(useRenameStore.getState().unknownExecution).toBeNull();
    expect(useRenameStore.getState().pendingRenameRecord).toBeNull();
    expect(useRenameStore.getState().latestRenameRecord).toBe(previous);
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

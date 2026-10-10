import { beforeEach, describe, expect, it } from "vitest";
import { useRenameStore } from "./useRenameStore";
import type { ExecuteResponse } from "../types";

const files = ["a.txt", "b.txt"].map((id) => ({ id, name: id, path: id, parent_path: "",
  is_directory: false, size: 1, modified_at: null }));
const prepare = () => useRenameStore.getState().prepareBatch("context", "test", { kind: "root" }, files);
beforeEach(() => { useRenameStore.setState({ task: null, selectedIds: files.map((item) => item.id), rules: [] }); });

it("replaces repeated preview drafts and ignores results of an obsolete preview", () => {
  const first = prepare();
  useRenameStore.getState().bindPreview(first.batchId, "old-preview");
  const second = prepare();
  useRenameStore.getState().bindPreview(second.batchId, "current-preview");
  expect(useRenameStore.getState().task!.batches).toHaveLength(1);
  useRenameStore.getState().applyResults({ preview_id: "old-preview", status: "completed", items: [] });
  expect(useRenameStore.getState().task!.items.every((item) => item.status === "pending")).toBe(true);
  expect(useRenameStore.getState().task!.batches[0].previewId).toBe("current-preview");
});

it("preserves reported and unknown batches while replacing subsequent drafts", () => {
  const first = prepare();
  useRenameStore.getState().bindPreview(first.batchId, "reported");
  useRenameStore.getState().applyResults({ preview_id: "reported", status: "partial", items: files.map((file) => ({
    file_id: file.id, original_name: file.name, new_name: file.name, status: "failed", error: "conflict",
  })) });
  useRenameStore.getState().setSelectedIds(["a.txt"]);
  const second = prepare();
  useRenameStore.getState().bindPreview(second.batchId, "unknown");
  useRenameStore.getState().markUnknown("unknown");
  expect(useRenameStore.getState().selectedIds).toEqual(["b.txt"]);
  prepare();
  const replacement = prepare();
  const batches = useRenameStore.getState().task!.batches;
  expect(batches.map((batch) => batch.outcome)).toEqual(["reported", "unknown", undefined]);
  expect(batches[2].batchId).toBe(replacement.batchId);
});

it("isolates saved results from the API response and preserves confirmed local identity", () => {
  const batch = prepare();
  useRenameStore.getState().bindPreview(batch.batchId, "preview");
  const response: ExecuteResponse = { preview_id: "preview", status: "completed", items: files.map((file) => ({
    file_id: file.id, original_name: file.name, new_name: `new-${file.name}`, status: "renamed", error: null,
    current_file: { ...file, id: `new-${file.id}`, name: `new-${file.name}` },
  })) };
  useRenameStore.getState().applyResults(response);
  response.items[0].current_file!.id = "tampered";
  const task = useRenameStore.getState().task!;
  expect(task.items[0].currentFileId).toBe("new-a.txt");
  expect(task.items[0].after!.current_file!.id).toBe("new-a.txt");
  expect(task.items[0].before.name).toBe("a.txt");
  expect(task.batches[0].results![0].current_file!.id).toBe("new-a.txt");
  useRenameStore.getState().setSelectedIds(["new-a.txt"]);
  expect(useRenameStore.getState().selectedIds).toEqual([]);
});

describe("session rename batches", () => {
  beforeEach(() => { useRenameStore.setState({ selectedIds: [], rules: [], task: null }); });
  const files = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: `old-${index}.txt`, name: `old-${index}.txt`, path: `old-${index}.txt`, parent_path: "",
    is_directory: false, size: 1, modified_at: null,
  }));
  const begin = (count: number) => {
    const entries = files(count);
    useRenameStore.getState().setSelectedIds(entries.map((file) => file.id));
    return entries;
  };
  const succeed = (fileIds: string[], previewId: string) => {
    useRenameStore.getState().applyResults({ preview_id: previewId, status: "completed", items: fileIds.map((id) => ({
      file_id: id, original_name: id, new_name: `new-${id}`, status: "renamed", error: null,
      current_file: { id: `new-${id}`, name: `new-${id}`, path: `new-${id}`, parent_path: "", is_directory: false, size: 1, modified_at: null },
    })) });
  };

  it.each([1000, 2000])("processes %i selections in batches without reselecting successes", (count) => {
    const entries = begin(count);
    const first = useRenameStore.getState().prepareBatch("context", "local", { kind: "root" }, entries);
    expect(first.fileIds).toHaveLength(1000);
    useRenameStore.getState().bindPreview(first.batchId, "first");
    const before = useRenameStore.getState().task!.items[0].before;
    succeed(first.fileIds, "first");
    expect(useRenameStore.getState().selectedIds).toHaveLength(count - 1000);
    expect(useRenameStore.getState().task!.items[0].before).toBe(before);
    expect(before.id).toBe("old-0.txt");
    expect(useRenameStore.getState().task!.items[0].currentFileId).toBe("new-old-0.txt");
    // 刷新返回重命名后的本地 ID；全选仍不能重新执行成功项。
    const refreshed = [...entries.slice(1000), ...entries.slice(0, 1000).map((file) => ({ ...file, id: `new-${file.id}` }))];
    useRenameStore.getState().setSelectedIds(refreshed.map((file) => file.id));
    expect(useRenameStore.getState().selectedIds).toHaveLength(count - 1000);
    if (count === 2000) {
      const second = useRenameStore.getState().prepareBatch("context", "local", { kind: "root" }, refreshed);
      expect(second.fileIds).toEqual(entries.slice(1000).map((file) => file.id));
      useRenameStore.getState().bindPreview(second.batchId, "second");
      succeed(second.fileIds, "second");
      expect(useRenameStore.getState().selectedIds).toEqual([]);
      expect(useRenameStore.getState().task!.items.every((item) => item.status === "completed")).toBe(true);
    }
  });

  it("keeps other batches and failures while unknown outcomes require explicit reconciliation", () => {
    const entries = begin(1002);
    const batch = useRenameStore.getState().prepareBatch("context", "cloud", { kind: "root" }, entries);
    useRenameStore.getState().bindPreview(batch.batchId, "partial");
    useRenameStore.getState().applyResults({ preview_id: "partial", status: "partial", items: batch.fileIds.map((id, index) => ({
      file_id: id, original_name: id, new_name: `new-${id}`, status: index === 0 ? "failed" : index === 1 ? "failed" : "renamed",
      error: index < 2 ? "Write failed" : null, error_code: index === 1 ? "RENAME_OUTCOME_UNKNOWN" : null,
      actual_name: index === 0 ? id : null,
    })) });
    expect(useRenameStore.getState().selectedIds).toEqual([entries[0].id, entries[1000].id, entries[1001].id]);
    useRenameStore.getState().setSelectedIds([entries[1].id]);
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    const item = useRenameStore.getState().task!.items[1];
    useRenameStore.getState().reconcileItem(item.taskItemId, entries[1], false);
    useRenameStore.getState().setSelectedIds([entries[1].id]);
    const retry = useRenameStore.getState().prepareBatch("context", "cloud", { kind: "root" }, entries);
    expect(retry.fileIds).toEqual([entries[1].id]);
    expect(useRenameStore.getState().task!.items[1000].status).toBe("pending");
    expect(useRenameStore.getState().task!.items[1].reconciliation!.completed).toBe(false);
  });

  it("locks a batch with a lost response and preserves untouched batches", () => {
    const entries = begin(2000);
    const batch = useRenameStore.getState().prepareBatch("context", "local", { kind: "root" }, entries);
    useRenameStore.getState().bindPreview(batch.batchId, "lost");
    useRenameStore.getState().markUnknown("lost");
    expect(useRenameStore.getState().task!.items.filter((item) => item.status === "unknown")).toHaveLength(1000);
    expect(useRenameStore.getState().selectedIds).toEqual(entries.slice(1000).map((file) => file.id));
  });

  it("uses copied rules and creates a new task on changed context without rewriting old snapshots", () => {
    const entries = begin(2);
    useRenameStore.getState().setRules([{ type: "insert", enabled: true, config: { text: "first" } }]);
    useRenameStore.getState().prepareBatch("old-context", "local", { kind: "root" }, entries);
    const oldTask = useRenameStore.getState().task!;
    useRenameStore.getState().setRules([{ type: "insert", enabled: true, config: { text: "second" } }]);
    useRenameStore.getState().prepareBatch("new-context", "local", { kind: "root" }, entries);
    expect(useRenameStore.getState().task!.taskId).not.toBe(oldTask.taskId);
    expect(oldTask.rules[0].config.text).toBe("first");
    expect(useRenameStore.getState().task!.batches).toHaveLength(1);
  });
});

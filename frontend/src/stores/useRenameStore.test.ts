import { beforeEach, expect, it } from "vitest";
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

import { beforeEach, expect, it } from "vitest";
import { useRenameStore } from "./useRenameStore";
import { fileItem } from "../test/fixtures";

beforeEach(() => useRenameStore.setState({ selectedIds: [], rules: [], task: null, previewActive: false, unknownExecution: null }));

it("keeps original snapshots and confirmed identities across repeated renames", () => {
  const files = [fileItem("a.txt")];
  const store = useRenameStore.getState();
  store.setSelectedIds(["a.txt"]);
  store.createTask("workspace", "local", { kind: "root" }, files);
  const original = useRenameStore.getState().task!;
  files[0].name = "changed outside the task";
  expect(original.items[0].before.name).toBe("a.txt");
  expect(Object.isFrozen(original.items[0].before)).toBe(true);
  for (const [oldId, newId] of [["a.txt", "first.txt"], ["first.txt", "second.txt"]]) {
    store.applyTaskResults(original.taskId, { items: [{
      file_id: oldId, original_name: oldId, new_name: newId, status: "renamed", error: null,
      current_file: fileItem(newId),
    }] });
    store.setSelectedIds([newId]);
    expect(useRenameStore.getState().selectedIds).toEqual([newId]);
    store.createTask("workspace", "local", { kind: "root" }, [fileItem(newId)]);
    const task = useRenameStore.getState().task!;
    expect(task.taskId).toBe(original.taskId);
    expect(task.items[0].before).toBe(original.items[0].before);
    expect(task.items[0].currentFileId).toBe(newId);
  }
});

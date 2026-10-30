import type { DirectoryListing, FileItem, RenameTask, SingleRenameExecuteResponse, StorageLocation } from "../../types";
import { isInDirectory } from "../files/directoryIdentity";

export function createRenameTask(
  contextKey: string, storageId: string, location: StorageLocation, files: FileItem[], selectedIds: string[],
): RenameTask {
  const selected = new Set(selectedIds);
  return {
    taskId: crypto.randomUUID(), contextKey, storageId,
    location: Object.freeze(structuredClone(location)),
    items: files.filter((file) => selected.has(file.id)).map((file) => ({
      taskItemId: crypto.randomUUID(), currentFileId: file.id,
      before: Object.freeze({ ...structuredClone(file), storageId }),
    })),
  };
}

export function applyRenameTaskResults(
  task: RenameTask, response: Pick<SingleRenameExecuteResponse, "items">,
): RenameTask {
  const results = new Map(response.items.map((item) => [item.file_id, item]));
  // 执行只更新结果和当前身份，保留固定成员及原始快照。
  return { ...task, items: task.items.map((item) => {
    const result = results.get(item.currentFileId);
    if (!result) return item;
    const after = Object.freeze(structuredClone(result));
    return { ...item, after, currentFileId: after.current_file?.id ?? item.currentFileId };
  }) };
}

export function taskFileItems(files: FileItem[], task: RenameTask, listing: DirectoryListing | undefined): FileItem[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  // 固定任务保留不可用成员；目录缓存和 can_rename 决定其是否可选择。
  return task.items.flatMap((item) => {
    const current = item.after?.current_file;
    const membership = current ? isInDirectory(listing, current) : undefined;
    if (membership === false && current) return [{ ...current,
      parent_path: current.parent_path ?? "", path: current.path ?? current.name, can_rename: false }];
    const listed = byId.get(item.currentFileId);
    if (listed) return [listed];
    // An unlocated result must be resolved by a fresh listing, never by the old snapshot.
    if (membership === null) return [];
    if (!current) return [{ ...item.before, id: item.currentFileId, can_rename: false }];
    // Same-directory single results are normalized before storage; batch results already have paths.
    return [current as FileItem];
  });
}

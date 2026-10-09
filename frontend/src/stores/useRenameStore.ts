import { create } from "zustand";

import type { ExecuteResponse, FileItem, RenameTask, TaskItemStatus, RuleSpec, StorageLocation } from "../types";

export const RENAME_BATCH_SIZE = 1000;
const retryable = (status: string) => status === "pending" || status === "failed";

interface RenameUiState {
  selectedIds: string[];
  rules: RuleSpec[];
  task: RenameTask | null;
  toggleSelected: (fileId: string) => void;
  setSelectedIds: (fileIds: string[]) => void;
  clearSelection: () => void;
  setRules: (rules: RuleSpec[]) => void;
  resetTask: () => void;
  prepareBatch: (contextKey: string, storageId: string, location: StorageLocation, files: FileItem[]) => { batchId: string; fileIds: string[] };
  bindPreview: (batchId: string, previewId: string) => void;
  applyResults: (response: ExecuteResponse) => void;
  markUnknown: (previewId: string) => void;
  reconcileItem: (taskItemId: string, file: FileItem, completed: boolean) => void;
}

export const useRenameStore = create<RenameUiState>((set, get) => ({
  selectedIds: [], rules: [], task: null,
  toggleSelected: (fileId) => {
    const state = get();
    state.setSelectedIds(state.selectedIds.includes(fileId)
      ? state.selectedIds.filter((id) => id !== fileId) : [...state.selectedIds, fileId]);
  },
  setSelectedIds: (fileIds) => set((state) => {
    // 完成项和未知项不能因全选、刷新或反选重新进入执行集合。
    const blocked = new Set(state.task?.items.filter((item) => !retryable(item.status)).map((item) => item.currentFileId));
    return { selectedIds: fileIds.filter((id) => !blocked.has(id)) };
  }),
  clearSelection: () => set({ selectedIds: [] }),
  setRules: (rules) => set({ rules }),
  resetTask: () => set({ task: null }),
  prepareBatch: (contextKey, storageId, location, files) => {
    const state = get();
    const byId = new Map(files.map((file) => [file.id, file]));
    let task = state.task;
    if (!task || task.contextKey !== contextKey) {
      task = {
        taskId: crypto.randomUUID(), contextKey, storageId, location: structuredClone(location),
        rules: structuredClone(state.rules), batches: [],
        items: state.selectedIds.filter((id) => byId.has(id)).map((id, order) => ({
          taskItemId: crypto.randomUUID(), order,
          before: Object.freeze({ ...structuredClone(byId.get(id)!), storageId }),
          currentFileId: id, status: "pending",
        })),
      };
    }
    const selected = new Set(state.selectedIds);
    const items = task.items.filter((item) => retryable(item.status) && selected.has(item.currentFileId) && byId.has(item.currentFileId)).slice(0, RENAME_BATCH_SIZE);
    const batchId = crypto.randomUUID();
    set({ task: { ...task, batches: [...task.batches, { batchId, taskItemIds: items.map((item) => item.taskItemId) }] } });
    return { batchId, fileIds: items.map((item) => item.currentFileId) };
  },
  bindPreview: (batchId, previewId) => set((state) => ({ task: state.task && {
    ...state.task, batches: state.task.batches.map((batch) => batch.batchId === batchId ? { ...batch, previewId } : batch),
  } })),
  applyResults: (response) => set((state) => {
    const task = state.task;
    const batch = task?.batches.find((entry) => entry.previewId === response.preview_id);
    if (!task || !batch) return {};
    const results = new Map(response.items.map((result) => [result.file_id, result]));
    const members = new Set(batch.taskItemIds);
    const items = task.items.map((item) => {
      if (!members.has(item.taskItemId)) return item;
      const result = results.get(item.currentFileId);
      if (!result) return { ...item, status: "unknown" as const };
      // 只相信逐项结果。回滚遗留名称且身份未确认时同样禁止直接重试。
      const status: TaskItemStatus = result.status !== "failed" ? "completed" :
        result.error_code === "RENAME_OUTCOME_UNKNOWN" ||
        (result.actual_name != null && result.actual_name !== result.original_name && !result.current_file)
          ? "unknown" : "failed";
      return { ...item, status, after: structuredClone(result), currentFileId: result.current_file?.id ?? item.currentFileId };
    });
    return {
      task: { ...task, items, batches: task.batches.map((entry) => entry === batch ? { ...entry, outcome: "reported" as const, results: structuredClone(response.items) } : entry) },
      selectedIds: items.filter((item) => retryable(item.status)).map((item) => item.currentFileId),
    };
  }),
  markUnknown: (previewId) => set((state) => {
    const task = state.task;
    const batch = task?.batches.find((entry) => entry.previewId === previewId);
    if (!task || !batch) return {};
    const members = new Set(batch.taskItemIds);
    const items = task.items.map((item) => members.has(item.taskItemId) ? { ...item, status: "unknown" as const } : item);
    return { task: { ...task, items, batches: task.batches.map((entry) => entry === batch ? { ...entry, outcome: "unknown" as const } : entry) }, selectedIds: items.filter((item) => retryable(item.status)).map((item) => item.currentFileId) };
  }),
  reconcileItem: (taskItemId, file, completed) => set((state) => ({
    // 人工核对真实目录后显式确认身份和结果，绝不通过目标名称自动判定成功。
    task: state.task && { ...state.task, items: state.task.items.map((item) => item.taskItemId === taskItemId
      ? { ...item, currentFileId: file.id, status: completed ? "completed" : "failed",
          reconciliation: { file: { ...structuredClone(file), storageId: item.before.storageId }, completed, verifiedAt: new Date().toISOString() } } : item) },
  })),
}));

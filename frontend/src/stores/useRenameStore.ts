import { create } from "zustand";
import { finishRenameRecord, type PendingRenameRecord, type RenameRecord, type RenameSubmission } from "../features/rename/renameRecord";
import type { PreviewItem, RuleSpec, SingleExecuteItem, StorageLocation } from "../types";

export interface UnknownExecution {
  storageId: string;
  location: StorageLocation;
  previewId: string;
  items: PreviewItem[];
}

interface RenameUiState {
  selectedIds: string[];
  rules: RuleSpec[];
  unknownExecution: UnknownExecution | null;
  pendingRenameRecord: PendingRenameRecord | null;
  // 请求仍可能在写入前被拒绝，上一条记录保留到收到本次执行结果。
  latestRenameRecord: RenameRecord | null;
  toggleSelected: (fileId: string) => void;
  setSelectedIds: (fileIds: string[]) => void;
  clearSelection: () => void;
  setRules: (rules: RuleSpec[]) => void;
  setUnknownExecution: (execution: UnknownExecution | null) => void;
  startRenameRecord: (submission: RenameSubmission) => PendingRenameRecord | null;
  settleRenameRecord: (record: PendingRenameRecord, outcomes: readonly SingleExecuteItem[] | null) => void;
}

export const useRenameStore = create<RenameUiState>((set, get) => ({
  selectedIds: [], rules: [], unknownExecution: null,
  pendingRenameRecord: null, latestRenameRecord: null,
  toggleSelected: (fileId) => {
    const state = get();
    state.setSelectedIds(state.selectedIds.includes(fileId)
      ? state.selectedIds.filter((id) => id !== fileId) : [...state.selectedIds, fileId]);
  },
  setSelectedIds: (selectedIds) => set({ selectedIds }),
  clearSelection: () => set({ selectedIds: [] }),
  setRules: (rules) => set({ rules }),
  setUnknownExecution: (unknownExecution) => set({ unknownExecution }),
  startRenameRecord: (submission) => {
    if (get().pendingRenameRecord || get().unknownExecution) return null;
    const record = { ...structuredClone(submission), submittedAt: Date.now() };
    set({ pendingRenameRecord: record });
    return record;
  },
  settleRenameRecord: (record, outcomes) => set((state) => {
    if (state.pendingRenameRecord !== record) return {};
    // null 表示请求在写入前被拒绝；空结果仍可能已写入，按未知保存。
    return outcomes === null ? { pendingRenameRecord: null }
      : { pendingRenameRecord: null, latestRenameRecord: finishRenameRecord(record, outcomes) };
  }),
}));

export function hasPendingRename() {
  return useRenameStore.getState().pendingRenameRecord !== null;
}

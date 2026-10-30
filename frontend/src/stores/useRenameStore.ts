import { create } from "zustand";
import { applyRenameTaskResults, createRenameTask } from "../features/rename/renameTask";
import type { FileItem, PreviewItem, RenameTask, RuleSpec, SingleRenameExecuteResponse, StorageLocation } from "../types";

export interface UnknownExecution {
  storageId: string;
  previewId: string;
  items: PreviewItem[];
  previewUnlocked?: boolean;
}

interface RenameUiState {
  selectedIds: string[];
  rules: RuleSpec[];
  task: RenameTask | null;
  previewActive: boolean;
  unknownExecution: UnknownExecution | null;
  toggleSelected: (fileId: string) => void;
  setSelectedIds: (fileIds: string[]) => void;
  clearSelection: () => void;
  setRules: (rules: RuleSpec[]) => void;
  createTask: (contextKey: string, storageId: string, location: StorageLocation, files: FileItem[]) => void;
  resetTask: () => void;
  applyTaskResults: (taskId: string, response: Pick<SingleRenameExecuteResponse, "items">) => void;
  setPreviewActive: (active: boolean) => void;
  setUnknownExecution: (execution: UnknownExecution | null) => void;
}

export const useRenameStore = create<RenameUiState>((set, get) => ({
  selectedIds: [], rules: [], task: null, previewActive: false, unknownExecution: null,
  toggleSelected: (fileId) => {
    const state = get();
    state.setSelectedIds(state.selectedIds.includes(fileId)
      ? state.selectedIds.filter((id) => id !== fileId) : [...state.selectedIds, fileId]);
  },
  setSelectedIds: (fileIds) => set((state) => {
    const members = state.task && new Set(state.task.items.map((item) => item.currentFileId));
    return { selectedIds: members ? fileIds.filter((id) => members.has(id)) : fileIds };
  }),
  clearSelection: () => set({ selectedIds: [] }),
  setRules: (rules) => set({ rules }),
  createTask: (contextKey, storageId, location, files) => set((state) => {
    if (state.task?.contextKey === contextKey) return {};
    return { task: createRenameTask(contextKey, storageId, location, files, state.selectedIds) };
  }),
  resetTask: () => set({ task: null }),
  applyTaskResults: (taskId, response) => set((state) => {
    if (state.task?.taskId !== taskId) return {};
    return { task: applyRenameTaskResults(state.task, response) };
  }),
  setPreviewActive: (previewActive) => set({ previewActive }),
  setUnknownExecution: (unknownExecution) => set({ unknownExecution }),
}));

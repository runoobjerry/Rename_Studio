import { create } from "zustand";

import type { RuleSpec } from "../types";

interface RenameUiState {
  selectedIds: string[];
  rules: RuleSpec[];
  toggleSelected: (fileId: string) => void;
  clearSelection: () => void;
  setRules: (rules: RuleSpec[]) => void;
}

export const useRenameStore = create<RenameUiState>((set) => ({
  selectedIds: [],
  rules: [],
  toggleSelected: (fileId) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(fileId)
        ? state.selectedIds.filter((id) => id !== fileId)
        : [...state.selectedIds, fileId],
    })),
  clearSelection: () => set({ selectedIds: [] }),
  setRules: (rules) => set({ rules }),
}));

import { useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";

import { useNotification } from "../../components/NotificationProvider";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../../features/settings/useAppSettings";
import { useRenameStore } from "../../stores/useRenameStore";
import type { RenameTask } from "../../types";

interface FactoryResetOptions {
  task: RenameTask | null;
  isExecuting: boolean;
  isPreviewing: boolean;
  storageBusy: boolean;
  endTask: () => void;
  resetWorkspaceSession: () => void;
}

export function useFactoryReset({
  task, isExecuting, isPreviewing, storageBusy, endTask, resetWorkspaceSession,
}: FactoryResetOptions) {
  const notify = useNotification();
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const appSettings = useAppSettings();
  const activeMutations = useIsMutating();
  const [resetPending, setResetPending] = useState(false);
  const [resetEpoch, setResetEpoch] = useState(0);

  let resetDisabledReason: string | undefined;
  if (task?.items.some((item) => item.status === "unknown")) {
    resetDisabledReason = t("resetUnknown");
  } else if (isExecuting || isPreviewing || storageBusy) {
    resetDisabledReason = t("resetBusy");
  } else if (activeMutations > 0) {
    resetDisabledReason = t("resetSaving");
  }
  const factoryReset = async () => {
    if (resetPending || resetDisabledReason) return false;
    setResetPending(true);
    try {
      try {
        await appSettings.factoryReset();
      } catch (error) {
        notify({ key: "settings:resetFailed", values: { message: (error as Error).message } }, "error");
        return false;
      }
      // Clear the workspace only after the backend reset succeeds.
      await queryClient.cancelQueries({ predicate: (query) => query.queryKey[0] !== "app-settings" });
      endTask();
      useRenameStore.getState().setRules([]);
      resetWorkspaceSession();
      setResetEpoch((current) => current + 1);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "app-settings" && query.queryKey[0] !== "rules" });
      void queryClient.invalidateQueries({ queryKey: ["storages"] });
      notify({ key: "settings:resetDone" }, "success");
      return true;
    } finally {
      setResetPending(false);
    }
  };

  return { factoryReset, resetDisabledReason, resetPending, resetEpoch };
}

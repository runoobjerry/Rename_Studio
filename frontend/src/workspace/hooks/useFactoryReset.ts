import { useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";

import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { useAppSettings } from "../../features/settings/useAppSettings";
import { useRenameStore } from "../../stores/useRenameStore";
import type { RenameTask } from "../../types";

interface FactoryResetOptions {
  task: RenameTask | null;
  isExecuting: boolean;
  isPreviewing: boolean;
  storageBusy: boolean;
  endTask: () => void;
  selectStorage: (storageId: string) => void;
}

export function useFactoryReset({
  task, isExecuting, isPreviewing, storageBusy, endTask, selectStorage,
}: FactoryResetOptions) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const appSettings = useAppSettings();
  const activeMutations = useIsMutating();
  const [resetPending, setResetPending] = useState(false);
  const [resetEpoch, setResetEpoch] = useState(0);

  let resetDisabledReason: string | undefined;
  if (task?.items.some((item) => item.status === "unknown")) {
    resetDisabledReason = "请先核对待核对项并结束当前任务。";
  } else if (isExecuting || isPreviewing || storageBusy) {
    resetDisabledReason = "重命名操作进行中，完成后才能重置。";
  } else if (activeMutations > 0) {
    resetDisabledReason = "连接正在保存，请稍后重试。";
  }
  const factoryReset = async () => {
    if (resetPending || resetDisabledReason) return false;
    setResetPending(true);
    try {
      try {
        await appSettings.factoryReset();
      } catch (error) {
        notify(`恢复出厂设置失败：${errorMessage(error as Error)}`, "error");
        return false;
      }
      // Clear the workspace only after the backend reset succeeds.
      await queryClient.cancelQueries({ predicate: (query) => query.queryKey[0] !== "app-settings" });
      endTask();
      useRenameStore.getState().setRules([]);
      selectStorage("default-local");
      setResetEpoch((current) => current + 1);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "app-settings" && query.queryKey[0] !== "rules" });
      void queryClient.invalidateQueries({ queryKey: ["storages"] });
      notify("已重置应用", "success");
      return true;
    } finally {
      setResetPending(false);
    }
  };

  return { factoryReset, resetDisabledReason, resetPending, resetEpoch };
}

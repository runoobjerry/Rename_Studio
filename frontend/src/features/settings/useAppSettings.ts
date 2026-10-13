import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { factoryResetAppSettings, fetchAppSettings, patchAppSettings } from "../../api/client";
import type { AppSettings, AppSettingsPatch } from "../../types";

const queryKey = ["app-settings"] as const;
const pending = new WeakMap<QueryClient, Promise<void>>();
const resetting = new WeakSet<QueryClient>();

export function useAppSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey, queryFn: fetchAppSettings, retry: false });
  const save = (changes: AppSettingsPatch): Promise<AppSettings> => {
    if (resetting.has(queryClient)) return Promise.reject(new Error("正在恢复出厂设置，请稍后重试。"));
    const previous = pending.get(queryClient) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const updated = await patchAppSettings(changes);
      // Discard older reads so they cannot overwrite this successful save.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, updated);
      return updated;
    });
    // Queue completion includes failed saves; each caller still receives its own result or error.
    const settled = operation.then(() => undefined, () => undefined);
    pending.set(queryClient, settled);
    void settled.then(() => {
      if (pending.get(queryClient) === settled) pending.delete(queryClient);
    });
    return operation;
  };
  const factoryReset = async (): Promise<AppSettings> => {
    if (resetting.has(queryClient)) throw new Error("恢复出厂设置正在进行中。");
    resetting.add(queryClient);
    try {
      // Prior failed saves have already reported their errors; wait until every queued write settles.
      await pending.get(queryClient);
      await queryClient.cancelQueries({ queryKey });
      const updated = await factoryResetAppSettings();
      queryClient.setQueryData(queryKey, updated);
      return updated;
    } finally {
      resetting.delete(queryClient);
    }
  };
  return { ...query, save, factoryReset };
}

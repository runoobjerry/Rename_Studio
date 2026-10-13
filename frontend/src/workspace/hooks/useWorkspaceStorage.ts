import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStorageFiles, fetchStorageAuthStatus, fetchStorages, pickStorageFolder } from "../../api/client";
import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { readDefaultCloudLocation } from "../../features/files/defaultCloudLocation";
import { useAppSettings } from "../../features/settings/useAppSettings";
import type { StorageLocation } from "../../types";

interface WorkspaceStorageOptions {
  hasTask: boolean;
  onLocalRootSelected: () => void;
}

export function useWorkspaceStorage({ hasTask, onLocalRootSelected }: WorkspaceStorageOptions) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const appSettings = useAppSettings();
  const [storageId, setStorageId] = useState("default-local");
  const [location, setLocation] = useState<StorageLocation>({ kind: "root" });
  const setPath = useCallback((value: string) => setLocation(value ? { kind: "path", value } : { kind: "root" }), []);
  const [restoredCloudSession, setRestoredCloudSession] = useState<string | null>(null);

  const providers = useQuery({ queryKey: ["storages"], queryFn: fetchStorages, refetchInterval: 3000 });
  const activeStorage = providers.data?.find((storage) => storage.storage_id === storageId);
  const providerId = activeStorage?.provider_type ?? "local";
  const oneDriveStatus = useQuery({
    queryKey: ["storage-auth", storageId, activeStorage?.revision],
    queryFn: () => fetchStorageAuthStatus(storageId),
    enabled: providerId === "onedrive" && Boolean(activeStorage),
  });
  const localSettings = {
    data: activeStorage?.config.root_path ? { root_path: activeStorage.config.root_path } : undefined,
    isSuccess: providerId === "local" && Boolean(activeStorage),
    isPending: providers.isPending,
    error: providers.error,
  };
  const cloudAccountId = providerId === "onedrive" ? oneDriveStatus.data?.account_id : null;
  const cloudConnected = providerId === "onedrive" && oneDriveStatus.data?.connected === true;
  const cloudSession = cloudConnected ? JSON.stringify([storageId, activeStorage?.revision, cloudAccountId ?? null]) : null;
  const cloudReady = cloudConnected && restoredCloudSession === cloudSession;
  const files = useQuery({
    queryKey: ["files", storageId, activeStorage?.revision, location],
    queryFn: () => fetchStorageFiles(storageId, location),
    enabled: !hasTask && Boolean(activeStorage) && ((providerId === "local" && localSettings.isSuccess) || cloudReady),
  });
  const workspaceKey = useMemo(() => JSON.stringify([storageId, activeStorage?.revision, location]), [storageId, activeStorage?.revision, location]);
  const providerName = activeStorage?.name ?? storageId;
  const settingsLoading = providerId === "local" ? localSettings.isPending : oneDriveStatus.isPending;

  const pickLocalRoot = useMutation({
    mutationFn: () => pickStorageFolder(storageId),
    onSuccess: async (settings) => {
      if (!settings.selected) return;
      await queryClient.invalidateQueries({ queryKey: ["storages"] });
      setPath("");
      // 保留原顺序：刷新连接、回到根目录、清理重命名视图，再通知和失效目录。
      onLocalRootSelected();
      notify("已选择本地根文件夹。");
      await queryClient.invalidateQueries({ queryKey: ["files", storageId] });
    },
    onError: (error) => notify(`选择文件夹失败：${errorMessage(error)}`, "error"),
  });

  const selectStorage = useCallback((nextStorageId: string) => {
    setStorageId(nextStorageId);
    setPath("");
    setRestoredCloudSession(null);
  }, [setPath]);

  const restoreDefaultCloudPath = useCallback(() => {
    const defaultLocation = cloudConnected && cloudAccountId && appSettings.data
      ? readDefaultCloudLocation(appSettings.data.preferences, storageId, cloudAccountId)
      : { kind: "root" } as StorageLocation;
    if (appSettings.isError) notify("无法读取默认路径，将打开云盘根目录。", "warning");
    // 由工作区在原 effect 位置调用；恢复完成前 cloudReady 阻止目录请求。
    setLocation(defaultLocation);
    setRestoredCloudSession(cloudSession);
  }, [cloudConnected, cloudAccountId, appSettings.data, appSettings.isError, storageId, cloudSession, notify]);

  const setDefaultCloudPath = useCallback(() => {
    if (!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || files.error) return;
    void appSettings.save({ cloud_default_locations: { [storageId]: { account_id: cloudAccountId, location: files.data.location! } } })
      .then(() => notify(`已将“${files.data.path || "根目录"}”设为当前账号的默认路径。`))
      .catch((error: Error) => notify(`默认路径保存失败：${errorMessage(error)}`, "error"));
  }, [cloudAccountId, cloudReady, files.isSuccess, files.isFetching, files.error, files.data, storageId, notify, appSettings.save]);

  const refreshFiles = useCallback(() => {
    void files.refetch().then((result) => {
      if (result.error) notify(`刷新失败：${errorMessage(result.error)}`, "error");
      else notify("目录已刷新。");
    });
  }, [files.refetch, notify]);

  // 执行保护与重命名重置仍由工作区协调，Hook 不依赖任务 Store 或重命名 mutation。
  return {
    storageId, location, setLocation, setPath, selectStorage,
    providers, activeStorage, providerId, providerName, oneDriveStatus, localSettings,
    cloudAccountId, cloudConnected, cloudSession, cloudReady, restoredCloudSession,
    appSettingsReady: appSettings.isSuccess || appSettings.isError,
    files, workspaceKey, settingsLoading, pickLocalRoot,
    restoreDefaultCloudPath, setDefaultCloudPath, refreshFiles,
  };
}

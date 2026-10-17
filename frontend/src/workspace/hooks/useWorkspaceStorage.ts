import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStorageFiles, fetchStorageAuthStatus, fetchStorages, pickStorageFolder } from "../../api/client";
import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { readDefaultCloudLocation } from "../../features/files/defaultCloudLocation";
import { useAppSettings } from "../../features/settings/useAppSettings";
import type { StorageLocation } from "../../types";
import { clearWorkspaceSession, readWorkspaceSession, writeWorkspaceSession } from "../workspaceSession";

interface WorkspaceStorageOptions {
  hasTask: boolean;
  onLocalRootSelected: () => void;
}

export function useWorkspaceStorage({ hasTask, onLocalRootSelected }: WorkspaceStorageOptions) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const appSettings = useAppSettings();
  const [initialSession] = useState(readWorkspaceSession);
  const session = useRef(initialSession.session);
  const sessionWarningShown = useRef(false);
  const [storageId, setStorageId] = useState(initialSession.session.activeStorageId);
  const [location, setLocation] = useState<StorageLocation>({ kind: "root" });
  const setPath = useCallback((value: string) => setLocation(value ? { kind: "path", value } : { kind: "root" }), []);
  const [restoredCloudSession, setRestoredCloudSession] = useState<string | null>(null);
  const [restoredLocalSession, setRestoredLocalSession] = useState<string | null>(null);

  const warnSessionUnavailable = useCallback(() => {
    if (sessionWarningShown.current) return;
    sessionWarningShown.current = true;
    notify("浏览器会话存储不可用，刷新后无法保留工作路径。", "warning");
  }, [notify]);
  const saveSession = useCallback(() => {
    if (!writeWorkspaceSession(session.current)) warnSessionUnavailable();
  }, [warnSessionUnavailable]);
  useEffect(() => {
    if (initialSession.unavailable) warnSessionUnavailable();
  }, [initialSession.unavailable, warnSessionUnavailable]);

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
  const localSession = providerId === "local" && activeStorage
    ? JSON.stringify([storageId, activeStorage.revision]) : null;
  const localReady = localSession !== null && restoredLocalSession === localSession;
  const locationReady = localReady || cloudReady;

  useEffect(() => {
    if (!providers.isSuccess || activeStorage) return;
    setStorageId("default-local");
    setPath("");
    setRestoredLocalSession(null);
    setRestoredCloudSession(null);
  }, [providers.isSuccess, activeStorage, setPath]);

  useEffect(() => {
    if (!providers.isSuccess) return;
    let changed = false;
    for (const [id, saved] of Object.entries(session.current.locations)) {
      const storage = providers.data.find((entry) => entry.storage_id === id);
      // 当前连接优先采用对应版本的授权查询；未激活连接由连接列表判断身份。
      const hasAuthStatus = id === storageId && storage?.provider_type === "onedrive" && oneDriveStatus.isSuccess;
      const accountId = storage?.provider_type === "local" ? null
        : hasAuthStatus ? cloudAccountId ?? null : storage?.account_id;
      if (!storage || saved.revision !== storage.revision || saved.accountId !== accountId || (hasAuthStatus && !cloudConnected)) {
        delete session.current.locations[id];
        changed = true;
      }
    }
    if (changed) saveSession();
  }, [providers.isSuccess, providers.data, storageId, oneDriveStatus.isSuccess, cloudAccountId, cloudConnected, saveSession]);

  useEffect(() => {
    if (!activeStorage || localSession === null || restoredLocalSession === localSession) return;
    const saved = session.current.locations[storageId];
    setLocation(saved?.revision === activeStorage.revision && saved.accountId === null
      ? saved.location : { kind: "root" });
    setRestoredLocalSession(localSession);
  }, [activeStorage, storageId, localSession, restoredLocalSession]);

  useEffect(() => {
    if (!activeStorage) return;
    session.current.activeStorageId = storageId;
    saveSession();
  }, [storageId, activeStorage, saveSession]);

  const files = useQuery({
    queryKey: ["files", storageId, activeStorage?.revision, location],
    queryFn: () => fetchStorageFiles(storageId, location),
    enabled: !hasTask && Boolean(activeStorage) && locationReady,
  });
  useEffect(() => {
    if (!activeStorage || !locationReady || !files.isSuccess || files.isFetching || !files.data.location) return;
    // 仅观察当前查询；成功响应使用 Provider 返回的位置，不使用显示路径。
    session.current.locations[storageId] = {
      revision: activeStorage.revision,
      accountId: cloudAccountId ?? null,
      location: files.data.location,
    };
    saveSession();
  }, [activeStorage, storageId, locationReady, cloudAccountId, files.isSuccess, files.isFetching, files.data, saveSession]);
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
    if (nextStorageId === storageId) return;
    setStorageId(nextStorageId);
    setPath("");
    setRestoredCloudSession(null);
    setRestoredLocalSession(null);
  }, [storageId, setPath]);

  const resetWorkspaceSession = useCallback(() => {
    session.current = { version: 1, activeStorageId: "default-local", locations: {} };
    if (!clearWorkspaceSession()) warnSessionUnavailable();
    // 重置必须绕过同连接点击保护，即使当前已在默认 Local 也回到根目录。
    setStorageId("default-local");
    setPath("");
    setRestoredCloudSession(null);
    setRestoredLocalSession(null);
  }, [setPath, warnSessionUnavailable]);

  const restoreDefaultCloudPath = useCallback(() => {
    const saved = session.current.locations[storageId];
    const rememberedLocation = cloudConnected && activeStorage && saved?.revision === activeStorage.revision &&
      saved.accountId === (cloudAccountId ?? null) ? saved.location : undefined;
    const defaultLocation = cloudConnected && cloudAccountId && appSettings.data
      ? readDefaultCloudLocation(appSettings.data.preferences, storageId, cloudAccountId)
      : { kind: "root" } as StorageLocation;
    if (!rememberedLocation && appSettings.isError) notify("无法读取默认路径，将打开云盘根目录。", "warning");
    // 由工作区在原 effect 位置调用；恢复完成前 cloudReady 阻止目录请求。
    setLocation(rememberedLocation ?? defaultLocation);
    setRestoredCloudSession(cloudSession);
  }, [cloudConnected, cloudAccountId, activeStorage, appSettings.data, appSettings.isError, storageId, cloudSession, notify]);

  const setDefaultCloudPath = useCallback(() => {
    if (!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || files.error) return;
    void appSettings.save({ cloud_default_locations: { [storageId]: { account_id: cloudAccountId, location: files.data.location! } } })
      .then(() => notify(`已将“${files.data.path || "根目录"}”设为当前账号的默认路径。`))
      .catch((error: Error) => notify(`默认路径保存失败：${errorMessage(error)}`, "error"));
  }, [cloudAccountId, cloudReady, files.isSuccess, files.isFetching, files.error, files.data, storageId, notify, appSettings.save]);

  const refreshFiles = useCallback(() => {
    if (!locationReady) return;
    void files.refetch().then((result) => {
      if (result.error) notify(`刷新失败：${errorMessage(result.error)}`, "error");
      else notify("目录已刷新。");
    });
  }, [locationReady, files.refetch, notify]);

  // 执行保护与重命名重置仍由工作区协调，Hook 不依赖任务 Store 或重命名 mutation。
  return {
    storageId, location, setLocation, setPath, selectStorage, resetWorkspaceSession, locationReady,
    providers, activeStorage, providerId, providerName, oneDriveStatus, localSettings,
    cloudAccountId, cloudConnected, cloudSession, cloudReady, restoredCloudSession,
    appSettingsReady: appSettings.isSuccess || appSettings.isError,
    files, workspaceKey, settingsLoading, pickLocalRoot,
    restoreDefaultCloudPath, setDefaultCloudPath, refreshFiles,
  };
}

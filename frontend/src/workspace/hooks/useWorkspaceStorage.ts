import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStorageFiles, fetchStorageAuthStatus, fetchStorageProviders, fetchStorages, pickStorageFolder } from "../../api/client";
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
  const [restoredDirectSession, setRestoredDirectSession] = useState<string | null>(null);

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
  const providerId = activeStorage?.provider_type ?? "";
  const providerDefinitions = useQuery({ queryKey: ["storage-providers"], queryFn: fetchStorageProviders });
  const providerDefinition = providerDefinitions.data?.find((entry) => entry.provider_type === providerId);
  const metadataReady = providerDefinitions.isSuccess && Boolean(providerDefinition);
  const requiresAuth = providerDefinition?.browser_auth === true;
  const supportsLocalPicker = metadataReady && providerDefinition?.local_picker === true;
  const supportsLocation = useCallback((value: StorageLocation) =>
    providerDefinition?.locations.includes(value.kind) === true, [providerDefinition]);
  const providerError = providerDefinitions.error ?? (activeStorage && providerDefinitions.isSuccess && !providerDefinition
    ? new Error(`未找到存储服务 ${providerId} 的定义。`) : null);
  const cloudStatus = useQuery({
    queryKey: ["storage-auth", storageId, activeStorage?.revision],
    queryFn: () => fetchStorageAuthStatus(storageId),
    enabled: metadataReady && requiresAuth && Boolean(activeStorage),
  });
  // 保留已知账号身份；元数据刷新失败只暂停读取，不把它误判为账号断开。
  const cloudAccountId = requiresAuth ? cloudStatus.data?.account_id : null;
  const cloudConnected = requiresAuth && cloudStatus.data?.connected === true;
  const cloudSession = cloudConnected ? JSON.stringify([storageId, activeStorage?.revision, cloudAccountId ?? null]) : null;
  const cloudReady = metadataReady && cloudConnected && restoredCloudSession === cloudSession;
  const directSession = providerDefinition?.browser_auth === false && activeStorage
    ? JSON.stringify([storageId, activeStorage.revision]) : null;
  const directReady = directSession !== null && restoredDirectSession === directSession;
  const locationReady = metadataReady && supportsLocation(location) && (directReady || cloudReady);

  useEffect(() => {
    if (!providers.isSuccess || activeStorage) return;
    setStorageId("default-local");
    setPath("");
    setRestoredDirectSession(null);
    setRestoredCloudSession(null);
  }, [providers.isSuccess, activeStorage, setPath]);

  useEffect(() => {
    if (!providers.isSuccess) return;
    let changed = false;
    for (const [id, saved] of Object.entries(session.current.locations)) {
      const storage = providers.data.find((entry) => entry.storage_id === id);
      if (!storage || saved.revision !== storage.revision) {
        delete session.current.locations[id];
        changed = true;
        continue;
      }
      const definition = providerDefinitions.data?.find((entry) => entry.provider_type === storage.provider_type);
      // 元数据未就绪时保留记忆，不能把未知能力当成无需授权。
      if (!providerDefinitions.isSuccess || !definition) continue;
      const hasAuthStatus = id === storageId && definition.browser_auth && cloudStatus.isSuccess;
      const accountId = definition.browser_auth
        ? hasAuthStatus ? cloudAccountId ?? null : storage.account_id : null;
      if (!definition.locations.includes(saved.location.kind) || saved.accountId !== accountId || (hasAuthStatus && !cloudConnected)) {
        delete session.current.locations[id];
        changed = true;
      }
    }
    if (changed) saveSession();
  }, [providers.isSuccess, providers.data, providerDefinitions.isSuccess, providerDefinitions.data,
    storageId, cloudStatus.isSuccess, cloudAccountId, cloudConnected, saveSession]);

  useEffect(() => {
    if (!metadataReady || !activeStorage || directSession === null || restoredDirectSession === directSession) return;
    const saved = session.current.locations[storageId];
    setLocation(saved?.revision === activeStorage.revision && saved.accountId === null && supportsLocation(saved.location)
      ? saved.location : { kind: "root" });
    setRestoredDirectSession(directSession);
  }, [metadataReady, activeStorage, storageId, directSession, restoredDirectSession, supportsLocation]);

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
  const settingsLoading = providers.isPending || providerDefinitions.isPending ||
    (metadataReady && requiresAuth && cloudStatus.isPending);

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
    setRestoredDirectSession(null);
  }, [storageId, setPath]);

  const resetWorkspaceSession = useCallback(() => {
    session.current = { version: 1, activeStorageId: "default-local", locations: {} };
    if (!clearWorkspaceSession()) warnSessionUnavailable();
    // 重置必须绕过同连接点击保护，即使当前已在默认 Local 也回到根目录。
    setStorageId("default-local");
    setPath("");
    setRestoredCloudSession(null);
    setRestoredDirectSession(null);
  }, [setPath, warnSessionUnavailable]);

  const restoreDefaultCloudPath = useCallback(() => {
    if (!metadataReady || !requiresAuth) return;
    const saved = session.current.locations[storageId];
    const rememberedLocation = cloudConnected && activeStorage && saved?.revision === activeStorage.revision &&
      saved.accountId === (cloudAccountId ?? null) && supportsLocation(saved.location) ? saved.location : undefined;
    const defaultLocation = cloudConnected && cloudAccountId && appSettings.data
      ? readDefaultCloudLocation(appSettings.data.preferences, storageId, cloudAccountId)
      : { kind: "root" } as StorageLocation;
    if (!rememberedLocation && appSettings.isError) notify("无法读取默认路径，将打开云盘根目录。", "warning");
    // 由工作区在原 effect 位置调用；恢复完成前 cloudReady 阻止目录请求。
    const restoredLocation = rememberedLocation ?? defaultLocation;
    setLocation(supportsLocation(restoredLocation) ? restoredLocation : { kind: "root" });
    setRestoredCloudSession(cloudSession);
  }, [metadataReady, requiresAuth, supportsLocation, cloudConnected, cloudAccountId, activeStorage,
    appSettings.data, appSettings.isError, storageId, cloudSession, notify]);

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
    providers, activeStorage, providerId, providerName, cloudStatus,
    providerDefinitions, providerDefinition, providerError, metadataReady, requiresAuth, supportsLocalPicker, supportsLocation,
    cloudAccountId, cloudConnected, cloudSession, cloudReady, restoredCloudSession,
    appSettingsReady: appSettings.isSuccess || appSettings.isError,
    files, workspaceKey, settingsLoading, pickLocalRoot,
    restoreDefaultCloudPath, setDefaultCloudPath, refreshFiles,
  };
}

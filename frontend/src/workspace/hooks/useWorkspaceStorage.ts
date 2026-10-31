import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStorageFiles, fetchStorageAuthStatus, fetchStorageProviders, fetchStorages, pickStorageFolder } from "../../api/client";
import { NavigationError, samePersonalAccount, type OneDriveTarget } from "../../integrations/onedrive/navigation";
import { useNotification } from "../../components/NotificationProvider";
import { readDefaultCloudLocation } from "../../features/files/defaultCloudLocation";
import { useAppSettings } from "../../features/settings/useAppSettings";
import type { StorageInfo, StorageLocation } from "../../types";
import { clearWorkspaceSession, readWorkspaceSession, writeWorkspaceSession } from "../workspaceSession";

interface WorkspaceStorageOptions {
  pauseFileQueries: boolean;
  onLocalRootSelected: () => void;
}

interface ExternalNavigation {
  target: OneDriveTarget;
  source?: StorageInfo;
  guard: () => void;
  phase: "checking" | "opening" | "displaying";
  resolve: () => void;
  reject: (error: Error) => void;
}

export function useWorkspaceStorage({ pauseFileQueries, onLocalRootSelected }: WorkspaceStorageOptions) {
  const { t } = useTranslation();
  const notify = useNotification();
  const queryClient = useQueryClient();
  const appSettings = useAppSettings();
  const [initialSession] = useState(readWorkspaceSession);
  const session = useRef(initialSession.session);
  const sessionWarningShown = useRef(false);
  const [storageId, setStorageId] = useState(initialSession.session.activeStorageId);
  const [location, updateLocation] = useState<StorageLocation>({ kind: "root" });
  const external = useRef<ExternalNavigation | null>(null);
  const externalTarget = useRef<OneDriveTarget | null>(null);
  const [externalPending, setExternalPending] = useState(false);
  const [externalFilesKey, setExternalFilesKey] = useState<string | null>(null);
  const cancelExternalNavigation = useCallback(() => {
    const operation = external.current;
    external.current = null;
    externalTarget.current = null;
    setExternalFilesKey(null);
    setExternalPending(false);
    if (operation) operation.reject(new NavigationError("cancelled"));
  }, []);
  const setLocation = useCallback((next: StorageLocation) => {
    cancelExternalNavigation();
    updateLocation(next);
  }, [cancelExternalNavigation]);
  const setPath = useCallback((value: string) => setLocation(value ? { kind: "path", value } : { kind: "root" }), []);
  const [restoredCloudSession, setRestoredCloudSession] = useState<string | null>(null);
  const [restoredDirectSession, setRestoredDirectSession] = useState<string | null>(null);

  const warnSessionUnavailable = useCallback(() => {
    if (sessionWarningShown.current) return;
    sessionWarningShown.current = true;
    notify({ key: "files:notifications.sessionUnavailable" }, "warning");
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
    ? new Error(t("files:workspace.definitionMissing", { provider: providerId })) : null);
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
    if (external.current) return;
    if (!providers.isSuccess || activeStorage) return;
    setStorageId("default-local");
    setPath("");
    setRestoredDirectSession(null);
    setRestoredCloudSession(null);
  }, [providers.isSuccess, activeStorage, setPath, externalPending]);

  useEffect(() => {
    if (external.current) return;
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
    storageId, cloudStatus.isSuccess, cloudAccountId, cloudConnected, saveSession, externalPending]);

  useEffect(() => {
    if (external.current) return;
    if (!metadataReady || !activeStorage || directSession === null || restoredDirectSession === directSession) return;
    const saved = session.current.locations[storageId];
    setLocation(saved?.revision === activeStorage.revision && saved.accountId === null && supportsLocation(saved.location)
      ? saved.location : { kind: "root" });
    setRestoredDirectSession(directSession);
  }, [metadataReady, activeStorage, storageId, directSession, restoredDirectSession, supportsLocation, externalPending]);

  useEffect(() => {
    if (external.current) return;
    if (!activeStorage) return;
    session.current.activeStorageId = storageId;
    saveSession();
  }, [storageId, activeStorage, saveSession, externalPending]);

  const directoryKey = ["files", storageId, activeStorage?.revision, location];
  const files = useQuery({
    // A temporary key forces a real read even when the ordinary directory cache is fresh.
    queryKey: externalFilesKey ? [...directoryKey, externalFilesKey] : directoryKey,
    queryFn: async () => {
      const operation = external.current;
      const target = externalFilesKey ? externalTarget.current :
        operation?.phase !== "checking" ? operation?.target : null;
      const result = await fetchStorageFiles(storageId, location);
      if (target) {
        const { storage, request } = target;
        if (result.storage_id !== storage.storage_id || result.revision !== storage.revision ||
            result.directory_id !== request.folder_id || !result.location ||
            !["root", "id"].includes(result.location.kind)) throw new NavigationError("cancelled");
        if (request.drive_id) {
          if (!result.drive_id) throw new NavigationError("scope_unverified");
          if (result.drive_id !== request.drive_id) throw new NavigationError("unsupported_scope");
        } else if (result.location.kind !== "root") throw new NavigationError("scope_unverified");
      }
      return result;
    },
    ...(externalFilesKey ? { retry: false } : {}),
    ...(externalPending ? { staleTime: Infinity } : {}),
    enabled: !pauseFileQueries && Boolean(activeStorage) && locationReady,
  });
  useEffect(() => {
    if (external.current || externalFilesKey) return;
    if (!activeStorage || !locationReady || !files.isSuccess || files.isFetching || !files.data.location) return;
    // 仅观察当前查询；成功响应使用 Provider 返回的位置，不使用显示路径。
    session.current.locations[storageId] = {
      revision: activeStorage.revision,
      accountId: cloudAccountId ?? null,
      location: files.data.location,
    };
    saveSession();
  }, [activeStorage, storageId, locationReady, cloudAccountId, files.isSuccess, files.isFetching, files.data, saveSession, externalPending, externalFilesKey]);
  const workspaceKey = useMemo(() => JSON.stringify([storageId, activeStorage?.revision, location]), [storageId, activeStorage?.revision, location]);
  const providerName = activeStorage?.name ?? storageId;
  const settingsLoading = providers.isPending || providerDefinitions.isPending ||
    (metadataReady && requiresAuth && cloudStatus.isPending);

  const openExternalTarget = useCallback((target: OneDriveTarget, beforeSwitch: () => void,
    guard: () => void): Promise<void> => {
    if (external.current) return Promise.reject(new NavigationError("busy"));
    const source = activeStorage;
    return new Promise<void>((resolve, reject) => {
      const operation: ExternalNavigation = { target, source, guard, phase: "checking", resolve, reject };
      external.current = operation;
      setExternalPending(true);
      void (async () => {
        try {
          const { storage, request } = target;
          const fresh = await queryClient.fetchQuery({ queryKey: ["storages"],
            queryFn: fetchStorages, staleTime: 0 });
          const current = fresh.find((entry) => entry.storage_id === storage.storage_id);
          const currentSource = fresh.find((entry) => entry.storage_id === source?.storage_id);
          if (external.current !== operation) return;
          if (!current || current.revision !== storage.revision ||
              !samePersonalAccount(current.account_id, request.account_cid) ||
              (source && (currentSource?.revision !== source.revision || currentSource.account_id !== source.account_id))) {
            throw new NavigationError("cancelled");
          }
          if (current.busy || currentSource?.busy) throw new NavigationError("busy");
          const auth = await queryClient.fetchQuery({
            queryKey: ["storage-auth", storage.storage_id, storage.revision],
            queryFn: () => fetchStorageAuthStatus(storage.storage_id), staleTime: 0,
          });
          if (external.current !== operation) return;
          if (!auth.connected) throw new NavigationError("auth_required");
          if (!samePersonalAccount(auth.account_id, request.account_cid)) throw new NavigationError("cancelled");
          const latestTarget = queryClient.getQueryData<StorageInfo[]>(["storages"])
            ?.find((entry) => entry.storage_id === storage.storage_id);
          if (latestTarget?.revision !== storage.revision ||
              !samePersonalAccount(latestTarget.account_id, request.account_cid)) throw new NavigationError("cancelled");
          if (latestTarget.busy) throw new NavigationError("busy");
          const latestSource = queryClient.getQueryData<StorageInfo[]>(["storages"])
            ?.find((entry) => entry.storage_id === source?.storage_id);
          if (source && (latestSource?.revision !== source.revision || latestSource.account_id !== source.account_id)) {
            throw new NavigationError("cancelled");
          }
          guard();
          beforeSwitch();
          operation.phase = "opening";
          externalTarget.current = target;
          // One render installs connection, location and readiness together. Restoration cannot interleave.
          setStorageId(storage.storage_id);
          updateLocation({ kind: "id", value: request.folder_id });
          setRestoredCloudSession(JSON.stringify([storage.storage_id, storage.revision, auth.account_id]));
          setRestoredDirectSession(null);
          setExternalFilesKey(crypto.randomUUID());
        } catch (error) {
          if (external.current !== operation) return;
          external.current = null;
          setExternalPending(false);
          reject(error as Error);
        }
      })();
    });
  }, [activeStorage, queryClient]);

  useEffect(() => {
    const operation = external.current;
    if (!operation) return;
    const { storage, request } = operation.target;
    const current = providers.data?.find((entry) => entry.storage_id === storage.storage_id);
    if (operation.phase === "checking") {
      const source = providers.data?.find((entry) => entry.storage_id === operation.source?.storage_id);
      if (current?.revision !== storage.revision || !samePersonalAccount(current.account_id, request.account_cid) ||
          (operation.source && (source?.revision !== operation.source.revision || source.account_id !== operation.source.account_id))) {
        cancelExternalNavigation();
      }
      return;
    }
    if (!current || current.revision !== storage.revision || current.busy ||
        !samePersonalAccount(current.account_id, request.account_cid) || storageId !== storage.storage_id ||
        !cloudConnected || cloudSession !== restoredCloudSession ||
        !samePersonalAccount(cloudAccountId ?? null, request.account_cid)) {
      cancelExternalNavigation();
      return;
    }
    if (files.isError && !files.isFetching) {
      external.current = null;
      setExternalPending(false);
      operation.reject(files.error);
      return;
    }
    if (!files.isSuccess || files.isFetching || !locationReady) return;
    try { operation.guard(); }
    catch (error) {
      external.current = null;
      setExternalPending(false);
      operation.reject(error as Error);
      return;
    }
    if (externalFilesKey) {
      const canonical = files.data.location!;
      queryClient.setQueryData(["files", storageId, current.revision, canonical], files.data);
      updateLocation(canonical);
      setExternalFilesKey(null);
      operation.phase = "displaying";
      return;
    }
    if (operation.phase === "displaying") {
      if (files.data.storage_id !== storage.storage_id || files.data.revision !== storage.revision ||
          files.data.directory_id !== request.folder_id) {
        cancelExternalNavigation();
        return;
      }
      external.current = null;
      setExternalPending(false);
      operation.resolve();
    }
  }, [providers.data, storageId, cloudConnected, cloudAccountId, cloudSession, restoredCloudSession, files.isError, files.isSuccess,
    files.isFetching, files.data, files.error, locationReady, externalFilesKey, queryClient, cancelExternalNavigation]);

  // A successful manual retry after an external read failure rejoins the ordinary cache/session flow.
  useEffect(() => {
    if (external.current || !externalFilesKey || !files.isSuccess || files.isFetching || !files.data.location) return;
    queryClient.setQueryData(["files", storageId, activeStorage?.revision, files.data.location], files.data);
    updateLocation(files.data.location);
    setExternalFilesKey(null);
  }, [externalFilesKey, files.isSuccess, files.isFetching, files.data, storageId, activeStorage?.revision, queryClient]);

  useEffect(() => () => {
    external.current?.reject(new NavigationError("cancelled"));
    external.current = null;
  }, []);

  const pickLocalRoot = useMutation({
    mutationFn: () => pickStorageFolder(storageId),
    onSuccess: async (settings) => {
      if (!settings.selected) return;
      await queryClient.invalidateQueries({ queryKey: ["storages"] });
      setPath("");
      // 保留原顺序：刷新连接、回到根目录、清理重命名视图，再通知和失效目录。
      onLocalRootSelected();
      notify({ key: "files:notifications.rootSelected" });
      await queryClient.invalidateQueries({ queryKey: ["files", storageId] });
    },
    onError: (error) => notify({ key: "files:notifications.pickFailed", error }, "error"),
  });

  const selectStorage = useCallback((nextStorageId: string) => {
    cancelExternalNavigation();
    if (nextStorageId === storageId) return;
    setStorageId(nextStorageId);
    setPath("");
    setRestoredCloudSession(null);
    setRestoredDirectSession(null);
  }, [storageId, setPath, cancelExternalNavigation]);

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
    if (external.current) return;
    if (!metadataReady || !requiresAuth) return;
    const saved = session.current.locations[storageId];
    const rememberedLocation = cloudConnected && activeStorage && saved?.revision === activeStorage.revision &&
      saved.accountId === (cloudAccountId ?? null) && supportsLocation(saved.location) ? saved.location : undefined;
    const defaultLocation = cloudConnected && cloudAccountId && appSettings.data
      ? readDefaultCloudLocation(appSettings.data.preferences, storageId, cloudAccountId)
      : { kind: "root" } as StorageLocation;
    if (!rememberedLocation && appSettings.isError) notify({ key: "files:notifications.defaultUnavailable" }, "warning");
    // 由工作区在原 effect 位置调用；恢复完成前 cloudReady 阻止目录请求。
    const restoredLocation = rememberedLocation ?? defaultLocation;
    setLocation(supportsLocation(restoredLocation) ? restoredLocation : { kind: "root" });
    setRestoredCloudSession(cloudSession);
  }, [metadataReady, requiresAuth, supportsLocation, cloudConnected, cloudAccountId, activeStorage,
    appSettings.data, appSettings.isError, storageId, cloudSession, notify]);

  const setDefaultCloudPath = useCallback(() => {
    if (!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || files.error) return;
    void appSettings.save({ cloud_default_locations: { [storageId]: { account_id: cloudAccountId, location: files.data.location! } } })
      .then(() => notify(files.data.path ? { key: "files:notifications.defaultSaved", values: { path: files.data.path } } : { key: "files:notifications.defaultRootSaved" }))
      .catch((error: Error) => notify({ key: "files:notifications.defaultSaveFailed", error }, "error"));
  }, [cloudAccountId, cloudReady, files.isSuccess, files.isFetching, files.error, files.data, storageId, notify, appSettings.save]);

  const refreshFiles = useCallback((onRefreshed?: () => void) => {
    if (!locationReady) return;
    void files.refetch().then((result) => {
      if (result.error) notify({ key: "files:notifications.refreshFailed", error: result.error }, "error");
      else {
        onRefreshed?.();
        notify({ key: "files:notifications.refreshed" });
      }
    });
  }, [locationReady, files.refetch, notify]);

  // 执行保护与重命名重置仍由工作区协调，Hook 不依赖任务 Store 或重命名 mutation。
  return {
    openExternalTarget, externalPending, cancelExternalNavigation,
    storageId, location, setLocation, setPath, selectStorage, resetWorkspaceSession, locationReady,
    providers, activeStorage, providerId, providerName, cloudStatus,
    providerDefinitions, providerDefinition, providerError, metadataReady, requiresAuth, supportsLocalPicker, supportsLocation,
    cloudAccountId, cloudConnected, cloudSession, cloudReady, restoredCloudSession,
    appSettingsReady: appSettings.isSuccess || appSettings.isError,
    files, workspaceKey, settingsLoading, pickLocalRoot,
    restoreDefaultCloudPath, setDefaultCloudPath, refreshFiles,
  };
}

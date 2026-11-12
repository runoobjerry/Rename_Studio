import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStorageFiles, fetchStorageAuthStatus, fetchStorageProviders, fetchStorages, pickStorageFolder } from "../../api/client";
import { NavigationError, type ExternalNavigationTarget } from "../../integrations/browser/navigation";
import { useNotification } from "../../components/NotificationProvider";
import { readDefaultCloudLocation } from "../../features/files/defaultCloudLocation";
import { useAppSettings } from "../../features/settings/useAppSettings";
import type { AuthorizationStatus, DirectoryListing, StorageLocation } from "../../types";
import { clearWorkspaceSession, readWorkspaceSession, writeWorkspaceSession } from "../workspaceSession";

interface WorkspaceStorageOptions {
  pauseFileQueries: boolean;
  onLocalRootSelected: () => void;
  directoryVerification?: { storageId: string; location: StorageLocation; onRead: () => void };
}

interface ExternalNavigation {
  target: ExternalNavigationTarget;
  guard: () => void;
  phase: "opening" | "displaying";
  resolve: () => void;
  reject: (error: Error) => void;
}

export function useWorkspaceStorage({ pauseFileQueries, onLocalRootSelected, directoryVerification }: WorkspaceStorageOptions) {
  const { t } = useTranslation();
  const notify = useNotification();
  const queryClient = useQueryClient();
  const appSettings = useAppSettings();
  const [initialSession] = useState(readWorkspaceSession);
  const session = useRef(initialSession.session);
  const sessionWarningShown = useRef(false);
  const [storageId, setStorageId] = useState(initialSession.session.activeStorageId);
  const [{ location, parentLocation }, updateLocation] = useState<{
    location: StorageLocation;
    parentLocation?: StorageLocation;
  }>({ location: { kind: "root" } });
  const external = useRef<ExternalNavigation | null>(null);
  const externalTarget = useRef<ExternalNavigationTarget | null>(null);
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
  const setLocation = useCallback((next: StorageLocation, parent?: StorageLocation) => {
    cancelExternalNavigation();
    updateLocation({ location: next, parentLocation: next.kind === "id" ? parent : undefined });
  }, [cancelExternalNavigation]);
  const setPath = useCallback((value: string) => setLocation(value ? { kind: "path", value } : { kind: "root" }), [setLocation]);
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

  const storages = useQuery({ queryKey: ["storages"], queryFn: fetchStorages, refetchInterval: 3000 });
  const activeStorage = storages.data?.find((storage) => storage.storage_id === storageId);
  const providerType = activeStorage?.provider_type ?? "";
  const providerDefinitions = useQuery({ queryKey: ["storage-providers"], queryFn: fetchStorageProviders });
  const providerDefinition = providerDefinitions.data?.find((entry) => entry.provider_type === providerType);
  const metadataReady = providerDefinitions.isSuccess && Boolean(providerDefinition);
  const requiresAuth = providerDefinition?.browser_auth === true;
  const supportsLocalPicker = metadataReady && providerDefinition?.local_picker === true;
  const supportsLocation = useCallback((value: StorageLocation) =>
    providerDefinition?.locations.includes(value.kind) === true, [providerDefinition]);
  const providerDefinitionError = providerDefinitions.error ?? (activeStorage && providerDefinitions.isSuccess && !providerDefinition
    ? new Error(t("errors:storageServiceInfoUnavailable")) : null);
  const cloudStatus = useQuery({
    queryKey: ["storage-auth", storageId, activeStorage?.revision],
    queryFn: () => fetchStorageAuthStatus(storageId),
    enabled: metadataReady && requiresAuth && Boolean(activeStorage),
    ...(externalPending ? { staleTime: Infinity } : {}),
  });
  // 保留已知账号身份；元数据刷新失败只暂停读取，不把它误判为账号断开。
  const cloudAccountId = requiresAuth ? cloudStatus.data?.account_id : null;
  const cloudAuthorized = requiresAuth && cloudStatus.data?.connected === true;
  const cloudSession = cloudAuthorized ? JSON.stringify([storageId, activeStorage?.revision, cloudAccountId ?? null]) : null;
  const cloudReady = metadataReady && cloudAuthorized && restoredCloudSession === cloudSession;
  const directSession = providerDefinition?.browser_auth === false && activeStorage
    ? JSON.stringify([storageId, activeStorage.revision]) : null;
  const directReady = directSession !== null && restoredDirectSession === directSession;
  const locationReady = metadataReady && supportsLocation(location) && (directReady || cloudReady);

  useEffect(() => {
    if (external.current) return;
    if (!storages.isSuccess || activeStorage) return;
    setStorageId("default-local");
    setPath("");
    setRestoredDirectSession(null);
    setRestoredCloudSession(null);
  }, [storages.isSuccess, activeStorage, setPath, externalPending]);

  useEffect(() => {
    if (external.current) return;
    if (!storages.isSuccess) return;
    let changed = false;
    for (const [id, saved] of Object.entries(session.current.locations)) {
      const storage = storages.data.find((entry) => entry.storage_id === id);
      if (!storage || saved.revision !== storage.revision) {
        delete session.current.locations[id];
        changed = true;
        continue;
      }
      const savedProviderDefinition = providerDefinitions.data?.find((entry) => entry.provider_type === storage.provider_type);
      // 元数据未就绪时保留记忆，不能把未知能力当成无需授权。
      if (!providerDefinitions.isSuccess || !savedProviderDefinition) continue;
      const hasAuthStatus = id === storageId && savedProviderDefinition.browser_auth && cloudStatus.isSuccess;
      const accountId = savedProviderDefinition.browser_auth
        ? hasAuthStatus ? cloudAccountId ?? null : storage.account_id : null;
      if (!savedProviderDefinition.locations.includes(saved.location.kind) || saved.accountId !== accountId || (hasAuthStatus && !cloudAuthorized)) {
        delete session.current.locations[id];
        changed = true;
      }
    }
    if (changed) saveSession();
  }, [storages.isSuccess, storages.data, providerDefinitions.isSuccess, providerDefinitions.data,
    storageId, cloudStatus.isSuccess, cloudAccountId, cloudAuthorized, saveSession, externalPending]);

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

  const directoryKey = useMemo(() => {
    const key = ["files", storageId, activeStorage?.revision, location];
    return externalFilesKey ? [...key, externalFilesKey] : key;
  }, [storageId, activeStorage?.revision, location, externalFilesKey]);
  const manualRefresh = useRef<{ key: string } | null>(null);
  const files = useQuery({
    // External navigation keeps its response separate until it passes the target checks.
    queryKey: directoryKey,
    queryFn: async (context) => {
      const verify = directoryVerification?.storageId === storageId &&
        JSON.stringify(directoryVerification.location) === JSON.stringify(location);
      const refresh = verify || manualRefresh.current?.key === JSON.stringify(context.queryKey);
      const signal = refresh ? context.signal : undefined;
      // Only the dedicated external read belongs to this target; ordinary queries may still finish for the previous file source.
      const target = externalFilesKey ? externalTarget.current : null;
      const result = refresh ? await fetchStorageFiles(storageId, location, true)
        : externalFilesKey !== null ? await fetchStorageFiles(storageId, location, true, undefined, true)
        : parentLocation ? await fetchStorageFiles(storageId, location, false, parentLocation)
        : await fetchStorageFiles(storageId, location);
      if (target) {
        const { storage } = target;
        if (result.storage_id !== storage.storage_id || result.revision !== storage.revision ||
            !result.location || !["root", "id"].includes(result.location.kind)) throw new NavigationError("cancelled");
        target.validateListing(result);
      }
      if (refresh && !signal?.aborted && result.breadcrumbs &&
          result.storage_id === storageId && result.revision === activeStorage?.revision) {
        const live = new Map(result.breadcrumbs.map((crumb, index, chain) => [JSON.stringify(crumb.location), {
          name: crumb.name, parent: JSON.stringify(chain[index - 1]?.location),
        }]));
        const children = new Map(result.items.map((item) => [item.id, item]));
        const scope = { queryKey: ["files", storageId, result.revision] };
        const changed = queryClient.getQueriesData<DirectoryListing>(scope).some(([, cached]) => {
          const childChanged = cached && JSON.stringify(cached.location) === JSON.stringify(result.location) &&
            cached.items.some((item) => {
              if (!item.is_directory) return false;
              const current = children.get(item.id);
              return !current || !current.is_directory || current.name !== item.name;
            });
          return childChanged || cached?.breadcrumbs?.some((crumb, index, chain) => {
            const current = live.get(JSON.stringify(crumb.location));
            return current && (current.name !== crumb.name || current.parent !== JSON.stringify(chain[index - 1]?.location));
          });
        });
        if (changed) {
          // Removing old directory queries also cancels their pending responses.
          // Keep this refresh, which is about to publish the authoritative listing.
          queryClient.removeQueries({ ...scope,
            predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(context.queryKey),
          });
        }
      }
      if (verify && !signal?.aborted && result.storage_id === storageId && result.revision === activeStorage?.revision) {
        directoryVerification.onRead();
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
  const storageName = activeStorage?.name ?? storageId;
  const settingsLoading = storages.isPending || providerDefinitions.isPending ||
    (metadataReady && requiresAuth && cloudStatus.isPending);

  const openExternalTarget = useCallback((target: ExternalNavigationTarget, beforeSwitch: () => void,
    guard: () => void): Promise<void> => {
    // Reserve the operation synchronously, before the caller emits accepted.
    if (external.current) throw new NavigationError("busy");
    const { storage } = target;
    const auth = queryClient.getQueryData<AuthorizationStatus>(["storage-auth", storage.storage_id, storage.revision]);
    if (auth && !auth.connected) throw new NavigationError("auth_required");
    if (auth && !target.matchesAccount(auth.account_id)) throw new NavigationError("cancelled");
    return new Promise<void>((resolve, reject) => {
      external.current = { target, guard, phase: "opening", resolve, reject };
      externalTarget.current = target;
      setExternalPending(true);
      // Ordinary auth query initializes status only when this file source has no cached status.
      setStorageId(storage.storage_id);
      updateLocation({ location: target.location });
      setRestoredCloudSession(JSON.stringify([storage.storage_id, storage.revision, auth?.account_id ?? storage.account_id]));
      setRestoredDirectSession(null);
      setExternalFilesKey(crypto.randomUUID());
      // Resetting the task resumes directory queries via the Store. Install the destination first
      // so a synchronous Store render cannot resume the old directory under the new navigation.
      beforeSwitch();
    });
  }, [queryClient]);

  useEffect(() => {
    // A task reset can flush effects from the source render before the destination state commits.
    // Those effects must not validate the newly reserved request against the old workspace.
    if (!externalPending) return;
    const operation = external.current;
    if (!operation) return;
    const { storage } = operation.target;
    const current = storages.data?.find((entry) => entry.storage_id === storage.storage_id);
    if (!current || current.revision !== storage.revision || current.busy ||
        !operation.target.matchesAccount(current.account_id) || storageId !== storage.storage_id) {
      cancelExternalNavigation();
      return;
    }
    if (cloudStatus.isPending) return;
    if (!cloudAuthorized) {
      external.current = null;
      setExternalPending(false);
      operation.reject(cloudStatus.error ?? new NavigationError("auth_required"));
      return;
    }
    if (cloudSession !== restoredCloudSession) {
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
      updateLocation({ location: canonical });
      setExternalFilesKey(null);
      operation.phase = "displaying";
      return;
    }
    if (operation.phase === "displaying") {
      external.current = null;
      setExternalPending(false);
      operation.resolve();
    }
  }, [externalPending, storages.data, storageId, cloudAuthorized, cloudStatus.isPending, cloudStatus.data, cloudStatus.error, cloudSession, restoredCloudSession, files.isError, files.isSuccess,
    files.isFetching, files.data, files.error, locationReady, externalFilesKey, queryClient, cancelExternalNavigation]);

  // A successful manual retry after an external read failure rejoins the ordinary cache/session flow.
  useEffect(() => {
    if (external.current || !externalFilesKey || !files.isSuccess || files.isFetching || !files.data.location) return;
    queryClient.setQueryData(["files", storageId, activeStorage?.revision, files.data.location], files.data);
    updateLocation({ location: files.data.location });
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
      // 保留原顺序：刷新文件来源、回到根目录、清理重命名视图，再通知和失效目录。
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
    // 重置必须绕过同一文件来源的切换保护，即使当前已在默认 Local 也回到根目录。
    setStorageId("default-local");
    setPath("");
    setRestoredCloudSession(null);
    setRestoredDirectSession(null);
  }, [setPath, warnSessionUnavailable]);

  const restoreDefaultCloudPath = useCallback(() => {
    if (external.current) return;
    if (!metadataReady || !requiresAuth) return;
    const saved = session.current.locations[storageId];
    const rememberedLocation = cloudAuthorized && activeStorage && saved?.revision === activeStorage.revision &&
      saved.accountId === (cloudAccountId ?? null) && supportsLocation(saved.location) ? saved.location : undefined;
    const defaultLocation = cloudAuthorized && cloudAccountId && appSettings.data
      ? readDefaultCloudLocation(appSettings.data.preferences, storageId, cloudAccountId)
      : { kind: "root" } as StorageLocation;
    if (!rememberedLocation && appSettings.isError) notify({ key: "files:notifications.defaultUnavailable" }, "warning");
    // 由工作区在原 effect 位置调用；恢复完成前 cloudReady 阻止目录请求。
    const restoredLocation = rememberedLocation ?? defaultLocation;
    setLocation(supportsLocation(restoredLocation) ? restoredLocation : { kind: "root" });
    setRestoredCloudSession(cloudSession);
  }, [metadataReady, requiresAuth, supportsLocation, cloudAuthorized, cloudAccountId, activeStorage,
    appSettings.data, appSettings.isError, storageId, cloudSession, notify]);

  const setDefaultCloudPath = useCallback(() => {
    if (!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || files.error) return;
    void appSettings.save({ cloud_default_locations: { [storageId]: { account_id: cloudAccountId, location: files.data.location! } } })
      .then(() => notify(files.data.path ? { key: "files:notifications.defaultSaved", values: { path: files.data.path } } : { key: "files:notifications.defaultRootSaved" }))
      .catch((error: Error) => notify({ key: "files:notifications.defaultSaveFailed", error, errorContext: "settings" }, "error"));
  }, [cloudAccountId, cloudReady, files.isSuccess, files.isFetching, files.error, files.data, storageId, notify, appSettings.save]);

  const refreshFiles = useCallback(() => {
    if (!locationReady) return;
    // refetch alone can join an initial request that has no data yet. Cancel that
    // request first, and keep the refresh intent for any retries of this refetch.
    void queryClient.cancelQueries({ queryKey: directoryKey, exact: true });
    const operation = { key: JSON.stringify(directoryKey) };
    manualRefresh.current = operation;
    void files.refetch().then((result) => {
      if (manualRefresh.current !== operation) return;
      manualRefresh.current = null;
      if (result.error) notify({ key: "files:notifications.refreshFailed", error: result.error, errorContext: "directory" }, "error");
      else notify({ key: "files:notifications.refreshed" });
    });
  }, [locationReady, queryClient, directoryKey, files.refetch, notify]);

  // 执行保护与重命名重置仍由工作区协调，Hook 不依赖任务 Store 或重命名 mutation。
  return {
    openExternalTarget, externalPending, cancelExternalNavigation,
    storageId, location, setLocation, setPath, selectStorage, resetWorkspaceSession, locationReady,
    storages, activeStorage, providerType, storageName, cloudStatus,
    providerDefinitions, providerDefinition, providerDefinitionError, metadataReady, requiresAuth, supportsLocalPicker, supportsLocation,
    cloudAccountId, cloudAuthorized, cloudSession, cloudReady, restoredCloudSession,
    appSettingsReady: appSettings.isSuccess || appSettings.isError,
    files, workspaceKey, settingsLoading, pickLocalRoot,
    restoreDefaultCloudPath, setDefaultCloudPath, refreshFiles,
  };
}

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  CssBaseline,
  Drawer,
  LinearProgress,
  Skeleton,
  ThemeProvider,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";

import { fetchRules } from "./api/client";
import { BatchLimitDialog } from "./workspace/components/BatchLimitDialog";
import { StorageSidebar } from "./workspace/components/StorageSidebar";
import { StorageLocationPanel } from "./workspace/components/StorageLocationPanel";
import { useWorkspaceStorage } from "./workspace/hooks/useWorkspaceStorage";
import { FileBrowser } from "./features/files/FileBrowser";
import { useRenameWorkflow } from "./features/rename/useRenameWorkflow";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RenameActionsWithProgress } from "./features/rename/RenameActionsWithProgress";
import { RuleEditor } from "./features/rules/RuleEditor";
import { useRenameStore } from "./stores/useRenameStore";
import { createAppTheme } from "./theme";
import { useThemePreference } from "./features/settings/useThemePreference";
import { useFactoryReset } from "./workspace/hooks/useFactoryReset";
import type { ThemePreference } from "./features/settings/useThemePreference";
import { NotificationProvider, errorMessage, useNotification } from "./components/NotificationProvider";

const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

import type { StorageLocation } from "./types";

type AppView = "workspace" | "settings";

const drawerWidth = 244;

function SecondaryPageFallback() {
  return (
    <Box sx={{ display: "grid", minHeight: 240, placeItems: "center" }}>
      <CircularProgress size={28} aria-label="正在加载页面" />
    </Box>
  );
}

export default function WorkspaceApp() {
  const { mode, preference, setPreference, settingsError } = useThemePreference();
  const theme = useMemo(() => createAppTheme(mode), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <NotificationProvider><Workspace preference={preference} setPreference={setPreference} settingsError={settingsError} /></NotificationProvider>
    </ThemeProvider>
  );
}

function Workspace({ preference, setPreference, settingsError }: {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => Promise<void>;
  settingsError: Error | null;
}) {
  const notify = useNotification();
  useEffect(() => {
    if (settingsError) notify(`读取应用设置失败，暂用默认偏好：${errorMessage(settingsError)}`, "warning");
  }, [settingsError, notify]);
  const changeTheme = (next: ThemePreference) => {
    void setPreference(next).catch((error: Error) => notify(`主题保存失败，已撤销本次更改：${errorMessage(error)}`, "error"));
  };
  const theme = useTheme();
  const compactNavigation = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [view, setView] = useState<AppView>("workspace");
  // 任务订阅留在容器以暂停存储自动查询；两个业务 Hook 不互相调用。
  const task = useRenameStore((state) => state.task);
  const {
    storageId, location, setLocation, setPath, selectStorage,
    providers, activeStorage, providerId, providerName, oneDriveStatus, localSettings,
    cloudAccountId, cloudConnected, cloudSession, cloudReady, restoredCloudSession, appSettingsReady,
    files, workspaceKey, settingsLoading, pickLocalRoot,
    restoreDefaultCloudPath, setDefaultCloudPath, refreshFiles,
  } = useWorkspaceStorage({
    hasTask: Boolean(task),
    // 选择器异步完成时才调用，工作流已经在当前 render 中初始化。
    onLocalRootSelected: () => resetForStorageChange(),
  });
  const definitions = useQuery({ queryKey: ["rules"], queryFn: fetchRules });
  const {
    selectedIds, rules, browserTask, taskCurrent, selectedCount,
    previewData, executionData, previewError, executeError, executionPreviewId,
    isPreviewing, isExecuting, hasExecuted,
    batchHintOpen, skipBatchHint, closeBatchHint, changeBatchHintPreference, continueBatchPreview,
    requestPreview, executeRename, onRulesChange,
    reconcileSelection, endTask, toggleFile, selectAllFiles, clearFiles, invertFiles,
    resetForStorageChange,
  } = useRenameWorkflow({
    storageId, location, workspaceKey, cloudSession, providerId, cloudReady, task,
    activeStorage: activeStorage && { revision: activeStorage.revision, busy: activeStorage.busy },
    files: {
      data: files.data, isSuccess: files.isSuccess, isFetching: files.isFetching,
      error: files.error, dataUpdatedAt: files.dataUpdatedAt,
    },
  });
  useEffect(() => {
    if (isExecuting || providerId !== "onedrive" || !appSettingsReady || restoredCloudSession === cloudSession) return;
    restoreDefaultCloudPath();
    resetForStorageChange();
  }, [providerId, cloudSession, restoredCloudSession, appSettingsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadError = providers.error ?? definitions.error ?? oneDriveStatus.error ?? localSettings.error;
  const { factoryReset, resetDisabledReason, resetPending, resetEpoch } = useFactoryReset({
    task, isExecuting, isPreviewing,
    storageBusy: providers.data?.some((storage) => storage.busy) ?? false,
    endTask, selectStorage,
  });

  const navigate = useCallback((nextPath: string) => {
    if (isExecuting || pickLocalRoot.isPending || activeStorage?.busy) return;
    setPath(nextPath);
  }, [isExecuting, pickLocalRoot.isPending, activeStorage?.busy, setPath]);

  const navigateLocation = useCallback((next: StorageLocation) => {
    if (isExecuting || pickLocalRoot.isPending || activeStorage?.busy) return;
    setLocation(next);
  }, [isExecuting, pickLocalRoot.isPending, activeStorage?.busy]);

  const selectProvider = (nextProviderId: string) => {
    if (isExecuting || pickLocalRoot.isPending) return;
    selectStorage(nextProviderId);
    setView("workspace");
    setMobileNavOpen(false);
  };

  return (
    <>
      <CssBaseline />
      <BatchLimitDialog
        open={batchHintOpen}
        checked={skipBatchHint}
        onClose={closeBatchHint}
        onCheckedChange={changeBatchHintPreference}
        onContinue={continueBatchPreview}
      />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <Drawer
          variant={compactNavigation ? "temporary" : "permanent"}
          open={compactNavigation ? mobileNavOpen : true}
          onClose={() => setMobileNavOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: `calc(${drawerWidth}px - 16px)`,
              height: "calc(100% - 16px)",
              m: 1,
              border: 1,
              borderColor: "divider",
              borderRadius: "14px",
              boxSizing: "border-box",
              overflow: "hidden",
            },
          }}
        >
          <StorageSidebar
            storages={providers.data ?? []}
            isLoading={providers.isPending}
            disabled={isExecuting || pickLocalRoot.isPending}
            view={view}
            storageId={storageId}
            onSelectStorage={selectProvider}
            onOpenSettings={() => {
              setView("settings");
              setMobileNavOpen(false);
            }}
          />
        </Drawer>

        <Box
          component="main"
          className="app-main"
          sx={{ ml: compactNavigation ? 0 : `${drawerWidth - 8}px`, minHeight: "100vh" }}
        >
          <Box
            className={view === "workspace" ? "workspace-page" : undefined}
            sx={{ width: "100%", maxWidth: 1680, mx: "auto", p: 1.5 }}
          >
            {loadError && <Alert severity="error" sx={{ mb: 2 }}>无法连接后端：{loadError.message}</Alert>}
            {(providers.isPending || definitions.isPending) && (
              <LinearProgress aria-label="正在加载工作台配置" sx={{ flexShrink: 0, mb: 1 }} />
            )}

            {view === "settings" && (
              <Suspense fallback={<SecondaryPageFallback />}>
                <SettingsPage executingStorageId={isExecuting ? storageId : undefined} preference={preference}
                  onPreferenceChange={changeTheme} onBack={() => setView("workspace")}
                  onFactoryReset={factoryReset} resetDisabledReason={resetDisabledReason} resetPending={resetPending}
                  resetEpoch={resetEpoch} />
              </Suspense>
            )}

            {view === "workspace" && (
              <>
                <StorageLocationPanel
                  compactNavigation={compactNavigation}
                  listing={providerId === "local" || cloudReady ? files.data : undefined}
                  rootLabel={providerName}
                  providerId={providerId}
                  navigationDisabled={!activeStorage || isExecuting || pickLocalRoot.isPending || activeStorage.busy || (providerId === "onedrive" && !cloudReady)}
                  defaultPathDisabled={!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || Boolean(files.error) || oneDriveStatus.isError}
                  browseDisabled={!activeStorage || pickLocalRoot.isPending || isExecuting || activeStorage.busy}
                  isPickingFolder={pickLocalRoot.isPending}
                  storageMissing={!activeStorage && !providers.isPending}
                  accountIdMissing={cloudConnected && !cloudAccountId}
                  pickerError={pickLocalRoot.error}
                  cloudDisconnected={oneDriveStatus.isSuccess && !oneDriveStatus.data.connected}
                  onOpenNavigation={() => setMobileNavOpen(true)}
                  onNavigate={navigateLocation}
                  onSetDefaultPath={setDefaultCloudPath}
                  onBrowse={() => pickLocalRoot.mutate()}
                />

                <div className="workspace-grid">
                  <div className="workspace-primary">
                    {files.data && (providerId === "local" || cloudReady) ? (
                      <FileBrowser
                        onNavigateLocation={navigateLocation}
                        listing={files.data}
                        providerName={providerName}
                        selectedIds={selectedIds}
                        task={browserTask}
                        taskCurrent={taskCurrent}
                        disabled={isExecuting || isPreviewing || files.isFetching || Boolean(activeStorage?.busy)}
                        onReconcileSelection={reconcileSelection}
                        onEndTask={endTask}
                        isRefreshing={files.isFetching}
                        refreshError={files.error?.message}
                        onNavigate={navigate}
                        onRefresh={refreshFiles}
                        onToggle={toggleFile}
                        onSelectAll={selectAllFiles}
                        onClearSelection={clearFiles}
                        onInvertSelection={invertFiles}
                      />
                    ) : (
                      <section className="panel">
                        {files.error ? (
                          <Alert severity="error" sx={{ m: 2 }}>
                            目录读取失败：{files.error.message}
                          </Alert>
                        ) : (
                          settingsLoading || files.isFetching ? (
                            <Box sx={{ p: 2 }} aria-busy="true">
                              <Typography role="status" variant="body2" sx={{ mb: 1 }}>
                                {settingsLoading ? "正在读取存储设置…" : "正在读取目录…"}
                              </Typography>
                              {[0, 1, 2, 3].map((row) => <Skeleton key={row} height={38} />)}
                            </Box>
                          ) : (
                            <p className="empty-state">
                              {providerId === "onedrive" && oneDriveStatus.isSuccess && !oneDriveStatus.data.connected
                                ? "连接 OneDrive 后可浏览云端目录。"
                                : "目录暂不可用，请检查存储设置。"}
                            </p>
                          )
                        )}
                      </section>
                    )}
                    <PreviewPanel
                      preview={previewData}
                      execution={executionData}
                      providerName={providerName}
                      error={previewError}
                      executeError={executeError}
                    />
                  </div>
                  <div className="workspace-rules">
                    <RuleEditor
                      definitions={definitions.data ?? []}
                      isLoading={definitions.isPending}
                      rules={rules}
                      onChange={onRulesChange}
                    />
                    <RenameActionsWithProgress
                      preview={previewData}
                      providerName={providerName}
                      selectedCount={selectedCount}
                      isPreviewing={isPreviewing}
                      isExecuting={isExecuting}
                      isBlocked={pickLocalRoot.isPending || !activeStorage || activeStorage.busy || files.isFetching || Boolean(files.error)}
                      hasExecuted={hasExecuted}
                      allowUnchangedBatch={taskCurrent}
                      executionPreviewId={executionPreviewId}
                      executeError={executeError}
                      onPreview={requestPreview}
                      onExecute={executeRename}
                    />
                  </div>
                </div>
              </>
            )}
          </Box>
        </Box>
      </Box>
    </>
  );
}

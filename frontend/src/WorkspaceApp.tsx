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
import { useTranslation } from "react-i18next";
import { LanguageProvider, useLanguagePreference } from "./i18n/LanguageProvider";

import { fetchRules } from "./api/client";
import { SingleRenameDialog } from "./features/rename/SingleRenameDialog";
import { StorageSidebar } from "./workspace/components/StorageSidebar";
import { StorageLocationPanel } from "./workspace/components/StorageLocationPanel";
import { useWorkspaceStorage } from "./workspace/hooks/useWorkspaceStorage";
import { FileBrowser } from "./features/files/FileBrowser";
import { defaultFileSort, type FileSort } from "./features/files/fileSort";
import { useRenameWorkflow } from "./features/rename/useRenameWorkflow";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RenameActionsWithProgress } from "./features/rename/RenameActionsWithProgress";
import { RuleEditor } from "./features/rules/RuleEditor";
import { useRenameStore } from "./stores/useRenameStore";
import { createAppTheme } from "./theme";
import { useThemePreference } from "./features/settings/useThemePreference";
import { settingsFailureMessage } from "./features/settings/settingsMessages";
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
  const { t } = useTranslation();
  return (
    <Box sx={{ display: "grid", minHeight: 240, placeItems: "center" }}>
      <CircularProgress size={28} aria-label={t("loadingPage")} />
    </Box>
  );
}

export default function WorkspaceApp() {
  return <LanguageProvider><ThemedWorkspace /></LanguageProvider>;
}

function ThemedWorkspace() {
  const { locale } = useLanguagePreference();
  const { mode, preference, setPreference, settingsError, hasSettings } = useThemePreference();
  const theme = useMemo(() => createAppTheme(mode, locale), [mode, locale]);
  return (
    <ThemeProvider theme={theme}>
      <NotificationProvider><Workspace preference={preference} setPreference={setPreference} settingsError={settingsError} hasSettings={hasSettings} /></NotificationProvider>
    </ThemeProvider>
  );
}

function Workspace({ preference, setPreference, settingsError, hasSettings }: {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => Promise<void>;
  settingsError: Error | null;
  hasSettings: boolean;
}) {
  const { t } = useTranslation();
  const notify = useNotification();
  const { failedLanguage } = useLanguagePreference();
  useEffect(() => {
    if (failedLanguage) notify({ key: "settings:languageLoadFailed", values: { code: failedLanguage } }, "warning");
  }, [failedLanguage, notify]);
  useEffect(() => {
    if (settingsError) notify({ key: hasSettings ? "settings:readFailedCached" : "settings:readFailed" }, "warning");
  }, [settingsError, hasSettings, notify]);
  const changeTheme = (next: ThemePreference) => {
    void setPreference(next).catch((error: Error) => notify(settingsFailureMessage(error, "theme"), "error"));
  };
  const theme = useTheme();
  const compactNavigation = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [view, setView] = useState<AppView>("workspace");
  const [fileSort, setFileSort] = useState<FileSort>(defaultFileSort);
  const previewActive = useRenameStore((state) => state.previewActive);
  const unknownExecution = useRenameStore((state) => state.unknownExecution);
  const {
    storageId, location, setLocation, setPath, selectStorage, resetWorkspaceSession, locationReady,
    providers, activeStorage, providerId, providerName, cloudStatus,
    providerDefinitions, providerDefinition, providerError, metadataReady, requiresAuth, supportsLocalPicker, supportsLocation,
    cloudAccountId, cloudConnected, cloudSession, cloudReady, restoredCloudSession, appSettingsReady,
    files, workspaceKey, settingsLoading, pickLocalRoot,
    restoreDefaultCloudPath, setDefaultCloudPath, refreshFiles,
  } = useWorkspaceStorage({
    pauseFileQueries: previewActive,
    // 选择器异步完成时才调用，工作流已经在当前 render 中初始化。
    onLocalRootSelected: () => resetForStorageChange(),
  });
  const definitions = useQuery({ queryKey: ["rules"], queryFn: fetchRules });
  const {
    selectedIds, rules, browserItems, currentTask, changeSort, selectedCount,
    previewData, executionData, previewError, executeError, revalidationError, executionPreviewId,
    isPreviewing, isExecuting, hasExecuted,
    singleRenameTarget, singleRenameError, canSingleRename, isSingleRenaming,
    openSingleRename, closeSingleRename, applySingleRename,
    requestPreview, executeRename, onRulesChange,
    resetOperation, endTask, toggleFile, selectAllFiles, clearFiles, invertFiles,
    resetForStorageChange, onDirectoryRefreshed,
  } = useRenameWorkflow({
    storageId, location, workspaceKey, cloudSession, locationReady,
    canRename: metadataReady && providerDefinition?.can_rename === true && !pickLocalRoot.isPending,
    sort: fileSort, onSortChange: setFileSort,
    activeStorage: activeStorage && { revision: activeStorage.revision, busy: activeStorage.busy },
    files: {
      data: files.data, isSuccess: files.isSuccess, isFetching: files.isFetching,
      error: files.error, dataUpdatedAt: files.dataUpdatedAt,
    },
  });
  useEffect(() => {
    if (isExecuting || !metadataReady || !requiresAuth || !appSettingsReady || restoredCloudSession === cloudSession) return;
    restoreDefaultCloudPath();
    resetForStorageChange();
  }, [isExecuting, metadataReady, requiresAuth, cloudSession, restoredCloudSession, appSettingsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshDirectory = () => {
    const unknown = useRenameStore.getState().unknownExecution;
    refreshFiles(() => {
      // 迟到的目录刷新不能清除之后才产生的待核对记录。
      if (unknown && useRenameStore.getState().unknownExecution === unknown) onDirectoryRefreshed();
    });
  };

  const loadError = providers.error ?? providerError ?? definitions.error ?? (requiresAuth ? cloudStatus.error : null);
  const { factoryReset, resetDisabledReason, resetPending, resetEpoch } = useFactoryReset({
    hasUnknownOutcome: Boolean(unknownExecution), isExecuting, isPreviewing,
    storageBusy: providers.data?.some((storage) => storage.busy) ?? false,
    resetOperation, resetWorkspaceSession,
  });

  const navigate = useCallback((nextPath: string) => {
    if (!locationReady || !supportsLocation(nextPath ? { kind: "path", value: nextPath } : { kind: "root" }) ||
      isExecuting || pickLocalRoot.isPending || activeStorage?.busy) return;
    setPath(nextPath);
  }, [locationReady, supportsLocation, isExecuting, pickLocalRoot.isPending, activeStorage?.busy, setPath]);

  const navigateLocation = useCallback((next: StorageLocation) => {
    if (!locationReady || !supportsLocation(next) || isExecuting || pickLocalRoot.isPending || activeStorage?.busy) return;
    setLocation(next);
  }, [locationReady, supportsLocation, isExecuting, pickLocalRoot.isPending, activeStorage?.busy, setLocation]);

  const renameBlocked = !locationReady || pickLocalRoot.isPending || !activeStorage || activeStorage.busy || files.isFetching || Boolean(files.error);
  const selectProvider = (nextProviderId: string) => {
    if (isExecuting || pickLocalRoot.isPending) return;
    selectStorage(nextProviderId);
    setView("workspace");
    setMobileNavOpen(false);
  };

  return (
    <>
      <CssBaseline />
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
            providerDefinitions={providerDefinitions.data ?? []}
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
            {loadError && <Alert severity="error" sx={{ mb: 2 }}>{t("files:workspace.loadFailed", { message: errorMessage(loadError, t) })}</Alert>}
            {(providers.isPending || providerDefinitions.isPending || definitions.isPending) && (
              <LinearProgress aria-label={t("files:workspace.loading")} sx={{ flexShrink: 0, mb: 1 }} />
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
                  listing={locationReady ? files.data : undefined}
                  rootLabel={providerName}
                  serviceName={t(`providers:${providerId}.name`, { defaultValue: providerId })}
                  requiresAuth={metadataReady && requiresAuth}
                  supportsLocalPicker={supportsLocalPicker}
                  navigationDisabled={!locationReady || !activeStorage || isExecuting || pickLocalRoot.isPending || activeStorage.busy}
                  defaultPathDisabled={!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || Boolean(files.error) || cloudStatus.isError}
                  browseDisabled={!activeStorage || pickLocalRoot.isPending || isExecuting || activeStorage.busy}
                  isPickingFolder={pickLocalRoot.isPending}
                  storageMissing={!activeStorage && !providers.isPending}
                  pickerError={pickLocalRoot.error}
                  cloudDisconnected={metadataReady && requiresAuth && cloudStatus.isSuccess && !cloudStatus.data.connected}
                  onOpenNavigation={() => setMobileNavOpen(true)}
                  onNavigate={navigateLocation}
                  onSetDefaultPath={setDefaultCloudPath}
                  onBrowse={() => pickLocalRoot.mutate()}
                />

                <div className="workspace-grid">
                  <div className="workspace-primary">
                    {files.data && locationReady ? (
                      <FileBrowser
                        onNavigateLocation={navigateLocation}
                        listing={files.data}
                        items={browserItems}
                        hasTask={Boolean(currentTask)}
                        onEndTask={endTask}
                        onRename={openSingleRename}
                        renameDisabled={!canSingleRename}
                        sort={fileSort}
                        onSortChange={changeSort}
                        providerName={providerName}
                        selectedIds={selectedIds}
                        disabled={isExecuting || isPreviewing || files.isFetching || Boolean(activeStorage?.busy)}
                        isRefreshing={files.isFetching}
                        refreshError={files.error ? errorMessage(files.error, t) : undefined}
                        onNavigate={navigate}
                        onRefresh={refreshDirectory}
                        onToggle={toggleFile}
                        onSelectAll={selectAllFiles}
                        onClearSelection={clearFiles}
                        onInvertSelection={invertFiles}
                      />
                    ) : (
                      <section className="panel">
                        {files.error ? (
                          <Alert severity="error" sx={{ m: 2 }}>
                            {t("files:workspace.directoryFailed", { message: errorMessage(files.error, t) })}
                          </Alert>
                        ) : (
                          settingsLoading || files.isFetching ? (
                            <Box sx={{ p: 2 }} aria-busy="true">
                              <Typography role="status" variant="body2" sx={{ mb: 1 }}>
                                {settingsLoading ? t("files:workspace.loadingSettings") : t("files:workspace.loadingDirectory")}
                              </Typography>
                              {[0, 1, 2, 3].map((row) => <Skeleton key={row} height={38} />)}
                            </Box>
                          ) : (
                            <p className="empty-state">
                              {metadataReady && requiresAuth && cloudStatus.isSuccess && !cloudStatus.data.connected
                                ? t("files:workspace.connectToBrowse", { service: t(`providers:${providerId}.name`, { defaultValue: providerId }) })
                                : t("files:workspace.unavailable")}
                            </p>
                          )
                        )}
                      </section>
                    )}
                    <PreviewPanel
                      preview={previewData}
                      execution={executionData}
                      unknownExecution={unknownExecution}
                      providerName={providerName}
                      error={previewError}
                      executeError={revalidationError ? undefined : executeError}
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
                      hasUnknownOutcome={Boolean(unknownExecution)}
                      preview={previewData}
                      providerName={providerName}
                      selectedCount={selectedCount}
                      isPreviewing={isPreviewing}
                      isExecuting={isExecuting}
                      isBlocked={Boolean(unknownExecution) || renameBlocked}
                      isPreviewBlocked={Boolean(unknownExecution && !unknownExecution.previewUnlocked) || renameBlocked}
                      hasExecuted={hasExecuted}
                      executionPreviewId={executionPreviewId}
                      executeError={executeError}
                      revalidationError={revalidationError}
                      onPreview={requestPreview}
                      onExecute={executeRename}
                    />
                  </div>
                </div>
                {singleRenameTarget && <SingleRenameDialog
                  initialName={singleRenameTarget.name} isDirectory={singleRenameTarget.file.is_directory}
                  extension={singleRenameTarget.extension} isRenaming={isSingleRenaming}
                  canApply={canSingleRename} error={singleRenameError}
                  onApply={applySingleRename} onClose={closeSingleRename}
                />}
              </>
            )}
          </Box>
        </Box>
      </Box>
    </>
  );
}

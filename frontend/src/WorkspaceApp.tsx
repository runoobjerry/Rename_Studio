import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useRef } from "react";
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
import type { PaletteMode } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createStoragePreview,
  releaseStoragePreview,
  executePreview,
  fetchRules,
} from "./api/client";
import { BatchLimitDialog } from "./workspace/components/BatchLimitDialog";
import { StorageSidebar } from "./workspace/components/StorageSidebar";
import { StorageLocationPanel } from "./workspace/components/StorageLocationPanel";
import { useWorkspaceStorage } from "./workspace/hooks/useWorkspaceStorage";
import { FileBrowser } from "./features/files/FileBrowser";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RenameActionsWithProgress } from "./features/rename/RenameActionsWithProgress";
import { RuleEditor } from "./features/rules/RuleEditor";
import { RENAME_BATCH_SIZE, useRenameStore } from "./stores/useRenameStore";
import { createAppTheme } from "./theme";
import { errorMessage, NotificationProvider, useNotification } from "./components/NotificationProvider";

const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

import type { DirectoryListing, RuleSpec, StorageLocation } from "./types";

type AppView = "workspace" | "settings";

const drawerWidth = 244;
const batchHintPreference = "renamer-hide-batch-limit-hint";

function readBatchHintPreference(): boolean {
  try {
    return window.localStorage.getItem(batchHintPreference) === "true";
  } catch {
    // 浏览器存储受限时仍允许用户处理文件，提示偏好保留在当前页面。
    return false;
  }
}

function SecondaryPageFallback() {
  return (
    <Box sx={{ display: "grid", minHeight: 240, placeItems: "center" }}>
      <CircularProgress size={28} aria-label="正在加载页面" />
    </Box>
  );
}

function initialMode(): PaletteMode {
  const saved = window.localStorage.getItem("renamer-color-mode");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function WorkspaceApp() {
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const theme = useMemo(() => createAppTheme(mode), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <NotificationProvider><Workspace mode={mode} setMode={setMode} /></NotificationProvider>
    </ThemeProvider>
  );
}

function Workspace({ mode, setMode }: { mode: PaletteMode; setMode: (mode: PaletteMode) => void }) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const compactNavigation = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [skipBatchHint, setSkipBatchHint] = useState(readBatchHintPreference);
  const [batchHintContext, setBatchHintContext] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("workspace");
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const task = useRenameStore((state) => state.task);
  const resetTask = useRenameStore((state) => state.resetTask);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  const clearSelection = useRenameStore((state) => state.clearSelection);

  const {
    storageId, location, setLocation, setPath, selectStorage,
    providers, activeStorage, providerId, providerName, oneDriveStatus, localSettings,
    cloudAccountId, cloudConnected, cloudSession, cloudReady, restoredCloudSession,
    files, workspaceKey, settingsLoading, pickLocalRoot,
    restoreDefaultCloudPath, setDefaultCloudPath, refreshFiles,
  } = useWorkspaceStorage({
    hasTask: Boolean(task),
    // 异步选择完成时才调用，预览与执行 mutation 已在当前 render 中初始化。
    onLocalRootSelected: () => {
      clearSelection();
      preview.reset();
      execution.reset();
    },
  });
  const definitions = useQuery({ queryKey: ["rules"], queryFn: fetchRules });
  // 提交前以当前目录校验选中 ID，避免刷新后仍提交已删除的项目。
  const currentSelectedIds = useMemo(() => {
    const availableIds = new Set(files.data?.items.map((item) => item.id));
    return selectedIds.filter((id) => availableIds.has(id));
  }, [files.data, selectedIds]);
  const taskContext = useMemo(() => JSON.stringify([workspaceKey, cloudSession, rules]), [workspaceKey, cloudSession, rules]);
  const browserTask = useMemo(() => task ? { taskId: task.taskId, items: task.items } : null, [task?.taskId, task?.items]);
  const taskCurrent = task?.contextKey === taskContext;
  const previewContext = useMemo(() => JSON.stringify([workspaceKey, currentSelectedIds, rules]), [workspaceKey, currentSelectedIds, rules]);
  useEffect(() => {
    // Dialog 仅确认点击时的选择；上下文改变后必须由用户再次点击预览。
    if (batchHintContext && batchHintContext !== previewContext) setBatchHintContext(null);
  }, [batchHintContext, previewContext]);
  const currentWorkspace = useRef(previewContext);
  currentWorkspace.current = previewContext;
  // 界面 reset 不应丢失待释放 ID；规则和选择变化后仍可替代旧快照。
  const retainedPreview = useRef<{ storageId: string; previewId: string } | null>(null);
  const releaseRetainedPreview = useCallback(() => {
    const retained = retainedPreview.current;
    retainedPreview.current = null;
    if (retained) {
      void releaseStoragePreview(retained.storageId, retained.previewId).catch(() => {
        // 清理失败由服务端过期回收兜底，无需打扰用户。
      });
    }
  }, []);
  const preview = useMutation({
    mutationKey: ["rename-preview"],
    gcTime: 0,
    mutationFn: async (input: { contextKey: string; batchId: string; storageId: string; location: StorageLocation; fileIds: string[]; rules: RuleSpec[] }) => {
      const retained = retainedPreview.current;
      const previousId = retained?.storageId === input.storageId ? retained.previewId : undefined;
      const result = previousId
        ? await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules, previousId)
        : await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules);
      return { ...result, contextKey: input.contextKey, batchId: input.batchId, storageId: input.storageId };
    },
    onSuccess: (result) => {
      if (result.contextKey !== currentWorkspace.current) {
        void releaseStoragePreview(result.storageId, result.preview_id).catch(() => {
          // 清理失败由服务端过期回收兜底，无需打扰用户。
        });
        return;
      }
      retainedPreview.current = { storageId: result.storageId, previewId: result.preview_id };
      useRenameStore.getState().bindPreview(result.batchId, result.preview_id);
      if (!result.valid) {
        notify("预览包含无效名称或冲突，请检查结果；其他批次尚未处理的文件仍占用名称，不能跳过冲突检查。", "warning");
      }
    },
    onError: (error, input) => {
      if (input.contextKey === currentWorkspace.current) notify(`预览失败：${errorMessage(error)}`, "error");
    },
  });
  const execution = useMutation({
    gcTime: 0,
    mutationFn: executePreview,
    onSuccess: (result) => {
      if (result.status === "completed") {
        const renamed = result.items.filter((item) => item.status === "renamed").length;
        notify(`修改全部成功：${renamed} 项已修改。`, "success");
      } else {
        const renamed = result.items.filter((item) => item.status === "renamed").length;
        const failed = result.items.filter((item) => item.status === "failed").length;
        notify(
          `修改${result.status === "partial" ? "部分完成" : "失败"}：${renamed} 项已修改，${failed} 项失败。`,
          result.status === "partial" ? "warning" : "error",
        );
      }
      useRenameStore.getState().applyResults(result);
      // 只合并 Provider 已确认的结果，不请求目录；兼容 Local 重命名后的路径 ID。
      const confirmed = new Map(result.items.filter((item) => item.current_file)
        .map((item) => [item.file_id, item.current_file!]));
      queryClient.setQueryData<DirectoryListing>(["files", storageId, activeStorage?.revision, location], (listing) =>
        listing && { ...listing, items: listing.items.map((item) => confirmed.get(item.id) ?? item) });
    },
    onError: (error, previewId) => {
      // 请求失败可能发生在写入之后；没有逐项结果时先锁定本批，避免盲目重放。
      useRenameStore.getState().markUnknown(previewId);
      notify(`执行未返回完整结果：${errorMessage(error)}；请刷新目录并核对本批文件。`, "error");
    },
  });
  const previewData = preview.data && (preview.data.contextKey === previewContext || (execution.variables === preview.data.preview_id && (execution.isPending || execution.data || execution.error))) ? preview.data : undefined;

  useEffect(() => {
    window.localStorage.setItem("renamer-color-mode", mode);
  }, [mode]);

  useEffect(() => {
    if (execution.isPending) return;
    releaseRetainedPreview();
    clearSelection();
    resetTask();
    preview.reset();
    execution.reset();
  }, [workspaceKey, cloudSession]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 刷新失败时保留选择；成功读取后仅移除不存在的项，不自动选择新增项。
    if (!files.isSuccess || (providerId === "onedrive" && !cloudReady)) return;
    if (currentSelectedIds.length === selectedIds.length) return;
    setSelectedIds(currentSelectedIds);
    // 不因目录后台变化丢失正在执行的请求和进度。
    if (!execution.isPending) {
      preview.reset();
      execution.reset();
    }
  }, [files.isSuccess, files.dataUpdatedAt, cloudReady, providerId, currentSelectedIds, selectedIds.length,
    setSelectedIds, preview.reset, execution.reset, execution.isPending]);

  useEffect(() => {
    if (execution.isPending || providerId !== "onedrive" || restoredCloudSession === cloudSession) return;
    restoreDefaultCloudPath();
    clearSelection();
    preview.reset();
    execution.reset();
  }, [providerId, cloudSession, restoredCloudSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestBatchPreview = () => {
    if (!files.data || files.isFetching || files.error || execution.isPending || preview.isPending || activeStorage?.busy) return;
    if (task && !taskCurrent && task.items.some((item) => item.status === "unknown")) {
      notify("旧任务仍有待核对项，请先恢复原规则并核对执行结果。", "warning");
      return;
    }
    if (taskCurrent && task) {
      const members = new Set(task.items.map((item) => item.currentFileId));
      if (currentSelectedIds.some((id) => !members.has(id))) {
        notify("本次任务的文件集合已固定；请先结束当前任务，再选择文件开始新任务。", "warning");
        return;
      }
    }
    const batch = useRenameStore.getState().prepareBatch(taskContext, storageId, location, files.data.items);
    if (!batch.fileIds.length) {
      notify("没有可处理的任务文件；失败项可单独选择重试，待核对项须先核对。", "warning");
      return;
    }
    execution.reset();
    // 使用当前目录中的实际选择生成上下文，避免过时预览覆盖当前任务。
    const selected = useRenameStore.getState().selectedIds;
    const available = new Set(files.data.items.map((file) => file.id));
    const contextKey = JSON.stringify([workspaceKey, selected.filter((id) => available.has(id)), rules]);
    currentWorkspace.current = contextKey;
    preview.mutate({ contextKey, batchId: batch.batchId, storageId, location, fileIds: batch.fileIds, rules });
  };

  const loadError = providers.error ?? definitions.error ?? oneDriveStatus.error ?? localSettings.error;

  const navigate = useCallback((nextPath: string) => {
    if (execution.isPending || pickLocalRoot.isPending || activeStorage?.busy) return;
    setPath(nextPath);
  }, [execution.isPending, pickLocalRoot.isPending, activeStorage?.busy, setPath]);

  const navigateLocation = useCallback((next: StorageLocation) => {
    if (execution.isPending || pickLocalRoot.isPending || activeStorage?.busy) return;
    setLocation(next);
  }, [execution.isPending, pickLocalRoot.isPending, activeStorage?.busy]);

  const selectProvider = (nextProviderId: string) => {
    if (execution.isPending || pickLocalRoot.isPending) return;
    selectStorage(nextProviderId);
    setView("workspace");
    setMobileNavOpen(false);
  };

  const reconcileSelection = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    // 结果导致默认筛选隐藏项目时，保留执行结果和确认卡片。
    if (!execution.isPending && !execution.data) { preview.reset(); execution.reset(); }
  }, [setSelectedIds, execution.isPending, execution.data, preview.reset, execution.reset]);
  const endTask = useCallback(() => {
    if (execution.isPending || preview.isPending) return;
    releaseRetainedPreview();
    resetTask(); clearSelection(); preview.reset(); execution.reset();
  }, [execution.isPending, preview.isPending, releaseRetainedPreview, resetTask, clearSelection, preview.reset, execution.reset]);
  const changeSelection = useCallback((update: () => void) => {
    if (execution.isPending) return;
    update();
    preview.reset(); execution.reset();
  }, [execution.isPending, preview.reset, execution.reset]);
  const toggleFile = useCallback((fileId: string) => {
    changeSelection(() => toggleSelected(fileId));
  }, [changeSelection, toggleSelected]);
  const selectAllFiles = useCallback((ids: string[]) => {
    changeSelection(() => setSelectedIds(ids));
  }, [changeSelection, setSelectedIds]);
  const clearFiles = useCallback(() => {
    changeSelection(clearSelection);
  }, [changeSelection, clearSelection]);
  const invertFiles = useCallback((ids: string[]) => {
    changeSelection(() => {
      const selected = new Set(useRenameStore.getState().selectedIds);
      setSelectedIds(ids.filter((id) => !selected.has(id)));
    });
  }, [changeSelection, setSelectedIds]);

  return (
    <>
      <CssBaseline />
      <BatchLimitDialog
        open={batchHintContext === previewContext}
        checked={skipBatchHint}
        onClose={() => setBatchHintContext(null)}
        onCheckedChange={(checked) => {
          setSkipBatchHint(checked);
          try {
            window.localStorage.setItem(batchHintPreference, String(checked));
          } catch {
            notify("无法保存提示偏好，本次页面会话内仍然生效。", "warning");
          }
        }}
        onContinue={() => { setBatchHintContext(null); requestBatchPreview(); }}
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
            disabled={execution.isPending || pickLocalRoot.isPending}
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
                <SettingsPage executingStorageId={execution.isPending ? storageId : undefined} mode={mode} onModeChange={setMode} onBack={() => setView("workspace")} />
              </Suspense>
            )}

            {view === "workspace" && (
              <>
                <StorageLocationPanel
                  compactNavigation={compactNavigation}
                  listing={providerId === "local" || cloudReady ? files.data : undefined}
                  rootLabel={providerName}
                  providerId={providerId}
                  navigationDisabled={!activeStorage || execution.isPending || pickLocalRoot.isPending || activeStorage.busy || (providerId === "onedrive" && !cloudReady)}
                  defaultPathDisabled={!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || Boolean(files.error) || oneDriveStatus.isError}
                  browseDisabled={!activeStorage || pickLocalRoot.isPending || execution.isPending || activeStorage.busy}
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
                        disabled={execution.isPending || preview.isPending || files.isFetching || Boolean(activeStorage?.busy)}
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
                      execution={execution.data}
                      providerName={providerName}
                      error={preview.variables?.contextKey === previewContext ? preview.error?.message : undefined}
                      executeError={execution.error?.message}
                    />
                  </div>
                  <div className="workspace-rules">
                    <RuleEditor
                      definitions={definitions.data ?? []}
                      isLoading={definitions.isPending}
                      rules={rules}
                      onChange={(nextRules) => {
                        if (execution.isPending) return;
                        if (task?.items.some((item) => item.status === "unknown")) {
                          notify("本批存在待核对结果，请先核对实际文件，结束当前任务后再修改规则。", "warning");
                          return;
                        }
                        // 规则变化后旧预览立即失效，避免用户误读过期结果。
                        setRules(nextRules);
                        preview.reset();
                        execution.reset();
                      }}
                    />
                    <RenameActionsWithProgress
                      preview={previewData}
                      providerName={providerName}
                      selectedCount={Math.min(RENAME_BATCH_SIZE, currentSelectedIds.length)}
                      isPreviewing={preview.isPending}
                      isExecuting={execution.isPending}
                      isBlocked={pickLocalRoot.isPending || !activeStorage || activeStorage.busy || files.isFetching || Boolean(files.error)}
                      hasExecuted={Boolean(execution.data)}
                      allowUnchangedBatch={taskCurrent}
                      executionPreviewId={execution.variables}
                      executeError={execution.error?.message}
                      onPreview={() => {
                        if (currentSelectedIds.length > RENAME_BATCH_SIZE && !skipBatchHint) setBatchHintContext(previewContext);
                        else requestBatchPreview();
                      }}
                      onExecute={(previewId) => execution.mutate(previewId)}
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

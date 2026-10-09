import { lazy, Suspense, useEffect, useMemo, useState, useRef } from "react";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import CloudQueueRoundedIcon from "@mui/icons-material/CloudQueueRounded";
import ComputerRoundedIcon from "@mui/icons-material/ComputerRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  LinearProgress,
  Skeleton,
  Stack,
  ThemeProvider,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { PaletteMode } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createStoragePreview,
  executePreview,
  fetchRenameProgress,
  fetchStorageFiles,
  fetchStorageAuthStatus,
  fetchStorages,
  fetchRules,
  pickStorageFolder,
} from "./api/client";
import { FileBrowser } from "./features/files/FileBrowser";
import { LocationBreadcrumbs, locationButtonSx } from "./features/files/LocationBreadcrumbs";
import { readDefaultCloudLocation, saveDefaultCloudLocation } from "./features/files/defaultCloudLocation";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RenameActions } from "./features/rename/RenameActions";
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
  const [storageId, setStorageId] = useState("default-local");
  const [location, setLocation] = useState<StorageLocation>({ kind: "root" });
  const setPath = (value: string) => setLocation(value ? { kind: "path", value } : { kind: "root" });
  const [restoredCloudSession, setRestoredCloudSession] = useState<string | null>(null);
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const task = useRenameStore((state) => state.task);
  const resetTask = useRenameStore((state) => state.resetTask);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  const clearSelection = useRenameStore((state) => state.clearSelection);

  const providers = useQuery({ queryKey: ["storages"], queryFn: fetchStorages, refetchInterval: 3000 });
  const activeStorage = providers.data?.find((storage) => storage.storage_id === storageId);
  const providerId = activeStorage?.provider_type ?? "local";
  const definitions = useQuery({ queryKey: ["rules"], queryFn: fetchRules });
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
    enabled: !task && Boolean(activeStorage) && ((providerId === "local" && localSettings.isSuccess) || cloudReady),
  });
  const workspaceKey = JSON.stringify([storageId, activeStorage?.revision, location]);
  // 提交前以当前目录校验选中 ID，避免刷新后仍提交已删除的项目。
  const currentSelectedIds = useMemo(() => {
    const availableIds = new Set(files.data?.items.map((item) => item.id));
    return selectedIds.filter((id) => availableIds.has(id));
  }, [files.data, selectedIds]);
  const taskContext = JSON.stringify([workspaceKey, cloudSession, rules]);
  const taskCurrent = task?.contextKey === taskContext;
  const previewContext = JSON.stringify([workspaceKey, currentSelectedIds, rules]);
  useEffect(() => {
    // Dialog 仅确认点击时的选择；上下文改变后必须由用户再次点击预览。
    if (batchHintContext && batchHintContext !== previewContext) setBatchHintContext(null);
  }, [batchHintContext, previewContext]);
  const currentWorkspace = useRef(previewContext);
  currentWorkspace.current = previewContext;
  const preview = useMutation({
    mutationFn: async (input: { contextKey: string; batchId: string; storageId: string; location: StorageLocation; fileIds: string[]; rules: RuleSpec[] }) => {
      return { ...await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules), contextKey: input.contextKey, batchId: input.batchId };
    },
    onSuccess: (result) => {
      if (result.contextKey !== currentWorkspace.current) return;
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
  const executionProgress = useQuery({
    queryKey: ["rename-progress", execution.variables],
    queryFn: () => fetchRenameProgress(execution.variables!),
    enabled: execution.isPending && Boolean(execution.variables),
    refetchInterval: execution.isPending ? 500 : false,
    retry: false,
  });
  const previewData = preview.data && (preview.data.contextKey === previewContext || (execution.variables === preview.data.preview_id && (execution.isPending || execution.data || execution.error))) ? preview.data : undefined;
  const pickLocalRoot = useMutation({
    mutationFn: () => pickStorageFolder(storageId),
    onSuccess: async (settings) => {
      if (!settings.selected) return;
      await queryClient.invalidateQueries({ queryKey: ["storages"] });
      setPath("");
      clearSelection();
      preview.reset();
      execution.reset();
      notify("已选择本地根文件夹。");
      await queryClient.invalidateQueries({ queryKey: ["files", storageId] });
    },
    onError: (error) => notify(`选择文件夹失败：${errorMessage(error)}`, "error"),
  });

  useEffect(() => {
    window.localStorage.setItem("renamer-color-mode", mode);
  }, [mode]);

  useEffect(() => {
    if (execution.isPending) return;
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
    let defaultLocation: StorageLocation = { kind: "root" };
    try {
      if (cloudConnected && cloudAccountId) defaultLocation = readDefaultCloudLocation(storageId, cloudAccountId);
    } catch {
      notify("无法读取默认路径，将打开云盘根目录。请检查浏览器存储权限。", "warning");
    }
    // 恢复完成前不请求目录，避免以旧账号路径读取新账号或混用缓存。
    setLocation(defaultLocation);
    setRestoredCloudSession(cloudSession);
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
  const providerName = activeStorage?.name ?? storageId;
  const settingsLoading = providerId === "local" ? localSettings.isPending : oneDriveStatus.isPending;

  const navigate = (nextPath: string) => {
    if (execution.isPending || pickLocalRoot.isPending || activeStorage?.busy) return;
    setPath(nextPath);
  };

  const navigateLocation = (next: StorageLocation) => {
    if (execution.isPending || pickLocalRoot.isPending || activeStorage?.busy) return;
    setLocation(next);
  };

  const selectProvider = (nextProviderId: string) => {
    if (execution.isPending || pickLocalRoot.isPending) return;
    setStorageId(nextProviderId);
    setPath("");
    setRestoredCloudSession(null);
    setView("workspace");
    setMobileNavOpen(false);
  };

  const setDefaultCloudPath = () => {
    if (!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || files.error) return;
    try {
      saveDefaultCloudLocation(storageId, cloudAccountId, files.data.location!);
      notify(`已将“${files.data.path || "根目录"}”设为当前账号的默认路径。`);
    } catch {
      notify("默认路径保存失败，请检查浏览器存储权限或可用空间。", "error");
    }
  };

  const navigation = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        p: 1.5,
        "& .MuiListItemButton-root": { borderRadius: "14px" },
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "center", px: 1, py: 1.25, mb: 1 }}
      >
        <Box className="brand-mark"><AutoFixHighRoundedIcon fontSize="small" /></Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
            Rename Studio
          </Typography>
          <Typography variant="caption" color="textPrimary">批量重命名工作台</Typography>
        </Box>
      </Stack>
      <Typography
        variant="overline"
        color="textSecondary"
        sx={{ px: 1.5, mt: 1}}
      >
      存储位置
      </Typography>
      <List disablePadding>
        {providers.isPending && <Skeleton variant="rounded" height={80} aria-label="正在加载存储位置" />}
        {(providers.data ?? []).map((provider) => (
          <ListItemButton
            disabled={execution.isPending || pickLocalRoot.isPending}
            key={provider.storage_id}
            selected={view === "workspace" && provider.storage_id === storageId}
            onClick={() => selectProvider(provider.storage_id)}
          >
            <ListItemIcon>
              {provider.provider_type === "onedrive" ? <CloudQueueRoundedIcon /> : <ComputerRoundedIcon />}
            </ListItemIcon>
            <ListItemText primary={provider.name} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ flex: 1 }} />
      <List disablePadding>
        <ListItemButton
          selected={view === "settings"}
          onClick={() => {
            setView("settings");
            setMobileNavOpen(false);
          }}
        >
          <ListItemIcon><SettingsRoundedIcon /></ListItemIcon>
          <ListItemText primary="设置" />
        </ListItemButton>
      </List>
      <Box className="sidebar-meta">
        <Typography variant="caption" color="textSecondary">© 2026 JERRY </Typography>
        <Typography variant="caption" color="textSecondary">Ver. 0.20-alpha</Typography>
      </Box>
    </Box>
  );

  return (
    <>
      <CssBaseline />
      <Dialog open={batchHintContext === previewContext} onClose={() => setBatchHintContext(null)}>
        <DialogTitle>分批处理提示</DialogTitle>
        <DialogContent>
          <DialogContentText>
            您当前选择的文件已超过 1000 项的上限。为避免影响性能，本次只会修改前 1000 项。本次执行结束后，您可以在“筛选”中选择“待处理项目”，继续选择并处理剩余项目。
          </DialogContentText>
          <FormControlLabel label="下次不再提示" control={<Checkbox checked={skipBatchHint} onChange={(event) => {
            const checked = event.target.checked;
            setSkipBatchHint(checked);
            try {
              window.localStorage.setItem(batchHintPreference, String(checked));
            } catch {
              notify("无法保存提示偏好，本次页面会话内仍然生效。", "warning");
            }
          }} />} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBatchHintContext(null)}>取消</Button>
          <Button onClick={() => { setBatchHintContext(null); requestBatchPreview(); }}>继续预览</Button>
        </DialogActions>
      </Dialog>
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
          {navigation}
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
                <section className="panel location-panel" aria-label="目录位置">
                  <div className="location-toolbar">
                    {compactNavigation && (
                      <IconButton onClick={() => setMobileNavOpen(true)} aria-label="打开导航" sx={{ p: "4px" }}>
                        <MenuRoundedIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    )}
                    <div className="location-navigation">
                      <LocationBreadcrumbs
                        listing={providerId === "local" || cloudReady ? files.data : undefined}
                        rootLabel={providerName}
                        disabled={!activeStorage || execution.isPending || pickLocalRoot.isPending || activeStorage.busy || (providerId === "onedrive" && !cloudReady)}
                        onNavigate={navigateLocation}
                      />
                      {providerId === "onedrive" ? (
                        <Button
                          type="button"
                          variant="outlined"
                          onClick={setDefaultCloudPath}
                          disabled={!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || Boolean(files.error) || oneDriveStatus.isError}
                          sx={{ ...locationButtonSx, px: "10px" }}
                        >
                          设为默认路径
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outlined"
                          onClick={() => pickLocalRoot.mutate()}
                          disabled={!activeStorage || pickLocalRoot.isPending || execution.isPending || activeStorage.busy}
                          sx={{ ...locationButtonSx, px: "10px" }}
                        >
                          {pickLocalRoot.isPending ? "等待选择…" : "浏览…"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="location-feedback">
                    {!activeStorage && !providers.isPending && <Alert severity="warning">当前存储已删除，请选择其他连接。</Alert>}
                    {cloudConnected && !cloudAccountId && (
                      <Alert severity="info">当前账号缺少账号 ID，仍可浏览文件；请重新登录后设置默认路径。</Alert>
                    )}
                    {providerId === "local" && pickLocalRoot.error && (
                      <Alert severity="error">无法打开文件夹选择器：{pickLocalRoot.error.message}</Alert>
                    )}
                    {providerId === "onedrive" && oneDriveStatus.isSuccess && !oneDriveStatus.data.connected && (
                      <Alert severity="warning">请先前往设置页面连接 OneDrive 账号。</Alert>
                    )}
                  </div>
                </section>

                <div className="workspace-grid">
                  <div className="workspace-primary">
                    {files.data && (providerId === "local" || cloudReady) ? (
                      <FileBrowser
                        onNavigateLocation={navigateLocation}
                        listing={files.data}
                        providerName={providerName}
                        selectedIds={selectedIds}
                        task={task}
                        taskCurrent={taskCurrent}
                        disabled={execution.isPending || preview.isPending || files.isFetching || Boolean(activeStorage?.busy)}
                        onReconcileSelection={(ids) => {
                          setSelectedIds(ids);
                          // 结果导致默认筛选隐藏项目时，保留刚收到的执行结果与确认卡片。
                          if (!execution.isPending && !execution.data) {
                            preview.reset(); execution.reset();
                          }
                        }}
                        onEndTask={() => {
                          if (execution.isPending || preview.isPending) return;
                          resetTask(); clearSelection(); preview.reset(); execution.reset();
                        }}
                        isRefreshing={files.isFetching}
                        refreshError={files.error?.message}
                        onNavigate={navigate}
                        onRefresh={() => {
                          void files.refetch().then((result) => {
                            if (result.error) notify(`刷新失败：${errorMessage(result.error)}`, "error");
                            else notify("目录已刷新。");
                          });
                        }}
                        onToggle={(fileId) => {
                          if (execution.isPending) return;
                          toggleSelected(fileId);
                          preview.reset();
                          execution.reset();
                        }}
                        onSelectAll={(visibleIds) => {
                          if (execution.isPending) return;
                          setSelectedIds(visibleIds);
                          preview.reset();
                          execution.reset();
                        }}
                        onClearSelection={() => {
                          if (execution.isPending) return;
                          clearSelection();
                          preview.reset();
                          execution.reset();
                        }}
                        onInvertSelection={(visibleIds) => {
                          if (execution.isPending) return;
                          const selected = new Set(selectedIds);
                          setSelectedIds(visibleIds.filter((id) => !selected.has(id)));
                          preview.reset();
                          execution.reset();
                        }}
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
                    <RenameActions
                      preview={previewData}
                      providerName={providerName}
                      selectedCount={Math.min(RENAME_BATCH_SIZE, currentSelectedIds.length)}
                      isPreviewing={preview.isPending}
                      isExecuting={execution.isPending}
                      isBlocked={pickLocalRoot.isPending || !activeStorage || activeStorage.busy || files.isFetching || Boolean(files.error)}
                      hasExecuted={Boolean(execution.data)}
                      allowUnchangedBatch={taskCurrent}
                      progress={executionProgress.data}
                      progressError={executionProgress.error?.message}
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

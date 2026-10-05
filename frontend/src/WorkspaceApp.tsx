import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  LinearProgress,
  Skeleton,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type { PaletteMode } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPreview,
  executePreview,
  fetchRenameProgress,
  fetchFiles,
  fetchLocalSettings,
  fetchOneDriveStatus,
  fetchProviders,
  fetchRules,
  pickLocalFolder,
  updateLocalSettings,
} from "./api/client";
import { FileBrowser } from "./features/files/FileBrowser";
import { readDefaultCloudPath, saveDefaultCloudPath } from "./features/files/defaultCloudPath";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RenameActions } from "./features/rename/RenameActions";
import { RuleEditor } from "./features/rules/RuleEditor";
import { useRenameStore } from "./stores/useRenameStore";
import { createAppTheme } from "./theme";
import { errorMessage, NotificationProvider, useNotification } from "./components/NotificationProvider";

const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

type AppView = "workspace" | "settings";

const drawerWidth = 244;

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
  const [view, setView] = useState<AppView>("workspace");
  const [providerId, setProviderId] = useState("local");
  const [path, setPath] = useState("");
  const [localRoot, setLocalRoot] = useState("");
  const [cloudPath, setCloudPath] = useState("");
  const [restoredCloudSession, setRestoredCloudSession] = useState<string | null>(null);
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  const clearSelection = useRenameStore((state) => state.clearSelection);

  const providers = useQuery({ queryKey: ["providers"], queryFn: fetchProviders });
  const definitions = useQuery({ queryKey: ["rules"], queryFn: fetchRules });
  const oneDriveStatus = useQuery({
    queryKey: ["onedrive", "status"],
    queryFn: fetchOneDriveStatus,
  });
  const localSettings = useQuery({
    queryKey: ["local", "settings"],
    queryFn: fetchLocalSettings,
  });
  const cloudAccountId = providerId === "onedrive" ? oneDriveStatus.data?.account_id : null;
  const cloudConnected = providerId === "onedrive" && oneDriveStatus.data?.connected === true;
  const cloudSession = cloudConnected ? JSON.stringify([providerId, cloudAccountId ?? null]) : null;
  const cloudReady = cloudConnected && restoredCloudSession === cloudSession;
  const files = useQuery({
    queryKey: [
      "files",
      providerId,
      providerId === "local" ? localSettings.data?.root_path ?? "" : cloudSession,
      path,
    ],
    queryFn: () => fetchFiles(providerId, path),
    enabled:
      (providerId === "local" && localSettings.isSuccess) ||
      cloudReady,
  });
  // 提交前以当前目录校验选中 ID，避免刷新后仍提交已删除的项目。
  const currentSelectedIds = useMemo(() => {
    const availableIds = new Set(files.data?.items.map((item) => item.id));
    return selectedIds.filter((id) => availableIds.has(id));
  }, [files.data, selectedIds]);
  const preview = useMutation({
    mutationFn: () => createPreview(providerId, path, currentSelectedIds, rules),
    onSuccess: (result) => {
      if (!result.valid) {
        notify("预览包含无效名称或冲突，请检查预览结果。", "warning");
      }
    },
    onError: (error) => notify(`预览失败：${errorMessage(error)}`, "error"),
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
      clearSelection();
      // 先展示执行结果，目录刷新在后台完成，避免把读取延迟算入执行等待时间。
      void queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (error) => notify(`执行失败：${errorMessage(error)}`, "error"),
  });
  const executionProgress = useQuery({
    queryKey: ["rename-progress", execution.variables],
    queryFn: () => fetchRenameProgress(execution.variables!),
    enabled: execution.isPending && Boolean(execution.variables),
    refetchInterval: execution.isPending ? 500 : false,
    retry: false,
  });
  const updateLocalRoot = useMutation({
    mutationFn: () => updateLocalSettings(localRoot.trim()),
    onSuccess: async (settings) => {
      setLocalRoot(settings.root_path);
      queryClient.setQueryData(["local", "settings"], settings);
      setPath("");
      clearSelection();
      preview.reset();
      execution.reset();
      notify("已切换本地根文件夹。");
      await queryClient.invalidateQueries({ queryKey: ["files", "local"] });
    },
    onError: (error) => notify(`切换失败：${errorMessage(error)}`, "error"),
  });
  const pickLocalRoot = useMutation({
    mutationFn: pickLocalFolder,
    onSuccess: async (settings) => {
      if (!settings.selected) return;
      setLocalRoot(settings.root_path);
      queryClient.setQueryData(["local", "settings"], { root_path: settings.root_path });
      setPath("");
      clearSelection();
      preview.reset();
      execution.reset();
      notify("已选择本地根文件夹。");
      await queryClient.invalidateQueries({ queryKey: ["files", "local"] });
    },
    onError: (error) => notify(`选择文件夹失败：${errorMessage(error)}`, "error"),
  });

  useEffect(() => {
    window.localStorage.setItem("renamer-color-mode", mode);
  }, [mode]);

  useEffect(() => {
    if (localSettings.data?.root_path) setLocalRoot(localSettings.data.root_path);
  }, [localSettings.data?.root_path]);

  useEffect(() => {
    clearSelection();
    preview.reset();
    execution.reset();
  }, [path, providerId, cloudSession]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [files.isSuccess, cloudReady, providerId, currentSelectedIds, selectedIds.length,
    setSelectedIds, preview.reset, execution.reset, execution.isPending]);

  useEffect(() => {
    if (providerId !== "onedrive" || restoredCloudSession === cloudSession) return;
    let defaultPath = "";
    try {
      if (cloudConnected && cloudAccountId) defaultPath = readDefaultCloudPath(providerId, cloudAccountId);
    } catch {
      notify("无法读取默认路径，将打开云盘根目录。请检查浏览器存储权限。", "warning");
    }
    // 恢复完成前不请求目录，避免以旧账号路径读取新账号或混用缓存。
    setPath(defaultPath);
    setCloudPath(defaultPath);
    setRestoredCloudSession(cloudSession);
    clearSelection();
    preview.reset();
    execution.reset();
  }, [providerId, cloudSession, restoredCloudSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadError = providers.error ?? definitions.error ?? oneDriveStatus.error ?? localSettings.error;
  const activeProvider = providers.data?.find((provider) => provider.id === providerId);
  const providerName = activeProvider?.name ?? providerId;
  const settingsLoading = providerId === "local" ? localSettings.isPending : oneDriveStatus.isPending;

  const navigate = (nextPath: string) => {
    setPath(nextPath);
    if (providerId === "onedrive") setCloudPath(nextPath);
  };

  const selectProvider = (nextProviderId: string) => {
    setProviderId(nextProviderId);
    setPath("");
    setCloudPath("");
    setRestoredCloudSession(null);
    setView("workspace");
    setMobileNavOpen(false);
  };

  const setDefaultCloudPath = () => {
    if (!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || files.error) return;
    try {
      saveDefaultCloudPath(providerId, cloudAccountId, files.data.path);
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
            key={provider.id}
            selected={view === "workspace" && provider.id === providerId}
            onClick={() => selectProvider(provider.id)}
          >
            <ListItemIcon>
              {provider.id === "onedrive" ? <CloudQueueRoundedIcon /> : <ComputerRoundedIcon />}
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
                <SettingsPage mode={mode} onModeChange={setMode} onBack={() => setView("workspace")} />
              </Suspense>
            )}

            {view === "workspace" && (
              <>
                <section className="panel location-panel" aria-labelledby="location-title">
                  <div className="location-toolbar">
                    {compactNavigation && (
                      <IconButton onClick={() => setMobileNavOpen(true)} aria-label="打开导航">
                        <MenuRoundedIcon />
                      </IconButton>
                    )}
                    <div className="location-identity">
                      <h2 id="location-title">{providerName}</h2>
                    </div>
                    {providerId === "onedrive" ? (
                      <form
                        className="cloud-path-form cloud-default-path-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          navigate(cloudPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
                        }}
                      >
                        <div className="path-input-wrap">
                          <TextField
                            fullWidth
                            hiddenLabel
                            size="small"
                            value={cloudPath}
                            onChange={(event) => setCloudPath(event.target.value)}
                            placeholder="例如：照片/待整理（留空表示根目录）"
                            slotProps={{ htmlInput: { "aria-label": "云端文件夹路径" } }}
                          />
                        </div>
                        <Button
                          type="submit"
                          variant="contained"
                          disabled={!oneDriveStatus.data?.connected}
                          sx={{ minHeight: 36, px: 1.5, py: 1, whiteSpace: "nowrap" }}
                        >
                          打开文件夹
                        </Button>
                        <Button
                          type="button"
                          variant="outlined"
                          onClick={setDefaultCloudPath}
                          disabled={!cloudAccountId || !cloudReady || !files.isSuccess || files.isFetching || Boolean(files.error) || oneDriveStatus.isError}
                          sx={{ minHeight: 36, px: 1.5, py: 1, whiteSpace: "nowrap" }}
                        >
                          设为默认路径
                        </Button>
                      </form>
                    ) : (
                      <form
                        className="cloud-path-form local-path-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          updateLocalRoot.mutate();
                        }}
                      >
                        <div className="path-input-wrap">
                          <TextField
                            fullWidth
                            hiddenLabel
                            size="small"
                            value={localRoot}
                            onChange={(event) => setLocalRoot(event.target.value)}
                            placeholder="例如：D:\\待整理文件"
                            slotProps={{ htmlInput: { "aria-label": "本地根文件夹路径" } }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outlined"
                          onClick={() => pickLocalRoot.mutate()}
                          disabled={pickLocalRoot.isPending}
                          sx={{ minHeight: 36, px: 1.5, py: 1, whiteSpace: "nowrap" }}
                        >
                          {pickLocalRoot.isPending ? "等待选择…" : "浏览…"}
                        </Button>
                        <Button
                          type="submit"
                          variant="contained"
                          disabled={!localRoot.trim() || updateLocalRoot.isPending}
                          sx={{ minHeight: 36, px: 1.5, py: 1, whiteSpace: "nowrap" }}
                        >
                          {updateLocalRoot.isPending ? "切换中…" : "使用此文件夹"}
                        </Button>
                      </form>
                    )}
                  </div>
                  <div className="location-feedback">
                    {cloudConnected && !cloudAccountId && (
                      <Alert severity="info">当前账号缺少账号 ID，仍可浏览文件；请重新登录后设置默认路径。</Alert>
                    )}
                    {providerId === "local" && updateLocalRoot.error && (
                      <Alert severity="error">切换失败：{updateLocalRoot.error.message}</Alert>
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
                        listing={files.data}
                        providerName={providerName}
                        selectedIds={selectedIds}
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
                          toggleSelected(fileId);
                          preview.reset();
                          execution.reset();
                        }}
                        onSelectAll={(visibleIds) => {
                          setSelectedIds(visibleIds);
                          preview.reset();
                          execution.reset();
                        }}
                        onClearSelection={() => {
                          clearSelection();
                          preview.reset();
                          execution.reset();
                        }}
                        onInvertSelection={(visibleIds) => {
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
                      preview={preview.data}
                      execution={execution.data}
                      providerName={providerName}
                      error={preview.error?.message}
                      executeError={execution.error?.message}
                    />
                  </div>
                  <div className="workspace-rules">
                    <RuleEditor
                      definitions={definitions.data ?? []}
                      isLoading={definitions.isPending}
                      rules={rules}
                      onChange={(nextRules) => {
                        // 规则变化后旧预览立即失效，避免用户误读过期结果。
                        setRules(nextRules);
                        preview.reset();
                        execution.reset();
                      }}
                    />
                    <RenameActions
                      preview={preview.data}
                      providerName={providerName}
                      selectedCount={currentSelectedIds.length}
                      isPreviewing={preview.isPending}
                      isExecuting={execution.isPending}
                      hasExecuted={Boolean(execution.data)}
                      progress={executionProgress.data}
                      progressError={executionProgress.error?.message}
                      executeError={execution.error?.message}
                      onPreview={() => {
                        execution.reset();
                        preview.mutate();
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

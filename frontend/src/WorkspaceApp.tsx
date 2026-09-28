import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import CloudQueueRoundedIcon from "@mui/icons-material/CloudQueueRounded";
import ComputerRoundedIcon from "@mui/icons-material/ComputerRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import {
  Alert,
  Box,
  CircularProgress,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  ThemeProvider,
  Typography,
  useMediaQuery,
} from "@mui/material";
import type { PaletteMode } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPreview,
  executePreview,
  fetchFiles,
  fetchLocalSettings,
  fetchOneDriveStatus,
  fetchProviders,
  fetchRules,
  pickLocalFolder,
  updateLocalSettings,
} from "./api/client";
import { FileBrowser } from "./features/files/FileBrowser";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RenameActions } from "./features/rename/RenameActions";
import { cloneRule, DEFAULT_RULES, RuleEditor } from "./features/rules/RuleEditor";
import { useRenameStore } from "./stores/useRenameStore";
import { createAppTheme } from "./theme";

const RulePickerPage = lazy(() =>
  import("./features/rules/RulePickerPage").then((module) => ({
    default: module.RulePickerPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

type AppView = "workspace" | "add-rule" | "settings";

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
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const compactNavigation = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [view, setView] = useState<AppView>("workspace");
  const [providerId, setProviderId] = useState("local");
  const [path, setPath] = useState("");
  const [localRoot, setLocalRoot] = useState("");
  const [cloudPath, setCloudPath] = useState("");
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
  const files = useQuery({
    queryKey: [
      "files",
      providerId,
      providerId === "local" ? localSettings.data?.root_path ?? "" : "",
      path,
    ],
    queryFn: () => fetchFiles(providerId, path),
    enabled:
      (providerId === "local" && localSettings.isSuccess) ||
      (providerId === "onedrive" && oneDriveStatus.data?.connected === true),
  });
  const preview = useMutation({
    mutationFn: () => createPreview(providerId, path, selectedIds, rules),
  });
  const execution = useMutation({
    mutationFn: executePreview,
    onSuccess: () => {
      clearSelection();
      // 先展示执行结果，目录刷新在后台完成，避免把读取延迟算入执行等待时间。
      void queryClient.invalidateQueries({ queryKey: ["files"] });
    },
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
      await queryClient.invalidateQueries({ queryKey: ["files", "local"] });
    },
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
      await queryClient.invalidateQueries({ queryKey: ["files", "local"] });
    },
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
  }, [path, providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (providerId !== "onedrive" || oneDriveStatus.data?.connected !== false) return;
    setPath("");
    setCloudPath("");
    clearSelection();
    preview.reset();
    execution.reset();
  }, [providerId, oneDriveStatus.data?.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadError = providers.error ?? definitions.error ?? oneDriveStatus.error ?? localSettings.error;
  const activeProvider = providers.data?.find((provider) => provider.id === providerId);
  const providerName = activeProvider?.name ?? providerId;

  const navigate = (nextPath: string) => {
    setPath(nextPath);
    if (providerId === "onedrive") setCloudPath(nextPath);
  };

  const selectProvider = (nextProviderId: string) => {
    setProviderId(nextProviderId);
    setPath("");
    setCloudPath("");
    setView("workspace");
    setMobileNavOpen(false);
  };

  const addRule = (type: string) => {
    const template = DEFAULT_RULES[type];
    if (!template) return;
    setRules([...rules, cloneRule(template)]);
    preview.reset();
    execution.reset();
    setView("workspace");
  };

  const navigation = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 1.5 }}>
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
        color="textPrimary"
        sx={{ px: 1.5, mt: 1, fontSize: 20}}
      >
      存储位置
      </Typography>
      <List disablePadding>
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
      <Divider sx={{ mb: 1 }} />
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
        <Typography variant="caption" color="textSecondary">© 2026 Rename Studio</Typography>
        <Typography variant="caption" color="textSecondary">Git · a4130b4</Typography>
      </Box>
    </Box>
  );

  return (
    <ThemeProvider theme={theme}>
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

            {view === "settings" && (
              <Suspense fallback={<SecondaryPageFallback />}>
                <SettingsPage mode={mode} onModeChange={setMode} onBack={() => setView("workspace")} />
              </Suspense>
            )}

            {view === "add-rule" && (
              <Suspense fallback={<SecondaryPageFallback />}>
                <RulePickerPage
                  definitions={definitions.data ?? []}
                  onBack={() => setView("workspace")}
                  onSelect={addRule}
                />
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
                        className="cloud-path-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          navigate(cloudPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
                        }}
                      >
                        <div className="path-input-wrap">
                          <input
                            value={cloudPath}
                            onChange={(event) => setCloudPath(event.target.value)}
                            placeholder="例如：照片/待整理（留空表示根目录）"
                            aria-label="云端文件夹路径"
                          />
                        </div>
                        <button type="submit" disabled={!oneDriveStatus.data?.connected}>打开文件夹</button>
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
                          <input
                            value={localRoot}
                            onChange={(event) => setLocalRoot(event.target.value)}
                            placeholder="例如：D:\\待整理文件"
                            aria-label="本地根文件夹路径"
                          />
                        </div>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => pickLocalRoot.mutate()}
                          disabled={pickLocalRoot.isPending}
                        >
                          {pickLocalRoot.isPending ? "等待选择…" : "浏览…"}
                        </button>
                        <button type="submit" disabled={!localRoot.trim() || updateLocalRoot.isPending}>
                          {updateLocalRoot.isPending ? "切换中…" : "使用此文件夹"}
                        </button>
                      </form>
                    )}
                  </div>
                  <div className="location-feedback">
                    {providerId === "local" && updateLocalRoot.error && (
                      <p className="inline-error">切换失败：{updateLocalRoot.error.message}</p>
                    )}
                    {providerId === "local" && pickLocalRoot.error && (
                      <p className="inline-error">无法打开文件夹选择器：{pickLocalRoot.error.message}</p>
                    )}
                    {providerId === "onedrive" && !oneDriveStatus.data?.connected && (
                      <p className="inline-error">请先前往设置页面连接 OneDrive 账号。</p>
                    )}
                  </div>
                </section>

                <div className="workspace-grid">
                  <div className="workspace-primary">
                    {files.data ? (
                      <FileBrowser
                        listing={files.data}
                        providerName={providerName}
                        selectedIds={selectedIds}
                        isRefreshing={files.isFetching}
                        onNavigate={navigate}
                        onRefresh={() => void files.refetch()}
                        onToggle={(fileId) => {
                          toggleSelected(fileId);
                          preview.reset();
                          execution.reset();
                        }}
                        onSelectAll={() => {
                          setSelectedIds(files.data.items.map((item) => item.id));
                          preview.reset();
                          execution.reset();
                        }}
                        onClearSelection={() => {
                          clearSelection();
                          preview.reset();
                          execution.reset();
                        }}
                        onInvertSelection={() => {
                          const selected = new Set(selectedIds);
                          setSelectedIds(files.data.items.filter((item) => !selected.has(item.id)).map((item) => item.id));
                          preview.reset();
                          execution.reset();
                        }}
                      />
                    ) : (
                      <section className="panel">
                        <p className={files.error ? "inline-error" : "empty-state"}>
                          {files.error
                            ? `目录读取失败：${files.error.message}`
                            : providerId === "onedrive" && !oneDriveStatus.data?.connected
                              ? "连接 OneDrive 后可浏览云端目录。"
                              : "正在读取目录…"}
                        </p>
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
                      rules={rules}
                      onAddRule={() => setView("add-rule")}
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
                      selectedCount={selectedIds.length}
                      isPreviewing={preview.isPending}
                      isExecuting={execution.isPending}
                      hasExecuted={Boolean(execution.data)}
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
    </ThemeProvider>
  );
}

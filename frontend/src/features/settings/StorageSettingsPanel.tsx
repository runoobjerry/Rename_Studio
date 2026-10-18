import { useEffect, useRef, useState } from "react";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ErrorIcon from "@mui/icons-material/Error";
import Verified from "@mui/icons-material/Verified";
import {
  Alert, Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, MenuItem, Stack, Chip, TextField, Typography, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Skeleton,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createStorage, deleteStorage, disconnectStorage, fetchStorageAuthStatus,
  fetchStorageProviders, fetchStorages, pickLocalFolderDraft, pickStorageFolder,
  startStorageAuth, updateStorage,
} from "../../api/client";
import type { StorageInfo } from "../../types";
import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { PanelIconButton } from "../../components/PanelIconButton";

const connectionBodySx = {
  "& .MuiInputBase-root, & .MuiInputLabel-root, & .MuiButton-root": {
    fontSize: "body2.fontSize",
  },
  "& .MuiChip-root, & .MuiAlert-message": {
    fontSize: "caption.fontSize",
  },
};

function ConnectionRow({ storage, executing, providerName }: {
  storage: StorageInfo;
  executing: boolean;
  providerName: string;
}) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [name, setName] = useState(storage.name);
  const [root, setRoot] = useState(storage.config.root_path ?? "");
  const [clientId, setClientId] = useState(storage.config.client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const popup = useRef<Window | null>(null);
  const callbackOrigin = useRef<string>();
  const local = storage.provider_type === "local";
  const google = storage.provider_type === "google_drive";
  const status = useQuery({
    queryKey: ["storage-auth", storage.storage_id, storage.revision],
    queryFn: () => fetchStorageAuthStatus(storage.storage_id),
    enabled: !local,
  });
  useEffect(() => {
    setName(storage.name);
    setRoot(storage.config.root_path ?? "");
    setClientId(storage.config.client_id ?? "");
    setClientSecret("");
  }, [storage.name, storage.config.root_path, storage.config.client_id, storage.revision]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["storages"] });
    void queryClient.invalidateQueries({ queryKey: ["storage-auth", storage.storage_id] });
    void queryClient.invalidateQueries({ queryKey: ["files", storage.storage_id] });
  };
  const operation = useMutation({
    gcTime: 0,
    mutationFn: (action: { run: () => Promise<unknown>; message: string }) => action.run(),
    onSuccess: (_result, action) => {
      setClientSecret("");
      refresh();
      notify(action.message);
    },
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const pick = useMutation({
    mutationFn: () => pickStorageFolder(storage.storage_id),
    onSuccess: (result) => {
      if (!result.selected) return;
      setRoot(result.root_path);
      refresh();
      notify("已选择本地根文件夹。");
    },
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const connect = useMutation({
    mutationFn: () => startStorageAuth(storage.storage_id),
    onSuccess: (result) => {
      callbackOrigin.current = new URL(result.redirect_uri).origin;
      if (popup.current) popup.current.location.href = result.authorization_url;
      setAwaitingAuth(true);
      refresh();
    },
    onError: (error) => {
      popup.current?.close();
      setAuthError(errorMessage(error));
      notify(errorMessage(error), "error");
    },
  });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!popup.current || event.source !== popup.current || event.origin !== callbackOrigin.current) return;
      const data: unknown = event.data;
      if (
        typeof data !== "object" || data === null ||
        !("type" in data) || data.type !== "storage-auth" ||
        !("storage_id" in data) || data.storage_id !== storage.storage_id ||
        !("status" in data) || (data.status !== "connected" && data.status !== "failed")
      ) return;
      const message = "message" in data && typeof data.message === "string" ? data.message : "授权失败，请重试。";
      setAwaitingAuth(false);
      popup.current = null;
      setAuthError(data.status === "failed" ? message : undefined);
      notify(data.status === "connected" ? "账号已连接。" : message, data.status === "connected" ? "success" : "error");
      refresh();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [storage.storage_id, notify, queryClient]);
  useEffect(() => {
    if (!awaitingAuth) return;
    const timer = window.setInterval(() => {
      if (popup.current?.closed) {
        setAwaitingAuth(false);
        popup.current = null;
        setAuthError("授权窗口已关闭，请重新登录。");
        refresh();
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [awaitingAuth]);
  const renaming = executing || storage.busy;
  const busy = renaming || operation.isPending || pick.isPending || connect.isPending || awaitingAuth;
  const isDefault = storage.storage_id === "default-local";
  const requestError = operation.error ?? pick.error ?? connect.error ?? status.error;
  const saveDisabled = busy || !name.trim() || (local && !root.trim());
  const statusErrorMessage = authError ?? (status.error ? errorMessage(status.error) : "");
  const requestErrorMessage = authError ?? (requestError ? errorMessage(requestError) : "");
  const save = () => {
    if (Array.from(name.trim()).length > 20) {
      notify("连接名称最多为 20 个字符。", "error");
      return;
    }
    operation.mutate({
      run: () => updateStorage(storage.storage_id, {
        name: name.trim(),
        config: local ? { root_path: root.trim() } : { client_id: clientId.trim() || null },
        ...(google && clientSecret.trim() ? { client_secret: clientSecret.trim() } : {}),
      }),
      message: "存储连接设置已更新。",
    });
  };
  const openEditor = () => {
    setName(storage.name);
    setRoot(storage.config.root_path ?? "");
    setClientId(storage.config.client_id ?? "");
    setClientSecret("");
    operation.reset();
    pick.reset();
    setEditing(true);
  };
  const beginAuthorization = () => {
    popup.current = window.open("about:blank", `storage-auth-${storage.storage_id}`, "popup,width=600,height=720");
    if (!popup.current) {
      setAuthError("登录窗口被浏览器拦截，请允许弹窗。");
      return;
    }
    setAuthError(undefined);
    connect.mutate();
  };
  const closeEditor = () => {
    if (!busy) {
      setClientSecret("");
      operation.reset();
      setEditing(false);
    }
  };
  const disconnectAccount = () => {
    operation.mutate({
      run: () => disconnectStorage(storage.storage_id),
      message: "账号已退出。",
    });
  };
  const deleteConnection = () => {
    operation.mutate({
      run: () => deleteStorage(storage.storage_id),
      message: "存储连接设置已更新。",
    }, { onSuccess: () => setEditing(false) });
  };

  let statusLabel: string;
  if (local) {
    statusLabel = "已连接";
  } else if (status.isPending) {
    statusLabel = "正在读取…";
  } else if (status.error) {
    statusLabel = "读取失败";
  } else {
    statusLabel = status.data?.connected ? "已连接" : "未连接";
  }

  let authTitle: string;
  let authDescription: string;
  if (status.isPending) {
    authTitle = "正在读取授权状态…";
    authDescription = "正在读取连接账号信息。";
  } else if (status.error) {
    authTitle = "授权状态读取失败";
    authDescription = "暂时无法确认授权状态，请稍后重试。";
  } else if (status.data?.connected) {
    authTitle = status.data.account_display_name ?? (google ? "Google 用户" : "Microsoft 用户");
    authDescription = status.data.account_email ?? "未提供邮箱";
  } else {
    authTitle = "未授权";
    authDescription = "保存配置后登录相关服务账号进行授权";
  }
  // 图标反映查询状态；操作按钮仍按已有账号数据决定，保留刷新失败时的行为。
  const showVerified = !status.isPending && !status.error && status.data?.connected;
  return <>
    <TableRow hover>
      <TableCell sx={{ maxWidth: 240, overflowWrap: "anywhere", color: "text.primary" }}>{storage.name}</TableCell>
      <TableCell>{providerName}</TableCell>
      <TableCell>
        <Chip size="small" variant="outlined" color={local || status.data?.connected ? "success" : "default"}
          label={statusLabel} />
        {renaming && (
          <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
            正在执行重命名
          </Typography>
        )}
        {(status.error || authError) && (
          <Typography variant="caption" component="div" color="error"
            sx={{ mt: 0.5, maxWidth: 260, overflowWrap: "anywhere" }}>
            {statusErrorMessage}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">
        <Tooltip title={busy ? "连接忙碌，暂时无法编辑" : "编辑连接"}
          slotProps={{ tooltip: { sx: { fontSize: "caption.fontSize" } } }}>
          <span>
            <PanelIconButton aria-label={`编辑连接 ${storage.name}`} disabled={busy} onClick={openEditor}>
              <EditIcon />
            </PanelIconButton>
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
    <Dialog open={editing} fullWidth maxWidth="sm" sx={connectionBodySx}
      aria-labelledby={`edit-${storage.storage_id}-title`} onClose={closeEditor}>
      <DialogTitle id={`edit-${storage.storage_id}-title`}>{storage.name} 设置</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField variant="standard" label="连接名称" size="small" value={name} disabled={busy}
            onChange={(event) => setName(event.target.value)} />
          {local ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
              <TextField variant="standard" label="本地根目录" size="small" value={root} disabled={busy}
                onChange={(event) => setRoot(event.target.value)} sx={{ flex: 1, minWidth: 0 }} />
              <Tooltip title="浏览本地目录"
                slotProps={{ tooltip: { sx: { fontSize: "caption.fontSize" } } }}>
                <span>
                  <PanelIconButton aria-label="浏览本地目录" disabled={busy} onClick={() => pick.mutate()}>
                    <FolderOpenIcon />
                  </PanelIconButton>
                </span>
              </Tooltip>
            </Stack>
          ) : (
            <>
              <TextField variant="standard" label={google ? "Google Client ID" : "OneDrive App ID"} size="small" value={clientId}
                disabled={busy} onChange={(event) => setClientId(event.target.value)} />
              {google && <TextField variant="standard" label="Google Client Secret" type="password" size="small"
                value={clientSecret} autoComplete="new-password" disabled={busy}
                helperText={storage.has_client_secret ? "已保存密钥；留空保留原值。更改客户端配置后需重新登录。" : "请填写 Desktop OAuth 客户端的密钥，保存后登录 Google 账号。"}
                onChange={(event) => setClientSecret(event.target.value)} />}
            </>
          )}
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="text" disabled={saveDisabled} onClick={save}>保存</Button>
          </Box>
          {!local && (
            <>
              <Divider />
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                {showVerified ? (
                  <Verified sx={{ color: "success.main", flexShrink: 0 }} />
                ) : (
                  <ErrorIcon sx={{ color: "warning.main", flexShrink: 0 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                    {authTitle}
                  </Typography>
                  <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                    {authDescription}
                  </Typography>
                </Box>
                {status.data?.connected ? (
                  <Button variant="text" color="error" disabled={busy} sx={{ flexShrink: 0 }}
                    onClick={disconnectAccount}>
                    退出登录
                  </Button>
                ) : (
                  <Button variant="text" disabled={busy || !status.data?.configured} sx={{ flexShrink: 0 }}
                    onClick={beginAuthorization}>
                    {awaitingAuth ? "等待授权…" : "登录账号"}
                  </Button>
                )}
              </Stack>
            </>
          )}
          {(requestError || authError) && (
            <Alert severity="error">{requestErrorMessage}</Alert>
          )}
          {renaming && (
            <Alert severity="info">正在执行重命名，完成后可修改此连接。</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Tooltip title={isDefault ? "默认本地连接不可删除" : "删除连接配置和本地授权，不删除文件"}
          slotProps={{ tooltip: { sx: { fontSize: "caption.fontSize" } } }}>
          <span>
            <Button color="error" disabled={busy || isDefault} onClick={deleteConnection}>删除</Button>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button disabled={busy} onClick={closeEditor}>关闭</Button>
      </DialogActions>
    </Dialog>
  </>;
}

export function StorageSettingsPanel({ executingStorageId }: { executingStorageId?: string }) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const storages = useQuery({ queryKey: ["storages"], queryFn: fetchStorages });
  const providers = useQuery({ queryKey: ["storage-providers"], queryFn: fetchStorageProviders });
  const [provider, setProvider] = useState("local");
  const [name, setName] = useState("");
  const [config, setConfig] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [adding, setAdding] = useState(false);
  const create = useMutation({
    gcTime: 0,
    mutationFn: () => createStorage({
      provider_type: provider, name: name.trim(),
      config: provider === "local" ? { root_path: config.trim() } : { client_id: config.trim() || null },
      ...(provider === "google_drive" && clientSecret.trim() ? { client_secret: clientSecret.trim() } : {}),
    }),
    onSuccess: () => {
      setName("");
      setConfig("");
      setClientSecret("");
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: ["storages"] });
      notify("存储连接已创建。");
    },
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const pickDraft = useMutation({
    mutationFn: pickLocalFolderDraft,
    onSuccess: (result) => {
      if (result.selected) setConfig(result.root_path);
    },
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const addingBusy = create.isPending || pickDraft.isPending;
  const createError = create.error ?? pickDraft.error ?? providers.error;
  const createDisabled = addingBusy || providers.isPending || providers.isError ||
    !name.trim() || (provider === "local" && !config.trim());
  const selectedProvider = providers.data?.some(
    (definition) => definition.provider_type === provider,
  ) ? provider : "";
  const openAddDialog = () => {
    setProvider("local");
    setName("");
    setConfig("");
    setClientSecret("");
    create.reset();
    pickDraft.reset();
    setAdding(true);
  };
  const closeAddDialog = () => {
    if (!addingBusy) {
      setClientSecret("");
      setAdding(false);
    }
  };
  const changeProvider = (providerType: string) => {
    setProvider(providerType);
    setConfig("");
    setClientSecret("");
    pickDraft.reset();
  };
  const saveConnection = () => {
    if (Array.from(name.trim()).length > 20) {
      notify("连接名称最多为 20 个字符。", "error");
      return;
    }
    create.mutate();
  };
  return <>
    <Card variant="outlined" sx={connectionBodySx}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, p: { xs: 2, sm: 2.5 } }}>
        <Typography component="h3" variant="body2" sx={{ fontWeight: 500 }}>已保存连接</Typography>
        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={openAddDialog}>
          添加连接
        </Button>
      </Stack>
      <Divider />
      {storages.error && (
        <Alert severity="error" sx={{ m: 2 }}>{errorMessage(storages.error)}</Alert>
      )}
      {providers.error && (
        <Alert severity="error" sx={{ m: 2 }}>{errorMessage(providers.error)}</Alert>
      )}
      {storages.isPending ? (
        <Stack sx={{ p: 2 }} spacing={1}>
          <Skeleton height={36} />
          <Skeleton height={36} />
        </Stack>
      ) : (
        <TableContainer>
          <Table
            size="small"
            aria-label="已保存连接"
            sx={{
              minWidth: 500,
              "& th": { color: "text.secondary", fontWeight: 500 },
              "& th, & td": { px: { xs: 2, sm: 2.5 }, py: 1.5, fontSize: "body2.fontSize" },
              "& td": { whiteSpace: "normal" },
              "& tbody tr:last-child td": { borderBottom: 0 },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>连接名称</TableCell>
                <TableCell>连接服务</TableCell>
                <TableCell>连接状态</TableCell>
                <TableCell align="right" aria-label="连接操作" sx={{ width: 60 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {(storages.data ?? []).map((storage) => {
                const providerName = providers.data?.find(
                  (definition) => definition.provider_type === storage.provider_type,
                )?.name ?? (storage.provider_type === "local" ? "本地文件" : storage.provider_type === "google_drive" ? "Google Drive" : "OneDrive");
                return (
                  <ConnectionRow key={storage.storage_id} storage={storage}
                    executing={storage.storage_id === executingStorageId} providerName={providerName} />
                );
              })}
              {storages.isSuccess && storages.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center">尚未保存连接，请添加连接。</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
    <Dialog open={adding} fullWidth maxWidth="sm" sx={connectionBodySx} aria-labelledby="add-connection-title"
      onClose={closeAddDialog}>
      <DialogTitle id="add-connection-title">添加连接</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField variant="standard" select label="存储类型" size="small" value={selectedProvider}
            disabled={addingBusy} onChange={(event) => changeProvider(event.target.value)}>
            {(providers.data ?? []).map((definition) => (
              <MenuItem key={definition.provider_type} value={definition.provider_type}
                sx={{ fontSize: "body2.fontSize" }}>
                {definition.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField variant="standard" label="连接名称" size="small" value={name} disabled={addingBusy}
            onChange={(event) => setName(event.target.value)} />
          {provider === "local" ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
              <TextField variant="standard" label="本地根目录" size="small" value={config} disabled={addingBusy}
                onChange={(event) => setConfig(event.target.value)} sx={{ flex: 1, minWidth: 0 }} />
              <Tooltip title="浏览本地目录（在后端电脑打开，仅填入路径）"
                slotProps={{ tooltip: { sx: { fontSize: "caption.fontSize" } } }}>
                <span>
                  <PanelIconButton aria-label="浏览本地目录" disabled={addingBusy} onClick={() => pickDraft.mutate()}>
                    <FolderOpenIcon />
                  </PanelIconButton>
                </span>
              </Tooltip>
            </Stack>
          ) : (
            <>
              <TextField variant="standard" label={provider === "google_drive" ? "Google Client ID（可稍后配置）" : "OneDrive App ID（可稍后配置）"} size="small" value={config}
                disabled={addingBusy} onChange={(event) => setConfig(event.target.value)} />
              {provider === "google_drive" && <TextField variant="standard" label="Google Client Secret" type="password" size="small"
                value={clientSecret} autoComplete="new-password" disabled={addingBusy}
                helperText="使用自行创建的 Desktop OAuth 客户端 ID 和密钥；两项保存后才能登录。首期支持我的云端硬盘。"
                onChange={(event) => setClientSecret(event.target.value)} />}
            </>
          )}
          {createError && <Alert severity="error">{errorMessage(createError)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button disabled={addingBusy} onClick={closeAddDialog}>取消</Button>
        <Button variant="text" disabled={createDisabled} onClick={saveConnection}>保存连接</Button>
      </DialogActions>
    </Dialog>
  </>;
}

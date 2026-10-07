import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Chip, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createStorage, deleteStorage, disconnectStorage, fetchStorageAuthStatus, fetchStorageProviders, fetchStorages, pickStorageFolder, startStorageAuth, updateStorage } from "../../api/client";
import type { StorageInfo } from "../../types";
import { errorMessage, useNotification } from "../../components/NotificationProvider";

function ConnectionCard({ storage, executing }: { storage: StorageInfo; executing: boolean }) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [name, setName] = useState(storage.name);
  const [root, setRoot] = useState(storage.config.root_path ?? "");
  const [clientId, setClientId] = useState(storage.config.client_id ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const popup = useRef<Window | null>(null);
  const callbackOrigin = useRef<string>();
  const local = storage.provider_type === "local";
  const status = useQuery({
    queryKey: ["storage-auth", storage.storage_id, storage.revision],
    queryFn: () => fetchStorageAuthStatus(storage.storage_id),
    enabled: !local,
  });
  useEffect(() => {
    setName(storage.name);
    setRoot(storage.config.root_path ?? "");
    setClientId(storage.config.client_id ?? "");
  }, [storage.name, storage.config.root_path, storage.config.client_id]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["storages"] });
    void queryClient.invalidateQueries({ queryKey: ["storage-auth", storage.storage_id] });
    void queryClient.invalidateQueries({ queryKey: ["files", storage.storage_id] });
  };
  const operation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      refresh();
      notify("存储连接已更新。");
      setConfirmDelete(false);
    },
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const pick = useMutation({
    mutationFn: () => pickStorageFolder(storage.storage_id),
    onSuccess: (result) => {
      if (!result.selected) return;
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
      if (typeof data !== "object" || data === null || !("type" in data) || data.type !== "storage-auth" || !("storage_id" in data) || data.storage_id !== storage.storage_id || !("status" in data) || (data.status !== "connected" && data.status !== "failed")) return;
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
  const busy = executing || storage.busy || operation.isPending || pick.isPending || connect.isPending || awaitingAuth;
  const isDefault = storage.storage_id === "default-local";
  const requestError = operation.error ?? pick.error ?? connect.error ?? status.error;
  const save = () => operation.mutate(() => updateStorage(storage.storage_id, {
    name: name.trim(),
    config: local ? { root_path: root.trim() } : { client_id: clientId.trim() || null },
  }));
  const beginAuthorization = () => {
    popup.current = window.open("about:blank", `storage-auth-${storage.storage_id}`, "popup,width=600,height=720");
    if (!popup.current) {
      setAuthError("登录窗口被浏览器拦截，请允许弹窗。");
      return;
    }
    setAuthError(undefined);
    connect.mutate();
  };
  return <Card variant="outlined">
    <CardContent><Stack spacing={1.5}>
    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
      <Typography variant="h6">{storage.name}</Typography>
      <Chip size="small" color={local || status.data?.connected ? "success" : "default"}
        label={local ? "已连接" : status.isPending ? "正在读取连接状态…" : status.error ? "状态读取失败" : status.data?.connected ? "已连接" : "未连接"} />
    </Stack>
    <TextField label="连接名称" size="small" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
    {local ? <TextField label="本地根目录" size="small" value={root} disabled={busy} onChange={(event) => setRoot(event.target.value)} /> : <TextField label="OneDrive App ID" size="small" value={clientId} disabled={busy} onChange={(event) => setClientId(event.target.value)} />}
    <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
      <Button variant="contained" disabled={busy || !name.trim() || (local && !root.trim())} onClick={save}>保存连接</Button>
      {local && <Button variant="outlined" disabled={busy} onClick={() => pick.mutate()}>选择文件夹</Button>}
      {!local && <Button variant="outlined" disabled={busy || !status.data?.configured} onClick={beginAuthorization}>
        {awaitingAuth ? "等待授权…" : status.data?.connected ? "切换账号" : "网页登录"}
      </Button>}
      {!local && status.data?.connected && <Button variant="outlined" disabled={busy} onClick={() => operation.mutate(() => disconnectStorage(storage.storage_id))}>断开账号</Button>}
      {!isDefault && <Button variant="outlined" color="error" disabled={busy} onClick={() => setConfirmDelete(true)}>删除连接</Button>}
    </Stack>
    {!local && status.data?.connected && <Typography variant="body2" color="text.secondary">
      {status.data.account_display_name ?? "Microsoft 用户"}{status.data.account_email ? `(${status.data.account_email})` : ""}
    </Typography>}
    {(requestError || authError) && <Alert severity="error">{authError ?? (requestError ? errorMessage(requestError) : "")}</Alert>}
    {(executing || storage.busy) && <Alert severity="info">正在执行重命名，完成后可修改此连接。</Alert>}
    <Dialog open={confirmDelete} onClose={() => { if (!busy) setConfirmDelete(false); }}>
      <DialogTitle>删除存储连接</DialogTitle>
      <DialogContent>删除“{storage.name}”的配置和本地授权，不删除存储中的文件。</DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setConfirmDelete(false)}>取消</Button>
        <Button disabled={busy} color="error" onClick={() => operation.mutate(() => deleteStorage(storage.storage_id))}>删除连接</Button>
      </DialogActions>
    </Dialog>
    </Stack></CardContent>
  </Card>;
}

export function StorageSettingsPanel({ executingStorageId }: { executingStorageId?: string }) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const storages = useQuery({ queryKey: ["storages"], queryFn: fetchStorages });
  const providers = useQuery({ queryKey: ["storage-providers"], queryFn: fetchStorageProviders });
  const [provider, setProvider] = useState("local");
  const [name, setName] = useState("");
  const [config, setConfig] = useState("");
  const create = useMutation({
    mutationFn: () => createStorage({
      provider_type: provider, name: name.trim(),
      config: provider === "local" ? { root_path: config.trim() } : { client_id: config.trim() || null },
    }),
    onSuccess: () => {
      setName("");
      setConfig("");
      void queryClient.invalidateQueries({ queryKey: ["storages"] });
      notify("存储连接已创建。");
    },
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const createError = create.error ?? providers.error;
  return <Stack spacing={2}>
    <Card variant="outlined"><CardContent><Stack spacing={1.5}><Typography variant="h6">添加存储连接</Typography>
      <TextField select label="存储类型" size="small" value={providers.data?.some((definition) => definition.provider_type === provider) ? provider : ""} disabled={create.isPending} onChange={(event) => { setProvider(event.target.value); setConfig(""); }}>{(providers.data ?? []).map((definition) => <MenuItem key={definition.provider_type} value={definition.provider_type}>{definition.name}</MenuItem>)}</TextField>
      <TextField label="连接名称" size="small" value={name} disabled={create.isPending} onChange={(event) => setName(event.target.value)} />
      <TextField label={provider === "local" ? "本地根目录" : "OneDrive App ID（可稍后配置）"} size="small" value={config} disabled={create.isPending} onChange={(event) => setConfig(event.target.value)} />
      <Button variant="contained" disabled={create.isPending || providers.isPending || !name.trim() || (provider === "local" && !config.trim())} onClick={() => create.mutate()}>添加连接</Button>
      {createError && <Alert severity="error">{errorMessage(createError)}</Alert>}
    </Stack></CardContent></Card>
    {storages.error && <Alert severity="error">{errorMessage(storages.error)}</Alert>}
    {(storages.data ?? []).map((storage) => <ConnectionCard key={storage.storage_id} storage={storage} executing={storage.storage_id === executingStorageId} />)}
  </Stack>;
}

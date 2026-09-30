import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Skeleton from "@mui/material/Skeleton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearOneDriveSettings,
  disconnectOneDriveAccount,
  fetchOneDriveSettings,
  fetchOneDriveStatus,
  startOneDriveAuth,
  updateOneDriveSettings,
} from "../../api/client";
import { errorMessage, useNotification } from "../../components/NotificationProvider";

export function OneDriveSettingsPanel() {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [popupError, setPopupError] = useState<string>();
  const settings = useQuery({
    queryKey: ["onedrive", "settings"],
    queryFn: fetchOneDriveSettings,
  });
  const status = useQuery({
    queryKey: ["onedrive", "status"],
    queryFn: fetchOneDriveStatus,
  });

  useEffect(() => {
    if (settings.data?.client_id) setClientId(settings.data.client_id);
  }, [settings.data?.client_id]);

  useEffect(() => {
    const receiveAuthResult = (event: MessageEvent) => {
      const callbackOrigin = settings.data?.redirect_uri
        ? new URL(settings.data.redirect_uri).origin
        : undefined;
      if (!callbackOrigin || event.origin !== callbackOrigin) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null || !("type" in data) || !("status" in data)) return;
      if (data.type !== "onedrive-auth") return;
      if (data.status !== "connected" && data.status !== "failed") return;
      const message = "message" in data && typeof data.message === "string"
        ? data.message
        : "OneDrive 授权失败，请重试。";
      notify(
        data.status === "connected" ? "OneDrive 登录成功。" : message,
        data.status === "connected" ? "success" : "error",
      );
      setPopupError(
        data.status === "failed"
          ? message
          : undefined,
      );
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
    };
    window.addEventListener("message", receiveAuthResult);
    return () => window.removeEventListener("message", receiveAuthResult);
  }, [queryClient, settings.data?.redirect_uri, notify]);

  const save = useMutation({
    mutationFn: () => updateOneDriveSettings(clientId.trim()),
    onSuccess: async () => {
      setPopupError(undefined);
      notify("App ID 已保存。");
      await queryClient.invalidateQueries({ queryKey: ["onedrive"] });
    },
    onError: (error) => notify(`保存失败：${errorMessage(error)}`, "error"),
  });
  const clear = useMutation({
    mutationFn: clearOneDriveSettings,
    onSuccess: async () => {
      setClientId("");
      setPopupError(undefined);
      notify("App ID 和账号授权已清理。");
      await queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      await queryClient.removeQueries({ queryKey: ["files", "onedrive"] });
    },
    onError: (error) => notify(`清理失败：${errorMessage(error)}`, "error"),
  });
  const connect = useMutation({
    mutationFn: startOneDriveAuth,
    onSuccess: ({ authorization_url }) => {
      setPopupError(undefined);
      const popup = window.open(
        authorization_url,
        "onedrive-auth",
        "popup=yes,width=640,height=760",
      );
      if (!popup) {
        const message = "浏览器阻止了登录窗口，请允许本站弹出窗口后重试。";
        setPopupError(message);
        notify(message, "error");
      } else notify("登录窗口已打开，请在窗口中完成授权。", "info");
    },
    onError: (error) => notify(`登录启动失败：${errorMessage(error)}`, "error"),
  });
  const disconnect = useMutation({
    mutationFn: disconnectOneDriveAccount,
    onSuccess: async () => {
      setPopupError(undefined);
      notify("OneDrive 账号已断开。");
      await queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      await queryClient.removeQueries({ queryKey: ["files", "onedrive"] });
    },
    onError: (error) => notify(`断开失败：${errorMessage(error)}`, "error"),
  });

  const error =
    save.error ??
    clear.error ??
    connect.error ??
    disconnect.error ??
    settings.error ??
    status.error;
  const initialLoading = settings.isPending || status.isPending;
  const busy = save.isPending || clear.isPending || connect.isPending || disconnect.isPending;

  return (
    <section className="panel settings-panel" aria-labelledby="onedrive-settings-title">
      <div className="panel-heading">
        <h2 id="onedrive-settings-title">连接设置</h2>
        {status.isPending ? <Chip size="small" label="正在读取连接状态…" /> : status.isError ? (
          <Chip size="small" color="error" label="连接状态读取失败" />
        ) : <Chip
          size="small"
          color={status.data?.connected ? "success" : "warning"}
          label={status.data?.connected ? "已连接" : "未连接"}
        />}
      </div>
      {!initialLoading && (settings.isFetching || status.isFetching) && (
        <LinearProgress aria-label="正在刷新连接设置" />
      )}
      <div className="settings-content">
        {initialLoading && (
          <Stack spacing={1} role="status" aria-label="正在加载连接设置">
            <Skeleton variant="rounded" height={40} />
            <Skeleton width="60%" height={32} />
          </Stack>
        )}
        <TextField
          fullWidth
          size="small"
          label="App ID"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder="应用程序（客户端）ID"
          autoComplete="off"
          disabled={initialLoading || busy}
        />
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button
            variant="contained"
            onClick={() => save.mutate()}
            disabled={initialLoading || busy || !clientId.trim()}
            startIcon={save.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {save.isPending ? "正在保存…" : "保存 App ID"}
          </Button>
          <Button
            variant="outlined"
            onClick={() => connect.mutate()}
            disabled={initialLoading || busy || !status.data?.configured}
            startIcon={connect.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {connect.isPending ? "正在打开登录…" : status.data?.connected ? "切换账号" : "网页登录"}
          </Button>
          {status.data?.connected && (
            <Button
              variant="outlined"
              onClick={() => disconnect.mutate()}
              disabled={initialLoading || busy}
              startIcon={disconnect.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {disconnect.isPending ? "正在断开…" : "断开账号"}
            </Button>
          )}
          <Button
            variant="outlined"
            color="error"
            onClick={() => {
              if (window.confirm("清除本地保存的 App ID 和当前账号授权？")) clear.mutate();
            }}
            disabled={initialLoading || busy || !settings.data?.configured}
            startIcon={clear.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {clear.isPending ? "正在清理…" : "清理设置"}
          </Button>
        </Stack>
        {status.data?.connected && (
          <p className="settings-hint">
            当前账号：{status.data.account_display_name ?? "Microsoft 用户"}
            {status.data.account_email ? `（${status.data.account_email}）` : ""}
          </p>
        )}
        {settings.data && (
          <p className="settings-hint">
            填入 App ID 后再网页登录账号以刷新令牌。
          </p>
        )}
        {(error || popupError) && (
          <Alert severity="error">{popupError ?? error?.message}</Alert>
        )}
      </div>
    </section>
  );
}

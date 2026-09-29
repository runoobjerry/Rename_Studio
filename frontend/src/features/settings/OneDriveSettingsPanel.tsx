import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
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

export function OneDriveSettingsPanel() {
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
      const data = event.data as { type?: string; status?: string; message?: string };
      if (data.type !== "onedrive-auth") return;
      setPopupError(
        data.status === "failed"
          ? data.message || "OneDrive 授权失败，请重试。"
          : undefined,
      );
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
    };
    window.addEventListener("message", receiveAuthResult);
    return () => window.removeEventListener("message", receiveAuthResult);
  }, [queryClient, settings.data?.redirect_uri]);

  const save = useMutation({
    mutationFn: () => updateOneDriveSettings(clientId.trim()),
    onSuccess: async () => {
      setPopupError(undefined);
      await queryClient.invalidateQueries({ queryKey: ["onedrive"] });
    },
  });
  const clear = useMutation({
    mutationFn: clearOneDriveSettings,
    onSuccess: async () => {
      setClientId("");
      setPopupError(undefined);
      await queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      await queryClient.removeQueries({ queryKey: ["files", "onedrive"] });
    },
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
      if (!popup) setPopupError("浏览器阻止了登录窗口，请允许本站弹出窗口后重试。");
    },
  });
  const disconnect = useMutation({
    mutationFn: disconnectOneDriveAccount,
    onSuccess: async () => {
      setPopupError(undefined);
      await queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      await queryClient.removeQueries({ queryKey: ["files", "onedrive"] });
    },
  });

  const error =
    save.error ??
    clear.error ??
    connect.error ??
    disconnect.error ??
    settings.error ??
    status.error;

  return (
    <section className="panel settings-panel" aria-labelledby="onedrive-settings-title">
      <div className="panel-heading">
        <h2 id="onedrive-settings-title">连接设置</h2>
        <Chip
          size="small"
          color={status.data?.connected ? "success" : "warning"}
          label={status.data?.connected ? "已连接" : "未连接"}
        />
      </div>
      <div className="settings-content">
        <TextField
          fullWidth
          size="small"
          label="App ID"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder="应用程序（客户端）ID"
          autoComplete="off"
        />
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button
            variant="contained"
            onClick={() => save.mutate()}
            disabled={!clientId.trim() || save.isPending}
          >
            保存 App ID
          </Button>
          <Button
            variant="outlined"
            onClick={() => connect.mutate()}
            disabled={!status.data?.configured || connect.isPending}
          >
            {status.data?.connected ? "切换账号" : "网页登录"}
          </Button>
          {status.data?.connected && (
            <Button
              variant="outlined"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              断开账号
            </Button>
          )}
          <Button
            variant="outlined"
            color="error"
            onClick={() => {
              if (window.confirm("清除本地保存的 App ID 和当前账号授权？")) clear.mutate();
            }}
            disabled={!settings.data?.configured || clear.isPending}
          >
            清理设置
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

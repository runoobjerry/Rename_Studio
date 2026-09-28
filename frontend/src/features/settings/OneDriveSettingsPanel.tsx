import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearOneDriveSettings,
  fetchOneDriveSettings,
  fetchOneDriveStatus,
  startOneDriveAuth,
  updateOneDriveSettings,
} from "../../api/client";

export function OneDriveSettingsPanel() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
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
      const data = event.data as { type?: string; status?: string };
      if (data.type !== "onedrive-auth") return;
      setPopupError(data.status === "failed" ? "OneDrive 授权失败，请重试。" : undefined);
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
    };
    window.addEventListener("message", receiveAuthResult);
    return () => window.removeEventListener("message", receiveAuthResult);
  }, [queryClient, settings.data?.redirect_uri]);

  const save = useMutation({
    mutationFn: () => updateOneDriveSettings(clientId.trim(), clientSecret),
    onSuccess: async () => {
      setClientSecret("");
      setPopupError(undefined);
      await queryClient.invalidateQueries({ queryKey: ["onedrive"] });
    },
  });
  const clear = useMutation({
    mutationFn: clearOneDriveSettings,
    onSuccess: async () => {
      setClientId("");
      setClientSecret("");
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

  const error = save.error ?? clear.error ?? connect.error ?? settings.error ?? status.error;

  return (
    <section className="panel settings-panel" aria-labelledby="onedrive-settings-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">OneDrive Personal</p>
          <h2 id="onedrive-settings-title">连接设置</h2>
        </div>
        <span className={`connection-status ${status.data?.connected ? "connected" : ""}`}>
          {status.data?.connected ? "已连接" : "未连接"}
        </span>
      </div>
      <div className="settings-content">
        <label>
          App ID
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="应用程序（客户端）ID"
            autoComplete="off"
          />
        </label>
        <label>
          客户端密钥
          <input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={settings.data?.client_secret_configured ? "已设置；重新保存时请再次填写" : "Client secret value"}
            autoComplete="new-password"
          />
        </label>
        <div className="settings-actions">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!clientId.trim() || !clientSecret || save.isPending}
          >
            保存设置
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => connect.mutate()}
            disabled={!status.data?.configured || connect.isPending}
          >
            连接账号
          </button>
          <button
            type="button"
            className="clear-button"
            onClick={() => {
              if (window.confirm("清除 App ID、密钥、授权状态和内存令牌？")) clear.mutate();
            }}
            disabled={!settings.data?.configured || clear.isPending}
          >
            清理设置
          </button>
        </div>
        {settings.data && (
          <p className="settings-hint">
            Azure 重定向 URI：<code>{settings.data.redirect_uri}</code>。App ID 和密钥保存在后端本地，授权令牌仅保存在内存中。
          </p>
        )}
        {(error || popupError) && (
          <p className="inline-error">{popupError ?? error?.message}</p>
        )}
      </div>
    </section>
  );
}

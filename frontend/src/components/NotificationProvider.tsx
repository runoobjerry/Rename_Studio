import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { ApiError } from "../api/client";

type Severity = "success" | "info" | "warning" | "error";
type Notify = (message: string, severity?: Severity) => void;
const NotificationContext = createContext<Notify | null>(null);

export function errorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.code === "AUTHENTICATION_ERROR") return `账号授权失效，请重新登录。${error.message}`;
    if (error.code === "PREVIEW_EXPIRED") return `预览已过期或文件状态已变化，请重新预览。${error.message}`;
    if (error.code === "RATE_LIMIT_ERROR") return `请求过于频繁，请稍后重试。${error.message}`;
  }
  return error.message;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [messages, setMessages] = useState<Array<{ id: number; message: string; severity: Severity }>>([]);
  const notify = useCallback<Notify>((message, severity = "success") => {
    const id = nextId.current++;
    setMessages((current) => [...current, { id, message, severity }]);
  }, []);
  const dismiss = () => setMessages((current) => current.slice(1));
  const current = messages[0];

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      {current && (
        <Snackbar
          key={current.id}
          open
          autoHideDuration={current.severity === "error" ? 8000 : 5000}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          onClose={(_, reason) => { if (reason !== "clickaway") dismiss(); }}
        >
          <Alert severity={current.severity} variant="filled" onClose={dismiss} sx={{ width: "100%" }}>
            {current.message}
          </Alert>
        </Snackbar>
      )}
    </NotificationContext.Provider>
  );
}

export function useNotification(): Notify {
  const notify = useContext(NotificationContext);
  if (!notify) throw new Error("useNotification requires NotificationProvider");
  return notify;
}

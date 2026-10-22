import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { useTranslation } from "react-i18next";
import { translateMessage, type NotificationMessage } from "../i18n/messages";
export { errorMessage } from "../i18n/messages";

type Severity = "success" | "info" | "warning" | "error";
type Notify = (message: NotificationMessage, severity?: Severity) => void;
const NotificationContext = createContext<Notify | null>(null);
interface Notification {
  id: number;
  message: NotificationMessage;
  severity: Severity;
  open: boolean;
  replaced: boolean;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const nextId = useRef(0);
  const enteredIds = useRef(new Set<number>());
  const [messages, setMessages] = useState<Notification[]>([]);
  const notify = useCallback<Notify>((message, severity = "success") => {
    const id = nextId.current++;
    setMessages((current) => [
      ...current.map((item) => item.open ? { ...item, open: false, replaced: true } : item),
      { id, message, severity, open: true, replaced: false },
    ]);
  }, []);
  const dismiss = (id: number) => setMessages((current) => current.map((item) =>
    item.id === id ? { ...item, open: false } : item,
  ));
  const remove = (id: number) => {
    enteredIds.current.delete(id);
    setMessages((current) => current.filter((item) => item.id !== id));
  };

  useEffect(() => {
    // 同一批更新中的中间通知未进入过渡，不会触发 onExited，需要直接回收。
    if (messages.some((item) => !item.open && !enteredIds.current.has(item.id))) {
      setMessages((current) => current.filter((item) => item.open || enteredIds.current.has(item.id)));
    }
  }, [messages]);

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      {messages.map((item) => (
        <Snackbar
          key={item.id}
          open={item.open}
          autoHideDuration={5000}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          aria-hidden={!item.open}
          sx={{ pointerEvents: item.open ? "auto" : "none" }}
          slotProps={{ transition: {
            timeout: { enter: 225, exit: 180 },
            onEnter: () => { enteredIds.current.add(item.id); },
            onExited: () => remove(item.id),
          } }}
          onClose={(_, reason) => { if (reason !== "clickaway") dismiss(item.id); }}
        >
          <Alert
            severity={item.severity}
            variant="filled"
            onClose={() => dismiss(item.id)}
            // 被替换时覆盖 Grow 的缩放，只在原地淡出；正常关闭保留反向 Grow。
            sx={{ width: "100%", ...(item.replaced && { transform: "none !important" }) }}
          >
            {translateMessage(item.message, t)}
          </Alert>
        </Snackbar>
      ))}
    </NotificationContext.Provider>
  );
}

export function useNotification(): Notify {
  const notify = useContext(NotificationContext);
  if (!notify) throw new Error("useNotification requires NotificationProvider");
  return notify;
}

import { browserNavigatorReady, openBrowserFolder, type NavigationReply } from "./navigation";
import { BROWSER_NAMESPACE, BROWSER_ORIGIN, parseBrowserTarget, validRequestId } from "./protocol";

// Same-origin checks constrain this to navigation intent; they do not authenticate an extension.
export function installBrowserBridge(onTransportProblem: (code: string) => void, host: Window = window) {
  if (host.location.origin !== BROWSER_ORIGIN || host.top !== host) return () => {};
  let active: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  const post = (type: string, requestId: string, payload: object) => host.postMessage({
    namespace: BROWSER_NAMESPACE, direction: "app-to-extension", version: 1,
    type, request_id: requestId, ...payload,
  }, BROWSER_ORIGIN);
  const reject = (id: string, code: string) => {
    post("navigation-reply", id, { reply: { version: 1, request_id: id, status: "rejected", code } });
    onTransportProblem(code);
  };
  const receive = (event: MessageEvent<unknown>) => {
    const value = event.data;
    if (event.source !== host || event.origin !== BROWSER_ORIGIN || !value || typeof value !== "object" || Array.isArray(value)) return;
    const data = value as Record<string, unknown>;
    if (data.namespace !== BROWSER_NAMESPACE || data.direction !== "extension-to-app" || !validRequestId(data.request_id)) return;
    const requestId = data.request_id;
    if (data.type === "probe") {
      if (data.version === 1 && Object.keys(data).length === 5 && browserNavigatorReady()) {
        post("ready", requestId, { project: "rename-studio" });
      }
      return;
    }
    if (data.type !== "navigate") return;
    if (data.version !== 1) { reject(requestId, "unsupported_version"); return; }
    if (Object.keys(data).length !== 6) { reject(requestId, "invalid_request"); return; }
    const parsed = parseBrowserTarget(data.request);
    if ("code" in parsed) { reject(requestId, parsed.code); return; }
    if (parsed.request.request_id !== requestId) { reject(requestId, "invalid_request"); return; }
    if (active?.id === requestId) return;
    if (active) { reject(requestId, "busy"); return; }
    const entry = { id: requestId, timer: setTimeout(() => {
      if (active !== entry) return;
      active = null;
      onTransportProblem("result_timeout");
    }, 20000) };
    active = entry;
    const sendReply = (reply: NavigationReply) => {
      if (active === entry) post("navigation-reply", entry.id, { reply });
    };
    void openBrowserFolder(parsed.request, sendReply).then(sendReply, () => {
      // Unexpected application failure has no reliable open result. Never assert it did not navigate.
      if (active === entry) onTransportProblem("result_timeout");
    }).finally(() => {
      clearTimeout(entry.timer);
      if (active === entry) active = null;
    });
  };
  host.addEventListener("message", receive);
  return () => {
    host.removeEventListener("message", receive);
    if (active) clearTimeout(active.timer);
    active = null;
  };
}

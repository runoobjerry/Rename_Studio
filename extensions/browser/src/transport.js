import { NAMESPACE, PROJECT, validateOpenRequest } from "./protocol.js";
import { findSiteAdapter } from "./adapters/index.js";

export class TransportError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function deadline(promise, milliseconds, code) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TransportError(code)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
export function isSource(sender, extensionId) {
  // Chrome owns the ID types and sender origin; only check the required source context.
  return sender.id === extensionId && sender.frameId === 0 && Boolean(sender.documentId) &&
    sender.tab?.incognito === false && Boolean(findSiteAdapter(sender.origin));
}

export async function findWorkspace(api, origin) {
  const tabs = await api.tabs.query({ url: "http://localhost/*" });
  const candidates = tabs.filter((tab) => !tab.incognito && tab.url && new URL(tab.url).origin === origin);
  const responses = await Promise.all(candidates.map(async (tab) => {
    const requestId = crypto.randomUUID();
    const sendProbe = () => api.tabs.sendMessage(tab.id,
      { namespace: NAMESPACE, type: "probe", version: 1, request_id: requestId }, { frameId: 0 });
    try {
      const ready = await deadline(sendProbe().catch(async () => {
        // Install or reload can leave an already-open tab without a live receiver.
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["workspace.js"] });
        return sendProbe();
      }), 1500, "transport_unavailable");
      return ready?.namespace === NAMESPACE && ready.type === "ready" && ready.project === PROJECT &&
        ready.version === 1 && ready.request_id === requestId &&
        typeof ready.instance_id === "string" && /^[a-z0-9-]{36}$/iu.test(ready.instance_id)
        ? { tab, instanceId: ready.instance_id } : null;
    } catch { return null; } // Unreachable tabs cannot participate in workspace selection.
  }));
  const ready = responses.filter(Boolean);
  if (ready.length === 0) throw new TransportError("workspace_not_found");
  if (ready.length > 1) throw new TransportError("multiple_workspaces");
  return ready[0];
}

export async function routeNavigation(api, origin, source, requestId, context) {
  const initial = await api.tabs.get(source.tab.id);
  const sourceUrl = initial.url;
  const adapter = findSiteAdapter(source.origin);
  if (!adapter || !sourceUrl || new URL(sourceUrl).origin !== adapter.origin) throw new TransportError("page_changed");
  // Discover first, then extract current context. Never collect browsing state in the background.
  const workspace = await findWorkspace(api, origin);
  if (!context.active) throw new TransportError("cancelled");
  const current = await api.tabs.get(source.tab.id);
  if (current.url !== sourceUrl) throw new TransportError("page_changed");
  const [injection] = await deadline(api.scripting.executeScript({
    target: { tabId: source.tab.id, documentIds: [source.documentId] }, world: "MAIN",
    func: adapter.extract, args: [requestId],
  }), 12000, "request_timeout");
  if (!context.active) throw new TransportError("cancelled");
  const result = injection?.result;
  if (!result || typeof result.ok !== "boolean") throw new TransportError("invalid_response");
  if (!result.ok) throw new TransportError(EXTRACTION_CODES.has(result.code) ? result.code : "invalid_response");
  const invalid = validateOpenRequest(result.request);
  if (invalid || result.request.type !== adapter.requestType || result.request.request_id !== requestId) throw new TransportError(invalid ?? "invalid_request");
  const latestSource = await api.tabs.get(source.tab.id);
  if (latestSource.url !== sourceUrl || injection.documentId !== source.documentId) throw new TransportError("page_changed");
  context.workspace = workspace;
  context.sent = true;
  const reply = await deadline(api.tabs.sendMessage(workspace.tab.id, {
    namespace: NAMESPACE, type: "navigate", version: 1, instance_id: workspace.instanceId,
    request_id: requestId, request: result.request,
  }, { frameId: 0 }), 20000, "result_timeout");
  // Page replies are validated in the content script. An expired/missing receiver has no result.
  if (reply == null) throw new TransportError("result_timeout");
  return reply;
}

const EXTRACTION_CODES = new Set(["account_email_unverified", "context_unavailable", "invalid_page_data", "account_format_unsupported",
  "unsupported_view", "unsupported_scope", "scope_unverified", "page_changed", "auth_required",
  "permission_denied", "rate_limited", "directory_unavailable", "network_error", "request_timeout",
  "invalid_response", "provider_error"]);

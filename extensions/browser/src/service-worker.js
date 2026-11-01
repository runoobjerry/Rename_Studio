import { WORKSPACE_ORIGIN } from "./config.js";
import { NAMESPACE, validRequestId } from "./protocol.js";
import { isSource, routeNavigation, TransportError } from "./transport.js";

// Only live requests are held in memory. Worker/document loss never replays navigation.
const pending = new Map();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.namespace !== NAMESPACE) return;
  if (message.type === "navigation-accepted") {
    const operation = [...pending.values()].find((entry) => entry.requestId === message.request_id);
    const workspace = operation?.workspace;
    if (!operation?.active || operation.accepted || !workspace || sender.id !== chrome.runtime.id ||
        sender.frameId !== 0 || sender.origin !== WORKSPACE_ORIGIN ||
        sender.tab?.id !== workspace.tab.id || sender.tab.incognito ||
        message.instance_id !== workspace.instanceId) return;
    operation.accepted = true;
    // These are UI effects only; a disappearing tab must not change the directory outcome.
    void Promise.allSettled([
      chrome.tabs.sendMessage(operation.source.tab.id, { namespace: NAMESPACE,
        type: "accepted", request_id: operation.requestId }, { documentId: operation.source.documentId }),
      chrome.tabs.update(workspace.tab.id, { active: true }),
      chrome.windows.update(workspace.tab.windowId, { focused: true }),
    ]).then(() => respond({ ok: true }));
    return true;
  }
  if (message.type !== "open-current-folder" || !validRequestId(message.request_id) ||
      Object.keys(message).length !== 3 || !isSource(sender, chrome.runtime.id)) return;
  if (pending.has(sender.tab.id)) {
    respond({ transport: "rejected", code: "busy" });
    return;
  }
  const operation = { active: true, sent: false, accepted: false, source: sender, requestId: message.request_id };
  pending.set(sender.tab.id, operation);
  void routeNavigation(chrome, WORKSPACE_ORIGIN, sender, message.request_id, operation)
    .then(respond, (error) => {
      const code = operation.sent ? "result_timeout" : error instanceof TransportError ? error.code : "transport_unavailable";
      respond({ transport: code === "result_timeout" ? "unconfirmed" : "rejected", code });
    })
    .finally(() => {
      operation.active = false;
      if (pending.get(sender.tab.id) === operation) pending.delete(sender.tab.id);
    });
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  const operation = pending.get(tabId);
  if (operation) operation.active = false;
  pending.delete(tabId);
});

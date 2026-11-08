import { WORKSPACE_ORIGIN } from "./config.js";
import { NAMESPACE, PROJECT, validReply, validRequestId } from "./protocol.js";

// Manifest injection and on-demand recovery can meet in the same isolated world.
const bridgeKey = Symbol.for(`${NAMESPACE}.workspace`);
if (window.top === window && location.origin === WORKSPACE_ORIGIN && !window[bridgeKey]) {
  const instanceId = crypto.randomUUID();
  const pending = new Map();
  const post = (type, requestId, extra = {}) => window.postMessage({
    namespace: NAMESPACE, direction: "extension-to-app", version: 1,
    type, request_id: requestId, ...extra,
  }, WORKSPACE_ORIGIN);
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== WORKSPACE_ORIGIN || data?.namespace !== NAMESPACE ||
        data.direction !== "app-to-extension" || data.version !== 1 || !validRequestId(data.request_id)) return;
    const entry = pending.get(data.request_id);
    if (!entry) return;
    if (entry.type === "probe" && data.type === "ready" && data.project === PROJECT && Object.keys(data).length === 6) {
      entry.finish({ namespace: NAMESPACE, version: 1, type: "ready", project: PROJECT,
        request_id: data.request_id, instance_id: instanceId });
    } else if (entry.type === "navigate" && data.type === "navigation-reply" && Object.keys(data).length === 6 &&
        validReply(data.reply, data.request_id)) {
      if (data.reply.status === "accepted") {
        if (entry.accepted) return;
        entry.accepted = true;
        entry.acceptance = chrome.runtime.sendMessage({ namespace: NAMESPACE, type: "navigation-accepted",
          request_id: data.request_id, instance_id: instanceId }).catch(() => {
          // The worker was disconnected. Final page navigation can still complete independently.
        });
      } else void entry.acceptance.then(() => entry.finish(data.reply));
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.namespace !== NAMESPACE || message.version !== 1 ||
        !validRequestId(message.request_id) || !["probe", "navigate"].includes(message.type)) return;
    // Target payload was checked by the worker; this guard only pins the destination document.
    if (message.type === "navigate" && message.instance_id !== instanceId) return;
    if (pending.has(message.request_id)) return;
    // No request queue, including probes. Each wait is bounded and discarded on timeout.
    const timer = setTimeout(() => entry.finish(null), message.type === "probe" ? 1200 : 19500);
    const entry = { type: message.type, accepted: false, acceptance: Promise.resolve(), finish: (reply) => {
      if (pending.get(message.request_id) !== entry) return;
      clearTimeout(timer);
      pending.delete(message.request_id);
      respond(reply);
    } };
    pending.set(message.request_id, entry);
    post(message.type, message.request_id, message.type === "navigate" ? { request: message.request } : {});
    return true;
  });
  window[bridgeKey] = true;
}

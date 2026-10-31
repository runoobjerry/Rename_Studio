import { extractOneDriveFolder } from "./onedrive-page.js";
import { NAMESPACE, validateOpenRequest } from "./protocol.js";

// TEMPORARY: remove action/debug output when the floating button is connected.
const latest = new Map();
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || tab.incognito) return;
  const requestId = crypto.randomUUID();
  latest.set(tab.id, requestId);
  let summary;
  try {
    if (!tab.url || new URL(tab.url).origin !== "https://onedrive.live.com") {
      summary = { ok: false, code: "unsupported_view" };
    } else {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: extractOneDriveFolder, args: [requestId],
      });
      if (latest.get(tab.id) !== requestId) return;
      const current = await chrome.tabs.get(tab.id);
      if (current.url !== tab.url) summary = { ok: false, code: "page_changed" };
      else {
        const result = injection?.result;
        if (!result || typeof result.ok !== "boolean") summary = { ok: false, code: "invalid_response" };
        else if (!result.ok) summary = { ok: false, code: ERROR_CODES.has(result.code) ? result.code : "invalid_response" };
        else {
          const error = validateOpenRequest(result.request);
          if (error || result.request.request_id !== requestId) summary = { ok: false, code: error ?? "invalid_request" };
          else {
            // No raw account/folder data reaches logs or the ISOLATED script.
            summary = { ok: true, fields: Object.fromEntries(Object.entries(result.request)
              .filter(([key]) => !["version", "type", "request_id"].includes(key))
              .map(([key, value]) => [key, { present: true, length: value.length }])) };
          }
        }
      }
      if (latest.get(tab.id) !== requestId) return;
      await chrome.tabs.sendMessage(tab.id, { namespace: NAMESPACE, type: "debug-result", summary },
        { documentId: injection.documentId });
    }
  } catch {
    // Injection/document teardown has no navigation side effects; retry explicitly.
    summary = { ok: false, code: "transport_unavailable" };
  }
  if (latest.get(tab.id) !== requestId) return;
  latest.delete(tab.id);
  console.info("Rename Studio extraction (redacted)", summary);
  await chrome.action.setBadgeText({ tabId: tab.id, text: summary.ok ? "OK" : "!" });
  await chrome.action.setTitle({ tabId: tab.id,
    title: chrome.i18n.getMessage(summary.ok ? "debugSuccess" : "debugFailure") +
      (summary.ok ? "" : ` (${summary.code})`) });
});
chrome.tabs.onRemoved.addListener((tabId) => latest.delete(tabId));

const ERROR_CODES = new Set(["context_unavailable", "invalid_page_data", "account_format_unsupported",
  "unsupported_view", "unsupported_scope", "scope_unverified", "page_changed", "auth_required",
  "permission_denied", "rate_limited", "directory_unavailable", "network_error", "request_timeout",
  "invalid_response", "provider_error"]);

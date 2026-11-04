import { findRequestAdapter } from "./adapters/index.js";

// Keep these boundaries synchronized with docs/BROWSER_PROTOCOL.md.
export const NAMESPACE = "rename-studio.browser.v1";
export const PROJECT = "rename-studio";
export const validRequestId = (value) => typeof value === "string" && /^[a-z0-9_-]{1,64}$/iu.test(value);
export const validCode = (value) => typeof value === "string" && /^[a-z0-9_]{1,64}$/iu.test(value);
export function validReply(value, requestId) {
  if (!value || value.version !== 1 || value.request_id !== requestId) return false;
  if (value.status === "accepted") return Object.keys(value).length === 3;
  if (value.status === "rejected") return validCode(value.code) && Object.keys(value).length === 4;
  return value.status === "opened" && typeof value.storage_id === "string" &&
    value.storage_id.trim().length > 0 && value.storage_id.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value.storage_id) && Object.keys(value).length === 4;
}
export function validateOpenRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid_request";
  if (value.version !== 1) return "unsupported_version";
  const adapter = findRequestAdapter(value.type);
  return adapter ? adapter.validateRequest(value) : "invalid_request";
}

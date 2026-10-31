// Keep these boundaries synchronized with docs/BROWSER_INTEGRATION.md.
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
export const LIMITS = Object.freeze({ request_id: 64, account_cid: 16,
  folder_id: 256, drive_id: 256, account_email: 320,
  account_display_name: 256, folder_name: 256 });

export function validateOpenRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid_request";
  if (value.version !== 1) return "unsupported_version";
  const allowed = new Set(["version", "type", ...Object.keys(LIMITS)]);
  if (Object.keys(value).some((key) => !allowed.has(key)) ||
      value.type !== "open-onedrive-folder") return "invalid_request";
  for (const [key, limit] of Object.entries(LIMITS)) {
    const field = value[key];
    const required = ["request_id", "account_cid", "folder_id"].includes(key);
    if (field === undefined && !required) continue;
    if (typeof field !== "string" || !field.trim() || field.length > limit ||
        /[\u0000-\u001f\u007f]/u.test(field)) return "invalid_request";
  }
  if (!/^[0-9a-f]{16}$/iu.test(value.account_cid) ||
      !/^[a-z0-9_-]{1,64}$/iu.test(value.request_id)) return "invalid_request";
  return null;
}

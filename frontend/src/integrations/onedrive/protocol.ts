import type { OpenOneDriveFolderRequest } from "./navigation";

export const BROWSER_NAMESPACE = "rename-studio.browser.v1";
export const BROWSER_ORIGIN = import.meta.env.DEV ? "http://localhost:5173" : "http://localhost:8000";
export const validRequestId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9_-]{1,64}$/iu.test(value);

// Mirrored in extensions/browser/src/protocol.js; docs/BROWSER_PROTOCOL.md owns the contract.
export function parseBrowserTarget(value: unknown): { request: OpenOneDriveFolderRequest } | { code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { code: "invalid_request" };
  const data = value as Record<string, unknown>;
  if (data.version !== 1) return { code: "unsupported_version" };
  const limits: Record<string, number> = { request_id: 64, account_cid: 16, folder_id: 256,
    drive_id: 256, account_email: 320, account_display_name: 256, folder_name: 256 };
  const allowed = new Set(["version", "type", ...Object.keys(limits)]);
  if (data.type !== "open-onedrive-folder" || Object.keys(data).some((key) => !allowed.has(key))) return { code: "invalid_request" };
  for (const [key, limit] of Object.entries(limits)) {
    const field = data[key];
    if (field === undefined && !["request_id", "account_cid", "folder_id"].includes(key)) continue;
    if (typeof field !== "string" || !field.trim() || field.length > limit ||
        /[\u0000-\u001f\u007f]/u.test(field)) return { code: "invalid_request" };
  }
  if (!validRequestId(data.request_id) || !/^[0-9a-f]{16}$/iu.test(data.account_cid as string)) return { code: "invalid_request" };
  return { request: data as unknown as OpenOneDriveFolderRequest };
}

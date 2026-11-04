import { extractOneDriveFolder } from "./onedrive-page.js";

export const LIMITS = Object.freeze({ request_id: 64, account_cid: 16,
  folder_id: 256, drive_id: 256, account_email: 320,
  account_display_name: 256, folder_name: 256 });

function validateRequest(value) {
  const allowed = new Set(["version", "type", ...Object.keys(LIMITS)]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return "invalid_request";
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

export const oneDriveSiteAdapter = {
  origin: "https://onedrive.live.com",
  requestType: "open-onedrive-folder",
  extract: extractOneDriveFolder,
  validateRequest,
};

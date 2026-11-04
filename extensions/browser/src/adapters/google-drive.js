import { extractGoogleDriveFolder } from "./google-drive-page.js";

function validGoogleRequest(data) {
  const { request_id, account_email, location } = data;
  if (Object.keys(data).length !== 5 ||
      typeof request_id !== "string" || !/^[a-z0-9_-]{1,64}$/iu.test(request_id) ||
      typeof account_email !== "string" || account_email.length > 320 ||
      !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(account_email.trim()) || /[\u0000-\u001f\u007f]/u.test(account_email) ||
      !location || typeof location !== "object" || Array.isArray(location)) return false;
  const target = location;
  const keys = Object.keys(target);
  return target.kind === "root" ? keys.length === 1 :
    target.kind === "id" && keys.length === 2 && typeof target.value === "string" &&
    /^[a-z0-9_-]{1,256}$/i.test(target.value);
}

export const googleDriveSiteAdapter = {
  origin: "https://drive.google.com",
  requestType: "open-google-drive-folder",
  extract: extractGoogleDriveFolder,
  validateRequest: (data) => validGoogleRequest(data) ? null : "invalid_request",
};

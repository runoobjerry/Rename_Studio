import type { DirectoryListing, StorageInfo } from "../../../types";
import { NavigationError } from "../types";

export interface OpenGoogleDriveFolderRequest {
  version: 1;
  type: "open-google-drive-folder";
  request_id: string;
  account_email: string;
  location: { kind: "root" } | { kind: "id"; value: string };
}

function validGoogleRequest(data: Record<string, unknown>) {
  const { request_id, account_email, location } = data;
  if (Object.keys(data).length !== 5 ||
      typeof request_id !== "string" || !/^[a-z0-9_-]{1,64}$/iu.test(request_id) ||
      typeof account_email !== "string" || account_email.length > 320 ||
      !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(account_email.trim()) || /[\u0000-\u001f\u007f]/u.test(account_email) ||
      !location || typeof location !== "object" || Array.isArray(location)) return false;
  const target = location as Record<string, unknown>;
  const keys = Object.keys(target);
  return target.kind === "root" ? keys.length === 1 :
    target.kind === "id" && keys.length === 2 && typeof target.value === "string" &&
    /^[a-z0-9_-]{1,256}$/i.test(target.value);
}

export const googleDriveNavigationAdapter = {
  id: "google_drive_my_drive",
  requestType: "open-google-drive-folder",
  sourceHost: "drive.google.com",
  parse(data: Record<string, unknown>): { request: OpenGoogleDriveFolderRequest } | { code: string } {
    return validGoogleRequest(data) ? { request: data as unknown as OpenGoogleDriveFolderRequest } : { code: "invalid_request" };
  },
  location: (request: OpenGoogleDriveFolderRequest) => request.location,
  matchesStorage: (request: OpenGoogleDriveFolderRequest, storage: StorageInfo) =>
    storage.account_email?.trim().toLowerCase() === request.account_email.trim().toLowerCase(),
  matchesAccount: (_request: OpenGoogleDriveFolderRequest, accountId: string | null, storage: StorageInfo) =>
    accountId === storage.account_id,
  validateListing(request: OpenGoogleDriveFolderRequest, listing: DirectoryListing) {
    if (request.location.kind === "root") {
      if (listing.location?.kind !== "root") throw new NavigationError("scope_unverified");
    } else if (listing.directory_id !== request.location.value ||
        (listing.location?.kind === "id" && listing.location.value !== request.location.value)) {
      throw new NavigationError("cancelled");
    }
  },
};

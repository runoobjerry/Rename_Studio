import type { DirectoryListing, StorageInfo } from "../../../types";
import { NavigationError } from "../types";

export interface OpenOneDriveFolderRequest {
  version: 1;
  type: "open-onedrive-folder";
  request_id: string;
  account_cid: string;
  folder_id: string;
  drive_id?: string;
  account_email?: string;
  account_display_name?: string;
  folder_name?: string;
}
function samePersonalAccount(left: string | null, right: string): boolean {
  return left !== null && /^[0-9a-f]{16}$/iu.test(left) && left.toLowerCase() === right.toLowerCase();
}

function parse(data: Record<string, unknown>): { request: OpenOneDriveFolderRequest } | { code: string } {
  const limits: Record<string, number> = { request_id: 64, account_cid: 16, folder_id: 256,
    drive_id: 256, account_email: 320, account_display_name: 256, folder_name: 256 };
  const allowed = new Set(["version", "type", ...Object.keys(limits)]);
  if (Object.keys(data).some((key) => !allowed.has(key))) return { code: "invalid_request" };
  for (const [key, limit] of Object.entries(limits)) {
    const field = data[key];
    if (field === undefined && !["request_id", "account_cid", "folder_id"].includes(key)) continue;
    if (typeof field !== "string" || !field.trim() || field.length > limit ||
        /[\u0000-\u001f\u007f]/u.test(field)) return { code: "invalid_request" };
  }
  if (!/^[a-z0-9_-]{1,64}$/iu.test(data.request_id as string) || !/^[0-9a-f]{16}$/iu.test(data.account_cid as string)) return { code: "invalid_request" };
  return { request: data as unknown as OpenOneDriveFolderRequest };
}

export const oneDriveNavigationAdapter = {
  id: "onedrive_personal",
  requestType: "open-onedrive-folder",
  sourceHost: "onedrive.live.com",
  parse,
  location: (request: OpenOneDriveFolderRequest) => ({ kind: "id" as const, value: request.folder_id }),
  matchesStorage: (request: OpenOneDriveFolderRequest, storage: StorageInfo) =>
    samePersonalAccount(storage.account_id, request.account_cid),
  matchesAccount: (request: OpenOneDriveFolderRequest, accountId: string | null) =>
    samePersonalAccount(accountId, request.account_cid),
  validateListing(request: OpenOneDriveFolderRequest, listing: DirectoryListing) {
    if (listing.directory_id !== request.folder_id) throw new NavigationError("cancelled");
    if (request.drive_id) {
      if (!listing.drive_id) throw new NavigationError("scope_unverified");
      if (listing.drive_id !== request.drive_id) throw new NavigationError("unsupported_scope");
    } else if (listing.location?.kind !== "root") throw new NavigationError("scope_unverified");
  },
};

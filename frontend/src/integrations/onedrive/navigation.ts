import type { StorageInfo, StorageProviderDefinition } from "../../types";

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
export type NavigationReply =
  | { version: 1; request_id: string; status: "accepted" }
  | { version: 1; request_id: string; status: "opened"; storage_id: string }
  | { version: 1; request_id: string; status: "rejected"; code: string };

export class NavigationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function samePersonalAccount(left: string | null, right: string): boolean {
  return left !== null && /^[0-9a-f]{16}$/iu.test(left) &&
    left.toLowerCase() === right.toLowerCase();
}

// Input is already validated by the transport boundary; display fields never select a connection.
export function matchOneDriveTarget(request: OpenOneDriveFolderRequest,
  storages: StorageInfo[], definitions: StorageProviderDefinition[]) {
  const matches = storages.filter((entry) => entry.provider_type === "onedrive" &&
    samePersonalAccount(entry.account_id, request.account_cid));
  if (matches.length !== 1) throw new NavigationError("connection_not_found");
  const storage = matches[0];
  const definition = definitions.find((entry) => entry.provider_type === "onedrive");
  if (!definition?.browser_auth || !definition.locations.includes("id")) {
    throw new NavigationError("unsupported_scope");
  }
  if (storage.busy) throw new NavigationError("busy");
  return { storage, request };
}

export type OneDriveTarget = ReturnType<typeof matchOneDriveTarget>;
type Navigator = (request: OpenOneDriveFolderRequest,
  onAccepted?: (reply: NavigationReply) => void) => Promise<NavigationReply>;
let navigator: Navigator | null = null;

// In-process business entry only. No window event, browser message or HTTP endpoint.
export function registerOneDriveNavigator(handler: Navigator): () => void {
  navigator = handler;
  return () => { if (navigator === handler) navigator = null; };
}
export function openOneDriveFolder(request: OpenOneDriveFolderRequest,
  onAccepted?: (reply: NavigationReply) => void): Promise<NavigationReply> {
  return navigator ? navigator(request, onAccepted) : Promise.resolve({
    version: 1, request_id: request.request_id, status: "rejected", code: "workspace_not_found",
  });
}

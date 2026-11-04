import type { DirectoryListing, StorageInfo, StorageLocation } from "../../types";
import type { OpenOneDriveFolderRequest } from "./adapters/onedrive";

import type { OpenGoogleDriveFolderRequest } from "./adapters/googleDrive";

export interface BrowserRequests {
  "open-onedrive-folder": OpenOneDriveFolderRequest;
  "open-google-drive-folder": OpenGoogleDriveFolderRequest;
}
export type BrowserNavigationRequest = BrowserRequests[keyof BrowserRequests];

export type NavigationReply =
  | { version: 1; request_id: string; status: "accepted" }
  | { version: 1; request_id: string; status: "opened"; storage_id: string }
  | { version: 1; request_id: string; status: "rejected"; code: string };

export class NavigationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export interface ExternalNavigationTarget {
  storage: StorageInfo;
  location: StorageLocation;
  matchesAccount: (accountId: string | null) => boolean;
  validateListing: (listing: DirectoryListing) => void;
}

import { oneDriveNavigationAdapter } from "./onedrive";

import type { DirectoryListing, StorageInfo, StorageLocation } from "../../../types";
import type { BrowserRequests } from "../types";
import { googleDriveNavigationAdapter } from "./googleDrive";

interface NavigationAdapter<Request> {
  id: string;
  requestType: string;
  sourceHost: string;
  parse(data: Record<string, unknown>): { request: Request } | { code: string };
  location(request: Request): StorageLocation;
  matchesStorage(request: Request, storage: StorageInfo): boolean;
  matchesAccount(request: Request, accountId: string | null, storage: StorageInfo): boolean;
  validateListing(request: Request, listing: DirectoryListing): void;
}

// Shared navigation dispatches by registered request type, never by provider name.
export const navigationAdapters: { [K in keyof BrowserRequests]: NavigationAdapter<BrowserRequests[K]> } = {
  "open-onedrive-folder": oneDriveNavigationAdapter,
  "open-google-drive-folder": googleDriveNavigationAdapter,
};
export const findNavigationAdapter = (requestType: unknown) =>
  Object.values(navigationAdapters).find((adapter) => adapter.requestType === requestType);

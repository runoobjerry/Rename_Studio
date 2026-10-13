import type { AppPreferences, StorageLocation } from "../../types";

export function readDefaultCloudLocation(preferences: AppPreferences, storageId: string, accountId: string): StorageLocation {
  const saved = preferences.cloud_default_locations[storageId];
  return saved?.account_id === accountId ? saved.location : { kind: "root" };
}

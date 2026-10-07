import type { StorageLocation } from "../../types";

function locationKey(storageId: string, accountId: string): string {
  return `renamer-default-cloud-location:${JSON.stringify([storageId, accountId])}`;
}

export function readDefaultCloudLocation(storageId: string, accountId: string): StorageLocation {
  const saved = window.localStorage.getItem(locationKey(storageId, accountId));
  if (saved !== null) {
    const value: unknown = JSON.parse(saved);
    if (typeof value !== "object" || value === null || !("kind" in value)) throw new Error("默认目录格式无效");
    if (value.kind === "root") return { kind: "root" };
    if ((value.kind === "path" || value.kind === "id") && "value" in value && typeof value.value === "string") return { kind: value.kind, value: value.value };
    throw new Error("默认目录格式无效");
  }
  return { kind: "root" };
}

export function saveDefaultCloudLocation(storageId: string, accountId: string, location: StorageLocation): void {
  window.localStorage.setItem(locationKey(storageId, accountId), JSON.stringify(location));
}

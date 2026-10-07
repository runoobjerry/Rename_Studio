function storageKey(providerId: string, accountId: string): string {
  // 使用不透明账号 ID，不以可能为空或变化的邮箱/显示名隔离设置。
  return `renamer-default-cloud-path:${JSON.stringify([providerId, accountId])}`;
}

export function readDefaultCloudPath(providerId: string, accountId: string): string {
  return window.localStorage.getItem(storageKey(providerId, accountId)) ?? "";
}

export function saveDefaultCloudPath(providerId: string, accountId: string, path: string): void {
  window.localStorage.setItem(storageKey(providerId, accountId), path);
}

import type { StorageLocation } from "../../types";

function locationKey(storageId: string, accountId: string): string {
  return `renamer-default-cloud-location:${JSON.stringify([storageId, accountId])}`;
}

export function readDefaultCloudLocation(storageId: string, providerId: string, accountId: string): StorageLocation {
  const saved = window.localStorage.getItem(locationKey(storageId, accountId));
  if (saved !== null) {
    const value: unknown = JSON.parse(saved);
    if (typeof value !== "object" || value === null || !("kind" in value)) throw new Error("默认目录格式无效");
    if (value.kind === "root") return { kind: "root" };
    if ((value.kind === "path" || value.kind === "id") && "value" in value && typeof value.value === "string") return { kind: value.kind, value: value.value };
    throw new Error("默认目录格式无效");
  }
  // Only the original OneDrive connection inherits the browser's account-scoped path.
  if (storageId === "default-onedrive") {
    const old = readDefaultCloudPath(providerId, accountId);
    return old ? { kind: "path", value: old } : { kind: "root" };
  }
  return { kind: "root" };
}

export function saveDefaultCloudLocation(storageId: string, accountId: string, location: StorageLocation): void {
  window.localStorage.setItem(locationKey(storageId, accountId), JSON.stringify(location));
}

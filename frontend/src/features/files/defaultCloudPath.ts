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

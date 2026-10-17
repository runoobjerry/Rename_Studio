import type { StorageLocation } from "../types";

export const workspaceSessionKey = "rename-studio.workspace-session.v1";

export interface WorkspaceSession {
  version: 1;
  activeStorageId: string;
  locations: Record<string, {
    revision: number;
    accountId: string | null;
    location: StorageLocation;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocation(value: unknown): value is StorageLocation {
  return isRecord(value) && (value.kind === "root" ||
    ((value.kind === "id" || value.kind === "path") && typeof value.value === "string" &&
      (value.kind === "path" || value.value.length > 0)));
}

function isSession(value: unknown): value is WorkspaceSession {
  return isRecord(value) && value.version === 1 &&
    typeof value.activeStorageId === "string" && value.activeStorageId.length > 0 &&
    isRecord(value.locations) && Object.values(value.locations).every((entry) =>
      isRecord(entry) && Number.isInteger(entry.revision) &&
      (entry.accountId === null || typeof entry.accountId === "string") && isLocation(entry.location));
}

export function readWorkspaceSession(): { session: WorkspaceSession; unavailable: boolean } {
  const empty: WorkspaceSession = { version: 1, activeStorageId: "default-local", locations: {} };
  let stored: string | null;
  try {
    stored = window.sessionStorage.getItem(workspaceSessionKey);
  } catch {
    // 浏览器禁止存储时保留页面内存中的浏览状态。
    return { session: empty, unavailable: true };
  }
  if (stored === null) return { session: empty, unavailable: false };
  try {
    const parsed: unknown = JSON.parse(stored);
    return { session: isSession(parsed) ? parsed : empty, unavailable: false };
  } catch {
    return { session: empty, unavailable: false };
  }
}

export function writeWorkspaceSession(session: WorkspaceSession): boolean {
  try {
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearWorkspaceSession(): boolean {
  try {
    window.sessionStorage.removeItem(workspaceSessionKey);
    return true;
  } catch {
    return false;
  }
}

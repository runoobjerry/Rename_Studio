import type {
  DirectoryListing,
  ExecuteResponse,
  LocalFolderPick,
  PreviewResponse,
  RenameProgress,
  RuleDefinition,
  RuleSpec,
  AuthorizationStart,
  AuthorizationStatus,
  StorageInfo, StorageLocation, StorageCreate, StorageUpdate, StorageProviderDefinition,
} from "../types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    code: string | null = null,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseError(status: number, body: unknown): ApiError {
  // 代理和非标准错误响应也可能返回 HTML、null 或字段类型错误的 JSON。
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const message = typeof error.message === "string" && error.message.trim()
    ? error.message
    : `Request failed (${status})`;
  const code = typeof error.code === "string" && error.code.trim() ? error.code : null;
  const details = isRecord(error.details) ? error.details : {};
  return new ApiError(status, message, code, details);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw responseError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function fetchRules(): Promise<RuleDefinition[]> {
  return request("/rules");
}

export function executePreview(previewId: string): Promise<ExecuteResponse> {
  return request("/rename/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preview_id: previewId }),
  });
}

export function fetchRenameProgress(previewId: string): Promise<RenameProgress> {
  return request(`/rename/progress/${encodeURIComponent(previewId)}`);
}

const storageUrl = (id: string) => `/storages/${encodeURIComponent(id)}`;
const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const fetchStorageProviders = (): Promise<StorageProviderDefinition[]> => request("/storage-providers");
export const fetchStorages = (): Promise<StorageInfo[]> => request("/storages");
export const fetchStorage = (id: string): Promise<StorageInfo> => request(storageUrl(id));
export const createStorage = (body: StorageCreate): Promise<StorageInfo> => request("/storages", jsonPost(body));
export const updateStorage = (id: string, body: StorageUpdate): Promise<StorageInfo> => request(storageUrl(id), { ...jsonPost(body), method: "PUT" });
export const deleteStorage = (id: string): Promise<void> => request(storageUrl(id), { method: "DELETE" });
export const fetchStorageFiles = (id: string, location: StorageLocation): Promise<DirectoryListing> => request(`${storageUrl(id)}/files/list`, jsonPost({ location }));
export const createStoragePreview = (id: string, location: StorageLocation, fileIds: string[], rules: RuleSpec[]): Promise<PreviewResponse> => request(`${storageUrl(id)}/rename/preview`, jsonPost({ location, file_ids: fileIds, rules }));
export const fetchStorageAuthStatus = (id: string): Promise<AuthorizationStatus> => request(`${storageUrl(id)}/auth/status`);
export const startStorageAuth = (id: string): Promise<AuthorizationStart & { redirect_uri: string }> => request(`${storageUrl(id)}/auth/start`, { method: "POST" });
export const disconnectStorage = (id: string): Promise<void> => request(`${storageUrl(id)}/auth/session`, { method: "DELETE" });
export const pickStorageFolder = (id: string): Promise<LocalFolderPick> => request(`${storageUrl(id)}/local/pick`, { method: "POST" });

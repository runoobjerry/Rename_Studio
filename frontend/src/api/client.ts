import type {
  DirectoryListing,
  PreviewResponse,
  ProviderInfo,
  RuleDefinition,
  RuleSpec,
} from "../types";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function fetchProviders(): Promise<ProviderInfo[]> {
  return request("/providers");
}

export function fetchFiles(provider: string, path: string): Promise<DirectoryListing> {
  const query = new URLSearchParams({ provider, path });
  return request(`/files?${query.toString()}`);
}

export function fetchRules(): Promise<RuleDefinition[]> {
  return request("/rules");
}

export function createPreview(
  provider: string,
  fileIds: string[],
  rules: RuleSpec[],
): Promise<PreviewResponse> {
  return request("/rename/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, file_ids: fileIds, rules }),
  });
}

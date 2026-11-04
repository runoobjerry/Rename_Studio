import type { BrowserNavigationRequest } from "./types";
import { findNavigationAdapter } from "./adapters";

export const BROWSER_NAMESPACE = "rename-studio.browser.v1";
export const BROWSER_ORIGIN = import.meta.env.DEV ? "http://localhost:5173" : "http://localhost:8000";
export const validRequestId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9_-]{1,64}$/iu.test(value);

// docs/BROWSER_PROTOCOL.md owns the contract, mirrored by the extension boundary.
export function parseBrowserTarget(value: unknown): { request: BrowserNavigationRequest } | { code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { code: "invalid_request" };
  const data = value as Record<string, unknown>;
  if (data.version !== 1) return { code: "unsupported_version" };
  const adapter = findNavigationAdapter(data.type);
  return adapter ? adapter.parse(data) : { code: "invalid_request" };
}

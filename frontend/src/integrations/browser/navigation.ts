import type { StorageInfo, StorageProviderDefinition } from "../../types";
import { navigationAdapters } from "./adapters";
import { NavigationError, type BrowserNavigationRequest, type BrowserRequests, type ExternalNavigationTarget, type NavigationReply } from "./types";
export { NavigationError } from "./types";
export type { BrowserNavigationRequest, ExternalNavigationTarget, NavigationReply } from "./types";

export function matchBrowserTarget<K extends keyof BrowserRequests>(request: BrowserRequests[K] & { type: K },
  storages: StorageInfo[], providerDefinitions: StorageProviderDefinition[]): ExternalNavigationTarget {
  // The boundary parser already accepted a registered request type.
  const requestType: K = request.type;
  const adapter = navigationAdapters[requestType];
  const location = adapter.location(request);
  const supportedProviderDefinitions = providerDefinitions.filter((providerDefinition) => providerDefinition.browser_navigation === adapter.id &&
    providerDefinition.browser_auth && providerDefinition.locations.includes(location.kind));
  if (supportedProviderDefinitions.length === 0) throw new NavigationError("unsupported_scope");
  const matches = storages.filter((storage) => supportedProviderDefinitions.some((providerDefinition) => providerDefinition.provider_type === storage.provider_type) &&
    adapter.matchesStorage(request, storage));
  if (matches.length !== 1) throw new NavigationError("connection_not_found");
  const storage = matches[0];
  if (storage.account_id === null) throw new NavigationError("auth_required");
  if (storage.busy) throw new NavigationError("busy");
  return { storage, location,
    matchesAccount: (accountId) => adapter.matchesAccount(request, accountId, storage),
    validateListing: (listing) => adapter.validateListing(request, listing) };
}

type Navigator = (request: BrowserNavigationRequest,
  onAccepted?: (reply: NavigationReply) => void) => Promise<NavigationReply>;
let navigator: Navigator | null = null;
export const browserNavigatorReady = () => navigator !== null;

// In-process business entry only. No window event, browser message or HTTP endpoint.
export function registerBrowserNavigator(handler: Navigator): () => void {
  navigator = handler;
  return () => { if (navigator === handler) navigator = null; };
}
export function openBrowserFolder(request: BrowserNavigationRequest,
  onAccepted?: (reply: NavigationReply) => void): Promise<NavigationReply> {
  return navigator ? navigator(request, onAccepted) : Promise.resolve({
    version: 1, request_id: request.request_id, status: "rejected", code: "workspace_not_found",
  });
}

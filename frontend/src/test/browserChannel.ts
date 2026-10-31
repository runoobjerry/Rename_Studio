import { vi } from "vitest";
import { BROWSER_ORIGIN } from "../integrations/onedrive/protocol";

// A browser boundary double, with real bridge and navigation code running above it.
export function browserChannel() {
  let receive: ((event: MessageEvent) => void) | undefined;
  const host = {
    location: { origin: BROWSER_ORIGIN }, top: null as unknown,
    postMessage: vi.fn<(message: unknown, origin: string) => void>(),
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => { receive = listener; },
    removeEventListener: () => { receive = undefined; },
  };
  host.top = host;
  return { host: host as unknown as Window, post: host.postMessage,
    dispatch: (data: unknown, overrides: object = {}) => receive?.({
      source: host, origin: BROWSER_ORIGIN, data, ...overrides,
    } as unknown as MessageEvent) };
}

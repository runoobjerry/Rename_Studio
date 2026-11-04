import { describe, expect, it } from "vitest";
import { providerDefinitions, storages } from "../../test/fixtures";
import { matchBrowserTarget, NavigationError, type BrowserNavigationRequest } from "./navigation";

const request: BrowserNavigationRequest = { version: 1, type: "open-onedrive-folder",
  request_id: "r", account_cid: "0123456789ABCDEF", folder_id: "folder" };

describe("browser navigation capabilities", () => {
  it.each(["missing", "disabled", "unknown", "no-auth", "no-id"])(
    "rejects %s capability metadata instead of inferring support from the OneDrive name", (kind) => {
      const definitions = providerDefinitions();
      const definition = definitions[1];
      if (kind === "missing") Reflect.deleteProperty(definition, "browser_navigation");
      else if (kind === "disabled") definition.browser_navigation = null;
      else if (kind === "unknown") definition.browser_navigation = "unregistered_adapter";
      else if (kind === "no-auth") definition.browser_auth = false;
      else definition.locations = ["root"];
      const connections = storages().map((entry) => ({ ...entry, account_id: request.account_cid }));
      expect(() => matchBrowserTarget(request, connections, definitions))
        .toThrowError(new NavigationError("unsupported_scope"));
    });
});

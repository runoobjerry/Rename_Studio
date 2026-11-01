import { extractOneDriveFolder } from "../src/onedrive-page.js";
import { validateOpenRequest } from "../src/protocol.js";

const root = "/personal/0123456789abcdef/Documents";
function page(query = "") {
  const events = new EventTarget();
  globalThis.window = Object.assign(events, {
    navigation: new EventTarget(),
    _spPageContextInfo: { userHexCid: "0123456789ABCDEF",
      webAbsoluteUrl: "https://onedrive.live.com/personal/0123456789abcdef",
      listUrl: root, userEmail: "person@example.test", userDisplayName: "Person" },
  });
  globalThis.location = { href: `https://onedrive.live.com/my${query}` };
  globalThis.fetch = vi.fn(async () => ({ ok: true,
    json: async () => ({ id: "opaque!folder", folder: {}, name: "Folder" }) }));
}
beforeEach(() => page());
afterEach(() => {
  delete globalThis.window;
  delete globalThis.location;
  delete globalThis.fetch;
});

it("extracts root without inventing a missing drive identity", async () => {
  const result = await extractOneDriveFolder("request-1");
  expect(result.ok).toBe(true);
  expect(result.request.folder_id).toBe("opaque!folder");
  expect(result.request).not.toHaveProperty("drive_id");
  expect(validateOpenRequest(result.request)).toBeNull();
  expect(fetch.mock.calls[0][0]).toBe("https://onedrive.live.com/personal/0123456789abcdef/_api/v2.0/drive/root");
});
it("encodes each nested path segment once, preserving literal percent and Unicode", async () => {
  page(`?id=${encodeURIComponent(`${root}/中文/100% #`)}`);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "folder-id", folder: {},
    parentReference: { driveId: "drive-id" } }) });
  const result = await extractOneDriveFolder("request-2");
  expect(result.request.drive_id).toBe("drive-id");
  expect(fetch.mock.calls[0][0]).toContain("root:/%E4%B8%AD%E6%96%87/100%25%20%23");
});
it("rejects a child whose drive scope cannot be confirmed", async () => {
  page(`?id=${encodeURIComponent(`${root}/child`)}`);
  expect(await extractOneDriveFolder("r")).toEqual({ ok: false, code: "scope_unverified" });
});
it.each(["https://onedrive.live.com/?id=x", "https://onedrive.live.com/my?view=recent",
  `https://onedrive.live.com/my?id=${encodeURIComponent(`${root}-other/child`)}`])(
  "does not fetch unsupported views or sibling boundaries: %s", async (href) => {
    location.href = href;
    expect((await extractOneDriveFolder("r")).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
it.each(["url", "account"])("discards a result after %s changes during the request", async (kind) => {
  fetch.mockImplementation(async () => {
    if (kind === "url") location.href += "?id=changed";
    else window._spPageContextInfo.userHexCid = "FEDCBA9876543210";
    return { ok: true, json: async () => ({ id: "stale", folder: {} }) };
  });
  expect(await extractOneDriveFolder("r")).toEqual({ ok: false, code: "page_changed" });
});
it("discards a result when SPA navigation starts before the URL snapshot changes", async () => {
  fetch.mockImplementation(async () => {
    window.navigation.dispatchEvent(new Event("navigate"));
    return { ok: true, json: async () => ({ id: "stale", folder: {} }) };
  });
  expect(await extractOneDriveFolder("r")).toEqual({ ok: false, code: "page_changed" });
});
it("does not guess the radix of userCid", async () => {
  delete window._spPageContextInfo.userHexCid;
  window._spPageContextInfo.userCid = "1234567890123456";
  expect(await extractOneDriveFolder("r")).toEqual({ ok: false, code: "account_format_unsupported" });
});
it("reports malformed page-provided site URLs at the parsing boundary", async () => {
  window._spPageContextInfo.webAbsoluteUrl = "invalid site URL";
  expect(await extractOneDriveFolder("r")).toEqual({ ok: false, code: "invalid_page_data" });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([[401, "auth_required"], [403, "permission_denied"], [404, "directory_unavailable"],
  [429, "rate_limited"], [503, "provider_error"]])("preserves HTTP failure meaning: %s", async (status, code) => {
  fetch.mockResolvedValue({ ok: false, status });
  expect(await extractOneDriveFolder("r")).toEqual({ ok: false, code });
});
it("rejects remote shortcuts and non-folder responses", async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "x", folder: {}, remoteItem: {} }) });
  expect((await extractOneDriveFolder("r")).code).toBe("unsupported_scope");
  fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "x", file: {} }) });
  expect((await extractOneDriveFolder("r")).code).toBe("invalid_response");
});
it("bounds the protocol and rejects extra data, versions and missing identities", () => {
  const request = { version: 1, type: "open-onedrive-folder", request_id: "r",
    account_cid: "0123456789ABCDEF", folder_id: "opaque!folder" };
  expect(validateOpenRequest(request)).toBeNull();
  expect(validateOpenRequest({ ...request, version: 2 })).toBe("unsupported_version");
  expect(validateOpenRequest({ ...request, token: "secret" })).toBe("invalid_request");
  expect(validateOpenRequest({ ...request, folder_id: "" })).toBe("invalid_request");
  expect(validateOpenRequest({ ...request, folder_id: "x".repeat(257) })).toBe("invalid_request");
});

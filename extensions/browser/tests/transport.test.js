import { NAMESPACE, PROJECT } from "../src/protocol.js";
import { findWorkspace, isSource, routeNavigation } from "../src/transport.js";

const origin = "http://localhost:8000";
const source = { id: "extension", frameId: 0, documentId: "document-one", origin: "https://onedrive.live.com",
  url: "https://onedrive.live.com/my", tab: { id: 1, incognito: false } };
const request = { version: 1, type: "open-onedrive-folder", request_id: "r", account_cid: "0123456789ABCDEF", folder_id: "folder" };
const workspace = { id: 2, windowId: 1, incognito: false, url: `${origin}/` };
function browser(tabs = [workspace]) {
  return {
    tabs: { query: vi.fn(async () => tabs), get: vi.fn(async () => ({ url: source.url })),
      sendMessage: vi.fn(async (_id, message) => message.type === "probe" ? {
        namespace: NAMESPACE, type: "ready", project: PROJECT, version: 1,
        request_id: message.request_id, instance_id: "01234567-0123-4123-8123-012345678901",
      } : { version: 1, request_id: "r", status: "opened", storage_id: "actual-connection" }) },
    scripting: { executeScript: vi.fn(async () => [{ documentId: source.documentId, result: { ok: true, request } }]) },
  };
}
it("filters exact origins and requires a project/version/ready handshake, not a title", async () => {
  const api = browser([{ ...workspace, url: "http://localhost:5173/", title: "Rename Studio" }]);
  await expect(findWorkspace(api, origin)).rejects.toMatchObject({ code: "workspace_not_found" });
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
  api.tabs.query.mockResolvedValue([workspace]);
  api.tabs.sendMessage.mockResolvedValue({ title: "Rename Studio", version: 1 });
  await expect(findWorkspace(api, origin)).rejects.toMatchObject({ code: "workspace_not_found" });
});
it("refuses multiple ready tabs without extracting or broadcasting navigation", async () => {
  const api = browser([workspace, { ...workspace, id: 3 }]);
  await expect(routeNavigation(api, origin, source, "r", { active: true })).rejects.toMatchObject({ code: "multiple_workspaces" });
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(api.tabs.sendMessage.mock.calls.every(([, message]) => message.type === "probe")).toBe(true);
});
it("binds extraction to the source document and sends only a validated navigation target", async () => {
  const api = browser();
  expect(await routeNavigation(api, origin, source, "r", { active: true })).toMatchObject({ status: "opened" });
  expect(api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
    world: "MAIN", target: { tabId: 1, documentIds: ["document-one"] }, args: ["r"],
  }));
  expect(api.tabs.sendMessage).toHaveBeenLastCalledWith(2, expect.objectContaining({ type: "navigate", request }), { frameId: 0 });
});
it("does not forward extra data supplied by the MAIN page", async () => {
  const api = browser();
  api.scripting.executeScript.mockResolvedValue([{ documentId: source.documentId,
    result: { ok: true, request: { ...request, url: "https://untrusted.test/", token: "secret" } } }]);
  await expect(routeNavigation(api, origin, source, "r", { active: true })).rejects.toMatchObject({ code: "invalid_request" });
  expect(api.tabs.sendMessage.mock.calls.some(([, message]) => message.type === "navigate")).toBe(false);
});
it.each([null, undefined])("keeps an absent final receiver response unconfirmed", async (reply) => {
  const api = browser();
  const send = api.tabs.sendMessage.getMockImplementation();
  api.tabs.sendMessage.mockImplementation((id, message) => message.type === "navigate" ? Promise.resolve(reply) : send(id, message));
  await expect(routeNavigation(api, origin, source, "r", { active: true })).rejects.toMatchObject({ code: "result_timeout" });
});
it("drops a changed OneDrive URL instead of navigating a stale folder", async () => {
  const api = browser();
  api.tabs.get.mockResolvedValueOnce({ url: source.url }).mockResolvedValueOnce({ url: source.url })
    .mockResolvedValueOnce({ url: `${source.url}?id=elsewhere` });
  await expect(routeNavigation(api, origin, source, "r", { active: true })).rejects.toMatchObject({ code: "page_changed" });
  expect(api.tabs.sendMessage.mock.calls.some(([, message]) => message.type === "navigate")).toBe(false);
});
it.each([{ ...source, frameId: 2 }, { ...source, origin: "https://other.test" },
  { ...source, id: "other-extension" }, { ...source, tab: { ...source.tab, incognito: true } }])(
  "rejects a sender outside the top-level normal OneDrive page", (sender) => {
    expect(isSource(sender, "extension")).toBe(false);
  });

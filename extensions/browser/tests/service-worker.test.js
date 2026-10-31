const namespace = "rename-studio.browser.v1";
const origin = "http://localhost:8000";
const source = { id: "extension", frameId: 0, documentId: "onedrive-document", origin: "https://onedrive.live.com",
  url: "https://onedrive.live.com/my", tab: { id: 1, incognito: false } };
const targetSender = { id: "extension", frameId: 0, origin, tab: { id: 2, incognito: false } };
const instanceId = "01234567-0123-4123-8123-012345678901";
async function boot() {
  vi.resetModules();
  vi.stubGlobal("__WORKSPACE_ORIGIN__", origin);
  let receive;
  let finish;
  const final = new Promise((resolve) => { finish = resolve; });
  const api = {
    runtime: { id: "extension", onMessage: { addListener: (listener) => { receive = listener; } } },
    tabs: {
      query: vi.fn(async () => [{ id: 2, windowId: 8, url: `${origin}/`, incognito: false }]),
      get: vi.fn(async () => ({ url: source.url })),
      sendMessage: vi.fn(async (_tabId, message) => message.type === "probe" ? {
        namespace, type: "ready", project: "rename-studio", version: 1, request_id: message.request_id,
        instance_id: instanceId,
      } : message.type === "navigate" ? final : undefined),
      update: vi.fn(async () => {}), onRemoved: { addListener: vi.fn() },
    },
    windows: { update: vi.fn(async () => {}) },
    scripting: { executeScript: vi.fn(async () => [{ documentId: source.documentId, result: { ok: true,
      request: { version: 1, type: "open-onedrive-folder", request_id: "r", account_cid: "0123456789ABCDEF", folder_id: "folder" } } }]) },
  };
  vi.stubGlobal("chrome", api);
  await import("../src/service-worker.js");
  return { api, receive, finish };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("activates only after a correlated accepted reply from the target top-level app", async () => {
  const { api, receive, finish } = await boot();
  const respond = vi.fn();
  receive({ namespace, type: "open-current-folder", request_id: "r" }, source, respond);
  await vi.waitFor(() => expect(api.tabs.sendMessage.mock.calls.some(([, value]) => value.type === "navigate")).toBe(true));
  expect(api.tabs.update).not.toHaveBeenCalled();
  const accepted = { namespace, type: "navigation-accepted", request_id: "r", instance_id: instanceId };
  receive(accepted, { ...targetSender, frameId: 3 }, vi.fn());
  receive(accepted, { ...targetSender, origin: "http://localhost:9000" }, vi.fn());
  expect(api.tabs.update).not.toHaveBeenCalled();
  receive(accepted, targetSender, vi.fn());
  await vi.waitFor(() => expect(api.tabs.update).toHaveBeenCalledWith(2, { active: true }));
  expect(api.windows.update).toHaveBeenCalledWith(8, { focused: true });
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(1, { namespace, type: "accepted", request_id: "r" }, { documentId: source.documentId });
  const opened = { version: 1, request_id: "r", status: "opened", storage_id: "real-connection" };
  finish(opened);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(opened));
});
it("does not start extraction for an invalid sender or arbitrary operation", async () => {
  const { api, receive } = await boot();
  const respond = vi.fn();
  receive({ namespace, type: "open-current-folder", request_id: "r" }, { ...source, frameId: 1 }, respond);
  receive({ namespace, type: "execute-script", request_id: "r", code: "anything" }, source, respond);
  expect(api.tabs.query).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});
it("finishes an unconfirmed timeout once, without replay or forwarding a late result", async () => {
  vi.useFakeTimers();
  const { api, receive, finish } = await boot();
  const respond = vi.fn();
  receive({ namespace, type: "open-current-folder", request_id: "r" }, source, respond);
  await vi.advanceTimersByTimeAsync(0);
  expect(api.tabs.sendMessage.mock.calls.filter(([, value]) => value.type === "navigate")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(20000);
  expect(respond).toHaveBeenCalledWith({ transport: "unconfirmed", code: "result_timeout" });
  finish({ version: 1, request_id: "r", status: "opened", storage_id: "late" });
  await vi.advanceTimersByTimeAsync(0);
  expect(respond).toHaveBeenCalledTimes(1);
  expect(api.tabs.sendMessage.mock.calls.filter(([, value]) => value.type === "navigate")).toHaveLength(1);
});

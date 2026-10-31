const namespace = "rename-studio.browser.v1";
const origin = "http://localhost:8000";
afterEach(() => { vi.unstubAllGlobals(); });
it("pins a workspace document and waits for accepted relay before returning a fast final result", async () => {
  vi.resetModules();
  vi.stubGlobal("__WORKSPACE_ORIGIN__", origin);
  let runtimeReceive, windowReceive, confirmActivation;
  const acceptance = new Promise((resolve) => { confirmActivation = resolve; });
  const host = { top: null, addEventListener: (_type, listener) => { windowReceive = listener; }, postMessage: vi.fn() };
  host.top = host;
  vi.stubGlobal("window", host);
  vi.stubGlobal("location", { origin });
  const runtime = { id: "extension", sendMessage: vi.fn(() => acceptance),
    onMessage: { addListener: (listener) => { runtimeReceive = listener; } } };
  vi.stubGlobal("chrome", { runtime });
  await import("../src/workspace-content.js");
  const ready = vi.fn();
  runtimeReceive({ namespace, version: 1, type: "probe", request_id: "probe" }, { id: "extension" }, ready);
  const emit = (type, id, extra = {}, overrides = {}) => windowReceive({ source: host, origin,
    data: { namespace, version: 1, direction: "app-to-extension", type, request_id: id, ...extra }, ...overrides });
  emit("ready", "probe", { project: "rename-studio" }, { origin: "http://localhost:9000" });
  expect(ready).not.toHaveBeenCalled();
  emit("ready", "probe", { project: "rename-studio" });
  const instanceId = ready.mock.calls[0][0].instance_id;
  expect(instanceId).toMatch(/^[a-z0-9-]{36}$/iu);
  const navigation = { namespace, version: 1, type: "navigate", instance_id: instanceId, request_id: "r",
    request: { version: 1, type: "open-onedrive-folder", request_id: "r", account_cid: "0123456789ABCDEF", folder_id: "folder" } };
  const respond = vi.fn();
  runtimeReceive({ ...navigation, instance_id: "old-document" }, { id: "extension" }, respond);
  expect(host.postMessage).toHaveBeenCalledTimes(1); // Only the probe was forwarded.
  runtimeReceive(navigation, { id: "extension" }, respond);
  emit("navigation-reply", "r", { reply: { version: 1, request_id: "r", status: "accepted" } });
  const opened = { version: 1, request_id: "r", status: "opened", storage_id: "connection" };
  emit("navigation-reply", "r", { reply: opened });
  expect(respond).not.toHaveBeenCalled();
  expect(runtime.sendMessage).toHaveBeenCalledWith({ namespace, type: "navigation-accepted", request_id: "r", instance_id: instanceId });
  confirmActivation({ ok: true });
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(opened));
  emit("navigation-reply", "r", { reply: opened });
  expect(respond).toHaveBeenCalledTimes(1);
});

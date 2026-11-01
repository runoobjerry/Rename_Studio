import { afterEach, describe, expect, it, vi } from "vitest";
import { browserChannel } from "../../test/browserChannel";
import { deferred } from "../../test/deferred";
import { installBrowserBridge } from "./browserBridge";
import { registerOneDriveNavigator, type NavigationReply } from "./navigation";
import { BROWSER_NAMESPACE, BROWSER_ORIGIN } from "./protocol";

const target = { version: 1, type: "open-onedrive-folder", request_id: "r",
  account_cid: "0123456789ABCDEF", folder_id: "opaque!folder" };
const envelope = (type = "navigate", extra = {}) => ({ namespace: BROWSER_NAMESPACE,
  direction: "extension-to-app", version: 1, type, request_id: "r", ...extra });
let cleanup = () => {};
let unregister = () => {};
afterEach(() => { cleanup(); unregister(); vi.useRealTimers(); });

describe("browser navigation bridge", () => {
  it("answers a ready/version/project probe only while the real business entry is registered", () => {
    const channel = browserChannel();
    cleanup = installBrowserBridge(vi.fn(), channel.host);
    channel.dispatch(envelope("probe"));
    expect(channel.post).not.toHaveBeenCalled();
    unregister = registerOneDriveNavigator(vi.fn());
    channel.dispatch(envelope("probe"));
    expect(channel.post).toHaveBeenCalledWith(expect.objectContaining({ type: "ready", version: 1,
      project: "rename-studio", direction: "app-to-extension", request_id: "r" }), BROWSER_ORIGIN);
  });

  it("ignores foreign origin/source and echo messages, and rejects invalid navigation before delegation", () => {
    const channel = browserChannel();
    const navigate = vi.fn();
    unregister = registerOneDriveNavigator(navigate);
    cleanup = installBrowserBridge(vi.fn(), channel.host);
    channel.dispatch(envelope("navigate", { request: target }), { origin: "http://localhost:9000" });
    channel.dispatch(envelope("navigate", { request: target }), { source: {} });
    channel.dispatch(envelope("navigate", { request: target, direction: "app-to-extension" }));
    expect(channel.post).not.toHaveBeenCalled();
    channel.dispatch(envelope("navigate", { request: { ...target, token: "forbidden" } }));
    expect(channel.post).toHaveBeenLastCalledWith(expect.objectContaining({ reply: expect.objectContaining({
      status: "rejected", code: "invalid_request" }) }), BROWSER_ORIGIN);
    channel.dispatch(envelope("navigate", { version: 2, request: target }));
    expect(channel.post).toHaveBeenLastCalledWith(expect.objectContaining({ reply: expect.objectContaining({
      status: "rejected", code: "unsupported_version" }) }), BROWSER_ORIGIN);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("forwards accepted and the final result with the same ID and refuses concurrent requests", async () => {
    const channel = browserChannel();
    const finish = deferred<NavigationReply>();
    unregister = registerOneDriveNavigator((_request, accepted) => {
      accepted?.({ version: 1, request_id: "r", status: "accepted" });
      return finish.promise;
    });
    cleanup = installBrowserBridge(vi.fn(), channel.host);
    channel.dispatch(envelope("navigate", { request: target }));
    expect(channel.post).toHaveBeenLastCalledWith(expect.objectContaining({ reply: {
      version: 1, request_id: "r", status: "accepted" } }), BROWSER_ORIGIN);
    channel.dispatch(envelope("navigate", { request_id: "second", request: { ...target, request_id: "second" } }));
    expect(channel.post).toHaveBeenLastCalledWith(expect.objectContaining({ request_id: "second",
      reply: expect.objectContaining({ status: "rejected", code: "busy" }) }), BROWSER_ORIGIN);
    finish.resolve({ version: 1, request_id: "r", status: "opened", storage_id: "real-connection" });
    await vi.waitFor(() => expect(channel.post).toHaveBeenLastCalledWith(expect.objectContaining({ request_id: "r",
      reply: expect.objectContaining({ status: "opened" }) }), BROWSER_ORIGIN));
  });

  it("reports an unconfirmed timeout without replaying and ignores the old reply after another request", async () => {
    vi.useFakeTimers();
    const channel = browserChannel();
    const old = deferred<NavigationReply>();
    const next = deferred<NavigationReply>();
    const navigate = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    unregister = registerOneDriveNavigator(navigate);
    const problem = vi.fn();
    cleanup = installBrowserBridge(problem, channel.host);
    channel.dispatch(envelope("navigate", { request: target }));
    await vi.advanceTimersByTimeAsync(20000);
    expect(problem).toHaveBeenCalledWith("result_timeout");
    expect(navigate).toHaveBeenCalledTimes(1);
    channel.dispatch(envelope("navigate", { request_id: "next", request: { ...target, request_id: "next" } }));
    old.resolve({ version: 1, request_id: "r", status: "opened", storage_id: "old" });
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.post).not.toHaveBeenCalled();
    next.resolve({ version: 1, request_id: "next", status: "opened", storage_id: "new" });
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.post).toHaveBeenCalledWith(expect.objectContaining({ request_id: "next",
      reply: expect.objectContaining({ storage_id: "new" }) }), BROWSER_ORIGIN);
  });
});

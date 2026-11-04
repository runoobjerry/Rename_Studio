import { validateOpenRequest, validReply } from "../src/protocol.js";
import { parseBrowserTarget } from "../../../frontend/src/integrations/browser/protocol";

const request = { version: 1, type: "open-onedrive-folder", request_id: "request", account_cid: "0123456789ABCDEF", folder_id: "opaque!id" };
const google = { version: 1, type: "open-google-drive-folder", request_id: "request",
  account_email: "me@example.test", location: { kind: "id", value: "folder-id" } };
it.each([
  [google, null],
  [{ ...google, location: { kind: "root" } }, null],
  [{ ...google, account_email: "not-an-email" }, "invalid_request"],
  [{ ...google, location: { kind: "root", value: "folder-id" } }, "invalid_request"],
  [{ ...google, location: { kind: "id", value: "foo/bar" } }, "invalid_request"],
  [{ ...google, url: "https://drive.google.com" }, "invalid_request"],
])("validates Google payloads at both boundaries", (value, expected) => {
  expect(validateOpenRequest(value)).toBe(expected);
  const parsed = parseBrowserTarget(value);
  expect("code" in parsed ? parsed.code : null).toBe(expected);
});
it.each([request, { ...request, version: 2 }, { ...request, type: "execute" },
  { ...request, folder_id: "x".repeat(257) }, { ...request, account_cid: "bad" },
  { ...request, folder_id: "" }, { ...request, cookie: "extra" }, { ...request, folder_id: "a\n" }])(
  "keeps extension and app protocol boundary behavior aligned", (value) => {
    const parsed = parseBrowserTarget(value);
    expect(validateOpenRequest(value)).toBe("code" in parsed ? parsed.code : null);
  });
it("separates accepted from bounded final replies and correlates the request ID", () => {
  expect(validReply({ version: 1, request_id: "r", status: "accepted" }, "r")).toBe(true);
  expect(validReply({ version: 1, request_id: "old", status: "opened", storage_id: "connection" }, "r")).toBe(false);
  expect(validReply({ version: 1, request_id: "r", status: "opened", storage_id: "connection", token: "extra" }, "r")).toBe(false);
  expect(validReply({ version: 1, request_id: "r", status: "rejected", code: "PERMISSION_DENIED" }, "r")).toBe(true);
});

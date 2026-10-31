import { validateOpenRequest, validReply } from "../src/protocol.js";
import { parseBrowserTarget } from "../../../frontend/src/integrations/onedrive/protocol";

const request = { version: 1, type: "open-onedrive-folder", request_id: "request", account_cid: "0123456789ABCDEF", folder_id: "opaque!id" };
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

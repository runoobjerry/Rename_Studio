import { extractGoogleDriveFolder } from "../src/adapters/google-drive-page.js";

function page(path, accounts) {
  vi.stubGlobal("location", { href: `https://drive.google.com${path}` });
  vi.stubGlobal("document", { querySelectorAll: () => accounts.map(([label, visible]) => ({
    getAttribute: () => label,
    closest: () => null,
    getClientRects: () => visible ? [{}] : [],
  })) });
  vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible", opacity: "1" }));
}

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["/drive/u/0/my-drive", { kind: "root" }],
  ["/drive/u/2/folders/opaque_ID-42/", { kind: "id", value: "opaque_ID-42" }],
])("extracts the visible account and directory from %s", (path, location) => {
  page(path, [["Google 帳戶：Other (other@example.test)", false],
    ["Google Account: First (First@example.test)", true]]);
  expect(extractGoogleDriveFolder("r")).toMatchObject({
    ok: true, request: { account_email: "first@example.test", location },
  });
});

it("rejects a page without an account email", () => {
  page("/drive/u/0/my-drive", []);
  expect(extractGoogleDriveFolder("r")).toEqual({ ok: false, code: "account_email_unverified" });
});

it.each(["/drive/u/0/folders/id?resourcekey=key", "/drive/u/0/folders/a%2Fb"])(
  "rejects unsupported routes or resource keys", (path) => {
    page(path, []);
    expect(extractGoogleDriveFolder("r")).toEqual({ ok: false, code: "unsupported_view" });
  });

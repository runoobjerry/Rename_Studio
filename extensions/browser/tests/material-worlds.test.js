// @vitest-environment jsdom

afterEach(() => vi.unstubAllGlobals());

it("starts the isolated UI with a null registry and registers Material components separately in MAIN", async () => {
  // Match the real Chromium boundary that jsdom normally does not reproduce.
  vi.stubGlobal("customElements", null);
  vi.stubGlobal("location", { origin: "https://onedrive.live.com" });
  vi.stubGlobal("chrome", { i18n: { getMessage: (key) => key } });
  await import("../src/onedrive-content.js");
  expect(document.getElementById("rename-studio-folder-button")).not.toBeNull();

  vi.unstubAllGlobals();
  await import("../src/material-main.js");
  expect(customElements.get("md-icon")).toBeDefined();
  expect(customElements.get("md-circular-progress")).toBeDefined();
});

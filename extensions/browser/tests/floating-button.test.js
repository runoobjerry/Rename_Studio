// @vitest-environment jsdom
import { mountFloatingButton } from "../src/floating-button.js";

const message = (key) => key;
let control;
afterEach(() => { control?.dispose(); control = null; vi.restoreAllMocks(); });
it("mounts one accessible button outside SPA body replacements and shows progress until the result", async () => {
  let complete;
  const open = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
  control = mountFloatingButton(open, message);
  expect(mountFloatingButton(open, message)).toBeUndefined();
  expect(control.button.getAttribute("aria-label")).toBe("openInStudio");
  expect(control.button.type).toBe("button");
  document.body.replaceChildren();
  expect(document.querySelectorAll("#rename-studio-folder-button")).toHaveLength(1);
  control.button.click();
  control.button.click();
  expect(open).toHaveBeenCalledTimes(1);
  expect(control.progress.hidden).toBe(false);
  expect(control.button.getAttribute("aria-disabled")).toBe("true");
  complete({ status: "opened" });
  await vi.waitFor(() => expect(control.status.textContent).toBe("openSuccess"));
  expect(control.progress.hidden).toBe(true);
});
it("reclamps a dragged control on narrow windows and dragging does not open a folder", () => {
  const open = vi.fn();
  control = mountFloatingButton(open, message);
  control.button.setPointerCapture = vi.fn();
  const pointer = (type, x, y) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    control.button.dispatchEvent(event);
  };
  pointer("pointerdown", 900, 300);
  pointer("pointermove", 2000, 2000);
  pointer("pointerup", 2000, 2000);
  control.button.click();
  expect(open).not.toHaveBeenCalled();
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(320);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(240);
  window.dispatchEvent(new Event("resize"));
  expect(parseInt(control.host.style.left)).toBeLessThanOrEqual(268);
  expect(parseInt(control.host.style.top)).toBeLessThanOrEqual(188);
});

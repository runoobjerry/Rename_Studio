import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemePreference } from "./useThemePreference";

let systemDark: boolean;
let listeners: Set<() => void>;
beforeEach(() => {
  window.localStorage.clear();
  systemDark = false;
  listeners = new Set();
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return systemDark; },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });
const changeSystem = (dark: boolean) => act(() => { systemDark = dark; listeners.forEach((listener) => listener()); });

describe("theme preference", () => {
  it("defaults to system and follows live system appearance changes", () => {
    const { result } = renderHook(useThemePreference);
    expect(result.current.preference).toBe("system");
    expect(result.current.mode).toBe("light");
    changeSystem(true);
    expect(result.current.mode).toBe("dark");
    expect(window.localStorage.getItem("renamer-color-mode")).toBe("system");
  });

  it.each(["light", "dark"] as const)("preserves the existing saved %s preference", (mode) => {
    window.localStorage.setItem("renamer-color-mode", mode);
    const { result } = renderHook(useThemePreference);
    expect(result.current.preference).toBe(mode);
    expect(result.current.mode).toBe(mode);
  });

  it("persists explicit appearance without following the system until system is selected again", () => {
    const { result, unmount } = renderHook(useThemePreference);
    act(() => result.current.setPreference("light"));
    changeSystem(true);
    expect(result.current.mode).toBe("light");
    expect(window.localStorage.getItem("renamer-color-mode")).toBe("light");
    act(() => result.current.setPreference("system"));
    expect(result.current.mode).toBe("dark");
    unmount();
    const restored = renderHook(useThemePreference);
    expect(restored.result.current.preference).toBe("system");
    expect(restored.result.current.mode).toBe("dark");
  });
});

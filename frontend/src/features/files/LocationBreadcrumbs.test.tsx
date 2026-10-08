import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationBreadcrumbs } from "./LocationBreadcrumbs";
import type { DirectoryListing } from "../../types";

let available: number;
let resize: () => void;
beforeEach(() => {
  available = 1000;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.tagName === "BUTTON" ? 60 : available;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 30, width, height: 30, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const listing: DirectoryListing = {
  provider: "onedrive", path: "目录A/目录B/目录C/目录D/目录E", parent_path: "目录A/目录B/目录C/目录D",
  location: { kind: "id", value: "current-id" }, parent_location: { kind: "id", value: "parent-id" }, items: [],
};

describe("LocationBreadcrumbs", () => {
  it("navigates to root, ancestors and the canonical parent/current locations", () => {
    const onNavigate = vi.fn();
    render(<LocationBreadcrumbs listing={listing} rootLabel="根目录" disabled={false} onNavigate={onNavigate} />);
    const nav = within(screen.getByRole("navigation", { name: "文件路径" }));
    fireEvent.click(nav.getByRole("button", { name: "根目录" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: "root" });
    fireEvent.click(nav.getByRole("button", { name: "目录B" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: "path", value: "目录A/目录B" });
    fireEvent.click(nav.getByRole("button", { name: "目录D" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: "id", value: "parent-id" });
    fireEvent.click(nav.getByRole("button", { name: "目录E" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: "id", value: "current-id" });
    expect(nav.getByRole("button", { name: "目录E" })).toHaveAttribute("aria-current", "page");
  });

  it("folds only left ancestors to fit and expands again when space becomes available", () => {
    available = 210; // MoreHoriz + separator + D + separator + E = 192px.
    const onNavigate = vi.fn();
    render(<LocationBreadcrumbs listing={listing} rootLabel="根目录" disabled={false} onNavigate={onNavigate} />);
    const nav = within(screen.getByRole("navigation", { name: "文件路径" }));
    expect(nav.queryByRole("button", { name: "目录C" })).not.toBeInTheDocument();
    expect(nav.getByRole("button", { name: "目录D" })).toBeInTheDocument();
    expect(nav.getByRole("button", { name: "目录E" })).toBeInTheDocument();
    fireEvent.click(nav.getByRole("button", { name: "显示父级目录" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["根目录", "目录A", "目录B", "目录C"]);
    fireEvent.click(menu.getByRole("menuitem", { name: "目录C" }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: "path", value: "目录A/目录B/目录C" });
    available = 1000;
    act(() => resize());
    expect(nav.queryByRole("button", { name: "显示父级目录" })).not.toBeInTheDocument();
    expect(nav.getByRole("button", { name: "目录A" })).toBeInTheDocument();
  });

  it("keeps the current directory visible in narrow space and prevents navigation while busy", () => {
    available = 100;
    const onNavigate = vi.fn();
    render(<LocationBreadcrumbs listing={listing} rootLabel="根目录" disabled onNavigate={onNavigate} />);
    const nav = within(screen.getByRole("navigation", { name: "文件路径" }));
    expect(nav.getByRole("button", { name: "目录E" })).toBeDisabled();
    expect(nav.getByRole("button", { name: "显示父级目录" })).toBeDisabled();
    fireEvent.click(nav.getByRole("button", { name: "目录E" }));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

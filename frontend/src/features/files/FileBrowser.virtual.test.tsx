import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileBrowserHarness as FileBrowser } from "../../test/FileBrowserHarness";
import { PreviewPanel } from "../rename/PreviewPanel";

const items = Array.from({ length: 1000 }, (_, index) => ({
  id: `file-${index}`, name: `file-${index}`, path: `file-${index}`, parent_path: "",
  is_directory: index % 100 === 0, size: 1, modified_at: null,
}));
const listing = { provider: "local", path: "", parent_path: null, items };
const props = () => ({ listing, providerName: "test", selectedIds: [] as string[],
  onNavigate: vi.fn(), onToggle: vi.fn(), onSelectAll: vi.fn(), onInvertSelection: vi.fn() });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, bottom: 40, right: 800, height: 40, width: 800, toJSON: () => ({}),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("mounts a bounded window while selecting all filtered items, including unmounted rows", () => {
  const callbacks = props();
  render(<FileBrowser {...callbacks} />);
  expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "1001");
  expect(screen.getAllByRole("row").length).toBeLessThan(40);
  expect(screen.queryByRole("checkbox", { name: "选择文件 file-999" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示的全部项目" }));
  expect(callbacks.onSelectAll).toHaveBeenCalledWith([
    ...items.filter((item) => item.is_directory), ...items.filter((item) => !item.is_directory),
  ].map((item) => item.id));
});

it("renders distant rows on scroll and reaches the last row with the keyboard", async () => {
  render(<FileBrowser {...props()} />);
  const container = screen.getByRole("table").parentElement!;
  container.scrollTop = 6400;
  fireEvent.scroll(container);
  await screen.findByRole("checkbox", { name: "选择文件 file-150" });
  fireEvent.keyDown(container, { key: "End" });
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "选择文件 file-999" })).toHaveFocus());
  expect(screen.getAllByRole("row").length).toBeLessThan(40);
});

it("keeps a distant selected item's rename action attached to its opaque ID", async () => {
  const callbacks = { ...props(), selectedIds: ["file-999"], onRename: vi.fn() };
  render(<FileBrowser {...callbacks} />);
  expect(screen.queryByRole("button", { name: /^重命名 / })).not.toBeInTheDocument();
  const container = screen.getByRole("table").parentElement!;
  fireEvent.keyDown(container, { key: "End" });
  const rename = await screen.findByRole("button", { name: "重命名 file-999" });
  fireEvent.click(rename);
  expect(callbacks.onRename).toHaveBeenCalledWith("file-999");
  expect(callbacks.onSelectAll).not.toHaveBeenCalled();
  expect(screen.getAllByRole("row").length).toBeLessThan(40);
});

it("clears selections hidden by a filter across the entire dataset", () => {
  const callbacks = { ...props(), selectedIds: items.map((item) => item.id) };
  render(<FileBrowser {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件" }));
  expect(callbacks.onSelectAll).toHaveBeenCalledWith(items.filter((item) => !item.is_directory).map((item) => item.id));
});

it("sorts all rows before virtualization and resets the scroll position", () => {
  const callbacks = props();
  render(<FileBrowser {...callbacks} />);
  const container = screen.getByRole("table").parentElement!;
  container.scrollTop = 6400;
  fireEvent.scroll(container);
  fireEvent.click(screen.getByRole("button", { name: "文件名" }));
  expect(container.scrollTop).toBe(0);
  expect(screen.getAllByRole("row").length).toBeLessThan(40);
  expect(screen.getByRole("checkbox", { name: "选择文件 file-999" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示的全部项目" }));
  expect(callbacks.onSelectAll).toHaveBeenCalledWith([
    ...items.filter((item) => item.is_directory).reverse(), ...items.filter((item) => !item.is_directory).reverse(),
  ].map((item) => item.id));
});

it("filters errors across unmounted preview rows without losing full preview statistics", async () => {
  const preview = { preview_id: "preview", expires_at: "2099-01-01T00:00:00Z", valid: false,
    items: items.map((item, index) => ({ file_id: item.id, original_name: item.name, new_name: `new-${item.name}`,
      changed: true, valid: index !== 999, conflict: index === 999, error: index === 999 ? "名称冲突" : null })) };
  render(<PreviewPanel preview={preview} />);
  expect(screen.getAllByRole("row").length).toBeLessThan(40);
  expect(screen.getByText("999 项待修改 · 0 项无需修改")).toBeInTheDocument();
  expect(screen.queryByText("名称冲突")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
  expect(screen.getByText("名称冲突")).toBeInTheDocument();
  // 菜单打开时 MUI 隐藏背景的可访问角色，关闭后再检查表格。
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  const table = await screen.findByRole("table", { name: "修改预览" });
  expect(table).toHaveAttribute("aria-rowcount", "2");
});


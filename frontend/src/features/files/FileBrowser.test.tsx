import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileBrowserHarness as FileBrowser } from "../../test/FileBrowserHarness";

afterEach(() => { cleanup(); window.localStorage.clear(); });


const listing = {
  provider: "local",
  path: "",
  parent_path: null,
  items: [
    {
      id: "folder",
      name: "folder",
      path: "folder",
      parent_path: "",
      is_directory: true,
      size: null,
      modified_at: null,
    },
    {
      id: "file.txt",
      name: "file.txt",
      path: "file.txt",
      parent_path: "",
      is_directory: false,
      size: 4,
      modified_at: null,
    },
  ],
};

describe("FileBrowser", () => {

  it("navigates same-named folders by opaque location", () => {
    const navigate = vi.fn();
    const navigateLocation = vi.fn();
    render(<FileBrowser listing={{ ...listing, location: { kind: "id", value: "current-id" }, parent_location: { kind: "id", value: "parent-id" }, items: [
      { ...listing.items[0], id: "first", name: "same", location: { kind: "id", value: "first" } },
      { ...listing.items[0], id: "second", name: "same", location: { kind: "id", value: "second" } },
    ] }} storageName="Cloud" selectedIds={[]} onNavigate={navigate} onNavigateLocation={navigateLocation} onToggle={vi.fn()} onSelectAll={vi.fn()} onInvertSelection={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "same" })[1]);
    expect(navigateLocation).toHaveBeenCalledWith({ kind: "id", value: "second" }, { kind: "id", value: "current-id" });
    expect(navigate).not.toHaveBeenCalled();
  });
  it("selects a directory name without navigating into it", () => {
    const onNavigate = vi.fn();
    const onToggle = vi.fn();
    render(
      <FileBrowser
        listing={listing}
        storageName="本地文件"
        selectedIds={[]}
        onNavigate={onNavigate}
        onToggle={onToggle}
        onSelectAll={vi.fn()}
        onInvertSelection={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("选择文件夹 folder"));

    expect(onToggle).toHaveBeenCalledWith("folder");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("navigates only when the directory name is clicked", () => {
    const onNavigate = vi.fn();
    render(
      <FileBrowser
        listing={listing}
        storageName="本地文件"
        selectedIds={[]}
        onNavigate={onNavigate}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onInvertSelection={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /folder/ }));

    expect(onNavigate).toHaveBeenCalledWith("folder");
  });
});

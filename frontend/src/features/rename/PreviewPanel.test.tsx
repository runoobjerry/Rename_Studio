import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PreviewPanel } from "./PreviewPanel";

const validPreview = {
  preview_id: "preview-1",
  expires_at: "2026-09-28T12:00:00Z",
  valid: true,
  items: [
    {
      file_id: "one.txt",
      original_name: "one.txt",
      new_name: "renamed.txt",
      changed: true,
      valid: true,
      conflict: false,
      error: null,
    },
  ],
};

describe("PreviewPanel", () => {
  it("disables preview when no files are selected", () => {
    render(
      <PreviewPanel
        selectedCount={0}
        isPending={false}
        onPreview={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "预览 0 项" })).toBeDisabled();
  });

  it("requests a preview for selected files", () => {
    const onPreview = vi.fn();
    render(
      <PreviewPanel selectedCount={2} isPending={false} onPreview={onPreview} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预览 2 项" }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it("requires confirmation before executing a valid preview", () => {
    const onExecute = vi.fn();
    render(
      <PreviewPanel
        preview={validPreview}
        selectedCount={1}
        isPending={false}
        onPreview={vi.fn()}
        onExecute={onExecute}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "执行 1 项重命名" }));
    expect(onExecute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    expect(onExecute).toHaveBeenCalledWith("preview-1");
  });
});

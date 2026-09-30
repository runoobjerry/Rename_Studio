import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RenameActions } from "./RenameActions";

const validPreview = {
  preview_id: "preview-1",
  expires_at: "2026-09-28T12:00:00Z",
  valid: true,
  items: [{
    file_id: "one.txt",
    original_name: "one.txt",
    new_name: "renamed.txt",
    changed: true,
    valid: true,
    conflict: false,
    error: null,
  }],
};

describe("RenameActions", () => {
  it("requests a preview for the current selection", () => {
    const onPreview = vi.fn();
    render(
      <RenameActions
        providerName="本地文件"
        selectedCount={2}
        isPreviewing={false}
        isExecuting={false}
        hasExecuted={false}
        onPreview={onPreview}
        onExecute={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it("requires confirmation before starting a valid rename", () => {
    const onExecute = vi.fn();
    render(
      <RenameActions
        preview={validPreview}
        providerName="本地文件"
        selectedCount={1}
        isPreviewing={false}
        isExecuting={false}
        hasExecuted={false}
        onPreview={vi.fn()}
        onExecute={onExecute}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    expect(onExecute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    expect(onExecute).toHaveBeenCalledWith("preview-1");
  });
});

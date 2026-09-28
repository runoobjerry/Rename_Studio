import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
  it("shows the empty preview guidance", () => {
    render(<PreviewPanel providerName="本地文件" />);

    expect(screen.getByText(/预览不会修改 本地文件 中的内容/)).toBeInTheDocument();
  });

  it("shows a pending change in the preview table", () => {
    render(<PreviewPanel preview={validPreview} />);

    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.getByText("待修改")).toBeInTheDocument();
  });

  it("merges execution status into the preview row", () => {
    render(
      <PreviewPanel
        preview={validPreview}
        execution={{
          preview_id: "preview-1",
          status: "completed",
          items: [{
            file_id: "one.txt",
            original_name: "one.txt",
            new_name: "renamed.txt",
            status: "renamed",
            error: null,
          }],
        }}
      />,
    );

    expect(screen.getByText("已修改")).toBeInTheDocument();
    expect(screen.queryByText(/执行结果/)).not.toBeInTheDocument();
  });
});

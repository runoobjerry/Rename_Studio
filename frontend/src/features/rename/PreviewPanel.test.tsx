import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PreviewPanel } from "./PreviewPanel";

afterEach(cleanup);

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
  it("filters pending rows and keeps execution failures under errors", () => {
    render(<PreviewPanel preview={{ ...validPreview, items: [
      validPreview.items[0],
      { ...validPreview.items[0], file_id: "failed", original_name: "failed.txt", new_name: "failed-new.txt" },
      { ...validPreview.items[0], file_id: "unchanged", original_name: "same.txt", new_name: "same.txt", changed: false },
    ] }} execution={{ preview_id: "preview-1", status: "partial", items: [{
      file_id: "failed", original_name: "failed.txt", new_name: "failed-new.txt", status: "failed", error: "修改失败",
    }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "待修改" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "待修改" }));
    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.queryByText("failed-new.txt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "待修改" }));
    expect(screen.getByText("failed-new.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    expect(screen.getByText("failed-new.txt")).toBeInTheDocument();
    expect(screen.queryByText("renamed.txt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "无变化" }));
    expect(screen.queryByText("renamed.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("failed-new.txt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "无变化" }));
    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.getByText("failed-new.txt")).toBeInTheDocument();
  });
  it("shows the empty preview guidance", () => {
    render(<PreviewPanel providerName="本地文件" />);

    expect(screen.getByText(/预览不会修改 本地文件 中的内容/)).toBeInTheDocument();
  });

  it("shows the filtered empty state only while a nonempty filter excludes all rows", () => {
    render(<PreviewPanel preview={validPreview} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    expect(screen.getByText("没有符合筛选条件的项目。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.queryByText("没有符合筛选条件的项目。")).not.toBeInTheDocument();
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

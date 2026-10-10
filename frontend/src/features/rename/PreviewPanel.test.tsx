import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("keeps execution labels, original success categories and full-list counts distinct", () => {
    const item = validPreview.items[0];
    const items = ["renamed", "failed", "skipped", "pending", "unchanged"].map((id) => ({
      ...item, file_id: id, original_name: `${id}.txt`, new_name: `new-${id}.txt`,
      changed: id !== "unchanged",
    }));
    render(<PreviewPanel preview={{ ...validPreview, items }} execution={{
      preview_id: validPreview.preview_id, status: "partial", items: [
        { file_id: "renamed", original_name: "renamed.txt", new_name: "new-renamed.txt", status: "renamed", error: null },
        { file_id: "failed", original_name: "failed.txt", new_name: "new-failed.txt", status: "failed", error: null },
        { file_id: "skipped", original_name: "skipped.txt", new_name: "new-skipped.txt", status: "skipped", error: null },
      ],
    }} />);
    const table = within(screen.getByRole("table", { name: "修改预览" }));
    expect(table.getByText("已修改")).toHaveClass("valid");
    expect(table.getByText("new-renamed.txt")).toHaveClass("renamed-name");
    expect(table.getByText("修改失败")).toHaveClass("invalid");
    expect(table.getAllByText("无变化")).toHaveLength(2);
    expect(screen.getByText("1 项待修改 · 2 项无需修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "待修改" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    // 已修改仍属于原待修改筛选，但不能再计入待修改数量。
    expect(table.getByText("已修改")).toBeInTheDocument();
    expect(table.getByText("new-pending.txt")).toBeInTheDocument();
    expect(table.queryByText("修改失败")).not.toBeInTheDocument();
    expect(table.queryByText("new-skipped.txt")).not.toBeInTheDocument();
    expect(screen.getByText("1 项待修改 · 2 项无需修改 · 显示 2 项")).toBeInTheDocument();
  });

  it("keeps validation errors out of pending counts and uses their existing labels", () => {
    const item = validPreview.items[0];
    render(<PreviewPanel preview={{ ...validPreview, valid: false, items: [
      { ...item, file_id: "conflict", valid: false, conflict: true },
      { ...item, file_id: "invalid", valid: false },
      { ...item, file_id: "error", valid: false, error: "禁止字符" },
    ] }} />);
    const table = within(screen.getByRole("table", { name: "修改预览" }));
    expect(table.getByText("名称冲突")).toHaveClass("invalid");
    expect(table.getByText("不可修改")).toHaveClass("invalid");
    expect(table.getByText("禁止字符")).toHaveClass("invalid");
    expect(screen.getByText("0 项待修改 · 0 项无需修改")).toBeInTheDocument();
  });

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

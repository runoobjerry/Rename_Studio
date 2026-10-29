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
  it("shows confirmed and unverified results with independent counts and error filtering", () => {
    const item = validPreview.items[0];
    const items = ["renamed", "failed", "skipped", "unchanged", "unknown", "missing", "unrestored"].map((id) => ({
      ...item, file_id: id, original_name: `${id}.txt`, new_name: id === "unchanged" ? "unchanged.txt" : `new-${id}.txt`,
      changed: id !== "unchanged",
    }));
    const unknownExecution = {
      storageId: "default-local", previewId: validPreview.preview_id,
      items: items.filter((item) => ["unknown", "missing", "unrestored"].includes(item.file_id)),
    };
    const { rerender } = render(<PreviewPanel preview={{ ...validPreview, items }} unknownExecution={unknownExecution} execution={{
      preview_id: validPreview.preview_id, status: "partial", items: [
        { file_id: "renamed", original_name: "renamed.txt", new_name: "new-renamed.txt", status: "renamed", error: null },
        { file_id: "unknown", original_name: "unknown.txt", new_name: "new-unknown.txt", status: "failed", error: "Unknown outcome", error_code: "RENAME_OUTCOME_UNKNOWN" },
        { file_id: "unrestored", original_name: "unrestored.txt", new_name: "new-unrestored.txt", status: "failed", error: "Rollback failed", actual_name: "temporary.txt" },
        { file_id: "failed", original_name: "failed.txt", new_name: "new-failed.txt", status: "failed", error: null },
        { file_id: "skipped", original_name: "skipped.txt", new_name: "new-skipped.txt", status: "skipped", error: null },
        { file_id: "unchanged", original_name: "unchanged.txt", new_name: "unchanged.txt", status: "skipped", error: null },
      ],
    }} />);
    const table = within(screen.getByRole("table", { name: "修改预览" }));
    expect(table.getByText("已修改")).toHaveClass("valid");
    expect(table.getAllByText("待核对")).toHaveLength(3);
    expect(table.getAllByText("N/A")).toHaveLength(3);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("当前存在无法获取最新状态的文件，请刷新文件目录或前往文件源进行检查");
    expect(screen.getByRole("region", { name: "修改预览" }).lastElementChild).toBe(alert);
    expect(table.queryByText("new-unknown.txt")).not.toBeInTheDocument();
    expect(table.queryByText("new-missing.txt")).not.toBeInTheDocument();
    expect(table.queryByText("new-unrestored.txt")).not.toBeInTheDocument();
    expect(table.getByText("new-renamed.txt")).toHaveClass("renamed-name");
    expect(table.getByText("修改失败")).toHaveClass("invalid");
    expect(table.getAllByText("无变化")).toHaveLength(2);
    expect(screen.getByText("0 项待修改 · 2 项无需修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "待修改" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "已修改" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(table.getByText("已修改")).toBeInTheDocument();
    expect(table.queryByText("待修改")).not.toBeInTheDocument();
    expect(table.queryByText("修改失败")).not.toBeInTheDocument();
    expect(table.queryByText("new-skipped.txt")).not.toBeInTheDocument();
    expect(table.queryByText("unchanged.txt")).not.toBeInTheDocument();
    expect(screen.getByText("0 项待修改 · 2 项无需修改 · 显示 1 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "已修改" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(table.getAllByText("待核对")).toHaveLength(3);
    expect(table.getAllByText("N/A")).toHaveLength(3);
    expect(table.getByText("修改失败")).toBeInTheDocument();
    expect(table.queryByText("new-renamed.txt")).not.toBeInTheDocument();
    expect(screen.getByText("0 项待修改 · 2 项无需修改 · 显示 4 项")).toBeInTheDocument();
    // 丢失整次响应且没有执行展示时，仍由待核对记录展示文件。
    rerender(<PreviewPanel unknownExecution={unknownExecution} />);
    expect(table.getAllByText("待核对")).toHaveLength(3);
    expect(table.getAllByText("N/A")).toHaveLength(3);
    expect(screen.getByText("0 项待修改 · 0 项无需修改 · 显示 3 项")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(table.getAllByText("待核对")).toHaveLength(3);
    expect(table.getAllByText("N/A")).toHaveLength(3);
    rerender(<PreviewPanel unknownExecution={{ ...unknownExecution, previewUnlocked: true }} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<PreviewPanel unknownExecution={{ ...unknownExecution, previewId: "next-execution" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("当前存在无法获取最新状态的文件，请刷新文件目录或前往文件源进行检查");
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

  it("switches the selected pending filter to renamed results and separates failures and skipped rows", () => {
    const preview = { ...validPreview, items: [
      validPreview.items[0],
      { ...validPreview.items[0], file_id: "failed", original_name: "failed.txt", new_name: "failed-new.txt" },
      { ...validPreview.items[0], file_id: "unchanged", original_name: "same.txt", new_name: "same.txt", changed: false },
    ] };
    const { rerender } = render(<PreviewPanel preview={preview} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "待修改" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "待修改" }));
    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.getByText("failed-new.txt")).toBeInTheDocument();
    expect(screen.queryByText("same.txt")).not.toBeInTheDocument();
    rerender(<PreviewPanel preview={preview} execution={{ preview_id: "preview-1", status: "partial", items: [
      { file_id: "one.txt", original_name: "one.txt", new_name: "renamed.txt", status: "renamed", error: null },
      { file_id: "failed", original_name: "failed.txt", new_name: "failed-new.txt", status: "failed", error: "修改失败" },
      { file_id: "unchanged", original_name: "same.txt", new_name: "same.txt", status: "skipped", error: null },
    ] }} />);
    expect(screen.queryByRole("menuitemcheckbox", { name: "待修改" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "已修改" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.queryByText("failed-new.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("same.txt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "已修改" }));
    expect(screen.getByText("failed-new.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    expect(screen.getByText("failed-new.txt")).toBeInTheDocument();
    expect(screen.queryByText("renamed.txt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "无变化" }));
    expect(screen.queryByText("renamed.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("failed-new.txt")).not.toBeInTheDocument();
    expect(screen.getAllByText("same.txt")).toHaveLength(2);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "无变化" }));
    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.getByText("failed-new.txt")).toBeInTheDocument();
  });
  it("shows the filtered empty state only while a nonempty filter excludes all rows", () => {
    render(<PreviewPanel preview={validPreview} />);
    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.getByText("待修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    expect(screen.getByText("没有符合筛选条件的项目。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "错误" }));
    expect(screen.getByText("renamed.txt")).toBeInTheDocument();
    expect(screen.queryByText("没有符合筛选条件的项目。")).not.toBeInTheDocument();
  });
});


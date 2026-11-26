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
  it("shows unsubmitted items by skip reason even when their diagnostic is translated or absent", () => {
    const items = ["stopped", "not-started", "legacy"].map((file_id) => ({ ...validPreview.items[0], file_id }));
    render(<PreviewPanel preview={{ ...validPreview, items }} execution={{
      preview_id: validPreview.preview_id, status: "incomplete",
      counts: { renamed: 0, skipped: 2, failed: 1, unknown: 0 },
      items: [
        { file_id: "stopped", original_name: "one.txt", new_name: "renamed.txt", status: "skipped",
          error: "后续组未提交", error_code: "PROVIDER_ERROR",
          details: { reason: "RENAME_NOT_ATTEMPTED", stop_reason: "RENAME_OUTCOME_UNKNOWN" } },
        { file_id: "not-started", original_name: "one.txt", new_name: "renamed.txt", status: "skipped",
          error: null, error_code: "PROVIDER_ERROR", details: { reason: "RENAME_NOT_ATTEMPTED" } },
        { file_id: "legacy", original_name: "one.txt", new_name: "renamed.txt", status: "failed",
          error: "Rename was not attempted", error_code: "PROVIDER_ERROR" },
      ],
    }} />);
    expect(screen.getAllByText("未修改")).toHaveLength(2);
    expect(screen.getByText("无法访问存储服务")).toBeInTheDocument();
    expect(screen.queryByText("后续组未提交")).not.toBeInTheDocument();
    expect(screen.getAllByText("未提供当前名称")).toHaveLength(3);
    expect(screen.queryByText("修改结果无法确认")).not.toBeInTheDocument();
  });

  it("shows confirmed and unverified results with independent counts", () => {
    const item = validPreview.items[0];
    const items = ["renamed", "failed", "skipped", "unchanged", "unknown", "missing"].map((id) => ({
      ...item, file_id: id, original_name: `${id}.txt`, new_name: id === "unchanged" ? "unchanged.txt" : `new-${id}.txt`,
      changed: id !== "unchanged",
    }));
    const unknownExecution = {
      storageId: "default-local", location: { kind: "root" } as const, previewId: validPreview.preview_id,
      items: items.filter((item) => ["unknown", "missing"].includes(item.file_id)),
    };
    const { rerender } = render(<PreviewPanel preview={{ ...validPreview, items }} unknownExecution={unknownExecution} executeError="Execution response lost" execution={{
      preview_id: validPreview.preview_id, status: "incomplete",
      counts: { renamed: 1, skipped: 2, failed: 1, unknown: 1 },
      items: [
        { file_id: "renamed", original_name: "renamed.txt", new_name: "new-renamed.txt", status: "renamed", error: null },
        { file_id: "unknown", original_name: "unknown.txt", new_name: "new-unknown.txt", status: "unknown", error: "Unknown outcome", error_code: "RENAME_OUTCOME_UNKNOWN" },
        { file_id: "failed", original_name: "failed.txt", new_name: "new-failed.txt", status: "failed", error: null },
        { file_id: "skipped", original_name: "skipped.txt", new_name: "new-skipped.txt", status: "skipped", error: null },
        { file_id: "unchanged", original_name: "unchanged.txt", new_name: "unchanged.txt", status: "skipped", error: null },
      ],
    }} />);
    const table = within(screen.getByRole("table", { name: "修改预览" }));
    expect(table.getByText("已修改")).toBeInTheDocument();
    expect(table.getAllByText("待核对")).toHaveLength(2);
    expect(table.getAllByText("修改结果无法确认")).toHaveLength(2);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("部分重命名结果尚未确认。请刷新目录，或前往对应的云盘或本地目录核对。");
    expect(screen.getByRole("region", { name: "修改预览" }).lastElementChild).toBe(alert);
    expect(table.queryByText("new-unknown.txt")).not.toBeInTheDocument();
    expect(table.queryByText("new-missing.txt")).not.toBeInTheDocument();
    expect(table.getByRole("cell", { name: "new-renamed.txt" })).toHaveClass("renamed-name");
    expect(table.getByText("修改失败")).toBeInTheDocument();
    expect(table.getAllByText("无变化")).toHaveLength(2);
    expect(screen.getByText("0 项待修改 · 2 项无需修改")).toBeInTheDocument();
    // 丢失整次响应且没有执行展示时，仍由待核对记录展示文件。
    rerender(<PreviewPanel unknownExecution={unknownExecution} />);
    expect(table.getAllByText("待核对")).toHaveLength(2);
    expect(table.getAllByText("修改结果无法确认")).toHaveLength(2);
    expect(screen.getByText("0 项待修改 · 0 项无需修改")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(table.getAllByText("待核对")).toHaveLength(2);
    expect(table.getAllByText("修改结果无法确认")).toHaveLength(2);
    rerender(<PreviewPanel unknownExecution={{ ...unknownExecution, previewId: "next-execution" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("部分重命名结果尚未确认。请刷新目录，或前往对应的云盘或本地目录核对。");
  });

  it("keeps validation errors out of pending counts and uses their existing labels", () => {
    const item = validPreview.items[0];
    render(<PreviewPanel preview={{ ...validPreview, valid: false, items: [
      { ...item, file_id: "conflict", valid: false, conflict: true },
      { ...item, file_id: "invalid", valid: false },
      { ...item, file_id: "error", valid: false, error: "Filename cannot end with a space or period",
        details: { reason: "NAME_INVALID_ENDING", params: {} } },
    ] }} />);
    const table = within(screen.getByRole("table", { name: "修改预览" }));
    expect(table.getByText("名称冲突")).toBeInTheDocument();
    expect(table.getByText("不可修改")).toBeInTheDocument();
    expect(table.getByText("名称以空格或句点结尾")).toBeInTheDocument();
    expect(screen.getByText("0 项待修改 · 0 项无需修改")).toBeInTheDocument();
  });

});


import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RenameActions } from "./RenameActions";
afterEach(cleanup);

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
        connectionName="我的相册"
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

  it("requires confirmation and offers a new preview after revalidation fails", () => {
    const onExecute = vi.fn();
    const onPreview = vi.fn();
    const { rerender } = render(
      <RenameActions
        preview={validPreview}
        connectionName="我的相册"
        selectedCount={1}
        isPreviewing={false}
        isExecuting={false}
        hasExecuted={false}
        onPreview={onPreview}
        onExecute={onExecute}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "确认修改" })).toBeInTheDocument();
    expect(screen.getByText("将按当前预览重命名文件来源「我的相册」中的 1 个项目。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onExecute).toHaveBeenCalledWith("preview-1");
    expect(screen.getByRole("heading", { name: "正在提交修改" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("当前任务已处理 0 项，共 1 项");
    expect(screen.getByText("将按当前预览重命名文件来源「我的相册」中的 1 个项目。")).not.toBeVisible();
    expect(screen.getByRole("progressbar", { name: "修改进度" })).toHaveAttribute("aria-valuenow", "0");
    const message = "当前预览过期或文件状态发生变化。";
    rerender(<RenameActions preview={validPreview} connectionName="我的相册" selectedCount={1}
      isPreviewing={false} isExecuting={false} hasExecuted={false}
      revalidationError={message} executeError="Raw server diagnostic" onPreview={onPreview} onExecute={onExecute} />);
    const modal = within(screen.getByRole("dialog"));
    expect(modal.getByRole("status").textContent).toBe(message);
    expect(modal.queryByRole("button", { name: "应用" })).not.toBeInTheDocument();
    expect(modal.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.click(modal.getByRole("button", { name: "刷新预览" }));
    expect(onPreview).toHaveBeenCalledOnce();
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("renders server counts while pending and closes when execution returns", async () => {
    const props = { preview: validPreview, connectionName: "我的相册", selectedCount: 1,
      isPreviewing: false, isExecuting: false, hasExecuted: false, onPreview: vi.fn(), onExecute: vi.fn() };
    const { rerender } = render(<RenameActions {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    expect(screen.getByRole("progressbar", { name: "修改进度" })).toHaveAttribute("aria-valuenow", "0");
    rerender(<RenameActions {...props} isExecuting progress={{ preview_id: "preview-1", total: 200, processed: 199, phase: "renaming", error: null }} />);
    expect(screen.getByRole("progressbar", { name: "修改进度" })).toHaveAttribute("aria-valuenow", "99");
    expect(screen.getByRole("heading", { name: "正在修改" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("当前任务已处理 199 项，共 200 项");
    expect(screen.queryByText("正在修改…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    rerender(<RenameActions {...props} isExecuting progress={{ preview_id: "preview-1", total: 200, processed: 200, phase: "finished", error: null }} />);
    expect(screen.getByRole("heading", { name: "正在修改" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
    rerender(<RenameActions {...props} hasExecuted />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not invent progress on polling failure and closes after the execution request fails", async () => {
    const props = { preview: validPreview, connectionName: "我的相册", selectedCount: 1,
      isPreviewing: false, isExecuting: false, hasExecuted: false, onPreview: vi.fn(), onExecute: vi.fn() };
    const { rerender } = render(<RenameActions {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    rerender(<RenameActions {...props} isExecuting progressError="network unavailable"
      progress={{ preview_id: "other-preview", total: 10, processed: 8, phase: "renaming", error: null }} />);
    expect(screen.getByRole("progressbar", { name: "修改进度" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("status")).toHaveTextContent("暂时无法读取进度：network unavailable；执行请求仍在进行，请勿重复提交。");
    expect(screen.queryByText(/当前任务已处理/)).not.toBeInTheDocument();
    rerender(<RenameActions {...props} executeError="execution failed" progressError="network unavailable" />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

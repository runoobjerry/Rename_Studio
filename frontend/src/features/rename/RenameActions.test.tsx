import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RenameActions } from "./RenameActions";
afterEach(() => { cleanup(); vi.useRealTimers(); });

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
    expect(screen.getByRole("heading", { name: "等待确认" })).toBeInTheDocument();
    expect(screen.getByText("此操作不可恢复！")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onExecute).toHaveBeenCalledWith("preview-1");
    expect(screen.getByRole("status")).toHaveTextContent("当前任务已处理 0 项，共 1 项");
    expect(screen.queryByText("此操作不可恢复！")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "修改进度" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("renders server counts and briefly shows completion before closing", () => {
    vi.useFakeTimers();
    const props = { preview: validPreview, providerName: "本地文件", selectedCount: 1,
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
    rerender(<RenameActions {...props} hasExecuted />);
    expect(screen.getByRole("progressbar", { name: "修改进度" })).toHaveAttribute("aria-valuenow", "100");
    act(() => { vi.advanceTimersByTime(600); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not invent progress on polling failure or use another preview's counts", () => {
    const props = { preview: validPreview, providerName: "本地文件", selectedCount: 1,
      isPreviewing: false, isExecuting: false, hasExecuted: false, onPreview: vi.fn(), onExecute: vi.fn() };
    const { rerender } = render(<RenameActions {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    rerender(<RenameActions {...props} isExecuting progressError="network unavailable"
      progress={{ preview_id: "other-preview", total: 10, processed: 8, phase: "renaming", error: null }} />);
    expect(screen.getByRole("progressbar", { name: "修改进度" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("status")).toHaveTextContent("暂时无法读取进度：network unavailable；执行请求仍在进行，请勿重复提交。");
    expect(screen.queryByText(/当前任务已处理/)).not.toBeInTheDocument();
    rerender(<RenameActions {...props} executeError="execution failed" progressError="network unavailable" />);
    expect(screen.getByRole("heading", { name: "执行失败" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("返回错误：execution failed");
    expect(screen.queryByText(/执行请求仍在进行/)).not.toBeInTheDocument();
  });
});


it("requires server execution confirmation even when a task batch has no changes", () => {
  const onExecute = vi.fn();
  const preview = { ...validPreview, items: validPreview.items.map((item) => ({ ...item, changed: false, new_name: item.original_name })) };
  render(<RenameActions preview={preview} providerName="本地文件" selectedCount={1} isPreviewing={false} isExecuting={false}
    hasExecuted={false} allowUnchangedBatch onPreview={vi.fn()} onExecute={onExecute} />);
  fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
  expect(onExecute).not.toHaveBeenCalled();
  expect(screen.getByText(/本批没有名称变化/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  expect(onExecute).toHaveBeenCalledWith("preview-1");
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { errorMessage, NotificationProvider, useNotification } from "./NotificationProvider";
import { i18n } from "../i18n";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Actions() {
  const notify = useNotification();
  return (
    <>
      <button onClick={() => notify("保存完成")}>成功通知</button>
      <button onClick={() => notify("部分修改失败", "warning")}>新通知</button>
      <button onClick={() => notify("请求失败", "error")}>错误通知</button>
      <button onClick={() => notify({ key: "files:notifications.completed", values: { count: 2 } })}>数量通知</button>
      <button onClick={() => notify({ key: "files:notifications.defaultSaved", values: { path: "<b>工作目录</b>" } })}>路径通知</button>
      <button onClick={() => { notify("保存完成"); notify("部分修改失败", "warning"); }}>连续通知</button>
    </>
  );
}

describe("shared notifications", () => {
  it("keeps notification counts and literal paths intact across language changes", async () => {
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "数量通知" }));
    expect(screen.getByRole("alert")).toHaveTextContent("修改全部成功：2 项已修改。");
    await act(async () => { await i18n.changeLanguage("en-US"); });
    expect(screen.getByRole("alert")).toHaveTextContent("Renaming completed successfully: 2 items renamed.");
    fireEvent.click(screen.getByRole("button", { name: "路径通知" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Set “<b>工作目录</b>” as the default location for the current account.");
    expect(screen.getByRole("alert").querySelector("b")).toBeNull();
    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(screen.getByRole("alert")).toHaveTextContent("已将“<b>工作目录</b>”设为当前账号的默认路径。");
  });
  it("auto-closes notifications after five seconds", () => {
    vi.useFakeTimers();
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "成功通知" }));
    act(() => { vi.advanceTimersByTime(4999); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("gives the new notification its own timer and ignores the old exit callback", () => {
    vi.useFakeTimers();
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "成功通知" }));
    act(() => { vi.advanceTimersByTime(4500); });
    fireEvent.click(screen.getByRole("button", { name: "新通知" }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole("alert")).toHaveTextContent("部分修改失败");
    act(() => { vi.advanceTimersByTime(4500); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("only displays the newest message in a same-render burst without leaking intermediate messages", () => {
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "连续通知" }));
    expect(screen.getByRole("alert")).toHaveTextContent("部分修改失败");
    expect(screen.queryByText("保存完成")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adds actionable context to expired preview errors", () => {
    expect(errorMessage(new ApiError(409, "Expired", "PREVIEW_EXPIRED"))).toBe("预览已失效，请刷新预览。");
  });

  it("keeps other error messages available", () => {
    expect(errorMessage(new Error("Network unavailable"))).toBe("Network unavailable");
  });
});



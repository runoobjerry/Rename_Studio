import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { errorMessage, NotificationProvider, useNotification } from "./NotificationProvider";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Actions() {
  const notify = useNotification();
  return (
    <>
      <button onClick={() => notify("保存完成")}>成功通知</button>
      <button onClick={() => notify("部分修改失败", "warning")}>新通知</button>
      <button onClick={() => notify("请求失败", "error")}>错误通知</button>
      <button onClick={() => { notify("保存完成"); notify("部分修改失败", "warning"); }}>连续通知</button>
    </>
  );
}

describe("shared notifications", () => {
  it("shows a new notification immediately while the old one fades in place", async () => {
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "成功通知" }));
    expect(screen.getByText("保存完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新通知" }));
    expect(screen.getByRole("alert")).toHaveTextContent("部分修改失败");
    expect(screen.getByText("保存完成")).toBeInTheDocument();
    expect(screen.getByText("保存完成").closest(".MuiSnackbar-root")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("保存完成").closest(".MuiAlert-root")).toHaveStyle({ transform: "none" });
    await waitFor(() => expect(screen.queryByText("保存完成")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("部分修改失败");
  });

  it("keeps a dismissed notification mounted until the normal reverse animation ends", async () => {
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "成功通知" }));
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.getByText("保存完成")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("保存完成").closest(".MuiAlert-root")?.getAttribute("style")).toContain("scale");
    await waitFor(() => expect(screen.queryByText("保存完成")).not.toBeInTheDocument());
  });

  it.each(["成功通知", "错误通知"])("auto-closes %s after five seconds, then removes it after the exit animation", (button) => {
    vi.useFakeTimers();
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: button }));
    act(() => { vi.advanceTimersByTime(4999); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.querySelector(".MuiSnackbar-root")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(180); });
    expect(document.querySelector(".MuiSnackbar-root")).toBeNull();
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

  it("only displays the newest message in a same-render burst without leaking intermediate messages", async () => {
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "连续通知" }));
    expect(screen.getByRole("alert")).toHaveTextContent("部分修改失败");
    expect(screen.queryByText("保存完成")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(document.querySelectorAll(".MuiSnackbar-root")).toHaveLength(0));
  });

  it("adds actionable context to expired preview errors", () => {
    expect(errorMessage(new ApiError(409, "Expired", "PREVIEW_EXPIRED"))).toContain("请重新预览");
  });

  it("keeps other error messages available", () => {
    expect(errorMessage(new Error("Network unavailable"))).toBe("Network unavailable");
  });
});

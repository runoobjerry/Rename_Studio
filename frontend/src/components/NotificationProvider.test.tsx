import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { errorMessage, NotificationProvider, useNotification } from "./NotificationProvider";

afterEach(cleanup);

function Actions() {
  const notify = useNotification();
  return (
    <>
      <button onClick={() => { notify("保存完成"); notify("部分修改失败", "warning"); }}>通知</button>
    </>
  );
}

describe("shared notifications", () => {
  it("queues results without replacing an unread notification", async () => {
    render(<NotificationProvider><Actions /></NotificationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(screen.getByText("保存完成")).toBeInTheDocument();
    expect(screen.queryByText("部分修改失败")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.getByText("部分修改失败")).toBeInTheDocument());
  });

  it("adds actionable context to expired preview errors", () => {
    expect(errorMessage(new ApiError(409, "Expired", "PREVIEW_EXPIRED"))).toContain("请重新预览");
  });

  it("keeps other error messages available", () => {
    expect(errorMessage(new Error("Network unavailable"))).toBe("Network unavailable");
  });
});

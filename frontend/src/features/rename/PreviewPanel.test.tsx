import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PreviewPanel } from "./PreviewPanel";

describe("PreviewPanel", () => {
  it("disables preview when no files are selected", () => {
    render(
      <PreviewPanel
        selectedCount={0}
        isPending={false}
        onPreview={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "预览 0 项" })).toBeDisabled();
  });

  it("requests a preview for selected files", () => {
    const onPreview = vi.fn();
    render(
      <PreviewPanel selectedCount={2} isPending={false} onPreview={onPreview} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预览 2 项" }));
    expect(onPreview).toHaveBeenCalledOnce();
  });
});

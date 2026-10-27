import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n, loadLanguageResources } from "../../i18n";
import { SingleRenameDialog } from "./SingleRenameDialog";

afterEach(cleanup);

const props = () => ({
  initialName: "archive.tar", extension: ".gz", isDirectory: false,
  isRenaming: false, canApply: true, onApply: vi.fn(), onClose: vi.fn(),
});

describe("single rename dialog", () => {
  it("updates translated labels without changing the name being edited", async () => {
    render(<SingleRenameDialog {...props()} />);
    const input = screen.getByRole("textbox", { name: "新名称" });
    fireEvent.change(input, { target: { value: "原始草稿.tar" } });
    await act(async () => {
      await loadLanguageResources("en-US");
      await i18n.changeLanguage("en-US");
    });
    expect(screen.getByRole("dialog", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New name" })).toHaveValue("原始草稿.tar");
    expect(screen.getByRole("textbox", { name: "Extension" })).toHaveValue("gz");
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });
});

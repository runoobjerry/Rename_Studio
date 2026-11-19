import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

const options = [
  { value: "all", label: "全部" },
  { value: "files", label: "文件" },
  { value: "folders", label: "文件夹" },
] as const;

afterEach(cleanup);

describe("SegmentedControl", () => {
  it("exposes a labelled, single-select MUI button group", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="all" onChange={onChange} ariaLabel="文件类型" />);

    expect(screen.getByRole("group", { name: "文件类型" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "文件" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "文件" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("files");
  });

  it("animates the indicator when the controlled value changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl options={options} value="all" onChange={onChange} ariaLabel="文件类型" />,
    );
    const indicator = screen.getByTestId("segmented-control-indicator");
    expect(indicator).toHaveStyle({ transform: "translateX(0%)" });

    rerender(<SegmentedControl options={options} value="folders" onChange={onChange} ariaLabel="文件类型" />);
    expect(indicator).toHaveStyle({ transform: "translateX(200%)" });
  });

  it("does not clear the selected option when clicked again", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="all" onChange={onChange} ariaLabel="文件类型" />);
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("respects disabled options and the disabled group state", () => {
    const onChange = vi.fn();
    const disabledOptions = [options[0], { ...options[1], disabled: true }, options[2]];
    const { rerender } = render(
      <SegmentedControl options={disabledOptions} value="all" onChange={onChange} ariaLabel="文件类型" />,
    );
    expect(screen.getByRole("button", { name: "文件" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "文件" }));
    expect(onChange).not.toHaveBeenCalled();

    rerender(<SegmentedControl options={options} value="all" onChange={onChange} ariaLabel="文件类型" disabled />);
    expect(screen.getByRole("button", { name: "全部" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "文件夹" })).toBeDisabled();
  });

  it("supports an accessible icon-only option", () => {
    render(
      <SegmentedControl
        options={[{ value: "grid", label: "▦", ariaLabel: "网格视图" }, { value: "list", label: "≡", ariaLabel: "列表视图" }]}
        value="grid"
        onChange={() => undefined}
        ariaLabel="显示方式"
      />,
    );
    expect(screen.getByRole("button", { name: "网格视图" })).toHaveAttribute("aria-pressed", "true");
  });
});

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

const overscan = 8;
const virtualizationThreshold = 100;

// 两张表均为单行内容；测量真实行高，保留主题的复选框和单元格几何。
export function useVirtualTable(count: number, resetKey: unknown, columnValues: readonly (readonly string[])[],
  fixedColumnWidths?: readonly number[]) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [range, setRange] = useState({ start: 0, end: 24, rowHeight: 38 });
  const frame = useRef<number>();
  const focusFrame = useRef<number>();
  const focusedIndex = useRef(0);
  const [columnWidths, setColumnWidths] = useState<number[]>();
  const enabled = count > virtualizationThreshold;
  useLayoutEffect(() => {
    if (!container || !enabled) { setColumnWidths(undefined); return; }
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return; // 浏览器无法创建绘图上下文时仍可使用原生自动列宽。
    const updateWidths = () => {
      const cells = container.querySelectorAll<HTMLElement>("tr[data-row-index]:first-of-type > td");
      // 顶部占位行存在时，数据行并非 first-of-type。
      const dataCells = cells.length ? cells : container.querySelector<HTMLElement>("tr[data-row-index]")?.children;
      const headers = container.querySelectorAll<HTMLElement>("thead th");
      if (!dataCells) return;
      const widths = columnValues.map((values, index) => {
        // 选择等固定操作列不从当前 DOM 反推宽度，避免布局结果回写列宽。
        const fixedWidth = fixedColumnWidths?.[index];
        if (fixedWidth !== undefined) return fixedWidth;
        const cell = dataCells[index] as HTMLElement;
        const text = cell.querySelector<HTMLElement>(".file-name, .status") ?? cell;
        const style = getComputedStyle(text);
        context.font = style.font;
        const letterSpacing = parseFloat(style.letterSpacing) || 0;
        let width = values.reduce((max, value) => Math.max(max, context.measureText(value).width + value.length * letterSpacing), 0);
        if (text.classList.contains("file-name")) width = Math.min(width, innerWidth * 0.32, 420) + 28;
        if (text.classList.contains("status")) width += 26; // 状态标签的左右内边距、圆点和间隔。
        const headerStyle = getComputedStyle(headers[index]);
        context.font = headerStyle.font;
        width = Math.max(width, context.measureText(headers[index].textContent ?? "").width);
        const cellStyle = getComputedStyle(cell);
        return Math.ceil(width + parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight) + 1);
      });
      setColumnWidths((current) => current?.every((width, index) => width === widths[index]) ? current : widths);
    };
    // 按完整数据测量文本，未挂载的长名称也参与列宽，滚动时不会随视口内容伸缩。
    updateWidths();
    const observer = new ResizeObserver(updateWidths);
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, enabled, columnValues, fixedColumnWidths]);
  const measure = useCallback(() => {
    if (!container) return;
    const rowHeight = container.querySelector<HTMLElement>("tr[data-row-index]")?.getBoundingClientRect().height || 38;
    const headerHeight = container.querySelector("thead")?.getBoundingClientRect().height ?? 38;
    const viewport = Math.max(rowHeight, container.clientHeight - headerHeight);
    const first = Math.min(Math.max(0, count - Math.ceil(viewport / rowHeight)), Math.floor(container.scrollTop / rowHeight));
    const start = Math.max(0, first - overscan);
    const end = Math.min(count, first + Math.ceil(viewport / rowHeight) + overscan);
    const active = document.activeElement;
    const focusedRow = active instanceof HTMLElement && container.contains(active)
      ? active.closest<HTMLElement>("tr[data-row-index]") : null;
    if (focusedRow) {
      const index = Number(focusedRow.dataset.rowIndex);
      if (index < start || index >= end) {
        // 滚轮移出已聚焦行时先保留表格焦点，避免该行卸载后焦点落到 body。
        focusedIndex.current = index;
        container.focus({ preventScroll: true });
      }
    }
    setRange((current) => current.start === start && current.end === end && current.rowHeight === rowHeight
      ? current : { start, end, rowHeight });
  }, [container, count]);
  useLayoutEffect(() => {
    if (!container) return;
    if (frame.current !== undefined) { cancelAnimationFrame(frame.current); frame.current = undefined; }
    if (focusFrame.current !== undefined) { cancelAnimationFrame(focusFrame.current); focusFrame.current = undefined; }
    container.scrollTop = 0;
    focusedIndex.current = 0;
    measure();
  }, [container, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps -- 换目录/筛选时回到顶部，选择变化不重置滚动。
  useLayoutEffect(() => {
    if (!container || !enabled) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const row = container.querySelector("tr[data-row-index]");
    if (row) observer.observe(row);
    measure();
    return () => {
      observer.disconnect();
      if (frame.current !== undefined) { cancelAnimationFrame(frame.current); frame.current = undefined; }
    };
  }, [container, enabled, measure]);
  useLayoutEffect(() => () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
  }, []);
  const onScroll = useCallback(() => {
    if (!enabled || frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      measure();
    });
  }, [enabled, measure]);
  const start = enabled ? Math.min(range.start, Math.max(0, count - 1)) : 0;
  const end = enabled ? Math.min(count, Math.max(start + 1, range.end)) : count;
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || !container || count === 0) return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("tr[data-row-index]");
    const index = row ? Number(row.dataset.rowIndex) : focusedIndex.current;
    let next: number;
    if (event.key === "ArrowDown") next = row ? index + 1 : start;
    else if (event.key === "ArrowUp") next = index - 1;
    else if (event.key === "Home" && (event.ctrlKey || target === row || target === container)) next = 0;
    else if (event.key === "End" && (event.ctrlKey || target === row || target === container)) next = count - 1;
    else if (event.key === "Tab" && row) {
      const controls = [...row.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled), [tabindex='0']")];
      const atBoundary = event.shiftKey ? target === (controls[0] ?? row) : target === (controls.at(-1) ?? row);
      next = index + (event.shiftKey ? -1 : 1);
      if (!atBoundary || next < 0 || next >= count || (next >= start && next < end)) return;
    } else return;
    event.preventDefault();
    next = Math.max(0, Math.min(count - 1, next));
    focusedIndex.current = next;
    // 先将目标行纳入窗口，再转移焦点，Tab/方向键不会停在已挂载行的边界。
    container.scrollTop = next * range.rowHeight;
    measure();
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      const nextRow = container.querySelector<HTMLElement>(`tr[data-row-index="${next}"]`);
      const controls = nextRow?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)");
      const control = event.key === "Tab" && event.shiftKey ? controls?.[controls.length - 1] : controls?.[0];
      (control ?? nextRow)?.focus();
      focusFrame.current = undefined;
    });
  }, [enabled, container, count, start, end, range.rowHeight, measure]);
  return { containerRef: setContainer, onScroll, onKeyDown, start, end, columnWidths,
    top: start * range.rowHeight, bottom: (count - end) * range.rowHeight };
}

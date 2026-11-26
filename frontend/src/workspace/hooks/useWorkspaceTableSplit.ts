import { useLayoutEffect, useRef } from "react";
import type { PointerEvent } from "react";

const tableViewport = ".file-table-wrap, .preview-table-wrap, .preview-empty";

interface TableSpace {
  total: number;
  minimum: number;
}

interface TableDrag {
  pointerId: number;
  startY: number;
  startHeight: number;
  latestY: number;
  frame?: number;
}

function clampHeight(height: number, { minimum, total }: TableSpace) {
  return Math.max(minimum, Math.min(total - minimum, height));
}

function writeFileHeight(column: HTMLDivElement, height: number) {
  column.style.setProperty("--workspace-file-table-height", `${height}px`);
}

export function useWorkspaceTableSplit(active: boolean) {
  const columnRef = useRef<HTMLDivElement>(null);
  const space = useRef<TableSpace>();
  const ratio = useRef(0.5);
  const drag = useRef<TableDrag>();

  useLayoutEffect(() => {
    if (!active || !columnRef.current) return;
    const column = columnRef.current;
    const grid = column.parentElement!;
    const page = grid.parentElement!;
    const preview = column.querySelector(":scope > .preview")!;
    let browser: Element | undefined;
    let chrome: Element[];
    let observed = new Set<Element>();
    let measureFrame: number | undefined;

    function measure() {
      const columnStyle = getComputedStyle(column);
      const minimum = parseFloat(columnStyle.getPropertyValue("--workspace-table-min-height"));
      const occupied = chrome.reduce((height, element) => {
        const style = getComputedStyle(element);
        return height + element.getBoundingClientRect().height
          + parseFloat(style.marginBlockStart) + parseFloat(style.marginBlockEnd);
      }, 0);
      // 计算列顶到视口底部的布局空间，页面滚动时保持这一预算稳定。
      const columnTop = column.getBoundingClientRect().top + window.scrollY + page.scrollTop;
      const padding = parseFloat(getComputedStyle(page).paddingBlockEnd);
      const gaps = 2 * parseFloat(columnStyle.rowGap);
      const available = document.documentElement.clientHeight - columnTop - padding - gaps - occupied;
      const total = Math.max(2 * minimum, Math.floor(available));
      const bounds = { total, minimum };
      space.current = bounds;
      const currentDrag = drag.current;
      const requested = currentDrag
        ? currentDrag.startHeight + currentDrag.latestY - currentDrag.startY
        : total * ratio.current;
      column.style.setProperty("--workspace-tables-height", `${total}px`);
      writeFileHeight(column, clampHeight(requested, bounds));
      column.toggleAttribute("data-table-split-resizable", total > 2 * minimum);
    }

    function scheduleMeasure() {
      if (measureFrame !== undefined) return;
      measureFrame = requestAnimationFrame(() => {
        measureFrame = undefined;
        measure();
      });
    }

    // 路径栏、标题和提示会影响布局预算，表格本身随拖动改变高度。
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    const mutationObserver = new MutationObserver(() => {
      updateObservedLayout();
      scheduleMeasure();
    });

    function updateObservedLayout() {
      const nextBrowser = column.querySelector(":scope > .browser")!;
      if (browser !== nextBrowser) {
        browser = nextBrowser;
        mutationObserver.disconnect();
        for (const element of [page, column, browser, preview]) {
          mutationObserver.observe(element, { childList: true });
        }
      }

      chrome = [column.firstElementChild!, ...nextBrowser.children, ...preview.children]
        .filter((element) => !element.matches(tableViewport));
      const nextObserved = new Set(chrome);
      for (const element of page.children) {
        if (element !== grid) nextObserved.add(element);
      }
      for (const element of observed) {
        if (!nextObserved.has(element)) resizeObserver.unobserve(element);
      }
      for (const element of nextObserved) {
        if (!observed.has(element)) resizeObserver.observe(element);
      }
      observed = nextObserved;
    }

    updateObservedLayout();
    measure();
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
      if (drag.current?.frame !== undefined) cancelAnimationFrame(drag.current.frame);
      drag.current = undefined;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [active]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    const bounds = space.current!;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      latestY: event.clientY,
      startHeight: clampHeight(bounds.total * ratio.current, bounds),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    current.latestY = event.clientY;
    if (current.frame !== undefined) return;
    current.frame = requestAnimationFrame(() => {
      current.frame = undefined;
      const height = clampHeight(current.startHeight + current.latestY - current.startY, space.current!);
      writeFileHeight(columnRef.current!, height);
    });
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    if (current.frame !== undefined) cancelAnimationFrame(current.frame);
    drag.current = undefined;

    const bounds = space.current!;
    const savedHeight = clampHeight(bounds.total * ratio.current, bounds);
    const height = event.type === "pointerup" && event.clientY !== current.startY
      ? clampHeight(current.startHeight + event.clientY - current.startY, bounds)
      : savedHeight;
    writeFileHeight(columnRef.current!, height);
    if (height !== savedHeight) ratio.current = height / bounds.total;
  }

  return {
    columnRef,
    handleProps: {
      onPointerDown, onPointerMove, onPointerUp: finishDrag,
      onPointerCancel: finishDrag, onLostPointerCapture: finishDrag,
    },
  };
}

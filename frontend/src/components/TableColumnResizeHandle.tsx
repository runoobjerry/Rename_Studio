import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const keyboardStep = 8;
const maximumColumnWidth = 4096;

function readColumnWidths(handle: HTMLElement) {
  const header = handle.closest("th")!;
  const row = header.parentElement as HTMLTableRowElement;
  const widths = Array.from(row.cells, (cell) => cell.getBoundingClientRect().width);
  const index = header.cellIndex;
  const isLastColumn = index === widths.length - 1;
  const minimumToFill = isLastColumn
    ? header.closest("table")!.parentElement!.clientWidth - widths.slice(0, index).reduce((total, width) => total + width, 0)
    : 0;
  return {
    index,
    widths,
    fillColumn: isLastColumn ? index - 1 : index + 1,
    minimumToFill,
  };
}

export interface ResizedTableColumns {
  widths: number[];
  fillColumn: number;
}

interface TableColumnResizeHandleProps {
  label: string;
  minimumWidth: number;
  width?: number;
  onResize: (columns: ResizedTableColumns) => void;
}

export function TableColumnResizeHandle({ label, minimumWidth, width, onResize }: TableColumnResizeHandleProps) {
  const { t } = useTranslation();
  const [measuredColumn, setMeasuredColumn] = useState<{ width: number; minimumToFill: number }>();
  const currentWidth = width ?? measuredColumn?.width ?? minimumWidth;
  const maximumWidth = Math.max(maximumColumnWidth, minimumWidth);
  const effectiveMinimumWidth = Math.max(minimumWidth, measuredColumn?.minimumToFill ?? 0);
  const drag = useRef<(ReturnType<typeof readColumnWidths> & {
    pointerId: number; startX: number; direction: number; lastWidth: number;
  }) | null>(null);

  function resizeColumn(columns: ReturnType<typeof readColumnWidths>, nextWidth: number, previousWidth: number) {
    const roundedWidth = Math.round(nextWidth);
    if (roundedWidth === Math.round(previousWidth)) return previousWidth;
    const clampedWidth = Math.max(minimumWidth, columns.minimumToFill, Math.min(maximumWidth, roundedWidth));
    if (clampedWidth !== previousWidth) {
      const widths = columns.widths.slice();
      widths[columns.index] = clampedWidth;
      onResize({ widths, fillColumn: columns.fillColumn });
    }
    return clampedWidth;
  }

  return (
    <span
      className="table-column-resize"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t("files:resizeColumn", { column: label })}
      aria-valuemin={effectiveMinimumWidth}
      aria-valuemax={Math.max(effectiveMinimumWidth, maximumWidth)}
      aria-valuenow={Math.max(effectiveMinimumWidth, Math.min(maximumWidth, currentWidth))}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      onFocus={(event) => {
        if (drag.current) return;
        const { widths, index, minimumToFill } = readColumnWidths(event.currentTarget);
        setMeasuredColumn({ width: widths[index], minimumToFill });
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const columns = readColumnWidths(event.currentTarget);
        const current = columns.widths[columns.index];
        const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
        const step = event.key === "ArrowRight" ? keyboardStep : -keyboardStep;
        const nextWidth = resizeColumn(columns, current + step * direction, current);
        setMeasuredColumn({ width: nextWidth, minimumToFill: columns.minimumToFill });
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        const columns = readColumnWidths(handle);
        const current = columns.widths[columns.index];
        setMeasuredColumn({ width: current, minimumToFill: columns.minimumToFill });
        drag.current = {
          ...columns, pointerId: event.pointerId, startX: event.clientX,
          direction: getComputedStyle(handle).direction === "rtl" ? -1 : 1,
          lastWidth: current,
        };
        handle.setPointerCapture(event.pointerId);
        handle.focus({ preventScroll: true });
      }}
      onPointerMove={(event) => {
        const activeDrag = drag.current;
        if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
        const width = activeDrag.widths[activeDrag.index] + (event.clientX - activeDrag.startX) * activeDrag.direction;
        activeDrag.lastWidth = resizeColumn(activeDrag, width, activeDrag.lastWidth);
      }}
      onLostPointerCapture={() => { drag.current = null; }}
    />
  );
}

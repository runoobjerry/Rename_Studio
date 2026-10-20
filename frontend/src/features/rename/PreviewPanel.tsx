import { useTranslation } from "react-i18next";
import { errorMessage } from "../../i18n/messages";
import type { TFunction } from "i18next";
import { memo, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import type { ExecuteResponse, PreviewResponse } from "../../types";
import { useVirtualTable } from "../../hooks/useVirtualTable";
import { VirtualTableSpacer } from "../../components/VirtualTableSpacer";
import { CheckboxFilterMenu } from "../../components/CheckboxFilterMenu";

const statusFilters = [
  { value: "error", labelKey: "files:preview.filters.error" },
  { value: "unchanged", labelKey: "files:preview.filters.unchanged" },
  { value: "pending", labelKey: "files:preview.filters.pending" },
] as const;
type StatusFilter = typeof statusFilters[number]["value"];

interface PreviewPanelProps {
  preview?: PreviewResponse;
  execution?: ExecuteResponse;
  providerName?: string;
  error?: string;
  executeError?: string;
}

export const PreviewPanel = memo(function PreviewPanel({
  preview,
  execution,
  providerName,
  error,
  executeError,
}: PreviewPanelProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<StatusFilter[]>([]);
  const filterOptions = statusFilters.map((option) => ({ ...option, label: option.value === "pending" && execution
    ? t("files:preview.filters.renamed") : t(option.labelKey) }));
  const executionById = useMemo(() => new Map(execution?.items.map((item) => [item.file_id, item])), [execution?.items]);
  const { rows, pendingCount, unchangedCount } = useMemo(() => {
    let pendingCount = 0;
    let unchangedCount = 0;
    const rows = (preview?.items ?? []).map((item) => {
      const status = statusFor(item, executionById.get(item.file_id), t);
      if (status.isPendingChange) pendingCount++;
      if (status.isUnchanged) unchangedCount++;
      return { item, status };
    });
    return { rows, pendingCount, unchangedCount };
  }, [preview?.items, executionById, t]);
  const visibleItems = useMemo(() => rows.filter(({ status }) =>
    filters.length === 0 || filters.includes(status.category)), [rows, filters]);
  const scrollKey = useMemo(() => [preview?.preview_id, filters], [preview?.preview_id, filters]);
  const columnValues = useMemo(() => [visibleItems.map(({ item }) => item.original_name), visibleItems.map(({ item }) => item.new_name),
    visibleItems.map(({ status }) => status.label)], [visibleItems]);
  const virtual = useVirtualTable(visibleItems.length, scrollKey, columnValues);

  return (
    <section className="panel preview" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="preview-title">{t("files:preview.title")}</h2>
          <p className="panel-summary">
            {t("files:preview.summary", { pending: pendingCount, unchanged: unchangedCount })}
            {preview && filters.length > 0 && t("files:showing", { count: visibleItems.length })}
          </p>
        </div>
        <CheckboxFilterMenu label={t("files:preview.filter")} options={filterOptions} selected={filters} onChange={setFilters} />
      </div>

      {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
      {!preview && !error && (
        <p className="empty-state">{t("files:preview.empty", { provider: providerName ?? t("files:preview.currentStorage") })}</p>
      )}
      {preview && (
        <TableContainer ref={virtual.containerRef} onScroll={virtual.onScroll} onKeyDown={virtual.onKeyDown} tabIndex={0} className="preview-table-wrap" sx={{ minWidth: 0, maxWidth: "100%" }}>
          <Table
            stickyHeader
            aria-rowcount={visibleItems.length + 1}
            size="small"
            aria-label={t("files:preview.title")}
            sx={{
              // 文件名列紧贴内容，状态列吸收剩余空间；长内容仍可撑开表格。
              width: "100%",
              tableLayout: "auto",
              "& th, & td": { whiteSpace: "nowrap" },
              "& th:nth-of-type(-n+2), & td:nth-of-type(-n+2)": { width: "1%" },
            }}
          >
            {virtual.columnWidths && <colgroup>{virtual.columnWidths.map((width, index) =>
              <col key={index} style={index < 2 ? { width } : undefined} />)}</colgroup>}
            <TableHead>
              <TableRow>
                <TableCell>{t("files:preview.original")}</TableCell>
                <TableCell>{t("files:preview.new")}</TableCell>
                <TableCell sx={{ minWidth: virtual.columnWidths?.[2] }}>{t("common:status")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <VirtualTableSpacer height={virtual.top} columns={3} />
              {visibleItems.slice(virtual.start, virtual.end).map(({ item, status }, offset) => (
                <PreviewRow key={item.file_id} item={item} label={status.label} statusClassName={status.className}
                  renamed={status.renamed} rowIndex={virtual.start + offset} />
              ))}
              <VirtualTableSpacer height={virtual.bottom} columns={3} />
              {visibleItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} align="center">{t("common:noMatches")}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {executeError && (
        <Alert severity="error" sx={{ m: 2 }}>{t("files:preview.executeFailed", { message: executeError })}</Alert>
      )}
    </section>
  );
});

const PreviewRow = memo(function PreviewRow({ item, label, statusClassName, renamed, rowIndex }: {
  item: PreviewResponse["items"][number]; label: string; statusClassName: string; renamed: boolean; rowIndex: number;
}) {
  return <TableRow data-row-index={rowIndex} aria-rowindex={rowIndex + 2} tabIndex={0}>
    <TableCell>{item.original_name}</TableCell>
    <TableCell className={renamed ? "renamed-name" : undefined}>{item.new_name}</TableCell>
    <TableCell><span className={`status ${statusClassName}`}>{label}</span></TableCell>
  </TableRow>;
});

function statusFor(item: PreviewResponse["items"][number], result: ExecuteResponse["items"][number] | undefined, t: TFunction) {
  // 已修改项保留原预览分类；失败和跳过的执行结果覆盖分类。
  let category: StatusFilter = item.error || !item.valid || item.conflict ? "error"
    : item.changed ? "pending" : "unchanged";
  let label: string;
  let className: string;
  if (result?.status === "renamed") {
    label = t("files:preview.filters.renamed");
    className = "valid";
  } else if (result?.status === "failed") {
    category = "error";
    label = result.error === null ? t("files:preview.failed") : errorMessage({ code: result.error_code, message: result.error }, t);
    className = "invalid";
  } else if (result?.status === "skipped") {
    category = "unchanged";
    label = t("files:preview.filters.unchanged");
    className = "neutral";
  } else if (item.error) {
    label = item.error;
    className = "invalid";
  } else if (!item.valid) {
    label = item.conflict ? t("files:preview.conflict") : t("files:preview.invalid");
    className = "invalid";
  } else {
    label = item.changed ? t("files:preview.filters.pending") : t("files:preview.filters.unchanged");
    className = item.changed ? "pending" : "neutral";
  }
  return {
    category, label, className, renamed: result?.status === "renamed",
    // 副标题统计独立于筛选分类：有效变更且尚无执行结果才计为待修改。
    isPendingChange: item.changed && item.valid && !result,
    isUnchanged: !item.changed || result?.status === "skipped",
  };
}


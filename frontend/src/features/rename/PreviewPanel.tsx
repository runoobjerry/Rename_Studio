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
  { value: "error", label: "错误" },
  { value: "unchanged", label: "无变化" },
  { value: "pending", label: "待修改" },
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
  providerName = "当前存储",
  error,
  executeError,
}: PreviewPanelProps) {
  const [filters, setFilters] = useState<StatusFilter[]>([]);
  const executionById = useMemo(() => new Map(execution?.items.map((item) => [item.file_id, item])), [execution?.items]);
  const pendingCount = useMemo(() => preview?.items.filter(
    (item) => item.changed && item.valid && !executionById.has(item.file_id),
  ).length ?? 0, [preview?.items, executionById]);
  const unchangedCount = useMemo(() => preview?.items.filter(
    (item) => !item.changed || executionById.get(item.file_id)?.status === "skipped",
  ).length ?? 0, [preview?.items, executionById]);

  const visibleItems = useMemo(() => preview?.items.filter((item) => {
    if (filters.length === 0) return true;
    const result = executionById.get(item.file_id);
    // 已执行项目仍按原预览分类，执行失败覆盖原分类，避免隐藏失败信息。
    const category: StatusFilter = result?.status === "failed" ? "error"
      : result?.status === "skipped" ? "unchanged"
      : item.error || !item.valid || item.conflict ? "error"
      : item.changed ? "pending" : "unchanged";
    return filters.includes(category);
  }) ?? [], [preview?.items, executionById, filters]);
  const scrollKey = useMemo(() => [preview?.preview_id, filters], [preview?.preview_id, filters]);
  const columnValues = useMemo(() => [visibleItems.map((item) => item.original_name), visibleItems.map((item) => item.new_name),
    visibleItems.map((item) => statusFor(item, executionById.get(item.file_id)).label)], [visibleItems, executionById]);
  const virtual = useVirtualTable(visibleItems.length, scrollKey, columnValues);

  return (
    <section className="panel preview" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="preview-title">修改预览</h2>
          <p className="panel-summary">
            {preview
              ? `${pendingCount} 项待修改 · ${unchangedCount} 项无需修改`
              : "0 项待修改 · 0 项无需修改"}
            {preview && filters.length > 0 && ` · 显示 ${visibleItems.length} 项`}
          </p>
        </div>
        <CheckboxFilterMenu label="筛选状态" options={statusFilters} selected={filters} onChange={setFilters} />
      </div>

      {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
      {!preview && !error && (
        <p className="empty-state">点击预览按钮以查看修改名称；预览不会修改 {providerName} 中的内容。</p>
      )}
      {preview && (
        <TableContainer ref={virtual.containerRef} onScroll={virtual.onScroll} onKeyDown={virtual.onKeyDown} tabIndex={0} className="preview-table-wrap" sx={{ minWidth: 0, maxWidth: "100%" }}>
          <Table
            stickyHeader
            aria-rowcount={visibleItems.length + 1}
            size="small"
            aria-label="修改预览"
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
                <TableCell>原文件名</TableCell>
                <TableCell>新文件名</TableCell>
                <TableCell sx={{ minWidth: virtual.columnWidths?.[2] }}>状态</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <VirtualTableSpacer height={virtual.top} columns={3} />
              {visibleItems.slice(virtual.start, virtual.end).map((item, offset) => (
                <PreviewRow key={item.file_id} item={item} result={executionById.get(item.file_id)} rowIndex={virtual.start + offset} />
              ))}
              <VirtualTableSpacer height={virtual.bottom} columns={3} />
              {visibleItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} align="center">没有符合筛选条件的项目。</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {executeError && (
        <Alert severity="error" sx={{ m: 2 }}>执行失败：{executeError}</Alert>
      )}
    </section>
  );
});

const PreviewRow = memo(function PreviewRow({ item, result, rowIndex }: {
  item: PreviewResponse["items"][number]; result?: ExecuteResponse["items"][number]; rowIndex: number;
}) {
  const status = statusFor(item, result);
  return <TableRow data-row-index={rowIndex} aria-rowindex={rowIndex + 2} tabIndex={0}>
    <TableCell>{item.original_name}</TableCell>
    <TableCell className={result?.status === "renamed" ? "renamed-name" : undefined}>{item.new_name}</TableCell>
    <TableCell><span className={`status ${status.className}`}>{status.label}</span></TableCell>
  </TableRow>;
});

function statusFor(item: PreviewResponse["items"][number], result?: ExecuteResponse["items"][number]) {
  if (result?.status === "renamed") return { label: "已修改", className: "valid" };
  if (result?.status === "failed") {
    return { label: result.error ?? "修改失败", className: "invalid" };
  }
  if (result?.status === "skipped") return { label: "无变化", className: "neutral" };
  if (item.error) return { label: item.error, className: "invalid" };
  if (!item.valid) return { label: item.conflict ? "名称冲突" : "不可修改", className: "invalid" };
  return { label: item.changed ? "待修改" : "无变化", className: item.changed ? "pending" : "neutral" };
}


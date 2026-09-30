import { useState } from "react";
import Alert from "@mui/material/Alert";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import type { ExecuteResponse, PreviewResponse } from "../../types";
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
  selectedCount?: number;
  isPending?: boolean;
  isExecuting?: boolean;
  onPreview?: () => void;
  onExecute?: (previewId: string) => void;
}

export function PreviewPanel({
  preview,
  execution,
  providerName = "当前存储",
  error,
  executeError,
}: PreviewPanelProps) {
  const [filters, setFilters] = useState<StatusFilter[]>(["error", "unchanged", "pending"]);
  const executionById = new Map(execution?.items.map((item) => [item.file_id, item]));
  const pendingCount = preview?.items.filter(
    (item) => item.changed && item.valid && !executionById.has(item.file_id),
  ).length ?? 0;
  const unchangedCount = preview?.items.filter(
    (item) => !item.changed || executionById.get(item.file_id)?.status === "skipped",
  ).length ?? 0;

  function statusFor(item: PreviewResponse["items"][number]) {
    const result = executionById.get(item.file_id);
    if (result?.status === "renamed") return { label: "已修改", className: "valid" };
    if (result?.status === "failed") {
      return { label: result.error ?? "修改失败", className: "invalid" };
    }
    if (result?.status === "skipped") return { label: "无变化", className: "neutral" };
    if (item.error) return { label: item.error, className: "invalid" };
    if (!item.valid) return { label: item.conflict ? "名称冲突" : "不可修改", className: "invalid" };
    return { label: item.changed ? "待修改" : "无变化", className: item.changed ? "pending" : "neutral" };
  }

  const visibleItems = preview?.items.filter((item) => {
    const result = executionById.get(item.file_id);
    // 已执行项目仍按原预览分类，执行失败覆盖原分类，避免隐藏失败信息。
    const category: StatusFilter = result?.status === "failed" ? "error"
      : result?.status === "skipped" ? "unchanged"
      : item.error || !item.valid || item.conflict ? "error"
      : item.changed ? "pending" : "unchanged";
    return filters.includes(category);
  }) ?? [];

  return (
    <section className="panel preview" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="preview-title">修改预览</h2>
          <p className="panel-summary">
            {preview
              ? `${pendingCount} 项待修改 · ${unchangedCount} 项无需修改`
              : "0 项待修改 · 0 项无需修改"}
            {preview && filters.length !== statusFilters.length && ` · 显示 ${visibleItems.length} 项`}
          </p>
        </div>
        <CheckboxFilterMenu label="筛选重命名状态" options={statusFilters} selected={filters} onChange={setFilters} />
      </div>

      {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
      {!preview && !error && (
        <p className="empty-state">点击预览按钮以查看修改名称；预览不会修改 {providerName} 中的内容。</p>
      )}
      {preview && (
        <TableContainer className="preview-table-wrap" sx={{ minWidth: 0, maxWidth: "100%" }}>
          <Table
            stickyHeader
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
            <TableHead>
              <TableRow>
                <TableCell>原文件名</TableCell>
                <TableCell>新文件名</TableCell>
                <TableCell>状态</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleItems.map((item) => {
                const status = statusFor(item);
                const renamed = executionById.get(item.file_id)?.status === "renamed";
                return (
                  <TableRow key={item.file_id}>
                    <TableCell>{item.original_name}</TableCell>
                    <TableCell className={renamed ? "renamed-name" : undefined}>
                      {item.new_name}
                    </TableCell>
                    <TableCell>
                      <span className={`status ${status.className}`}>{status.label}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
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
}

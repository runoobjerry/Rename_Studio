import { useTranslation } from "react-i18next";
import { executionItemMessage } from "./resultMessages";
import { isRenameNotAttempted } from "./renameRecord";
import { errorMessage } from "../../i18n/messages";
import type { TFunction } from "i18next";
import { memo, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Chip, { type ChipProps } from "@mui/material/Chip";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InfoIcon from "@mui/icons-material/Info";
import ErrorIcon from "@mui/icons-material/Error";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { UnknownExecution } from "../../stores/useRenameStore";
import type { ExecuteResponse, PreviewResponse } from "../../types";
import { useVirtualTable } from "../../hooks/useVirtualTable";
import { FileNameTooltip, isFileNameTruncated } from "../../components/FileNameTooltip";
import { VirtualTableSpacer } from "../../components/VirtualTableSpacer";
import { PanelActionGroup, PanelSummary } from "../../components/PanelHeadingControls";
import { RadioFilterMenu } from "../../components/RadioFilterMenu";
import { TableColumnResizeHandle, type ResizedTableColumns } from "../../components/TableColumnResizeHandle";

const statusFilters = [
  { value: "all", labelKey: "files:filters.all" },
  { value: "error", labelKey: "files:preview.filters.error" },
  { value: "unchanged", labelKey: "files:preview.filters.unchanged" },
  { value: "pending", labelKey: "files:preview.filters.pending" },
] as const;
type StatusFilter = typeof statusFilters[number]["value"];
const minNameColumnWidth = 160;
const minStatusColumnWidth = 256;

interface PreviewPanelProps {
  preview?: PreviewResponse;
  execution?: ExecuteResponse;
  unknownExecution?: UnknownExecution | null;
  verificationPending?: boolean;
  storageName?: string;
  error?: string;
  executeError?: string;
}

export const PreviewPanel = memo(function PreviewPanel({
  preview,
  execution,
  unknownExecution,
  verificationPending = Boolean(unknownExecution),
  storageName,
  error,
  executeError,
}: PreviewPanelProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [dismissedVerification, setDismissedVerification] = useState<string | null>(null);
  const verificationKey = unknownExecution
    ? JSON.stringify([unknownExecution.storageId, unknownExecution.previewId]) : null;
  const filterOptions = statusFilters.map((option) => ({ ...option, label: option.value === "pending" && execution
    ? t("files:preview.filters.renamed") : t(option.labelKey) }));
  const executionById = useMemo(() => new Map(execution?.items.map((item) => [item.file_id, item])), [execution?.items]);
  const unknownIds = useMemo(() => new Set(
    !preview || preview.preview_id === unknownExecution?.previewId
      ? unknownExecution?.items.map((item) => item.file_id) : [],
  ), [preview?.preview_id, unknownExecution]);
  const { rows, pendingCount, unchangedCount, columnValues } = useMemo(() => {
    let pendingCount = 0;
    let unchangedCount = 0;
    const statusLabels = new Set<string>();
    // 预览展示被清理后，待核对记录仍保留原始项目供检查。
    const rows = (preview?.items ?? unknownExecution?.items ?? []).map((item) => {
      const result = executionById.get(item.file_id);
      const needsVerification = unknownIds.has(item.file_id) || result?.status === "unknown";
      const status = statusFor(item, result, needsVerification, t);
      statusLabels.add(status.label);
      if (status.isPendingChange) pendingCount++;
      if (status.isUnchanged) unchangedCount++;
      const currentName = result?.actual_name ?? result?.current_file?.name;
      const newName = needsVerification ? t("files:preview.needsVerification")
        : !result ? item.new_name
        : currentName ?? (result.status === "renamed" ? result.new_name
          : result.status === "skipped" && status.isUnchanged
            ? result.original_name : t("files:preview.currentNameUnavailable"));
      return { item, status, newName };
    });
    return { rows, pendingCount, unchangedCount, columnValues: [null, null, [...statusLabels]] };
  }, [preview?.items, unknownExecution?.items, unknownIds, executionById, t]);
  const visibleItems = useMemo(() => rows.filter(({ status }) =>
    filter === "all" || filter === status.category), [rows, filter]);
  const scrollKey = useMemo(() => [preview?.preview_id, filter], [preview?.preview_id, filter]);
  const virtual = useVirtualTable(visibleItems.length, scrollKey, columnValues);
  const statusColumnWidth = Math.max(minStatusColumnWidth, virtual.columnWidths?.[2] ?? 0);
  const [resizedColumns, setResizedColumns] = useState<ResizedTableColumns>();
  const columnWidths = [
    resizedColumns?.widths[0] ?? minNameColumnWidth,
    resizedColumns?.widths[1] ?? minNameColumnWidth,
    Math.max(statusColumnWidth, resizedColumns?.widths[2] ?? 0),
  ];
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
  const fillColumn = resizedColumns?.fillColumn;
  const explicitWidths = columnWidths.map((width, index) =>
    index === fillColumn || (!resizedColumns && index < 2) ? undefined : width);
  const originalColumnLabel = t("files:preview.original");
  const newColumnLabel = t("files:preview.new");
  const statusColumnLabel = t("common:status");

  return (
    <section className="preview" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="preview-title">{t("files:preview.title")}</h2>
          {(preview || unknownExecution) && <PanelSummary>
            {t("files:preview.summary", { pending: pendingCount, unchanged: unchangedCount })}
            {filter !== "all" && t("files:showing", { count: visibleItems.length })}
          </PanelSummary>}
        </div>
        <PanelActionGroup labelledBy="preview-title">
          <RadioFilterMenu label={t("files:preview.filter")} options={filterOptions} selected={filter} onChange={setFilter} />
        </PanelActionGroup>
      </div>

      {error && <Alert severity="error" sx={{ m: 2, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error}</Alert>}
      {!preview && !unknownExecution && !error && (
        <div className="panel preview-empty">
          <p className="empty-state">{t("files:preview.empty", { storageName: storageName ?? t("files:preview.currentStorage") })}</p>
        </div>
      )}
      {(preview || unknownExecution) && (
        <TableContainer ref={virtual.containerRef} onScroll={virtual.onScroll} onKeyDown={virtual.onKeyDown} tabIndex={0} className="panel preview-table-wrap" sx={{ minWidth: 0, maxWidth: "100%" }}>
          <Table
            stickyHeader
            aria-rowcount={visibleItems.length + 1}
            size="small"
            aria-label={t("files:preview.title")}
            style={{ width: `max(100%, ${tableWidth}px)` }}
            sx={{ tableLayout: "fixed" }}
          >
            <colgroup>{explicitWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
            <TableHead>
              <TableRow>
                <TableCell aria-label={originalColumnLabel}>
                  {originalColumnLabel}
                  <TableColumnResizeHandle label={originalColumnLabel} minimumWidth={minNameColumnWidth}
                    width={explicitWidths[0]} onResize={setResizedColumns} />
                </TableCell>
                <TableCell aria-label={newColumnLabel}>
                  {newColumnLabel}
                  <TableColumnResizeHandle label={newColumnLabel} minimumWidth={minNameColumnWidth}
                    width={explicitWidths[1]} onResize={setResizedColumns} />
                </TableCell>
                <TableCell aria-label={statusColumnLabel}>
                  {statusColumnLabel}
                  <TableColumnResizeHandle label={statusColumnLabel} minimumWidth={statusColumnWidth}
                    width={explicitWidths[2]} onResize={setResizedColumns} />
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <VirtualTableSpacer height={virtual.top} columns={3} />
              {visibleItems.slice(virtual.start, virtual.end).map(({ item, status, newName }, offset) => (
                <PreviewRow key={item.file_id} item={item} newName={newName} label={status.label} statusColor={status.color}
                  pending={status.isPendingChange} renamed={status.renamed} rowIndex={virtual.start + offset} />
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

      {executeError && !unknownExecution && (
        <Alert severity="error" sx={{ m: 2 }}>{t("files:preview.executeFailed", { message: executeError })}</Alert>
      )}
      {verificationPending && dismissedVerification !== verificationKey && (
        <Alert severity="warning" sx={{ m: 2 }} closeText={t("common:close")}
          onClose={() => setDismissedVerification(verificationKey)}>
          {t("files:preview.unknownOutcome")}
        </Alert>
      )}
    </section>
  );
});

const PreviewRow = memo(function PreviewRow({ item, newName, label, statusColor, pending, renamed, rowIndex }: {
  item: PreviewResponse["items"][number]; newName: string; label: string; statusColor: ChipProps["color"]; pending: boolean; renamed: boolean; rowIndex: number;
}) {
  const originalNameRef = useRef<HTMLSpanElement>(null);
  const newNameRef = useRef<HTMLSpanElement>(null);
  const [truncatedNames, setTruncatedNames] = useState<string[]>([]);
  const icon = statusColor === "success" ? <CheckCircleIcon />
    : statusColor === "default" ? (pending ? <CheckCircleIcon /> : <InfoIcon />) : <ErrorIcon />;
  return <Tooltip describeChild disableHoverListener disableTouchListener open={truncatedNames.length > 0}
    onOpen={() => setTruncatedNames([
      ...(isFileNameTruncated(originalNameRef.current) ? [item.original_name] : []),
      ...(isFileNameTruncated(newNameRef.current) ? [newName] : []),
    ])}
    onClose={() => setTruncatedNames([])}
    slotProps={{ tooltip: { sx: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" } } }}
    title={truncatedNames.map((name, index) => <div key={index}>{name}</div>)}>
    <TableRow data-row-index={rowIndex} aria-rowindex={rowIndex + 2} tabIndex={0}>
      <TableCell>
        <FileNameTooltip name={item.original_name} nameRef={originalNameRef}>
          <Typography ref={originalNameRef} component="span" variant="inherit" noWrap sx={{ display: "block" }}>
            {item.original_name}
          </Typography>
        </FileNameTooltip>
      </TableCell>
      <TableCell className={renamed ? "renamed-name" : undefined}>
        <FileNameTooltip name={newName} nameRef={newNameRef}>
          <Typography ref={newNameRef} component="span" variant="inherit" noWrap sx={{ display: "block" }}>
            {newName}
          </Typography>
        </FileNameTooltip>
      </TableCell>
      <TableCell>
        <Chip size="small" variant="outlined" label={label} color={statusColor} icon={icon}
          sx={{
            fontSize: "12px",
            maxWidth: "none",
            "& .MuiChip-label": { overflow: "visible" },
            ...(statusColor === "default" && { color: "text.secondary", "& .MuiChip-icon": { color: "inherit" } }),
          }} />
      </TableCell>
    </TableRow>
  </Tooltip>;
});

function statusFor(item: PreviewResponse["items"][number], result: ExecuteResponse["items"][number] | undefined, needsVerification: boolean, t: TFunction) {
  // 待核对状态仅消费执行流程已有的判断，不在展示层重新推断结果。
  if (needsVerification) return {
    category: "error" as const,
    label: t("files:preview.unknown"), color: "warning" as const, renamed: false,
    isPendingChange: false, isUnchanged: false,
  };
  // 已修改项保留原预览分类；失败和跳过的执行结果覆盖分类。
  let category: Exclude<StatusFilter, "all"> = item.error || !item.valid || item.conflict ? "error"
    : item.changed ? "pending" : "unchanged";
  const unchangedSkip = result?.status === "skipped" && !isRenameNotAttempted(result);
  let label: string;
  let color: "success" | "warning" | "error" | "default";
  if (result?.status === "renamed") {
    label = t("files:preview.filters.renamed");
    color = "success";
  } else if (result?.status === "failed") {
    category = "error";
    label = executionItemMessage(result, t);
    color = "error";
  } else if (result?.status === "skipped") {
    category = unchangedSkip ? "unchanged" : "error";
    label = t(unchangedSkip ? "files:preview.filters.unchanged" : "files:preview.notModified");
    color = unchangedSkip ? "default" : "warning";
  } else if (item.error || !item.valid || item.conflict) {
    label = !item.error && !item.details?.reason ? t(item.conflict ? "files:preview.conflict" : "files:preview.invalid")
      : item.conflict && !item.details?.reason ? t("errors:renameStatus.duplicateNames")
      : errorMessage({ code: "VALIDATION_ERROR", message: item.error ?? "", details: item.details ?? undefined }, t, "renameStatus");
    color = "warning";
  } else {
    label = item.changed ? t("files:preview.filters.pending") : t("files:preview.filters.unchanged");
    color = "default";
  }
  return {
    category, label, color, renamed: result?.status === "renamed",
    // 副标题统计独立于筛选分类：有效变更且尚无执行结果才计为待修改。
    isPendingChange: item.changed && item.valid && !result,
    isUnchanged: !item.changed || unchangedSkip,
  };
}


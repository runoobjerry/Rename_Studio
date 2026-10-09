import { memo, useCallback, useEffect, useMemo, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Alert,
  Box,
  ButtonBase,
  Checkbox,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";

import type { DirectoryListing, FileItem, RenameTask, StorageLocation } from "../../types";
import { CheckboxFilterMenu } from "../../components/CheckboxFilterMenu";
import { PanelIconButton } from "../../components/PanelIconButton";
import { useVirtualTable } from "../../hooks/useVirtualTable";
import { VirtualTableSpacer } from "../../components/VirtualTableSpacer";
import selectInverseIcon from "../../assets/icon/select-inverse.svg";

const fileFilters = [
  { value: "file", label: "文件" },
  { value: "folder", label: "文件夹" },
] as const;
const taskFilters = [
  { value: "pending", label: "待处理", dividerBefore: true },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败/待核对" },
] as const;
const fixedColumnWidths = [44] as const;
// 直接约束控件，避免 MUI 自身内边距或表格列宽改变其 20px 几何。
const fileCheckboxSx = {
  width: 20, minWidth: 20, maxWidth: 20, height: 20, p: 0,
  "& .MuiSvgIcon-root": { width: 20, height: 20, fontSize: 20 },
};
type FileFilter = typeof fileFilters[number]["value"] | typeof taskFilters[number]["value"];
interface FileBrowserProps {
  listing: DirectoryListing;
  task?: Pick<RenameTask, "taskId" | "items"> | null;
  taskCurrent?: boolean;
  disabled?: boolean;
  onEndTask?: () => void;
  onReconcileSelection?: (fileIds: string[]) => void;
  providerName: string;
  selectedIds: string[];
  isRefreshing?: boolean;
  refreshError?: string;
  onNavigate: (path: string) => void;
  onNavigateLocation?: (location: StorageLocation) => void;
  onRefresh?: () => void;
  onToggle: (fileId: string) => void;
  onSelectAll: (visibleIds: string[]) => void;
  onClearSelection?: () => void;
  onInvertSelection: (visibleIds: string[]) => void;
}

function getExtension(name: string, isDirectory: boolean): string {
  if (isDirectory) return "文件夹";
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < name.length - 1 ? name.slice(dotIndex + 1) : "—";
}

const modifiedAtFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

function formatModifiedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return modifiedAtFormatter.format(date);
}

export const FileBrowser = memo(function FileBrowser({
  listing,
  task, taskCurrent = false, disabled = false, onEndTask, onReconcileSelection,
  providerName,
  selectedIds,
  isRefreshing = false,
  refreshError,
  onNavigate,
  onNavigateLocation,
  onRefresh,
  onToggle,
  onSelectAll,
  onClearSelection,
  onInvertSelection,
}: FileBrowserProps) {
  const [filters, setFilters] = useState<FileFilter[]>([]);
  useEffect(() => {
    setFilters((current) => [...current.filter((filter) => filter === "file" || filter === "folder"), ...(task ? ["pending" as const] : [])]);
  }, [task?.taskId]); // eslint-disable-line react-hooks/exhaustive-deps -- 新任务才应用默认筛选。
  const taskItems = useMemo(() => new Map(task?.items.map((item) => [item.currentFileId, item])), [task?.items]);
  const listedItems = useMemo(() => new Map(listing.items.map((item) => [item.id, item])), [listing.items]);
  // 当前任务展示固定成员；刷新缺项时保留快照，不让非任务文件混入。
  const panelItems = useMemo(() => task ? task.items.map((item) => listedItems.get(item.currentFileId)
    ?? item.after?.current_file ?? item.reconciliation?.file ?? { ...item.before, id: item.currentFileId }) : listing.items,
  [task?.items, listedItems, listing.items]);
  const hasTask = Boolean(task);
  const filteredItems = useCallback((nextFilters: FileFilter[]) => {
    const types = nextFilters.filter((filter) => filter === "file" || filter === "folder");
    const statuses = nextFilters.filter((filter) => filter !== "file" && filter !== "folder");
    return panelItems.filter((item) => {
      const status = taskItems.get(item.id)?.status;
      return (types.length === 0 || types.includes(item.is_directory ? "folder" : "file")) &&
        (!hasTask || statuses.length === 0 || statuses.some((filter) => filter === "failed"
          ? status === "failed" || status === "unknown" : status === filter));
    });
  }, [panelItems, taskItems, hasTask]);
  const visibleItems = useMemo(() => filteredItems(filters), [filteredItems, filters]);
  const filterOptions = useMemo(() => [...fileFilters, ...taskFilters.map((option) => ({ ...option, disabled: !hasTask }))], [hasTask]);
  const totalCount = panelItems.length;
  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCount = useMemo(() => panelItems.filter((item) => selectedSet.has(item.id)).length, [panelItems, selectedSet]);
  const visibleSelectedCount = useMemo(() => visibleItems.filter((item) => selectedSet.has(item.id)).length, [visibleItems, selectedSet]);
  const selectableIds = useMemo(() => visibleIds.filter((id) => listedItems.has(id) &&
    taskItems.get(id)?.status !== "completed" && taskItems.get(id)?.status !== "unknown"), [visibleIds, listedItems, taskItems]);
  const scrollKey = useMemo(() => [listing.items, task?.taskId, filters], [listing.items, task?.taskId, filters]);
  const columnValues = useMemo(() => [visibleItems.map(() => ""), visibleItems.map((item) => item.name),
    visibleItems.map((item) => getExtension(item.name, item.is_directory)),
    visibleItems.map((item) => formatModifiedAt(item.modified_at))], [visibleItems]);
  const virtual = useVirtualTable(visibleItems.length, scrollKey, columnValues, fixedColumnWidths);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedSet.has(id));
  // 任务结果改变状态后，隐藏的失败/完成项退出选择，记录仍留在任务中。
  useEffect(() => {
    if (!task || !taskCurrent || disabled) return;
    const visible = new Set(selectableIds);
    const next = selectedIds.filter((id) => visible.has(id));
    if (next.length !== selectedIds.length) (onReconcileSelection ?? onSelectAll)(next);
  }, [hasTask, taskCurrent, selectableIds, selectedIds, disabled, onReconcileSelection, onSelectAll]);

  return (
    <section className="panel browser" aria-labelledby="files-title" aria-busy={isRefreshing}>
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="files-title">{task ? "当前任务" : "文件选择"}</h2>
          <p className="panel-summary">
            共 {totalCount} 项 · 已选择 {selectedCount} 项
            {filters.length > 0 && ` · 显示 ${visibleItems.length} 项`}
          </p>
        </div>
        <div className="browser-heading-actions">
          {task ? (
            <Tooltip title="结束当前任务" arrow>
              <span><PanelIconButton size="small" aria-label="结束当前任务" disabled={disabled} onClick={onEndTask}>
                <LogoutRoundedIcon fontSize="small" />
              </PanelIconButton></span>
            </Tooltip>
          ) : (listing.parent_location !== undefined ? listing.parent_location !== null : listing.parent_path !== null) && (
            <Tooltip title="返回上级" arrow>
              <PanelIconButton size="small" aria-label="返回上级"
                onClick={() => listing.parent_location && onNavigateLocation ? onNavigateLocation(listing.parent_location) : onNavigate(listing.parent_path ?? "")}>
                <ArrowBackRoundedIcon fontSize="small" />
              </PanelIconButton>
            </Tooltip>
          )}
          <Tooltip title={isRefreshing ? "刷新中" : "刷新"} arrow>
            <span>
              <PanelIconButton
                size="small"
                aria-label={isRefreshing ? "刷新中" : "刷新"}
                onClick={onRefresh}
                disabled={disabled || !onRefresh || isRefreshing}
              >
                <RefreshRoundedIcon fontSize="small" />
              </PanelIconButton>
            </span>
          </Tooltip>
          <Tooltip title="反选" arrow>
            <span>
              <PanelIconButton
                size="small"
                aria-label="反选"
                onClick={() => onInvertSelection(selectableIds)}
                disabled={disabled || (Boolean(task) && !taskCurrent) || selectableIds.length === 0}
              >
                <Box
                  component="span"
                  aria-hidden="true"
                  sx={{
                    width: 20,
                    height: 20,
                    bgcolor: "currentColor",
                    mask: `url("${selectInverseIcon}") center / contain no-repeat`,
                    WebkitMask: `url("${selectInverseIcon}") center / contain no-repeat`,
                  }}
                />
              </PanelIconButton>
            </span>
          </Tooltip>
          <CheckboxFilterMenu label="筛选项目" options={filterOptions} disabled={disabled} selected={filters} onChange={(nextFilters) => {
            setFilters(nextFilters);
            // 被筛选隐藏的项目退出选择，取消筛选也不恢复旧选择。
            const nextVisibleIds = new Set(filteredItems(nextFilters).map((item) => item.id));
            const nextSelectedIds = selectedIds.filter((id) => nextVisibleIds.has(id));
            if (nextSelectedIds.length !== selectedIds.length) onSelectAll(nextSelectedIds);
          }} />
        </div>
      </div>
      {isRefreshing && <LinearProgress aria-label="正在刷新目录" sx={{ flexShrink: 0 }} />}
      {refreshError && (
        <Alert severity="error">目录刷新失败，当前显示上次读取的内容：{refreshError}</Alert>
      )}

      <TableContainer className="file-table-wrap" ref={virtual.containerRef} onScroll={virtual.onScroll}
        onKeyDown={virtual.onKeyDown} tabIndex={0}>
        <Table
          stickyHeader
          aria-rowcount={visibleItems.length + 1}
          size="small"
          aria-label={`${providerName} 文件列表`}
          sx={{
            "& .MuiTableCell-paddingCheckbox": { width: fixedColumnWidths[0], px: 1 },
          }}
        >
          {virtual.columnWidths && <colgroup>{virtual.columnWidths.map((width, index) =>
            <col key={index} style={index === 1 ? undefined : { width }} />)}</colgroup>}
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  sx={fileCheckboxSx}
                  checked={allSelected}
                  indeterminate={visibleSelectedCount > 0 && !allSelected}
                  disabled={disabled || (Boolean(task) && !taskCurrent) || selectableIds.length === 0}
                  onChange={() => (allSelected ? onClearSelection?.() : onSelectAll(selectableIds))}
                  slotProps={{ input: { "aria-label": "选择当前显示的全部项目" } }}
                />
              </TableCell>
              <TableCell>文件名</TableCell>
              <TableCell className="file-extension-column">扩展名</TableCell>
              <TableCell className="file-modified-column">修改时间</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <VirtualTableSpacer height={virtual.top} columns={4} />
            {visibleItems.slice(virtual.start, virtual.end).map((item, offset) => (
              <FileBrowserRow key={taskItems.get(item.id)?.taskItemId ?? item.id}
                item={item} rowIndex={virtual.start + offset} selected={selectedSet.has(item.id)}
                disabled={disabled || (hasTask && (!taskCurrent || !listedItems.has(item.id))) || taskItems.get(item.id)?.status === "completed" || taskItems.get(item.id)?.status === "unknown"}
                navigationDisabled={hasTask || disabled} onToggle={onToggle}
                onNavigate={onNavigate} onNavigateLocation={onNavigateLocation} />
            ))}
            <VirtualTableSpacer height={virtual.bottom} columns={4} />
            {visibleItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  {totalCount === 0 ? (task ? "当前任务为空。" : "此目录为空。") : "没有符合筛选条件的项目。"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
});

interface FileBrowserRowProps {
  item: FileItem;
  rowIndex: number;
  selected: boolean;
  disabled: boolean;
  navigationDisabled: boolean;
  onToggle: FileBrowserProps["onToggle"];
  onNavigate: FileBrowserProps["onNavigate"];
  onNavigateLocation: FileBrowserProps["onNavigateLocation"];
}

const FileBrowserRow = memo(function FileBrowserRow({ item, rowIndex, selected, disabled, navigationDisabled,
  onToggle, onNavigate, onNavigateLocation }: FileBrowserRowProps) {
  const modifiedAt = useMemo(() => formatModifiedAt(item.modified_at), [item.modified_at]);
  return <TableRow hover selected={selected} data-row-index={rowIndex} aria-rowindex={rowIndex + 2} tabIndex={-1}>
    <TableCell padding="checkbox">
      <Checkbox size="small" sx={fileCheckboxSx} checked={selected} disabled={disabled} onChange={() => onToggle(item.id)}
        slotProps={{ input: { "aria-label": `选择${item.is_directory ? "文件夹" : "文件"} ${item.name}` } }} />
    </TableCell>
    <TableCell>
      <Tooltip title={item.name} placement="top-start">
        {item.is_directory ? <ButtonBase className="directory-name" disabled={navigationDisabled}
          onClick={() => item.location && onNavigateLocation ? onNavigateLocation(item.location) : onNavigate(item.path)}>
          <FolderRoundedIcon className="file-icon" fontSize="small" />
          <span className="file-name">{item.name}</span>
        </ButtonBase> : <span className="file-name-cell">
          <InsertDriveFileOutlinedIcon className="file-icon" fontSize="small" />
          <span className="file-name">{item.name}</span>
        </span>}
      </Tooltip>
    </TableCell>
    <TableCell>{getExtension(item.name, item.is_directory)}</TableCell>
    <TableCell>{modifiedAt}</TableCell>
  </TableRow>;
});

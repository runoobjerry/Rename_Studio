import { useEffect, useState } from "react";
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

import type { DirectoryListing, RenameTask, StorageLocation } from "../../types";
import { CheckboxFilterMenu } from "../../components/CheckboxFilterMenu";
import { PanelIconButton } from "../../components/PanelIconButton";
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
type FileFilter = typeof fileFilters[number]["value"] | typeof taskFilters[number]["value"];
interface FileBrowserProps {
  listing: DirectoryListing;
  task?: RenameTask | null;
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

function formatModifiedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function FileBrowser({
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
  const taskItems = new Map(task?.items.map((item) => [item.currentFileId, item]));
  const listedItems = new Map(listing.items.map((item) => [item.id, item]));
  // 当前任务展示固定成员；刷新缺项时保留快照，不让非任务文件混入。
  const panelItems = task ? task.items.map((item) => listedItems.get(item.currentFileId)
    ?? item.after?.current_file ?? item.reconciliation?.file ?? { ...item.before, id: item.currentFileId }) : listing.items;
  const filteredItems = (nextFilters: FileFilter[]) => {
    const types = nextFilters.filter((filter) => filter === "file" || filter === "folder");
    const statuses = nextFilters.filter((filter) => filter !== "file" && filter !== "folder");
    return panelItems.filter((item) => {
      const status = taskItems.get(item.id)?.status;
      return (types.length === 0 || types.includes(item.is_directory ? "folder" : "file")) &&
        (!task || statuses.length === 0 || statuses.some((filter) => filter === "failed"
          ? status === "failed" || status === "unknown" : status === filter));
    });
  };
  const visibleItems = filteredItems(filters);
  const filterOptions = [...fileFilters, ...taskFilters.map((option) => ({ ...option, disabled: !task }))];
  const totalCount = panelItems.length;
  const visibleIds = visibleItems.map((item) => item.id);
  const selectedSet = new Set(selectedIds);
  const selectedCount = panelItems.filter((item) => selectedSet.has(item.id)).length;
  const visibleSelectedCount = visibleItems.filter((item) => selectedSet.has(item.id)).length;
  const selectableIds = visibleIds.filter((id) => listedItems.has(id) &&
    taskItems.get(id)?.status !== "completed" && taskItems.get(id)?.status !== "unknown");
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedSet.has(id));
  // 任务结果改变状态后，隐藏的失败/完成项退出选择，记录仍留在任务中。
  useEffect(() => {
    if (!task || !taskCurrent || disabled) return;
    const visible = new Set(selectableIds);
    const next = selectedIds.filter((id) => visible.has(id));
    if (next.length !== selectedIds.length) (onReconcileSelection ?? onSelectAll)(next);
  }, [task, taskCurrent, filters, selectedIds, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

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

      <TableContainer className="file-table-wrap">
        <Table
          stickyHeader
          size="small"
          aria-label={`${providerName} 文件列表`}
          sx={{
            "& .MuiTableCell-paddingCheckbox": { width: 44, px: 1 },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
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
            {visibleItems.map((item) => {
              const selected = selectedSet.has(item.id);
              return (
                <TableRow key={item.id} hover selected={selected}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected}
                      disabled={disabled || (Boolean(task) && (!taskCurrent || !listedItems.has(item.id))) || taskItems.get(item.id)?.status === "completed" || taskItems.get(item.id)?.status === "unknown"}
                      onChange={() => onToggle(item.id)}
                      slotProps={{
                        input: {
                          "aria-label": `选择${item.is_directory ? "文件夹" : "文件"} ${item.name}`,
                        },
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip title={item.name} placement="top-start">
                      {item.is_directory ? (
                        <ButtonBase
                          className="directory-name"
                          disabled={Boolean(task) || disabled}
                          onClick={() => item.location && onNavigateLocation ? onNavigateLocation(item.location) : onNavigate(item.path)}
                        >
                          <FolderRoundedIcon className="file-icon" fontSize="small" />
                          <span className="file-name">{item.name}</span>
                        </ButtonBase>
                      ) : (
                        <span className="file-name-cell">
                          <InsertDriveFileOutlinedIcon className="file-icon" fontSize="small" />
                          <span className="file-name">{item.name}</span>
                        </span>
                      )}
                    </Tooltip>
                  </TableCell>
                  <TableCell>{getExtension(item.name, item.is_directory)}</TableCell>
                  <TableCell>{formatModifiedAt(item.modified_at)}</TableCell>
                </TableRow>
              );
            })}
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
}

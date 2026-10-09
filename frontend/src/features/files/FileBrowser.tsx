import { useEffect, useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Alert,
  Box,
  ButtonBase,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Select,
  Stack,
  Typography,
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

import type { DirectoryListing, FileItem, RenameTask, StorageLocation, TaskItemStatus } from "../../types";
import { CheckboxFilterMenu } from "../../components/CheckboxFilterMenu";
import { PanelIconButton } from "../../components/PanelIconButton";
import selectInverseIcon from "../../assets/icon/select-inverse.svg";

const fileFilters = [
  { value: "file", label: "文件" },
  { value: "folder", label: "文件夹" },
] as const;
type FileFilter = typeof fileFilters[number]["value"];

interface FileBrowserProps {
  listing: DirectoryListing;
  task?: RenameTask | null;
  taskCurrent?: boolean;
  disabled?: boolean;
  onSelectRemaining?: () => void;
  onContinue?: () => void;
  onRestart?: () => void;
  onReconcile?: (itemId: string, file: FileItem, completed: boolean) => void;
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
  task, taskCurrent = false, disabled = false, onSelectRemaining, onContinue, onRestart, onReconcile,
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
  const [taskFilter, setTaskFilter] = useState("all");
  const [checkingItem, setCheckingItem] = useState<string | null>(null);
  const [checkedFileId, setCheckedFileId] = useState("");
  useEffect(() => {
    setTaskFilter("all"); setCheckingItem(null); setCheckedFileId("");
  }, [task?.taskId]);
  const taskItems = new Map(task?.items.map((item) => [item.currentFileId, item]));
  const statusMatches = (id: string, filter: string) => {
    const status = taskItems.get(id)?.status;
    return filter === "all" || (filter === "errors" ? status === "failed" || status === "unknown" : status === filter);
  };
  const visibleItems = listing.items.filter((item) =>
    (filters.length === 0 || filters.includes(item.is_directory ? "folder" : "file")) && statusMatches(item.id, taskFilter));
  const counts = (status: TaskItemStatus) => task?.items.filter((item) => item.status === status).length ?? 0;
  const completed = counts("completed");
  const pending = counts("pending");
  const failed = counts("failed");
  const unknown = counts("unknown");
  const statusLabels = { pending: "待处理", completed: "已完成", failed: "失败", unknown: "待核对" };
  const checkedFile = listing.items.find((file) => file.id === checkedFileId);
  const checking = task?.items.find((item) => item.taskItemId === checkingItem);
  const reconcile = (done: boolean) => {
    if (!checkingItem || !checkedFile) return;
    onReconcile?.(checkingItem, checkedFile, done);
    setCheckingItem(null); setCheckedFileId("");
  };
  const visibleIds = visibleItems.map((item) => item.id);
  const selectedSet = new Set(selectedIds);
  const selectedCount = listing.items.filter((item) => selectedSet.has(item.id)).length;
  const visibleSelectedCount = visibleItems.filter((item) => selectedSet.has(item.id)).length;
  const allSelected = visibleItems.length > 0 && visibleSelectedCount === visibleItems.length;

  return (
    <section className="panel browser" aria-labelledby="files-title" aria-busy={isRefreshing}>
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="files-title">文件选择</h2>
          <p className="panel-summary">
            共 {listing.items.length} 项 · 已选择 {selectedCount} 项
            {filters.length > 0 && ` · 显示 ${visibleItems.length} 项`}
          </p>
        </div>
        <div className="browser-heading-actions">
          {(listing.parent_location !== undefined ? listing.parent_location !== null : listing.parent_path !== null) && (
            <Tooltip title="返回上级" arrow>
              <PanelIconButton
                size="small"
                aria-label="返回上级"
                onClick={() => listing.parent_location && onNavigateLocation ? onNavigateLocation(listing.parent_location) : onNavigate(listing.parent_path ?? "")}
              >
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
                disabled={!onRefresh || isRefreshing}
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
                onClick={() => onInvertSelection(visibleIds)}
                disabled={visibleItems.length === 0}
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
          <CheckboxFilterMenu label="筛选项目" options={fileFilters} selected={filters} onChange={(nextFilters) => {
            setFilters(nextFilters);
            // 被筛选隐藏的项目退出选择，取消筛选也不恢复旧选择。
            const nextVisibleIds = new Set(listing.items
              .filter((item) => (nextFilters.length === 0 || nextFilters.includes(item.is_directory ? "folder" : "file")) && statusMatches(item.id, taskFilter))
              .map((item) => item.id));
            const nextSelectedIds = selectedIds.filter((id) => nextVisibleIds.has(id));
            if (nextSelectedIds.length !== selectedIds.length) onSelectAll(nextSelectedIds);
          }} />
        </div>
      </div>
      {task && (
        <Stack spacing={0.75} sx={{ px: 2, pb: 1 }}>
          <Typography variant="body2" role="status">
            本次共 {task.items.length} 项 · 已完成 {completed} · 待处理 {pending} · 失败 {failed} · 待核对 {unknown}
            {` · 已执行 ${task.batches.filter((batch) => batch.outcome).length} 批 · ${completed === task.items.length ? "任务已完成" : `当前第 ${task.batches.filter((batch) => batch.outcome).length + 1} 批（最多 1000 项）`}`}
          </Typography>
          <LinearProgress variant="determinate" value={task.items.length ? completed / task.items.length * 100 : 0} aria-label="整体任务进度" />
          {!taskCurrent && <Alert severity="warning">目录、连接或规则已变化；旧任务不能继续，请重新预览或重新开始任务。</Alert>}
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Select size="small" value={taskFilter} disabled={disabled} inputProps={{ "aria-label": "任务状态筛选" }} onChange={(event) => {
              const next = event.target.value;
              setTaskFilter(next);
              onSelectAll(selectedIds.filter((id) => statusMatches(id, next)));
            }}>
              <MenuItem value="all">全部</MenuItem><MenuItem value="pending">待处理</MenuItem>
              <MenuItem value="completed">已完成</MenuItem><MenuItem value="errors">失败/待核对</MenuItem>
            </Select>
            <Button disabled={disabled || !taskCurrent || pending === 0} onClick={() => {
              setFilters([]); setTaskFilter("pending"); onSelectRemaining?.();
            }}>选择剩余文件</Button>
            <Button disabled={disabled || !taskCurrent || pending === 0} onClick={() => {
              setFilters([]); setTaskFilter("pending"); onContinue?.();
            }}>继续下一批</Button>
            <Button disabled={disabled || unknown > 0} onClick={() => { setTaskFilter("all"); onRestart?.(); }}>重新开始任务</Button>
          </Stack>
          <Typography variant="caption">本任务文件集合固定；新增选择需重新开始任务。每批重新预览并确认，完成项不再进入本任务。</Typography>
          {(failed > 0 || unknown > 0) && <Alert severity="warning">失败项可单独选择并重新预览；待核对项禁止重试。请先刷新目录，核对文件身份及实际执行结果。</Alert>}
          {unknown > 0 && <Button disabled={disabled || !taskCurrent || Boolean(refreshError)} onClick={() => {
            setCheckingItem(task.items.find((item) => item.status === "unknown")!.taskItemId); setCheckedFileId("");
          }}>核对待核对项</Button>}
        </Stack>
      )}
      <Dialog open={Boolean(checkingItem)} onClose={() => setCheckingItem(null)}>
        <DialogTitle>核对执行结果</DialogTitle>
        <DialogContent>
          <Select fullWidth size="small" value={checkingItem ?? ""} inputProps={{ "aria-label": "选择待核对任务文件" }} onChange={(event) => {
            setCheckingItem(event.target.value); setCheckedFileId("");
          }}>
            {task?.items.filter((item) => item.status === "unknown").map((item) => <MenuItem key={item.taskItemId} value={item.taskItemId}>{item.before.name}（{item.before.id}）</MenuItem>)}
          </Select>
          <Typography>原文件：{checking?.before.name}（ID：{checking?.before.id}）。请核对真实目录和文件内容，再选择对应的当前文件。名称相同不能证明身份相同。</Typography>
          <Select fullWidth size="small" value={checkedFileId} inputProps={{ "aria-label": "核对当前文件身份" }} onChange={(event) => setCheckedFileId(event.target.value)}>
            {listing.items.filter((file) => !task?.items.some((item) => item.taskItemId !== checkingItem && item.status !== "unknown" && item.currentFileId === file.id)).map((file) => (
              <MenuItem key={file.id} value={file.id}>{file.name}（{file.id}）</MenuItem>
            ))}
          </Select>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCheckingItem(null)}>取消</Button>
          <Button disabled={!checkedFile || disabled || !taskCurrent} onClick={() => reconcile(true)}>确认已完成</Button>
          <Button disabled={!checkedFile || disabled || !taskCurrent} onClick={() => reconcile(false)}>确认未完成，允许重新预览</Button>
        </DialogActions>
      </Dialog>
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
                  disabled={disabled || visibleItems.length === 0}
                  onChange={() => (allSelected ? onClearSelection?.() : onSelectAll(visibleIds))}
                  slotProps={{ input: { "aria-label": "选择当前显示的全部项目" } }}
                />
              </TableCell>
              <TableCell>文件名</TableCell>
              <TableCell className="file-extension-column">扩展名</TableCell>
              <TableCell className="file-modified-column">修改时间</TableCell>
              {task && <TableCell>任务状态</TableCell>}
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
                      disabled={disabled || taskItems.get(item.id)?.status === "completed" || taskItems.get(item.id)?.status === "unknown"}
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
                  {task && <TableCell>{taskItems.has(item.id) ? statusLabels[taskItems.get(item.id)!.status] : "—"}</TableCell>}
                </TableRow>
              );
            })}
            {visibleItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={task ? 5 : 4} align="center">
                  {listing.items.length === 0 ? "此目录为空。" : "没有符合筛选条件的项目。"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}

import { useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
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

import type { DirectoryListing, StorageLocation } from "../../types";
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
  const visibleItems = listing.items.filter((item) => filters.length === 0 || filters.includes(item.is_directory ? "folder" : "file"));
  const visibleIds = visibleItems.map((item) => item.id);
  const selectedCount = listing.items.filter((item) => selectedIds.includes(item.id)).length;
  const visibleSelectedCount = visibleItems.filter((item) => selectedIds.includes(item.id)).length;
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
              .filter((item) => nextFilters.length === 0 || nextFilters.includes(item.is_directory ? "folder" : "file"))
              .map((item) => item.id));
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
                  disabled={visibleItems.length === 0}
                  onChange={() => (allSelected ? onClearSelection?.() : onSelectAll(visibleIds))}
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
              const selected = selectedIds.includes(item.id);
              return (
                <TableRow key={item.id} hover selected={selected}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected}
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
                </TableRow>
              );
            })}
            {visibleItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">
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

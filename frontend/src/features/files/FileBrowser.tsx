import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Button,
  Checkbox,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";

import type { DirectoryListing } from "../../types";

interface FileBrowserProps {
  listing: DirectoryListing;
  providerName: string;
  selectedIds: string[];
  isRefreshing?: boolean;
  onNavigate: (path: string) => void;
  onRefresh?: () => void;
  onToggle: (fileId: string) => void;
  onSelectAll: () => void;
  onClearSelection?: () => void;
  onInvertSelection: () => void;
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
  onNavigate,
  onRefresh,
  onToggle,
  onSelectAll,
  onClearSelection,
  onInvertSelection,
}: FileBrowserProps) {
  const selectedCount = listing.items.filter((item) => selectedIds.includes(item.id)).length;
  const allSelected = listing.items.length > 0 && selectedCount === listing.items.length;

  return (
    <section className="panel browser" aria-labelledby="files-title">
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="files-title">文件预览</h2>
          <p className="panel-summary">
            共 {listing.items.length} 项 · 已选择 {selectedCount} 项
          </p>
        </div>
        <div className="browser-heading-actions">
          {listing.parent_path !== null && (
            <Tooltip title="返回上级" arrow>
              <IconButton
                size="small"
                aria-label="返回上级"
                onClick={() => onNavigate(listing.parent_path ?? "")}
              >
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={isRefreshing ? "刷新中" : "刷新"} arrow>
            <span>
              <IconButton
                size="small"
                aria-label={isRefreshing ? "刷新中" : "刷新"}
                onClick={onRefresh}
                disabled={!onRefresh || isRefreshing}
              >
                <RefreshRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Button size="small" onClick={onSelectAll} disabled={listing.items.length === 0}>
            全选
          </Button>
          <Button size="small" onClick={onInvertSelection} disabled={listing.items.length === 0}>
            反选
          </Button>
        </div>
      </div>

      <TableContainer className="file-table-wrap">
        <Table stickyHeader size="small" aria-label={`${providerName} 文件列表`}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={selectedCount > 0 && !allSelected}
                  onChange={() => (allSelected ? onClearSelection?.() : onSelectAll())}
                  slotProps={{ input: { "aria-label": "选择当前目录全部项目" } }}
                />
              </TableCell>
              <TableCell>文件名</TableCell>
              <TableCell className="file-extension-column">扩展名</TableCell>
              <TableCell className="file-modified-column">修改时间</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {listing.items.map((item) => {
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
                        <button className="directory-name" onClick={() => onNavigate(item.path)}>
                          <FolderRoundedIcon className="file-icon" fontSize="small" />
                          <span className="file-name">{item.name}</span>
                        </button>
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
            {listing.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">此目录为空。</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}

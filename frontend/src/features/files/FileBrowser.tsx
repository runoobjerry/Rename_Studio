import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  TableSortLabel,
  Tooltip,
} from "@mui/material";

import type { DirectoryListing, FileItem, StorageLocation } from "../../types";
import { CheckboxFilterMenu } from "../../components/CheckboxFilterMenu";
import { PanelIconButton } from "../../components/PanelIconButton";
import { useVirtualTable } from "../../hooks/useVirtualTable";
import { VirtualTableSpacer } from "../../components/VirtualTableSpacer";
import selectInverseIcon from "../../assets/icon/select-inverse.svg";
import type { FileSort } from "./fileSort";

const fileFilters = [
  { value: "file", labelKey: "files:types.file" },
  { value: "folder", labelKey: "files:types.folder" },
] as const;
const fixedColumnWidths = [44] as const;
// 直接约束控件，避免 MUI 自身内边距或表格列宽改变其 20px 几何。
const fileCheckboxSx = {
  width: 20, minWidth: 20, maxWidth: 20, height: 20, p: 0,
  "& .MuiSvgIcon-root": { width: 20, height: 20, fontSize: 20 },
};
type FileFilter = typeof fileFilters[number]["value"];
interface FileBrowserProps {
  listing: DirectoryListing;
  items: FileItem[];
  sort: FileSort;
  onSortChange: (sort: FileSort) => void;
  hasTask?: boolean;
  onEndTask?: () => void;
  disabled?: boolean;
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

function getExtension(name: string, isDirectory: boolean, folderLabel: string): string {
  if (isDirectory) return folderLabel;
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < name.length - 1 ? name.slice(dotIndex + 1) : "—";
}

function formatModifiedAt(value: string | null, formatter: Intl.DateTimeFormat): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatter.format(date);
}

export const FileBrowser = memo(function FileBrowser({
  listing, items: panelItems, sort, onSortChange,
  hasTask = false, onEndTask, disabled = false,
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
  const { t, i18n } = useTranslation();
  const modifiedAtFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }), [i18n.resolvedLanguage]);
  const [filters, setFilters] = useState<FileFilter[]>([]);
  const listedItems = useMemo(() => new Map(listing.items.map((item) => [item.id, item])), [listing.items]);
  const filteredItems = useCallback((nextFilters: FileFilter[]) => panelItems.filter((item) =>
    nextFilters.length === 0 || nextFilters.includes(item.is_directory ? "folder" : "file")), [panelItems]);
  const visibleItems = useMemo(() => filteredItems(filters), [filteredItems, filters]);
  const filterOptions = fileFilters.map((option) => ({ ...option, label: t(option.labelKey) }));
  const totalCount = panelItems.length;
  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCount = useMemo(() => panelItems.filter((item) => selectedSet.has(item.id)).length, [panelItems, selectedSet]);
  const visibleSelectedCount = useMemo(() => visibleItems.filter((item) => selectedSet.has(item.id)).length, [visibleItems, selectedSet]);
  const selectableIds = useMemo(() => visibleIds.filter((id) => listedItems.has(id) && listedItems.get(id)!.can_rename !== false), [visibleIds, listedItems]);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  useEffect(() => {
    setSelectionAnchor(null);
  }, [listing, filters, sort]);
  const selectRow = useCallback((fileId: string, shiftKey: boolean) => {
    const anchorIndex = selectionAnchor !== null && selectedSet.has(selectionAnchor)
      ? selectableIds.indexOf(selectionAnchor) : -1;
    if (shiftKey && anchorIndex >= 0) {
      // 使用完整可选列表，区间选择不受虚拟滚动的已渲染行限制。
      const targetIndex = selectableIds.indexOf(fileId);
      onSelectAll(selectableIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1));
    } else {
      setSelectionAnchor(fileId);
      onSelectAll([fileId]);
    }
  }, [selectionAnchor, selectedSet, selectableIds, onSelectAll]);
  const scrollKey = useMemo(() => [listing.items, filters, sort], [listing.items, filters, sort]);
  const columnValues = useMemo(() => [visibleItems.map(() => ""), visibleItems.map((item) => item.name),
    visibleItems.map((item) => getExtension(item.name, item.is_directory, t("files:types.folder"))),
    visibleItems.map((item) => formatModifiedAt(item.modified_at, modifiedAtFormatter))], [visibleItems, modifiedAtFormatter, t]);
  const virtual = useVirtualTable(visibleItems.length, scrollKey, columnValues, fixedColumnWidths);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedSet.has(id));
  return (
    <section className="panel browser" aria-labelledby="files-title" aria-busy={isRefreshing}>
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="files-title">{t(hasTask ? "files:taskTitle" : "files:title")}</h2>
          <p className="panel-summary">
            {t("files:summary", { total: totalCount, selected: selectedCount })}
            {filters.length > 0 && t("files:showing", { count: visibleItems.length })}
          </p>
        </div>
        <div className="browser-heading-actions">
          {hasTask ? (
            <Tooltip title={t("files:endTask")} arrow>
              <span><PanelIconButton size="small" aria-label={t("files:endTask")} disabled={disabled} onClick={onEndTask}>
                <LogoutRoundedIcon fontSize="small" />
              </PanelIconButton></span>
            </Tooltip>
          ) : (listing.parent_location !== undefined ? listing.parent_location !== null : listing.parent_path !== null) && (
            <Tooltip title={t("files:parent")} arrow>
              <PanelIconButton size="small" aria-label={t("files:parent")}
                onClick={() => listing.parent_location && onNavigateLocation ? onNavigateLocation(listing.parent_location) : onNavigate(listing.parent_path ?? "")}>
                <ArrowBackRoundedIcon fontSize="small" />
              </PanelIconButton>
            </Tooltip>
          )}
          <Tooltip title={isRefreshing ? t("common:refreshing") : t("common:refresh")} arrow>
            <span>
              <PanelIconButton
                size="small"
                aria-label={isRefreshing ? t("common:refreshing") : t("common:refresh")}
                onClick={onRefresh}
                disabled={disabled || !onRefresh || isRefreshing}
              >
                <RefreshRoundedIcon fontSize="small" />
              </PanelIconButton>
            </span>
          </Tooltip>
          <Tooltip title={t("files:invert")} arrow>
            <span>
              <PanelIconButton
                size="small"
                aria-label={t("files:invert")}
                onClick={() => onInvertSelection(selectableIds)}
                disabled={disabled || selectableIds.length === 0}
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
          <CheckboxFilterMenu label={t("files:filterItems")} options={filterOptions} disabled={disabled} selected={filters} onChange={(nextFilters) => {
            setFilters(nextFilters);
            // 被筛选隐藏的项目退出选择，取消筛选也不恢复旧选择。
            const nextVisibleIds = new Set(filteredItems(nextFilters).map((item) => item.id));
            const nextSelectedIds = selectedIds.filter((id) => nextVisibleIds.has(id));
            if (nextSelectedIds.length !== selectedIds.length) onSelectAll(nextSelectedIds);
          }} />
        </div>
      </div>
      {isRefreshing && <LinearProgress aria-label={t("files:refreshingDirectory")} sx={{ flexShrink: 0 }} />}
      {refreshError && (
        <Alert severity="error">{t("files:refreshFailed", { message: refreshError })}</Alert>
      )}

      <TableContainer className="file-table-wrap" ref={virtual.containerRef} onScroll={virtual.onScroll}
        onKeyDown={virtual.onKeyDown} tabIndex={0}>
        <Table
          stickyHeader
          aria-rowcount={visibleItems.length + 1}
          size="small"
          aria-label={t("files:listLabel", { provider: providerName })}
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
                  disabled={disabled || selectableIds.length === 0}
                  onChange={() => (allSelected ? onClearSelection?.() : onSelectAll(selectableIds))}
                  slotProps={{ input: { "aria-label": t("files:selectAll") } }}
                />
              </TableCell>
              <TableCell sortDirection={sort.field === "name" ? sort.direction : false}>
                <TableSortLabel active={sort.field === "name"} direction={sort.field === "name" ? sort.direction : "asc"}
                  slotProps={{ icon: { sx: { fontSize: 16 } } }}
                  disabled={disabled} onClick={() => onSortChange({ field: "name",
                    direction: sort.field === "name" && sort.direction === "asc" ? "desc" : "asc" })}>
                  {t("files:columns.name")}
                </TableSortLabel>
              </TableCell>
              <TableCell className="file-extension-column">{t("files:columns.extension")}</TableCell>
              <TableCell className="file-modified-column" sortDirection={sort.field === "modified_at" ? sort.direction : false}>
                <TableSortLabel active={sort.field === "modified_at"} direction={sort.field === "modified_at" ? sort.direction : "asc"}
                  slotProps={{ icon: { sx: { fontSize: 16 } } }}
                  disabled={disabled} onClick={() => onSortChange({ field: "modified_at",
                    direction: sort.field === "modified_at" && sort.direction === "asc" ? "desc" : "asc" })}>
                  {t("files:columns.modified")}
                </TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <VirtualTableSpacer height={virtual.top} columns={4} />
            {visibleItems.slice(virtual.start, virtual.end).map((item, offset) => (
              <FileBrowserRow key={item.id}
                item={item} rowIndex={virtual.start + offset} selected={selectedSet.has(item.id)} modifiedAtFormatter={modifiedAtFormatter}
                disabled={disabled || !listedItems.has(item.id) || listedItems.get(item.id)?.can_rename === false}
                navigationDisabled={disabled || hasTask} onToggle={onToggle} onSelectRow={selectRow}
                onNavigate={onNavigate} onNavigateLocation={onNavigateLocation} />
            ))}
            <VirtualTableSpacer height={virtual.bottom} columns={4} />
            {visibleItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  {totalCount === 0 ? t(hasTask ? "files:emptyTask" : "files:emptyDirectory") : t("common:noMatches")}
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
  modifiedAtFormatter: Intl.DateTimeFormat;
  item: FileItem;
  rowIndex: number;
  selected: boolean;
  disabled: boolean;
  navigationDisabled: boolean;
  onToggle: FileBrowserProps["onToggle"];
  onSelectRow: (fileId: string, shiftKey: boolean) => void;
  onNavigate: FileBrowserProps["onNavigate"];
  onNavigateLocation: FileBrowserProps["onNavigateLocation"];
}

const FileBrowserRow = memo(function FileBrowserRow({ item, rowIndex, selected, disabled, navigationDisabled, modifiedAtFormatter,
  onToggle, onSelectRow, onNavigate, onNavigateLocation }: FileBrowserRowProps) {
  const { t } = useTranslation();
  const modifiedAt = formatModifiedAt(item.modified_at, modifiedAtFormatter);
  return <TableRow hover selected={selected} data-row-index={rowIndex} aria-rowindex={rowIndex + 2} tabIndex={-1}
    onClick={(event) => { if (!disabled) onSelectRow(item.id, event.shiftKey); }}
    onMouseDown={(event) => { if (!disabled && event.shiftKey) event.preventDefault(); }}
    sx={{ cursor: disabled ? undefined : "pointer" }}>
    <TableCell padding="checkbox">
      <Checkbox size="small" sx={fileCheckboxSx} checked={selected} disabled={disabled} onChange={() => onToggle(item.id)}
        onClick={(event) => event.stopPropagation()}
        slotProps={{ input: { "aria-label": t(item.is_directory ? "files:selectFolder" : "files:selectFile", { name: item.name }) } }} />
    </TableCell>
    <TableCell>
      <Tooltip title={item.name} placement="top-start">
        {item.is_directory ? <ButtonBase className="directory-name" disabled={navigationDisabled}
          onClick={(event) => {
            event.stopPropagation();
            if (item.location && onNavigateLocation) onNavigateLocation(item.location);
            else onNavigate(item.path);
          }}>
          <FolderRoundedIcon className="file-icon" fontSize="small" />
          <span className="file-name">{item.name}</span>
        </ButtonBase> : <span className="file-name-cell">
          <InsertDriveFileOutlinedIcon className="file-icon" fontSize="small" />
          <span className="file-name">{item.name}</span>
        </span>}
      </Tooltip>
    </TableCell>
    <TableCell>{getExtension(item.name, item.is_directory, t("files:types.folder"))}</TableCell>
    <TableCell>{modifiedAt}</TableCell>
  </TableRow>;
});

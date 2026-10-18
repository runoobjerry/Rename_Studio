import { useLayoutEffect, useMemo, useRef, useState } from "react";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { Box, Breadcrumbs, Button, Menu, MenuItem, Tooltip } from "@mui/material";
import { PanelIconButton } from "../../components/PanelIconButton";
import type { DirectoryListing, StorageLocation } from "../../types";

interface LocationBreadcrumbsProps {
  listing?: DirectoryListing;
  rootLabel: string;
  disabled: boolean;
  onNavigate: (location: StorageLocation) => void;
}

export const locationButtonSx = {
  minWidth: 0, height: 30, px: "5px", py: "4px", fontSize: 13, lineHeight: 1.5,
  borderRadius: "8px", whiteSpace: "nowrap",
} as const;

const buttonSx = {
  ...locationButtonSx,
  color: "text.secondary", flexShrink: 0,
} as const;

export function LocationBreadcrumbs({ listing, rootLabel, disabled, onNavigate }: LocationBreadcrumbsProps) {
  const container = useRef<HTMLDivElement>(null);
  const measurement = useRef<HTMLDivElement>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const entries = useMemo(() => {
    // ID 型 Provider 的显示名可含分隔符或重名；只使用服务端祖先身份导航。
    if (listing?.breadcrumbs) {
      return listing.breadcrumbs.map((entry) => ({ label: entry.name, location: entry.location }));
    }
    const segments = listing?.path.split("/").filter(Boolean) ?? [];
    return [
      { label: rootLabel, location: { kind: "root" } as StorageLocation },
      ...segments.map((label, index) => ({
        label,
        // 当前/上级优先使用服务端位置；其余祖先由支持 path 的接口解析。
        location: index === segments.length - 1 && listing?.location ? listing.location
          : index === segments.length - 2 && listing?.parent_location ? listing.parent_location
          : { kind: "path", value: segments.slice(0, index + 1).join("/") } as StorageLocation,
      })),
    ];
  }, [listing, rootLabel]);

  useLayoutEffect(() => {
    const update = () => {
      const available = container.current!.getBoundingClientRect().width;
      const widths = Array.from(measurement.current!.children, (child) => child.getBoundingClientRect().width);
      // 分隔图标18px，两侧各2px；折叠按钮与路径按钮同为28px高。
      let first = 0;
      while (first < entries.length - 1) {
        const required = widths.slice(first).reduce((sum, width) => sum + width, 0)
          + (entries.length - first - 1) * 22 + (first > 0 ? 50 : 0);
        if (required <= available) break;
        first += 1;
      }
      setHiddenCount(first);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container.current!);
    observer.observe(measurement.current!);
    return () => observer.disconnect();
  }, [entries]);

  useLayoutEffect(() => setAnchor(null), [entries]);

  return (
    <Box ref={container} sx={{ flex: "1 1 0", minWidth: 0, width: "100%", position: "relative" }}>
      <Box ref={measurement} aria-hidden="true" sx={{ display: "flex", position: "absolute", width: "max-content", visibility: "hidden", pointerEvents: "none" }}>
        {entries.map((entry, index) => <Button key={index} tabIndex={-1} sx={buttonSx}>{entry.label}</Button>)}
      </Box>
      <Breadcrumbs aria-label="文件路径" separator={<ChevronRightIcon sx={{ fontSize: 18 }} />}
        maxItems={entries.length + 1}
        sx={{ "& ol": { flexWrap: "nowrap" }, "& .MuiBreadcrumbs-separator": { mx: "2px" },
          "& .MuiBreadcrumbs-li": { display: "flex", minWidth: 0, flexShrink: 0 },
          "& .MuiBreadcrumbs-li:last-child": { flexShrink: 1, overflow: "hidden" } }}>
        {hiddenCount > 0 && (
          <Tooltip title="显示父级目录">
            <span><PanelIconButton aria-label="显示父级目录" disabled={disabled} sx={{ p: "4px" }}
              aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? "location-parents-menu" : undefined}
              onClick={(event) => setAnchor(event.currentTarget)}><MoreHorizIcon /></PanelIconButton></span>
          </Tooltip>
        )}
        {entries.slice(hiddenCount).map((entry, offset) => {
          const current = hiddenCount + offset === entries.length - 1;
          return <Tooltip key={hiddenCount + offset} title={entry.label}>
            <Button disabled={disabled} aria-current={current ? "page" : undefined}
              onClick={() => onNavigate(entry.location)}
              sx={{ ...buttonSx, ...(current && { flexShrink: 1, overflow: "hidden", color: "text.primary" }) }}>
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>{entry.label}</Box>
            </Button>
          </Tooltip>;
        })}
      </Breadcrumbs>
      <Menu id="location-parents-menu" anchorEl={anchor} open={Boolean(anchor) && !disabled} onClose={() => setAnchor(null)}>
        {entries.slice(0, hiddenCount).map((entry, index) => (
          <MenuItem key={index} onClick={() => { setAnchor(null); onNavigate(entry.location); }}>
            <Box component="span" title={entry.label} sx={{ maxWidth: "min(360px, 70vw)", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.label}</Box>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

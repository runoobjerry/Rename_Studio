import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import { Alert, Button, IconButton } from "@mui/material";
import { LocationBreadcrumbs, locationButtonSx } from "../../features/files/LocationBreadcrumbs";
import type { DirectoryListing, StorageLocation } from "../../types";

interface StorageLocationPanelProps {
  compactNavigation: boolean;
  listing?: DirectoryListing;
  rootLabel: string;
  providerId: string;
  navigationDisabled: boolean;
  defaultPathDisabled: boolean;
  browseDisabled: boolean;
  isPickingFolder: boolean;
  storageMissing: boolean;
  accountIdMissing: boolean;
  pickerError: Error | null;
  cloudDisconnected: boolean;
  onOpenNavigation: () => void;
  onNavigate: (location: StorageLocation) => void;
  onSetDefaultPath: () => void;
  onBrowse: () => void;
}

export function StorageLocationPanel({
  compactNavigation, listing, rootLabel, providerId, navigationDisabled,
  defaultPathDisabled, browseDisabled, isPickingFolder, storageMissing,
  accountIdMissing, pickerError, cloudDisconnected, onOpenNavigation,
  onNavigate, onSetDefaultPath, onBrowse,
}: StorageLocationPanelProps) {
  return (
    <section className="panel location-panel" aria-label="目录位置">
      <div className="location-toolbar">
        {compactNavigation && (
          <IconButton onClick={onOpenNavigation} aria-label="打开导航" sx={{ p: "4px" }}>
            <MenuRoundedIcon sx={{ fontSize: 20 }} />
          </IconButton>
        )}
        <div className="location-navigation">
          <LocationBreadcrumbs
            listing={listing}
            rootLabel={rootLabel}
            disabled={navigationDisabled}
            onNavigate={onNavigate}
          />
          {providerId !== "local" ? (
            <Button
              type="button"
              variant="outlined"
              onClick={onSetDefaultPath}
              disabled={defaultPathDisabled}
              sx={{ ...locationButtonSx, px: "10px" }}
            >
              设为默认路径
            </Button>
          ) : (
            <Button
              type="button"
              variant="outlined"
              onClick={onBrowse}
              disabled={browseDisabled}
              sx={{ ...locationButtonSx, px: "10px" }}
            >
              {isPickingFolder ? "等待选择…" : "浏览…"}
            </Button>
          )}
        </div>
      </div>
      <div className="location-feedback">
        {storageMissing && <Alert severity="warning">当前存储已删除，请选择其他连接。</Alert>}
        {accountIdMissing && (
          <Alert severity="info">当前账号缺少账号 ID，仍可浏览文件；请重新登录后设置默认路径。</Alert>
        )}
        {providerId === "local" && pickerError && (
          <Alert severity="error">无法打开文件夹选择器：{pickerError.message}</Alert>
        )}
        {providerId !== "local" && cloudDisconnected && (
          <Alert severity="warning">请先前往设置页面连接 {providerId === "google_drive" ? "Google Drive" : "OneDrive"} 账号。</Alert>
        )}
      </div>
    </section>
  );
}

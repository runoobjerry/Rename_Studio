import { useTranslation } from "react-i18next";
import { errorMessage } from "../../i18n/messages";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import { Alert, Button, IconButton } from "@mui/material";
import { LocationBreadcrumbs, locationButtonSx } from "../../features/files/LocationBreadcrumbs";
import type { DirectoryListing, StorageLocation } from "../../types";

interface StorageLocationPanelProps {
  compactNavigation: boolean;
  listing?: DirectoryListing;
  rootLabel: string;
  serviceName: string;
  requiresAuth: boolean;
  supportsLocalPicker: boolean;
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
  compactNavigation, listing, rootLabel, serviceName, requiresAuth, supportsLocalPicker, navigationDisabled,
  defaultPathDisabled, browseDisabled, isPickingFolder, storageMissing,
  accountIdMissing, pickerError, cloudDisconnected, onOpenNavigation,
  onNavigate, onSetDefaultPath, onBrowse,
}: StorageLocationPanelProps) {
  const { t } = useTranslation();
  return (
    <section className="panel location-panel" aria-label={t("files:location.title")}>
      <div className="location-toolbar">
        {compactNavigation && (
          <IconButton onClick={onOpenNavigation} aria-label={t("files:location.openNavigation")} sx={{ p: "4px" }}>
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
          {requiresAuth && (
            <Button
              type="button"
              variant="outlined"
              onClick={onSetDefaultPath}
              disabled={defaultPathDisabled}
              sx={{ ...locationButtonSx, px: "10px" }}
            >
              {t("files:location.setDefault")}
            </Button>
          )}
          {supportsLocalPicker && (
            <Button
              type="button"
              variant="outlined"
              onClick={onBrowse}
              disabled={browseDisabled}
              sx={{ ...locationButtonSx, px: "10px" }}
            >
              {isPickingFolder ? t("files:location.picking") : t("files:location.browse")}
            </Button>
          )}
        </div>
      </div>
      <div className="location-feedback">
        {storageMissing && <Alert severity="warning">{t("files:location.storageMissing")}</Alert>}
        {accountIdMissing && (
          <Alert severity="info">{t("files:location.accountIdMissing")}</Alert>
        )}
        {supportsLocalPicker && pickerError && (
          <Alert severity="error">{t("files:location.pickerFailed", { message: errorMessage(pickerError, t) })}</Alert>
        )}
        {requiresAuth && cloudDisconnected && (
          <Alert severity="warning">{t("files:location.connectAccount", { service: serviceName })}</Alert>
        )}
      </div>
    </section>
  );
}

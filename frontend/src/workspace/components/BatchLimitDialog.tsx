import { useTranslation } from "react-i18next";
import { RENAME_BATCH_SIZE } from "../../stores/useRenameStore";
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel } from "@mui/material";

interface BatchLimitDialogProps {
  open: boolean;
  checked: boolean;
  onClose: () => void;
  onCheckedChange: (checked: boolean) => void;
  onContinue: () => void;
}

export function BatchLimitDialog({ open, checked, onClose, onCheckedChange, onContinue }: BatchLimitDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("files:batch.title")}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t("files:batch.description", { limit: RENAME_BATCH_SIZE })}
        </DialogContentText>
        <FormControlLabel
          label={t("files:batch.hideHint")}
          slotProps={{ typography: { variant: "body2" } }}
          control={<Checkbox size="small" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:cancel")}</Button>
        <Button onClick={onContinue}>{t("files:batch.continue")}</Button>
      </DialogActions>
    </Dialog>
  );
}

import { useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useRenameStore } from "../../stores/useRenameStore";

export function UnknownExecutionNotice() {
  const { t } = useTranslation();
  const unknown = useRenameStore((state) => state.unknownExecution);
  const [confirming, setConfirming] = useState(false);
  if (!unknown) return null;
  return <>
    <Alert severity="warning" sx={{ mb: 1 }} action={<Button color="inherit" onClick={() => setConfirming(true)}>
      {t("files:verification.review")}
    </Button>}>{t("files:verification.required", { storage: unknown.storageId })}</Alert>
    <Dialog open={confirming} onClose={() => setConfirming(false)}>
      <DialogTitle>{t("files:verification.review")}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t("files:verification.instructions")}</DialogContentText>
        <ul>{unknown.items.map((item) => <li key={item.file_id}>{item.original_name} → {item.new_name}</li>)}</ul>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirming(false)}>{t("common:cancel")}</Button>
        <Button onClick={() => {
          useRenameStore.getState().setUnknownExecution(null);
          useRenameStore.getState().clearSelection();
          setConfirming(false);
        }}>{t("files:verification.confirm")}</Button>
      </DialogActions>
    </Dialog>
  </>;
}

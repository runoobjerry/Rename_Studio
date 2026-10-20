import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel } from "@mui/material";

interface BatchLimitDialogProps {
  open: boolean;
  checked: boolean;
  onClose: () => void;
  onCheckedChange: (checked: boolean) => void;
  onContinue: () => void;
}

export function BatchLimitDialog({ open, checked, onClose, onCheckedChange, onContinue }: BatchLimitDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>大批量处理提示</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          当前选择的文件超过 1000 项。为避免影响性能，本次只会修改前 1000 项。本次执行结束后，您可以在“筛选”中选择“待处理项目”，继续选择并处理剩余项目。
        </DialogContentText>
        <FormControlLabel
          label="下次不再提示"
          slotProps={{ typography: { variant: "body2" } }}
          control={<Checkbox size="small" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button onClick={onContinue}>继续预览</Button>
      </DialogActions>
    </Dialog>
  );
}

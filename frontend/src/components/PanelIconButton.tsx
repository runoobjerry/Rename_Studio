import IconButton from "@mui/material/IconButton";
import { styled } from "@mui/material/styles";

// 面板图标操作共享尺寸；筛选等有状态控件只覆盖自己的状态颜色。
export const PanelIconButton = styled(IconButton)(({ theme }) => ({
  color: theme.palette.text.secondary,
  padding: 5,
  border: 0,
  "& .MuiSvgIcon-root": { fontSize: 20 },
}));

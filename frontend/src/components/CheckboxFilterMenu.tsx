import { useId, useState } from "react";
import FilterList from "@mui/icons-material/FilterList";
import FilterListOff from "@mui/icons-material/FilterListOff";
import { Checkbox, Divider, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import { PanelIconButton } from "./PanelIconButton";

interface CheckboxFilterMenuProps<T extends string> {
  label: string;
  disabled?: boolean;
  options: ReadonlyArray<{ value: T; label: string; dividerBefore?: boolean; disabled?: boolean }>;
  selected: readonly T[];
  onChange: (selected: T[]) => void;
}

export function CheckboxFilterMenu<T extends string>({
  label, options, selected, onChange, disabled = false,
}: CheckboxFilterMenuProps<T>) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = selected.length > 0;
  return (
    <>
      <Tooltip title={`${label}（${active ? "已启用" : "未启用"}）`} arrow>
        <PanelIconButton
          id={`${id}-button`}
          size="small"
          disabled={disabled}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? `${id}-menu` : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={active ? { color: "primary.main" } : undefined}
        >
          {active ? <FilterList sx={{ fontSize: 20 }} /> : <FilterListOff sx={{ fontSize: 20 }} />}
        </PanelIconButton>
      </Tooltip>
      <Menu
        id={`${id}-menu`}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: { sx: { minWidth: 136 } },
          list: { "aria-labelledby": `${id}-button`, dense: true },
        }}
      >
        {options.flatMap((option) => {
          const checked = selected.includes(option.value);
          const item = (
            <MenuItem
              key={option.value}
              disabled={option.disabled}
              dense
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => onChange(checked
                ? selected.filter((value) => value !== option.value)
                : [...selected, option.value])}
            >
              <Checkbox
                size="small"
                checked={checked}
                tabIndex={-1}
                disableRipple
                sx={{
                  p: 0.5,
                  pointerEvents: "none",
                  "& .MuiSvgIcon-root": { fontSize: 18 },
                }}
                slotProps={{ input: { "aria-hidden": true } }}
              />
              <ListItemText primary={option.label} disableTypography sx={{ my: 0 }} />
            </MenuItem>
          );
          // Menu 的直接子节点保持为菜单项/分隔线，保留键盘遍历和焦点管理。
          return option.dividerBefore ? [<Divider key={`${option.value}-divider`} />, item] : [item];
        })}
      </Menu>
    </>
  );
}

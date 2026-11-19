import type { ReactNode } from "react";
import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Required for icon-only options. */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (nextValue: T) => void;
  /** Accessible name for the group, e.g. "File type". */
  ariaLabel: string;
  size?: "small" | "medium";
  fullWidth?: boolean;
  disabled?: boolean;
}

/** A single-select segmented control using MUI's built-in button ripple. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "small",
  fullWidth = false,
  disabled = false,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const compact = size === "small";

  if (options.length === 0) return null;

  return (
    <Box
      sx={{
        position: "relative",
        display: fullWidth ? "flex" : "inline-flex",
        boxSizing: "border-box",
        width: fullWidth ? "100%" : "fit-content",
        maxWidth: "100%",
        p: "4px",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "999px",
        bgcolor: "action.hover",
      }}
    >
      <Box
        aria-hidden="true"
        data-testid="segmented-control-indicator"
        sx={{
          position: "absolute",
          top: 4,
          bottom: 4,
          left: 4,
          width: `calc((100% - 8px) / ${options.length})`,
          borderRadius: "999px",
          bgcolor: "primary.main",
          boxShadow: theme.shadows[1],
          pointerEvents: "none",
          opacity: selectedIndex < 0 ? 0 : disabled ? 0.5 : 1,
          transform: `translateX(${Math.max(selectedIndex, 0) * 100}%)`,
          transition: theme.transitions.create(["transform", "opacity"], {
            duration: theme.transitions.duration.standard,
            easing: theme.transitions.easing.easeInOut,
          }),
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      />
      <ToggleButtonGroup
        exclusive
        value={value}
        onChange={(_event, nextValue: T | null) => {
          // MUI returns null when clicking the active option; retain a mandatory selection.
          if (nextValue !== null && nextValue !== value) onChange(nextValue);
        }}
        size={size}
        disabled={disabled}
        aria-label={ariaLabel}
        sx={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
          flex: 1,
          gap: 0,
          minWidth: 0,
          "& .MuiToggleButtonGroup-grouped": {
            margin: "0 !important",
            border: "0 !important",
            borderRadius: "999px !important",
          },
          "& .MuiToggleButton-root": {
            position: "relative",
            overflow: "hidden",
            minWidth: fullWidth ? 0 : compact ? 72 : 84,
            height: compact ? 30 : 36,
            px: compact ? 1.5 : 2,
            py: 0,
            fontSize: compact ? 12 : 13,
            fontWeight: theme.typography.button.fontWeight,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            textTransform: "none",
            color: "text.secondary",
            backgroundColor: "transparent",
            transition: theme.transitions.create(["color", "background-color"], {
              duration: theme.transitions.duration.shorter,
            }),
            "&:hover": {
              color: "text.primary",
              backgroundColor: alpha(theme.palette.primary.main, theme.palette.action.hoverOpacity),
            },
            "&.Mui-selected": {
              color: "primary.contrastText",
              backgroundColor: "transparent",
              "&:hover": {
                backgroundColor: alpha(
                  theme.palette.primary.contrastText,
                  theme.palette.action.hoverOpacity,
                ),
              },
            },
            "&.Mui-disabled": { color: "text.disabled" },
            "&.Mui-focusVisible": {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: -2,
            },
          },
        }}
      >
        {options.map((option) => (
          <ToggleButton
            key={option.value}
            value={option.value}
            aria-label={option.ariaLabel}
            disabled={option.disabled}
            focusRipple
          >
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}

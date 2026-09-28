import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AddBoxRoundedIcon from "@mui/icons-material/AddBoxRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import FindReplaceRoundedIcon from "@mui/icons-material/FindReplaceRounded";
import RemoveCircleRoundedIcon from "@mui/icons-material/RemoveCircleRounded";
import { Box, Button, Card, CardActionArea, Chip, Stack, Typography } from "@mui/material";

import type { RuleDefinition } from "../../types";
import { DEFAULT_RULES } from "./RuleEditor";

interface RulePickerPageProps {
  definitions: RuleDefinition[];
  onBack: () => void;
  onSelect: (type: string) => void;
}

function ruleIcon(type: string) {
  if (type === "replace") return <FindReplaceRoundedIcon />;
  if (type === "remove") return <RemoveCircleRoundedIcon />;
  if (type === "insert") return <AddBoxRoundedIcon />;
  return <AutoFixHighRoundedIcon />;
}

export function RulePickerPage({ definitions, onBack, onSelect }: RulePickerPageProps) {
  const availableRules = definitions.filter(
    (definition) => DEFAULT_RULES[definition.type] !== undefined,
  );

  return (
    <Box component="section" aria-labelledby="rule-picker-title">
      <Button
        startIcon={<ArrowBackRoundedIcon />}
        onClick={onBack}
        sx={{ mb: 2, color: "primary.dark" }}
      >
        返回工作台
      </Button>
      <Stack
        spacing={1.5}
        sx={{ alignItems: "center", mb: 4, pt: 1, textAlign: "center" }}
      >
        <Typography id="rule-picker-title" variant="h4" component="h1" color="textPrimary">
          添加重命名规则
        </Typography>
        <Typography color="textSecondary">
          选择一种规则加入规则链。新规则会添加到当前规则链末尾。
        </Typography>
      </Stack>

      {availableRules.length === 0 ? (
        <Card variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="textSecondary">暂无可添加的规则。</Typography>
        </Card>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 2,
          }}
        >
          {availableRules.map((definition) => (
            <Card key={definition.type} variant="outlined">
              <CardActionArea
                onClick={() => onSelect(definition.type)}
                sx={{ height: "100%", p: 2.5, textAlign: "center" }}
              >
                <Stack spacing={2} sx={{ alignItems: "center" }}>
                  <Box
                    sx={{
                      display: "grid",
                      placeItems: "center",
                      width: 44,
                      height: 44,
                      borderRadius: 2.5,
                      color: "primary.dark",
                      bgcolor: "var(--accent-soft)",
                    }}
                  >
                    {ruleIcon(definition.type)}
                  </Box>
                  <Box sx={{ textAlign: "center" }}>
                    <Typography variant="h6" color="textSecondary">
                      {definition.name}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mt: 0.75 }}>
                      {definition.description}
                    </Typography>
                  </Box>
                  <Chip
                    icon={<AddRoundedIcon />}
                    label="添加"
                    size="small"
                    variant="outlined"
                    sx={{
                      color: "primary.dark",
                      borderColor: "color-mix(in srgb, var(--accent-text) 38%, transparent)",
                      "& .MuiChip-icon": { color: "inherit" },
                    }}
                  />
                </Stack>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}

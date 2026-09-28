import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import { Box, Button, Card, CardActionArea, Chip, Stack, Typography } from "@mui/material";

import type { RuleDefinition } from "../../types";
import { DEFAULT_RULES } from "./RuleEditor";

interface RulePickerPageProps {
  definitions: RuleDefinition[];
  onBack: () => void;
  onSelect: (type: string) => void;
}

export function RulePickerPage({ definitions, onBack, onSelect }: RulePickerPageProps) {
  const availableRules = definitions.filter(
    (definition) => DEFAULT_RULES[definition.type] !== undefined,
  );

  return (
    <Box component="section" aria-labelledby="rule-picker-title">
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack} sx={{ mb: 2 }}>
        返回工作台
      </Button>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography id="rule-picker-title" variant="h4" component="h1">
          添加重命名规则
        </Typography>
        <Typography color="text.secondary">
          选择一种规则加入规则链。新规则会添加到当前规则链末尾。
        </Typography>
      </Stack>

      {availableRules.length === 0 ? (
        <Card variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">暂无可添加的规则。</Typography>
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
                sx={{ height: "100%", p: 2.5, alignItems: "flex-start" }}
              >
                <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
                  <Box
                    sx={{
                      display: "grid",
                      placeItems: "center",
                      width: 44,
                      height: 44,
                      borderRadius: 2.5,
                      color: "primary.main",
                      bgcolor: "rgba(0, 255, 157, 0.12)",
                    }}
                  >
                    <AutoFixHighRoundedIcon />
                  </Box>
                  <Box>
                    <Typography variant="h6">{definition.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                      {definition.description}
                    </Typography>
                  </Box>
                  <Chip icon={<AddRoundedIcon />} label="添加到规则链" size="small" />
                </Stack>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}

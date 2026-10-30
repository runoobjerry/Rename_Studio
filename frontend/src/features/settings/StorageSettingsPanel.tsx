import { translateMessage, type LocalizedMessage, type NotificationMessage } from "../../i18n/messages";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ErrorIcon from "@mui/icons-material/Error";
import Verified from "@mui/icons-material/Verified";
import {
  Alert, Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, MenuItem, Stack, Chip, TextField, Typography, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Skeleton,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createStorage, deleteStorage, disconnectStorage, fetchStorageAuthStatus,
  fetchStorageProviders, fetchStorages, pickLocalFolderDraft, pickStorageFolder,
  startStorageAuth, updateStorage,
} from "../../api/client";
import type { StorageConfigField, StorageInfo, StorageProviderDefinition } from "../../types";
import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { PanelIconButton } from "../../components/PanelIconButton";

const connectionBodySx = {
  "& .MuiInputBase-root, & .MuiInputLabel-root, & .MuiButton-root": {
    fontSize: "body2.fontSize",
  },
  "& .MuiChip-root, & .MuiAlert-message": {
    fontSize: "caption.fontSize",
  },
};

type ConfigDraft = Record<string, string>;

function readConfigDraft(fields: StorageConfigField[], config: StorageInfo["config"]): ConfigDraft {
  return Object.fromEntries(fields.filter((field) => field.target === "config").map((field) => {
    const value = config[field.key];
    return [field.key, typeof value === "string" ? value : ""];
  }));
}

function buildConfig(fields: StorageConfigField[], draft: ConfigDraft): StorageInfo["config"] {
  return Object.fromEntries(fields.filter((field) => field.target === "config").map((field) => {
    const value = (draft[field.key] ?? "").trim();
    return [field.key, field.nullable && !value ? null : value];
  }));
}

function missingRequiredConfig(fields: StorageConfigField[], draft: ConfigDraft): boolean {
  return fields.some((field) => field.target === "config" && field.required && !draft[field.key]?.trim());
}

function secretPayload(fields: StorageConfigField[], secret: string): { client_secret?: string } {
  // 密钥保持顶层只写语义；编辑时留空不提交，交由服务端保留已有凭据。
  return fields.some((field) => field.target === "client_secret") && secret.trim()
    ? { client_secret: secret.trim() } : {};
}

function ConfigFields({ definition, draft, clientSecret, disabled, creating = false, hasClientSecret = false,
  onChange, onSecretChange, onPick }: {
  definition: StorageProviderDefinition;
  draft: ConfigDraft;
  clientSecret: string;
  disabled: boolean;
  creating?: boolean;
  hasClientSecret?: boolean;
  onChange: (key: string, value: string) => void;
  onSecretChange: (value: string) => void;
  onPick: (key: string) => void;
}) {
  const { t } = useTranslation();
  return <>{definition.config_fields.map((field) => {
    const secret = field.target === "client_secret";
    const pickable = definition.local_picker && field.input_type === "directory";
    const key = `providers:${definition.provider_type}.fields.${field.key}`;
    const label = t(creating ? [`${key}.createLabel`, `${key}.label`] : `${key}.label`, { defaultValue: field.key });
    const helpKeys = [`${key}.help`];
    if (creating) helpKeys.unshift(`${key}.createHelp`);
    else if (secret && hasClientSecret) helpKeys.unshift(`${key}.savedHelp`);
    const helpText = t(helpKeys, { defaultValue: "" });
    const input = (
      <TextField key={field.key} variant="standard" size="small"
        label={label}
        type={field.input_type === "password" ? "password" : "text"}
        value={secret ? clientSecret : draft[field.key] ?? ""} disabled={disabled}
        autoComplete={field.input_type === "password" ? "new-password" : undefined}
        helperText={helpText}
        onChange={(event) => secret ? onSecretChange(event.target.value) : onChange(field.key, event.target.value)}
        sx={pickable ? { flex: 1, minWidth: 0 } : undefined} />
    );
    return pickable ? (
      <Stack key={field.key} direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
        {input}
        <Tooltip title={creating ? t("settings:connection.browseDraft") : t("settings:connection.browse")}
          slotProps={{ tooltip: { sx: { fontSize: "caption.fontSize" } } }}>
          <span>
            <PanelIconButton aria-label={t("settings:connection.browse")} disabled={disabled} onClick={() => onPick(field.key)}>
              <FolderOpenIcon />
            </PanelIconButton>
          </span>
        </Tooltip>
      </Stack>
    ) : input;
  })}</>;
}

function ConnectionRow({ storage, executing, definition }: {
  storage: StorageInfo;
  executing: boolean;
  definition: StorageProviderDefinition;
}) {
  const { t } = useTranslation();
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [name, setName] = useState(storage.name);
  const [draft, setDraft] = useState(() => readConfigDraft(definition.config_fields, storage.config));
  const [clientSecret, setClientSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  const [authError, setAuthError] = useState<NotificationMessage>();
  const popup = useRef<Window | null>(null);
  const callbackOrigin = useRef<string>();
  const requiresAuth = definition.browser_auth;
  const status = useQuery({
    queryKey: ["storage-auth", storage.storage_id, storage.revision],
    queryFn: () => fetchStorageAuthStatus(storage.storage_id),
    enabled: requiresAuth,
  });
  useEffect(() => {
    setName(storage.name);
    setDraft(readConfigDraft(definition.config_fields, storage.config));
    setClientSecret("");
  }, [storage.name, storage.config, storage.revision, definition]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["storages"] });
    void queryClient.invalidateQueries({ queryKey: ["storage-auth", storage.storage_id] });
    void queryClient.invalidateQueries({ queryKey: ["files", storage.storage_id] });
  };
  const operation = useMutation({
    gcTime: 0,
    mutationFn: (action: { run: () => Promise<unknown>; message: LocalizedMessage }) => action.run(),
    onSuccess: (_result, action) => {
      setClientSecret("");
      refresh();
      notify(action.message);
    },
    onError: (error) => notify(error, "error"),
  });
  const pick = useMutation({
    mutationFn: (_fieldKey: string) => pickStorageFolder(storage.storage_id),
    onSuccess: (result, fieldKey) => {
      if (!result.selected) return;
      setDraft((current) => ({ ...current, [fieldKey]: result.root_path }));
      refresh();
      notify({ key: "files:notifications.rootSelected" });
    },
    onError: (error) => notify(error, "error"),
  });
  const connect = useMutation({
    mutationFn: () => startStorageAuth(storage.storage_id),
    onSuccess: (result) => {
      callbackOrigin.current = new URL(result.redirect_uri).origin;
      if (popup.current) popup.current.location.href = result.authorization_url;
      setAwaitingAuth(true);
      refresh();
    },
    onError: (error) => {
      popup.current?.close();
      setAuthError(error);
    },
  });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!popup.current || event.source !== popup.current || event.origin !== callbackOrigin.current) return;
      const data: unknown = event.data;
      if (
        typeof data !== "object" || data === null ||
        !("type" in data) || data.type !== "storage-auth" ||
        !("storage_id" in data) || data.storage_id !== storage.storage_id ||
        !("status" in data) || (data.status !== "connected" && data.status !== "failed")
      ) return;
      let message: NotificationMessage = "message" in data && typeof data.message === "string"
        ? data.message : { key: "settings:connection.authFailed" };
      if (data.status === "failed" && "error_code" in data && data.error_code === "STORAGE_ACCOUNT_ALREADY_CONNECTED" &&
        "details" in data && typeof data.details === "object" && data.details !== null &&
        "storage_name" in data.details && typeof data.details.storage_name === "string") {
        message = { key: "settings:connection.accountAlreadyConnected", values: { name: data.details.storage_name } };
      }
      setAwaitingAuth(false);
      popup.current = null;
      setAuthError(data.status === "failed" ? message : undefined);
      if (data.status === "connected") notify({ key: "settings:connection.connectedNotice" });
      refresh();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [storage.storage_id, notify, queryClient]);
  useEffect(() => {
    if (!awaitingAuth) return;
    const timer = window.setInterval(() => {
      if (popup.current?.closed) {
        setAwaitingAuth(false);
        popup.current = null;
        setAuthError({ key: "settings:connection.authClosed" });
        refresh();
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [awaitingAuth]);
  const renaming = executing || storage.busy;
  const busy = renaming || operation.isPending || pick.isPending || connect.isPending || awaitingAuth;
  const isDefault = storage.storage_id === "default-local";
  const requestError = operation.error ?? pick.error ?? connect.error ?? status.error;
  const nameTooLong = Array.from(name.trim()).length > 20;
  const saveDisabled = busy || !name.trim() || nameTooLong || missingRequiredConfig(definition.config_fields, draft);
  const requestErrorMessage = authError !== undefined ? translateMessage(authError, t) : requestError ? errorMessage(requestError, t) : "";
  const save = () => {
    if (nameTooLong) return;
    operation.mutate({
      run: () => updateStorage(storage.storage_id, {
        name: name.trim(),
        config: buildConfig(definition.config_fields, draft),
        ...secretPayload(definition.config_fields, clientSecret),
      }),
      message: { key: "settings:connection.updated" },
    });
  };
  const openEditor = () => {
    setName(storage.name);
    setDraft(readConfigDraft(definition.config_fields, storage.config));
    setClientSecret("");
    operation.reset();
    pick.reset();
    setEditing(true);
  };
  const beginAuthorization = () => {
    popup.current = window.open("about:blank", `storage-auth-${storage.storage_id}`, "popup,width=600,height=720");
    if (!popup.current) {
      setAuthError({ key: "settings:connection.popupBlocked" });
      return;
    }
    setAuthError(undefined);
    connect.mutate();
  };
  const closeEditor = () => {
    if (!busy) {
      setClientSecret("");
      operation.reset();
      setEditing(false);
    }
  };
  const disconnectAccount = () => {
    operation.mutate({
      run: () => disconnectStorage(storage.storage_id),
      message: { key: "settings:connection.signedOut" },
    });
  };
  const deleteConnection = () => {
    operation.mutate({
      run: () => deleteStorage(storage.storage_id),
      message: { key: "settings:connection.updated" },
    }, { onSuccess: () => setEditing(false) });
  };

  let statusLabel: string;
  if (!requiresAuth) {
    statusLabel = t("settings:connection.connected");
  } else if (status.isPending) {
    statusLabel = t("settings:connection.reading");
  } else if (status.error) {
    statusLabel = t("settings:connection.readFailed");
  } else {
    statusLabel = status.data?.connected ? t("settings:connection.connected") : t("settings:connection.disconnected");
  }

  let authTitle: string;
  let authDescription: string;
  if (status.isPending) {
    authTitle = t("settings:connection.authLoading");
    authDescription = t("settings:connection.accountLoading");
  } else if (status.error) {
    authTitle = t("settings:connection.authReadFailed");
    authDescription = t("settings:connection.authReadHelp");
  } else if (status.data?.connected) {
    authTitle = status.data.account_display_name ?? t(`providers:${definition.provider_type}.accountLabel`, { defaultValue: definition.provider_type });
    authDescription = status.data.account_email ?? t("settings:connection.noEmail");
  } else {
    authTitle = t("settings:connection.unauthorized");
    authDescription = t("settings:connection.signInHelp");
  }
  // 图标反映查询状态；操作按钮仍按已有账号数据决定，保留刷新失败时的行为。
  const showVerified = !status.isPending && !status.error && status.data?.connected;
  return <>
    <TableRow hover>
      <TableCell sx={{ maxWidth: 240, overflowWrap: "anywhere", color: "text.primary" }}>{storage.name}</TableCell>
      <TableCell>{t(`providers:${definition.provider_type}.name`, { defaultValue: definition.provider_type })}</TableCell>
      <TableCell>
        <Chip size="small" variant="outlined" color={!requiresAuth || status.data?.connected ? "success" : "default"}
          label={statusLabel} />
        {renaming && (
          <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
            {t("settings:connection.executing")}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">
        <Tooltip title={busy ? t("settings:connection.busyEdit") : t("settings:connection.edit")}
          slotProps={{ tooltip: { sx: { fontSize: "caption.fontSize" } } }}>
          <span>
            <PanelIconButton aria-label={t("settings:connection.editLabel", { name: storage.name })} disabled={busy} onClick={openEditor}>
              <EditIcon />
            </PanelIconButton>
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
    <Dialog open={editing} fullWidth maxWidth="sm" sx={connectionBodySx}
      aria-labelledby={`edit-${storage.storage_id}-title`} onClose={closeEditor}>
      <DialogTitle id={`edit-${storage.storage_id}-title`}>{t("settings:connection.dialogTitle", { name: storage.name })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField variant="standard" label={t("settings:connection.name")} size="small" value={name} disabled={busy}
            error={nameTooLong} helperText={nameTooLong ? t("settings:connection.nameTooLong") : undefined}
            onChange={(event) => setName(event.target.value)} />
          <ConfigFields definition={definition} draft={draft} clientSecret={clientSecret}
            disabled={busy} hasClientSecret={storage.has_client_secret}
            onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
            onSecretChange={setClientSecret} onPick={(key) => pick.mutate(key)} />
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="text" disabled={saveDisabled} onClick={save}>{t("common:save")}</Button>
          </Box>
          {requiresAuth && (
            <>
              <Divider />
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                {showVerified ? (
                  <Verified sx={{ color: "success.main", flexShrink: 0 }} />
                ) : (
                  <ErrorIcon sx={{ color: "warning.main", flexShrink: 0 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                    {authTitle}
                  </Typography>
                  <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                    {authDescription}
                  </Typography>
                </Box>
                {status.data?.connected ? (
                  <Button variant="text" color="error" disabled={busy} sx={{ flexShrink: 0 }}
                    onClick={disconnectAccount}>
                    {t("settings:connection.signOut")}
                  </Button>
                ) : (
                  <Button variant="text" disabled={busy || !status.data?.configured} sx={{ flexShrink: 0 }}
                    onClick={beginAuthorization}>
                    {awaitingAuth ? t("settings:connection.awaitingAuth") : t("settings:connection.signIn")}
                  </Button>
                )}
              </Stack>
            </>
          )}
          {(requestError || authError) && (
            <Alert severity="error">{requestErrorMessage}</Alert>
          )}
          {renaming && (
            <Alert severity="info">{t("settings:connection.busyHelp")}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Tooltip title={isDefault ? t("settings:connection.defaultCannotDelete") : t("settings:connection.deleteHelp")}
          slotProps={{ tooltip: { sx: { fontSize: "caption.fontSize" } } }}>
          <span>
            <Button color="error" disabled={busy || isDefault} onClick={deleteConnection}>{t("common:delete")}</Button>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button disabled={busy} onClick={closeEditor}>{t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  </>;
}

export function StorageSettingsPanel({ executingStorageId }: { executingStorageId?: string }) {
  const { t } = useTranslation();
  const notify = useNotification();
  const queryClient = useQueryClient();
  const storages = useQuery({ queryKey: ["storages"], queryFn: fetchStorages });
  const providers = useQuery({ queryKey: ["storage-providers"], queryFn: fetchStorageProviders });
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<ConfigDraft>({});
  const [clientSecret, setClientSecret] = useState("");
  const [adding, setAdding] = useState(false);
  const create = useMutation({
    gcTime: 0,
    mutationFn: (definition: StorageProviderDefinition) => createStorage({
      provider_type: definition.provider_type, name: name.trim(),
      config: buildConfig(definition.config_fields, draft),
      ...secretPayload(definition.config_fields, clientSecret),
    }),
    onSuccess: () => {
      setName("");
      setDraft({});
      setClientSecret("");
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: ["storages"] });
      notify({ key: "settings:connection.created" });
    },
    onError: (error) => notify(error, "error"),
  });
  const pickDraft = useMutation({
    mutationFn: (_fieldKey: string) => pickLocalFolderDraft(),
    onSuccess: (result, fieldKey) => {
      if (result.selected) setDraft((current) => ({ ...current, [fieldKey]: result.root_path }));
    },
    onError: (error) => notify(error, "error"),
  });
  const addingBusy = create.isPending || pickDraft.isPending;
  const createError = create.error ?? pickDraft.error ?? providers.error;
  const activeProvider = providers.data?.find((definition) => definition.provider_type === provider);
  const nameTooLong = Array.from(name.trim()).length > 20;
  const createDisabled = addingBusy || !activeProvider || providers.isError || !name.trim() || nameTooLong ||
    missingRequiredConfig(activeProvider.config_fields, draft);
  const selectedProvider = activeProvider?.provider_type ?? "";
  const openAddDialog = () => {
    setProvider(providers.data?.[0]?.provider_type ?? "");
    setName("");
    setDraft({});
    setClientSecret("");
    create.reset();
    pickDraft.reset();
    setAdding(true);
  };
  const closeAddDialog = () => {
    if (!addingBusy) {
      setClientSecret("");
      setAdding(false);
    }
  };
  const changeProvider = (providerType: string) => {
    setProvider(providerType);
    setDraft({});
    setClientSecret("");
    pickDraft.reset();
  };
  const saveConnection = () => {
    if (!activeProvider) return;
    if (nameTooLong) return;
    create.mutate(activeProvider);
  };
  return <>
    <Card variant="outlined" sx={connectionBodySx}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, p: { xs: 2, sm: 2.5 } }}>
        <Typography component="h3" variant="body2" sx={{ fontWeight: 500 }}>{t("settings:connection.saved")}</Typography>
        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={openAddDialog}>
          {t("settings:connection.add")}
        </Button>
      </Stack>
      <Divider />
      {storages.error && (
        <Alert severity="error" sx={{ m: 2 }}>{errorMessage(storages.error, t)}</Alert>
      )}
      {providers.error && (
        <Alert severity="error" sx={{ m: 2 }}>{errorMessage(providers.error, t)}</Alert>
      )}
      {storages.isPending ? (
        <Stack sx={{ p: 2 }} spacing={1}>
          <Skeleton height={36} />
          <Skeleton height={36} />
        </Stack>
      ) : (
        <TableContainer>
          <Table
            size="small"
            aria-label={t("settings:connection.saved")}
            sx={{
              minWidth: 500,
              "& th": { color: "text.secondary", fontWeight: 500 },
              "& th, & td": { px: { xs: 2, sm: 2.5 }, py: 1.5, fontSize: "body2.fontSize" },
              "& td": { whiteSpace: "normal" },
              "& tbody tr:last-child td": { borderBottom: 0 },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>{t("settings:connection.name")}</TableCell>
                <TableCell>{t("settings:connection.service")}</TableCell>
                <TableCell>{t("settings:connection.status")}</TableCell>
                <TableCell align="right" aria-label={t("settings:connection.actions")} sx={{ width: 60 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {(storages.data ?? []).map((storage) => {
                const definition = providers.data?.find(
                  (entry) => entry.provider_type === storage.provider_type,
                );
                if (!definition) return (
                  <TableRow key={storage.storage_id}>
                    <TableCell>{storage.name}</TableCell>
                    <TableCell>{storage.provider_type}</TableCell>
                    <TableCell colSpan={2}>
                      <Typography variant="caption" color="text.secondary">{t("settings:connection.definitionPending")}</Typography>
                    </TableCell>
                  </TableRow>
                );
                return (
                  <ConnectionRow key={storage.storage_id} storage={storage}
                    executing={storage.storage_id === executingStorageId} definition={definition} />
                );
              })}
              {storages.isSuccess && storages.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center">{t("settings:connection.empty")}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
    <Dialog open={adding} fullWidth maxWidth="sm" sx={connectionBodySx} aria-labelledby="add-connection-title"
      onClose={closeAddDialog}>
      <DialogTitle id="add-connection-title">{t("settings:connection.add")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField variant="standard" select label={t("settings:connection.type")} size="small" value={selectedProvider}
            disabled={addingBusy} onChange={(event) => changeProvider(event.target.value)}>
            {(providers.data ?? []).map((definition) => (
              <MenuItem key={definition.provider_type} value={definition.provider_type}
                sx={{ fontSize: "body2.fontSize" }}>
                {t(`providers:${definition.provider_type}.name`, { defaultValue: definition.provider_type })}
              </MenuItem>
            ))}
          </TextField>
          <TextField variant="standard" label={t("settings:connection.name")} size="small" value={name} disabled={addingBusy}
            error={nameTooLong} helperText={nameTooLong ? t("settings:connection.nameTooLong") : undefined}
            onChange={(event) => setName(event.target.value)} />
          {activeProvider && (
            <ConfigFields definition={activeProvider} draft={draft} clientSecret={clientSecret}
              disabled={addingBusy} creating
              onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
              onSecretChange={setClientSecret} onPick={(key) => pickDraft.mutate(key)} />
          )}
          {createError && <Alert severity="error">{errorMessage(createError, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button disabled={addingBusy} onClick={closeAddDialog}>{t("common:cancel")}</Button>
        <Button variant="text" disabled={createDisabled} onClick={saveConnection}>{t("settings:connection.save")}</Button>
      </DialogActions>
    </Dialog>
  </>;
}

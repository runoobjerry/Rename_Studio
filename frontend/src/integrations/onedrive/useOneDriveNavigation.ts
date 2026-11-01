import { useEffect, useRef } from "react";
import { ApiError } from "../../api/client";
import { useNotification } from "../../components/NotificationProvider";
import { useRenameStore } from "../../stores/useRenameStore";
import type { useWorkspaceStorage } from "../../workspace/hooks/useWorkspaceStorage";
import { matchOneDriveTarget, NavigationError, registerOneDriveNavigator } from "./navigation";
import { installBrowserBridge } from "./browserBridge";

interface Options {
  storage: ReturnType<typeof useWorkspaceStorage>;
  busy: boolean;
  context: string;
  beforeSwitch: () => void;
}

export function useOneDriveNavigation(options: Options) {
  const notify = useNotification();
  const latest = useRef(options);
  latest.current = options;
  const unknown = useRenameStore((state) => state.unknownExecution);
  useEffect(() => {
    if (options.busy || useRenameStore.getState().unknownExecution) options.storage.cancelExternalNavigation();
  }, [options.busy, unknown, options.storage.cancelExternalNavigation]);
  useEffect(() => {
    return () => latest.current.storage.cancelExternalNavigation();
  }, [options.context]);
  useEffect(() => registerOneDriveNavigator(async (request, onAccepted) => {
    const rejected = (code: string) => ({ version: 1 as const, request_id: request.request_id,
      status: "rejected" as const, code });
    const guard = () => {
      if (useRenameStore.getState().unknownExecution) throw new NavigationError("outcome_unresolved");
      const { storage, busy } = latest.current;
      if (busy || storage.activeStorage?.busy) throw new NavigationError("busy");
    };
    try {
      guard();
      const { storage } = latest.current;
      if (!storage.providers.isSuccess || !storage.providerDefinitions.isSuccess) throw new NavigationError("busy");
      const target = matchOneDriveTarget(request, storage.providers.data, storage.providerDefinitions.data);
      const result = storage.openExternalTarget(target, () => latest.current.beforeSwitch(), guard);
      onAccepted?.({ version: 1, request_id: request.request_id, status: "accepted" });
      await result;
      notify({ key: "files:externalNavigation.opened" });
      return { version: 1, request_id: request.request_id, status: "opened", storage_id: target.storage.storage_id };
    } catch (error) {
      let code: string;
      if (error instanceof NavigationError) code = error.code;
      else if (error instanceof ApiError) code = error.code ?? "provider_error";
      else if (error instanceof Error && "status" in error && error.status === 0) code = "network_error";
      else throw error;
      notify({ key: code === "outcome_unresolved" ? "files:verification.required" : "files:externalNavigation.rejected",
        values: { code } }, "warning");
      return rejected(code);
    }
  }), [notify]);
  useEffect(() => installBrowserBridge((code) => {
    notify({ key: code === "result_timeout" ? "files:externalNavigation.unconfirmed" : "files:externalNavigation.rejected",
      values: { code } }, "warning");
  }), [notify]);
}

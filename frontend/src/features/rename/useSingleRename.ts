import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateMessage, type NotificationMessage } from "../../i18n/messages";
import { useRenameStore } from "../../stores/useRenameStore";
import type { ExecuteResponse, FileItem, StorageLocation } from "../../types";
import type { ExecutionInput } from "./useRenameExecution";

interface SingleRenameTarget {
  file: FileItem;
  name: string;
  extension: string;
  workspaceSession: string;
  revision: number;
  taskId?: string;
}

interface SingleRenameOptions {
  storageId: string;
  location: StorageLocation;
  workspaceSession: string;
  revision?: number;
  taskId?: string;
  selectedFile?: FileItem;
  directoryKey: readonly unknown[];
  canStart: boolean;
  isCurrentSession: (session: string) => boolean;
  execute: (input: ExecutionInput) => Promise<ExecuteResponse>;
  invalidateBatchPreview: () => void;
}

export function useSingleRename({ storageId, location, workspaceSession, revision, taskId, selectedFile, directoryKey,
  canStart, isCurrentSession, execute, invalidateBatchPreview }: SingleRenameOptions) {
  const { t } = useTranslation();
  const setPreviewActive = useRenameStore((state) => state.setPreviewActive);
  const unknownExecution = useRenameStore((state) => state.unknownExecution);
  const [singleTarget, setSingleTarget] = useState<SingleRenameTarget | null>(null);
  const [singleError, setSingleError] = useState<NotificationMessage | null>(null);
  const singlePending = useRef(false);
  const isPending = useCallback(() => singlePending.current, []);
  const reset = useCallback(() => {
    setSingleTarget(null);
    setSingleError(null);
  }, []);

  const singleRename = useMutation({
    gcTime: 0,
    mutationFn: async (input: { target: SingleRenameTarget; targetName: string; storageId: string;
      location: StorageLocation; directoryKey: readonly unknown[] }): Promise<ExecuteResponse> => {
      const operationId = crypto.randomUUID();
      const file = input.target.file;
      return execute({
        // 仅用于失败核对与结果展示，不作为预览或待执行项提交给服务端。
        source: { storageId: input.storageId, preview_id: operationId, items: [{
          file_id: file.id, original_name: file.name, new_name: input.targetName,
          changed: true, valid: true, conflict: false, error: null,
        }] },
        workspaceSession: input.target.workspaceSession, taskId: input.target.taskId,
        directoryKey: input.directoryKey, single: true,
        request: { operation_id: operationId, file_id: file.id, original_name: file.name,
          target_name: input.targetName, location: input.location, revision: input.target.revision },
      });
    },
    onSuccess: (result, input) => {
      if (!isCurrentSession(input.target.workspaceSession)) return;
      if (useRenameStore.getState().unknownExecution) {
        setSingleError({ key: "files:notifications.verifyBeforeRetry" });
        return;
      }
      const item = result.items[0];
      if (result.status === "completed" && item.status === "renamed") {
        setSingleTarget(null);
        if (!useRenameStore.getState().task) setPreviewActive(false);
      } else {
        setSingleError(item.error ?? { key: "files:quickRename.failed" });
        if (item.current_file) setSingleTarget({ ...input.target, file: item.current_file });
      }
    },
    onError: (error, input) => {
      if (isCurrentSession(input.target.workspaceSession)) {
        setSingleError(useRenameStore.getState().unknownExecution
          ? { key: "files:notifications.unknownOutcome", error } : error);
      }
    },
    onSettled: () => {
      singlePending.current = false;
    },
  });
  const canSingleRename = canStart && !singleRename.isPending;

  useEffect(() => {
    if (singlePending.current || !singleTarget) return;
    if (singleTarget.workspaceSession !== workspaceSession || singleTarget.taskId !== taskId ||
      !selectedFile || selectedFile.id !== singleTarget.file.id) {
      setSingleTarget(null);
      setSingleError(null);
      if (!taskId && !unknownExecution) setPreviewActive(false);
    }
  }, [singleTarget, workspaceSession, taskId, unknownExecution, selectedFile, singleRename.isPending, setPreviewActive]);

  const openSingleRename = (fileId: string) => {
    if (!canSingleRename || singlePending.current || selectedFile!.id !== fileId) return;
    const file = selectedFile!;
    const dot = file.is_directory ? -1 : file.name.lastIndexOf(".");
    const extension = dot > 0 ? file.name.slice(dot) : "";
    setSingleTarget({ file: structuredClone(file), name: extension ? file.name.slice(0, dot) : file.name,
      extension, workspaceSession, revision: revision!, taskId });
    setSingleError(null);
    setPreviewActive(true);
  };
  const closeSingleRename = () => {
    if (singlePending.current) return;
    setSingleTarget(null);
    setSingleError(null);
    if (!taskId && !unknownExecution) setPreviewActive(false);
  };
  const applySingleRename = (name: string, extension: string) => {
    if (!singleTarget || singleTarget.workspaceSession !== workspaceSession || !canSingleRename ||
      singlePending.current || !name.trim()) return;
    const targetName = name + (singleTarget.file.is_directory ? "" : extension);
    if (targetName === singleTarget.file.name) return;
    // ref 同步拦截同一事件中的重复提交；打开和取消编辑均不触碰批量预览。
    singlePending.current = true;
    setSingleError(null);
    invalidateBatchPreview();
    singleRename.mutate({ target: singleTarget, targetName, storageId, location,
      directoryKey });
  };

  return {
    singleRenameTarget: singleTarget?.workspaceSession === workspaceSession ? singleTarget : null,
    singleRenameError: singleError ? translateMessage(singleError, t) : undefined,
    canSingleRename, isSingleRenaming: singleRename.isPending,
    openSingleRename, closeSingleRename, applySingleRename,
    isPending, reset,
  };
}

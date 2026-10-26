import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { errorMessage, translateMessage, type NotificationMessage } from "../../i18n/messages";
import { ApiError, executeStorageSingleRename } from "../../api/client";
import { useNotification } from "../../components/NotificationProvider";
import { useRenameStore } from "../../stores/useRenameStore";
import type { DirectoryListing, FileItem, SingleRenameExecuteResponse, StorageLocation } from "../../types";

interface SingleRenameTarget {
  file: FileItem;
  name: string;
  extension: string;
  workspaceSession: string;
  revision: number;
  taskId?: string;
}

type SingleRenameError = NotificationMessage | { message: string; code?: string | null };

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
  invalidateBatchPreview: () => void;
}

export function useSingleRename({ storageId, location, workspaceSession, revision, taskId, selectedFile, directoryKey,
  canStart, isCurrentSession, invalidateBatchPreview }: SingleRenameOptions) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useNotification();
  const setPreviewActive = useRenameStore((state) => state.setPreviewActive);
  const unknownExecution = useRenameStore((state) => state.unknownExecution);
  const [singleTarget, setSingleTarget] = useState<SingleRenameTarget | null>(null);
  const [singleError, setSingleError] = useState<SingleRenameError | null>(null);
  const singlePending = useRef(false);
  const isPending = useCallback(() => singlePending.current, []);
  const reset = useCallback(() => {
    setSingleTarget(null);
    setSingleError(null);
  }, []);

  const singleRename = useMutation({
    gcTime: 0,
    mutationFn: async (input: { target: SingleRenameTarget; targetName: string; storageId: string;
      operationId: string; location: StorageLocation; directoryKey: readonly unknown[] }): Promise<SingleRenameExecuteResponse> => {
      const file = input.target.file;
      return executeStorageSingleRename(input.storageId, {
        operation_id: input.operationId, file_id: file.id, original_name: file.name,
        target_name: input.targetName, location: input.location, revision: input.target.revision,
      });
    },
    onSuccess: (result, input) => {
      const outcome = result.items.find((item) => item.file_id === input.target.file.id);
      if (!outcome) {
        recordUnknown(input, result.operation_id);
        if (isCurrentSession(input.target.workspaceSession)) {
          setSingleError({ key: "files:notifications.verifyBeforeRetry" });
        }
        return;
      }
      const metadata = outcome.current_file;
      // Display paths come from the browse context; success and identity come from the Provider.
      const parentPath = metadata?.parent_path ?? input.target.file.parent_path;
      const current: FileItem | undefined = metadata ? {
        ...metadata, parent_path: parentPath,
        path: metadata.path ?? (parentPath ? `${parentPath}/${metadata.name}` : metadata.name),
      } : undefined;
      const item = { ...outcome, current_file: current };
      const unknown = (item.status === "renamed" && !item.current_file) ||
        (item.status === "failed" && (item.error_code === "RENAME_OUTCOME_UNKNOWN" ||
          (item.actual_name != null && item.actual_name !== item.original_name && !item.current_file)));
      if (unknown) recordUnknown(input, result.operation_id);
      if (current) {
        queryClient.setQueryData<DirectoryListing>(input.directoryKey, (listing) => listing && {
          ...listing, items: listing.items.map((file) => file.id === input.target.file.id ? current : file),
        });
      }
      if (!isCurrentSession(input.target.workspaceSession)) return;
      const store = useRenameStore.getState();
      if (input.target.taskId) store.applyTaskResults(input.target.taskId, { items: [item] });
      if (current) store.setSelectedIds(store.selectedIds.map((id) =>
        id === input.target.file.id ? current.id : id));
      if (unknown) {
        setSingleError({ key: "files:notifications.verifyBeforeRetry" });
        return;
      }
      if (result.status === "completed" && item.status === "renamed") {
        setSingleTarget(null);
        if (!store.task) setPreviewActive(false);
        notify({ key: "files:notifications.completed", values: { count: 1 } }, "success");
      } else {
        setSingleError(item.error ? { message: item.error, code: item.error_code } : { key: "files:quickRename.failed" });
        if (item.current_file) setSingleTarget({ ...input.target, file: item.current_file });
      }
    },
    onError: (error, input) => {
      // 明确的请求拒绝可直接显示；丢失响应与 5xx 无法证明未写入。
      if (!(error instanceof ApiError && error.status >= 400 && error.status < 500)) recordUnknown(input, input.operationId);
      if (isCurrentSession(input.target.workspaceSession)) {
        setSingleError(useRenameStore.getState().unknownExecution
          ? { key: "files:notifications.unknownOutcome", error } : error);
      }
    },
    onSettled: () => {
      singlePending.current = false;
    },
  });
  const canSingleRename = canStart && !singleRename.isPending &&
    !(singleError && typeof singleError === "object" && "code" in singleError && singleError.code === "NOT_FOUND");

  function recordUnknown(input: { target: SingleRenameTarget; targetName: string; storageId: string }, operationId: string) {
    // 核对展示复用公共记录格式，单项操作本身不创建预览。
    useRenameStore.getState().setUnknownExecution({
      storageId: input.storageId, previewId: operationId, items: [{
        file_id: input.target.file.id, original_name: input.target.file.name, new_name: input.targetName,
        changed: true, valid: true, conflict: false, error: null,
      }],
    });
  }

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
    singleRename.mutate({ target: singleTarget, targetName, storageId, location, operationId: crypto.randomUUID(),
      directoryKey });
  };

  return {
    singleRenameTarget: singleTarget?.workspaceSession === workspaceSession ? singleTarget : null,
    singleRenameError: singleError ? typeof singleError === "object" && "message" in singleError
      ? errorMessage(singleError, t) : translateMessage(singleError, t) : undefined,
    canSingleRename, isSingleRenaming: singleRename.isPending,
    openSingleRename, closeSingleRename, applySingleRename,
    isPending, reset,
  };
}

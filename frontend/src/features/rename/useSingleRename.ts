import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { errorMessage, translateMessage, type NotificationMessage } from "../../i18n/messages";
import { ApiError, executeStorageSingleRename } from "../../api/client";
import { isInDirectory } from "../files/directoryIdentity";
import { useNotification } from "../../components/NotificationProvider";
import { hasPendingRename, useRenameStore } from "../../stores/useRenameStore";
import type { PendingRenameRecord } from "./renameRecord";
import type { DirectoryListing, FileItem, SingleRenameExecuteResponse, StorageLocation } from "../../types";

interface SingleRenameTarget {
  file: FileItem;
  name: string;
  extension: string;
  workspaceSession: string;
  revision: number;
}

type SingleRenameError = NotificationMessage | { message: string; code?: string | null; details?: Record<string, unknown>; operation?: "read" | "write" };

interface SingleRenameInput {
  target: SingleRenameTarget;
  record: PendingRenameRecord;
  directoryKey: readonly unknown[];
}

interface SingleRenameOptions {
  storageId: string;
  location: StorageLocation;
  workspaceSession: string;
  revision?: number;
  selectedFile?: FileItem;
  directoryKey: readonly unknown[];
  canStart: boolean;
  isCurrentSession: (session: string) => boolean;
  invalidateBatchPreview: () => void;
}

export function useSingleRename({ storageId, location, workspaceSession, revision, selectedFile, directoryKey,
  canStart, isCurrentSession, invalidateBatchPreview }: SingleRenameOptions) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useNotification();
  const [singleTarget, setSingleTarget] = useState<SingleRenameTarget | null>(null);
  const [singleError, setSingleError] = useState<SingleRenameError | null>(null);
  const reset = useCallback(() => {
    setSingleTarget(null);
    setSingleError(null);
  }, []);

  const singleRename = useMutation({
    gcTime: 0,
    mutationFn: async ({ record, directoryKey }: SingleRenameInput): Promise<SingleRenameExecuteResponse> => {
      await queryClient.cancelQueries({ queryKey: directoryKey, exact: true });
      const [item] = record.items;
      return executeStorageSingleRename(record.storageId, {
        operation_id: record.operationId, file_id: item.before.id, original_name: item.before.name,
        target_name: item.targetName, location: record.location, revision: record.revision,
      });
    },
    onSuccess: (result, input) => {
      const outcome = result.items.find((item) => item.file_id === input.target.file.id);
      const unknown = !outcome || outcome.status === "unknown" || (outcome.status === "renamed" && !outcome.current_file);
      if (unknown) recordUnknown(input, result.operation_id);
      useRenameStore.getState().settleRenameRecord(input.record, result.items);
      if (!isCurrentSession(input.target.workspaceSession)) {
        void queryClient.invalidateQueries({ queryKey: input.directoryKey, exact: true, refetchType: "none" });
        return;
      }
      if (!outcome) {
        setSingleError({ key: "files:verification.required" });
        return;
      }
      const metadata = outcome.current_file;
      const listing = queryClient.getQueryData<DirectoryListing>(input.directoryKey);
      const membership = metadata ? isInDirectory(listing, metadata) : null;
      const missingFile = outcome.status === "failed" && outcome.error_code === "NOT_FOUND";
      // Only reuse browse paths after confirming the file still belongs to this directory.
      const parentPath = metadata?.parent_path ?? input.target.file.parent_path;
      const current: FileItem | undefined = metadata && membership === true ? {
        ...metadata, parent_path: parentPath,
        path: metadata.path ?? (parentPath ? `${parentPath}/${metadata.name}` : metadata.name),
      } : undefined;
      if (missingFile || metadata) {
        queryClient.setQueryData<DirectoryListing>(input.directoryKey, (listing) => listing && {
          ...listing, items: listing.items.flatMap((file) => {
            if (file.id !== input.target.file.id) return [file];
            return current && !missingFile ? [current] : [];
          }),
        });
        if (metadata && membership === null) {
          // 恢复自动查询后重新确认目录归属。
          void queryClient.invalidateQueries({ queryKey: input.directoryKey, exact: true, refetchType: "none" });
        }
      }
      const store = useRenameStore.getState();
      if (metadata || missingFile) store.setSelectedIds(store.selectedIds.flatMap((id) => {
        if (id !== input.target.file.id) return [id];
        return current && !missingFile ? [current.id] : [];
      }));
      if (unknown) {
        setSingleError({ key: "files:verification.required" });
        return;
      }
      if (outcome.status === "renamed") {
        reset();
        notify(membership === false ? { key: "files:notifications.renamedElsewhere" }
          : { key: "files:notifications.completed", values: { count: 1 } }, "success");
      } else {
        setSingleError(outcome.error_code || outcome.error ? { message: outcome.error ?? "", code: outcome.error_code, details: outcome.details ?? undefined, operation: "write" } : { key: "files:quickRename.failed" });
        if (current) setSingleTarget({ ...input.target, file: current });
      }
    },
    onError: (error, input) => {
      // 服务端逐文件返回 Provider 错误，带错误码的 4xx 请求拒绝发生在写入前。
      const rejected = error instanceof ApiError && (error.details.execution_started === false ||
        (error.code !== null && error.status >= 400 && error.status < 500));
      if (!rejected) recordUnknown(input, input.record.operationId);
      useRenameStore.getState().settleRenameRecord(input.record, rejected ? null : []);
      if (isCurrentSession(input.target.workspaceSession)) {
        setSingleError(rejected ? error : { key: "files:verification.required", error });
      }
    },
  });
  const isMissingFile = Boolean(singleError && typeof singleError === "object" &&
    "code" in singleError && singleError.code === "NOT_FOUND");
  const canSingleRename = canStart && !singleRename.isPending && !isMissingFile;

  function recordUnknown({ record }: SingleRenameInput, operationId: string) {
    const [item] = record.items;
    // 核对展示复用预览行格式，单项操作本身不创建预览。
    useRenameStore.getState().setUnknownExecution({
      storageId: record.storageId, location: record.location, previewId: operationId, items: [{
        file_id: item.before.id, original_name: item.before.name, new_name: item.targetName,
        changed: true, valid: true, conflict: false, error: null,
      }],
    });
  }

  useEffect(() => {
    if (singleRename.isPending || !singleTarget) return;
    // NOT_FOUND clears selection on receipt; keep its error visible until the user dismisses it.
    if (singleTarget.workspaceSession !== workspaceSession ||
      (!isMissingFile && (!selectedFile || selectedFile.id !== singleTarget.file.id || selectedFile.name !== singleTarget.file.name))) {
      reset();
    }
  }, [singleTarget, workspaceSession, selectedFile, isMissingFile, singleRename.isPending, reset]);

  const openSingleRename = (fileId: string) => {
    if (!canSingleRename || hasPendingRename() || selectedFile!.id !== fileId) return;
    const file = selectedFile!;
    const dot = file.is_directory ? -1 : file.name.lastIndexOf(".");
    const extension = dot > 0 ? file.name.slice(dot) : "";
    setSingleTarget({ file: structuredClone(file), name: extension ? file.name.slice(0, dot) : file.name,
      extension, workspaceSession, revision: revision! });
    setSingleError(null);
  };
  const closeSingleRename = () => {
    if (hasPendingRename() || singleRename.isPending) return;
    reset();
  };
  const applySingleRename = (name: string, extension: string) => {
    if (!singleTarget || singleTarget.workspaceSession !== workspaceSession || !canSingleRename ||
      selectedFile?.id !== singleTarget.file.id || selectedFile.name !== singleTarget.file.name ||
      !name.trim()) return;
    const targetName = name + (singleTarget.file.is_directory ? "" : extension);
    if (targetName === singleTarget.file.name) return;
    const { file, revision } = singleTarget;
    const record = useRenameStore.getState().startRenameRecord({
      operationId: crypto.randomUUID(), kind: "single", storageId, revision, location,
      items: [{ before: { id: file.id, name: file.name }, targetName }],
    });
    if (!record) return;
    // 只有实际提交才作废批量预览。
    setSingleError(null);
    invalidateBatchPreview();
    singleRename.mutate({ target: singleTarget, record, directoryKey });
  };

  return {
    singleRenameTarget: singleTarget?.workspaceSession === workspaceSession ? singleTarget : null,
    singleRenameError: singleError ? typeof singleError === "object" && "message" in singleError
      ? errorMessage(singleError, t, "singleRename") : translateMessage(singleError, t) : undefined,
    canSingleRename, isSingleRenaming: singleRename.isPending,
    openSingleRename, closeSingleRename, applySingleRename,
    reset,
  };
}

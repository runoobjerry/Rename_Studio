import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, createStoragePreview, releaseStoragePreview } from "../../api/client";
import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { hasPendingRename, useRenameStore, type UnknownExecution } from "../../stores/useRenameStore";
import { sortFileItems, type FileSort } from "../files/fileSort";
import { useRenameExecution } from "./useRenameExecution";
import { useSingleRename } from "./useSingleRename";
import type { DirectoryListing, RuleSpec, StorageInfo, StorageLocation } from "../../types";

function releasePreview(storageId: string, previewId: string) {
  void releaseStoragePreview(storageId, previewId).catch(() => {
    // 清理失败由服务端过期回收兜底，无需打扰用户。
  });
}

interface RenameWorkflowOptions {
  storageId: string;
  location: StorageLocation;
  workspaceKey: string;
  cloudSession: string | null;
  locationReady: boolean;
  canRename: boolean;
  activeStorage?: Pick<StorageInfo, "revision" | "busy">;
  sort: FileSort;
  onSortChange: (sort: FileSort) => void;
  files: {
    data: DirectoryListing | undefined;
    isSuccess: boolean;
    isFetching: boolean;
    error: Error | null;
    dataUpdatedAt: number;
  };
}

export function useRenameWorkflow({
  storageId, location, workspaceKey, cloudSession, locationReady, canRename, activeStorage, files, sort, onSortChange,
}: RenameWorkflowOptions) {
  const { t } = useTranslation();
  const notify = useNotification();
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  const clearSelection = useRenameStore((state) => state.clearSelection);
  const unknownExecution = useRenameStore((state) => state.unknownExecution);
  const [retainedUnknownOutcome, setRetainedUnknownOutcome] = useState<UnknownExecution | null>(null);
  const pendingRenameRecord = useRenameStore((state) => state.pendingRenameRecord);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const workspaceSession = JSON.stringify([workspaceKey, cloudSession]);
  const browserItems = useMemo(() => sortFileItems(files.data?.items ?? [], sort), [files.data, sort]);
  const renamableFiles = useMemo(() => browserItems.filter((item) => item.can_rename !== false), [browserItems]);
  const selectedFiles = useMemo(() => {
    const selected = new Set(selectedIds);
    return renamableFiles.filter((item) => selected.has(item.id));
  }, [renamableFiles, selectedIds]);
  const previewContext = useMemo(() => JSON.stringify([workspaceSession, selectedFiles.map(({ id, name }) => [id, name]), rules, sort]),
    [workspaceSession, selectedFiles, rules, sort]);
  const currentSession = useRef(workspaceSession);
  currentSession.current = workspaceSession;
  const isCurrentSession = useCallback((session: string) => mounted.current && session === currentSession.current, []);
  const currentWorkspace = useRef(previewContext);
  const previewVersion = useRef(0);
  // 同一文件 ID 的名称也会变化。版本递增后，即使输入改回原值也不能恢复旧预览。
  if (currentWorkspace.current !== previewContext) {
    currentWorkspace.current = previewContext;
    previewVersion.current++;
  }
  const invalidatePreviewForChanges = useCallback(() => { previewVersion.current++; }, []);
  // 界面 reset 不应丢失待释放 ID；规则和选择变化后仍可替代旧快照。
  const retainedPreview = useRef<{ storageId: string; previewId: string } | null>(null);
  const releaseRetainedPreview = useCallback(() => {
    const retained = retainedPreview.current;
    retainedPreview.current = null;
    if (retained) {
      releasePreview(retained.storageId, retained.previewId);
    }
  }, []);
  useEffect(() => releaseRetainedPreview, [releaseRetainedPreview]);
  const preview = useMutation({
    mutationKey: ["rename-preview"],
    gcTime: 0,
    mutationFn: async (input: { version: number; previousId?: string;
      storageId: string; location: StorageLocation; fileIds: string[]; fileNames: Map<string, string>; rules: RuleSpec[] }) => {
      const { previousId } = input;
      const result = previousId
        ? await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules, previousId)
        : await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules);
      return { ...result, version: input.version };
    },
    onSuccess: (result, input) => {
      if (!mounted.current || input.version !== previewVersion.current) {
        if (retainedPreview.current?.previewId === input.previousId) retainedPreview.current = null;
        releasePreview(input.storageId, result.preview_id);
        return;
      }
      retainedPreview.current = { storageId: input.storageId, previewId: result.preview_id };
    },
  });
  const execution = useRenameExecution(isCurrentSession);
  const invalidateBatchPreview = useCallback(() => {
    invalidatePreviewForChanges();
    releaseRetainedPreview();
    setRetainedUnknownOutcome(null);
    preview.reset();
    execution.reset();
  }, [invalidatePreviewForChanges, releaseRetainedPreview, preview.reset, execution.reset]);
  const { reset: resetSingleRename, ...singleRename } = useSingleRename({
    storageId, location, workspaceSession, revision: activeStorage?.revision,
    selectedFile: locationReady && selectedFiles.length === 1 ? selectedFiles[0] : undefined,
    directoryKey: ["files", storageId, activeStorage?.revision, location],
    canStart: canRename && locationReady && Boolean(activeStorage) && !activeStorage?.busy &&
      files.isSuccess && !files.isFetching && !files.error && !preview.isPending && !execution.isPending &&
      !unknownExecution && !pendingRenameRecord && selectedFiles.length === 1,
    isCurrentSession, invalidateBatchPreview,
  });
  const isExecuting = Boolean(pendingRenameRecord) || execution.isPending || singleRename.isSingleRenaming;
  const previousSession = useRef<string | null>(null);
  const isCurrentWorkspace = previousSession.current === workspaceSession;
  const batchExecution = isCurrentWorkspace ? execution : undefined;
  // 忽略迟到响应。已接收的预览可继续展示，输入变化后只能重新预览。
  const acceptedPreview = preview.data?.preview_id === retainedPreview.current?.previewId ? preview.data : undefined;
  const previewData = !isCurrentWorkspace || !acceptedPreview ? undefined
    : acceptedPreview.version === previewVersion.current ? acceptedPreview : { ...acceptedPreview, valid: false };

  const resetForStorageChange = useCallback(() => {
    clearSelection();
    invalidateBatchPreview();
    resetSingleRename();
  }, [clearSelection, invalidateBatchPreview, resetSingleRename]);

  useEffect(() => {
    if (isExecuting || previousSession.current === workspaceSession) return;
    previousSession.current = workspaceSession;
    resetForStorageChange();
  }, [workspaceSession, isExecuting, resetForStorageChange]);

  useEffect(() => {
    // 刷新失败时保留选择；成功读取后移除消失或已明确不能改名的项，不自动选择新增项。
    // 单项结果会同时更新缓存和选择；等待整条请求结束，避免中间渲染误删新 ID。
    if (!files.isSuccess || !locationReady || singleRename.isSingleRenaming ||
      useRenameStore.getState().pendingRenameRecord?.kind === "single") return;
    if (selectedFiles.length === selectedIds.length) return;
    setSelectedIds(selectedFiles.map((item) => item.id));
  }, [files.isSuccess, files.dataUpdatedAt, locationReady, selectedFiles, selectedIds.length,
    setSelectedIds, singleRename.isSingleRenaming]);
  const requestPreview = () => {
    if (!canRename || !locationReady || !isCurrentWorkspace || !files.data || files.isFetching || files.error || isExecuting || hasPendingRename() || preview.isPending || activeStorage?.busy) return;
    const unknown = useRenameStore.getState().unknownExecution;
    if (unknown) {
      notify({ key: "files:verification.required" }, "warning");
      return;
    }
    const state = useRenameStore.getState();
    const selected = new Set(state.selectedIds);
    const targets = renamableFiles.filter((item) => selected.has(item.id));
    if (!targets.length) return;
    resetSingleRename();
    execution.reset();
    setRetainedUnknownOutcome(null);
    const contextKey = JSON.stringify([workspaceSession, targets.map(({ id, name }) => [id, name]), state.rules, sort]);
    currentWorkspace.current = contextKey;
    const fileIds = targets.map((item) => item.id);
    const fileNames = new Map(targets.map((item) => [item.id, item.name]));
    const retained = retainedPreview.current;
    const previousId = retained?.storageId === storageId ? retained.previewId : undefined;
    preview.mutate({ version: ++previewVersion.current, previousId,
      storageId, location, fileIds, fileNames, rules: state.rules });
  };

  const resetOperation = () => {
    if (!isExecuting && !hasPendingRename() && !preview.isPending) resetForStorageChange();
  };
  const onDirectoryRead = (unknown: UnknownExecution) => {
    if (hasPendingRename() || !isCurrentSession(workspaceSession) ||
      useRenameStore.getState().unknownExecution !== unknown || unknown.storageId !== storageId ||
      JSON.stringify(unknown.location) !== JSON.stringify(location)) return;
    // 解锁后保留旧结果供查看，旧预览继续失效。
    invalidatePreviewForChanges();
    setRetainedUnknownOutcome(unknown);
    resetSingleRename();
    useRenameStore.getState().setUnknownExecution(null);
  };
  const changeSelection = useCallback((update: () => void) => {
    if (isExecuting || hasPendingRename()) return;
    update();
    invalidatePreviewForChanges();
  }, [isExecuting, invalidatePreviewForChanges]);
  const toggleFile = useCallback((fileId: string) => {
    changeSelection(() => toggleSelected(fileId));
  }, [changeSelection, toggleSelected]);
  const selectAllFiles = useCallback((ids: string[]) => {
    changeSelection(() => setSelectedIds(ids));
  }, [changeSelection, setSelectedIds]);
  const clearFiles = useCallback(() => {
    changeSelection(clearSelection);
  }, [changeSelection, clearSelection]);
  const invertFiles = useCallback((ids: string[]) => {
    changeSelection(() => {
      const selected = new Set(useRenameStore.getState().selectedIds);
      setSelectedIds(ids.filter((id) => !selected.has(id)));
    });
  }, [changeSelection, setSelectedIds]);

  const onRulesChange = (nextRules: RuleSpec[]) => {
    if (isExecuting || hasPendingRename()) return;
    setRules(nextRules);
    invalidatePreviewForChanges();
  };

  const changeSort = useCallback((nextSort: FileSort) => {
    if (isExecuting || hasPendingRename()) return;
    onSortChange(nextSort);
    invalidatePreviewForChanges();
  }, [isExecuting, onSortChange, invalidatePreviewForChanges]);

  const executeRename = (previewId: string) => {
    // 已消费或结果未知的预览不能在同一页面重放；再次改名必须创建新预览。
    if (!canRename || !locationReady || files.isFetching || files.error || preview.isPending ||
      isExecuting || execution.variables?.record.operationId === previewId ||
      !activeStorage || activeStorage.busy || previewData?.version !== previewVersion.current || previewData?.preview_id !== previewId || !previewData.valid) return;
    const record = useRenameStore.getState().startRenameRecord({
      operationId: previewId, kind: "batch", storageId, revision: activeStorage.revision, location,
      items: previewData.items.map((item) => ({
        before: { id: item.file_id, name: item.original_name }, targetName: item.new_name,
      })),
    });
    if (!record) return;
    execution.mutate({ previewItems: previewData.items, record, workspaceSession,
      directoryKey: ["files", storageId, activeStorage.revision, location] });
  };

  let previewError: string | undefined;
  if (preview.variables?.version === previewVersion.current && preview.error) {
    previewError = errorMessage(preview.error, t);
    if (preview.error instanceof ApiError && preview.error.code === "VALIDATION_ERROR") {
      const fileIds = preview.error.details.file_ids;
      if (Array.isArray(fileIds)) {
        const fileNames = preview.variables.fileNames;
        const names = fileIds.flatMap((id: unknown) => {
          const name = typeof id === "string" ? fileNames.get(id) : undefined;
          return name === undefined ? [] : [name];
        });
        if (names.length) previewError += `\n${names.map((name) => `• ${name}`).join("\n")}`;
      }
    }
  }

  const revalidationError = batchExecution?.error instanceof ApiError && batchExecution.error.details.execution_started === false
    ? errorMessage(batchExecution.error, t) : undefined;

  return {
    selectedIds, rules, browserItems, changeSort,
    selectedCount: selectedFiles.length,
    previewData, executionData: batchExecution?.data,
    displayedUnknownOutcome: unknownExecution ?? (isCurrentWorkspace ? retainedUnknownOutcome : null),
    previewError,
    revalidationError,
    executeError: batchExecution?.error ? unknownExecution?.previewId === batchExecution.variables?.record.operationId
      ? t("files:verification.required") : errorMessage(batchExecution.error, t) : undefined,
    executionPreviewId: batchExecution?.variables?.record.operationId,
    isPreviewing: preview.isPending, isExecuting, hasExecuted: Boolean(batchExecution?.data),
    ...singleRename,
    requestPreview, executeRename, onRulesChange,
    resetOperation, toggleFile, selectAllFiles, clearFiles, invertFiles,
    resetForStorageChange, onDirectoryRead,
  };
}

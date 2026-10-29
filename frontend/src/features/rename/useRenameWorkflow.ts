import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, createStoragePreview, releaseStoragePreview } from "../../api/client";
import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { useRenameStore } from "../../stores/useRenameStore";
import { sortFileItems, taskFileItems, type FileSort } from "../files/fileSort";
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
  const task = useRenameStore((state) => state.task);
  const resetTask = useRenameStore((state) => state.resetTask);
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const setPreviewActive = useRenameStore((state) => state.setPreviewActive);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  const clearSelection = useRenameStore((state) => state.clearSelection);
  const unknownExecution = useRenameStore((state) => state.unknownExecution);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const workspaceSession = JSON.stringify([workspaceKey, cloudSession]);
  const currentTask = task?.contextKey === workspaceSession ? task : null;
  const browserItems = useMemo(() => {
    const listed = files.data?.items ?? [];
    return sortFileItems(currentTask ? taskFileItems(listed, currentTask, files.data) : listed, sort);
  }, [files.data, currentTask, sort]);
  const renamableFiles = useMemo(() => {
    const availableIds = new Set(files.data?.items.map((item) => item.id));
    return browserItems.filter((item) => item.can_rename !== false && availableIds.has(item.id));
  }, [browserItems, files.data?.items]);
  const currentSelectedIds = useMemo(() => {
    const selected = new Set(selectedIds);
    return renamableFiles.filter((item) => selected.has(item.id)).map((item) => item.id);
  }, [renamableFiles, selectedIds]);
  const previewContext = useMemo(() => JSON.stringify([workspaceKey, cloudSession, currentSelectedIds, rules, sort]),
    [workspaceKey, cloudSession, currentSelectedIds, rules, sort]);
  const currentSession = useRef(workspaceSession);
  currentSession.current = workspaceSession;
  const isCurrentSession = useCallback((session: string) => mounted.current && session === currentSession.current, []);
  const currentWorkspace = useRef(previewContext);
  currentWorkspace.current = previewContext;
  // 界面 reset 不应丢失待释放 ID；规则和选择变化后仍可替代旧快照。
  const retainedPreview = useRef<{ storageId: string; previewId: string } | null>(null);
  const releaseRetainedPreview = useCallback(() => {
    const retained = retainedPreview.current;
    retainedPreview.current = null;
    if (retained) {
      releasePreview(retained.storageId, retained.previewId);
    }
  }, []);
  const preview = useMutation({
    mutationKey: ["rename-preview"],
    gcTime: 0,
    mutationFn: async (input: { contextKey: string; storageId: string; location: StorageLocation; fileIds: string[]; fileNames: Map<string, string>; rules: RuleSpec[] }) => {
      const retained = retainedPreview.current;
      const previousId = retained?.storageId === input.storageId ? retained.previewId : undefined;
      const result = previousId
        ? await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules, previousId)
        : await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules);
      return { ...result, contextKey: input.contextKey, storageId: input.storageId };
    },
    onSuccess: (result) => {
      if (result.contextKey !== currentWorkspace.current) {
        releasePreview(result.storageId, result.preview_id);
        return;
      }
      retainedPreview.current = { storageId: result.storageId, previewId: result.preview_id };
      if (useRenameStore.getState().unknownExecution?.previewUnlocked) {
        useRenameStore.getState().setUnknownExecution(null);
      }
    },
  });
  const execution = useRenameExecution(isCurrentSession);
  const invalidateBatchPreview = useCallback(() => {
    releaseRetainedPreview();
    preview.reset();
    execution.reset();
  }, [releaseRetainedPreview, preview.reset, execution.reset]);
  const { isPending: isSinglePending, reset: resetSingleRename, ...singleRename } = useSingleRename({
    storageId, location, workspaceSession, revision: activeStorage?.revision, taskId: currentTask?.taskId,
    selectedFile: locationReady && currentSelectedIds.length === 1
      ? files.data?.items.find((item) => item.id === currentSelectedIds[0]) : undefined,
    directoryKey: ["files", storageId, activeStorage?.revision, location],
    canStart: canRename && locationReady && Boolean(activeStorage) && !activeStorage?.busy &&
      files.isSuccess && !files.isFetching && !files.error && !preview.isPending && !execution.isPending &&
      !unknownExecution && currentSelectedIds.length === 1,
    isCurrentSession, invalidateBatchPreview,
  });
  const isExecuting = execution.isPending || singleRename.isSingleRenaming;
  const batchExecution = execution;
  const previewData = preview.data && (preview.data.contextKey === previewContext || (batchExecution?.variables?.source.preview_id === preview.data.preview_id && (execution.isPending || execution.data || execution.error))) ? preview.data : undefined;

  const previousSession = useRef<string | null>(null);
  useEffect(() => {
    if (isExecuting || previousSession.current === workspaceSession) return;
    previousSession.current = workspaceSession;
    releaseRetainedPreview();
    clearSelection();
    resetTask();
    setPreviewActive(false);
    preview.reset();
    execution.reset();
    resetSingleRename();
  }, [workspaceSession, isExecuting]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 刷新失败时保留选择；成功读取后移除消失或已明确不能改名的项，不自动选择新增项。
    // 单项结果会同时更新缓存和选择；等待整条请求结束，避免中间渲染误删新 ID。
    if (!files.isSuccess || !locationReady || isSinglePending()) return;
    if (currentSelectedIds.length === selectedIds.length) return;
    setSelectedIds(currentSelectedIds);
    // 不因目录后台变化丢失正在执行的请求和进度。
    if (!isExecuting && !useRenameStore.getState().unknownExecution) {
      preview.reset();
      execution.reset();
    }
  }, [files.isSuccess, files.dataUpdatedAt, locationReady, currentSelectedIds, selectedIds.length,
    setSelectedIds, preview.reset, execution.reset, isExecuting, isSinglePending]);

  const requestPreview = () => {
    if (!files.data || files.isFetching || files.error || isExecuting || isSinglePending() || preview.isPending || activeStorage?.busy) return;
    const unknown = useRenameStore.getState().unknownExecution;
    if (unknown && !unknown.previewUnlocked) {
      notify({ key: "files:notifications.verifyBeforeRetry" }, "warning");
      return;
    }
    const state = useRenameStore.getState();
    const selected = new Set(state.selectedIds);
    if (currentTask) {
      const members = new Set(currentTask.items.map((item) => item.currentFileId));
      if (state.selectedIds.some((id) => !members.has(id))) {
        notify({ key: "files:notifications.fixedMembers" }, "warning");
        return;
      }
    }
    const fileIds = renamableFiles.filter((item) => selected.has(item.id)).map((item) => item.id);
    if (!fileIds.length) return;
    state.createTask(workspaceSession, storageId, location, renamableFiles);
    resetSingleRename();
    setPreviewActive(true);
    execution.reset();
    // 同一事件内选择可能已更新，使用 Store 中的实际选择，避免迟到响应覆盖新上下文。
    const contextKey = JSON.stringify([workspaceKey, cloudSession, fileIds, rules, sort]);
    currentWorkspace.current = contextKey;
    // 保存请求时的名称，目录刷新后仍能展示已消失项目的校验错误。
    const fileNames = new Map(renamableFiles.map((item) => [item.id, item.name]));
    preview.mutate({ contextKey, storageId, location, fileIds, fileNames, rules });
  };

  const resetOperation = useCallback(() => {
    if (isExecuting || isSinglePending() || preview.isPending) return;
    releaseRetainedPreview();
    useRenameStore.getState().setUnknownExecution(null);
    resetTask(); setPreviewActive(false); clearSelection(); preview.reset(); execution.reset();
    resetSingleRename();
  }, [isExecuting, isSinglePending, preview.isPending, releaseRetainedPreview, resetTask, setPreviewActive, clearSelection, preview.reset, execution.reset, resetSingleRename]);
  const onDirectoryRefreshed = () => {
    const unknown = useRenameStore.getState().unknownExecution;
    if (isExecuting || isSinglePending() || !unknown) return;
    // 保留旧预览和待核对展示，只允许创建新预览；旧执行仍被锁定。
    useRenameStore.getState().setUnknownExecution({ ...unknown, previewUnlocked: true });
  };
  const changeSelection = useCallback((update: () => void) => {
    if (isExecuting || isSinglePending()) return;
    update();
    preview.reset(); execution.reset();
  }, [isExecuting, isSinglePending, preview.reset, execution.reset]);
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
    if (isExecuting || isSinglePending()) return;
    // 规则变化后旧预览立即失效，避免用户误读过期结果。
    setRules(nextRules);
    preview.reset();
    execution.reset();
  };

  const changeSort = useCallback((nextSort: FileSort) => {
    if (isExecuting || isSinglePending() || preview.isPending) return;
    onSortChange(nextSort);
    // 切回旧排序也不能重新启用旧预览；保留快照 ID 供下次替换或清理工作区时释放。
    preview.reset(); execution.reset();
  }, [isExecuting, isSinglePending, preview.isPending, onSortChange, preview.reset, execution.reset]);

  // 本地根目录选择和默认云路径恢复复用原有清理顺序；不丢失待释放 ID。
  const resetForStorageChange = useCallback(() => {
    resetTask();
    setPreviewActive(false);
    clearSelection();
    preview.reset();
    execution.reset();
    resetSingleRename();
  }, [resetTask, setPreviewActive, clearSelection, preview.reset, execution.reset, resetSingleRename]);
  const executeRename = (previewId: string) => {
    // 已消费或结果未知的预览不能在同一页面重放；再次改名必须创建新预览。
    if (isExecuting || isSinglePending() || execution.variables?.source.preview_id === previewId || useRenameStore.getState().unknownExecution ||
      !currentTask || previewData?.preview_id !== previewId || !previewData.valid) return;
    execution.mutate({ source: previewData, workspaceSession, taskId: currentTask.taskId,
      directoryKey: ["files", storageId, activeStorage?.revision, location] });
  };

  let previewError: string | undefined;
  if (preview.variables?.contextKey === previewContext && preview.error) {
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

  const revalidationError = batchExecution.error instanceof ApiError && batchExecution.error.details.execution_started === false
    ? t(`errors:codes.${batchExecution.error.code}`, { message: "" }).trim() : undefined;

  return {
    selectedIds, rules, browserItems, currentTask, changeSort,
    selectedCount: currentSelectedIds.length,
    previewData, executionData: batchExecution?.data,
    previewError,
    revalidationError,
    executeError: batchExecution?.error ? errorMessage(batchExecution.error, t) : undefined,
    executionPreviewId: batchExecution?.variables?.source.preview_id,
    isPreviewing: preview.isPending, isExecuting, hasExecuted: Boolean(batchExecution?.data),
    ...singleRename,
    requestPreview, executeRename, onRulesChange,
    resetOperation, endTask: resetOperation, toggleFile, selectAllFiles, clearFiles, invertFiles,
    resetForStorageChange, onDirectoryRefreshed,
  };
}

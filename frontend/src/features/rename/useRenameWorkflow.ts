import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createStoragePreview, releaseStoragePreview, executePreview } from "../../api/client";
import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { useRenameStore } from "../../stores/useRenameStore";
import { sortFileItems, taskFileItems, type FileSort } from "../files/fileSort";
import type { DirectoryListing, RuleSpec, StorageInfo, StorageLocation } from "../../types";

interface RenameWorkflowOptions {
  storageId: string;
  location: StorageLocation;
  workspaceKey: string;
  cloudSession: string | null;
  locationReady: boolean;
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
  storageId, location, workspaceKey, cloudSession, locationReady, activeStorage, files, sort, onSortChange,
}: RenameWorkflowOptions) {
  const { t } = useTranslation();
  const notify = useNotification();
  const queryClient = useQueryClient();
  const task = useRenameStore((state) => state.task);
  const resetTask = useRenameStore((state) => state.resetTask);
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const setPreviewActive = useRenameStore((state) => state.setPreviewActive);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  const clearSelection = useRenameStore((state) => state.clearSelection);

  const workspaceSession = JSON.stringify([workspaceKey, cloudSession]);
  const currentTask = task?.contextKey === workspaceSession ? task : null;
  const browserItems = useMemo(() => {
    const listed = files.data?.items ?? [];
    return sortFileItems(currentTask ? taskFileItems(listed, currentTask) : listed, sort);
  }, [files.data?.items, currentTask, sort]);
  const renamableFiles = useMemo(() => {
    const available = new Map(files.data?.items.map((item) => [item.id, item]));
    return browserItems.filter((item) => available.has(item.id) && available.get(item.id)!.can_rename !== false);
  }, [browserItems, files.data?.items]);
  const currentSelectedIds = useMemo(() => {
    const selected = new Set(selectedIds);
    return renamableFiles.filter((item) => selected.has(item.id)).map((item) => item.id);
  }, [renamableFiles, selectedIds]);
  const previewContext = useMemo(() => JSON.stringify([workspaceKey, cloudSession, currentSelectedIds, rules, sort]),
    [workspaceKey, cloudSession, currentSelectedIds, rules, sort]);
  const currentSession = useRef(workspaceSession);
  currentSession.current = workspaceSession;
  const currentWorkspace = useRef(previewContext);
  currentWorkspace.current = previewContext;
  // 界面 reset 不应丢失待释放 ID；规则和选择变化后仍可替代旧快照。
  const retainedPreview = useRef<{ storageId: string; previewId: string } | null>(null);
  const releaseRetainedPreview = useCallback(() => {
    const retained = retainedPreview.current;
    retainedPreview.current = null;
    if (retained) {
      void releaseStoragePreview(retained.storageId, retained.previewId).catch(() => {
        // 清理失败由服务端过期回收兜底，无需打扰用户。
      });
    }
  }, []);
  const preview = useMutation({
    mutationKey: ["rename-preview"],
    gcTime: 0,
    mutationFn: async (input: { contextKey: string; storageId: string; location: StorageLocation; fileIds: string[]; rules: RuleSpec[] }) => {
      const retained = retainedPreview.current;
      const previousId = retained?.storageId === input.storageId ? retained.previewId : undefined;
      const result = previousId
        ? await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules, previousId)
        : await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules);
      return { ...result, contextKey: input.contextKey, storageId: input.storageId };
    },
    onSuccess: (result) => {
      if (result.contextKey !== currentWorkspace.current) {
        void releaseStoragePreview(result.storageId, result.preview_id).catch(() => {
          // 清理失败由服务端过期回收兜底，无需打扰用户。
        });
        return;
      }
      retainedPreview.current = { storageId: result.storageId, previewId: result.preview_id };
      if (!result.valid) {
        notify({ key: "files:notifications.invalidPreview" }, "warning");
      }
    },
    onError: (error, input) => {
      if (input.contextKey === currentWorkspace.current) notify({ key: "files:notifications.previewFailed", error }, "error");
    },
  });
  const execution = useMutation({
    gcTime: 0,
    mutationFn: executePreview,
    onMutate: () => ({
      source: preview.data!, workspaceSession, taskId: currentTask!.taskId,
      directoryKey: ["files", storageId, activeStorage?.revision, location],
    }),
    onSuccess: (result, _previewId, context) => {
      const source = context.source;
      const outcomes = new Map(result.items.map((item) => [item.file_id, item]));
      const unknown = source.items.filter((item) => {
        const outcome = outcomes.get(item.file_id);
        return !outcome || (outcome.status === "failed" && (
          outcome.error_code === "RENAME_OUTCOME_UNKNOWN" ||
          (outcome.actual_name != null && outcome.actual_name !== outcome.original_name && !outcome.current_file)
        ));
      });
      if (unknown.length) useRenameStore.getState().setUnknownExecution({
        storageId: source.storageId, previewId: result.preview_id, items: unknown,
      });
      // 只更新发起执行的目录缓存；连接版本或账号变化后的响应不能覆盖当前选择。
      const confirmed = new Map(result.items.filter((item) => item.current_file)
        .map((item) => [item.file_id, item.current_file!]));
      queryClient.setQueryData<DirectoryListing>(context.directoryKey, (listing) =>
        listing && { ...listing, items: listing.items.map((item) => confirmed.get(item.id) ?? item) });
      if (context.workspaceSession !== currentSession.current) return;
      useRenameStore.getState().applyTaskResults(context.taskId, result);
      if (result.status === "completed") {
        const renamed = result.items.filter((item) => item.status === "renamed").length;
        notify({ key: "files:notifications.completed", values: { count: renamed } }, "success");
      } else {
        const renamed = result.items.filter((item) => item.status === "renamed").length;
        const failed = result.items.filter((item) => item.status === "failed").length;
        notify(
          { key: result.status === "partial" ? "files:notifications.partial" : "files:notifications.failed", values: { renamed, failed } },
          result.status === "partial" ? "warning" : "error",
        );
      }
      // 本轮结束后保留明确失败项；成功文件仍可由用户重新选择并创建新预览。
      const unknownIds = new Set(unknown.map((item) => item.file_id));
      const failed = new Set(result.items.filter((item) => item.status === "failed" && !unknownIds.has(item.file_id)).map((item) => item.file_id));
      setSelectedIds(useRenameStore.getState().selectedIds.filter((id) => failed.has(id)).map((id) => confirmed.get(id)?.id ?? id));
    },
    onError: (error, previewId, context) => {
      // 丢失响应不代表未写入；核对信息绑定原连接，不依赖当前预览展示。
      if (context) useRenameStore.getState().setUnknownExecution({
        storageId: context.source.storageId, previewId, items: context.source.items,
      });
      if (context?.workspaceSession === currentSession.current) notify({ key: "files:notifications.unknownOutcome", error }, "error");
    },
  });
  const previewData = preview.data && (preview.data.contextKey === previewContext || (execution.variables === preview.data.preview_id && (execution.isPending || execution.data || execution.error))) ? preview.data : undefined;

  const previousSession = useRef<string | null>(null);
  useEffect(() => {
    if (execution.isPending || previousSession.current === workspaceSession) return;
    previousSession.current = workspaceSession;
    releaseRetainedPreview();
    clearSelection();
    resetTask();
    setPreviewActive(false);
    preview.reset();
    execution.reset();
  }, [workspaceSession, execution.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 刷新失败时保留选择；成功读取后移除消失或已明确不能改名的项，不自动选择新增项。
    if (!files.isSuccess || !locationReady) return;
    if (currentSelectedIds.length === selectedIds.length) return;
    setSelectedIds(currentSelectedIds);
    // 不因目录后台变化丢失正在执行的请求和进度。
    if (!execution.isPending) {
      preview.reset();
      execution.reset();
    }
  }, [files.isSuccess, files.dataUpdatedAt, locationReady, currentSelectedIds, selectedIds.length,
    setSelectedIds, preview.reset, execution.reset, execution.isPending]);

  const requestPreview = () => {
    if (!files.data || files.isFetching || files.error || execution.isPending || preview.isPending || activeStorage?.busy) return;
    if (useRenameStore.getState().unknownExecution) {
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
    setPreviewActive(true);
    execution.reset();
    // 同一事件内选择可能已更新，使用 Store 中的实际选择，避免迟到响应覆盖新上下文。
    const contextKey = JSON.stringify([workspaceKey, cloudSession, fileIds, rules, sort]);
    currentWorkspace.current = contextKey;
    preview.mutate({ contextKey, storageId, location, fileIds, rules });
  };

  const resetOperation = useCallback(() => {
    if (execution.isPending || preview.isPending) return;
    releaseRetainedPreview();
    resetTask(); setPreviewActive(false); clearSelection(); preview.reset(); execution.reset();
  }, [execution.isPending, preview.isPending, releaseRetainedPreview, resetTask, setPreviewActive, clearSelection, preview.reset, execution.reset]);
  const changeSelection = useCallback((update: () => void) => {
    if (execution.isPending) return;
    update();
    preview.reset(); execution.reset();
  }, [execution.isPending, preview.reset, execution.reset]);
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
    if (execution.isPending) return;
    // 规则变化后旧预览立即失效，避免用户误读过期结果。
    setRules(nextRules);
    preview.reset();
    execution.reset();
  };

  const changeSort = useCallback((nextSort: FileSort) => {
    if (execution.isPending || preview.isPending) return;
    onSortChange(nextSort);
    // 切回旧排序也不能重新启用旧预览；保留快照 ID 供下次替换或清理工作区时释放。
    preview.reset(); execution.reset();
  }, [execution.isPending, preview.isPending, onSortChange, preview.reset, execution.reset]);

  // 本地根目录选择和默认云路径恢复复用原有清理顺序；不丢失待释放 ID。
  const resetForStorageChange = useCallback(() => {
    resetTask();
    setPreviewActive(false);
    clearSelection();
    preview.reset();
    execution.reset();
  }, [resetTask, setPreviewActive, clearSelection, preview.reset, execution.reset]);
  const executeRename = (previewId: string) => {
    // 已消费或结果未知的预览不能在同一页面重放；再次改名必须创建新预览。
    if (execution.isPending || execution.variables === previewId || useRenameStore.getState().unknownExecution ||
      !currentTask || previewData?.preview_id !== previewId || !previewData.valid) return;
    execution.mutate(previewId);
  };

  return {
    selectedIds, rules, browserItems, currentTask, changeSort,
    selectedCount: currentSelectedIds.length,
    previewData, executionData: execution.data,
    previewError: preview.variables?.contextKey === previewContext && preview.error ? errorMessage(preview.error, t) : undefined,
    executeError: execution.error ? errorMessage(execution.error, t) : undefined, executionPreviewId: execution.variables,
    isPreviewing: preview.isPending, isExecuting: execution.isPending, hasExecuted: Boolean(execution.data),
    requestPreview, executeRename, onRulesChange,
    resetOperation, endTask: resetOperation, toggleFile, selectAllFiles, clearFiles, invertFiles,
    resetForStorageChange,
  };
}

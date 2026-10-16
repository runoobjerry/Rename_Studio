import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createStoragePreview, releaseStoragePreview, executePreview } from "../../api/client";
import { errorMessage, useNotification } from "../../components/NotificationProvider";
import { RENAME_BATCH_SIZE, useRenameStore } from "../../stores/useRenameStore";
import { useAppSettings } from "../settings/useAppSettings";
import { fileBrowserItems, sortFileItems, type FileSort } from "../files/fileSort";
import type { DirectoryListing, RenameTask, RuleSpec, StorageInfo, StorageLocation } from "../../types";

interface RenameWorkflowOptions {
  storageId: string;
  location: StorageLocation;
  workspaceKey: string;
  cloudSession: string | null;
  providerId: string;
  cloudReady: boolean;
  activeStorage?: Pick<StorageInfo, "revision" | "busy">;
  task: RenameTask | null;
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
  storageId, location, workspaceKey, cloudSession, providerId, cloudReady, activeStorage, task, files, sort, onSortChange,
}: RenameWorkflowOptions) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const appSettings = useAppSettings();
  const [batchHintDraft, setBatchHintDraft] = useState<boolean | null>(null);
  const batchHintEditId = useRef(0);
  const skipBatchHint = batchHintDraft ?? appSettings.data?.preferences.hide_batch_limit_hint ?? false;
  const [batchHintContext, setBatchHintContext] = useState<string | null>(null);
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const resetTask = useRenameStore((state) => state.resetTask);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  const clearSelection = useRenameStore((state) => state.clearSelection);

  const taskContext = useMemo(() => JSON.stringify([workspaceKey, cloudSession, rules]), [workspaceKey, cloudSession, rules]);
  const taskCurrent = task?.contextKey === taskContext;
  const sortLocked = Boolean(task?.batches.some((batch) => batch.outcome !== undefined));
  const sortedFiles = useMemo(() => sortFileItems(files.data?.items ?? [], sort), [files.data?.items, sort]);
  const browserItems = useMemo(() => task ? fileBrowserItems(files.data?.items ?? [], task, sort, sortLocked) : sortedFiles,
    [files.data?.items, task?.items, sort, sortLocked, sortedFiles]);
  const orderedFiles = useMemo(() => {
    if (!taskCurrent) return sortedFiles;
    const availableIds = new Set(sortedFiles.map((item) => item.id));
    const members = new Set(browserItems.map((item) => item.id));
    // 非任务成员仍参与提交前校验，不能因任务面板隐藏它们而绕过固定成员检查。
    return [...browserItems.filter((item) => availableIds.has(item.id)), ...sortedFiles.filter((item) => !members.has(item.id))];
  }, [taskCurrent, browserItems, sortedFiles]);
  // 请求使用列表顺序，并与真实目录取交集；执行后的任务保留冻结顺序。
  const currentSelectedIds = useMemo(() => {
    const selected = new Set(selectedIds);
    return orderedFiles.filter((item) => selected.has(item.id)).map((item) => item.id);
  }, [orderedFiles, selectedIds]);
  const browserTask = useMemo(() => task ? { taskId: task.taskId, items: task.items } : null, [task?.taskId, task?.items]);
  const previewContext = useMemo(() => JSON.stringify([workspaceKey, currentSelectedIds, rules, sort]),
    [workspaceKey, currentSelectedIds, rules, sort]);
  useEffect(() => {
    // Dialog 仅确认点击时的选择；上下文改变后必须由用户再次点击预览。
    if (batchHintContext && batchHintContext !== previewContext) setBatchHintContext(null);
  }, [batchHintContext, previewContext]);
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
    mutationFn: async (input: { contextKey: string; batchId: string; storageId: string; location: StorageLocation; fileIds: string[]; rules: RuleSpec[] }) => {
      const retained = retainedPreview.current;
      const previousId = retained?.storageId === input.storageId ? retained.previewId : undefined;
      const result = previousId
        ? await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules, previousId)
        : await createStoragePreview(input.storageId, input.location, input.fileIds, input.rules);
      return { ...result, contextKey: input.contextKey, batchId: input.batchId, storageId: input.storageId };
    },
    onSuccess: (result) => {
      if (result.contextKey !== currentWorkspace.current) {
        void releaseStoragePreview(result.storageId, result.preview_id).catch(() => {
          // 清理失败由服务端过期回收兜底，无需打扰用户。
        });
        return;
      }
      retainedPreview.current = { storageId: result.storageId, previewId: result.preview_id };
      useRenameStore.getState().bindPreview(result.batchId, result.preview_id);
      if (!result.valid) {
        notify("预览包含无效名称或冲突，请检查结果；其他批次尚未处理的文件仍占用名称，不能跳过冲突检查。", "warning");
      }
    },
    onError: (error, input) => {
      if (input.contextKey === currentWorkspace.current) notify(`预览失败：${errorMessage(error)}`, "error");
    },
  });
  const execution = useMutation({
    gcTime: 0,
    mutationFn: executePreview,
    onSuccess: (result) => {
      if (result.status === "completed") {
        const renamed = result.items.filter((item) => item.status === "renamed").length;
        notify(`修改全部成功：${renamed} 项已修改。`, "success");
      } else {
        const renamed = result.items.filter((item) => item.status === "renamed").length;
        const failed = result.items.filter((item) => item.status === "failed").length;
        notify(
          `修改${result.status === "partial" ? "部分完成" : "失败"}：${renamed} 项已修改，${failed} 项失败。`,
          result.status === "partial" ? "warning" : "error",
        );
      }
      useRenameStore.getState().applyResults(result);
      // 只合并 Provider 已确认的结果，不请求目录；兼容 Local 重命名后的路径 ID。
      const confirmed = new Map(result.items.filter((item) => item.current_file)
        .map((item) => [item.file_id, item.current_file!]));
      queryClient.setQueryData<DirectoryListing>(["files", storageId, activeStorage?.revision, location], (listing) =>
        listing && { ...listing, items: listing.items.map((item) => confirmed.get(item.id) ?? item) });
    },
    onError: (error, previewId) => {
      // 请求失败可能发生在写入之后；没有逐项结果时先锁定本批，避免盲目重放。
      useRenameStore.getState().markUnknown(previewId);
      notify(`执行未返回完整结果：${errorMessage(error)}；请刷新目录并核对本批文件。`, "error");
    },
  });
  const previewData = preview.data && (preview.data.contextKey === previewContext || (execution.variables === preview.data.preview_id && (execution.isPending || execution.data || execution.error))) ? preview.data : undefined;

  useEffect(() => {
    if (execution.isPending) return;
    releaseRetainedPreview();
    clearSelection();
    resetTask();
    preview.reset();
    execution.reset();
  }, [workspaceKey, cloudSession]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 刷新失败时保留选择；成功读取后仅移除不存在的项，不自动选择新增项。
    if (!files.isSuccess || (providerId === "onedrive" && !cloudReady)) return;
    if (currentSelectedIds.length === selectedIds.length) return;
    setSelectedIds(currentSelectedIds);
    // 不因目录后台变化丢失正在执行的请求和进度。
    if (!execution.isPending) {
      preview.reset();
      execution.reset();
    }
  }, [files.isSuccess, files.dataUpdatedAt, cloudReady, providerId, currentSelectedIds, selectedIds.length,
    setSelectedIds, preview.reset, execution.reset, execution.isPending]);

  const requestBatchPreview = () => {
    if (!files.data || files.isFetching || files.error || execution.isPending || preview.isPending || activeStorage?.busy) return;
    const selected = new Set(useRenameStore.getState().selectedIds);
    const fileIds = orderedFiles.filter((item) => selected.has(item.id)).map((item) => item.id);
    if (task && !taskCurrent && task.items.some((item) => item.status === "unknown")) {
      notify("旧任务仍有待核对项，请先恢复原规则并核对执行结果。", "warning");
      return;
    }
    if (taskCurrent && task) {
      const members = new Set(task.items.map((item) => item.currentFileId));
      if (fileIds.some((id) => !members.has(id))) {
        notify("本次任务的文件集合已固定；请先结束当前任务，再选择文件开始新任务。", "warning");
        return;
      }
    }
    const batch = useRenameStore.getState().prepareBatch(taskContext, storageId, location, orderedFiles);
    if (!batch.fileIds.length) {
      notify("没有可处理的任务文件；失败项可单独选择重试，待核对项须先核对。", "warning");
      return;
    }
    execution.reset();
    // 同一事件内选择可能已更新，使用 Store 中的实际选择，避免迟到响应覆盖新上下文。
    const contextKey = JSON.stringify([workspaceKey, fileIds, rules, sort]);
    currentWorkspace.current = contextKey;
    preview.mutate({ contextKey, batchId: batch.batchId, storageId, location, fileIds: batch.fileIds, rules });
  };

  const reconcileSelection = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    // 结果导致默认筛选隐藏项目时，保留执行结果和确认卡片。
    if (!execution.isPending && !execution.data) { preview.reset(); execution.reset(); }
  }, [setSelectedIds, execution.isPending, execution.data, preview.reset, execution.reset]);
  const endTask = useCallback(() => {
    if (execution.isPending || preview.isPending) return;
    releaseRetainedPreview();
    resetTask(); clearSelection(); preview.reset(); execution.reset();
  }, [execution.isPending, preview.isPending, releaseRetainedPreview, resetTask, clearSelection, preview.reset, execution.reset]);
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
    if (task?.items.some((item) => item.status === "unknown")) {
      notify("本批存在待核对结果，请先核对实际文件，结束当前任务后再修改规则。", "warning");
      return;
    }
    // 规则变化后旧预览立即失效，避免用户误读过期结果。
    setRules(nextRules);
    preview.reset();
    execution.reset();
  };

  const changeSort = useCallback((nextSort: FileSort) => {
    if (sortLocked || execution.isPending || preview.isPending) return;
    onSortChange(nextSort);
    // 切回旧排序也不能重新启用旧预览；保留快照 ID 供下次替换或结束任务时释放。
    preview.reset(); execution.reset();
  }, [sortLocked, execution.isPending, preview.isPending, onSortChange, preview.reset, execution.reset]);

  const changeBatchHintPreference = (checked: boolean) => {
    const id = ++batchHintEditId.current;
    setBatchHintDraft(checked);
    void appSettings.save({ hide_batch_limit_hint: checked })
      .catch((error: Error) => notify(`提示偏好保存失败，已撤销本次更改：${errorMessage(error)}`, "error"))
      .finally(() => { if (batchHintEditId.current === id) setBatchHintDraft(null); });
  };

  // 本地根目录选择和默认云路径恢复复用原有清理顺序；不丢失待释放 ID。
  const resetForStorageChange = useCallback(() => {
    clearSelection();
    preview.reset();
    execution.reset();
  }, [clearSelection, preview.reset, execution.reset]);
  const closeBatchHint = () => setBatchHintContext(null);
  const continueBatchPreview = () => { setBatchHintContext(null); requestBatchPreview(); };
  const requestPreview = () => {
    if (currentSelectedIds.length > RENAME_BATCH_SIZE && !skipBatchHint) setBatchHintContext(previewContext);
    else requestBatchPreview();
  };
  const executeRename = (previewId: string) => execution.mutate(previewId);

  return {
    selectedIds, rules, browserTask, taskCurrent, browserItems, sortLocked, changeSort,
    selectedCount: Math.min(RENAME_BATCH_SIZE, currentSelectedIds.length),
    previewData, executionData: execution.data,
    previewError: preview.variables?.contextKey === previewContext ? preview.error?.message : undefined,
    executeError: execution.error?.message, executionPreviewId: execution.variables,
    isPreviewing: preview.isPending, isExecuting: execution.isPending, hasExecuted: Boolean(execution.data),
    batchHintOpen: batchHintContext === previewContext, skipBatchHint,
    closeBatchHint, changeBatchHintPreference, continueBatchPreview,
    requestPreview, executeRename, onRulesChange,
    reconcileSelection, endTask, toggleFile, selectAllFiles, clearFiles, invertFiles,
    resetForStorageChange,
  };
}

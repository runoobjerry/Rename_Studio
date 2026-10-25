import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, executePreview, executeStorageSingleRename } from "../../api/client";
import { useNotification } from "../../components/NotificationProvider";
import { useRenameStore } from "../../stores/useRenameStore";
import type { DirectoryListing, PreviewResponse, SingleRenameExecuteRequest } from "../../types";

export type ExecutionInput = {
  source: Pick<PreviewResponse, "preview_id" | "items"> & { storageId: string };
  workspaceSession: string;
  taskId?: string;
  directoryKey: readonly unknown[];
} & ({ single: false } | { single: true; request: SingleRenameExecuteRequest });

// 单项直接执行、批量按预览执行，共用结果处理，由工作流统一控制操作互斥。
export function useRenameExecution(isCurrentSession: (session: string) => boolean) {
  const queryClient = useQueryClient();
  const notify = useNotification();
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  return useMutation({
    gcTime: 0,
    mutationFn: (input: ExecutionInput) => input.single
      ? executeStorageSingleRename(input.source.storageId, input.request) : executePreview(input.source.preview_id),
    onSuccess: (result, input) => {
      const source = input.source;
      const outcomes = new Map(result.items.map((item) => [item.file_id, item]));
      const unknown = source.items.filter((item) => {
        const outcome = outcomes.get(item.file_id);
        return !outcome || (input.single && outcome.status === "renamed" && !outcome.current_file) || (outcome.status === "failed" && (
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
      queryClient.setQueryData<DirectoryListing>(input.directoryKey, (listing) =>
        listing && { ...listing, items: listing.items.map((item) => confirmed.get(item.id) ?? item) });
      if (!isCurrentSession(input.workspaceSession)) return;
      if (input.taskId) useRenameStore.getState().applyTaskResults(input.taskId, result);
      if (input.single) {
        // 单项改名保留选择；先更新任务身份，再选择 Provider 确认的新 ID。
        setSelectedIds(useRenameStore.getState().selectedIds.map((id) => confirmed.get(id)?.id ?? id));
        if (!unknown.length && result.status === "completed") {
          notify({ key: "files:notifications.completed", values: { count: 1 } }, "success");
        }
        return;
      }
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
    onError: (error, input) => {
      // 单项复核在写入前返回的明确拒绝不属于未知写入；网络错误和 5xx 仍保持锁定。
      if (input.single && error instanceof ApiError && error.status >= 400 && error.status < 500) return;
      // 丢失响应不代表未写入；核对信息绑定原连接，不依赖当前预览展示。
      useRenameStore.getState().setUnknownExecution({
        storageId: input.source.storageId, previewId: input.source.preview_id, items: input.source.items,
      });
      if (!input.single && isCurrentSession(input.workspaceSession)) {
        notify({ key: "files:notifications.unknownOutcome", error }, "error");
      }
    },
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, executePreview } from "../../api/client";
import { useNotification } from "../../components/NotificationProvider";
import { useRenameStore } from "../../stores/useRenameStore";
import { useTranslation } from "react-i18next";
import type { DirectoryListing, PreviewResponse } from "../../types";

type BatchExecutionInput = {
  source: Pick<PreviewResponse, "preview_id" | "items"> & { storageId: string };
  workspaceSession: string;
  taskId?: string;
  directoryKey: readonly unknown[];
};

// 批量执行只接受服务端预览，不承接单项改名。
export function useRenameExecution(isCurrentSession: (session: string) => boolean) {
  const queryClient = useQueryClient();
  const notify = useNotification();
  const { t } = useTranslation();
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  return useMutation({
    gcTime: 0,
    mutationFn: (input: BatchExecutionInput) => executePreview(input.source.preview_id),
    onSuccess: (result, input) => {
      const source = input.source;
      const outcomes = new Map(result.items.map((item) => [item.file_id, item]));
      const unknown = source.items.filter((item) => {
        const outcome = outcomes.get(item.file_id);
        return !outcome || outcome.status === "unknown";
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
      const { renamed, skipped, failed: failedCount, not_attempted: notAttempted } = result.counts;
      if (result.status === "completed" && unknown.length === 0) {
        notify({ key: "files:notifications.completed", values: { count: renamed } }, "success");
      } else {
        const counts = [["renamed", renamed], ["skipped", skipped], ["failed", failedCount], ["unknown", unknown.length], ["notAttempted", notAttempted]] as const;
        const results = counts.filter(([, count]) => count > 0)
          .map(([key, count]) => t(`files:notifications.${key}Count`, { count }))
          .join(t("files:notifications.resultSeparator"));
        notify(
          { key: "files:notifications.ended", values: { results } },
          "warning",
        );
      }
      // 保留明确失败和未提交项的选择；成功文件可重新选择并创建新预览。
      const failed = new Set(result.items.filter((item) => (item.status === "failed" || item.status === "not_attempted")).map((item) => item.file_id));
      setSelectedIds(useRenameStore.getState().selectedIds.filter((id) => failed.has(id)).map((id) => confirmed.get(id)?.id ?? id));
    },
    onError: (error, input) => {
      // 服务端确认复核未写入，或在读取预览/获取连接执行权时拒绝了请求。
      if (error instanceof ApiError && (error.details.execution_started === false ||
        ["PREVIEW_EXPIRED", "PREVIEW_NOT_FOUND", "STORAGE_CONNECTION_CHANGED", "STORAGE_BUSY"].includes(error.code ?? ""))) {
        return;
      }
      // 丢失响应不代表未写入；核对信息绑定原连接，不依赖当前预览展示。
      useRenameStore.getState().setUnknownExecution({
        storageId: input.source.storageId, previewId: input.source.preview_id, items: input.source.items,
      });
      if (isCurrentSession(input.workspaceSession)) {
        notify({ key: "files:notifications.ended", values: {
          results: t("files:notifications.unknownCount", { count: input.source.items.length }),
        } }, "warning");
      }
    },
  });
}

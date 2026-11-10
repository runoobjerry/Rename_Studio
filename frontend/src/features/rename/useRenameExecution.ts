import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, executePreview } from "../../api/client";
import { useNotification } from "../../components/NotificationProvider";
import { useRenameStore } from "../../stores/useRenameStore";
import { useTranslation } from "react-i18next";
import type { PendingRenameRecord } from "./renameRecord";
import type { DirectoryListing, PreviewItem } from "../../types";

type BatchExecutionInput = {
  previewItems: PreviewItem[];
  record: PendingRenameRecord;
  workspaceSession: string;
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
    mutationFn: async ({ record, directoryKey }: BatchExecutionInput) => {
      await queryClient.cancelQueries({ queryKey: directoryKey, exact: true });
      return executePreview(record.operationId);
    },
    onSuccess: (result, input) => {
      const outcomes = new Map(result.items.map((item) => [item.file_id, item]));
      const unknown = input.previewItems.filter((item) => {
        const outcome = outcomes.get(item.file_id);
        return !outcome || outcome.status === "unknown";
      });
      if (unknown.length) useRenameStore.getState().setUnknownExecution({
        storageId: input.record.storageId, location: input.record.location, previewId: result.preview_id, items: unknown,
      });
      useRenameStore.getState().settleRenameRecord(input.record, result.items);
      if (!isCurrentSession(input.workspaceSession)) {
        void queryClient.invalidateQueries({ queryKey: input.directoryKey, exact: true, refetchType: "none" });
        return;
      }
      const confirmed = new Map(result.items.filter((item) => item.current_file)
        .map((item) => [item.file_id, item.current_file!]));
      queryClient.setQueryData<DirectoryListing>(input.directoryKey, (listing) =>
        listing && { ...listing, items: listing.items.map((item) => confirmed.get(item.id) ?? item) });
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
      // 服务端确认复核未写入，或在读取预览、获取文件来源执行权时拒绝了请求。
      if (error instanceof ApiError && (error.details.execution_started === false ||
        ["PREVIEW_EXPIRED", "PREVIEW_NOT_FOUND", "STORAGE_CONNECTION_CHANGED", "STORAGE_BUSY"].includes(error.code ?? ""))) {
        useRenameStore.getState().settleRenameRecord(input.record, null);
        return;
      }
      // 丢失响应不代表未写入；核对信息绑定原文件来源，不依赖当前预览展示。
      useRenameStore.getState().setUnknownExecution({
        storageId: input.record.storageId, location: input.record.location, previewId: input.record.operationId, items: input.previewItems,
      });
      useRenameStore.getState().settleRenameRecord(input.record, []);
      if (isCurrentSession(input.workspaceSession)) {
        notify({ key: "files:notifications.ended", values: {
          results: t("files:notifications.unknownCount", { count: input.previewItems.length }),
        } }, "warning");
      }
    },
  });
}

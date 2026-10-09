import { useQuery } from "@tanstack/react-query";
import { fetchRenameProgress } from "../../api/client";
import { RenameActions } from "./RenameActions";
import type { RenameActionsProps } from "./RenameActions";

export function RenameActionsWithProgress({ executionPreviewId, ...props }:
  Omit<RenameActionsProps, "progress" | "progressError"> & { executionPreviewId?: string }) {
  // 进度只更新操作区，不让每次轮询重新渲染文件表、预览表和规则编辑器。
  const progress = useQuery({
    queryKey: ["rename-progress", executionPreviewId],
    queryFn: () => fetchRenameProgress(executionPreviewId!),
    enabled: props.isExecuting && Boolean(executionPreviewId),
    refetchInterval: props.isExecuting ? 500 : false,
    retry: false,
    gcTime: 0,
  });
  return <RenameActions {...props} progress={progress.data} progressError={progress.error?.message} />;
}

import type { ExecuteResponse, PreviewResponse } from "../../types";

interface PreviewPanelProps {
  preview?: PreviewResponse;
  execution?: ExecuteResponse;
  providerName?: string;
  error?: string;
  executeError?: string;
  selectedCount?: number;
  isPending?: boolean;
  isExecuting?: boolean;
  onPreview?: () => void;
  onExecute?: (previewId: string) => void;
}

export function PreviewPanel({
  preview,
  execution,
  providerName = "当前存储",
  error,
  executeError,
}: PreviewPanelProps) {
  const executionById = new Map(execution?.items.map((item) => [item.file_id, item]));
  const pendingCount = preview?.items.filter(
    (item) => item.changed && item.valid && !executionById.has(item.file_id),
  ).length ?? 0;
  const unchangedCount = preview?.items.filter(
    (item) => !item.changed || executionById.get(item.file_id)?.status === "skipped",
  ).length ?? 0;

  function statusFor(item: PreviewResponse["items"][number]) {
    const result = executionById.get(item.file_id);
    if (result?.status === "renamed") return { label: "已修改", className: "valid" };
    if (result?.status === "failed") {
      return { label: result.error ?? "修改失败", className: "invalid" };
    }
    if (result?.status === "skipped") return { label: "无变化", className: "neutral" };
    if (item.error) return { label: item.error, className: "invalid" };
    if (!item.valid) return { label: item.conflict ? "名称冲突" : "不可修改", className: "invalid" };
    return { label: item.changed ? "待修改" : "无变化", className: item.changed ? "pending" : "neutral" };
  }

  return (
    <section className="panel preview" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div className="panel-title-line">
          <h2 id="preview-title">重命名预览</h2>
          <p className="panel-summary">
            {preview
              ? `${pendingCount} 项待修改 · ${unchangedCount} 项无需修改`
              : "0个文件被选中"}
          </p>
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {!preview && !error && (
        <p className="empty-state">点击预览按钮以查看修改名称；预览不会修改 {providerName} 中的内容。</p>
      )}
      {preview && (
        <div className="preview-table-wrap">
          <table>
            <thead>
              <tr>
                <th>原文件名</th>
                <th>新文件名</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((item) => {
                const status = statusFor(item);
                const renamed = executionById.get(item.file_id)?.status === "renamed";
                return (
                  <tr key={item.file_id}>
                    <td className="preview-name">{item.original_name}</td>
                    <td className={`preview-name ${renamed ? "renamed-name" : ""}`}>
                      {item.new_name}
                    </td>
                    <td><span className={`status ${status.className}`}>{status.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {executeError && <p className="error-banner">执行失败：{executeError}</p>}
    </section>
  );
}

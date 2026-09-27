import type { PreviewResponse } from "../../types";

interface PreviewPanelProps {
  preview?: PreviewResponse;
  selectedCount: number;
  isPending: boolean;
  error?: string;
  onPreview: () => void;
}

export function PreviewPanel({
  preview,
  selectedCount,
  isPending,
  error,
  onPreview,
}: PreviewPanelProps) {
  return (
    <section className="panel preview" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Preview first</p>
          <h2 id="preview-title">安全预览</h2>
        </div>
        <button disabled={selectedCount === 0 || isPending} onClick={onPreview}>
          {isPending ? "生成中…" : `预览 ${selectedCount} 项`}
        </button>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {!preview && !error && <p className="empty-state">选择文件后生成预览，不会修改本地文件。</p>}
      {preview && (
        <div className="preview-table-wrap">
          <table>
            <thead>
              <tr>
                <th>原名称</th>
                <th>新名称</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((item) => (
                <tr key={item.file_id}>
                  <td>{item.original_name}</td>
                  <td>{item.new_name}</td>
                  <td>
                    <span className={item.valid ? "status valid" : "status invalid"}>
                      {item.error ?? (item.changed ? "已变化" : "未变化")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

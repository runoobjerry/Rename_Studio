import { useEffect, useState } from "react";

import type { ExecuteResponse, PreviewResponse } from "../../types";

interface PreviewPanelProps {
  preview?: PreviewResponse;
  execution?: ExecuteResponse;
  selectedCount: number;
  isPending: boolean;
  isExecuting?: boolean;
  error?: string;
  executeError?: string;
  onPreview: () => void;
  onExecute?: (previewId: string) => void;
}

export function PreviewPanel({
  preview,
  execution,
  selectedCount,
  isPending,
  isExecuting = false,
  error,
  executeError,
  onPreview,
  onExecute,
}: PreviewPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const changedCount = preview?.items.filter((item) => item.changed).length ?? 0;

  useEffect(() => {
    setConfirming(false);
  }, [preview?.preview_id]);

  return (
    <section className="panel preview" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Preview first</p>
          <h2 id="preview-title">安全预览与执行</h2>
        </div>
        <button disabled={selectedCount === 0 || isPending} onClick={onPreview}>
          {isPending ? "生成中…" : `预览 ${selectedCount} 项`}
        </button>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {!preview && !error && (
        <p className="empty-state">选择文件后生成预览，不会修改本地文件。</p>
      )}
      {preview && (
        <>
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
                      <span
                        className={item.valid ? "status valid" : "status invalid"}
                      >
                        {item.error ?? (item.changed ? "待执行" : "未变化")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!execution && onExecute && (
            <div className="execute-bar">
              {!confirming ? (
                <button
                  className="danger-button"
                  disabled={!preview.valid || changedCount === 0 || isExecuting}
                  onClick={() => setConfirming(true)}
                >
                  执行 {changedCount} 项重命名
                </button>
              ) : (
                <div className="confirmation-box">
                  <p>将修改本地文件。请确认预览结果无误。</p>
                  <div>
                    <button
                      className="secondary-button"
                      disabled={isExecuting}
                      onClick={() => setConfirming(false)}
                    >
                      取消
                    </button>
                    <button
                      className="danger-button"
                      disabled={isExecuting}
                      onClick={() => onExecute(preview.preview_id)}
                    >
                      {isExecuting ? "执行中…" : "确认执行"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {executeError && <p className="error-banner">执行失败：{executeError}</p>}
      {execution && (
        <div className="execution-result">
          <h3>执行结果：{execution.status}</h3>
          <ul>
            {execution.items.map((item) => (
              <li key={item.file_id} className={`execution-${item.status}`}>
                <strong>{item.original_name}</strong> → {item.new_name}：
                {item.error ?? item.status}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

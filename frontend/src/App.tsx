import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPreview,
  executePreview,
  fetchFiles,
  fetchProviders,
  fetchRules,
} from "./api/client";
import { FileBrowser } from "./features/files/FileBrowser";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RuleEditor } from "./features/rules/RuleEditor";
import { useRenameStore } from "./stores/useRenameStore";

export default function App() {
  const queryClient = useQueryClient();
  const [path, setPath] = useState("");
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const clearSelection = useRenameStore((state) => state.clearSelection);

  const providers = useQuery({ queryKey: ["providers"], queryFn: fetchProviders });
  const definitions = useQuery({ queryKey: ["rules"], queryFn: fetchRules });
  const files = useQuery({
    queryKey: ["files", "local", path],
    queryFn: () => fetchFiles("local", path),
  });
  const preview = useMutation({
    mutationFn: () => createPreview("local", selectedIds, rules),
  });
  const execution = useMutation({
    mutationFn: executePreview,
    onSuccess: async () => {
      // 执行后重新读取目录，避免 UI 继续显示已失效的文件 ID。
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      clearSelection();
    },
  });

  useEffect(() => {
    clearSelection();
    preview.reset();
    execution.reset();
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadError = providers.error ?? definitions.error ?? files.error;

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">OneDriver Renamer · Local workspace</p>
          <h1>先看清，再改名。</h1>
          <p className="hero-copy">规则驱动的批量重命名工作台，预览确认后安全执行本地重命名。</p>
        </div>
        <div className="stage-badge">
          <span>M3</span>
          <small>SAFE EXECUTE</small>
        </div>
      </header>

      {loadError && <p className="error-banner">无法连接后端：{loadError.message}</p>}

      <div className="workspace-grid">
        {files.data ? (
          <FileBrowser
            listing={files.data}
            selectedIds={selectedIds}
            onNavigate={setPath}
            onToggle={(fileId) => {
              toggleSelected(fileId);
              preview.reset();
              execution.reset();
            }}
          />
        ) : (
          <section className="panel"><p className="empty-state">正在读取本地目录…</p></section>
        )}
        <RuleEditor
          definitions={definitions.data ?? []}
          rules={rules}
          onChange={(nextRules) => {
            // 规则变化后旧预览立即失效，避免用户误读过期结果。
            setRules(nextRules);
            preview.reset();
            execution.reset();
          }}
        />
      </div>

      <PreviewPanel
        preview={preview.data}
        execution={execution.data}
        selectedCount={selectedIds.length}
        isPending={preview.isPending}
        isExecuting={execution.isPending}
        error={preview.error?.message}
        executeError={execution.error?.message}
        onPreview={() => {
          execution.reset();
          preview.mutate();
        }}
        onExecute={(previewId) => execution.mutate(previewId)}
      />
    </main>
  );
}

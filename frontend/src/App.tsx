import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { createPreview, fetchFiles, fetchProviders, fetchRules } from "./api/client";
import { FileBrowser } from "./features/files/FileBrowser";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RuleEditor } from "./features/rules/RuleEditor";
import { useRenameStore } from "./stores/useRenameStore";

export default function App() {
  const [path, setPath] = useState("");
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const rules = useRenameStore((state) => state.rules);
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

  useEffect(() => {
    clearSelection();
    preview.reset();
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadError = providers.error ?? definitions.error ?? files.error;

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">OneDriver Renamer · Local workspace</p>
          <h1>先看清，再改名。</h1>
          <p className="hero-copy">规则驱动的批量重命名工作台，目前运行于安全的本地预览阶段。</p>
        </div>
        <div className="stage-badge">
          <span>M2</span>
          <small>PREVIEW ONLY</small>
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
            }}
          />
        ) : (
          <section className="panel"><p className="empty-state">正在读取本地目录…</p></section>
        )}
        <RuleEditor definitions={definitions.data ?? []} rules={rules} />
      </div>

      <PreviewPanel
        preview={preview.data}
        selectedCount={selectedIds.length}
        isPending={preview.isPending}
        error={preview.error?.message}
        onPreview={() => preview.mutate()}
      />
    </main>
  );
}

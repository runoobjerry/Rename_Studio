import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPreview,
  executePreview,
  fetchFiles,
  fetchOneDriveStatus,
  fetchProviders,
  fetchRules,
} from "./api/client";
import { FileBrowser } from "./features/files/FileBrowser";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RuleEditor } from "./features/rules/RuleEditor";
import { OneDriveSettingsPanel } from "./features/settings/OneDriveSettingsPanel";
import { useRenameStore } from "./stores/useRenameStore";

export default function App() {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState("local");
  const [path, setPath] = useState("");
  const [cloudPath, setCloudPath] = useState("");
  const selectedIds = useRenameStore((state) => state.selectedIds);
  const rules = useRenameStore((state) => state.rules);
  const setRules = useRenameStore((state) => state.setRules);
  const toggleSelected = useRenameStore((state) => state.toggleSelected);
  const setSelectedIds = useRenameStore((state) => state.setSelectedIds);
  const clearSelection = useRenameStore((state) => state.clearSelection);

  const providers = useQuery({ queryKey: ["providers"], queryFn: fetchProviders });
  const definitions = useQuery({ queryKey: ["rules"], queryFn: fetchRules });
  const oneDriveStatus = useQuery({
    queryKey: ["onedrive", "status"],
    queryFn: fetchOneDriveStatus,
  });
  const files = useQuery({
    queryKey: ["files", providerId, path],
    queryFn: () => fetchFiles(providerId, path),
    enabled: providerId === "local" || oneDriveStatus.data?.connected === true,
  });
  const preview = useMutation({
    mutationFn: () => createPreview(providerId, selectedIds, rules),
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
  }, [path, providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (providerId !== "onedrive" || oneDriveStatus.data?.connected !== false) return;
    setPath("");
    setCloudPath("");
    clearSelection();
    preview.reset();
    execution.reset();
  }, [providerId, oneDriveStatus.data?.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadError = providers.error ?? definitions.error ?? oneDriveStatus.error;
  const activeProvider = providers.data?.find((provider) => provider.id === providerId);

  const navigate = (nextPath: string) => {
    setPath(nextPath);
    if (providerId === "onedrive") setCloudPath(nextPath);
  };

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">OneDriver Renamer · Local + OneDrive</p>
          <h1>先看清，再改名。</h1>
          <p className="hero-copy">规则驱动的批量重命名工作台，预览确认后再执行本地或 OneDrive 重命名。</p>
        </div>
        <div className="stage-badge">
          <span>M4</span>
          <small>ONEDRIVE PERSONAL</small>
        </div>
      </header>

      {loadError && <p className="error-banner">无法连接后端：{loadError.message}</p>}

      <div className="m4-grid">
        <section className="panel location-panel" aria-labelledby="location-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Storage Location</p>
              <h2 id="location-title">重命名位置</h2>
            </div>
          </div>
          <div className="location-content">
            <label>
              存储提供方
              <select
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setPath("");
                  setCloudPath("");
                }}
              >
                {(providers.data ?? []).map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>
            {providerId === "onedrive" ? (
              <form
                className="cloud-path-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  navigate(cloudPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
                }}
              >
                <label>
                  要更改的云端文件夹
                  <input
                    value={cloudPath}
                    onChange={(event) => setCloudPath(event.target.value)}
                    placeholder="例如：照片/待整理（留空表示根目录）"
                  />
                </label>
                <button type="submit" disabled={!oneDriveStatus.data?.connected}>打开文件夹</button>
              </form>
            ) : (
              <p className="settings-hint">本地目录：/{path || "（根目录）"}</p>
            )}
            {providerId === "onedrive" && !oneDriveStatus.data?.connected && (
              <p className="inline-error">请先在右侧保存应用设置并连接 OneDrive 账号。</p>
            )}
          </div>
        </section>
        <OneDriveSettingsPanel />
      </div>

      <div className="workspace-grid">
        {files.data ? (
          <FileBrowser
            listing={files.data}
            providerName={activeProvider?.name ?? providerId}
            selectedIds={selectedIds}
            onNavigate={navigate}
            onToggle={(fileId) => {
              toggleSelected(fileId);
              preview.reset();
              execution.reset();
            }}
            onSelectAll={() => {
              setSelectedIds(files.data.items.map((item) => item.id));
              preview.reset();
              execution.reset();
            }}
            onInvertSelection={() => {
              const selected = new Set(selectedIds);
              setSelectedIds(
                files.data.items
                  .filter((item) => !selected.has(item.id))
                  .map((item) => item.id),
              );
              preview.reset();
              execution.reset();
            }}
          />
        ) : (
          <section className="panel">
            <p className={files.error ? "inline-error" : "empty-state"}>
              {files.error
                ? `目录读取失败：${files.error.message}`
                : providerId === "onedrive" && !oneDriveStatus.data?.connected
                  ? "连接 OneDrive 后可浏览云端目录。"
                  : "正在读取目录…"}
            </p>
          </section>
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

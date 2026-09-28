import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPreview,
  executePreview,
  fetchFiles,
  fetchLocalSettings,
  fetchOneDriveStatus,
  fetchProviders,
  fetchRules,
  pickLocalFolder,
  updateLocalSettings,
} from "./api/client";
import { FileBrowser } from "./features/files/FileBrowser";
import { PreviewPanel } from "./features/rename/PreviewPanel";
import { RuleEditor } from "./features/rules/RuleEditor";
import { OneDriveSettingsPanel } from "./features/settings/OneDriveSettingsPanel";
import { useRenameStore } from "./stores/useRenameStore";

// 保留旧编排仅供迁移期间对照；应用入口与外部导入统一使用新工作台。
export function LegacyApp() {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState("local");
  const [path, setPath] = useState("");
  const [localRoot, setLocalRoot] = useState("");
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
  const localSettings = useQuery({
    queryKey: ["local", "settings"],
    queryFn: fetchLocalSettings,
  });
  const files = useQuery({
    queryKey: [
      "files",
      providerId,
      providerId === "local" ? localSettings.data?.root_path ?? "" : "",
      path,
    ],
    queryFn: () => fetchFiles(providerId, path),
    enabled:
      (providerId === "local" && localSettings.isSuccess) ||
      (providerId === "onedrive" && oneDriveStatus.data?.connected === true),
  });
  const preview = useMutation({
    mutationFn: () => createPreview(providerId, path, selectedIds, rules),
  });
  const execution = useMutation({
    mutationFn: executePreview,
    onSuccess: () => {
      clearSelection();
      // 先展示执行结果，目录刷新在后台完成，避免把读取延迟算入执行等待时间。
      void queryClient.invalidateQueries({ queryKey: ["files"] });
    },
  });
  const updateLocalRoot = useMutation({
    mutationFn: () => updateLocalSettings(localRoot.trim()),
    onSuccess: async (settings) => {
      setLocalRoot(settings.root_path);
      queryClient.setQueryData(["local", "settings"], settings);
      setPath("");
      clearSelection();
      preview.reset();
      execution.reset();
      await queryClient.invalidateQueries({ queryKey: ["files", "local"] });
    },
  });
  const pickLocalRoot = useMutation({
    mutationFn: pickLocalFolder,
    onSuccess: async (settings) => {
      if (!settings.selected) return;
      setLocalRoot(settings.root_path);
      queryClient.setQueryData(["local", "settings"], {
        root_path: settings.root_path,
      });
      setPath("");
      clearSelection();
      preview.reset();
      execution.reset();
      await queryClient.invalidateQueries({ queryKey: ["files", "local"] });
    },
  });

  useEffect(() => {
    if (localSettings.data?.root_path) setLocalRoot(localSettings.data.root_path);
  }, [localSettings.data?.root_path]);

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

  const loadError =
    providers.error ??
    definitions.error ??
    oneDriveStatus.error ??
    localSettings.error;
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
              <form
                className="cloud-path-form local-path-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateLocalRoot.mutate();
                }}
              >
                <label>
                  本地根文件夹
                  <input
                    value={localRoot}
                    onChange={(event) => setLocalRoot(event.target.value)}
                    placeholder="例如：D:\\待整理文件"
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => pickLocalRoot.mutate()}
                  disabled={pickLocalRoot.isPending}
                >
                  {pickLocalRoot.isPending ? "等待选择…" : "浏览…"}
                </button>
                <button
                  type="submit"
                  disabled={!localRoot.trim() || updateLocalRoot.isPending}
                >
                  {updateLocalRoot.isPending ? "切换中…" : "使用此文件夹"}
                </button>
              </form>
            )}
            {providerId === "local" && (
              <p className="settings-hint">当前位置：/{path || "（根目录）"}</p>
            )}
            {providerId === "local" && updateLocalRoot.error && (
              <p className="inline-error">切换失败：{updateLocalRoot.error.message}</p>
            )}
            {providerId === "local" && pickLocalRoot.error && (
              <p className="inline-error">无法打开文件夹选择器：{pickLocalRoot.error.message}</p>
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

export { default } from "./WorkspaceApp";

import type { DirectoryListing } from "../../types";

interface FileBrowserProps {
  listing: DirectoryListing;
  selectedIds: string[];
  onNavigate: (path: string) => void;
  onToggle: (fileId: string) => void;
}

function formatSize(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

export function FileBrowser({
  listing,
  selectedIds,
  onNavigate,
  onToggle,
}: FileBrowserProps) {
  return (
    <section className="panel browser" aria-labelledby="files-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Local Provider</p>
          <h2 id="files-title">文件</h2>
        </div>
        <code>/{listing.path}</code>
      </div>

      {listing.parent_path !== null && (
        <button className="back-button" onClick={() => onNavigate(listing.parent_path ?? "")}>
          ← 返回上级
        </button>
      )}

      <div className="file-list">
        {listing.items.map((item) =>
          item.is_directory ? (
            <button
              className="file-row directory"
              key={item.id}
              onClick={() => onNavigate(item.path)}
            >
              <span className="file-icon">⌁</span>
              <span className="file-name">{item.name}</span>
              <span className="file-meta">目录 →</span>
            </button>
          ) : (
            <label className="file-row" key={item.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span className="file-name">{item.name}</span>
              <span className="file-meta">{formatSize(item.size)}</span>
            </label>
          ),
        )}
        {listing.items.length === 0 && (
          <p className="empty-state">此目录为空。将测试文件放入本地存储目录后刷新。</p>
        )}
      </div>
    </section>
  );
}

import type { DirectoryListing } from "../../types";

interface FileBrowserProps {
  listing: DirectoryListing;
  providerName: string;
  selectedIds: string[];
  onNavigate: (path: string) => void;
  onToggle: (fileId: string) => void;
  onSelectAll: () => void;
  onInvertSelection: () => void;
}

function formatSize(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

export function FileBrowser({
  listing,
  providerName,
  selectedIds,
  onNavigate,
  onToggle,
  onSelectAll,
  onInvertSelection,
}: FileBrowserProps) {
  return (
    <section className="panel browser" aria-labelledby="files-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{providerName}</p>
          <h2 id="files-title">文件与文件夹</h2>
        </div>
        <div className="browser-heading-actions">
          <button type="button" onClick={onSelectAll} disabled={listing.items.length === 0}>
            全选
          </button>
          <button type="button" onClick={onInvertSelection} disabled={listing.items.length === 0}>
            反选
          </button>
          <code>/{listing.path}</code>
        </div>
      </div>

      {listing.parent_path !== null && (
        <button className="back-button" onClick={() => onNavigate(listing.parent_path ?? "")}>
          ← 返回上级
        </button>
      )}

      <div className="file-list">
        {listing.items.map((item) =>
          item.is_directory ? (
            <div
              className="file-row directory"
              key={item.id}
            >
              <input
                type="checkbox"
                aria-label={`选择文件夹 ${item.name}`}
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <button
                className="directory-name"
                onClick={() => onNavigate(item.path)}
              >
                <span className="file-icon">⌁</span>
                <span className="file-name">{item.name}</span>
              </button>
              <span className="file-meta">打开 →</span>
            </div>
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
          <p className="empty-state">此目录为空。</p>
        )}
      </div>
    </section>
  );
}

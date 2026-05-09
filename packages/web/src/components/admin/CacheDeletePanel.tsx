import React, { useState } from 'react';

interface CacheEntry {
  id: string;
  query: string;
  isManualOverride: boolean;
  updatedAt?: Date | null;
}

interface CacheDeletePanelProps {
  entries: CacheEntry[];
  csrfToken: string;
  onDeleted: (deletedCount: number) => void;
}

export const CacheDeletePanel: React.FC<CacheDeletePanelProps> = ({
  entries,
  csrfToken,
  onDeleted,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectDeletable = () => {
    const deletable = new Set<string>();
    entries.forEach((e) => {
      if (!e.isManualOverride) {
        deletable.add(e.id);
      }
    });
    setSelectedIds(deletable);
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/cache', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      if (!res.ok) {
        const text = await res.text();
        let data: { error?: string } = {};
        try { data = JSON.parse(text); } catch { /* ignore */ }
        throw new Error(data.error || `Delete failed (${res.status})`);
      }

      const text = await res.text();
      const data = (JSON.parse(text || '{}') as { success?: boolean; deleted?: number }) ?? {};
      onDeleted(data.deleted ?? selectedIds.size);
      setSelectedIds(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete cache entries.';
      setError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const deletableCount = entries.filter((e) => !e.isManualOverride).length;
  const hasDeletable = deletableCount > 0;

  return (
    <div className="delete-panel">
      <div className="delete-toolbar">
        <span className="delete-info">
          {deletableCount} of {entries.length} entries can be deleted (manual overrides protected)
        </span>
        {hasDeletable && (
          <button
            type="button"
            onClick={selectDeletable}
            disabled={deleting}
            className="btn-select-deletable"
          >
            Select deletable
          </button>
        )}
      </div>

      {error && <div className="delete-error">{error}</div>}

      <div className="delete-actions">
        <button
          type="button"
          onClick={handleDelete}
          disabled={selectedIds.size === 0 || deleting}
          className="btn-delete"
        >
          {deleting ? 'Deleting...' : `Delete selected (${selectedIds.size})`}
        </button>
      </div>

      <table className="data-table cache-table">
        <thead>
          <tr>
            <th className="col-select">
              <input
                type="checkbox"
                onChange={(e) => {
                  if (e.target.checked) {
                    const deletable = new Set<string>();
                    entries.forEach((entry) => {
                      if (!entry.isManualOverride) deletable.add(entry.id);
                    });
                    setSelectedIds(deletable);
                  } else {
                    setSelectedIds(new Set());
                  }
                }}
                disabled={!hasDeletable}
                aria-label="Select all deletable entries"
              />
            </th>
            <th>ID</th>
            <th>Query</th>
            <th>Manual</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isDeletable = !entry.isManualOverride;
            const isSelected = selectedIds.has(entry.id);
            return (
              <tr
                key={entry.id}
                className={`cache-entry ${!isDeletable ? 'protected' : ''} ${isSelected ? 'selected' : ''}`}
              >
                <td className="col-select">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => isDeletable && toggleSelect(entry.id)}
                    disabled={!isDeletable}
                    aria-label={`Select ${entry.query}`}
                  />
                </td>
                <td className="mono">{entry.id}</td>
                <td className="query-cell">{entry.query}</td>
                <td>
                  {entry.isManualOverride ? (
                    <span className="badge-manual">manual</span>
                  ) : (
                    <span className="badge-auto">auto</span>
                  )}
                </td>
                <td className="mono">
                  {entry.updatedAt
                    ? new Date(entry.updatedAt).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })
                    : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

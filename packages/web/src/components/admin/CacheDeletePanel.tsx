import React, { useState } from "react";

interface CacheEntry {
  id: string;
  query: string;
  isManualOverride: boolean;
  updatedAt?: Date | null;
}

interface CacheDeletePanelProps {
  entries: CacheEntry[];
  csrfToken: string;
}

export const CacheDeletePanel: React.FC<CacheDeletePanelProps> = ({
  entries,
  csrfToken,
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
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      if (!res.ok) {
        const text = await res.text();
        let data: { error?: string } = {};
        try {
          data = JSON.parse(text);
        } catch {
          /* ignore */
        }
        throw new Error(data.error || `Delete failed (${res.status})`);
      }

      setSelectedIds(new Set());
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete cache entries.";
      setError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const deletableCount = entries.filter((e) => !e.isManualOverride).length;
  const hasDeletable = deletableCount > 0;

  return (
    <section className="mt-6 rounded-[20px] border border-graphite-180 bg-porcelain-100 p-5 shadow-[0_1px_0_oklch(78%_0.012_255_/_0.35)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-graphite-500">
            Cache delete preview
          </p>
          <p className="mt-1 text-[14px] text-graphite-650">
            {deletableCount} of {entries.length} entries can be deleted. Manual overrides stay protected.
          </p>
        </div>
        {hasDeletable && (
          <button
            type="button"
            onClick={selectDeletable}
            disabled={deleting}
            className="rounded-[10px] border border-graphite-300 bg-porcelain-50 px-4 py-2 text-[14px] font-semibold text-graphite-800 transition-colors hover:bg-porcelain-150 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Select deletable
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-[12px] border border-danger-600/30 bg-danger-100 px-4 py-3 text-[14px] text-danger-800">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-graphite-500">
          Selected <span className="font-semibold text-graphite-800">{selectedIds.size}</span>
        </p>
        <button
          type="button"
          onClick={handleDelete}
          disabled={selectedIds.size === 0 || deleting}
          className="rounded-[10px] border border-danger-600/30 bg-danger-100 px-4 py-2 text-[14px] font-semibold text-danger-600 transition-colors hover:bg-danger-100/80 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? "Deleting..." : `Delete selected (${selectedIds.size})`}
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-[16px] border border-graphite-180 bg-porcelain-50">
        <table className="min-w-full border-collapse text-left text-[14px]">
          <thead className="bg-porcelain-150 text-[12px] uppercase tracking-[0.08em] text-graphite-500">
            <tr>
              <th className="w-10 px-4 py-3">
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
                  className="h-4 w-4 rounded border-graphite-300 text-royal-blue-600 focus-visible:ring-royal-blue-100"
                />
              </th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Query</th>
              <th className="px-4 py-3">Manual</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isDeletable = !entry.isManualOverride;
              const isSelected = selectedIds.has(entry.id);
              return (
                <tr
                  key={entry.id}
                  className={`border-t border-graphite-180 ${isSelected ? "bg-royal-blue-50" : "bg-transparent"} ${!isDeletable ? "opacity-70" : ""}`}
                >
                  <td className="px-4 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => isDeletable && toggleSelect(entry.id)}
                      disabled={!isDeletable}
                      aria-label={`Select ${entry.query}`}
                      className="h-4 w-4 rounded border-graphite-300 text-royal-blue-600 focus-visible:ring-royal-blue-100"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-graphite-800">{entry.id}</td>
                  <td className="px-4 py-3 text-[14px] text-graphite-800">{entry.query}</td>
                  <td className="px-4 py-3">
                    {entry.isManualOverride ? (
                      <span className="inline-flex rounded-full bg-royal-blue-100 px-2.5 py-1 text-[12px] font-semibold text-royal-blue-700">
                        manual
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-porcelain-150 px-2.5 py-1 text-[12px] font-semibold text-graphite-650">
                        auto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-graphite-650">
                    {entry.updatedAt
                      ? new Date(entry.updatedAt).toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

import React, { useMemo, useState } from "react";
import CacheEditModal from "./CacheEditModal";

interface CacheEntry {
  id: string;
  query: string;
  promptVersion: string;
  outputBucketLabel: string;
  isManualOverride: boolean;
  isDeleteProtected: boolean;
  updatedAt?: Date | null;
}

interface CacheDeletePanelProps {
  entries: CacheEntry[];
  csrfToken: string;
}

interface DeleteCacheResponse {
  success?: boolean;
  deleted?: number;
  error?: string;
  traceId?: string;
  stage?: string;
}

export const CacheDeletePanel: React.FC<CacheDeletePanelProps> = ({
  entries,
  csrfToken,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const lockedSelectedCount = useMemo(
    () => entries.filter((e) => selectedIds.has(e.id) && e.isDeleteProtected).length,
    [entries, selectedIds],
  );

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

  const executeDelete = async (force: boolean) => {
    setShowConfirmDelete(false);
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/cache', {
        method: 'DELETE',
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ ids: Array.from(selectedIds), forceDeleteProtected: force }),
      });

      const responseText = await res.text();
      let data: DeleteCacheResponse = {};
      try {
        data = JSON.parse(responseText) as DeleteCacheResponse;
      } catch {
        data = { error: responseText };
      }

      if (!res.ok) {
        throw new Error(data.error || `Delete failed (${res.status})`);
      }

      setSelectedIds(new Set());
      window.setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete cache entries.";
      setError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteClick = () => {
    if (selectedIds.size === 0) return;
    setShowConfirmDelete(true);
  };

  const deletableCount = entries.filter((e) => !e.isDeleteProtected).length;

  return (
    <>
    <section className="mt-6 rounded-[20px] border border-graphite-180 bg-porcelain-100 p-5 shadow-[0_1px_0_oklch(78%_0.012_255_/_0.35)]">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-graphite-500">
          Cache delete preview
        </p>
        <p className="mt-1 text-[14px] text-graphite-650">
          {deletableCount} of {entries.length} entries can be deleted. Locked rows stay protected.
        </p>
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
          onClick={handleDeleteClick}
          disabled={selectedIds.size === 0 || deleting}
          aria-label={`Delete ${selectedIds.size} selected entries`}
          title="Delete selected"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 14px 6px 12px",
            border: "1px solid var(--color-danger-600)",
            borderRadius: "999px",
            background: "var(--color-danger-100)",
            color: "var(--color-danger-600)",
            cursor: selectedIds.size === 0 || deleting ? "not-allowed" : "pointer",
            opacity: selectedIds.size === 0 || deleting ? 0.6 : 1,
            transition: "all 0.12s",
            fontSize: "14px",
            fontWeight: 600,
          }}
          onMouseEnter={(e) => {
            if (selectedIds.size > 0 && !deleting) {
              e.currentTarget.style.background = "var(--color-danger-100)";
              e.currentTarget.style.borderColor = "var(--color-danger-600)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--color-danger-100)";
            e.currentTarget.style.borderColor = "var(--color-danger-600)";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "18px",
            height: "18px",
            borderRadius: "999px",
            background: "var(--color-danger-600)",
            color: "oklch(99% 0.002 90)",
            fontSize: "11px",
            fontWeight: 700,
            lineHeight: 1,
            padding: "0 5px",
          }}>
            {deleting ? "..." : selectedIds.size}
          </span>
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
                        if (!entry.isDeleteProtected) deletable.add(entry.id);
                      });
                      setSelectedIds(deletable);
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  disabled={deletableCount === 0}
                  aria-label="Select all deletable entries"
                  className="h-4 w-4 rounded border-graphite-300 text-royal-blue-600 focus-visible:ring-royal-blue-100"
                />
              </th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Query</th>
              <th className="px-4 py-3">Prompt Version</th>
              <th className="px-4 py-3">Output Bucket</th>
              <th className="px-4 py-3">Protection</th>
              <th className="px-4 py-3">Updated</th>
              <th className="w-14 px-4 py-3 text-center">Edit</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isSelected = selectedIds.has(entry.id);
              return (
                <tr
                  key={entry.id}
                  className={`border-t border-graphite-180 ${isSelected ? "bg-royal-blue-50" : "bg-transparent"} ${entry.isDeleteProtected ? "opacity-70" : ""}`}
                >
                  <td className="px-4 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(entry.id)}
                      aria-label={`Select ${entry.query}`}
                      className="h-4 w-4 rounded border-graphite-300 text-royal-blue-600 focus-visible:ring-royal-blue-100"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-graphite-800">{entry.id}</td>
                  <td className="px-4 py-3 text-[14px] text-graphite-800">{entry.query}</td>
                  <td className="px-4 py-3 font-mono text-[13px] text-graphite-650">
                    {entry.promptVersion}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-porcelain-150 px-2.5 py-1 text-[12px] font-semibold text-graphite-700">
                      {entry.outputBucketLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {entry.isManualOverride ? (
                        <span className="inline-flex rounded-full bg-royal-blue-100 px-2.5 py-1 text-[12px] font-semibold text-royal-blue-700">
                          manual
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-porcelain-150 px-2.5 py-1 text-[12px] font-semibold text-graphite-650">
                          auto
                        </span>
                      )}
                      {entry.isDeleteProtected ? (
                        <span className="inline-flex rounded-full bg-danger-100 px-2.5 py-1 text-[12px] font-semibold text-danger-700">
                          locked
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
                          open
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-graphite-650">
                    {entry.updatedAt
                      ? new Date(entry.updatedAt).toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-center align-top">
                    <button
                      type="button"
                      onClick={() => setEditingId(entry.id)}
                      aria-label={`Edit response for ${entry.query}`}
                      title="Edit"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "32px",
                        height: "32px",
                        border: "1px solid transparent",
                        borderRadius: "8px",
                        background: "transparent",
                        color: "var(--color-graphite-400)",
                        cursor: "pointer",
                        transition: "all 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--color-royal-blue-100)";
                        e.currentTarget.style.color = "var(--color-royal-blue-600)";
                        e.currentTarget.style.borderColor = "var(--color-royal-blue-100)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--color-graphite-400)";
                        e.currentTarget.style.borderColor = "transparent";
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>

      {showConfirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-graphite-900/40"
            onClick={() => setShowConfirmDelete(false)}
          />
          <div className="relative z-10 mx-4 w-full max-w-md rounded-[20px] border border-graphite-180 bg-porcelain-50 p-6 shadow-[0_2px_12px_oklch(25%_0.02_255_/_0.25)]">
            <p className="text-[14px] font-semibold text-graphite-800">
              Delete {selectedIds.size} {selectedIds.size === 1 ? "entry" : "entries"}?
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-graphite-600">
              {lockedSelectedCount > 0
                ? `${lockedSelectedCount} of ${selectedIds.size} selected ${lockedSelectedCount === 1 ? "entry is" : "entries are"} delete-protected. `
                : ""}
              This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmDelete(false)}
                className="rounded-[10px] border border-graphite-300 bg-porcelain-50 px-4 py-2 text-[14px] font-semibold text-graphite-800 transition-colors hover:bg-porcelain-150"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeDelete(lockedSelectedCount > 0)}
                className="rounded-[10px] border border-danger-600/30 bg-danger-100 px-4 py-2 text-[14px] font-semibold text-danger-600 transition-colors hover:bg-danger-100/80"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {editingId && (
        <CacheEditModal
          entryId={editingId}
          queryLabel={entries.find((e) => e.id === editingId)?.query ?? ""}
          csrfToken={csrfToken}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  );
};

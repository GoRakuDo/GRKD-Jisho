import React, { useEffect, useMemo, useState } from "react";

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

type FlowStatus = "idle" | "pending" | "success" | "error";

interface FlowStep {
  label: string;
  detail: string;
  status: FlowStatus;
}

interface ApiFlowStep {
  stage: string;
  status: "ok" | "error";
  detail: string;
}

interface DeleteCacheResponse {
  success?: boolean;
  deleted?: number;
  error?: string;
  traceId?: string;
  stage?: string;
  flow?: ApiFlowStep[];
}

const getStageLabel = (stage: string): string => {
  if (stage.startsWith("request.") || stage.startsWith("body.")) return "Client";
  if (stage === "auth" || stage === "csrf") return "Server: Auth";
  if (stage.startsWith("pre-filter")) return "Server: Filter";
  if (stage === "bulk-delete") return "Server: Delete";
  if (stage === "audit.log") return "Server: Audit";
  if (stage === "server.error") return "Server: Error";
  return "Server";
};

export const CacheDeletePanel: React.FC<CacheDeletePanelProps> = ({
  entries,
  csrfToken,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowStep[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const deletableIds = useMemo(() => entries.filter((e) => !e.isManualOverride).map((e) => e.id), [entries]);

  useEffect(() => {
    setFlow([
      { label: "Client", detail: "Select rows to delete", status: "idle" },
      { label: "Client", detail: "Send DELETE request", status: "idle" },
      { label: "Server", detail: "Validate auth / CSRF / body", status: "idle" },
      { label: "Server", detail: "Filter manual overrides", status: "idle" },
      { label: "Server", detail: "Run bulk delete", status: "idle" },
      { label: "Server", detail: "Write audit log", status: "idle" },
      { label: "Client", detail: "Reload cache list", status: "idle" },
    ]);
  }, [entries]);

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
    setSelectedIds(new Set(deletableIds));
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    setError(null);
    setSuccessMessage(null);

    const initialFlow: FlowStep[] = [
      { label: "Client", detail: "Selected rows prepared", status: "success" },
      { label: "Client", detail: "DELETE request sent", status: "pending" },
      { label: "Server", detail: "CSRF / body / auth checks pending", status: "idle" },
      { label: "Server", detail: "Manual override filter pending", status: "idle" },
      { label: "Server", detail: "Bulk delete pending", status: "idle" },
      { label: "Server", detail: "Audit log pending", status: "idle" },
      { label: "Client", detail: "UI refresh pending", status: "idle" },
    ];
    setFlow(initialFlow);

    try {
      const res = await fetch('/api/admin/cache', {
        method: 'DELETE',
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      const responseText = await res.text();
      let data: DeleteCacheResponse = {};
      try {
        data = JSON.parse(responseText) as DeleteCacheResponse;
      } catch {
        data = { error: responseText };
      }

      setTraceId(data.traceId ?? null);

      if (data.flow && data.flow.length > 0) {
        setFlow(data.flow.map((step) => ({
          label: getStageLabel(step.stage),
          detail: step.detail,
          status: step.status === "ok" ? "success" : "error",
        })));
      } else {
        setFlow((prev) => prev.map((step, index) => index === 1 ? { ...step, status: res.ok ? "success" : "error" } : step));
      }

      if (!res.ok) {
        const stageLabel = data.stage ? ` [${data.stage}]` : "";
        throw new Error((data.error || `Delete failed (${res.status})`) + stageLabel);
      }

      setSuccessMessage(`Deleted ${data.deleted ?? 0} entries successfully.`);
      setSelectedIds(new Set());
      setFlow((prev) => prev.map((step) => ({ ...step, status: "success" })));
      window.setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete cache entries.";
      setError(msg);
      setFlow((prev) => prev.map((step, index) => index === 1 || index === prev.length - 1 ? { ...step, status: "error" } : step));
    } finally {
      setDeleting(false);
    }
  };

  const deletableCount = entries.filter((e) => !e.isManualOverride).length;
  const hasDeletable = deletableCount > 0;

  return (
    <section className="mt-6 rounded-[20px] border border-graphite-180 bg-porcelain-100 p-5 shadow-[0_1px_0_oklch(78%_0.012_255_/_0.35)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-graphite-500">
            Cache delete preview
          </p>
          <p className="mt-1 text-[14px] text-graphite-650">
            {deletableCount} of {entries.length} entries can be deleted. Manual overrides stay protected.
          </p>
          {traceId && (
            <p className="mt-2 text-[12px] font-mono text-graphite-500">
              Trace: {traceId}
            </p>
          )}
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

      {successMessage && (
        <div className="mt-4 rounded-[12px] border border-royal-blue-600/30 bg-royal-blue-50 px-4 py-3 text-[14px] text-royal-blue-800">
          {successMessage}
        </div>
      )}

      <div className="mt-4 rounded-[16px] border border-graphite-180 bg-porcelain-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-graphite-500">
            Logic flow
          </p>
          <p className="text-[12px] text-graphite-500">
            The last red step is where it stopped.
          </p>
        </div>
        <ol className="mt-3 space-y-2">
          {flow.map((step, index) => (
            <li
              key={`${step.label}-${index}`}
              className={`flex items-start gap-3 rounded-[12px] border px-3 py-2 text-[13px] ${
                step.status === "success"
                  ? "border-royal-blue-100 bg-royal-blue-50 text-graphite-800"
                  : step.status === "error"
                    ? "border-danger-600/30 bg-danger-100 text-danger-800"
                    : step.status === "pending"
                      ? "border-graphite-180 bg-porcelain-100 text-graphite-650"
                      : "border-graphite-180 bg-porcelain-50 text-graphite-600"
              }`}
            >
              <span className="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold">
                {step.status === "success" ? "✓" : step.status === "error" ? "!" : step.status === "pending" ? "…" : "·"}
              </span>
              <div className="min-w-0">
                <div className="font-semibold">
                  {step.label}
                </div>
                <div className="mt-0.5 break-words text-[12px] opacity-90">
                  {step.detail}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>

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

import { useState, useEffect, useRef } from "react";

interface ResponseDetail {
  id: string;
  query: string;
  roleKey: string;
  modelName: string;
  promptVersion: string;
  isManualOverride: boolean;
  updatedAt: string | null;
  responseText: string;
}

interface CacheEditModalProps {
  entryId: string;
  queryLabel: string;
  csrfToken: string;
  onClose: () => void;
}

export default function CacheEditModal({ entryId, queryLabel, csrfToken, onClose }: CacheEditModalProps) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ResponseDetail | null>(null);
  const [editedText, setEditedText] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/admin/responses?id=${entryId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.response) {
          setDetail(data.response);
          setEditedText(data.response.responseText);
        } else {
          setFetchError(data.error || "Failed to load response");
        }
      })
      .catch(() => setFetchError("Network error"))
      .finally(() => setLoading(false));
  }, [entryId]);

  useEffect(() => {
    if (!loading && detail && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading, detail]);

  const handleSave = async () => {
    if (!editedText.trim()) {
      setError("Response text cannot be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/responses", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ id: entryId, responseText: editedText, reason: reason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? `Save failed (${res.status})`);
        return;
      }
      window.setTimeout(() => window.location.reload(), 700);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  /* ── Escape key ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, saving]);

  return (
    <div
      onClick={handleOverlayClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "oklch(20% 0.018 255 / 0.45)",
        backdropFilter: "blur(2px)",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "720px",
          maxHeight: "90dvh",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-porcelain-50)",
          borderRadius: "var(--radius-modal, 24px)",
          border: "1px solid var(--color-graphite-180)",
                    boxShadow: "0 8px 32px oklch(20% 0.018 255 / 0.12), 0 2px 8px oklch(20% 0.018 255 / 0.06)",
          overflow: "hidden",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--color-graphite-180)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--color-graphite-800)",
                letterSpacing: "-0.01em",
              }}
            >
              Edit cache response
            </span>
            <span
              style={{
                fontSize: "13px",
                color: "var(--color-graphite-500)",
                fontFamily: "var(--font-grkd-sans)",
              }}
            >
              ID {entryId} &middot; &ldquo;{queryLabel.length > 50 ? queryLabel.slice(0, 50) + "…" : queryLabel}&rdquo;
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              border: "1px solid transparent",
              borderRadius: "10px",
              background: "transparent",
              color: "var(--color-graphite-500)",
              cursor: "pointer",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-porcelain-150)";
              e.currentTarget.style.color = "var(--color-graphite-800)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--color-graphite-500)";
            }}
          >
            {/* X icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "40px 0" }}>
              <div style={{ height: "14px", width: "40%", background: "var(--color-porcelain-150)", borderRadius: "6px" }} />
              <div style={{ height: "120px", background: "var(--color-porcelain-150)", borderRadius: "10px" }} />
              <div style={{ height: "14px", width: "30%", background: "var(--color-porcelain-150)", borderRadius: "6px" }} />
            </div>
          )}

          {fetchError && (
            <div
              style={{
                padding: "40px 0",
                textAlign: "center",
                color: "var(--color-danger-600)",
                fontSize: "14px",
              }}
            >
              {fetchError}
            </div>
          )}

          {detail && (
            <>
              {/* ── Meta row ── */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "16px",
                  paddingBottom: "16px",
                  marginBottom: "20px",
                  borderBottom: "1px solid var(--color-graphite-180)",
                }}
              >
                <MetaChip label="Output Bucket" value={detail.roleKey} />
                <MetaChip label="Model" value={detail.modelName} />
                <MetaChip label="Prompt" value={`v${detail.promptVersion}`} />
                {detail.isManualOverride ? (
                  <MetaChip label="Status" value="Override" accent="var(--color-royal-blue-600)" />
                ) : (
                  <MetaChip label="Status" value="Generated" />
                )}
                {detail.updatedAt && (
                  <MetaChip
                    label="Updated"
                    value={new Date(detail.updatedAt).toLocaleString("en-US", { timeZone: "Asia/Jakarta" })}
                  />
                )}
              </div>

              {/* ── Textarea ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-graphite-500)",
                    }}
                  >
                    Response text
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--color-graphite-500)",
                      fontFamily: "var(--font-grkd-mono)",
                      background: "var(--color-porcelain-150)",
                      padding: "2px 8px",
                      borderRadius: "999px",
                    }}
                  >
                    Markdown
                  </span>
                </div>
                <textarea
                  ref={textareaRef}
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  disabled={saving}
                  style={{
                    width: "100%",
                    minHeight: "220px",
                    padding: "14px",
                    borderRadius: "var(--radius-input, 10px)",
                    border: "1px solid var(--color-graphite-300)",
                    background: "var(--color-porcelain-50)",
                    color: "var(--color-graphite-900)",
                    fontFamily: "var(--font-grkd-sans)",
                    fontSize: "14px",
                    lineHeight: 1.6,
                    outline: "none",
                    resize: "vertical",
                    boxSizing: "border-box",
                    transition: "border-color 0.12s",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-royal-blue-600)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-graphite-300)";
                  }}
                />
              </div>

              {/* ── Reason ── */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  marginTop: "16px",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--color-graphite-500)",
                  }}
                >
                  Reason (optional)
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Fix terminology, clarify definition"
                  disabled={saving}
                  style={{
                    width: "100%",
                    height: "40px",
                    padding: "0 14px",
                    borderRadius: "var(--radius-input, 10px)",
                    border: "1px solid var(--color-graphite-300)",
                    background: "var(--color-porcelain-50)",
                    color: "var(--color-graphite-900)",
                    fontSize: "14px",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color 0.12s",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-royal-blue-600)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-graphite-300)";
                  }}
                />
              </div>

              {error && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    background: "var(--color-danger-100)",
                    border: "1px solid oklch(78% 0.08 28 / 0.3)",
                    color: "var(--color-danger-600)",
                    fontSize: "13px",
                  }}
                >
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "10px",
            padding: "16px 24px 20px",
            borderTop: "1px solid var(--color-graphite-180)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              height: "38px",
              padding: "0 16px",
              borderRadius: "var(--radius-button, 10px)",
              border: "1px solid var(--color-graphite-300)",
              background: "var(--color-porcelain-50)",
              color: "var(--color-graphite-700)",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-porcelain-150)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-porcelain-50)"; }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !detail}
            style={{
              height: "38px",
              padding: "0 20px",
              borderRadius: "var(--radius-button, 10px)",
              border: "1px solid var(--color-royal-blue-700)",
              background: "var(--color-royal-blue-600)",
              color: "var(--color-porcelain-50)",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              opacity: saving || !detail ? 0.65 : 1,
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => {
              if (!saving && detail) e.currentTarget.style.background = "var(--color-royal-blue-700)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--color-royal-blue-600)";
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Small meta chip ── */
function MetaChip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span
        style={{
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--color-graphite-500)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "13px",
          fontWeight: 500,
          fontFamily: "var(--font-grkd-mono)",
          color: accent ?? "var(--color-graphite-800)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

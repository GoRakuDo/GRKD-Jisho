import React, { useState, useEffect } from 'react';

export interface ResponseDetailPanelProps {
  id: string;
  query: string;
  outputBucketLabel: string;
  model: string;
  promptVersion: string;
  isOverride: boolean;
  text: string;
}

export default function ResponseDetailPanel({
  id,
  query,
  outputBucketLabel,
  model,
  promptVersion,
  isOverride,
  text: initialText,
}: ResponseDetailPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(initialText);
  const [editedText, setEditedText] = useState(initialText);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [csrfToken, setCsrfToken] = useState('');

  useEffect(() => {
    fetch('/api/auth/csrf-token')
      .then(res => res.json())
      .then(data => {
        if (data && data.token) setCsrfToken(data.token);
        else throw new Error('Invalid CSRF response');
      })
      .catch(() => {
        setSaveError('Security token initialization failed. Please refresh the page.');
      });
  }, []);

  useEffect(() => {
    setText(initialText);
    setEditedText(initialText);
  }, [initialText]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/admin/responses', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ id, responseText: editedText, reason: editReason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.error ?? `Save failed (${res.status})`);
        return;
      }
      setText(editedText);
      setIsEditing(false);
      setEditedText(editedText);
      setEditReason('');
    } catch (error) {
      setSaveError('Network error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/responses?id=${id}`, {
        method: 'DELETE',
        headers: {
          'x-csrf-token': csrfToken,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDeleteError(err.error ?? `Delete failed (${res.status})`);
        return;
      }
      window.location.href = '/admin/responses';
    } catch (error) {
      setDeleteError('Network error');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleCancel = () => {
    setEditedText(text);
    setIsEditing(false);
  };

  const containerStyle: React.CSSProperties = {
    fontFamily: 'var(--font-grkd-sans)',
    backgroundColor: 'var(--color-porcelain-100)',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-graphite-180)',
    padding: '24px',
    color: 'var(--color-graphite-800)',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  };

  const headerGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '16px',
    paddingBottom: '24px',
    borderBottom: '1px solid var(--color-graphite-180)',
  };

  const metaGroupStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--color-graphite-500)',
  };

  const valueStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: 'var(--color-graphite-900)',
    fontWeight: 500,
  };

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: 600,
    backgroundColor: isOverride ? 'var(--color-success-100)' : 'var(--color-porcelain-200)',
    color: isOverride ? 'var(--color-success-600)' : 'var(--color-graphite-650)',
    width: 'fit-content',
  };

  const btnBaseStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 'var(--radius-button)',
    border: 'none',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  };

  const fileInputWrapperStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };

  const fileInputLabelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--color-graphite-500)',
  };

  return (
    <div style={containerStyle}>
      <div style={headerGridStyle}>
        <div style={metaGroupStyle}>
          <span style={labelStyle}>ID</span>
          <span style={{ ...valueStyle, fontFamily: 'var(--font-grkd-mono)' }}>{id}</span>
        </div>
        <div style={metaGroupStyle}>
          <span style={labelStyle}>Query</span>
          <span style={valueStyle}>{query}</span>
        </div>
        <div style={metaGroupStyle}>
          <span style={labelStyle}>Output Bucket / Model</span>
          <span style={valueStyle}>{outputBucketLabel} &middot; {model}</span>
        </div>
        <div style={metaGroupStyle}>
          <span style={labelStyle}>Prompt</span>
          <span style={valueStyle}>v{promptVersion}</span>
        </div>
        <div style={metaGroupStyle}>
          <span style={labelStyle}>Status</span>
          <span style={badgeStyle}>{isOverride ? 'Overridden' : 'Generated'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-graphite-900)' }}>Response Text</h3>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              style={{
                ...btnBaseStyle,
                backgroundColor: 'transparent',
                border: '1px solid var(--color-graphite-300)',
                color: 'var(--color-graphite-800)',
              }}
            >
              Edit Response
            </button>
          )}
        </div>

        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              style={{
                width: '100%',
                minHeight: '200px',
                padding: '12px',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-royal-blue-600)',
                backgroundColor: 'var(--color-porcelain-50)',
                color: 'var(--color-graphite-900)',
                fontFamily: 'var(--font-grkd-sans)',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={fileInputWrapperStyle}>
              <label style={fileInputLabelStyle}>Reason (optional)</label>
              <input
                type="text"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g., Fix terminology, update definition"
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-graphite-300)',
                  backgroundColor: 'var(--color-porcelain-50)',
                  color: 'var(--color-graphite-900)',
                  fontSize: '0.875rem',
                  outline: 'none',
                  width: '100%',
                }}
              />
            </div>
            {saveError && (
              <div style={{
                padding: '8px 12px',
                backgroundColor: 'var(--color-porcelain-50)',
                border: '1px solid oklch(0.8 0.1 25)',
                borderLeft: '4px solid oklch(0.6 0.2 25)',
                borderRadius: 'var(--radius-card)',
                color: 'oklch(0.4 0.15 25)',
                fontSize: '0.8rem',
              }}>
                {saveError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={handleCancel}
                disabled={isSaving}
                style={{
                  ...btnBaseStyle,
                  backgroundColor: 'transparent',
                  color: 'var(--color-graphite-700)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                style={{
                  ...btnBaseStyle,
                  backgroundColor: 'var(--color-royal-blue-600)',
                  color: 'var(--color-porcelain-50)',
                }}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--color-porcelain-50)',
                borderRadius: 'var(--radius-card)',
                border: '1px solid var(--color-graphite-180)',
                color: 'var(--color-graphite-700)',
                fontSize: '0.875rem',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {text}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setIsEditing(true)}
                  style={{
                    ...btnBaseStyle,
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-graphite-300)',
                    color: 'var(--color-graphite-800)',
                  }}
                >
                  Edit Response
                </button>
                {!isOverride && (
                  <>
                    {showDeleteConfirm ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-danger-600)' }}>
                          Delete this response?
                        </span>
                        <button
                          onClick={handleDelete}
                          disabled={isDeleting}
                          style={{
                            ...btnBaseStyle,
                            backgroundColor: 'var(--color-danger-600)',
                            color: 'var(--color-porcelain-50)',
                          }}
                        >
                          {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          style={{
                            ...btnBaseStyle,
                            backgroundColor: 'transparent',
                            color: 'var(--color-graphite-700)',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={isDeleting}
                        style={{
                          ...btnBaseStyle,
                          backgroundColor: 'transparent',
                          border: '1px solid var(--color-danger-600)',
                          color: 'var(--color-danger-600)',
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {deleteError && (
              <div style={{
                padding: '8px 12px',
                backgroundColor: 'var(--color-danger-100)',
                border: '1px solid var(--color-danger-600)',
                borderLeft: '4px solid var(--color-danger-600)',
                borderRadius: 'var(--radius-card)',
                color: 'var(--color-danger-600)',
                fontSize: '0.8rem',
              }}>
                {deleteError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

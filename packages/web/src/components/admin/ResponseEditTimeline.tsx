import React from 'react';

export interface EditRecord {
  editorDiscordId: string;
  reason: string | null;
  beforeText: string;
  afterText: string;
  createdAt: string | null;
}

export interface ResponseEditTimelineProps {
  edits: EditRecord[];
}

export default function ResponseEditTimeline({ edits }: ResponseEditTimelineProps) {
  if (!edits || edits.length === 0) {
    return (
      <div style={{
        padding: '24px',
        textAlign: 'center',
        color: 'var(--color-graphite-500)',
        fontFamily: 'var(--font-grkd-sans)',
        fontSize: '0.875rem',
        backgroundColor: 'var(--color-porcelain-100)',
        borderRadius: 'var(--radius-card)',
        border: '1px dashed var(--color-graphite-300)',
      }}>
        No edits recorded.
      </div>
    );
  }

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    fontFamily: 'var(--font-grkd-sans)',
  };

  const itemStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-porcelain-100)',
    border: '1px solid var(--color-graphite-180)',
    borderRadius: 'var(--radius-card)',
    overflow: 'hidden',
  };

  const summaryStyle: React.CSSProperties = {
    padding: '16px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'var(--color-porcelain-100)',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--color-graphite-900)',
    listStyle: 'none', // Hides default marker in many browsers
  };

  const detailsContentStyle: React.CSSProperties = {
    padding: '0 16px 16px 16px',
    borderTop: '1px solid var(--color-graphite-180)',
    backgroundColor: 'var(--color-porcelain-50)',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  };

  const diffSectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '16px',
  };

  const diffLabelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--color-graphite-500)',
  };

  const diffTextStyle: React.CSSProperties = {
    padding: '12px',
    borderRadius: 'var(--radius-card)',
    fontSize: '0.875rem',
    fontFamily: 'var(--font-grkd-mono)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    border: '1px solid var(--color-graphite-180)',
    backgroundColor: 'var(--color-porcelain-100)',
    color: 'var(--color-graphite-700)',
    maxHeight: '250px',
    overflowY: 'auto',
  };

  return (
    <div style={containerStyle}>
      {edits.map((edit, index) => {
        const date = edit.createdAt
          ? new Date(edit.createdAt).toLocaleString(undefined, {
              year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit'
            })
          : 'unknown date';

        return (
          <details key={index} style={itemStyle}>
            <summary style={summaryStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ color: 'var(--color-royal-blue-600)', fontWeight: 600 }}>
                  Editor: {edit.editorDiscordId}
                </span>
                <span style={{ color: 'var(--color-graphite-500)', fontSize: '0.875rem' }}>
                  {date}
                </span>
              </div>
              <div style={{ color: 'var(--color-graphite-650)', fontSize: '0.875rem', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {edit.reason || 'No reason provided'}
              </div>
            </summary>
            
            <div style={detailsContentStyle}>
              <div style={diffSectionStyle}>
                <span style={diffLabelStyle}>Before</span>
                <div style={diffTextStyle}>{edit.beforeText}</div>
              </div>
              <div style={diffSectionStyle}>
                <span style={diffLabelStyle}>After</span>
                <div style={diffTextStyle}>{edit.afterText}</div>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

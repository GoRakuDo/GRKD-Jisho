import React, { useState, useCallback } from 'react';

interface DictionaryRowProps {
  id: string;
  name: string;
  slug: string;
  priority: number;
  enabled: boolean;
  entryCount: number;
  csrfToken: string;
  onUpdate: (id: string, updated: { enabled?: boolean; priority?: number }) => void;
}

export const DictionaryRow: React.FC<DictionaryRowProps> = ({
  id,
  name,
  slug,
  priority: initialPriority,
  enabled: initialEnabled,
  entryCount,
  csrfToken,
  onUpdate,
}) => {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [priority, setPriority] = useState(initialPriority);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleToggleEnabled = useCallback(async () => {
    if (saving) return;
    setSaving('enabled');
    setSaveError(null);
    const optimistic = !enabled;
    setEnabled(optimistic);

    try {
      const res = await fetch('/api/admin/dictionaries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ id: Number(id), enabled: optimistic }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      onUpdate(id, { enabled: optimistic });
    } catch (err) {
      setEnabled(!optimistic);
      const msg = err instanceof Error ? err.message : 'Failed to update status';
      setSaveError(msg);
      setTimeout(() => setSaveError(null), 3000);
    } finally {
      setSaving(null);
    }
  }, [enabled, id, csrfToken, saving, onUpdate]);

  const handlePriorityChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (saving) return;
    const val = e.target.value;
    const next = val === '' ? 0 : Math.max(0, Math.min(9999, Number(val)));
    setPriority(next);
    setSaveError(null);
    setSaving('priority');

    try {
      const res = await fetch('/api/admin/dictionaries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ id: Number(id), priority: next }),
      });
      if (!res.ok) throw new Error('Failed to update priority');
      onUpdate(id, { priority: next });
    } catch (err) {
      setPriority(priority);
      const msg = err instanceof Error ? err.message : 'Failed to update priority';
      setSaveError(msg);
      setTimeout(() => setSaveError(null), 3000);
    } finally {
      setSaving(null);
    }
  };

  return (
    <tr>
      <td className="priority-cell">
        <input
          type="number"
          min={0}
          max={9999}
          value={priority}
          onChange={handlePriorityChange}
          disabled={saving === 'priority'}
          className="priority-input"
          aria-label={`Priority for ${name}`}
        />
      </td>
      <td className="name-cell">{name}</td>
      <td className="mono">{slug}</td>
      <td className="mono">{entryCount.toLocaleString()}</td>
      <td>
        <button
          onClick={handleToggleEnabled}
          disabled={saving === 'enabled'}
          className={`status-toggle ${enabled ? 'enabled' : 'disabled'}`}
          aria-label={`Toggle enabled for ${name}`}
          title={enabled ? 'Click to disable' : 'Click to enable'}
        >
          {enabled ? 'enabled' : 'disabled'}
        </button>
      </td>
      {saveError && (
        <td colSpan={5} className="save-error">
          {saveError}
        </td>
      )}
    </tr>
  );
};

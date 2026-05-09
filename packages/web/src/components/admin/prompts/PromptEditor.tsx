import React, { useState } from 'react';
import { Button } from '../Button';
import { CodeBlock } from '../CodeBlock';
import '../../../styles/globals.css';

type PromptVersion = {
  id: string;
  version: string;
  content: string;
  isActive: boolean;
  updatedAt: string;
};

type PromptEditorProps = {
  version?: PromptVersion;
  onSave?: (updated: Partial<PromptVersion>) => Promise<void>;
  onCancel?: () => void;
};

export const PromptEditor: React.FC<PromptEditorProps> = ({ 
  version, 
  onSave, 
  onCancel
}) => {
  const [content, setContent] = useState(version?.content ?? '');
  const [isActive, setIsActive] = useState(version?.isActive ?? true);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch CSRF token and save via API
  const handleApiSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      const csrfRes = await fetch('/api/auth/csrf-token');
      const csrfData = await csrfRes.json();
      const token = csrfData.token;

      // API auto-generates version label (timestamp), no version needed in body
      const res = await fetch('/api/admin/prompts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token,
        },
        body: JSON.stringify({ content, isActive }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (${res.status})`);
      }

      const data = await res.json();
      await onSave(data.prompt);
    } catch (err) {
      console.error('[PromptEditor] API save failed:', err);
      alert('Failed to save prompt version. Please check the logs.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 bg-porcelain-100 border border-graphite-180 rounded-panel font-grkd-sans">
      <div className="flex items-center justify-between">
        <h3 className="text-[20px] font-semibold text-graphite-800 tracking-[-0.01em]">
          {version ? (
            <>Edit <span className="text-royal-blue-600">{version.version}</span></>
          ) : (
            'Create New Prompt Version'
          )}
        </h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input 
              type="checkbox" 
              checked={isActive} 
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded border-graphite-300 text-royal-blue-600 focus:ring-royal-blue-100"
            />
            <span className="text-[14px] font-medium text-graphite-650 group-hover:text-graphite-800 transition-colors">
              Set as active version
            </span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-medium uppercase text-graphite-500 tracking-[0.01em]">
            Editor
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-[400px] p-4 rounded-button bg-porcelain-50 border border-graphite-300 text-graphite-900 font-grkd-mono text-[13px] leading-[1.5] focus:outline-none focus:border-royal-blue-600 focus:ring-2 focus:ring-royal-blue-100 transition-all resize-none"
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-medium uppercase text-graphite-500 tracking-[0.01em]">
            Preview (Read-only)
          </label>
          <CodeBlock maxHeight="400px">
            {content}
          </CodeBlock>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApiSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
};

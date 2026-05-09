import React, { useState, useEffect } from 'react';
import { Button } from '../Button';
import { CodeBlock } from '../CodeBlock';
import type { PromptVersion } from '../../../lib/prompt-types';
import '../../../styles/globals.css';

type PromptEditorProps = Record<string, never>;

export const PromptEditor: React.FC<PromptEditorProps> = () => {
  const [version, setVersion] = useState<PromptVersion | undefined>(undefined);
  const [content, setContent] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Listen for prompt-editor-load event from prompts.astro
  // Astro passes <PromptEditor client:load /> without props,
  // so the selected version data comes via custom event
  useEffect(() => {
    const handler = (e: CustomEvent<{ version?: PromptVersion }>) => {
      const v = e.detail?.version;
      setVersion(v);
      setContent(v?.content ?? '');
      setIsActive(v?.isActive ?? true);
    };
    window.addEventListener('prompt-editor-load', handler as EventListener);
    return () => window.removeEventListener('prompt-editor-load', handler as EventListener);
  }, []);

  // Fetch CSRF token, save via API, dispatch saved event on success
  const handleApiSave = async () => {
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

      // Notify Astro page to refresh table and close modal
      window.dispatchEvent(new CustomEvent('prompt-editor-saved'));
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
        <Button variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('prompt-editor-cancel'))}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApiSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
};

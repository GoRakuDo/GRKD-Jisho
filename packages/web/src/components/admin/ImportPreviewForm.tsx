import React, { useState, useEffect } from 'react';

interface PreviewData {
  title: string;
  revision: string;
  format: number;
  termBankCount: number;
  totalTerms: number;
  autoSlug: string;
  fileName: string;
  fileSize: number;
}

export default function ImportPreviewForm() {
  const [file, setFile] = useState<File | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [isCsrfReady, setIsCsrfReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  useEffect(() => {
    fetch('/api/auth/csrf-token')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`CSRF token fetch failed (${res.status})`);
        }
        return res.json();
      })
      .then(data => {
        if (data && data.token) {
          setCsrfToken(data.token);
          setIsCsrfReady(true);
          return;
        }
        throw new Error('CSRF token missing in response');
      })
      .catch(() => {
        setIsCsrfReady(false);
        setError('Security token could not be initialized. Refresh this page and try again.');
      });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] ?? null;
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setPreview(null);
    }
  };

  const handlePreview = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!csrfToken) {
      setError('Security token is missing or expired. Refresh this page and try again.');
      return;
    }
    if (!file) {
      setError('Please select a file first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setPreview(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/admin/dictionaries/import-preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'x-csrf-token': csrfToken,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setPreview(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate preview.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
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
    maxWidth: '600px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '10px 20px',
    borderRadius: 'var(--radius-button)',
    border: 'none',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: isLoading ? 'not-allowed' : 'pointer',
    backgroundColor: 'var(--color-royal-blue-600)',
    color: 'var(--color-porcelain-50)',
    transition: 'background-color 0.2s ease',
    opacity: isLoading ? 0.7 : 1,
    width: 'fit-content',
  };

  const fileInputWrapperStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };

  const fileInputLabelStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--color-graphite-800)',
  };

  const customFileInputStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    border: '1px dashed var(--color-graphite-300)',
    borderRadius: 'var(--radius-input)',
    backgroundColor: 'var(--color-porcelain-50)',
    cursor: 'pointer',
    fontSize: '0.875rem',
    color: file ? 'var(--color-graphite-900)' : 'var(--color-graphite-500)',
  };

  const statsGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '16px',
    padding: '16px',
    backgroundColor: 'var(--color-porcelain-50)',
    borderRadius: 'var(--radius-card)',
    border: '1px solid var(--color-graphite-180)',
  };

  const statItemStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-graphite-900)' }}>
          Import Dictionary
        </h2>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-graphite-650)' }}>
          Upload a Yomitan dictionary zip file to preview its contents before importing.
        </p>
      </div>

      <form onSubmit={handlePreview} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={fileInputWrapperStyle}>
          <label style={fileInputLabelStyle}>Dictionary File (.zip)</label>
          <label style={customFileInputStyle}>
            <input
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {file ? file.name : 'Click to select a file or drag and drop'}
          </label>
        </div>

        <button type="submit" disabled={isLoading || !file || !isCsrfReady} style={buttonStyle}>
          {isLoading ? 'Generating Preview...' : 'Preview Import'}
        </button>
      </form>

      {error && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: 'var(--color-danger-100)',
          border: '1px solid var(--color-danger-600)',
          borderLeft: '4px solid var(--color-danger-600)',
          borderRadius: 'var(--radius-card)',
          color: 'var(--color-danger-600)',
          fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      {preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--color-graphite-900)' }}>
            Preview Results
          </h3>
          
          <div style={statsGridStyle}>
            <div style={statItemStyle}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-graphite-500)', textTransform: 'uppercase' }}>Title</span>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-graphite-900)' }}>{preview.title}</span>
            </div>
            <div style={statItemStyle}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-graphite-500)', textTransform: 'uppercase' }}>Revision</span>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-graphite-900)' }}>{preview.revision}</span>
            </div>
            <div style={statItemStyle}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-graphite-500)', textTransform: 'uppercase' }}>Format</span>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-graphite-900)' }}>v{preview.format}</span>
            </div>
            <div style={statItemStyle}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-graphite-500)', textTransform: 'uppercase' }}>Auto Slug</span>
              <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-graphite-900)', fontFamily: 'var(--font-grkd-mono)' }}>{preview.autoSlug}</span>
            </div>
          </div>

          <div style={statsGridStyle}>
            <div style={statItemStyle}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-graphite-500)', textTransform: 'uppercase' }}>Total Terms</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-royal-blue-600)' }}>{preview.totalTerms.toLocaleString()}</span>
            </div>
            <div style={statItemStyle}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-graphite-500)', textTransform: 'uppercase' }}>Term Banks</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-graphite-800)' }}>{preview.termBankCount}</span>
            </div>
            <div style={statItemStyle}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-graphite-500)', textTransform: 'uppercase' }}>File Size</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-graphite-800)' }}>{formatFileSize(preview.fileSize)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

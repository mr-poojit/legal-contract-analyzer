'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, FileText, Trash2, MessageSquare, Search, GitCompare,
  Plus, ChevronRight, Clock, FileType, AlertCircle, Loader2, X, BookOpen, Sparkles, Key
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { ApiKeyModal } from './components/ApiKeyModal';

interface DocumentMeta {
  id: string;
  name: string;
  originalName: string;
  fileType: 'pdf' | 'docx';
  fileSize: number;
  uploadedAt: string;
  status: 'processing' | 'ready' | 'error';
  error?: string;
  pageCount: number;
  wordCount: number;
  textLength: number;
}

function renderNormalText(text: string): string {
  if (!text) return '';
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

export default function HomePage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showMultiQuery, setShowMultiQuery] = useState(false);
  const [selectedForQuery, setSelectedForQuery] = useState<string[]>([]);
  const [multiQuestion, setMultiQuestion] = useState('');
  const [multiAnswer, setMultiAnswer] = useState('');
  const [multiQuotes, setMultiQuotes] = useState<any[]>([]);
  const [isMultiQuerying, setIsMultiQuerying] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      console.error('Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSeedSamples = async () => {
    setIsSeeding(true);
    try {
      await fetch('/api/documents/seed', { method: 'POST' });
      await loadDocuments();
    } catch (err) {
      console.error('Failed to seed sample documents', err);
    } finally {
      setIsSeeding(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      // Validate type client-side
      const validTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];

      if (!validTypes.includes(file.type)) {
        setUploadError(`"${file.name}" is not supported. Only PDF and DOCX files are accepted.`);
        return;
      }

      setUploadError(null);
      setUploadProgress(`Uploading ${file.name}...`);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/documents', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          setUploadError(data.error || 'Upload failed');
          setUploadProgress(null);
          return;
        }

        if (data.meta?.status === 'error') {
          setUploadError(data.meta.error || 'Processing failed');
          setUploadProgress(null);
          await loadDocuments();
          return;
        }

        setUploadProgress(null);
        await loadDocuments();
      } catch (err) {
        setUploadError('Upload failed. Please try again.');
        setUploadProgress(null);
      }
    }
  }, [loadDocuments]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    multiple: false,
  });

  const deleteDocument = async (docId: string) => {
    try {
      await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      await loadDocuments();
      setDeleteConfirm(null);
    } catch {
      console.error('Delete failed');
    }
  };

  const handleCompare = () => {
    if (selectedForCompare.length === 2) {
      router.push(`/compare?a=${selectedForCompare[0]}&b=${selectedForCompare[1]}`);
    }
  };

  const toggleCompareSelection = (docId: string) => {
    setSelectedForCompare(prev => {
      if (prev.includes(docId)) return prev.filter(id => id !== docId);
      if (prev.length >= 2) return [prev[1], docId];
      return [...prev, docId];
    });
  };

  const toggleQuerySelection = (docId: string) => {
    setSelectedForQuery(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  const handleMultiQuery = async () => {
    if (selectedForQuery.length < 2 || !multiQuestion.trim()) return;

    setIsMultiQuerying(true);
    setMultiAnswer('');
    setMultiQuotes([]);

    try {
      const res = await fetch('/api/documents/multi-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: multiQuestion,
          documentIds: selectedForQuery,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'chunk') {
                  setMultiAnswer(prev => prev + data.content);
                } else if (data.type === 'done') {
                  setMultiQuotes(data.quotes || []);
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      setMultiAnswer('Failed to query documents. Please try again.');
    } finally {
      setIsMultiQuerying(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const readyDocs = documents.filter(d => d.status === 'ready');

  return (
    <>
      {/* Header */}
      <header className="app-header">
        <a href="/" className="app-logo">
          <div className="app-logo-icon">⚖️</div>
          ClauseGuard
        </a>
        <nav className="app-nav">
          {readyDocs.length >= 2 && (
            <>
              <button
                className={`btn btn-ghost btn-sm ${selectedForCompare.length === 2 ? 'btn-primary' : ''}`}
                onClick={selectedForCompare.length === 2 ? handleCompare : () => setSelectedForCompare([])}
                title="Select 2 documents from the library to compare"
              >
                <GitCompare size={16} />
                {selectedForCompare.length === 2 ? 'Compare Selected' : 'Compare'}
              </button>
              <button
                className={`btn btn-ghost btn-sm ${showMultiQuery ? 'btn-secondary' : ''}`}
                onClick={() => setShowMultiQuery(!showMultiQuery)}
              >
                <Search size={16} />
                Multi-Doc Query
              </button>
            </>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowApiKeyModal(true)}
            title="Configure AI API Key (OpenAI, OpenRouter, Gemini)"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Key size={15} />
            <span>API Key</span>
          </button>
        </nav>
      </header>

      <main className="home-layout">
        {/* Hero */}
        <section className="home-hero">
          <h1 className="home-hero-title">Legal Contract Analyzer</h1>
          <p className="home-hero-subtitle">
            Upload contracts, ask questions, and get AI-powered answers backed by verified quotes
            from the document text.
          </p>

          {/* Upload Zone */}
          <div
            {...getRootProps()}
            className={`upload-zone ${isDragActive ? 'active' : ''}`}
            style={{ maxWidth: '600px', margin: '0 auto' }}
          >
            <input {...getInputProps()} id="upload-input" />
            <div className="upload-zone-icon">
              {uploadProgress ? <Loader2 size={28} className="spinning" /> : <Upload size={28} />}
            </div>
            {uploadProgress ? (
              <>
                <div className="upload-zone-title">{uploadProgress}</div>
                <div style={{ marginTop: '12px' }}>
                  <div className="progress-bar progress-bar-indeterminate" style={{ maxWidth: '300px', margin: '0 auto' }}>
                    <div className="progress-bar-fill" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="upload-zone-title">
                  {isDragActive ? 'Drop your contract here' : 'Upload a contract'}
                </div>
                <div className="upload-zone-subtitle">
                  Drag and drop a PDF or DOCX file, or click to browse
                </div>
              </>
            )}
          </div>

          {uploadError && (
            <div style={{
              maxWidth: '600px',
              margin: '16px auto 0',
              padding: '12px 16px',
              background: 'var(--color-error-bg)',
              border: '1px solid var(--color-error-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: 'var(--font-size-sm)',
            }}>
              <AlertCircle size={16} />
              {uploadError}
              <button
                onClick={() => setUploadError(null)}
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'auto', padding: '4px' }}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </section>

        {/* Multi-Document Query Panel */}
        {showMultiQuery && (
          <section style={{
            padding: 'var(--space-6)',
            background: 'var(--color-bg-secondary)',
            borderBottom: '1px solid var(--color-border)',
          }}>
            <div style={{ maxWidth: 'var(--max-content-width)', margin: '0 auto' }}>
              <h2 className="section-title">
                <Search size={20} />
                Multi-Document Query
              </h2>
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)' }}>
                Select two or more documents and ask a question across all of them.
              </p>

              <div className="doc-select-grid">
                {readyDocs.map(doc => (
                  <div
                    key={doc.id}
                    className={`doc-select-item ${selectedForQuery.includes(doc.id) ? 'selected' : ''}`}
                    onClick={() => toggleQuerySelection(doc.id)}
                  >
                    <div className="doc-select-checkbox">
                      {selectedForQuery.includes(doc.id) && '✓'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{doc.name}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                        {doc.pageCount} pages
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                <textarea
                  className="input"
                  placeholder="Ask a question across the selected documents..."
                  value={multiQuestion}
                  onChange={e => setMultiQuestion(e.target.value)}
                  rows={2}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleMultiQuery}
                  disabled={selectedForQuery.length < 2 || !multiQuestion.trim() || isMultiQuerying}
                >
                  {isMultiQuerying ? <Loader2 size={16} className="spinning" /> : <Search size={16} />}
                  Ask
                </button>
              </div>

              {(multiAnswer || isMultiQuerying) && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <div style={{
                    padding: 'var(--space-5)',
                    background: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                  }}>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
                      {renderNormalText(multiAnswer)}
                      {isMultiQuerying && <span className="streaming-cursor" />}
                    </div>

                    {multiQuotes.length > 0 && (
                      <div className="quotes-section">
                        <div className="quotes-section-title">Citations</div>
                        {multiQuotes.map((quote: any, i: number) => (
                          <div key={i} className={`quote-card ${quote.verified ? 'verified' : 'unverified'}`}>
                            <div className="quote-card-header">
                              <span className={`quote-card-badge ${quote.verified ? 'verified' : 'unverified'}`}>
                                {quote.verified ? '✓ Verified' : '✗ Unverified'}
                              </span>
                              {quote.sourceDocumentName && (
                                <span className="quote-card-source">
                                  From: {quote.sourceDocumentName}
                                </span>
                              )}
                              {quote.location && (
                                <span className="quote-card-page">p. {quote.location.pageNumber}</span>
                              )}
                            </div>
                            <div className="quote-card-text">"{quote.text}"</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Document Library */}
        <section className="home-content">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)', flexWrap: 'wrap', gap: '12px' }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              <BookOpen size={20} />
              Document Library
              {documents.length > 0 && (
                <span className="badge badge-neutral">{documents.length}</span>
              )}
            </h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSeedSamples}
                disabled={isSeeding}
                title="Populate test legal contracts"
              >
                <Sparkles size={14} className={isSeeding ? 'spinning' : ''} />
                <span>{isSeeding ? 'Loading Samples...' : 'Load Sample Contracts'}</span>
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="loading-overlay">
              <div className="spinner" />
              <div className="loading-text">Loading documents...</div>
            </div>
          ) : documents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <FileText size={32} />
              </div>
              <div className="empty-state-title">No documents yet</div>
              <div className="empty-state-description">
                Upload a PDF or DOCX contract to get started. You can then ask questions, verify quotes, and compare revisions.
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: '16px' }}
                onClick={handleSeedSamples}
                disabled={isSeeding}
              >
                <Sparkles size={16} className={isSeeding ? 'spinning' : ''} />
                <span>{isSeeding ? 'Loading Samples...' : 'Load Sample Contracts (MSA & NDA)'}</span>
              </button>
            </div>
          ) : (
            <>
              {selectedForCompare.length === 1 && (
                <div style={{
                  padding: '10px 16px',
                  background: 'var(--color-info-bg)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-info)',
                  fontSize: 'var(--font-size-sm)',
                  marginBottom: 'var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <GitCompare size={16} />
                  <span>1 document selected. Select a second document below to compare differences.</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedForCompare([])} style={{ marginLeft: 'auto' }}>
                    Cancel
                  </button>
                </div>
              )}

              {selectedForCompare.length === 2 && (
                <div style={{
                  padding: '10px 16px',
                  background: 'var(--color-success-bg)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-success)',
                  fontSize: 'var(--font-size-sm)',
                  marginBottom: 'var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}>
                  <GitCompare size={16} />
                  <span>2 documents selected for side-by-side comparison!</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedForCompare([])}>
                      Reset
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={handleCompare}>
                      <GitCompare size={14} />
                      Compare Now
                    </button>
                  </div>
                </div>
              )}

              <div className="doc-list">
                {documents.map(doc => (
                  <div
                    key={doc.id}
                    className="doc-item"
                    onClick={() => {
                      if (doc.status === 'ready') {
                        router.push(`/documents/${doc.id}`);
                      }
                    }}
                    style={{
                      borderColor: selectedForCompare.includes(doc.id) ? 'var(--color-accent-primary)' : undefined,
                      background: selectedForCompare.includes(doc.id) ? 'var(--color-accent-primary-light)' : undefined,
                    }}
                  >
                    <div className={`doc-item-icon ${doc.fileType}`}>
                      {doc.fileType.toUpperCase()}
                    </div>
                    <div className="doc-item-info">
                      <div className="doc-item-name">{doc.name}</div>
                      <div className="doc-item-meta">
                        {doc.status === 'ready' ? (
                          <>
                            <span>{doc.pageCount} pages</span>
                            <span>{doc.wordCount.toLocaleString()} words</span>
                            <span>{formatFileSize(doc.fileSize)}</span>
                          </>
                        ) : doc.status === 'processing' ? (
                          <span style={{ color: 'var(--color-warning)' }}>Processing...</span>
                        ) : (
                          <span style={{ color: 'var(--color-error)' }}>{doc.error || 'Error'}</span>
                        )}
                        <span><Clock size={10} style={{ verticalAlign: 'middle' }} /> {formatDate(doc.uploadedAt)}</span>
                      </div>
                    </div>

                    {doc.status === 'processing' && (
                      <div className="spinner" />
                    )}

                    {doc.status === 'error' && (
                      <span className="badge badge-error">Error</span>
                    )}

                    {doc.status === 'ready' && (
                      <div className="doc-item-actions">
                        <button
                          className={`btn btn-ghost btn-icon btn-sm ${selectedForCompare.includes(doc.id) ? 'btn-secondary' : ''}`}
                          onClick={e => { e.stopPropagation(); toggleCompareSelection(doc.id); }}
                          title="Select for comparison"
                        >
                          <GitCompare size={14} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={e => { e.stopPropagation(); router.push(`/documents/${doc.id}`); }}
                          title="Open chat"
                        >
                          <MessageSquare size={14} />
                        </button>
                        {deleteConfirm === doc.id ? (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={e => { e.stopPropagation(); deleteDocument(doc.id); }}
                          >
                            Confirm
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={e => { e.stopPropagation(); setDeleteConfirm(doc.id); }}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </main>

      <ApiKeyModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />

      <style jsx>{`
        .spinning {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}

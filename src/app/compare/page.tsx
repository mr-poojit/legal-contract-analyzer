'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  GitCompare,
  FileText,
  AlertTriangle,
  CheckCircle,
  PlusCircle,
  MinusCircle,
  Edit3,
  Filter,
  Search,
  ExternalLink,
  Loader2,
  RefreshCw,
  Columns,
  AlignLeft,
  Key,
} from 'lucide-react';
import { diffWords } from 'diff';
import { ApiKeyModal } from '@/app/components/ApiKeyModal';

interface DocumentMeta {
  id: string;
  name: string;
  originalName: string;
  fileType: 'pdf' | 'docx';
  status: 'processing' | 'ready' | 'error';
  pageCount: number;
  wordCount: number;
}

interface ClauseChange {
  id: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  significance: 'high' | 'medium' | 'low';
  clauseNumber?: string;
  heading?: string;
  oldText: string;
  newText: string;
  summary: string;
}

interface ComparisonResult {
  id: string;
  documentA: { id: string; name: string };
  documentB: { id: string; name: string };
  changes: ClauseChange[];
  overallSummary: string;
  createdAt: string;
}

function DiffText({ oldText, newText }: { oldText: string; newText: string }) {
  const parts = useMemo(() => {
    return diffWords(oldText || '', newText || '');
  }, [oldText, newText]);

  return (
    <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
      {parts.map((part, index) => {
        if (part.added) {
          return (
            <span key={index} className="diff-added">
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span key={index} className="diff-removed">
              {part.value}
            </span>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </div>
  );
}

function CompareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialA = searchParams.get('a') || '';
  const initialB = searchParams.get('b') || '';

  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [docAId, setDocAId] = useState<string>(initialA);
  const [docBId, setDocBId] = useState<string>(initialB);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'modified' | 'added' | 'removed'>('all');
  const [significanceFilter, setSignificanceFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>('side-by-side');

  // Load available documents
  useEffect(() => {
    fetch('/api/documents')
      .then(r => r.json())
      .then(data => {
        const readyDocs = (data.documents || []).filter((d: DocumentMeta) => d.status === 'ready');
        setDocuments(readyDocs);
        if (!docAId && readyDocs.length > 0) {
          setDocAId(readyDocs[0].id);
        }
        if (!docBId && readyDocs.length > 1) {
          setDocBId(readyDocs[1].id);
        }
      })
      .catch(err => console.error('Failed to load documents:', err));
  }, []);

  // Run comparison when IDs change
  const runComparison = async (aId: string, bId: string) => {
    if (!aId || !bId || aId === bId) {
      if (aId === bId && aId) {
        setError('Please select two different documents to compare.');
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/documents/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentAId: aId, documentBId: bId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to compare documents');
        setComparison(null);
      } else {
        setComparison(data.comparison);
      }
    } catch {
      setError('An error occurred during comparison.');
      setComparison(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (docAId && docBId && docAId !== docBId) {
      runComparison(docAId, docBId);
      router.replace(`/compare?a=${docAId}&b=${docBId}`);
    }
  }, [docAId, docBId]);

  // Filter changes
  const filteredChanges = useMemo(() => {
    if (!comparison) return [];
    return comparison.changes.filter(change => {
      if (typeFilter !== 'all' && change.type !== typeFilter) return false;
      if (significanceFilter !== 'all' && change.significance !== significanceFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const heading = (change.heading || '').toLowerCase();
        const summary = (change.summary || '').toLowerCase();
        const oldText = (change.oldText || '').toLowerCase();
        const newText = (change.newText || '').toLowerCase();
        if (
          !heading.includes(query) &&
          !summary.includes(query) &&
          !oldText.includes(query) &&
          !newText.includes(query)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [comparison, typeFilter, significanceFilter, searchQuery]);

  const stats = useMemo(() => {
    if (!comparison) return null;
    const all = comparison.changes;
    return {
      total: all.length,
      modified: all.filter(c => c.type === 'modified').length,
      added: all.filter(c => c.type === 'added').length,
      removed: all.filter(c => c.type === 'removed').length,
      highSignificance: all.filter(c => c.significance === 'high').length,
    };
  }, [comparison]);

  const docA = documents.find(d => d.id === docAId);
  const docB = documents.find(d => d.id === docBId);

  return (
    <div className="comparison-layout">
      {/* Header */}
      <header className="comparison-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => router.push('/')}
              title="Back to Documents Library"
            >
              <ArrowLeft size={16} />
              <span>Back</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--color-accent-primary-light)', color: 'var(--color-accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <GitCompare size={18} />
              </div>
              <h1 style={{ fontSize: 'var(--font-size-lg)', fontWeight: '700', margin: 0 }}>
                Document Comparison
              </h1>
            </div>
          </div>

          {/* Document pickers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: '600', color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
                Base (Doc A):
              </span>
              <select
                className="input input-sm"
                value={docAId}
                onChange={e => setDocAId(e.target.value)}
                style={{ maxWidth: '220px' }}
              >
                {documents.map(d => (
                  <option key={d.id} value={d.id} disabled={d.id === docBId}>
                    {d.name} ({d.fileType.toUpperCase()})
                  </option>
                ))}
              </select>
              {docA && (
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => router.push(`/documents/${docA.id}`)}
                  title="Open Doc A in chat"
                >
                  <ExternalLink size={14} />
                </button>
              )}
            </div>

            <div style={{ color: 'var(--color-text-tertiary)' }}>vs</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: '600', color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
                Comparison (Doc B):
              </span>
              <select
                className="input input-sm"
                value={docBId}
                onChange={e => setDocBId(e.target.value)}
                style={{ maxWidth: '220px' }}
              >
                {documents.map(d => (
                  <option key={d.id} value={d.id} disabled={d.id === docAId}>
                    {d.name} ({d.fileType.toUpperCase()})
                  </option>
                ))}
              </select>
              {docB && (
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => router.push(`/documents/${docB.id}`)}
                  title="Open Doc B in chat"
                >
                  <ExternalLink size={14} />
                </button>
              )}
            </div>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => runComparison(docAId, docBId)}
              disabled={isLoading || !docAId || !docBId || docAId === docBId}
              title="Re-run comparison"
            >
              <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
              <span>Compare</span>
            </button>

            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowApiKeyModal(true)}
              title="Configure AI API Key (OpenAI, OpenRouter, Gemini)"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Key size={14} />
              <span>API Key</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="comparison-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="loading-overlay">
            <Loader2 size={36} className="spinning" style={{ color: 'var(--color-accent-primary)' }} />
            <div className="loading-text" style={{ fontSize: 'var(--font-size-base)', fontWeight: '500' }}>
              Analyzing clause differences & semantic changes...
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', maxWidth: '400px', textAlign: 'center' }}>
              Comparing structured sections, detecting modifications, additions, deletions, and generating risk assessments.
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="comparison-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="empty-state">
            <div className="empty-state-icon" style={{ color: 'var(--color-error)' }}>
              <AlertTriangle size={36} />
            </div>
            <div className="empty-state-title">Comparison Error</div>
            <div className="empty-state-description">{error}</div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '16px' }}
              onClick={() => router.push('/')}
            >
              Return to Documents
            </button>
          </div>
        </div>
      ) : comparison ? (
        <>
          {/* Executive Summary & Stats Banner */}
          <div className="comparison-summary">
            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: '700', margin: 0, color: 'var(--color-text-primary)' }}>
                    Executive Summary of Differences
                  </h3>
                  {stats && stats.highSignificance > 0 && (
                    <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <AlertTriangle size={12} />
                      {stats.highSignificance} High-Impact {stats.highSignificance === 1 ? 'Change' : 'Changes'}
                    </span>
                  )}
                </div>

                {/* Quick stats pills */}
                {stats && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="badge" style={{ background: 'var(--color-surface)', color: 'var(--color-text-primary)' }}>
                      Total: {stats.total}
                    </span>
                    <span className="badge" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
                      Modified: {stats.modified}
                    </span>
                    <span className="badge" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
                      Added: {stats.added}
                    </span>
                    <span className="badge" style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)' }}>
                      Removed: {stats.removed}
                    </span>
                  </div>
                )}
              </div>

              <div className="comparison-summary-text">
                {comparison.overallSummary}
              </div>
            </div>
          </div>

          {/* Filtering and View Mode Controls */}
          <div className="comparison-controls">
            <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              {/* Filter tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Filter size={12} /> Filter:
                </span>
                <div className="tabs">
                  <button
                    className={`tab ${typeFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setTypeFilter('all')}
                  >
                    All ({comparison.changes.length})
                  </button>
                  <button
                    className={`tab ${typeFilter === 'modified' ? 'active' : ''}`}
                    onClick={() => setTypeFilter('modified')}
                  >
                    Modified ({stats?.modified || 0})
                  </button>
                  <button
                    className={`tab ${typeFilter === 'added' ? 'active' : ''}`}
                    onClick={() => setTypeFilter('added')}
                  >
                    Added ({stats?.added || 0})
                  </button>
                  <button
                    className={`tab ${typeFilter === 'removed' ? 'active' : ''}`}
                    onClick={() => setTypeFilter('removed')}
                  >
                    Removed ({stats?.removed || 0})
                  </button>
                </div>

                {/* Significance Filter */}
                <select
                  className="input input-sm"
                  value={significanceFilter}
                  onChange={e => setSignificanceFilter(e.target.value as any)}
                  style={{ width: '140px' }}
                >
                  <option value="all">All Significance</option>
                  <option value="high">High Risk / Impact</option>
                  <option value="medium">Medium Impact</option>
                  <option value="low">Low Impact</option>
                </select>
              </div>

              {/* Search & View Mode */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                  <input
                    type="text"
                    className="input input-sm"
                    placeholder="Search clauses..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: '30px', width: '180px' }}
                  />
                </div>

                <div className="tabs">
                  <button
                    className={`tab ${viewMode === 'side-by-side' ? 'active' : ''}`}
                    onClick={() => setViewMode('side-by-side')}
                    title="Side-by-side view"
                  >
                    <Columns size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Split
                  </button>
                  <button
                    className={`tab ${viewMode === 'unified' ? 'active' : ''}`}
                    onClick={() => setViewMode('unified')}
                    title="Unified diff view"
                  >
                    <AlignLeft size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Unified
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Comparison Changes Feed */}
          <div className="comparison-content">
            {filteredChanges.length === 0 ? (
              <div className="empty-state">
                <CheckCircle size={32} style={{ color: 'var(--color-success)', marginBottom: '8px' }} />
                <div className="empty-state-title">No changes match your filter</div>
                <div className="empty-state-description">
                  Try adjusting the type or significance filter above to view all changes.
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: '12px' }}
                  onClick={() => {
                    setTypeFilter('all');
                    setSignificanceFilter('all');
                    setSearchQuery('');
                  }}
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              filteredChanges.map(change => (
                <div key={change.id} className="change-card">
                  {/* Card Header */}
                  <div className="change-card-header">
                    <span className={`change-card-type ${change.type}`}>
                      {change.type === 'modified' && <Edit3 size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                      {change.type === 'added' && <PlusCircle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                      {change.type === 'removed' && <MinusCircle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                      {change.type}
                    </span>

                    <span style={{ fontWeight: '600', color: 'var(--color-text-primary)' }}>
                      {change.clauseNumber ? `Clause ${change.clauseNumber}` : ''}
                      {change.heading ? (change.clauseNumber ? ` — ${change.heading}` : change.heading) : 'Unlabeled Clause'}
                    </span>

                    <span
                      className={`badge ${
                        change.significance === 'high'
                          ? 'badge-error'
                          : change.significance === 'medium'
                          ? 'badge-warning'
                          : 'badge-info'
                      }`}
                      style={{ marginLeft: 'auto', textTransform: 'uppercase', fontSize: '10px' }}
                    >
                      {change.significance} impact
                    </span>
                  </div>

                  {/* Summary of what changed */}
                  {change.summary && (
                    <div className="change-card-summary">
                      {change.summary}
                    </div>
                  )}

                  {/* Diff Body */}
                  {viewMode === 'side-by-side' ? (
                    <div className="change-card-diff">
                      {/* Document A (Original) */}
                      <div className="change-card-side">
                        <div className="change-card-side-label">
                          Doc A ({comparison.documentA.name})
                        </div>
                        {change.type === 'added' ? (
                          <div style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '8px 0' }}>
                            [Clause does not exist in Document A]
                          </div>
                        ) : change.type === 'modified' ? (
                          <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)', fontSize: '13px' }}>
                            {change.oldText}
                          </div>
                        ) : (
                          <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)', fontSize: '13px' }}>
                            <span className="diff-removed">{change.oldText}</span>
                          </div>
                        )}
                      </div>

                      {/* Document B (Comparison) */}
                      <div className="change-card-side">
                        <div className="change-card-side-label">
                          Doc B ({comparison.documentB.name})
                        </div>
                        {change.type === 'removed' ? (
                          <div style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '8px 0' }}>
                            [Clause omitted / removed from Document B]
                          </div>
                        ) : change.type === 'modified' ? (
                          <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)', fontSize: '13px' }}>
                            {change.newText}
                          </div>
                        ) : (
                          <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)', fontSize: '13px' }}>
                            <span className="diff-added">{change.newText}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Unified Inline Diff View */
                    <div style={{ padding: 'var(--space-4) var(--space-5)', background: 'var(--color-bg-primary)' }}>
                      {change.type === 'modified' ? (
                        <DiffText oldText={change.oldText} newText={change.newText} />
                      ) : change.type === 'added' ? (
                        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '13px', whiteSpace: 'pre-wrap' }}>
                          <span className="diff-added">{change.newText}</span>
                        </div>
                      ) : (
                        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '13px', whiteSpace: 'pre-wrap' }}>
                          <span className="diff-removed">{change.oldText}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="comparison-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="empty-state">
            <div className="empty-state-icon">
              <FileText size={36} />
            </div>
            <div className="empty-state-title">Select two contracts to compare</div>
            <div className="empty-state-description">
              Choose Document A and Document B from the dropdowns above and click "Compare" to detect differences.
            </div>
          </div>
        </div>
      )}

      <ApiKeyModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />

      <style jsx>{`
        .spinning {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <div className="loading-overlay">
            <div className="spinner" />
            <div className="loading-text">Loading comparison tool...</div>
          </div>
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}

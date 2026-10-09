'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Send, Square, MessageSquare, Plus, FileText, Trash2,
  Bot, User, ChevronRight, AlertTriangle, Eye, Zap, Search,
  CheckCircle2, XCircle, ChevronDown, Clock, BookOpen, Loader2, Key
} from 'lucide-react';
import { ApiKeyModal } from '@/app/components/ApiKeyModal';

interface DocumentMeta {
  id: string;
  name: string;
  originalName: string;
  fileType: string;
  pageCount: number;
  wordCount: number;
}

interface DocumentPage {
  pageNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

interface QuoteLocation {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  context: string;
}

interface VerifiedQuote {
  text: string;
  verified: boolean;
  originalText?: string;
  location?: QuoteLocation;
  sourceDocumentId?: string;
  sourceDocumentName?: string;
}

interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'answer';
  description: string;
  detail?: string;
  timestamp: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  quotes?: VerifiedQuote[];
  timestamp: string;
  isStreaming?: boolean;
  agentSteps?: AgentStep[];
}

interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

function DocumentPageContent() {
  const params = useParams();
  const router = useRouter();
  const docId = params.id as string;

  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [fullText, setFullText] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [useAgentMode, setUseAgentMode] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Document viewer state
  const [showViewer, setShowViewer] = useState(false);
  const [highlightedQuote, setHighlightedQuote] = useState<VerifiedQuote | null>(null);
  const [viewerPage, setViewerPage] = useState(1);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Load document
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/documents/${docId}`);
        const data = await res.json();
        if (data.meta) {
          setMeta(data.meta);
          setPages(data.pages || []);
          setFullText(data.text || '');
        }
      } catch (err) {
        console.error('Failed to load document');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [docId]);

  // Load chat sessions
  useEffect(() => {
    async function loadChats() {
      try {
        const res = await fetch(`/api/documents/${docId}/chat`);
        const data = await res.json();
        setChatSessions(data.sessions || []);
      } catch {}
    }
    loadChats();
  }, [docId]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load a specific chat session
  const loadChatSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/chat/${sessionId}`);
      const data = await res.json();
      if (data.session) {
        setChatId(data.session.id);
        setMessages(data.session.messages || []);
      }
    } catch {}
  };

  // Start new chat
  const startNewChat = () => {
    setChatId(null);
    setMessages([]);
    setAgentSteps([]);
    setHighlightedQuote(null);
  };

  // Send message
  const sendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    const question = inputValue.trim();
    setInputValue('');
    setIsStreaming(true);
    setAgentSteps([]);

    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const storedKey = typeof window !== 'undefined' ? localStorage.getItem('clauseguard_api_key') : null;
      const res = await fetch(`/api/documents/${docId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storedKey ? { 'x-api-key': storedKey } : {}),
        },
        body: JSON.stringify({
          message: question,
          chatId: chatId,
          useAgent: useAgentMode,
          apiKey: storedKey || undefined,
        }),
        signal: controller.signal,
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
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                      last.content += data.content;
                    }
                    return [...updated];
                  });
                } else if (data.type === 'agent_step') {
                  setAgentSteps(prev => [...prev, data.step]);
                } else if (data.type === 'done') {
                  if (data.chatId) setChatId(data.chatId);
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                      last.isStreaming = false;
                      last.quotes = data.quotes;
                      last.agentSteps = data.agentSteps;
                      last.id = data.messageId || last.id;
                    }
                    return [...updated];
                  });

                  // Refresh chat sessions
                  const sessRes = await fetch(`/api/documents/${docId}/chat`);
                  const sessData = await sessRes.json();
                  setChatSessions(sessData.sessions || []);
                } else if (data.type === 'error') {
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                      last.content = `⚠️ ${data.error}\n\n*Click "API Key" in the top bar to set up your AI key, or continue using the built-in contract analyzer.*`;
                      last.isStreaming = false;
                    }
                    return [...updated];
                  });
                }
              } catch {}
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User stopped generation - keep what was generated
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            last.isStreaming = false;
            last.content += '\n\n*(Generation stopped by user)*';
          }
          return [...updated];
        });
      } else {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            last.content = 'Failed to get response. Please try again.';
            last.isStreaming = false;
          }
          return [...updated];
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // Stop streaming
  const stopStreaming = () => {
    abortControllerRef.current?.abort();
  };

  // Handle quote click - open document viewer and highlight
  const handleQuoteClick = (quote: VerifiedQuote) => {
    if (!quote.verified || !quote.location) return;
    setHighlightedQuote(quote);
    setShowViewer(true);
    setViewerPage(quote.location.pageNumber);

    // Scroll to highlight after render
    setTimeout(() => {
      const el = document.getElementById('highlight-target');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Render document text with highlighting
  const renderPageText = (page: DocumentPage) => {
    if (!highlightedQuote?.location || highlightedQuote.location.pageNumber !== page.pageNumber) {
      return <span>{page.text}</span>;
    }

    const quote = highlightedQuote;
    const loc = quote.location!;

    // Find the quote text in this page's text
    const searchText = (quote.originalText || quote.text).toLowerCase().replace(/\s+/g, ' ').trim();
    const pageTextNorm = page.text.toLowerCase().replace(/\s+/g, ' ');

    // Try to find the quote in the page text
    const idx = pageTextNorm.indexOf(searchText.substring(0, Math.min(50, searchText.length)));

    if (idx >= 0) {
      // Map back to original page text position (approximately)
      const before = page.text.substring(0, idx);
      const highlighted = page.text.substring(idx, idx + (quote.originalText || quote.text).length + 50);
      
      // Find the best end position
      const endSearchText = searchText.substring(searchText.length - 20);
      const endIdx = pageTextNorm.indexOf(endSearchText, idx);
      const actualEnd = endIdx >= 0 ? endIdx + endSearchText.length + 10 : idx + searchText.length + 20;

      const highlightedText = page.text.substring(idx, Math.min(actualEnd, page.text.length));
      const after = page.text.substring(Math.min(actualEnd, page.text.length));

      return (
        <>
          <span>{before}</span>
          <mark id="highlight-target" className="highlight-citation">{highlightedText}</mark>
          <span>{after}</span>
        </>
      );
    }

    // Fallback: try offset-based highlighting
    const relStart = loc.startOffset - page.startOffset;
    const relEnd = loc.endOffset - page.startOffset;

    if (relStart >= 0 && relStart < page.text.length) {
      const actualEnd = Math.min(relEnd, page.text.length);
      return (
        <>
          <span>{page.text.substring(0, relStart)}</span>
          <mark id="highlight-target" className="highlight-citation">
            {page.text.substring(relStart, actualEnd)}
          </mark>
          <span>{page.text.substring(actualEnd)}</span>
        </>
      );
    }

    return <span>{page.text}</span>;
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (isLoading) {
    return (
      <>
        <header className="app-header">
          <a href="/" className="app-logo">
            <div className="app-logo-icon">⚖️</div>
            ClauseGuard
          </a>
        </header>
        <div className="loading-overlay" style={{ height: 'calc(100vh - var(--header-height))' }}>
          <div className="spinner" />
          <div className="loading-text">Loading document...</div>
        </div>
      </>
    );
  }

  if (!meta) {
    return (
      <>
        <header className="app-header">
          <a href="/" className="app-logo">
            <div className="app-logo-icon">⚖️</div>
            ClauseGuard
          </a>
        </header>
        <div className="empty-state" style={{ height: 'calc(100vh - var(--header-height))' }}>
          <div className="empty-state-icon"><AlertTriangle size={32} /></div>
          <div className="empty-state-title">Document not found</div>
          <button className="btn btn-primary" onClick={() => router.push('/')}>
            <ArrowLeft size={16} /> Go back
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button className="btn btn-ghost btn-icon" onClick={() => router.push('/')}>
            <ArrowLeft size={18} />
          </button>
          <a href="/" className="app-logo">
            <div className="app-logo-icon">⚖️</div>
            ClauseGuard
          </a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {meta.name}
          </span>
          <span className="badge badge-neutral">{meta.pageCount} pages</span>
          <button
            className={`btn btn-sm ${showViewer ? 'btn-secondary' : 'btn-ghost'}`}
            onClick={() => setShowViewer(!showViewer)}
          >
            <Eye size={14} />
            {showViewer ? 'Hide Document' : 'View Document'}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setShowApiKeyModal(true)}
            title="Configure AI API Key (OpenAI, OpenRouter, Gemini)"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Key size={14} />
            <span>API Key</span>
          </button>
        </div>
      </header>

      <div className="chat-layout">
        {/* Chat Sidebar */}
        <aside className="chat-sidebar">
          <div className="chat-sidebar-header">
            <button className="btn btn-primary btn-sm" onClick={startNewChat} style={{ width: '100%' }}>
              <Plus size={14} />
              New Chat
            </button>
          </div>
          <div className="chat-sidebar-content">
            {/* Agent Mode Toggle */}
            <div style={{
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
              background: useAgentMode ? 'var(--color-accent-primary-light)' : 'var(--color-surface)',
              border: `1px solid ${useAgentMode ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }} onClick={() => setUseAgentMode(!useAgentMode)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Zap size={14} color={useAgentMode ? 'var(--color-accent-primary)' : 'var(--color-text-tertiary)'} />
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: useAgentMode ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)' }}>
                  Agent Research Mode
                </span>
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                {useAgentMode ? 'AI uses tools to research the document' : 'Enable for multi-step document research'}
              </div>
            </div>

            {/* Chat History */}
            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: 'var(--space-2) var(--space-2)', marginBottom: 'var(--space-2)' }}>
              Chat History
            </div>
            {chatSessions.length === 0 ? (
              <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                No previous chats
              </div>
            ) : (
              chatSessions.map(session => (
                <div
                  key={session.id}
                  className={`doc-item`}
                  style={{
                    padding: 'var(--space-3)',
                    marginBottom: 'var(--space-1)',
                    background: chatId === session.id ? 'var(--color-bg-hover)' : undefined,
                    borderColor: chatId === session.id ? 'var(--color-accent-primary)' : undefined,
                  }}
                  onClick={() => loadChatSession(session.id)}
                >
                  <MessageSquare size={14} style={{ flexShrink: 0, color: 'var(--color-text-tertiary)' }} />
                  <div className="doc-item-info">
                    <div className="doc-item-name" style={{ fontSize: 'var(--font-size-sm)' }}>
                      {session.title}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main Chat Area */}
        <div className="chat-main">
          {/* Agent Steps (shown when agent mode is active and steps exist) */}
          {agentSteps.length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-6)',
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              maxHeight: '200px',
              overflowY: 'auto',
            }}>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Agent Research Progress
              </div>
              <div className="agent-steps">
                {agentSteps.map((step, i) => (
                  <div key={i} className="agent-step">
                    <div className={`agent-step-icon ${step.type === 'tool_call' ? 'tool' : step.type === 'answer' ? 'answer' : 'thinking'}`}>
                      {step.type === 'tool_call' ? <Search size={10} /> : step.type === 'answer' ? <CheckCircle2 size={10} /> : <Bot size={10} />}
                    </div>
                    <div className="agent-step-content">
                      <div className="agent-step-description">{step.description}</div>
                      {step.detail && <div className="agent-step-detail">{step.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <MessageSquare size={32} />
                </div>
                <div className="empty-state-title">Start a conversation</div>
                <div className="empty-state-description">
                  Ask any question about "{meta.name}". Answers will be backed by verified quotes from the document.
                </div>
                <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowApiKeyModal(true)}
                    style={{ fontSize: '12px' }}
                  >
                    <Key size={13} />
                    Configure API Key
                  </button>
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`chat-message ${msg.role}`}>
                <div className="chat-message-bubble">
                  {msg.role === 'assistant' && msg.agentSteps && msg.agentSteps.length > 0 && (
                    <details style={{ marginBottom: 'var(--space-3)' }}>
                      <summary style={{ cursor: 'pointer', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
                        🔍 Research Steps ({msg.agentSteps.length})
                      </summary>
                      <div className="agent-steps" style={{ marginTop: 'var(--space-2)' }}>
                        {msg.agentSteps.map((step, i) => (
                          <div key={i} className="agent-step">
                            <div className={`agent-step-icon ${step.type === 'tool_call' ? 'tool' : step.type === 'answer' ? 'answer' : 'thinking'}`}>
                              {step.type === 'tool_call' ? '🔧' : step.type === 'answer' ? '✅' : '🤔'}
                            </div>
                            <div className="agent-step-content">
                              <div className="agent-step-description">{step.description}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                    {msg.isStreaming && <span className="streaming-cursor" />}
                  </div>

                  {/* Verified Quotes */}
                  {msg.quotes && msg.quotes.length > 0 && (
                    <div className="quotes-section">
                      <div className="quotes-section-title">
                        Citations ({msg.quotes.filter(q => q.verified).length} verified, {msg.quotes.filter(q => !q.verified).length} unverified)
                      </div>
                      {msg.quotes.map((quote, i) => (
                        <div
                          key={i}
                          className={`quote-card ${quote.verified ? 'verified' : 'unverified'}`}
                          onClick={() => handleQuoteClick(quote)}
                          style={{ cursor: quote.verified ? 'pointer' : 'default' }}
                        >
                          <div className="quote-card-header">
                            <span className={`quote-card-badge ${quote.verified ? 'verified' : 'unverified'}`}>
                              {quote.verified ? (
                                <><CheckCircle2 size={10} /> Verified</>
                              ) : (
                                <><XCircle size={10} /> Unverified — AI may have paraphrased</>
                              )}
                            </span>
                            {quote.location && (
                              <span className="quote-card-page">
                                Page {quote.location.pageNumber} →
                              </span>
                            )}
                          </div>
                          <div className="quote-card-text">"{quote.text}"</div>
                          {quote.verified && quote.location && (
                            <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                              Click to view in document
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="chat-input-area">
            <div className="chat-input-wrapper">
              <textarea
                ref={inputRef}
                className="input"
                placeholder={useAgentMode ? "Ask a question (Agent will research the document)..." : "Ask a question about this document..."}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button className="btn btn-danger" onClick={stopStreaming}>
                  <Square size={16} />
                  Stop
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={sendMessage}
                  disabled={!inputValue.trim()}
                >
                  <Send size={16} />
                </button>
              )}
            </div>
            <div className="chat-input-controls">
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                {useAgentMode && <span style={{ color: 'var(--color-accent-primary)' }}>⚡ Agent Mode</span>}
                {!useAgentMode && <span>Press Enter to send, Shift+Enter for new line</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Document Viewer Panel */}
        {showViewer && (
          <div className="doc-viewer" style={{ width: '45%', borderLeft: '1px solid var(--color-border)' }}>
            <div className="doc-viewer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <FileText size={14} />
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{meta.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {highlightedQuote && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setHighlightedQuote(null)}
                  >
                    Clear Highlight
                  </button>
                )}
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowViewer(false)}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            <div className="doc-viewer-content" ref={viewerRef}>
              {pages.map(page => (
                <div key={page.pageNumber} className="doc-viewer-page" id={`page-${page.pageNumber}`}>
                  <div className="doc-viewer-page-number">Page {page.pageNumber}</div>
                  <div className="doc-viewer-text">
                    {renderPageText(page)}
                  </div>
                </div>
              ))}
              {pages.length === 0 && (
                <div className="doc-viewer-page">
                  <div className="doc-viewer-text">{fullText}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ApiKeyModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />
    </>
  );
}

export default function DocumentPage() {
  return (
    <Suspense
      fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg-primary)' }}>
          <div className="loading-overlay">
            <div className="spinner" />
            <div className="loading-text">Loading document...</div>
          </div>
        </div>
      }
    >
      <DocumentPageContent />
    </Suspense>
  );
}

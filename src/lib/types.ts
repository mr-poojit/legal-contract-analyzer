// ============================================================
// Core Types for Legal Contract Analyzer
// ============================================================

export interface DocumentMeta {
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

export interface DocumentPage {
  pageNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface DocumentData {
  meta: DocumentMeta;
  fullText: string;
  pages: DocumentPage[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  quotes?: VerifiedQuote[];
  timestamp: string;
  isStreaming?: boolean;
  agentSteps?: AgentStep[];
}

export interface ChatSession {
  id: string;
  documentId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface RawQuote {
  text: string;
  sourceDocument?: string;
}

export interface VerifiedQuote {
  text: string;
  verified: boolean;
  originalText?: string; // The exact text found in document (may differ in whitespace)
  location?: QuoteLocation;
  sourceDocumentId?: string;
  sourceDocumentName?: string;
}

export interface QuoteLocation {
  pageNumber: number;
  startOffset: number; // offset within full text
  endOffset: number;
  context: string; // surrounding text for display
}

// ============================================================
// Document Comparison Types
// ============================================================

export type ChangeSignificance = 'high' | 'medium' | 'low';

export interface ClauseChange {
  id: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  significance: ChangeSignificance;
  clauseNumber?: string;
  heading?: string;
  oldText: string;
  newText: string;
  summary: string; // Plain language description of what changed
}

export interface ComparisonResult {
  id: string;
  documentA: { id: string; name: string };
  documentB: { id: string; name: string };
  changes: ClauseChange[];
  overallSummary: string;
  createdAt: string;
}

// ============================================================
// Multi-Document Query Types
// ============================================================

export interface MultiDocQuery {
  question: string;
  documentIds: string[];
}

export interface MultiDocAnswer {
  content: string;
  quotes: VerifiedQuote[];
}

// ============================================================
// Agentic Research Types (Part C - Option 2)
// ============================================================

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolResult {
  toolCallId: string;
  result: string;
  error?: string;
}

export interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'answer';
  description: string;
  detail?: string;
  timestamp: string;
}

export interface AgentConfig {
  maxRounds: number;
  maxToolCallsPerRound: number;
  tools: AgentTool[];
}

// ============================================================
// Chunk Types for Large Document Handling
// ============================================================

export interface TextChunk {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  pageNumbers: number[];
  heading?: string;
}

export interface ChunkSearchResult {
  chunk: TextChunk;
  relevanceScore: number;
}

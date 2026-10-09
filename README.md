# ClauseGuard — Legal Contract Analyzer

An AI-powered web application for analyzing, chatting with, and comparing legal contracts (PDF and DOCX). ClauseGuard grounds every answer exclusively in the document text and backs every claim with verified quotes and direct citation jump links.

---

## 🌟 Key Features

### Part A: Core Features
- **Document Ingestion & Processing**:
  - Accepts both **PDF** (`.pdf`) and **Word** (`.docx`) files.
  - Rejects unsupported file types with clear, user-friendly explanations.
  - Real-time progress feedback (`Saving file...`, `Extracting text...`, `Building index...`).
  - **Scanned PDF Detection**: Distinguishes between readable vector PDFs and scanned image-only PDFs, informing the user with actionable instructions rather than indexing an empty document.
  - **Document Library**: Lists all contracts with metadata (file type, size, upload date, page count, word count), with instant opening and deletion.
- **Contract Chat with Strict Grounding**:
  - SSE Streaming responses for instantaneous latency.
  - Strictly instructed to answer **only** from the text and decline speculation.
  - Handles documents longer than context windows through chunking and retrieval, with **explicit coverage reporting** if only part of a massive contract is inspected.
  - Multi-session chat history persistence per document.
- **Exact Quotes & Clickable Citation Jumps**:
  - Every answer extracts verbatim passages cited with `【...】` brackets.
  - Independent **Quote Verification Engine**: Verifies each extracted quote against the original source text using fuzzy sequence matching (tolerating OCR artifacts, whitespace differences, and punctuation shifts).
  - Status badges for every quote: `Verified (100% exact match)`, `Verified (Fuzzy Match)`, or `Unverified / Hallucination Warning`.
  - **Clicking any quote card** smoothly scrolls the split document viewer to that exact passage, applies an animated visual highlight, and jumps to the relevant page.

---

### Part B: Advanced Features
- **1. Citation Highlighting in Document Viewer**:
  - Split-pane layout with chat on the left and full contract text on the right.
  - Citations are highlighted directly within the document text.
  - Highlighting works across multi-page contracts with smooth scrolling.
- **2. Multi-Document Querying**:
  - Ask cross-cutting questions across multiple contracts simultaneously (e.g., *"How do the liability caps and termination notice periods compare between all our agreements?"*).
  - Returns synthesized answers with quotes tagged by their respective source document and page number.
- **3. Full Document Comparison Engine (`/compare`)**:
  - Select any two contracts for automated clause-level diffing.
  - **Executive Summary of Differences**: High-level overview of contractual shifts.
  - **Significance Risk Ratings**: Categorizes each clause change into `High`, `Medium`, or `Low` impact.
  - **Structured Changes**: Identifies added clauses, removed clauses, and modified clauses.
  - **Dual View Modes**:
    - **Split View**: Side-by-side comparative columns for Doc A vs Doc B.
    - **Unified Diff**: Inline word-level diffing highlighting deleted text in red and inserted text in green.
  - **Interactive Filtering**: Filter by change type (`All`, `Modified`, `Added`, `Removed`) or significance level (`High Risk`, `Medium`, `Low`).

---

### Part C: Agentic Research Mode (Option 2)
ClauseGuard implements an autonomous legal research agent capable of multi-round document exploration:
- **Autonomous Tool Calling**:
  - `search_document`: Semantic & keyword retrieval across all contract sections.
  - `get_section`: Direct lookup of specific articles or clauses by name or number.
  - `list_clauses`: Structural table of contents extraction of the entire agreement.
  - `get_page`: Full-page reading for contiguous context.
  - `get_document_info`: Structural metadata and document overview.
- **Multi-Round Planning Loop**: The agent investigates complex questions, reads intermediate findings, follows cross-references, and synthesizes a verified answer.
- **Real-Time Step Visualization**: The user watches the agent's thought process step-by-step (`Thinking...`, `Searching for "indemnification"`, `Reading Section 6.1`, `Composing final answer`).
- **Loop Safety Caps**: Maximum round limits and safety timeouts to guarantee termination and budget control.

---

## 🏗️ Architecture & Technology Stack

```mermaid
graph TB
    subgraph Frontend [Next.js 16 App Router]
        A[Homepage / Upload Zone] --> B[Document Library]
        B --> C[Document Split Viewer & Chat]
        B --> D[Multi-Document Query Modal]
        B --> E[Document Comparison /compare]
        C --> F[Citation Highlighting & Auto-Scroll]
    end

    subgraph API Routes
        G[/api/documents] --> H[Document Processor]
        I[/api/documents/:id/chat] --> J[Streaming Engine & Agent Loop]
        K[/api/documents/compare] --> L[Comparison & Diff Engine]
        M[/api/documents/multi-query] --> N[Cross-Doc Retrieval]
        O[/api/documents/seed] --> P[Sample Contract Seeder]
    end

    subgraph Core Libraries [src/lib]
        H --> Q[pdf-parse & mammoth]
        J --> R[quoteVerifier.ts - Fuzzy Matcher]
        J --> S[chunker.ts - Semantic Windowing]
        J --> T[agentResearch.ts - Tool Calling Loop]
        L --> U[comparison.ts - Clause Alignment & diffWords]
        N --> V[ai.ts - OpenAI Client]
    end
```

| Layer | Technology | Rationale |
|---|---|---|
| **Framework** | Next.js 16 (App Router) + React 19 + TypeScript | High-performance server/client routing, SSE streaming, modern React Server Components |
| **Styling** | Vanilla CSS Design System (`globals.css`) | Maximum flexibility, custom dark theme, glassmorphic accents, responsive grid |
| **PDF Extraction** | `pdf-parse` (v2 class-based) | Per-page parsing and zero-native dependency extraction |
| **DOCX Extraction** | `mammoth` | Clean semantic text and paragraph extraction |
| **Storage** | File-based (`/data/documents/`) | Self-contained, zero-configuration persistence |
| **Diffing** | `diff` (`diffWords`) | Precise word-level insertions and deletions |
| **AI Client** | `openai` SDK | Open standard compatible with OpenAI, Anthropic, or OpenRouter |

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Node.js 18+ (tested on Node.js 20 & 22)
- npm or pnpm

### 2. Environment Variables
Create a `.env.local` file in the root directory:

```env
# Required for live AI features:
OPENAI_API_KEY=your_openai_or_openrouter_api_key_here

# Optional configuration:
OPENAI_BASE_URL=https://api.openai.com/v1   # Or OpenRouter/Local LLM
OPENAI_MODEL=gpt-4o-mini                    # Default model (or gpt-4o, claude-3-5-sonnet, etc.)
```

> **Note**: Even without an API key, the Document Comparison engine, Document Library, PDF/DOCX text extractors, and UI inspection function locally. When an API key is provided, the full streaming chat, quote verification, and agentic loop activate.

### 3. Installation & Run
```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing with Sample Contracts

To make testing instant without needing your own legal files:
1. Click the **"Load Sample Contracts"** button on the homepage.
2. This automatically provisions three realistic contracts:
   - `Master-Services-Agreement-2023.docx` (Base MSA)
   - `Master-Services-Agreement-2024-Revised.docx` (Revised MSA with altered liability caps, AI training restrictions, and Delaware jurisdiction)
   - `Horizon-Cipher-Mutual-NDA.pdf` (Mutual Non-Disclosure Agreement)
3. Select both MSA documents and click **"Compare Now"** to view the live comparison engine.
4. Click into any contract to test **Chat**, **Citation jumping**, and **Agentic Research Mode**.

---

## 🛡️ Edge Cases Handled

1. **Scanned PDFs with No Text**: Tested and intercepted early; alerts the user that the document is image-only rather than creating empty records.
2. **Unsupported File Types**: Rejected at the dropzone boundary and API boundary with clear explanations.
3. **Large Contracts**: Partitioned into semantic chunks with overlap. If a query only searches a subset, the system provides transparent **coverage warnings** indicating the percentage and pages searched.
4. **AI Hallucinations**: Every cited quote is verified against the raw text. If an AI hallucinates or paraphrases text while claiming it is an exact quote, the system flags it with an amber/red warning badge.
5. **Agentic Loops**: Maximum recursion limit (5 rounds) prevents runaways and controls token budgets.

---

## 📁 Project Structure

```
├── data/                       # Local document storage
│   └── documents/              # Stored original files, extracted text, and metadata
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── documents/      # Upload, list, chat, compare, multi-query, seed APIs
│   │   ├── compare/            # Document Comparison page
│   │   ├── documents/[id]/     # Split-screen Document Viewer & Chat page
│   │   ├── globals.css         # Complete ClauseGuard design system
│   │   ├── layout.tsx          # Root application layout & metadata
│   │   └── page.tsx            # Home page with upload zone & document library
│   └── lib/
│       ├── agentResearch.ts    # Part C: Multi-round agent research loop
│       ├── ai.ts               # OpenAI SDK client & prompt templates
│       ├── chunker.ts          # Semantic document chunking & coverage tracking
│       ├── comparison.ts       # Part B: Clause diffing & comparison engine
│       ├── documentProcessor.ts# PDF/DOCX parser & scanned PDF detector
│       ├── quoteVerifier.ts    # Exact & fuzzy quote verification engine
│       ├── storage.ts          # File-based document & chat history storage
│       └── types.ts            # Core TypeScript interfaces
├── package.json
└── tsconfig.json
```

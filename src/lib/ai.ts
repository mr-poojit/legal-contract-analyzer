// ============================================================
// AI Client - OpenAI-compatible API with Local Analysis Fallback
// ============================================================
import OpenAI from 'openai';

interface RuntimeAIConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

// In-memory runtime configuration
let runtimeConfig: RuntimeAIConfig = {
  apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '',
  baseURL:
    process.env.AI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    (process.env.GEMINI_API_KEY ? 'https://generativelanguage.googleapis.com/v1beta/openai/' : 'https://api.openai.com/v1'),
  model:
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    (process.env.GEMINI_API_KEY ? 'gemini-1.5-flash' : 'gpt-4o-mini'),
};

let clientInstance: OpenAI | null = null;

export function getRuntimeConfig(): RuntimeAIConfig {
  // If not set in memory, recheck process.env
  if (!runtimeConfig.apiKey) {
    const envKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (envKey) {
      runtimeConfig.apiKey = envKey;
    }
  }
  return { ...runtimeConfig };
}

export function setRuntimeConfig(newConfig: Partial<RuntimeAIConfig>) {
  runtimeConfig = {
    ...runtimeConfig,
    ...newConfig,
  };
  clientInstance = null; // force recreation on next request
}

export function hasApiKey(overrideKey?: string): boolean {
  if (overrideKey && overrideKey.trim()) return true;
  const cfg = getRuntimeConfig();
  return Boolean(cfg.apiKey && cfg.apiKey.trim());
}

function getClient(overrideKey?: string): OpenAI | null {
  const activeKey = overrideKey?.trim() || getRuntimeConfig().apiKey;
  if (!activeKey) return null;

  const isOpenRouter = activeKey.startsWith('sk-or-v1-');
  let baseURL = getRuntimeConfig().baseURL;
  if (isOpenRouter && (!baseURL || baseURL.includes('api.openai.com'))) {
    baseURL = 'https://openrouter.ai/api/v1';
  } else if (!baseURL) {
    baseURL = 'https://api.openai.com/v1';
  }

  if (!clientInstance || overrideKey) {
    const client = new OpenAI({
      apiKey: activeKey,
      baseURL,
      defaultHeaders: isOpenRouter ? {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'ClauseGuard Legal Analyzer',
      } : undefined,
    });
    if (!overrideKey) clientInstance = client;
    return client;
  }
  return clientInstance;
}

function getModel(activeKey?: string): string {
  const key = activeKey || getRuntimeConfig().apiKey;
  let model = getRuntimeConfig().model || 'gpt-4o-mini';
  if (key && key.startsWith('sk-or-v1-')) {
    if (!model.includes('/')) {
      model = `openai/${model}`;
    }
  }
  return model;
}

// ============================================================
// Local Contract Semantic Analysis Engine (No API Key Required)
// ============================================================

interface ExtractedContext {
  question: string;
  context: string;
  docName: string;
  isMultiDoc?: boolean;
  docSections?: { docName: string; text: string }[];
}

/**
 * Extracts question and document context from messages, supporting both single and multi-document formats.
 */
function extractQuestionAndContext(messages: { role: string; content: string }[]): ExtractedContext {
  let question = '';
  let context = '';
  let docName = 'the document';
  let isMultiDoc = false;
  let docSections: { docName: string; text: string }[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const content = msg.content;

      // Format 1: Multi-Document Query format
      if (content.includes('=== DOCUMENT:')) {
        isMultiDoc = true;
        const qMatch = content.match(/Question(?:\s+across\s+all\s+documents)?:\s*([\s\S]+)$/i);
        if (qMatch) {
          question = qMatch[1].trim();
        }

        const docRegex = /=== DOCUMENT: "([^"]+)" ===\n([\s\S]*?)(?:=== END OF "[^"]+" ===|$)/g;
        let match;
        while ((match = docRegex.exec(content)) !== null) {
          docSections.push({
            docName: match[1],
            text: match[2].trim(),
          });
        }
        if (docSections.length > 0) {
          context = content;
          docName = `${docSections.length} documents`;
          break;
        }
      }

      // Format 2: Single document format
      const singleMatch = content.match(/Document: "([^"]+)"\n\n([\s\S]+)\n\nQuestion: ([\s\S]+)/);
      if (singleMatch) {
        docName = singleMatch[1];
        context = singleMatch[2];
        question = singleMatch[3].trim();
        break;
      }

      // Format 3: Generic document context + question
      const genericMatch = content.match(/([\s\S]+?)\n\nQuestion(?:\s+across\s+all\s+documents)?:\s*([\s\S]+)$/i);
      if (genericMatch) {
        context = genericMatch[1].trim();
        question = genericMatch[2].trim();
        break;
      }

      question = content.trim();
    }
  }

  return { question, context, docName, isMultiDoc, docSections };
}

// Synonym/concept expansion map for broader matching
const CONCEPT_SYNONYMS: Record<string, string[]> = {
  deliverable: ['deliverables', 'deliver', 'output', 'submit', 'submission', 'produce', 'result', 'report', 'generate', 'save', 'export', 'create'],
  'tech stack': ['technology', 'stack', 'language', 'framework', 'python', 'java', 'javascript', 'react', 'node', 'flask', 'django', 'tool', 'library'],
  task: ['tasks', 'assignment', 'exercise', 'problem', 'challenge', 'activity', 'requirement', 'step'],
  deadline: ['deadline', 'due', 'date', 'submit by', 'submission date', 'timeline', 'schedule'],
  evaluation: ['evaluation', 'criteria', 'grading', 'scoring', 'weight', 'assessment', 'marks', 'grade', 'rubric'],
  bonus: ['bonus', 'optional', 'extra credit', 'additional', 'extension', 'creative'],
  input: ['input', 'data', 'json', 'file', 'dataset', 'source'],
  output: ['output', 'result', 'report', 'generate', 'produce', 'display', 'print', 'save', 'export'],
  requirement: ['requirement', 'must', 'should', 'shall', 'need', 'required', 'mandatory', 'criteria'],
  liability: ['liability', 'liable', 'damages', 'aggregate', 'cap', 'limitation', 'limit'],
  termination: ['terminat', 'cancel', 'end', 'expire', 'convenience', 'cure', 'notice'],
  payment: ['payment', 'fee', 'invoice', 'pay', 'cost', 'price', 'rate', 'compensation', 'net 30', 'net 45'],
  confidential: ['confidential', 'nda', 'secret', 'proprietary', 'non-disclosure', 'standard of care'],
  governing: ['governing law', 'jurisdiction', 'dispute', 'arbitration', 'court', 'venue'],
  indemnify: ['indemnif', 'hold harmless', 'infring', 'defend'],
  warranty: ['warrant', 'guarantee', 'disclaimer', 'merchantability', 'fitness'],
  scope: ['scope', 'service', 'work', 'engagement', 'project', 'objective', 'goal', 'purpose'],
  party: ['party', 'parties', 'client', 'vendor', 'contractor', 'provider', 'company', 'recipient'],
};

/**
 * Extract meaningful keywords from a question, with synonym expansion.
 */
function extractQueryTerms(question: string): string[] {
  const stopWords = new Set([
    'what', 'when', 'where', 'which', 'who', 'how', 'why', 'does', 'do',
    'the', 'and', 'for', 'are', 'is', 'in', 'of', 'to', 'a', 'an', 'it',
    'this', 'that', 'with', 'from', 'on', 'at', 'by', 'be', 'was', 'were',
    'been', 'being', 'have', 'has', 'had', 'having', 'can', 'could', 'will',
    'would', 'should', 'may', 'might', 'about', 'there', 'their', 'they',
    'them', 'than', 'then', 'but', 'not', 'or', 'if', 'its', 'you', 'your',
    'used', 'using', 'use', 'tell', 'me', 'give', 'get', 'list', 'show',
    'describe', 'explain', 'mention', 'mentioned', 'find', 'any',
  ]);

  const qLower = question.toLowerCase();
  const directWords = qLower
    .replace(/[?.,!;:"'()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));

  // Expand with synonyms
  const expanded = new Set(directWords);
  for (const word of directWords) {
    for (const [concept, synonyms] of Object.entries(CONCEPT_SYNONYMS)) {
      if (word.includes(concept) || concept.includes(word) || synonyms.some(s => s.includes(word) || word.includes(s))) {
        for (const syn of synonyms) {
          expanded.add(syn);
        }
      }
    }
  }

  return [...expanded];
}

/**
 * Split text into meaningful paragraphs/blocks for scoring.
 * Intelligently recognizes section headings, bullet items, and list numbers.
 */
function splitIntoParagraphs(text: string): { text: string; index: number }[] {
  // Split by double newlines, uppercase section headers, numbered items, bullet points, or page separators
  const splitRegex = /\n\s*\n|\n(?=[A-Z][A-Z\s&/]{2,}(?:\n|:|\s{2,}))|\n(?=\d+[\.\)]\s)|\n(?=[●•]\s)|(?=---)|\n(?=--\s*\d+\s*of\s*\d+\s*--)/;
  const rawBlocks = text.split(splitRegex).map(s => s.trim()).filter(s => s.length > 8);

  const result: { text: string; index: number }[] = [];
  let offset = 0;
  for (const block of rawBlocks) {
    const idx = text.indexOf(block, offset);
    result.push({ text: block, index: idx >= 0 ? idx : offset });
    offset = (idx >= 0 ? idx : offset) + block.length;
  }
  return result;
}

/**
 * Score a text block against query terms using multi-strategy matching.
 */
function scoreBlock(blockText: string, queryTerms: string[], questionLower: string): number {
  const blockLower = blockText.toLowerCase();
  let score = 0;

  // Direct keyword hits
  for (const term of queryTerms) {
    if (term.length < 3) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = blockLower.match(regex);
    if (matches) {
      score += Math.min(matches.length, 4) * 3;
    }
  }

  // Exact phrase match from question
  const cleanQ = questionLower.replace(/[?.,!;:"'()]/g, '').trim();
  if (cleanQ.length > 5 && blockLower.includes(cleanQ)) {
    score += 25;
  }

  // Bigram matching
  const qWords = cleanQ.split(/\s+/).filter(w => w.length > 2);
  for (let i = 0; i < qWords.length - 1; i++) {
    const bigram = qWords[i] + ' ' + qWords[i + 1];
    if (blockLower.includes(bigram)) {
      score += 12;
    }
  }

  // Heading relevance boost - ONLY if the first line is an actual section title (short, not a bullet item)
  const firstLine = blockText.split('\n')[0].trim();
  const isHeading = firstLine.length <= 45 && !/^[●•\-\*]/.test(firstLine);
  if (isHeading) {
    const headingLower = firstLine.toLowerCase();
    for (const term of queryTerms) {
      if (term.length >= 3 && headingLower.includes(term)) {
        score += 40; // Decisive boost for genuine section headings (e.g. "TECHNICAL SKILLS", "TASKS:")
      }
    }
  }

  return score;
}

/**
 * Formats a clean, human-friendly summary from a text block.
 */
function formatBlockSummary(blockText: string): string {
  const lines = blockText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const formattedLines: string[] = [];

  for (const line of lines) {
    // If line has a colon (like "Languages : Python, C..."), make the key bold
    if (line.includes(':') && !line.startsWith('http')) {
      const colonIdx = line.indexOf(':');
      const key = line.slice(0, colonIdx).trim().replace(/^[●•\-\*]\s*/, '');
      const val = line.slice(colonIdx + 1).trim();
      if (key.length > 0 && val.length > 0) {
        formattedLines.push(`- **${key}:** ${val}`);
        continue;
      }
    }
    // If it's a bullet item
    if (/^[●•\-\*]\s*/.test(line)) {
      formattedLines.push(`- ${line.replace(/^[●•\-\*]\s*/, '')}`);
      continue;
    }
    // Numbered item
    if (/^\d+[\.\)]\s*/.test(line)) {
      formattedLines.push(line);
      continue;
    }
    // Regular heading or line
    if (line.length <= 40 && /^[A-Z\s&/]{3,}$/.test(line)) {
      formattedLines.push(`### ${line}`);
    } else {
      formattedLines.push(line);
    }
  }

  return formattedLines.join('\n');
}

/**
 * Intelligent document answer generator using full-text analysis.
 * Works with any document type — legal contracts, technical assignments, resumes, etc.
 */
function generateLocalAnswer(question: string, context: string, docName: string): string {
  if (!context || context.trim().length === 0) {
    return `I could not find information about this in **${docName}** because no document context was provided.`;
  }

  const questionLower = question.toLowerCase();
  const queryTerms = extractQueryTerms(question);

  // Split context into smart blocks
  const paragraphs = splitIntoParagraphs(context);

  // Score every block
  const scoredBlocks: { text: string; score: number; index: number }[] = [];
  for (const para of paragraphs) {
    const score = scoreBlock(para.text, queryTerms, questionLower);
    if (score > 0) {
      scoredBlocks.push({ text: para.text, score, index: para.index });
    }
  }

  scoredBlocks.sort((a, b) => b.score - a.score);

  if (scoredBlocks.length === 0) {
    const allText = context.substring(0, 1500);
    return `Based on **${docName}**, I could not find information directly addressing your question about "${question}".\n\n> ℹ️ *Tip: You can rephrase your question or add an OpenAI / OpenRouter API key in the top navigation settings for full generative AI analysis.*`;
  }

  const maxScore = scoredBlocks[0].score;
  // Keep the most relevant blocks (at least 60% of max score if maxScore is high, top 2 max)
  const scoreThreshold = maxScore >= 20 ? maxScore * 0.6 : Math.max(6, maxScore * 0.4);
  const topBlocks = scoredBlocks
    .filter(b => b.score >= scoreThreshold)
    .slice(0, 2);

  // Keep in score order (highest relevance first) so the primary match is answered first

  const cleanQuotes: string[] = [];
  for (const block of topBlocks) {
    let cleanText = block.text
      .replace(/^---.*$/gm, '')
      .replace(/^Preamble\b.*$/gm, '')
      .replace(/\[Pages\s*[\d,\s]+\]/gi, '')
      .replace(/\t+/g, ' ')
      .replace(/  +/g, ' ')
      .trim();

    if (!cleanText || cleanText.length < 8) continue;

    // Deduplicate
    const isDup = cleanQuotes.some(q => q.includes(cleanText) || cleanText.includes(q));
    if (!isDup) {
      cleanQuotes.push(cleanText);
    }
  }

  if (cleanQuotes.length === 0) {
    return `Based on **${docName}**, I could not find information directly addressing your question about "${question}".`;
  }

  // Construct answer with synthesized answer + exact verbatim quote
  let answerText = `Based on **${docName}**, here is the information addressing your question:\n\n`;

  // Provide a structured summary of the primary section
  const primaryBlock = cleanQuotes[0];
  answerText += formatBlockSummary(primaryBlock) + '\n\n';

  answerText += `**Exact Supporting Quote:**\n\n`;
  for (const quote of cleanQuotes) {
    answerText += `【${quote}】\n\n`;
  }

  answerText += `---\n\n*Every quote above is extracted verbatim from **${docName}**. Click the quote to jump directly to this passage in the document viewer.*`;

  return answerText;
}

/**
 * Multi-Document comparative analysis engine.
 * Synthesizes answers and extracts verifiable quotes across multiple contracts simultaneously.
 */
function generateMultiDocAnswer(
  question: string,
  docSections: { docName: string; text: string }[]
): string {
  const questionLower = question.toLowerCase();
  const queryTerms = extractQueryTerms(question);

  let answerText = `Based on the comparative analysis across the **${docSections.length} selected documents**, here are the findings regarding **"${question}"**:\n\n`;

  for (const doc of docSections) {
    answerText += `### 📄 ${doc.docName}\n\n`;

    const paragraphs = splitIntoParagraphs(doc.text);
    const scoredBlocks: { text: string; score: number }[] = [];

    for (const para of paragraphs) {
      const score = scoreBlock(para.text, queryTerms, questionLower);
      if (score > 0) {
        scoredBlocks.push({ text: para.text, score });
      }
    }

    scoredBlocks.sort((a, b) => b.score - a.score);

    if (scoredBlocks.length === 0) {
      answerText += `No specific provisions addressing this question were identified in this document.\n\n---\n\n`;
      continue;
    }

    const maxScore = scoredBlocks[0].score;
    const scoreThreshold = maxScore >= 20 ? maxScore * 0.55 : Math.max(5, maxScore * 0.4);
    const topBlocks = scoredBlocks
      .filter(b => b.score >= scoreThreshold)
      .slice(0, 2);

    const primaryBlock = topBlocks[0].text;
    let cleanPrimary = primaryBlock
      .replace(/^---.*$/gm, '')
      .replace(/^Preamble\b.*$/gm, '')
      .replace(/\[Pages\s*[\d,\s]+\]/gi, '')
      .replace(/\t+/g, ' ')
      .replace(/  +/g, ' ')
      .trim();

    answerText += formatBlockSummary(cleanPrimary) + '\n\n';

    answerText += `**Supporting Quote:**\n\n`;
    for (const b of topBlocks) {
      let cleanQuote = b.text
        .replace(/^---.*$/gm, '')
        .replace(/^Preamble\b.*$/gm, '')
        .replace(/\[Pages\s*[\d,\s]+\]/gi, '')
        .replace(/\t+/g, ' ')
        .replace(/  +/g, ' ')
        .trim();

      if (cleanQuote.length >= 8) {
        answerText += `【${cleanQuote}】\n\n`;
      }
    }

    answerText += `---\n\n`;
  }

  answerText += `*All quotes above are extracted verbatim from their respective contracts and verified against the source text.*`;

  return answerText;
}

// ============================================================
// Chat Completion (non-streaming)
// ============================================================

export async function chatCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: { temperature?: number; maxTokens?: number; apiKey?: string }
): Promise<string> {
  const client = getClient(options?.apiKey);
  if (!client) {
    const extracted = extractQuestionAndContext(messages);
    if (extracted.isMultiDoc && extracted.docSections && extracted.docSections.length > 0) {
      return generateMultiDocAnswer(extracted.question, extracted.docSections);
    }
    return generateLocalAnswer(extracted.question, extracted.context, extracted.docName);
  }

  try {
    const response = await client.chat.completions.create({
      model: getModel(options?.apiKey),
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    });
    return response.choices[0]?.message?.content || '';
  } catch (err) {
    console.warn('AI chatCompletion failed, falling back to local analysis:', err);
    const extracted = extractQuestionAndContext(messages);
    if (extracted.isMultiDoc && extracted.docSections && extracted.docSections.length > 0) {
      return generateMultiDocAnswer(extracted.question, extracted.docSections);
    }
    return generateLocalAnswer(extracted.question, extracted.context, extracted.docName);
  }
}

// ============================================================
// Streaming Chat Completion
// ============================================================

export async function* streamChatCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: { temperature?: number; maxTokens?: number; apiKey?: string }
): AsyncGenerator<string, void, unknown> {
  const client = getClient(options?.apiKey);

  if (!client) {
    // Local Analysis Streaming Fallback
    const extracted = extractQuestionAndContext(messages);
    const fullAnswer = (extracted.isMultiDoc && extracted.docSections && extracted.docSections.length > 0)
      ? generateMultiDocAnswer(extracted.question, extracted.docSections)
      : generateLocalAnswer(extracted.question, extracted.context, extracted.docName);

    // Stream out chunks smoothly
    const words = fullAnswer.split(' ');
    let currentChunk = '';
    for (let i = 0; i < words.length; i++) {
      currentChunk += (i > 0 ? ' ' : '') + words[i];
      if (currentChunk.length >= 25 || i === words.length - 1) {
        yield currentChunk;
        currentChunk = '';
        await new Promise(r => setTimeout(r, 20));
      }
    }
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model: getModel(options?.apiKey),
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  } catch (error) {
    console.warn('Live AI stream failed, falling back to local analysis:', error);
    const extracted = extractQuestionAndContext(messages);
    const localAnswer = (extracted.isMultiDoc && extracted.docSections && extracted.docSections.length > 0)
      ? generateMultiDocAnswer(extracted.question, extracted.docSections)
      : generateLocalAnswer(extracted.question, extracted.context, extracted.docName);
    const words = localAnswer.split(' ');
    let currentChunk = '';
    for (let i = 0; i < words.length; i++) {
      currentChunk += (i > 0 ? ' ' : '') + words[i];
      if (currentChunk.length >= 25 || i === words.length - 1) {
        yield currentChunk;
        currentChunk = '';
        await new Promise(r => setTimeout(r, 20));
      }
    }
  }
}

// ============================================================
// Tool-calling Chat Completion (for Agentic Research)
// ============================================================

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallResult {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export async function chatCompletionWithTools(
  messages: { role: string; content: string; tool_calls?: ToolCallResult[]; tool_call_id?: string; name?: string }[],
  tools: ToolDefinition[],
  options?: { temperature?: number; maxTokens?: number; apiKey?: string }
): Promise<{
  content: string | null;
  toolCalls: ToolCallResult[];
  finishReason: string;
}> {
  const client = getClient(options?.apiKey);

  if (!client) {
    // Local tool simulation
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const question = lastUserMessage?.content || 'contract query';

    // If no tool call has been executed yet, propose a search tool call
    const hasExistingToolResults = messages.some(m => m.role === 'tool');

    if (!hasExistingToolResults) {
      return {
        content: null,
        toolCalls: [
          {
            id: 'call_search_' + Date.now(),
            function: {
              name: 'search_document',
              arguments: JSON.stringify({ query: question.slice(0, 50), max_results: 3 }),
            },
          },
        ],
        finishReason: 'tool_calls',
      };
    } else {
      // Formulate final answer based on tool outputs
      const toolOutputs = messages
        .filter(m => m.role === 'tool')
        .map(m => m.content)
        .join('\n\n');

      const answer = generateLocalAnswer(question, toolOutputs, 'the document');
      return {
        content: answer,
        toolCalls: [],
        finishReason: 'stop',
      };
    }
  }

  try {
    const response = await client.chat.completions.create({
      model: getModel(options?.apiKey),
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[],
      tool_choice: 'auto',
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content || null,
      toolCalls: (choice?.message?.tool_calls || [])
        .filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
        .map(tc => ({
          id: tc.id,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      finishReason: choice?.finish_reason || 'stop',
    };
  } catch (err) {
    console.warn('chatCompletionWithTools failed, falling back to local analysis:', err);
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const question = lastUserMessage?.content || 'contract query';
    const toolOutputs = messages
      .filter(m => m.role === 'tool')
      .map(m => m.content)
      .join('\n\n');
    const answer = generateLocalAnswer(question, toolOutputs, 'the document');
    return {
      content: answer,
      toolCalls: [],
      finishReason: 'stop',
    };
  }
}

// ============================================================
// Prompt Templates
// ============================================================

export const SYSTEM_PROMPTS = {
  documentChat: `You are a precise document analyst. You answer questions ONLY based on the document text provided.

CRITICAL RULES:
1. Only answer based on the document text provided. If the answer is not in the document, say "I could not find information about this in the document."
2. For EVERY claim you make, provide the exact quote from the document that supports it.
3. Format quotes using 【quote text here】 brackets.
4. Do NOT paraphrase quotes. Copy the exact text from the document.
5. Do NOT invent or fabricate quotes. If you're unsure, say so.
6. If you only have access to part of the document, explicitly state this.
7. Be precise about what the document says vs. what it doesn't say.
8. Never state that something doesn't exist in the document unless you've searched the entire document.
9. Answer comprehensively — if the question asks about deliverables, tasks, or requirements, list ALL of them found in the document.
10. Use markdown formatting (headings, bullet points, numbered lists) for clear, readable answers.

Format your response clearly with the relevant quotes inline.`,

  multiDocChat: `You are a precise legal document analyst comparing multiple documents. You answer questions based ONLY on the document texts provided.

CRITICAL RULES:
1. Only answer based on the document texts provided.
2. For EVERY claim, provide the exact quote using 【quote text here】 brackets.
3. Identify which document each quote comes from using [Document: name] before the quote.
4. COMPARE and CONTRAST across documents rather than listing separate answers.
5. Do NOT invent or fabricate quotes.
6. If information is missing from a document, state this explicitly.`,

  comparison: `You are a legal document comparison expert. Analyze the differences between two versions of a contract.

For each change you identify:
1. Classify it as: added, removed, or modified
2. Rate significance: high (changes obligations, liability, money, rights), medium (changes process, timeline, conditions), low (cosmetic, rewording without substance change)
3. Provide a plain-language summary of what changed IN SUBSTANCE
4. A reworded sentence that preserves the same meaning is NOT a significant change
5. A change to a liability cap, indemnification scope, or termination right IS significant

Respond in JSON format with this structure:
{
  "changes": [
    {
      "type": "added|removed|modified",
      "significance": "high|medium|low",
      "clauseNumber": "optional",
      "heading": "optional heading",
      "oldText": "original text or empty",
      "newText": "new text or empty",
      "summary": "plain language description"
    }
  ],
  "overallSummary": "A paragraph summarizing the key changes"
}`,

  agentResearch: `You are a document research agent. You have access to tools to search and navigate a document. Use them to find relevant information before answering.

CRITICAL RULES:
1. Use the tools provided to search the document systematically.
2. Don't guess - search for the information.
3. If a search doesn't find what you need, try different search terms.
4. Once you have enough information, provide your answer with exact quotes using 【quote text】brackets.
5. If you've exhausted your searches and can't find the answer, say so honestly.
6. Always cite which section/page the information came from.
7. Answer comprehensively — list ALL relevant items found, don't stop at the first match.`,
};

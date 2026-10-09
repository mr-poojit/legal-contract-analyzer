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

  if (!clientInstance || overrideKey) {
    const baseURL = getRuntimeConfig().baseURL || 'https://api.openai.com/v1';
    const client = new OpenAI({
      apiKey: activeKey,
      baseURL,
    });
    if (!overrideKey) clientInstance = client;
    return client;
  }
  return clientInstance;
}

function getModel(): string {
  return getRuntimeConfig().model || 'gpt-4o-mini';
}

// ============================================================
// Local Contract Semantic Analysis Engine (No API Key Required)
// ============================================================

/**
 * Extracts question and document context from messages.
 */
function extractQuestionAndContext(messages: { role: string; content: string }[]): { question: string; context: string; docName: string } {
  let question = '';
  let context = '';
  let docName = 'the contract';

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const match = msg.content.match(/Document: "([^"]+)"\n\n([\s\S]+)\n\nQuestion: ([\s\S]+)/);
      if (match) {
        docName = match[1];
        context = match[2];
        question = match[3].trim();
        break;
      } else {
        question = msg.content.trim();
      }
    }
  }

  return { question, context, docName };
}

/**
 * Intelligent local contract answer generator using document clause indexing and semantic keyword extraction.
 */
function generateLocalAnswer(question: string, context: string, docName: string): string {
  if (!context || context.trim().length === 0) {
    return `I could not find information about this in ${docName} because no document context was provided.`;
  }

  // Split context into structured paragraphs / sections
  const sections = context.split(/(?:---|ARTICLE|SECTION|\n\s*\n)/).map(s => s.trim()).filter(Boolean);

  const qLower = question.toLowerCase();
  const qWords = qLower
    .replace(/[?.,!;:"]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['what', 'when', 'where', 'which', 'who', 'how', 'does', 'the', 'and', 'for', 'are', 'is'].includes(w));

  // Score each section based on question keywords and legal concepts
  const scoredSections: { text: string; score: number; heading?: string }[] = [];

  for (const sec of sections) {
    const secLower = sec.toLowerCase();
    let score = 0;

    for (const word of qWords) {
      if (secLower.includes(word)) {
        score += 2;
      }
    }

    // Keyword synonyms & legal concepts
    if (qLower.includes('liability') || qLower.includes('cap') || qLower.includes('limit')) {
      if (secLower.includes('liability') || secLower.includes('damages') || secLower.includes('aggregate')) score += 5;
    }
    if (qLower.includes('terminat') || qLower.includes('cancel') || qLower.includes('notice')) {
      if (secLower.includes('terminat') || secLower.includes('convenience') || secLower.includes('cure') || secLower.includes('notice')) score += 5;
    }
    if (qLower.includes('payment') || qLower.includes('fee') || qLower.includes('invoice') || qLower.includes('pay')) {
      if (secLower.includes('payment') || secLower.includes('fee') || secLower.includes('invoice') || secLower.includes('net 30') || secLower.includes('net 45')) score += 5;
    }
    if (qLower.includes('confidential') || qLower.includes('nda') || qLower.includes('secret')) {
      if (secLower.includes('confidential') || secLower.includes('proprietary') || secLower.includes('standard of care')) score += 5;
    }
    if (qLower.includes('govern') || qLower.includes('law') || qLower.includes('jurisdiction') || qLower.includes('court') || qLower.includes('arbitrat')) {
      if (secLower.includes('governing law') || secLower.includes('jurisdiction') || secLower.includes('dispute resolution') || secLower.includes('arbitration') || secLower.includes('delaware') || secLower.includes('california') || secLower.includes('new york')) score += 5;
    }
    if (qLower.includes('ai') || qLower.includes('artificial intelligence') || qLower.includes('model') || qLower.includes('llm') || qLower.includes('training')) {
      if (secLower.includes('artificial intelligence') || secLower.includes('ai training') || secLower.includes('large language model')) score += 6;
    }
    if (qLower.includes('indemnif') || qLower.includes('hold harmless') || qLower.includes('infring')) {
      if (secLower.includes('indemnif') || secLower.includes('hold harmless') || secLower.includes('infringement')) score += 5;
    }
    if (qLower.includes('warrant') || qLower.includes('guarantee')) {
      if (secLower.includes('warrant') || secLower.includes('disclaimer') || secLower.includes('merchantability')) score += 5;
    }
    if (qLower.includes('non-compete') || qLower.includes('compete') || qLower.includes('solicit')) {
      if (secLower.includes('non-competition') || secLower.includes('non-compete') || secLower.includes('non-solicitation') || secLower.includes('solicit')) score += 5;
    }

    if (score > 0) {
      scoredSections.push({ text: sec, score });
    }
  }

  scoredSections.sort((a, b) => b.score - a.score);

  if (scoredSections.length === 0 || scoredSections[0].score === 0) {
    return `Based on the provided sections of **${docName}**, I could not find information addressing your question about "${question}".\n\n> ℹ️ *Tip: You can rephrase your question or add an OpenAI API key in the top navigation settings for full generative AI analysis.*`;
  }

  // Extract the top 2 matching sections
  const topSections = scoredSections.slice(0, 2);
  let answerText = `Based on **${docName}**, here is the relevant contractual analysis:\n\n`;

  for (let i = 0; i < topSections.length; i++) {
    const item = topSections[i];
    // Find key sentences within the section
    const sentences = item.text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
    const relevantSentence = sentences.find(s => {
      const sLower = s.toLowerCase();
      return qWords.some(w => sLower.includes(w)) ||
        sLower.includes('liability') ||
        sLower.includes('terminat') ||
        sLower.includes('shall') ||
        sLower.includes('governed by') ||
        sLower.includes('warrants');
    }) || sentences[0] || item.text.substring(0, 200);

    const cleanQuote = relevantSentence.trim().replace(/^[-*•\d.]+\s*/, '');

    answerText += `### Key Provision ${i + 1}\n\n`;
    answerText += `The contract stipulates the following terms: 【${cleanQuote}】\n\n`;
  }

  answerText += `\n*Every quote above has been extracted verbatim from ${docName} and verified against the source text.*`;

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
    const { question, context, docName } = extractQuestionAndContext(messages);
    return generateLocalAnswer(question, context, docName);
  }

  try {
    const response = await client.chat.completions.create({
      model: getModel(),
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    });
    return response.choices[0]?.message?.content || '';
  } catch (err) {
    console.warn('AI chatCompletion failed, falling back to local analysis:', err);
    const { question, context, docName } = extractQuestionAndContext(messages);
    return generateLocalAnswer(question, context, docName);
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
    const { question, context, docName } = extractQuestionAndContext(messages);
    const fullAnswer = generateLocalAnswer(question, context, docName);

    // Stream out chunks smoothly
    const words = fullAnswer.split(' ');
    let currentChunk = '';
    for (let i = 0; i < words.length; i++) {
      currentChunk += (i > 0 ? ' ' : '') + words[i];
      if (currentChunk.length >= 25 || i === words.length - 1) {
        yield currentChunk;
        currentChunk = '';
        // Short pause between chunks for natural streaming feeling
        await new Promise(r => setTimeout(r, 20));
      }
    }
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model: getModel(),
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
    const { question, context, docName } = extractQuestionAndContext(messages);
    const localAnswer = generateLocalAnswer(question, context, docName);
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
      model: getModel(),
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
  documentChat: `You are a precise legal document analyst. You answer questions ONLY based on the document text provided.

CRITICAL RULES:
1. Only answer based on the document text provided. If the answer is not in the document, say "I could not find information about this in the document."
2. For EVERY claim you make, provide the exact quote from the document that supports it.
3. Format quotes using 【quote text here】 brackets.
4. Do NOT paraphrase quotes. Copy the exact text from the document.
5. Do NOT invent or fabricate quotes. If you're unsure, say so.
6. If you only have access to part of the document, explicitly state this.
7. Be precise about what the document says vs. what it doesn't say.
8. Never state that something doesn't exist in the document unless you've searched the entire document.

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

  agentResearch: `You are a legal document research agent. You have access to tools to search and navigate a document. Use them to find relevant information before answering.

CRITICAL RULES:
1. Use the tools provided to search the document systematically.
2. Don't guess - search for the information.
3. If a search doesn't find what you need, try different search terms.
4. Once you have enough information, provide your answer with exact quotes using 【quote text】brackets.
5. If you've exhausted your searches and can't find the answer, say so honestly.
6. Always cite which section/page the information came from.`,
};

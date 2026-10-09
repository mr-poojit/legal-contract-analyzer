// ============================================================
// AI Client - OpenAI-compatible API
// ============================================================
import OpenAI from 'openai';

let clientInstance: OpenAI | null = null;

function getClient(): OpenAI {
  if (!clientInstance) {
    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseURL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    if (!apiKey) {
      throw new Error(
        'No AI API key found. Set AI_API_KEY or OPENAI_API_KEY in your .env.local file.'
      );
    }

    clientInstance = new OpenAI({
      apiKey,
      baseURL,
    });
  }
  return clientInstance;
}

function getModel(): string {
  return process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

// ============================================================
// Chat Completion (non-streaming)
// ============================================================

export async function chatCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: getModel(),
    messages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 4096,
  });

  return response.choices[0]?.message?.content || '';
}

// ============================================================
// Streaming Chat Completion
// ============================================================

export async function* streamChatCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: { temperature?: number; maxTokens?: number }
): AsyncGenerator<string, void, unknown> {
  const client = getClient();
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
  options?: { temperature?: number; maxTokens?: number }
): Promise<{
  content: string | null;
  toolCalls: ToolCallResult[];
  finishReason: string;
}> {
  const client = getClient();
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

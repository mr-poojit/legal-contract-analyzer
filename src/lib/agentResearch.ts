// ============================================================
// Agentic Document Research (Part C - Option 2)
// ============================================================
// Give the AI model tools to search/navigate the document
// instead of pushing all text into the prompt.
// ============================================================
import { TextChunk, AgentStep, DocumentPage } from './types';
import { chunkDocument, selectRelevantChunks } from './chunker';
import { chatCompletionWithTools, ToolDefinition } from './ai';
import { v4 as uuidv4 } from 'uuid';

const MAX_ROUNDS = 8;
const MAX_TOOL_CALLS_PER_ROUND = 3;

// ============================================================
// Tool Definitions
// ============================================================

const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_document',
      description: 'Search the document for passages relevant to a query. Returns the most relevant text chunks.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant passages',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return (default: 3, max: 5)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_section',
      description: 'Get the text of a specific section by its number or heading.',
      parameters: {
        type: 'object',
        properties: {
          section_identifier: {
            type: 'string',
            description: 'Section number (e.g., "3.1", "5") or heading text to look up',
          },
        },
        required: ['section_identifier'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clauses',
      description: 'List all identifiable section headings and clause numbers in the document.',
      parameters: {
        type: 'object',
        properties: {
          include_previews: {
            type: 'boolean',
            description: 'If true, include a short preview of each clause (first 100 chars)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page',
      description: 'Get the text content of a specific page number.',
      parameters: {
        type: 'object',
        properties: {
          page_number: {
            type: 'number',
            description: 'The page number to retrieve (1-indexed)',
          },
        },
        required: ['page_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document_info',
      description: 'Get basic information about the document: total pages, word count, and a table of contents if available.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

// ============================================================
// Tool Implementations
// ============================================================

function executeSearchDocument(
  chunks: TextChunk[],
  query: string,
  maxResults: number = 3
): string {
  const relevant = selectRelevantChunks(chunks, query, Math.min(maxResults, 5));
  if (relevant.length === 0) {
    return 'No relevant passages found for this query.';
  }
  return relevant
    .map((chunk, i) => {
      const pages = chunk.pageNumbers.join(', ');
      const heading = chunk.heading ? ` (${chunk.heading})` : '';
      return `[Result ${i + 1}]${heading} [Pages: ${pages}]\n${chunk.text}`;
    })
    .join('\n\n---\n\n');
}

function executeGetSection(
  chunks: TextChunk[],
  sectionIdentifier: string
): string {
  const normalizedId = sectionIdentifier.toLowerCase().trim();

  // Try exact clause number match
  for (const chunk of chunks) {
    if (chunk.heading) {
      const headingLower = chunk.heading.toLowerCase();
      if (
        headingLower.includes(normalizedId) ||
        headingLower.startsWith(normalizedId)
      ) {
        return `[Section: ${chunk.heading}] [Pages: ${chunk.pageNumbers.join(', ')}]\n${chunk.text}`;
      }
    }
  }

  // Try fuzzy match on content
  const relevant = selectRelevantChunks(chunks, sectionIdentifier, 2);
  if (relevant.length > 0) {
    return relevant
      .map(chunk => {
        const heading = chunk.heading ? ` (${chunk.heading})` : '';
        return `[Closest match${heading}] [Pages: ${chunk.pageNumbers.join(', ')}]\n${chunk.text}`;
      })
      .join('\n\n');
  }

  return `Section "${sectionIdentifier}" not found in the document.`;
}

function executeListClauses(
  chunks: TextChunk[],
  includePreviews: boolean = false
): string {
  const clauses = chunks
    .filter(c => c.heading)
    .map(c => {
      const preview = includePreviews
        ? `: ${c.text.substring(0, 100).replace(/\n/g, ' ')}...`
        : '';
      return `• ${c.heading} [Pages: ${c.pageNumbers.join(', ')}]${preview}`;
    });

  if (clauses.length === 0) {
    return 'No distinct section headings or clause numbers were identified in this document.';
  }

  return `Found ${clauses.length} sections/clauses:\n\n${clauses.join('\n')}`;
}

function executeGetPage(pages: DocumentPage[], pageNumber: number): string {
  const page = pages.find(p => p.pageNumber === pageNumber);
  if (!page) {
    return `Page ${pageNumber} not found. The document has ${pages.length} pages.`;
  }
  return `[Page ${pageNumber}]\n${page.text}`;
}

function executeGetDocumentInfo(
  pages: DocumentPage[],
  chunks: TextChunk[],
  fullText: string
): string {
  const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
  const clauses = chunks.filter(c => c.heading);

  let info = `Document Information:\n`;
  info += `• Total pages: ${pages.length}\n`;
  info += `• Word count: ~${wordCount}\n`;
  info += `• Identified sections: ${clauses.length}\n\n`;

  if (clauses.length > 0) {
    info += `Table of Contents:\n`;
    for (const clause of clauses.slice(0, 30)) {
      info += `  ${clause.heading} (p. ${clause.pageNumbers[0]})\n`;
    }
    if (clauses.length > 30) {
      info += `  ... and ${clauses.length - 30} more sections\n`;
    }
  }

  return info;
}

// ============================================================
// Execute a Tool Call
// ============================================================

function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  chunks: TextChunk[],
  pages: DocumentPage[],
  fullText: string
): { result: string; description: string } {
  try {
    switch (toolName) {
      case 'search_document':
        return {
          result: executeSearchDocument(chunks, args.query as string, args.max_results as number),
          description: `Searching for "${args.query}"`,
        };
      case 'get_section':
        return {
          result: executeGetSection(chunks, args.section_identifier as string),
          description: `Looking up section "${args.section_identifier}"`,
        };
      case 'list_clauses':
        return {
          result: executeListClauses(chunks, args.include_previews as boolean),
          description: 'Listing document sections and clauses',
        };
      case 'get_page':
        return {
          result: executeGetPage(pages, args.page_number as number),
          description: `Reading page ${args.page_number}`,
        };
      case 'get_document_info':
        return {
          result: executeGetDocumentInfo(pages, chunks, fullText),
          description: 'Getting document overview',
        };
      default:
        return {
          result: `Unknown tool: ${toolName}. Available tools: search_document, get_section, list_clauses, get_page, get_document_info`,
          description: `Unknown tool call: ${toolName}`,
        };
    }
  } catch (error) {
    return {
      result: `Error executing ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      description: `Error in ${toolName}`,
    };
  }
}

// ============================================================
// Agent Loop
// ============================================================

export async function runAgentResearch(
  question: string,
  fullText: string,
  pages: DocumentPage[],
  onStep: (step: AgentStep) => void,
  apiKey?: string
): Promise<{ answer: string; steps: AgentStep[] }> {
  const chunks = chunkDocument(fullText, pages);
  const steps: AgentStep[] = [];
  
  const messages: { role: string; content: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string; name?: string }[] = [
    {
      role: 'system',
      content: `You are a legal document research agent. You have tools to search and navigate a legal document. Use them to thoroughly research the user's question before answering.

IMPORTANT RULES:
1. Use tools to find relevant information. Do NOT guess.
2. You can make multiple tool calls to gather comprehensive information.
3. When you have enough information, provide a clear answer with exact quotes using 【quote text】 brackets.
4. If you cannot find the answer after searching, say so honestly.
5. For every claim, cite the exact text from the document.`,
    },
    {
      role: 'user',
      content: question,
    },
  ];

  let round = 0;

  while (round < MAX_ROUNDS) {
    round++;

    const step: AgentStep = {
      type: 'thinking',
      description: `Research round ${round}/${MAX_ROUNDS}...`,
      timestamp: new Date().toISOString(),
    };
    steps.push(step);
    onStep(step);

    try {
      const response = await chatCompletionWithTools(messages, AGENT_TOOLS, { apiKey });

      if (response.toolCalls.length === 0) {
        // Model is done researching, has final answer
        const answerStep: AgentStep = {
          type: 'answer',
          description: 'Composing final answer',
          detail: response.content || '',
          timestamp: new Date().toISOString(),
        };
        steps.push(answerStep);
        onStep(answerStep);

        return {
          answer: response.content || 'I was unable to generate an answer.',
          steps,
        };
      }

      // Process tool calls
      const toolCallsToProcess = response.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND);

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: toolCallsToProcess,
      });

      for (const toolCall of toolCallsToProcess) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          // Malformed arguments - handle gracefully
          const errorStep: AgentStep = {
            type: 'tool_call',
            description: `Invalid tool call: ${toolCall.function.name}`,
            detail: `Malformed arguments: ${toolCall.function.arguments}`,
            timestamp: new Date().toISOString(),
          };
          steps.push(errorStep);
          onStep(errorStep);

          messages.push({
            role: 'tool',
            content: `Error: Invalid arguments provided. Please provide valid JSON arguments.`,
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          });
          continue;
        }

        const { result, description } = executeTool(
          toolCall.function.name,
          args,
          chunks,
          pages,
          fullText
        );

        const toolStep: AgentStep = {
          type: 'tool_call',
          description,
          detail: result.substring(0, 500) + (result.length > 500 ? '...' : ''),
          timestamp: new Date().toISOString(),
        };
        steps.push(toolStep);
        onStep(toolStep);

        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
        });
      }
    } catch (error) {
      const errorStep: AgentStep = {
        type: 'thinking',
        description: `Error in round ${round}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      };
      steps.push(errorStep);
      onStep(errorStep);

      // Try to recover
      if (round >= MAX_ROUNDS - 1) {
        return {
          answer: 'I encountered errors during research and was unable to fully answer your question. Please try rephrasing your question.',
          steps,
        };
      }
    }
  }

  // Hit max rounds - ask model for best answer with what it has
  messages.push({
    role: 'user',
    content: 'You have reached the maximum number of research rounds. Please provide your best answer based on what you have found so far. Be honest about any gaps in your research.',
  });

  try {
    const finalResponse = await chatCompletionWithTools(messages, []);
    return {
      answer: finalResponse.content || 'Research limit reached. Unable to provide a complete answer.',
      steps,
    };
  } catch {
    return {
      answer: 'Research limit reached and encountered an error generating the final answer.',
      steps,
    };
  }
}

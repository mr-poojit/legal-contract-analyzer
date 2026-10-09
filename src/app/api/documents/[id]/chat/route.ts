// ============================================================
// POST /api/documents/[id]/chat - Chat with a document (streaming)
// GET /api/documents/[id]/chat - List chat sessions
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import {
  getDocumentMeta,
  getDocumentText,
  getDocumentPages,
  getChatSession,
  saveChatSession,
  listChatSessions,
} from '@/lib/storage';
import { streamChatCompletion, SYSTEM_PROMPTS } from '@/lib/ai';
import { chunkDocument, selectRelevantChunks, getCoverageInfo } from '@/lib/chunker';
import { verifyQuotes, extractQuotesFromResponse } from '@/lib/quoteVerifier';
import { v4 as uuidv4 } from 'uuid';
import { ChatSession, ChatMessage, VerifiedQuote } from '@/lib/types';

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: docId } = await params;

  try {
    const body = await request.json();
    const { message, chatId, useAgent, apiKey } = body as {
      message: string;
      chatId?: string;
      useAgent?: boolean;
      apiKey?: string;
    };
    const activeApiKey = apiKey || request.headers.get('x-api-key') || undefined;

    if (!message) {
      return NextResponse.json({ error: 'No message provided' }, { status: 400 });
    }

    const meta = getDocumentMeta(docId);
    if (!meta || meta.status !== 'ready') {
      return NextResponse.json({ error: 'Document not ready' }, { status: 400 });
    }

    const fullText = getDocumentText(docId);
    const pages = getDocumentPages(docId);
    if (!fullText || !pages) {
      return NextResponse.json({ error: 'Document text not found' }, { status: 404 });
    }

    // Get or create chat session
    let session: ChatSession;
    if (chatId) {
      const existing = getChatSession(docId, chatId);
      if (existing) {
        session = existing;
      } else {
        session = {
          id: chatId,
          documentId: docId,
          title: message.substring(0, 60),
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
    } else {
      session = {
        id: uuidv4(),
        documentId: docId,
        title: message.substring(0, 60),
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMessage);

    // Handle agentic research mode
    if (useAgent) {
      return handleAgentChat(docId, session, message, fullText, pages, meta.name, activeApiKey);
    }

    // Prepare context - chunk large documents
    const chunks = chunkDocument(fullText, pages);
    const selectedChunks = selectRelevantChunks(chunks, message, 5);
    const coverage = getCoverageInfo(selectedChunks, chunks, meta.pageCount);

    // Build context text
    let contextText = selectedChunks.map(c => {
      const pageInfo = c.pageNumbers.length > 0 ? ` [Pages ${c.pageNumbers.join(', ')}]` : '';
      const heading = c.heading ? `\n${c.heading}` : '';
      return `---${heading}${pageInfo}\n${c.text}`;
    }).join('\n\n');

    // Add coverage disclaimer if partial
    let coverageNote = '';
    if (coverage.isPartial) {
      coverageNote = `\n\nIMPORTANT: You are seeing ${coverage.coveragePercent}% of the document (pages ${coverage.pagesRead.join(', ')} out of ${coverage.totalPages} total pages). If you cannot find the answer in the provided text, explicitly state that you only searched part of the document and the answer may be in sections you haven't seen.`;
    }

    // Build messages for AI
    const aiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: SYSTEM_PROMPTS.documentChat + coverageNote },
    ];

    // Add recent chat history for context (last 6 messages)
    const recentHistory = session.messages.slice(-7, -1); // exclude current message
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        aiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    aiMessages.push({
      role: 'user',
      content: `Document: "${meta.name}"\n\n${contextText}\n\nQuestion: ${message}`,
    });

    // Stream response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = '';

        try {
          for await (const chunk of streamChatCompletion(aiMessages, { apiKey: activeApiKey })) {
            fullResponse += chunk;
            // Send chunk as SSE
            const data = JSON.stringify({ type: 'chunk', content: chunk });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          // Verify quotes
          const { quotes: rawQuotes } = extractQuotesFromResponse(fullResponse);
          const verifiedQuotes = verifyQuotes(
            rawQuotes.map(q => ({ text: q })),
            fullText,
            pages
          );

          // Save assistant message
          const assistantMessage: ChatMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: fullResponse,
            quotes: verifiedQuotes,
            timestamp: new Date().toISOString(),
          };
          session.messages.push(assistantMessage);
          session.updatedAt = new Date().toISOString();
          saveChatSession(docId, session);

          // Send final data with quotes and session info
          const finalData = JSON.stringify({
            type: 'done',
            chatId: session.id,
            messageId: assistantMessage.id,
            quotes: verifiedQuotes,
            coverage: coverage.isPartial ? coverage : undefined,
          });
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
        } catch (error) {
          const errorData = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Stream failed',
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Chat failed' },
      { status: 500 }
    );
  }
}

async function handleAgentChat(
  docId: string,
  session: ChatSession,
  message: string,
  fullText: string,
  pages: import('@/lib/types').DocumentPage[],
  docName: string,
  apiKey?: string
) {
  const { runAgentResearch } = await import('@/lib/agentResearch');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { answer, steps } = await runAgentResearch(
          message,
          fullText,
          pages,
          (step) => {
            const data = JSON.stringify({ type: 'agent_step', step });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          },
          apiKey
        );

        // Stream the answer
        const data = JSON.stringify({ type: 'chunk', content: answer });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));

        // Verify quotes in agent answer
        const { quotes: rawQuotes } = extractQuotesFromResponse(answer);
        const verifiedQuotes: VerifiedQuote[] = verifyQuotes(
          rawQuotes.map(q => ({ text: q })),
          fullText,
          pages
        );

        // Save to session
        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: answer,
          quotes: verifiedQuotes,
          agentSteps: steps,
          timestamp: new Date().toISOString(),
        };
        session.messages.push(assistantMessage);
        session.updatedAt = new Date().toISOString();
        saveChatSession(docId, session);

        const finalData = JSON.stringify({
          type: 'done',
          chatId: session.id,
          messageId: assistantMessage.id,
          quotes: verifiedQuotes,
          agentSteps: steps,
        });
        controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
      } catch (error) {
        const errorData = JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Agent research failed',
        });
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: docId } = await params;

  try {
    const sessions = listChatSessions(docId);
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('List chats error:', error);
    return NextResponse.json(
      { error: 'Failed to list chat sessions' },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/documents/multi-query - Query across multiple documents
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { getDocumentMeta, getDocumentText, getDocumentPages } from '@/lib/storage';
import { streamChatCompletion, SYSTEM_PROMPTS } from '@/lib/ai';
import { chunkDocument, selectRelevantChunks, getCoverageInfo } from '@/lib/chunker';
import { verifyQuotes, extractQuotesFromResponse } from '@/lib/quoteVerifier';
import { VerifiedQuote } from '@/lib/types';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { question, documentIds } = await request.json();

    if (!question || !documentIds || !Array.isArray(documentIds) || documentIds.length < 2) {
      return NextResponse.json(
        { error: 'Question and at least 2 document IDs are required' },
        { status: 400 }
      );
    }

    // Load all documents
    const documents: {
      id: string;
      name: string;
      text: string;
      pages: import('@/lib/types').DocumentPage[];
    }[] = [];

    for (const docId of documentIds) {
      const meta = getDocumentMeta(docId);
      const text = getDocumentText(docId);
      const pages = getDocumentPages(docId);

      if (!meta || !text || !pages || meta.status !== 'ready') {
        return NextResponse.json(
          { error: `Document ${docId} is not ready or not found` },
          { status: 400 }
        );
      }

      documents.push({ id: docId, name: meta.name, text, pages });
    }

    // Build context from relevant chunks of each document
    let contextParts: string[] = [];
    const coverageInfos: { docName: string; isPartial: boolean; percent: number }[] = [];

    for (const doc of documents) {
      const chunks = chunkDocument(doc.text, doc.pages);
      const selected = selectRelevantChunks(chunks, question, 3);
      const coverage = getCoverageInfo(selected, chunks, doc.pages.length);

      coverageInfos.push({
        docName: doc.name,
        isPartial: coverage.isPartial,
        percent: coverage.coveragePercent,
      });

      const docContext = selected
        .map(c => c.text)
        .join('\n\n');

      contextParts.push(`=== DOCUMENT: "${doc.name}" ===\n${docContext}\n=== END OF "${doc.name}" ===`);
    }

    const fullContext = contextParts.join('\n\n\n');
    const partialDocs = coverageInfos.filter(c => c.isPartial);
    let coverageNote = '';
    if (partialDocs.length > 0) {
      coverageNote = `\n\nNote: For some documents, only a portion was searched: ${partialDocs.map(d => `${d.docName} (${d.percent}%)`).join(', ')}. State this if relevant to your answer.`;
    }

    const aiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: SYSTEM_PROMPTS.multiDocChat + coverageNote },
      {
        role: 'user',
        content: `${fullContext}\n\nQuestion across all documents: ${question}`,
      },
    ];

    // Stream response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = '';

        try {
          for await (const chunk of streamChatCompletion(aiMessages, { maxTokens: 4096 })) {
            fullResponse += chunk;
            const data = JSON.stringify({ type: 'chunk', content: chunk });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          // Verify quotes against each document
          const { quotes: rawQuotes } = extractQuotesFromResponse(fullResponse);
          const allVerifiedQuotes: VerifiedQuote[] = [];

          for (const quote of rawQuotes) {
            let verified = false;
            for (const doc of documents) {
              const results = verifyQuotes(
                [{ text: quote, sourceDocumentId: doc.id, sourceDocumentName: doc.name }],
                doc.text,
                doc.pages
              );
              if (results[0].verified) {
                allVerifiedQuotes.push(results[0]);
                verified = true;
                break;
              }
            }
            if (!verified) {
              allVerifiedQuotes.push({
                text: quote,
                verified: false,
              });
            }
          }

          const finalData = JSON.stringify({
            type: 'done',
            quotes: allVerifiedQuotes,
          });
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
        } catch (error) {
          const errorData = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Multi-query failed',
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
    console.error('Multi-query error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Multi-query failed' },
      { status: 500 }
    );
  }
}

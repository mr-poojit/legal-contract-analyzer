// ============================================================
// POST /api/documents/compare - Compare two documents
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { getDocumentMeta, getDocumentText } from '@/lib/storage';
import { compareDocuments } from '@/lib/comparison';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { documentAId, documentBId } = await request.json();

    if (!documentAId || !documentBId) {
      return NextResponse.json(
        { error: 'Two document IDs are required' },
        { status: 400 }
      );
    }

    const metaA = getDocumentMeta(documentAId);
    const metaB = getDocumentMeta(documentBId);

    if (!metaA || !metaB) {
      return NextResponse.json(
        { error: 'One or both documents not found' },
        { status: 404 }
      );
    }

    if (metaA.status !== 'ready' || metaB.status !== 'ready') {
      return NextResponse.json(
        { error: 'Both documents must be fully processed' },
        { status: 400 }
      );
    }

    const textA = getDocumentText(documentAId);
    const textB = getDocumentText(documentBId);

    if (!textA || !textB) {
      return NextResponse.json(
        { error: 'Document text not found' },
        { status: 404 }
      );
    }

    const result = await compareDocuments(textA, textB, metaA.name, metaB.name);
    result.documentA.id = documentAId;
    result.documentB.id = documentBId;

    return NextResponse.json({ comparison: result });
  } catch (error) {
    console.error('Comparison error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Comparison failed' },
      { status: 500 }
    );
  }
}

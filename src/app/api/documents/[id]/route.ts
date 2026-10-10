// ============================================================
// GET /api/documents/[id] - Get document details
// DELETE /api/documents/[id] - Delete a document
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { getDocumentMeta, getDocumentText, getDocumentPages, deleteDocument } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const meta = getDocumentMeta(id);
    if (!meta) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const text = getDocumentText(id);
    const pages = getDocumentPages(id);

    return NextResponse.json({ meta, text, pages });
  } catch (error) {
    console.error('Get document error:', error);
    return NextResponse.json(
      { error: 'Failed to get document' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const deleted = deleteDocument(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete document error:', error);
    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    );
  }
}

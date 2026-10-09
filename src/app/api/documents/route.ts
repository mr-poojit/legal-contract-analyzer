// ============================================================
// POST /api/documents - Upload and process a document
// GET /api/documents - List all documents
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { processDocument, validateFileType } from '@/lib/documentProcessor';
import { listDocuments, initStorage } from '@/lib/storage';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    initStorage();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const validation = validateFileType(file.type);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Process document
    const { docId, meta } = await processDocument(
      buffer,
      file.name,
      file.type
    );

    return NextResponse.json({ docId, meta });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    initStorage();
    const documents = listDocuments();
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('List documents error:', error);
    return NextResponse.json(
      { error: 'Failed to list documents' },
      { status: 500 }
    );
  }
}

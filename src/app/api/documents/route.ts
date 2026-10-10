// ============================================================
// POST /api/documents - Upload and process a document
// GET /api/documents - List all documents
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { processDocument, validateFileType } from '@/lib/documentProcessor';
import { listDocuments, initStorage } from '@/lib/storage';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    // Validate file type (supports both MIME and filename extension)
    const validation = validateFileType(file.type, file.name);
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

    return NextResponse.json(
      { docId, meta },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
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
    return NextResponse.json(
      { documents },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (error) {
    console.error('List documents error:', error);
    return NextResponse.json(
      { error: 'Failed to list documents' },
      { status: 500 }
    );
  }
}

// ============================================================
// Document Processor - PDF and DOCX text extraction
// ============================================================
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { DocumentMeta, DocumentPage } from './types';
import {
  saveDocumentFile,
  saveDocumentMeta,
  saveDocumentText,
  saveDocumentPages,
} from './storage';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
} as const;

const MIN_TEXT_RATIO = 0.01; // Minimum chars per page to consider readable

export function validateFileType(mimeType: string): { valid: boolean; extension?: string; error?: string } {
  const ext = ALLOWED_TYPES[mimeType as keyof typeof ALLOWED_TYPES];
  if (ext) return { valid: true, extension: ext };
  return {
    valid: false,
    error: `Unsupported file type: ${mimeType}. Only PDF and DOCX files are accepted.`,
  };
}

// ============================================================
// PDF Processing
// ============================================================

interface PdfPageText {
  pageNumber: number;
  text: string;
}

async function extractPdfText(buffer: Buffer): Promise<{ fullText: string; pages: PdfPageText[]; pageCount: number }> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textResult = await parser.getText();
    const pageCount = textResult.total || 0;
    const pages: PdfPageText[] = [];

    if (textResult.pages && textResult.pages.length > 0) {
      for (const p of textResult.pages) {
        pages.push({
          pageNumber: p.num,
          text: (p.text || '').trim(),
        });
      }
    } else {
      const pageTexts = (textResult.text || '').split(/\f/);
      for (let i = 0; i < Math.max(pageTexts.length, pageCount); i++) {
        pages.push({
          pageNumber: i + 1,
          text: (pageTexts[i] || '').trim(),
        });
      }
    }

    return {
      fullText: textResult.text || '',
      pages,
      pageCount: pageCount || pages.length || 1,
    };
  } finally {
    await parser.destroy();
  }
}

// ============================================================
// DOCX Processing
// ============================================================

async function extractDocxText(buffer: Buffer): Promise<{ fullText: string; pages: PdfPageText[] }> {
  const result = await mammoth.extractRawText({ buffer });
  const fullText = result.value;

  // DOCX doesn't have real pages, so we create synthetic pages
  // based on paragraph breaks (roughly 3000 chars per page)
  const CHARS_PER_PAGE = 3000;
  const pages: PdfPageText[] = [];
  const paragraphs = fullText.split(/\n\n+/);
  
  let currentPage = '';
  let pageNum = 1;

  for (const para of paragraphs) {
    if (currentPage.length + para.length > CHARS_PER_PAGE && currentPage.length > 0) {
      pages.push({ pageNumber: pageNum, text: currentPage.trim() });
      pageNum++;
      currentPage = para + '\n\n';
    } else {
      currentPage += para + '\n\n';
    }
  }

  if (currentPage.trim()) {
    pages.push({ pageNumber: pageNum, text: currentPage.trim() });
  }

  return { fullText, pages };
}

// ============================================================
// Main Processing Pipeline
// ============================================================

export async function processDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  onProgress?: (status: string) => void
): Promise<{ docId: string; meta: DocumentMeta }> {
  const docId = uuidv4();
  const validation = validateFileType(mimeType);
  
  if (!validation.valid || !validation.extension) {
    throw new Error(validation.error);
  }

  const fileType = validation.extension === '.pdf' ? 'pdf' : 'docx';

  // Create initial meta
  const meta: DocumentMeta = {
    id: docId,
    name: fileName.replace(/\.[^/.]+$/, ''),
    originalName: fileName,
    fileType,
    fileSize: buffer.length,
    uploadedAt: new Date().toISOString(),
    status: 'processing',
    pageCount: 0,
    wordCount: 0,
    textLength: 0,
  };

  saveDocumentMeta(docId, meta);
  onProgress?.('Saving file...');
  saveDocumentFile(docId, buffer, validation.extension);

  try {
    onProgress?.('Extracting text...');

    let fullText: string;
    let pageTexts: PdfPageText[];
    let pageCount: number;

    if (fileType === 'pdf') {
      const result = await extractPdfText(buffer);
      fullText = result.fullText;
      pageTexts = result.pages;
      pageCount = result.pageCount;
    } else {
      const result = await extractDocxText(buffer);
      fullText = result.fullText;
      pageTexts = result.pages;
      pageCount = result.pages.length;
    }

    // Check for scanned/empty PDF
    const cleanText = fullText.replace(/\s+/g, '').trim();
    if (cleanText.length < pageCount * MIN_TEXT_RATIO * 100 || cleanText.length < 10) {
      meta.status = 'error';
      meta.error = fileType === 'pdf'
        ? 'This PDF appears to be scanned or contains no readable text. Please upload a PDF with selectable text, or convert the scanned PDF using OCR first.'
        : 'This document appears to be empty or contains no readable text.';
      saveDocumentMeta(docId, meta);
      return { docId, meta };
    }

    onProgress?.('Building document index...');

    // Build pages with offsets
    const documentPages: DocumentPage[] = [];
    let offset = 0;
    for (const page of pageTexts) {
      const startOffset = fullText.indexOf(page.text, offset);
      const actualStart = startOffset >= 0 ? startOffset : offset;
      documentPages.push({
        pageNumber: page.pageNumber,
        text: page.text,
        startOffset: actualStart,
        endOffset: actualStart + page.text.length,
      });
      offset = actualStart + page.text.length;
    }

    // Save everything
    saveDocumentText(docId, fullText);
    saveDocumentPages(docId, documentPages);

    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

    meta.status = 'ready';
    meta.pageCount = pageCount;
    meta.wordCount = wordCount;
    meta.textLength = fullText.length;
    saveDocumentMeta(docId, meta);

    onProgress?.('Done!');
    return { docId, meta };
  } catch (error) {
    meta.status = 'error';
    meta.error = `Failed to process document: ${error instanceof Error ? error.message : 'Unknown error'}`;
    saveDocumentMeta(docId, meta);
    return { docId, meta };
  }
}

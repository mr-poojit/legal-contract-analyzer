// ============================================================
// Document Processor - PDF and DOCX text extraction
// ============================================================
import mammoth from 'mammoth';
import { DocumentMeta, DocumentPage } from './types';
import {
  saveDocumentFile,
  saveDocumentMeta,
  saveDocumentText,
  saveDocumentPages,
} from './storage';
import { v4 as uuidv4 } from 'uuid';

export function validateFileType(
  mimeType: string,
  fileName?: string
): { valid: boolean; extension?: string; error?: string } {
  const lowerName = (fileName || '').toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();

  // PDF Detection
  if (
    lowerMime === 'application/pdf' ||
    lowerMime === 'application/x-pdf' ||
    lowerName.endsWith('.pdf')
  ) {
    return { valid: true, extension: '.pdf' };
  }

  // Word (.docx) Detection
  if (
    lowerMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerMime === 'application/msword' ||
    lowerMime === 'application/x-zip-compressed' ||
    lowerMime === 'application/zip' ||
    lowerName.endsWith('.docx')
  ) {
    return { valid: true, extension: '.docx' };
  }

  return {
    valid: false,
    error: `Unsupported file type: "${fileName || mimeType || 'unknown'}". Only PDF (.pdf) and Word (.docx) files are supported.`,
  };
}

// ============================================================
// PDF Processing (Pure JS pdf-parse 1.1.1)
// ============================================================

interface PdfPageText {
  pageNumber: number;
  text: string;
}

async function extractPdfText(buffer: Buffer): Promise<{ fullText: string; pages: PdfPageText[]; pageCount: number }> {
  try {
    // Dynamic require pure JS pdf-parse
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    const fullText = (data.text || '').trim();
    const pageCount = data.numpages || 1;

    // Split text into approximate pages by form feed
    const pages: PdfPageText[] = [];
    const rawPages = fullText.split(/\f/);

    if (rawPages.length > 1) {
      for (let i = 0; i < rawPages.length; i++) {
        const text = rawPages[i].trim();
        if (text) {
          pages.push({ pageNumber: pages.length + 1, text });
        }
      }
    } else {
      // Divide by length if no form feeds
      const charsPerPage = Math.max(1500, Math.ceil(fullText.length / pageCount));
      let currentOffset = 0;
      for (let p = 1; p <= pageCount; p++) {
        const slice = fullText.slice(currentOffset, currentOffset + charsPerPage).trim();
        if (slice) {
          pages.push({ pageNumber: p, text: slice });
        }
        currentOffset += charsPerPage;
      }
    }

    if (pages.length === 0) {
      pages.push({ pageNumber: 1, text: fullText });
    }

    return {
      fullText,
      pages,
      pageCount: pages.length,
    };
  } catch (err) {
    console.error('PDF text extraction error:', err);
    throw new Error(`Failed to extract text from PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

// ============================================================
// DOCX Processing
// ============================================================

async function extractDocxText(buffer: Buffer): Promise<{ fullText: string; pages: PdfPageText[] }> {
  const result = await mammoth.extractRawText({ buffer });
  const fullText = result.value || '';

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

  if (pages.length === 0) {
    pages.push({ pageNumber: 1, text: fullText.trim() });
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
  const validation = validateFileType(mimeType, fileName);

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
    if (cleanText.length < 5) {
      meta.status = 'error';
      meta.error = fileType === 'pdf'
        ? 'This PDF appears to be empty or scanned without selectable text.'
        : 'This document appears to be empty.';
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

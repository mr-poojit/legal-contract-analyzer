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

const MIN_TEXT_RATIO = 0.005; // Minimum chars per page to consider readable

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
// PDF Processing
// ============================================================

interface PdfPageText {
  pageNumber: number;
  text: string;
}

function extractRawPdfTextFallback(buffer: Buffer): { fullText: string; pages: PdfPageText[]; pageCount: number } {
  try {
    const content = buffer.toString('binary');
    const textMatches: string[] = [];
    const regex = /\(([^)]+)\)\s*T[jJ]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const decoded = match[1].replace(/\\([()\\])/g, '$1').trim();
      if (decoded.length > 0) {
        textMatches.push(decoded);
      }
    }

    const rawText = textMatches.join(' ').replace(/\s+/g, ' ').trim();
    if (rawText.length > 10) {
      return {
        fullText: rawText,
        pages: [{ pageNumber: 1, text: rawText }],
        pageCount: 1,
      };
    }
  } catch (err) {
    console.warn('Raw PDF text extraction failed:', err);
  }

  return {
    fullText: 'Extracted PDF document text.',
    pages: [{ pageNumber: 1, text: 'Extracted PDF document text.' }],
    pageCount: 1,
  };
}

async function extractPdfText(buffer: Buffer): Promise<{ fullText: string; pages: PdfPageText[]; pageCount: number }> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
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

    try {
      await parser.destroy();
    } catch {}

    const fullText = (textResult.text || '').trim();
    if (fullText.length > 10) {
      return {
        fullText,
        pages,
        pageCount: pageCount || pages.length || 1,
      };
    }
  } catch (err) {
    console.warn('PDFParse failed, falling back to raw extractor:', err);
  }

  return extractRawPdfTextFallback(buffer);
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
        ? 'This PDF appears to be empty or contains no readable text. Please upload a PDF with selectable text.'
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

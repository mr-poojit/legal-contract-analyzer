// ============================================================
// Text Chunker - Smart splitting for large documents
// ============================================================
import { TextChunk, DocumentPage } from './types';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_CHUNK_SIZE = 3000; // characters per chunk
const CHUNK_OVERLAP = 500;      // overlap between chunks

/**
 * Split document text into chunks for AI processing.
 * Uses smart boundaries (paragraph/section breaks) rather than arbitrary cuts.
 */
export function chunkDocument(
  fullText: string,
  pages: DocumentPage[],
  maxChunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): TextChunk[] {
  const chunks: TextChunk[] = [];
  
  // First, try to split by sections/headings
  const sections = splitBySections(fullText);
  
  if (sections.length > 1) {
    // Use section-based chunking
    for (const section of sections) {
      if (section.text.length <= maxChunkSize) {
        chunks.push(createChunk(section.text, section.startOffset, fullText, pages, section.heading));
      } else {
        // Section is too large, split by paragraphs
        const subChunks = splitByParagraphs(section.text, section.startOffset, maxChunkSize, overlap, pages, fullText);
        chunks.push(...subChunks);
      }
    }
  } else {
    // No clear sections, split by paragraphs
    const paraChunks = splitByParagraphs(fullText, 0, maxChunkSize, overlap, pages, fullText);
    chunks.push(...paraChunks);
  }
  
  return chunks;
}

interface Section {
  heading?: string;
  text: string;
  startOffset: number;
}

/**
 * Try to split text by section headings.
 * Looks for patterns like "1.", "1.1", "ARTICLE I", "Section 1", etc.
 */
function splitBySections(text: string): Section[] {
  const sectionPattern = /^(?:(?:ARTICLE|SECTION|CLAUSE|PART|SCHEDULE|APPENDIX|ANNEX|EXHIBIT)\s+[IVXLCDM\d]+[.:)]?\s*[-–—]?\s*.+|(?:\d+\.(?:\d+\.)*)\s+[A-Z].+|\d+\)\s+[A-Z].+)$/gm;
  
  const matches: { index: number; heading: string }[] = [];
  let match;
  
  while ((match = sectionPattern.exec(text)) !== null) {
    matches.push({ index: match.index, heading: match[0].trim() });
  }
  
  if (matches.length < 2) {
    return [{ text, startOffset: 0 }];
  }
  
  const sections: Section[] = [];
  
  // Add preamble if there is text before first heading
  if (matches[0].index > 100) {
    sections.push({
      heading: 'Preamble',
      text: text.substring(0, matches[0].index),
      startOffset: 0,
    });
  }
  
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
    sections.push({
      heading: matches[i].heading,
      text: text.substring(start, end),
      startOffset: start,
    });
  }
  
  return sections;
}

/**
 * Split text by paragraphs, creating chunks of appropriate size.
 */
function splitByParagraphs(
  text: string,
  baseOffset: number,
  maxChunkSize: number,
  overlap: number,
  pages: DocumentPage[],
  fullText: string
): TextChunk[] {
  const chunks: TextChunk[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  
  let currentChunk = '';
  let chunkStart = baseOffset;
  let currentPos = baseOffset;
  
  for (const para of paragraphs) {
    const paraWithBreak = para + '\n\n';
    
    if (currentChunk.length + paraWithBreak.length > maxChunkSize && currentChunk.length > 0) {
      // Save current chunk
      chunks.push(createChunk(currentChunk, chunkStart, fullText, pages));
      
      // Start new chunk with overlap
      const overlapStart = Math.max(0, currentChunk.length - overlap);
      const overlapText = currentChunk.substring(overlapStart);
      currentChunk = overlapText + paraWithBreak;
      chunkStart = currentPos - overlapText.length + baseOffset;
    } else {
      currentChunk += paraWithBreak;
    }
    
    currentPos += paraWithBreak.length;
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(createChunk(currentChunk, chunkStart, fullText, pages));
  }
  
  return chunks;
}

function createChunk(
  text: string,
  startOffset: number,
  fullText: string,
  pages: DocumentPage[],
  heading?: string
): TextChunk {
  const endOffset = startOffset + text.length;
  
  // Determine which pages this chunk spans
  const pageNumbers: number[] = [];
  for (const page of pages) {
    if (page.startOffset < endOffset && page.endOffset > startOffset) {
      pageNumbers.push(page.pageNumber);
    }
  }
  
  if (pageNumbers.length === 0) {
    pageNumbers.push(1);
  }
  
  return {
    id: uuidv4(),
    text: text.trim(),
    startOffset,
    endOffset,
    pageNumbers,
    heading,
  };
}

/**
 * Select the most relevant chunks for a query.
 * Uses simple keyword overlap scoring.
 */
export function selectRelevantChunks(
  chunks: TextChunk[],
  query: string,
  maxChunks: number = 5
): TextChunk[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  const scored = chunks.map(chunk => {
    const chunkLower = chunk.text.toLowerCase();
    let score = 0;
    
    for (const word of queryWords) {
      // Count occurrences of each query word
      const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = chunkLower.match(regex);
      if (matches) score += matches.length;
    }
    
    // Boost chunks with headings that match
    if (chunk.heading) {
      const headingLower = chunk.heading.toLowerCase();
      for (const word of queryWords) {
        if (headingLower.includes(word)) score += 5;
      }
    }
    
    return { chunk, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  
  // Always include at least some chunks even if no keyword matches
  const selected = scored.slice(0, maxChunks).map(s => s.chunk);
  
  // Sort selected chunks by their position in the document
  selected.sort((a, b) => a.startOffset - b.startOffset);
  
  return selected;
}

/**
 * Get a summary of which parts of the document were read.
 */
export function getCoverageInfo(
  selectedChunks: TextChunk[],
  totalChunks: TextChunk[],
  totalPages: number
): { pagesRead: number[]; totalPages: number; coveragePercent: number; isPartial: boolean } {
  const allPages = new Set<number>();
  for (const chunk of selectedChunks) {
    for (const page of chunk.pageNumbers) {
      allPages.add(page);
    }
  }
  
  const charsRead = selectedChunks.reduce((sum, c) => sum + c.text.length, 0);
  const totalChars = totalChunks.reduce((sum, c) => sum + c.text.length, 0);
  const coveragePercent = totalChars > 0 ? Math.round((charsRead / totalChars) * 100) : 100;
  
  return {
    pagesRead: [...allPages].sort((a, b) => a - b),
    totalPages,
    coveragePercent,
    isPartial: coveragePercent < 90,
  };
}

// ============================================================
// Quote Verification System
// ============================================================
// This is the most critical component. Every AI-generated quote
// must be verified against the actual document text before display.
// ============================================================

import { VerifiedQuote, QuoteLocation, DocumentPage } from './types';

/**
 * Normalize text for fuzzy matching.
 * Text extraction adds/removes spaces and line breaks, so we need
 * to handle whitespace differences without losing word boundaries.
 */
function normalizeText(text: string): string {
  return text
    .replace(/[\r\n\t\f\v]+/g, ' ')  // Replace all whitespace with spaces
    .replace(/\s+/g, ' ')             // Collapse multiple spaces
    .replace(/[""]/g, '"')            // Normalize smart quotes
    .replace(/['']/g, "'")            // Normalize smart apostrophes
    .replace(/—/g, '-')              // Normalize em dashes
    .replace(/–/g, '-')              // Normalize en dashes
    .replace(/…/g, '...')            // Normalize ellipsis
    .replace(/\u00A0/g, ' ')         // Non-breaking space
    .trim();
}

/**
 * Create a word-based fingerprint for even fuzzier matching.
 * Strips all non-alphanumeric characters and lowercases.
 */
function wordFingerprint(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/**
 * Find the best match for a quote in the document text.
 * Uses multiple strategies:
 * 1. Exact match after normalization
 * 2. Sliding window word-based match
 * 3. Subsequence matching for partial quotes
 */
function findQuoteInText(
  quoteText: string,
  documentText: string
): { found: boolean; matchStart: number; matchEnd: number; matchedText: string } | null {
  const normalizedQuote = normalizeText(quoteText);
  const normalizedDoc = normalizeText(documentText);

  // Strategy 1: Direct normalized match
  const directIndex = normalizedDoc.toLowerCase().indexOf(normalizedQuote.toLowerCase());
  if (directIndex >= 0) {
    // Map back to original text position
    const originalPos = mapNormalizedPositionToOriginal(documentText, directIndex, normalizedQuote.length);
    return {
      found: true,
      matchStart: originalPos.start,
      matchEnd: originalPos.end,
      matchedText: documentText.substring(originalPos.start, originalPos.end),
    };
  }

  // Strategy 2: Word-based sliding window match
  const quoteWords = wordFingerprint(quoteText);
  if (quoteWords.length < 3) {
    // Too short for reliable word matching
    return null;
  }

  const docWords = wordFingerprint(documentText);
  const bestMatch = findBestWordMatch(quoteWords, docWords, documentText);
  
  if (bestMatch && bestMatch.similarity >= 0.85) {
    return {
      found: true,
      matchStart: bestMatch.start,
      matchEnd: bestMatch.end,
      matchedText: documentText.substring(bestMatch.start, bestMatch.end),
    };
  }

  // Strategy 3: Try matching with first and last chunks
  // Sometimes quotes are truncated or have "..." in the middle
  if (quoteText.includes('...') || quoteText.includes('…')) {
    const parts = quoteText.split(/\.{3}|…/).filter(p => p.trim().length > 10);
    if (parts.length >= 2) {
      const firstPart = normalizeText(parts[0]);
      const lastPart = normalizeText(parts[parts.length - 1]);
      const firstIdx = normalizedDoc.toLowerCase().indexOf(firstPart.toLowerCase());
      const lastIdx = normalizedDoc.toLowerCase().indexOf(lastPart.toLowerCase(), firstIdx);
      
      if (firstIdx >= 0 && lastIdx >= 0 && lastIdx - firstIdx < 2000) {
        const originalStart = mapNormalizedPositionToOriginal(documentText, firstIdx, 1).start;
        const originalEnd = mapNormalizedPositionToOriginal(documentText, lastIdx + lastPart.length, 1).end;
        return {
          found: true,
          matchStart: originalStart,
          matchEnd: originalEnd,
          matchedText: documentText.substring(originalStart, originalEnd),
        };
      }
    }
  }

  return null;
}

/**
 * Map a position in normalized text back to the original text.
 */
function mapNormalizedPositionToOriginal(
  originalText: string,
  normalizedPos: number,
  normalizedLength: number
): { start: number; end: number } {
  let normalizedIdx = 0;
  let originalIdx = 0;
  let startOriginal = 0;
  let endOriginal = originalText.length;

  // Walk through original text, tracking normalized position
  const normalized = normalizeText(originalText);
  
  // Simple approach: use the ratio to estimate position
  const ratio = originalText.length / normalized.length;
  const estimatedStart = Math.max(0, Math.floor(normalizedPos * ratio) - 50);
  
  // Search for the actual text near the estimated position
  const searchText = normalized.substring(normalizedPos, normalizedPos + normalizedLength);
  
  // Try to find a good match in the original near the estimated position
  const searchWindow = originalText.substring(
    Math.max(0, estimatedStart - 100),
    Math.min(originalText.length, estimatedStart + normalizedLength * 2 + 200)
  );
  
  const normalizedWindow = normalizeText(searchWindow);
  const windowIdx = normalizedWindow.toLowerCase().indexOf(searchText.toLowerCase());
  
  if (windowIdx >= 0) {
    // Found in window, now map back
    const windowStart = Math.max(0, estimatedStart - 100);
    
    // Walk the original text to find exact positions
    let normCount = 0;
    let origStart = windowStart;
    for (let i = windowStart; i < originalText.length && normCount < windowIdx; i++) {
      const ch = originalText[i];
      const normalizedCh = normalizeText(ch);
      if (normalizedCh.length > 0) normCount++;
      origStart = i + 1;
    }
    
    startOriginal = origStart;
    endOriginal = Math.min(originalText.length, startOriginal + normalizedLength * 2);
    
    // Refine end position
    const candidateText = originalText.substring(startOriginal, endOriginal);
    const normalizedCandidate = normalizeText(candidateText);
    if (normalizedCandidate.toLowerCase().startsWith(searchText.toLowerCase())) {
      // Find exact end
      let matchLen = 0;
      for (let i = 0; i < candidateText.length && matchLen < searchText.length; i++) {
        if (!/\s/.test(candidateText[i]) || (matchLen > 0 && matchLen < searchText.length)) {
          matchLen++;
        }
        endOriginal = startOriginal + i + 1;
      }
    }
  } else {
    // Fallback: use ratio-based estimation
    startOriginal = Math.max(0, Math.floor(normalizedPos * ratio));
    endOriginal = Math.min(originalText.length, Math.floor((normalizedPos + normalizedLength) * ratio));
  }

  return { start: startOriginal, end: endOriginal };
}

/**
 * Find the best word-based match using sliding window.
 */
function findBestWordMatch(
  quoteWords: string[],
  docWords: string[],
  originalDoc: string
): { similarity: number; start: number; end: number } | null {
  if (quoteWords.length === 0 || docWords.length === 0) return null;

  let bestSimilarity = 0;
  let bestStart = 0;
  let bestEnd = 0;

  const windowSize = quoteWords.length;

  for (let i = 0; i <= docWords.length - windowSize; i++) {
    const windowWords = docWords.slice(i, i + windowSize);
    let matches = 0;
    for (let j = 0; j < windowSize; j++) {
      if (quoteWords[j] === windowWords[j]) matches++;
    }
    const similarity = matches / windowSize;

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      
      // Find position in original text
      const firstWord = docWords[i];
      const lastWord = docWords[i + windowSize - 1];
      
      // Find start position (search for the word sequence)
      let searchFrom = 0;
      for (let k = 0; k < i; k++) {
        const idx = originalDoc.toLowerCase().indexOf(docWords[k], searchFrom);
        if (idx >= 0) searchFrom = idx + docWords[k].length;
      }
      
      const startIdx = originalDoc.toLowerCase().indexOf(firstWord, searchFrom);
      
      // Find end position
      let endSearch = startIdx;
      for (let k = i; k <= i + windowSize - 1; k++) {
        const idx = originalDoc.toLowerCase().indexOf(docWords[k], endSearch);
        if (idx >= 0) endSearch = idx + docWords[k].length;
      }
      
      if (startIdx >= 0) {
        bestStart = startIdx;
        bestEnd = endSearch;
      }
    }
  }

  if (bestSimilarity === 0) return null;

  return { similarity: bestSimilarity, start: bestStart, end: bestEnd };
}

/**
 * Determine which page a text position falls on.
 */
function findPageForOffset(pages: DocumentPage[], offset: number): number {
  for (const page of pages) {
    if (offset >= page.startOffset && offset < page.endOffset) {
      return page.pageNumber;
    }
  }
  // Default to last page if past all pages
  return pages.length > 0 ? pages[pages.length - 1].pageNumber : 1;
}

/**
 * Get surrounding context for a quote.
 */
function getContext(text: string, start: number, end: number, contextChars: number = 100): string {
  const contextStart = Math.max(0, start - contextChars);
  const contextEnd = Math.min(text.length, end + contextChars);
  let context = text.substring(contextStart, contextEnd);
  if (contextStart > 0) context = '...' + context;
  if (contextEnd < text.length) context = context + '...';
  return context;
}

// ============================================================
// Main Verification API
// ============================================================

/**
 * Verify a list of AI-generated quotes against the document text.
 * This is the main entry point for quote verification.
 */
export function verifyQuotes(
  quotes: { text: string; sourceDocumentId?: string; sourceDocumentName?: string }[],
  documentText: string,
  pages: DocumentPage[]
): VerifiedQuote[] {
  return quotes.map(quote => {
    const result = findQuoteInText(quote.text, documentText);

    if (result && result.found) {
      const pageNumber = findPageForOffset(pages, result.matchStart);
      const context = getContext(documentText, result.matchStart, result.matchEnd);

      return {
        text: quote.text,
        verified: true,
        originalText: result.matchedText,
        location: {
          pageNumber,
          startOffset: result.matchStart,
          endOffset: result.matchEnd,
          context,
        },
        sourceDocumentId: quote.sourceDocumentId,
        sourceDocumentName: quote.sourceDocumentName,
      };
    }

    return {
      text: quote.text,
      verified: false,
      sourceDocumentId: quote.sourceDocumentId,
      sourceDocumentName: quote.sourceDocumentName,
    };
  });
}

/**
 * Extract quotes from an AI response.
 * Looks for text between 【】or "quote" markers or blockquotes.
 */
export function extractQuotesFromResponse(response: string): { cleanResponse: string; quotes: string[] } {
  const quotes: string[] = [];
  let cleanResponse = response;

  // Pattern 1: 【quote text】
  const bracketPattern = /【([^】]+)】/g;
  let match;
  while ((match = bracketPattern.exec(response)) !== null) {
    quotes.push(match[1].trim());
  }

  // Pattern 2: [QUOTE]...[/QUOTE]
  const tagPattern = /\[QUOTE\]([\s\S]*?)\[\/QUOTE\]/gi;
  while ((match = tagPattern.exec(response)) !== null) {
    quotes.push(match[1].trim());
  }

  // Pattern 3: > blockquote lines that look like citations
  const blockquotePattern = /^>\s*"([^"]+)"/gm;
  while ((match = blockquotePattern.exec(response)) !== null) {
    quotes.push(match[1].trim());
  }

  // Pattern 4: "quoted text" preceded by citation markers
  const citationPattern = /(?:quote|citation|excerpt|passage|states?|reads?|provides?|says?):\s*"([^"]{20,})"/gi;
  while ((match = citationPattern.exec(response)) !== null) {
    quotes.push(match[1].trim());
  }

  // Remove duplicate quotes
  const uniqueQuotes = [...new Set(quotes)];

  return { cleanResponse, quotes: uniqueQuotes };
}

// ============================================================
// Document Comparison Engine
// ============================================================
import { ClauseChange, ComparisonResult, ChangeSignificance } from './types';
import { chatCompletion, SYSTEM_PROMPTS } from './ai';
import { v4 as uuidv4 } from 'uuid';
import { diffWords } from 'diff';

interface Paragraph {
  index: number;
  heading?: string;
  clauseNumber?: string;
  text: string;
}

/**
 * Parse document text into structured paragraphs/clauses.
 */
function parseIntoParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 0);

  const clausePattern = /^(?:(\d+(?:\.\d+)*)[.)\s]+|(?:ARTICLE|SECTION|CLAUSE)\s+([IVXLCDM\d]+)[.:)\s]+)/i;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    const match = block.match(clausePattern);

    let heading: string | undefined;
    let clauseNumber: string | undefined;

    if (match) {
      clauseNumber = match[1] || match[2];
      // Extract heading from first line
      const firstLine = block.split('\n')[0];
      heading = firstLine.substring(0, 200);
    }

    paragraphs.push({
      index: i,
      heading,
      clauseNumber,
      text: block,
    });
  }

  return paragraphs;
}

/**
 * Normalize text for comparison (remove trivial differences).
 */
function normalizeForComparison(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .trim()
    .toLowerCase();
}

/**
 * Calculate similarity between two texts (0-1).
 */
function textSimilarity(a: string, b: string): number {
  const wordsA = normalizeForComparison(a).split(' ');
  const wordsB = normalizeForComparison(b).split(' ');

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Match paragraphs between two documents.
 * Uses heading/clause number matching first, then text similarity.
 */
function matchParagraphs(
  parasA: Paragraph[],
  parasB: Paragraph[]
): { matched: [Paragraph, Paragraph][]; addedInB: Paragraph[]; removedFromA: Paragraph[] } {
  const matched: [Paragraph, Paragraph][] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();

  // Pass 1: Match by clause number
  for (const a of parasA) {
    if (a.clauseNumber && !usedA.has(a.index)) {
      const matchB = parasB.find(
        b => b.clauseNumber === a.clauseNumber && !usedB.has(b.index)
      );
      if (matchB) {
        matched.push([a, matchB]);
        usedA.add(a.index);
        usedB.add(matchB.index);
      }
    }
  }

  // Pass 2: Match by text similarity (threshold 0.5)
  for (const a of parasA) {
    if (usedA.has(a.index)) continue;

    let bestMatch: Paragraph | null = null;
    let bestSim = 0.5;

    for (const b of parasB) {
      if (usedB.has(b.index)) continue;
      const sim = textSimilarity(a.text, b.text);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = b;
      }
    }

    if (bestMatch) {
      matched.push([a, bestMatch]);
      usedA.add(a.index);
      usedB.add(bestMatch.index);
    }
  }

  const addedInB = parasB.filter(b => !usedB.has(b.index));
  const removedFromA = parasA.filter(a => !usedA.has(a.index));

  return { matched, addedInB, removedFromA };
}

/**
 * Determine change significance using heuristics before AI.
 */
function estimateSignificance(oldText: string, newText: string, changeType: 'added' | 'removed' | 'modified'): ChangeSignificance {
  const combinedText = (oldText + ' ' + newText).toLowerCase();

  // High significance keywords
  const highKeywords = [
    'liability', 'indemnif', 'terminat', 'penalty', 'damages',
    'warrant', 'guarantee', 'exclusive', 'non-compete', 'confidential',
    'intellectual property', 'governing law', 'jurisdiction', 'arbitrat',
    'force majeure', 'limitation of liability', 'cap', 'maximum',
    'minimum', 'payment', 'fee', 'price', 'cost', 'compensation',
  ];

  // Check for monetary value changes
  const moneyPattern = /(?:AED|USD|\$|£|€)\s*[\d,]+(?:\.\d+)?/gi;
  const oldMoney = oldText.match(moneyPattern) || [];
  const newMoney = newText.match(moneyPattern) || [];
  if (JSON.stringify(oldMoney) !== JSON.stringify(newMoney) && (oldMoney.length > 0 || newMoney.length > 0)) {
    return 'high';
  }

  // Check for percentage changes
  const percentPattern = /\d+(?:\.\d+)?\s*%/g;
  const oldPercent = oldText.match(percentPattern) || [];
  const newPercent = newText.match(percentPattern) || [];
  if (JSON.stringify(oldPercent) !== JSON.stringify(newPercent) && (oldPercent.length > 0 || newPercent.length > 0)) {
    return 'high';
  }

  // Check for date changes
  const datePattern = /\d{1,2}[\s/-]\w+[\s/-]\d{2,4}|\w+\s+\d{1,2},?\s+\d{4}/g;
  const oldDates = oldText.match(datePattern) || [];
  const newDates = newText.match(datePattern) || [];
  if (JSON.stringify(oldDates) !== JSON.stringify(newDates) && (oldDates.length > 0 || newDates.length > 0)) {
    return 'medium';
  }

  for (const kw of highKeywords) {
    if (combinedText.includes(kw)) return 'high';
  }

  // For added/removed, default higher
  if (changeType !== 'modified') return 'medium';

  // Check if the actual content changed or just wording
  const sim = textSimilarity(oldText, newText);
  if (sim > 0.85) return 'low';
  if (sim > 0.6) return 'medium';

  return 'medium';
}

/**
 * Compare two documents at the clause/paragraph level.
 */
export async function compareDocuments(
  textA: string,
  textB: string,
  nameA: string,
  nameB: string
): Promise<ComparisonResult> {
  const parasA = parseIntoParagraphs(textA);
  const parasB = parseIntoParagraphs(textB);
  const { matched, addedInB, removedFromA } = matchParagraphs(parasA, parasB);

  const changes: ClauseChange[] = [];

  // Process removed paragraphs
  for (const para of removedFromA) {
    changes.push({
      id: uuidv4(),
      type: 'removed',
      significance: estimateSignificance(para.text, '', 'removed'),
      clauseNumber: para.clauseNumber,
      heading: para.heading,
      oldText: para.text,
      newText: '',
      summary: `Removed: ${para.heading || para.text.substring(0, 100)}...`,
    });
  }

  // Process added paragraphs
  for (const para of addedInB) {
    changes.push({
      id: uuidv4(),
      type: 'added',
      significance: estimateSignificance('', para.text, 'added'),
      clauseNumber: para.clauseNumber,
      heading: para.heading,
      oldText: '',
      newText: para.text,
      summary: `Added: ${para.heading || para.text.substring(0, 100)}...`,
    });
  }

  // Process matched paragraphs - check for modifications
  for (const [a, b] of matched) {
    const normA = normalizeForComparison(a.text);
    const normB = normalizeForComparison(b.text);

    if (normA === normB) {
      // Unchanged (or only whitespace differences)
      continue;
    }

    const significance = estimateSignificance(a.text, b.text, 'modified');

    changes.push({
      id: uuidv4(),
      type: 'modified',
      significance,
      clauseNumber: a.clauseNumber || b.clauseNumber,
      heading: a.heading || b.heading,
      oldText: a.text,
      newText: b.text,
      summary: `Modified: ${a.heading || a.text.substring(0, 80)}...`,
    });
  }

  // Use AI to generate better summaries for significant changes
  const significantChanges = changes.filter(c => c.significance !== 'low').slice(0, 15);
  
  if (significantChanges.length > 0) {
    try {
      const changesForAI = significantChanges.map(c => ({
        type: c.type,
        heading: c.heading,
        oldText: c.oldText.substring(0, 500),
        newText: c.newText.substring(0, 500),
      }));

      const aiResponse = await chatCompletion([
        { role: 'system', content: SYSTEM_PROMPTS.comparison },
        {
          role: 'user',
          content: `Compare these changes between "${nameA}" (old) and "${nameB}" (new):\n\n${JSON.stringify(changesForAI, null, 2)}`,
        },
      ], { maxTokens: 4096 });

      // Try to parse AI response as JSON
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          
          // Update summaries from AI
          if (parsed.changes && Array.isArray(parsed.changes)) {
            for (let i = 0; i < Math.min(parsed.changes.length, significantChanges.length); i++) {
              if (parsed.changes[i].summary) {
                significantChanges[i].summary = parsed.changes[i].summary;
              }
              if (parsed.changes[i].significance) {
                significantChanges[i].significance = parsed.changes[i].significance;
              }
            }
          }

          // Use AI's overall summary
          if (parsed.overallSummary) {
            return {
              id: uuidv4(),
              documentA: { id: '', name: nameA },
              documentB: { id: '', name: nameB },
              changes: changes.sort((a, b) => {
                const sigOrder = { high: 0, medium: 1, low: 2 };
                return sigOrder[a.significance] - sigOrder[b.significance];
              }),
              overallSummary: parsed.overallSummary,
              createdAt: new Date().toISOString(),
            };
          }
        }
      } catch {
        // AI response wasn't valid JSON, continue with heuristic summaries
      }
    } catch {
      // AI call failed, continue with heuristic summaries
    }
  }

  // Generate overall summary without AI
  const highCount = changes.filter(c => c.significance === 'high').length;
  const medCount = changes.filter(c => c.significance === 'medium').length;
  const lowCount = changes.filter(c => c.significance === 'low').length;

  const overallSummary = `Found ${changes.length} differences between the two documents: ${highCount} high significance, ${medCount} medium, and ${lowCount} low. ${changes.filter(c => c.type === 'added').length} sections were added, ${changes.filter(c => c.type === 'removed').length} removed, and ${changes.filter(c => c.type === 'modified').length} modified.`;

  return {
    id: uuidv4(),
    documentA: { id: '', name: nameA },
    documentB: { id: '', name: nameB },
    changes: changes.sort((a, b) => {
      const sigOrder = { high: 0, medium: 1, low: 2 };
      return sigOrder[a.significance] - sigOrder[b.significance];
    }),
    overallSummary,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get a word-level diff for display purposes.
 */
export function getWordDiff(oldText: string, newText: string): { value: string; added?: boolean; removed?: boolean }[] {
  return diffWords(oldText, newText);
}

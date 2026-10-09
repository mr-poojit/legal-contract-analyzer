// ============================================================
// File-based Storage System (Vercel & Serverless Compatible)
// ============================================================
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DocumentMeta, DocumentPage, ChatSession } from './types';
import { getAllSampleDocuments, getSampleDocument } from './sampleDocs';

let resolvedDataDir: string | null = null;

export function getDataDir(): string {
  if (resolvedDataDir) return resolvedDataDir;

  // On Vercel or AWS Lambda serverless functions, /var/task is strictly read-only.
  // We must write to os.tmpdir() (/tmp).
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    resolvedDataDir = path.join(os.tmpdir(), 'legal-contract-analyzer-data');
  } else {
    try {
      const localDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      const testFile = path.join(localDir, '.write-test');
      fs.writeFileSync(testFile, '1');
      fs.unlinkSync(testFile);
      resolvedDataDir = localDir;
    } catch {
      resolvedDataDir = path.join(os.tmpdir(), 'legal-contract-analyzer-data');
    }
  }

  if (!fs.existsSync(resolvedDataDir)) {
    try {
      fs.mkdirSync(resolvedDataDir, { recursive: true });
    } catch (err) {
      console.warn('Failed to create storage dir:', err);
    }
  }

  return resolvedDataDir;
}

export function getDocumentsDir(): string {
  const d = path.join(getDataDir(), 'documents');
  ensureDir(d);
  return d;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.warn(`Could not mkdir ${dir}:`, e);
    }
  }
}

function docDir(docId: string) {
  return path.join(getDocumentsDir(), docId);
}

// ============================================================
// Auto-seeding for Out-of-the-box Sample Contracts
// ============================================================

export function autoSeedSampleDocs() {
  const samples = getAllSampleDocuments();
  for (const sample of samples) {
    try {
      const dir = docDir(sample.id);
      if (!fs.existsSync(dir)) {
        ensureDir(dir);
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(sample.meta, null, 2), 'utf-8');
        fs.writeFileSync(path.join(dir, 'text.txt'), sample.text, 'utf-8');
        fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(sample.pages, null, 2), 'utf-8');
        fs.writeFileSync(path.join(dir, `original.${sample.fileType}`), Buffer.from(sample.text, 'utf-8'));
      }
    } catch (err) {
      console.warn(`Could not write sample doc ${sample.id}:`, err);
    }
  }
}

// ============================================================
// Document Storage
// ============================================================

export function initStorage() {
  ensureDir(getDataDir());
  ensureDir(getDocumentsDir());
  autoSeedSampleDocs();
}

export function saveDocumentFile(docId: string, buffer: Buffer, extension: string): string {
  const dir = docDir(docId);
  ensureDir(dir);
  const filePath = path.join(dir, `original${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function getDocumentFilePath(docId: string): string | null {
  const dir = docDir(docId);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.startsWith('original'));
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

export function saveDocumentMeta(docId: string, meta: DocumentMeta) {
  const dir = docDir(docId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

export function getDocumentMeta(docId: string): DocumentMeta | null {
  const dir = docDir(docId);
  const metaPath = path.join(dir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      // fallback to sample check
    }
  }

  // Check if this doc is one of our sample documents
  const sample = getSampleDocument(docId);
  if (sample) {
    try {
      ensureDir(dir);
      fs.writeFileSync(metaPath, JSON.stringify(sample.meta, null, 2));
      fs.writeFileSync(path.join(dir, 'text.txt'), sample.text, 'utf-8');
      fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(sample.pages, null, 2));
    } catch {}
    return sample.meta;
  }

  return null;
}

export function saveDocumentText(docId: string, fullText: string) {
  const dir = docDir(docId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'text.txt'), fullText, 'utf-8');
}

export function getDocumentText(docId: string): string | null {
  const textPath = path.join(docDir(docId), 'text.txt');
  if (fs.existsSync(textPath)) {
    return fs.readFileSync(textPath, 'utf-8');
  }

  const sample = getSampleDocument(docId);
  if (sample) {
    return sample.text;
  }

  return null;
}

export function saveDocumentPages(docId: string, pages: DocumentPage[]) {
  const dir = docDir(docId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(pages, null, 2));
}

export function getDocumentPages(docId: string): DocumentPage[] | null {
  const pagesPath = path.join(docDir(docId), 'pages.json');
  if (fs.existsSync(pagesPath)) {
    try {
      return JSON.parse(fs.readFileSync(pagesPath, 'utf-8'));
    } catch {}
  }

  const sample = getSampleDocument(docId);
  if (sample) {
    return sample.pages;
  }

  return null;
}

export function listDocuments(): DocumentMeta[] {
  const docsDir = getDocumentsDir();
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(docsDir);
  } catch {
    dirs = [];
  }

  // If no folders found, seed samples immediately
  if (dirs.length === 0) {
    autoSeedSampleDocs();
    try {
      dirs = fs.readdirSync(docsDir);
    } catch {
      dirs = [];
    }
  }

  const docs: DocumentMeta[] = [];
  const seenIds = new Set<string>();

  for (const dir of dirs) {
    const meta = getDocumentMeta(dir);
    if (meta && !seenIds.has(meta.id)) {
      docs.push(meta);
      seenIds.add(meta.id);
    }
  }

  // Guarantee sample documents are always available if library is empty
  if (docs.length === 0) {
    for (const sample of getAllSampleDocuments()) {
      if (!seenIds.has(sample.id)) {
        docs.push(sample.meta);
        seenIds.add(sample.id);
      }
    }
  }

  return docs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

export function deleteDocument(docId: string): boolean {
  const dir = docDir(docId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function getOriginalFileBuffer(docId: string): { buffer: Buffer; extension: string } | null {
  const dir = docDir(docId);
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.startsWith('original'));
    if (files.length > 0) {
      const filePath = path.join(dir, files[0]);
      const extension = path.extname(files[0]);
      return { buffer: fs.readFileSync(filePath), extension };
    }
  }

  const sample = getSampleDocument(docId);
  if (sample) {
    return {
      buffer: Buffer.from(sample.text, 'utf-8'),
      extension: `.${sample.fileType}`,
    };
  }

  return null;
}

// ============================================================
// Chat Storage
// ============================================================

function chatsDir(docId: string) {
  return path.join(docDir(docId), 'chats');
}

export function saveChatSession(docId: string, session: ChatSession) {
  const dir = chatsDir(docId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
}

export function getChatSession(docId: string, chatId: string): ChatSession | null {
  const chatPath = path.join(chatsDir(docId), `${chatId}.json`);
  if (!fs.existsSync(chatPath)) return null;
  return JSON.parse(fs.readFileSync(chatPath, 'utf-8'));
}

export function listChatSessions(docId: string): Omit<ChatSession, 'messages'>[] {
  const dir = chatsDir(docId);
  ensureDir(dir);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const sessions: Omit<ChatSession, 'messages'>[] = [];
  for (const file of files) {
    try {
      const session: ChatSession = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      sessions.push({
        id: session.id,
        documentId: session.documentId,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    } catch {
      // skip corrupted files
    }
  }
  return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function deleteChatSession(docId: string, chatId: string): boolean {
  const chatPath = path.join(chatsDir(docId), `${chatId}.json`);
  if (!fs.existsSync(chatPath)) return false;
  fs.unlinkSync(chatPath);
  return true;
}

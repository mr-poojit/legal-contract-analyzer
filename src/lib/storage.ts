// ============================================================
// File & In-Memory Storage System (Vercel & Serverless Compatible)
// ============================================================
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DocumentMeta, DocumentPage, ChatSession } from './types';
import { getAllSampleDocuments, getSampleDocument } from './sampleDocs';

// ============================================================
// In-Memory Document Store (guarantees sample & active docs never vanish)
// ============================================================
interface CachedDoc {
  meta: DocumentMeta;
  text: string;
  pages: DocumentPage[];
  buffer?: Buffer;
  extension?: string;
}

const inMemoryDocs = new Map<string, CachedDoc>();
const deletedDocIds = new Set<string>();

function getDeletedIdsPath() {
  return path.join(getDataDir(), 'deleted_ids.json');
}

function loadDeletedIds(): Set<string> {
  try {
    const p = getDeletedIdsPath();
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(arr)) {
        for (const id of arr) deletedDocIds.add(id);
      }
    }
  } catch {}
  return deletedDocIds;
}

function saveDeletedId(docId: string) {
  deletedDocIds.add(docId);
  try {
    const p = getDeletedIdsPath();
    fs.writeFileSync(p, JSON.stringify(Array.from(deletedDocIds)), 'utf-8');
  } catch (err) {
    console.warn('Failed to save deleted id:', err);
  }
}

function removeDeletedId(docId: string) {
  deletedDocIds.delete(docId);
  try {
    const p = getDeletedIdsPath();
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(arr)) {
        const filtered = arr.filter((id: string) => id !== docId);
        fs.writeFileSync(p, JSON.stringify(filtered), 'utf-8');
      }
    }
  } catch {}
}

// Pre-populate with all sample legal contracts
function initSampleDocsInMemory() {
  loadDeletedIds();
  const samples = getAllSampleDocuments();
  for (const sample of samples) {
    if (!deletedDocIds.has(sample.id) && !inMemoryDocs.has(sample.id)) {
      inMemoryDocs.set(sample.id, {
        meta: sample.meta,
        text: sample.text,
        pages: sample.pages,
        buffer: Buffer.from(sample.text, 'utf-8'),
        extension: `.${sample.fileType}`,
      });
    }
  }
}

// Run initial seed on load
initSampleDocsInMemory();

// ============================================================
// Filesystem Path Resolution
// ============================================================
let resolvedDataDir: string | null = null;

export function getDataDir(): string {
  if (resolvedDataDir) return resolvedDataDir;

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

  try {
    if (!fs.existsSync(resolvedDataDir)) {
      fs.mkdirSync(resolvedDataDir, { recursive: true });
    }
  } catch (err) {
    console.warn('Failed to create storage dir:', err);
  }

  return resolvedDataDir;
}

export function getDocumentsDir(): string {
  const d = path.join(getDataDir(), 'documents');
  ensureDir(d);
  return d;
}

function ensureDir(dir: string) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    console.warn(`Could not mkdir ${dir}:`, e);
  }
}

function docDir(docId: string) {
  return path.join(getDocumentsDir(), docId);
}

// Auto-seed to disk if possible
export function autoSeedSampleDocs() {
  initSampleDocsInMemory();
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
      console.warn(`Could not write sample doc ${sample.id} to disk:`, err);
    }
  }
}

export function initStorage() {
  initSampleDocsInMemory();
  try {
    ensureDir(getDataDir());
    ensureDir(getDocumentsDir());
    autoSeedSampleDocs();
  } catch (err) {
    console.warn('Storage init warning:', err);
  }
}

// ============================================================
// Document Storage Operations
// ============================================================

export function saveDocumentFile(docId: string, buffer: Buffer, extension: string): string {
  // 1. Cache in memory
  const cached = inMemoryDocs.get(docId);
  if (cached) {
    cached.buffer = buffer;
    cached.extension = extension;
  }

  // 2. Persist to disk
  try {
    const dir = docDir(docId);
    ensureDir(dir);
    const filePath = path.join(dir, `original${extension}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.warn(`saveDocumentFile disk write failed for ${docId}:`, err);
    return `memory://${docId}/original${extension}`;
  }
}

export function getDocumentFilePath(docId: string): string | null {
  try {
    const dir = docDir(docId);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('original'));
    return files.length > 0 ? path.join(dir, files[0]) : null;
  } catch {
    return null;
  }
}

export function saveDocumentMeta(docId: string, meta: DocumentMeta) {
  removeDeletedId(docId);

  // 1. Cache in memory
  const cached = inMemoryDocs.get(docId);
  if (cached) {
    cached.meta = meta;
  } else {
    inMemoryDocs.set(docId, {
      meta,
      text: '',
      pages: [],
    });
  }

  // 2. Persist to disk
  try {
    const dir = docDir(docId);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  } catch (err) {
    console.warn(`saveDocumentMeta disk write failed for ${docId}:`, err);
  }
}

export function getDocumentMeta(docId: string): DocumentMeta | null {
  if (deletedDocIds.has(docId)) return null;

  // 1. Check in-memory store
  const cached = inMemoryDocs.get(docId);
  if (cached) return cached.meta;

  // 2. Check sample documents definition
  const sample = getSampleDocument(docId);
  if (sample) return sample.meta;

  // 3. Check disk
  try {
    const dir = docDir(docId);
    const metaPath = path.join(dir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      return meta;
    }
  } catch {
    // fallback
  }

  return null;
}

export function saveDocumentText(docId: string, fullText: string) {
  // 1. Cache in memory
  const cached = inMemoryDocs.get(docId);
  if (cached) {
    cached.text = fullText;
  }

  // 2. Persist to disk
  try {
    const dir = docDir(docId);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'text.txt'), fullText, 'utf-8');
  } catch (err) {
    console.warn(`saveDocumentText disk write failed for ${docId}:`, err);
  }
}

export function getDocumentText(docId: string): string | null {
  if (deletedDocIds.has(docId)) return null;

  // 1. Check in-memory store
  const cached = inMemoryDocs.get(docId);
  if (cached && cached.text) return cached.text;

  // 2. Check sample documents definition
  const sample = getSampleDocument(docId);
  if (sample) return sample.text;

  // 3. Check disk
  try {
    const textPath = path.join(docDir(docId), 'text.txt');
    if (fs.existsSync(textPath)) {
      return fs.readFileSync(textPath, 'utf-8');
    }
  } catch {}

  return null;
}

export function saveDocumentPages(docId: string, pages: DocumentPage[]) {
  // 1. Cache in memory
  const cached = inMemoryDocs.get(docId);
  if (cached) {
    cached.pages = pages;
  }

  // 2. Persist to disk
  try {
    const dir = docDir(docId);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(pages, null, 2));
  } catch (err) {
    console.warn(`saveDocumentPages disk write failed for ${docId}:`, err);
  }
}

export function getDocumentPages(docId: string): DocumentPage[] | null {
  if (deletedDocIds.has(docId)) return null;

  // 1. Check in-memory store
  const cached = inMemoryDocs.get(docId);
  if (cached && cached.pages && cached.pages.length > 0) return cached.pages;

  // 2. Check sample documents definition
  const sample = getSampleDocument(docId);
  if (sample) return sample.pages;

  // 3. Check disk
  try {
    const pagesPath = path.join(docDir(docId), 'pages.json');
    if (fs.existsSync(pagesPath)) {
      return JSON.parse(fs.readFileSync(pagesPath, 'utf-8'));
    }
  } catch {}

  return null;
}

export function listDocuments(): DocumentMeta[] {
  initSampleDocsInMemory();

  const docs: DocumentMeta[] = [];
  const seenIds = new Set<string>();

  // 1. Always include in-memory documents (includes sample contracts + current session uploads)
  for (const [id, doc] of inMemoryDocs.entries()) {
    if (!deletedDocIds.has(id) && !seenIds.has(id)) {
      docs.push(doc.meta);
      seenIds.add(id);
    }
  }

  // 2. Read any additional documents persisted on disk
  try {
    const docsDir = getDocumentsDir();
    if (fs.existsSync(docsDir)) {
      const dirs = fs.readdirSync(docsDir);
      for (const dir of dirs) {
        if (!seenIds.has(dir) && !deletedDocIds.has(dir)) {
          const meta = getDocumentMeta(dir);
          if (meta) {
            docs.push(meta);
            seenIds.add(meta.id);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error reading docs directory from disk:', err);
  }

  // 3. Guarantee sample contracts are never omitted
  for (const sample of getAllSampleDocuments()) {
    if (!seenIds.has(sample.id) && !deletedDocIds.has(sample.id)) {
      docs.push(sample.meta);
      seenIds.add(sample.id);
    }
  }

  return docs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

export function deleteDocument(docId: string): boolean {
  saveDeletedId(docId);
  inMemoryDocs.delete(docId);

  try {
    const dir = docDir(docId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`deleteDocument disk cleanup failed for ${docId}:`, err);
  }
  return true;
}

export function getOriginalFileBuffer(docId: string): { buffer: Buffer; extension: string } | null {
  if (deletedDocIds.has(docId)) return null;

  // 1. In-memory check
  const cached = inMemoryDocs.get(docId);
  if (cached && cached.buffer && cached.extension) {
    return { buffer: cached.buffer, extension: cached.extension };
  }

  // 2. Disk check
  try {
    const dir = docDir(docId);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.startsWith('original'));
      if (files.length > 0) {
        const filePath = path.join(dir, files[0]);
        const extension = path.extname(files[0]);
        return { buffer: fs.readFileSync(filePath), extension };
      }
    }
  } catch {}

  // 3. Sample fallback
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

const inMemoryChats = new Map<string, Map<string, ChatSession>>();

function chatsDir(docId: string) {
  return path.join(docDir(docId), 'chats');
}

export function saveChatSession(docId: string, session: ChatSession) {
  // 1. Memory cache
  if (!inMemoryChats.has(docId)) {
    inMemoryChats.set(docId, new Map());
  }
  inMemoryChats.get(docId)!.set(session.id, session);

  // 2. Disk write
  try {
    const dir = chatsDir(docId);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
  } catch (err) {
    console.warn(`saveChatSession disk write failed for ${docId}/${session.id}:`, err);
  }
}

export function getChatSession(docId: string, chatId: string): ChatSession | null {
  // 1. Memory check
  const docMap = inMemoryChats.get(docId);
  if (docMap && docMap.has(chatId)) {
    return docMap.get(chatId)!;
  }

  // 2. Disk check
  try {
    const chatPath = path.join(chatsDir(docId), `${chatId}.json`);
    if (fs.existsSync(chatPath)) {
      return JSON.parse(fs.readFileSync(chatPath, 'utf-8'));
    }
  } catch {}

  return null;
}

export function listChatSessions(docId: string): Omit<ChatSession, 'messages'>[] {
  const sessionsMap = new Map<string, Omit<ChatSession, 'messages'>>();

  // 1. Load from memory
  const docMap = inMemoryChats.get(docId);
  if (docMap) {
    for (const session of docMap.values()) {
      sessionsMap.set(session.id, {
        id: session.id,
        documentId: session.documentId,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
  }

  // 2. Load from disk
  try {
    const dir = chatsDir(docId);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const session: ChatSession = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
          if (!sessionsMap.has(session.id)) {
            sessionsMap.set(session.id, {
              id: session.id,
              documentId: session.documentId,
              title: session.title,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
            });
          }
        } catch {}
      }
    }
  } catch {}

  return Array.from(sessionsMap.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function deleteChatSession(docId: string, chatId: string): boolean {
  const docMap = inMemoryChats.get(docId);
  if (docMap) docMap.delete(chatId);

  try {
    const chatPath = path.join(chatsDir(docId), `${chatId}.json`);
    if (fs.existsSync(chatPath)) {
      fs.unlinkSync(chatPath);
    }
  } catch {}

  return true;
}

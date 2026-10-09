// ============================================================
// File-based Storage System
// ============================================================
import fs from 'fs';
import path from 'path';
import { DocumentMeta, DocumentPage, ChatSession } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DOCUMENTS_DIR = path.join(DATA_DIR, 'documents');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function docDir(docId: string) {
  return path.join(DOCUMENTS_DIR, docId);
}

// ============================================================
// Document Storage
// ============================================================

export function initStorage() {
  ensureDir(DATA_DIR);
  ensureDir(DOCUMENTS_DIR);
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
  const metaPath = path.join(docDir(docId), 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

export function saveDocumentText(docId: string, fullText: string) {
  const dir = docDir(docId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'text.txt'), fullText, 'utf-8');
}

export function getDocumentText(docId: string): string | null {
  const textPath = path.join(docDir(docId), 'text.txt');
  if (!fs.existsSync(textPath)) return null;
  return fs.readFileSync(textPath, 'utf-8');
}

export function saveDocumentPages(docId: string, pages: DocumentPage[]) {
  const dir = docDir(docId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(pages, null, 2));
}

export function getDocumentPages(docId: string): DocumentPage[] | null {
  const pagesPath = path.join(docDir(docId), 'pages.json');
  if (!fs.existsSync(pagesPath)) return null;
  return JSON.parse(fs.readFileSync(pagesPath, 'utf-8'));
}

export function listDocuments(): DocumentMeta[] {
  ensureDir(DOCUMENTS_DIR);
  const dirs = fs.readdirSync(DOCUMENTS_DIR);
  const docs: DocumentMeta[] = [];
  for (const dir of dirs) {
    const meta = getDocumentMeta(dir);
    if (meta) docs.push(meta);
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
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.startsWith('original'));
  if (files.length === 0) return null;
  const filePath = path.join(dir, files[0]);
  const extension = path.extname(files[0]);
  return { buffer: fs.readFileSync(filePath), extension };
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

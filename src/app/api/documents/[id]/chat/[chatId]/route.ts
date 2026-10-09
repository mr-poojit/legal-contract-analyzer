// ============================================================
// GET /api/documents/[id]/chat/[chatId] - Get a specific chat session
// DELETE /api/documents/[id]/chat/[chatId] - Delete a chat session
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { getChatSession, deleteChatSession } from '@/lib/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chatId: string }> }
) {
  const { id: docId, chatId } = await params;

  try {
    const session = getChatSession(docId, chatId);
    if (!session) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (error) {
    console.error('Get chat error:', error);
    return NextResponse.json(
      { error: 'Failed to get chat session' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chatId: string }> }
) {
  const { id: docId, chatId } = await params;

  try {
    const deleted = deleteChatSession(docId, chatId);
    if (!deleted) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete chat error:', error);
    return NextResponse.json(
      { error: 'Failed to delete chat session' },
      { status: 500 }
    );
  }
}

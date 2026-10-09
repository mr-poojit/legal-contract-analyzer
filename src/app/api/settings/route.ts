// ============================================================
// /api/settings - Manage AI API Key & Provider Configuration
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { setRuntimeConfig, getRuntimeConfig } from '@/lib/ai';

export const maxDuration = 30;

const ENV_LOCAL_PATH = path.join(process.cwd(), '.env.local');

export async function GET() {
  try {
    const config = getRuntimeConfig();
    const maskedKey = config.apiKey
      ? config.apiKey.length > 8
        ? `${config.apiKey.slice(0, 4)}...${config.apiKey.slice(-4)}`
        : '••••••••'
      : '';

    return NextResponse.json({
      hasKey: Boolean(config.apiKey),
      maskedKey,
      baseURL: config.baseURL,
      model: config.model,
      provider: config.baseURL.includes('generativelanguage.googleapis.com')
        ? 'gemini'
        : config.baseURL.includes('openrouter.ai')
        ? 'openrouter'
        : 'openai',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, baseURL, model } = body as {
      apiKey: string;
      baseURL?: string;
      model?: string;
    };

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json(
        { error: 'API key cannot be empty' },
        { status: 400 }
      );
    }

    const cleanKey = apiKey.trim();
    let finalBaseURL = baseURL?.trim() || 'https://api.openai.com/v1';
    let finalModel = model?.trim() || 'gpt-4o-mini';

    // Auto-detect provider if user pasted a key with known prefixes
    if (cleanKey.startsWith('AIzaSy')) {
      // Google Gemini API Key
      if (!baseURL || baseURL === 'https://api.openai.com/v1') {
        finalBaseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        finalModel = 'gemini-1.5-flash';
      }
    } else if (cleanKey.startsWith('sk-or-')) {
      // OpenRouter Key
      if (!baseURL || baseURL === 'https://api.openai.com/v1') {
        finalBaseURL = 'https://openrouter.ai/api/v1';
        finalModel = 'openai/gpt-4o-mini';
      }
    }

    // 1. Update in-memory runtime config
    setRuntimeConfig({
      apiKey: cleanKey,
      baseURL: finalBaseURL,
      model: finalModel,
    });

    // 2. Persist to .env.local if writable (e.g., local dev)
    try {
      let envContent = '';
      if (fs.existsSync(ENV_LOCAL_PATH)) {
        envContent = fs.readFileSync(ENV_LOCAL_PATH, 'utf-8');
      }

      const envMap = new Map<string, string>();
      envContent.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          envMap.set(match[1], match[2] || '');
        }
      });

      envMap.set('OPENAI_API_KEY', cleanKey);
      envMap.set('OPENAI_BASE_URL', finalBaseURL);
      envMap.set('OPENAI_MODEL', finalModel);

      const newEnvLines: string[] = [];
      for (const [key, value] of envMap.entries()) {
        newEnvLines.push(`${key}=${value}`);
      }

      fs.writeFileSync(ENV_LOCAL_PATH, newEnvLines.join('\n') + '\n', 'utf-8');
    } catch {
      // In serverless / read-only filesystem (like Vercel), ignore disk write failure.
      // Runtime in-memory config is already active.
    }

    return NextResponse.json({
      success: true,
      message: 'API Key saved successfully! Live LLM streaming is now active.',
      model: finalModel,
      baseURL: finalBaseURL,
    });
  } catch (error) {
    console.error('Save settings error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save settings' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    setRuntimeConfig({ apiKey: '', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' });

    try {
      if (fs.existsSync(ENV_LOCAL_PATH)) {
        let envContent = fs.readFileSync(ENV_LOCAL_PATH, 'utf-8');
        envContent = envContent
          .replace(/^OPENAI_API_KEY=.*$/m, '')
          .replace(/^AI_API_KEY=.*$/m, '');
        fs.writeFileSync(ENV_LOCAL_PATH, envContent.trim() + '\n', 'utf-8');
      }
    } catch {
      // read-only ignore
    }

    return NextResponse.json({ success: true, message: 'API key cleared.' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clear key' },
      { status: 500 }
    );
  }
}

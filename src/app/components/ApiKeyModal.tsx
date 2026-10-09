'use client';

import { useState, useEffect } from 'react';
import { Key, Check, AlertCircle, X, Shield, Sparkles, ExternalLink, RefreshCw } from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeySaved?: () => void;
}

export function ApiKeyModal({ isOpen, onClose, onKeySaved }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o-mini');
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load current settings
  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null);
      fetch('/api/settings')
        .then(r => r.json())
        .then(data => {
          setHasKey(data.hasKey);
          setMaskedKey(data.maskedKey || '');
          if (data.baseURL) setBaseURL(data.baseURL);
          if (data.model) setModel(data.model);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePresetChange = (preset: string) => {
    if (preset === 'openai') {
      setBaseURL('https://api.openai.com/v1');
      setModel('gpt-4o-mini');
    } else if (preset === 'openrouter') {
      setBaseURL('https://openrouter.ai/api/v1');
      setModel('openai/gpt-4o-mini');
    } else if (preset === 'gemini') {
      setBaseURL('https://generativelanguage.googleapis.com/v1beta/openai/');
      setModel('gemini-1.5-flash');
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setStatusMessage({ type: 'error', text: 'Please enter an API key.' });
      return;
    }

    setIsLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          baseURL: baseURL.trim(),
          model: model.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusMessage({ type: 'error', text: data.error || 'Failed to save API key' });
      } else {
        setStatusMessage({ type: 'success', text: 'API key saved successfully! Cloud LLM streaming is now active.' });
        setHasKey(true);
        setMaskedKey(`${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);
        setApiKey('');
        if (typeof window !== 'undefined') {
          localStorage.setItem('clauseguard_api_key', apiKey.trim());
        }
        onKeySaved?.();
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network error saving settings.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = async () => {
    setIsLoading(true);
    try {
      await fetch('/api/settings', { method: 'DELETE' });
      setHasKey(false);
      setMaskedKey('');
      setApiKey('');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('clauseguard_api_key');
      }
      setStatusMessage({ type: 'success', text: 'API key removed. Running in built-in local analysis mode.' });
      onKeySaved?.();
    } catch {
      setStatusMessage({ type: 'error', text: 'Failed to clear key.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'var(--color-accent-primary-light)',
              color: 'var(--color-accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Key size={18} />
            </div>
            <div>
              <div className="modal-title" style={{ fontSize: 'var(--font-size-md)', margin: 0 }}>AI Provider & API Key</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                Configure OpenAI, OpenRouter, or Gemini compatibility
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Status banner */}
          <div style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: hasKey ? 'var(--color-success-bg)' : 'var(--color-info-bg)',
            border: `1px solid ${hasKey ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {hasKey ? (
                <>
                  <Check size={16} style={{ color: 'var(--color-success)' }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                    Active Key: <code style={{ color: 'var(--color-success)' }}>{maskedKey}</code>
                  </span>
                </>
              ) : (
                <>
                  <Sparkles size={16} style={{ color: 'var(--color-info)' }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                    Currently using <strong>Built-In Local Analysis Mode</strong>
                  </span>
                </>
              )}
            </div>

            {hasKey && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleClear}
                disabled={isLoading}
                style={{ fontSize: '11px', color: 'var(--color-error)' }}
              >
                Remove
              </button>
            )}
          </div>

          {/* Quick preset buttons */}
          <div>
            <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
              Provider Preset
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                className={`btn btn-sm ${baseURL.includes('api.openai.com') ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handlePresetChange('openai')}
              >
                OpenAI
              </button>
              <button
                type="button"
                className={`btn btn-sm ${baseURL.includes('openrouter.ai') ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handlePresetChange('openrouter')}
              >
                OpenRouter
              </button>
              <button
                type="button"
                className={`btn btn-sm ${baseURL.includes('googleapis.com') ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handlePresetChange('gemini')}
              >
                Gemini
              </button>
            </div>
          </div>

          {/* API Key Input */}
          <div>
            <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
              API Key
            </label>
            <input
              type="password"
              className="input"
              placeholder={hasKey ? "Enter new key to replace..." : "e.g. sk-proj-... or sk-or-..."}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: '13px' }}
            />
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
              Keys are stored securely in your local environment (`.env.local`) on your machine.
            </div>
          </div>

          {/* Base URL & Model */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                Base URL
              </label>
              <input
                type="text"
                className="input input-sm"
                value={baseURL}
                onChange={e => setBaseURL(e.target.value)}
                style={{ width: '100%', fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                Model
              </label>
              <input
                type="text"
                className="input input-sm"
                value={model}
                onChange={e => setModel(e.target.value)}
                style={{ width: '100%', fontSize: '12px' }}
              />
            </div>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-xs)',
              background: statusMessage.type === 'success' ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
              color: statusMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              {statusMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Built-in fallback explanation */}
          <div style={{
            padding: '10px 12px',
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            fontSize: '11px',
            color: 'var(--color-text-tertiary)',
            lineHeight: 1.5,
          }}>
            <Shield size={13} style={{ verticalAlign: 'middle', marginRight: '4px', color: 'var(--color-accent-primary)' }} />
            <strong>No API key right now?</strong> No problem! ClauseGuard features an intelligent built-in semantic contract analysis engine with exact quote extraction and verification that works 100% offline out-of-the-box.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isLoading || !apiKey.trim()}>
            {isLoading ? <RefreshCw size={14} className="spinning" /> : <Check size={14} />}
            <span>Save & Connect</span>
          </button>
        </div>
      </div>
    </div>
  );
}

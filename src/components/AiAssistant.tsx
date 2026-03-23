'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Zap, Brain } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  source?: 'elfa' | 'gemini';
  cached?: boolean;
}

const SOURCE_LABEL = {
  elfa:   { label: 'Elfa · Twitter AI', color: 'var(--accent)'   },
  gemini: { label: 'Gemini · Google AI', color: 'var(--success)' },
};

const SUGGESTIONS = [
  "Twitter'da en çok konuşulan coin nedir?",
  'BTC teknik analizi yap',
  'DeFi yield farming nedir?',
  'Smart money şu an nerede?',
];

export default function AiAssistant() {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const bottomRef                 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(question: string) {
    if (!question.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Bilinmeyen hata');

      setMessages((prev) => [
        ...prev,
        {
          role:    'assistant',
          content: data.answer,
          source:  data.source,
          cached:  data.cached,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role:    'assistant',
          content: err instanceof Error ? err.message : 'Bir hata oluştu.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 480,
      background: 'var(--surface)',
      overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 18px',
        borderBottom: '1px solid var(--border1)',
        background: 'var(--surface2)',
      }}>
        <Bot size={18} color="var(--accent)" />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text1)' }}>
          AI Asistan
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 11,
          color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <Zap size={11} /> Elfa + Gemini
        </span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 18px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>

        {/* Empty state */}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Brain size={32} color="var(--accent)" style={{ marginBottom: 12 }} />
            <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 16 }}>
              Kripto piyasası hakkında soru sor
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  style={{
                    fontSize: 12, padding: '6px 12px',
                    background: 'var(--surface2)',
                    border: '1px solid var(--border1)',
                    borderRadius: 20, color: 'var(--text2)',
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            gap: 10, alignItems: 'flex-start',
          }}>
            {/* Avatar */}
            <div style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface2)',
              border: '1px solid var(--border1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {msg.role === 'user'
                ? <User size={14} color="#fff" />
                : <Bot size={14} color="var(--accent)" />}
            </div>

            {/* Bubble */}
            <div style={{ maxWidth: '78%' }}>
              <div style={{
                padding: '10px 14px', borderRadius: 10, fontSize: 13,
                lineHeight: 1.6, color: 'var(--text1)',
                background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface2)',
                color: msg.role === 'user' ? '#fff' : 'var(--text1)',
                border: msg.role === 'assistant' ? '1px solid var(--border1)' : 'none',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>

              {/* Source badge */}
              {msg.source && (
                <div style={{
                  marginTop: 4, fontSize: 10,
                  color: SOURCE_LABEL[msg.source].color,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <Zap size={9} />
                  {SOURCE_LABEL[msg.source].label}
                  {msg.cached && (
                    <span style={{ color: 'var(--text3)', marginLeft: 4 }}>· cache</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'var(--surface2)', border: '1px solid var(--border1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bot size={14} color="var(--accent)" />
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'var(--surface2)', border: '1px solid var(--border1)',
            }}>
              <Loader2 size={14} color="var(--text3)"
                style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border1)',
        display: 'flex', gap: 8,
      }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Bir soru sor... (Enter ile gönder)"
          maxLength={500}
          style={{
            flex: 1, padding: '9px 14px', fontSize: 13,
            background: 'var(--surface2)',
            border: '1px solid var(--border1)',
            borderRadius: 8, color: 'var(--text1)',
            outline: 'none',
          }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          style={{
            padding: '9px 14px', borderRadius: 8,
            background: loading || !input.trim() ? 'var(--surface2)' : 'var(--accent)',
            border: '1px solid var(--border1)',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center',
          }}
        >
          <Send size={15} color={loading || !input.trim() ? 'var(--text3)' : '#fff'} />
        </button>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

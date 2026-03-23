'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Brain, ChevronDown } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'What is DeFi yield farming?',
  'Analyze BTC technically',
  'Most talked coin on Twitter?',
  'Where is smart money now?',
  'What are the best altcoins to watch?',
  'Explain perpetual futures',
  'How does liquidation work?',
  'What is open interest?',
];

declare global {
  interface Window {
    puter: any;
  }
}

export default function AiAssistant() {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [isOpen, setIsOpen]       = useState(true);
  const [puterReady, setPuterReady] = useState(false);
  const messagesEndRef             = useRef<HTMLDivElement>(null);
  const messagesContainerRef       = useRef<HTMLDivElement>(null);

  // Load Puter.js script once
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.puter) {
      const script = document.createElement('script');
      script.src = 'https://js.puter.com/v2/';
      script.async = true;
      script.onload = () => setPuterReady(true);
      document.body.appendChild(script);
    } else {
      setPuterReady(true);
    }
  }, []);

  // Scroll only inside the messages container, never the page
  useEffect(() => {
    if (!messagesContainerRef.current) return;
    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [messages, loading]);

  async function sendMessage(question: string) {
    if (!question.trim() || loading || !puterReady) return;
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      // Puter AI call
      const answer = await window.puter.ai.chat(question, {
        model: 'ai21/jamba-large-1.7', // optional, defaults to a good model
      });
      setMessages(prev => [...prev, { role: 'assistant', content: answer }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'AI yanıt verirken bir hata oluştu. Lütfen tekrar deneyin.',
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', overflow: 'hidden', height: '100%' }}>

      {/* Header — clickable to toggle */}
      <div
        onClick={() => setIsOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px',
          borderBottom: isOpen ? '1px solid var(--border1)' : 'none',
          background: 'var(--surface2)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <Bot size={15} color="var(--accent)" />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text1)', flex: 1 }}>AI Assistant</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text3)', marginRight: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: puterReady ? 'var(--success)' : 'var(--warning)', display: 'inline-block' }} />
          {puterReady ? 'Online' : 'Loading...'}
        </span>
        <ChevronDown
          size={14}
          color="var(--text3)"
          style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
      </div>

      {/* Collapsible body */}
      {isOpen && (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* Left: Suggested questions */}
          <div style={{
            width: 180, flexShrink: 0,
            borderRight: '1px solid var(--border1)',
            padding: '10px 8px',
            display: 'flex', flexDirection: 'column', gap: 4,
            overflowY: 'auto',
          }}>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4, paddingLeft: 4 }}>
              Suggested
            </div>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                disabled={loading || !puterReady}
                style={{
                  textAlign: 'left', fontSize: 11, padding: '7px 10px',
                  background: 'var(--surface)', border: '1px solid var(--border1)',
                  borderRadius: 8, color: 'var(--text2)', cursor: (loading || !puterReady) ? 'not-allowed' : 'pointer',
                  lineHeight: 1.4, transition: 'border-color 0.15s, color 0.15s',
                  opacity: (loading || !puterReady) ? 0.5 : 1,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text1)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border1)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text2)'; }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Right: Chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              style={{
                flex: 1, overflowY: 'auto', padding: '12px 14px',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}
            >
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', marginTop: 30 }}>
                  <Brain size={28} color="var(--accent)" style={{ marginBottom: 10 }} />
                  <p style={{ color: 'var(--text2)', fontSize: 12 }}>
                    Ask anything about crypto markets
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  gap: 8, alignItems: 'flex-start',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface2)',
                    border: '1px solid var(--border1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {msg.role === 'user'
                      ? <User size={12} color="#fff" />
                      : <Bot size={12} color="var(--accent)" />}
                  </div>
                  <div style={{ maxWidth: '80%' }}>
                    <div style={{
                      padding: '8px 12px', borderRadius: 9, fontSize: 12, lineHeight: 1.6,
                      background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface2)',
                      color: msg.role === 'user' ? '#fff' : 'var(--text1)',
                      border: msg.role === 'assistant' ? '1px solid var(--border1)' : 'none',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: 'var(--surface2)', border: '1px solid var(--border1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Bot size={12} color="var(--accent)" />
                  </div>
                  <div style={{ padding: '8px 12px', borderRadius: 9, background: 'var(--surface2)', border: '1px solid var(--border1)' }}>
                    <Loader2 size={13} color="var(--text3)" style={{ animation: 'spin 1s linear infinite' }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border1)', display: 'flex', gap: 7 }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question... (Enter to send)"
                maxLength={500}
                style={{
                  flex: 1, padding: '8px 12px', fontSize: 12,
                  background: 'var(--surface2)', border: '1px solid var(--border1)',
                  borderRadius: 7, color: 'var(--text1)', outline: 'none',
                }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim() || !puterReady}
                style={{
                  padding: '8px 12px', borderRadius: 7,
                  background: (loading || !input.trim() || !puterReady) ? 'var(--surface2)' : 'var(--accent)',
                  border: '1px solid var(--border1)',
                  cursor: (loading || !input.trim() || !puterReady) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <Send size={13} color={(loading || !input.trim() || !puterReady) ? 'var(--text3)' : '#fff'} />
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

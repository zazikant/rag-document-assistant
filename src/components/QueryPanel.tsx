'use client';

import { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  error?: boolean;
}

interface QueryPanelProps {
  documentsCount: number;
}

export default function QueryPanel({ documentsCount }: QueryPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setQuery('');
    setLoading(true);

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });

      const data = await response.json();

      if (data.error) {
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.error,
          error: true,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } else {
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.answer,
          sources: data.sources || [],
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get response';
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: message,
        error: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const emptyState = messages.length === 0 && !loading;

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-3.5"
        style={{
          borderBottom: '1px solid var(--card-border)',
        }}
      >
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--accent)' }}
        >
          <svg className="h-4.5 w-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            RAG Assistant
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {documentsCount > 0
              ? `${documentsCount} document${documentsCount !== 1 ? 's' : ''} indexed`
              : 'No documents indexed'}
          </p>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {emptyState ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div
              className="h-16 w-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(59,130,246,0.1)' }}
            >
              <svg
                className="h-8 w-8"
                style={{ color: 'var(--accent)' }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
              Upload some documents and ask questions!
            </h3>
            <p className="text-sm max-w-xs" style={{ color: 'var(--muted)' }}>
              Add your PDF or text documents on the left, then come back here to query them with AI-powered search.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] ${msg.role === 'user' ? '' : ''}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <div
                        className="h-5 w-5 rounded-md flex items-center justify-center"
                        style={{ background: 'var(--accent)' }}
                      >
                        <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                      </div>
                      <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                        Assistant
                      </span>
                    </div>
                  )}
                  <div
                    className="rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
                    style={{
                      background: msg.role === 'user'
                        ? 'var(--accent)'
                        : msg.error
                          ? 'rgba(239,68,68,0.1)'
                          : 'rgba(255,255,255,0.05)',
                      color: msg.role === 'user'
                        ? '#ffffff'
                        : msg.error
                          ? 'var(--danger)'
                          : 'var(--foreground)',
                      border: msg.role === 'assistant' && !msg.error
                        ? '1px solid var(--card-border)'
                        : 'none',
                    }}
                  >
                    {msg.content}
                  </div>
                  {/* Source tags */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {msg.sources.map((source, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md"
                          style={{
                            background: 'rgba(59,130,246,0.1)',
                            color: 'var(--accent)',
                            border: '1px solid rgba(59,130,246,0.2)',
                          }}
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                          {source}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.role === 'user' && (
                    <div className="flex justify-end mt-1.5">
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>You</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading Indicator */}
            {loading && (
              <div className="flex justify-start">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="h-5 w-5 rounded-md flex items-center justify-center"
                      style={{ background: 'var(--accent)' }}
                    >
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                    </div>
                    <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                      Assistant
                    </span>
                  </div>
                  <div
                    className="rounded-xl px-4 py-3"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--card-border)',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="flex gap-1">
                        <span
                          className="h-2 w-2 rounded-full animate-bounce"
                          style={{
                            background: 'var(--accent)',
                            animationDelay: '0ms',
                            animationDuration: '0.8s',
                          }}
                        />
                        <span
                          className="h-2 w-2 rounded-full animate-bounce"
                          style={{
                            background: 'var(--accent)',
                            animationDelay: '150ms',
                            animationDuration: '0.8s',
                          }}
                        />
                        <span
                          className="h-2 w-2 rounded-full animate-bounce"
                          style={{
                            background: 'var(--accent)',
                            animationDelay: '300ms',
                            animationDuration: '0.8s',
                          }}
                        />
                      </div>
                      <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
                        Searching documents…
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div
        className="px-5 py-4"
        style={{ borderTop: '1px solid var(--card-border)' }}
      >
        <form onSubmit={handleSubmit} className="flex gap-2">
          <textarea
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              documentsCount > 0
                ? 'Ask a question about your documents…'
                : 'Upload documents first to start querying…'
            }
            disabled={loading}
            rows={1}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none resize-none transition-all duration-200"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--card-border)',
              color: 'var(--foreground)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--card-border)';
            }}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center transition-all duration-200"
            style={{
              background: loading || !query.trim() ? 'rgba(255,255,255,0.05)' : 'var(--accent)',
              color: loading || !query.trim() ? 'var(--muted)' : '#ffffff',
              cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!loading && query.trim()) e.currentTarget.style.background = 'var(--accent-hover)';
            }}
            onMouseLeave={(e) => {
              if (!loading && query.trim()) e.currentTarget.style.background = 'var(--accent)';
            }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </form>
        <p className="text-[11px] mt-2 text-center" style={{ color: 'var(--card-border)' }}>
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

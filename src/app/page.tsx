'use client';

import { useState, useRef, useEffect } from 'react';

interface Document {
  filename: string;
  sha256: string;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'upload' | 'query' | 'docs'>('upload');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [queryInput, setQueryInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Upload form state
  const [uploadMode, setUploadMode] = useState<'Add' | 'Replace' | 'Delete'>('Add');
  const [uploadType, setUploadType] = useState<'pdf' | 'text'>('pdf');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState('');
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch documents on mount and after upload/delete
  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.documents) {
        setDocuments(data.documents);
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Handle file upload
  const handleUpload = async () => {
    setIsLoading(true);
    setUploadStatus('');

    try {
      const formData = new FormData();

      if (uploadMode === 'Delete') {
        // For delete, we just need the filename
        const filename = selectedFile?.name || prompt('Enter filename to delete:');
        if (!filename) {
          setUploadStatus('Error: Filename is required for delete');
          setIsLoading(false);
          return;
        }
        formData.append('name', filename);
        formData.append('mode', 'Delete');
      } else {
        formData.append('mode', uploadMode);

        if (uploadType === 'pdf' && selectedFile) {
          formData.append('file', selectedFile);
          formData.append('name', selectedFile.name);
        } else if (uploadType === 'text' && textContent) {
          formData.append('name', `text-doc-${Date.now()}.txt`);
          formData.append('content', textContent);
        } else {
          setUploadStatus('Error: No content provided');
          setIsLoading(false);
          return;
        }
      }

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.status === 'Error') {
        setUploadStatus(`Error: ${data.error}`);
      } else {
        const msg = data.chunks
          ? `${data.status} — ${data.chunks} chunks${data.pages ? `, ${data.pages} pages` : ''}`
          : data.reason
            ? `${data.status}: ${data.reason}`
            : data.status;
        setUploadStatus(msg);
        fetchDocuments();
      }
    } catch (err: any) {
      setUploadStatus(`Error: ${err.message}`);
    }

    setIsLoading(false);
  };

  // Handle query
  const handleQuery = async () => {
    if (!queryInput.trim()) return;

    const userMessage: ChatMessage = { role: 'user', content: queryInput };
    setChatMessages((prev) => [...prev, userMessage]);
    setQueryInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryInput }),
      });

      const data = await res.json();

      if (data.status === 'Error') {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: `Error: ${data.error}`,
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
      } else {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: data.answer,
          sources: data.sources,
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err: any) {
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: `Error: ${err.message}`,
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
    }

    setIsLoading(false);
  };

  // Handle delete from documents list
  const handleDeleteDocument = async (filename: string) => {
    if (!confirm(`Delete "${filename}"?`)) return;

    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('name', filename);
      formData.append('mode', 'Delete');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.status === 'Deleted') {
        fetchDocuments();
      } else {
        alert(`Delete failed: ${data.error || data.status || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="border-b border-[var(--card-border)] bg-[var(--card-bg)]">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              R
            </div>
            <h1 className="text-xl font-semibold text-white">RAG Document Assistant</h1>
          </div>
          <div className="text-sm text-[var(--muted)]">
            {documents.length} document{documents.length !== 1 ? 's' : ''} indexed
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="max-w-6xl mx-auto px-4 mt-4">
        <div className="flex gap-1 bg-[var(--card-bg)] rounded-lg p-1 border border-[var(--card-border)]">
          {(['upload', 'query', 'docs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'text-[var(--muted)] hover:text-white hover:bg-[var(--card-border)]'
              }`}
            >
              {tab === 'upload' ? 'Upload' : tab === 'query' ? 'Query' : 'Documents'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Upload Document</h2>

            {/* Mode Selector */}
            <div className="mb-4">
              <label className="block text-sm text-[var(--muted)] mb-2">Mode</label>
              <div className="flex gap-2">
                {(['Add', 'Replace', 'Delete'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setUploadMode(m)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      uploadMode === m
                        ? m === 'Delete'
                          ? 'bg-red-600 text-white'
                          : 'bg-blue-600 text-white'
                        : 'bg-[var(--card-border)] text-[var(--muted)] hover:text-white'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {uploadMode !== 'Delete' && (
              <>
                {/* Type Selector */}
                <div className="mb-4">
                  <label className="block text-sm text-[var(--muted)] mb-2">Type</label>
                  <div className="flex gap-2">
                    {(['pdf', 'text'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setUploadType(t);
                          setSelectedFile(null);
                          setTextContent('');
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          uploadType === t
                            ? 'bg-blue-600 text-white'
                            : 'bg-[var(--card-border)] text-[var(--muted)] hover:text-white'
                        }`}
                      >
                        {t === 'pdf' ? 'PDF File' : 'Raw Text'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* PDF File Upload */}
                {uploadType === 'pdf' && (
                  <div className="mb-4">
                    <label className="block text-sm text-[var(--muted)] mb-2">PDF File</label>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-[var(--card-border)] rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                      {selectedFile ? (
                        <div className="text-white">
                          <p className="font-medium">{selectedFile.name}</p>
                          <p className="text-sm text-[var(--muted)]">
                            {(selectedFile.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      ) : (
                        <div className="text-[var(--muted)]">
                          <p className="text-3xl mb-2">+</p>
                          <p>Click to select a PDF file</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Text Content */}
                {uploadType === 'text' && (
                  <div className="mb-4">
                    <label className="block text-sm text-[var(--muted)] mb-2">Text Content</label>
                    <textarea
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      placeholder="Paste your text content here..."
                      className="w-full h-48 bg-[var(--background)] border border-[var(--card-border)] rounded-lg p-3 text-white text-sm resize-none focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}
              </>
            )}

            {/* Delete filename */}
            {uploadMode === 'Delete' && (
              <div className="mb-4">
                <p className="text-sm text-[var(--muted)]">
                  Select a file to delete from the Documents tab, or use the list below.
                </p>
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={handleUpload}
              disabled={isLoading}
              className={`w-full py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                uploadMode === 'Delete'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isLoading
                ? 'Processing...'
                : uploadMode === 'Delete'
                  ? 'Delete Document'
                  : 'Upload Document'}
            </button>

            {/* Status Message */}
            {uploadStatus && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  uploadStatus.startsWith('Error')
                    ? 'bg-red-900/20 text-red-400 border border-red-800'
                    : 'bg-green-900/20 text-green-400 border border-green-800'
                }`}
              >
                {uploadStatus}
              </div>
            )}
          </div>
        )}

        {/* Query Tab */}
        {activeTab === 'query' && (
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl flex flex-col h-[calc(100vh-200px)]">
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center text-[var(--muted)] mt-20">
                  <p className="text-4xl mb-4">?</p>
                  <p className="text-lg font-medium">Ask a question about your documents</p>
                  <p className="text-sm mt-2">
                    Upload some documents first, then query them using AI-powered RAG
                  </p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl p-4 ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-[var(--card-border)] text-white'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/20">
                        <p className="text-xs opacity-70">Sources:</p>
                        {msg.sources.map((src, j) => (
                          <span
                            key={j}
                            className="inline-block text-xs bg-white/10 rounded px-2 py-0.5 mr-1 mt-1"
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-[var(--card-border)] rounded-xl p-4 text-[var(--muted)]">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce [animation-delay:0.1s]" />
                      <span className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce [animation-delay:0.2s]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Query Input */}
            <div className="border-t border-[var(--card-border)] p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleQuery()}
                  placeholder="Ask about your documents..."
                  className="flex-1 bg-[var(--background)] border border-[var(--card-border)] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500"
                  disabled={isLoading}
                />
                <button
                  onClick={handleQuery}
                  disabled={isLoading || !queryInput.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Documents Tab */}
        {activeTab === 'docs' && (
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl">
            <div className="p-4 border-b border-[var(--card-border)] flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Indexed Documents</h2>
              <button
                onClick={fetchDocuments}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Refresh
              </button>
            </div>
            {documents.length === 0 ? (
              <div className="p-8 text-center text-[var(--muted)]">
                <p className="text-3xl mb-3">No documents yet</p>
                <p className="text-sm">Upload a document to get started</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--card-border)]">
                {documents.map((doc) => (
                  <div
                    key={doc.filename}
                    className="p-4 flex items-center justify-between hover:bg-[var(--card-border)]/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{doc.filename}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
                        <span>SHA: {doc.sha256.slice(0, 12)}...</span>
                        <span>{doc.storage_path ? 'PDF stored' : 'Text only'}</span>
                        <span>Updated: {new Date(doc.updated_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteDocument(doc.filename)}
                      className="ml-4 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

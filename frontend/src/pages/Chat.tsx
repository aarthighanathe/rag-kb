/**
 * @file Chat.tsx
 * @description Research-tool chat interface — responsive two-panel layout.
 *   Desktop (≥769px): vertical source catalog sidebar + chat area.
 *   Mobile (≤768px): horizontal source top bar + full-width chat (drawer for filter).
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import {
  useEffect, useRef, useState, useCallback,
  type FormEvent, type KeyboardEvent,
} from 'react';
import { Send, StopCircle, Trash2, MessageSquare, SlidersHorizontal, X, HelpCircle, Columns2 } from 'lucide-react';
import { useSSE, type SSEEvent } from '../hooks/useSSE';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useQueryHistory } from '../hooks/useQueryHistory';
import { useIsMobile } from '../hooks/useMobileBreakpoint';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useShallow } from 'zustand/react/shallow';
import { useRagStore, type Citation } from '../stores/ragStore';
import { getQueryStreamUrl, submitQueryFeedback, type QueryFeedback } from '../services/api';
import { ChatMessage } from '../design-system/components/ChatMessage';
import { AssistantMessage } from '../design-system/components/AssistantMessage';
import type { ChatCitation } from '../design-system/components/ChatMessage';
import { Button } from '../design-system/components/Button';
import { LoadingSpinner } from '../design-system/components/LoadingSpinner';
import { QueryHistoryPanel } from '../design-system/components/QueryHistoryPanel';
import { SourcePanel } from '../design-system/components/SourcePanel';
import { OnboardingFlow } from '../design-system/components/OnboardingFlow';
import { ChatLayoutProvider, useLastMessageCopyRegistry } from '../contexts/ChatLayoutContext';
import { useCitationHighlight } from '../hooks/useCitationHighlight';
import { useAppToast } from '../contexts/ToastContext';
import { downloadConversation, type ChatMessage as ExportChatMessage } from '../utils/exportConversation';
import { pluralize } from '../utils/pluralize';

// ---------------------------------------------------------------------------
// Citation conversion helpers
// ---------------------------------------------------------------------------

function toChatCitation(c: Citation): ChatCitation {
  return {
    id: c.chunkId,
    documentName: c.documentName,
    chunkRef: c.chunkRef,
    relevanceScore: c.similarity,
    fullText: c.excerpt,
  };
}

const SUGGESTED_QUERIES = [
  'Summarize all uploaded documents',
  'What are the key topics covered?',
  'What are the main conclusions?',
];

/** Must match QueryRequestSchema's query min in backend/src/schemas/query.schema.ts. */
const MIN_QUERY_LENGTH = 3;

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

type StreamPhase = 'idle' | 'searching' | 'found' | 'generating';

function StatusBar({ phase, foundCount }: { phase: StreamPhase; foundCount?: number }): React.JSX.Element | null {
  if (phase === 'idle') return null;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '0 28px 8px',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #D8D4C8',
          color: '#8A8578',
          fontFamily: "'Space Mono', monospace",
          fontSize: '10px',
          padding: '4px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
        aria-live="polite"
        aria-atomic="true"
      >
        <LoadingSpinner size="sm" />
        {phase === 'searching'  && <span>◉ Searching your documents…</span>}
        {phase === 'found'      && <span style={{ color: '#2D5A4A' }}>◉ Found {foundCount ?? 0} relevant {foundCount === 1 ? 'passage' : 'passages'}</span>}
        {phase === 'generating' && <span>◉ Writing answer…</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source catalog panel (left, dark)
// ---------------------------------------------------------------------------

interface DocFilterPanelProps {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (all: boolean) => void;
}

function DocFilterPanel({ selectedIds, onToggle, onSelectAll }: DocFilterPanelProps): React.JSX.Element {
  const { documents, documentsLoading, fetchDocuments } = useRagStore(
    useShallow((s) => ({
      documents: s.documents,
      documentsLoading: s.documentsLoading,
      fetchDocuments: s.fetchDocuments,
    })),
  );
  const readyDocs   = documents.filter((d) => d.status === 'ready');
  const allSelected = readyDocs.length > 0 && readyDocs.every((d) => selectedIds.has(d.id));

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);

  return (
    <aside
      style={{
        background: '#1C1B19',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
      aria-label="Source documents filter"
    >
      {/* Header */}
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #2C2B29', flexShrink: 0 }}>
        <h2
          className="font-display"
          style={{ fontSize: '16px', fontWeight: 900, color: '#F7F5F0', marginBottom: '2px' }}
        >
          Sources
        </h2>
        <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '11px', color: '#8A8578' }}>
          Choose which documents to search
        </p>
      </div>

      {/* All documents row */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '11px 18px',
          background: allSelected ? '#242320' : 'transparent',
          borderLeft: allSelected ? '3px solid #FF4D2E' : '3px solid transparent',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          onChange={(e) => onSelectAll(e.target.checked)}
          style={{ accentColor: '#FF4D2E', width: '14px', height: '14px', flexShrink: 0 }}
          aria-label="Select all documents"
        />
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', fontWeight: 600, color: '#F7F5F0', flex: 1 }}>
          All documents
        </span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '9px', color: '#8A8578' }}>
          {readyDocs.length}
        </span>
        {documentsLoading && <LoadingSpinner size="sm" />}
      </label>

      {/* Individual doc list */}
      <ul style={{ flex: 1, overflowY: 'auto', listStyle: 'none', padding: 0, margin: 0 }} role="list">
        {readyDocs.length === 0 && !documentsLoading && (
          <li style={{ padding: '32px 18px', textAlign: 'center', fontFamily: "'Space Mono', monospace", fontSize: '11px', color: '#8A8578', fontStyle: 'italic' }}>
            No ready documents yet.
            <br />Upload and process files first.
          </li>
        )}
        {readyDocs.map((doc) => {
          const checked = selectedIds.has(doc.id);
          return (
            <li key={doc.id} role="listitem">
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '10px 18px',
                  borderLeft: checked ? '3px solid rgba(255,77,46,0.6)' : '3px solid transparent',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(44,43,41,0.6)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(doc.id)}
                  style={{ accentColor: '#FF4D2E', width: '14px', height: '14px', marginTop: '1px', flexShrink: 0 }}
                  aria-label={`Include ${doc.filename}`}
                />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '12px', color: checked ? '#F7F5F0' : '#8A8578', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.filename}
                  </p>
                  <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '9px', color: '#B8B4AC' }}>
                    {doc.chunk_count} {doc.chunk_count === 1 ? 'passage' : 'passages'}
                  </p>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div style={{ marginTop: 'auto', borderTop: '1px solid #2C2B29', padding: '12px 18px', flexShrink: 0 }}>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#8A8578' }}>
          {pluralize(readyDocs.length, 'document')} · {pluralize(readyDocs.reduce((s, d) => s + d.chunk_count, 0), 'passage')} indexed
        </p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mobile source top bar (horizontal, full-width — replaces sidebar at ≤768px)
// ---------------------------------------------------------------------------

interface MobileSourceTopBarProps {
  readyCount: number;
  selectedCount: number;
  onOpen: () => void;
}

/**
 * Compact horizontal source bar shown above chat on mobile viewports.
 * @param readyCount - Number of ready documents available
 * @param selectedCount - Number of currently selected document IDs
 * @param onOpen - Opens the full sources drawer
 * @returns Mobile-only top bar element
 */
function MobileSourceTopBar({ readyCount, selectedCount, onOpen }: MobileSourceTopBarProps): React.JSX.Element {
  const summary = selectedCount > 0
    ? `${selectedCount} of ${readyCount} selected`
    : `${pluralize(readyCount, 'source')} available`;

  return (
    <div
      className="md:hidden flex-shrink-0"
      style={{ background: '#1C1B19', borderBottom: '1px solid #2C2B29' }}
      data-testid="mobile-source-top-bar"
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center justify-between gap-3"
        style={{ padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', minHeight: '56px' }}
        aria-label="Open source documents filter"
      >
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <p
            className="font-display"
            style={{ fontSize: '14px', fontWeight: 900, color: '#F7F5F0', marginBottom: '1px' }}
          >
            Card Catalog
          </p>
          <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '10px', color: '#8A8578' }}>
            {summary}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {selectedCount > 0 && (
            <span
              style={{
                background: '#FF4D2E',
                color: '#FFFFFF',
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-hidden="true"
            >
              {selectedCount}
            </span>
          )}
          <SlidersHorizontal size={16} style={{ color: '#8A8578' }} aria-hidden="true" />
        </div>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile sources drawer
// ---------------------------------------------------------------------------

function MobileSourcesDrawer({
  open, onClose, selectedIds, onToggle, onSelectAll,
  historyEntries, isStreaming, onRerun, onDeleteHistory, onClearHistory,
}: DocFilterPanelProps & {
  open: boolean;
  onClose: () => void;
  historyEntries: import('../utils/queryHistory').HistoryEntry[];
  isStreaming: boolean;
  onRerun: (query: string) => void;
  onDeleteHistory: (id: string) => void;
  onClearHistory: () => void;
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap must run unconditionally (hooks rule) — it internally no-ops
  // while `open` is false, matching Modal.tsx's behavior for a real dialog:
  // traps Tab/Shift+Tab, moves focus in on open, restores it on close, and
  // closes on Escape.
  useFocusTrap(dialogRef, { open, onClose });

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-ds-overlay md:hidden"
      role="dialog"
      aria-label="Source documents"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col shadow-ds-lifted animate-slide-up" style={{ background: '#1C1B19' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #2C2B29', flexShrink: 0 }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', fontWeight: 700, color: '#F7F5F0' }}>Sources</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sources panel"
            style={{ color: '#8A8578', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flexShrink: 0 }}>
            <DocFilterPanel selectedIds={selectedIds} onToggle={onToggle} onSelectAll={onSelectAll} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <QueryHistoryPanel
              entries={historyEntries}
              isStreaming={isStreaming}
              onRerun={onRerun}
              onRemove={onDeleteHistory}
              onClear={onClearHistory}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat page
// ---------------------------------------------------------------------------

/**
 * Research-tool chat page — two-panel full-bleed layout.
 * Left: ink.base source catalog (240px). Right: paper.base chat area.
 */
export function Chat(): React.JSX.Element {
  const [inputValue, setInputValue]         = useState('');
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [streamPhase, setStreamPhase]       = useState<StreamPhase>('idle');
  const [foundCount, setFoundCount]         = useState(0);
  // Not React state: 'complete' sets this and calls onComplete in the same
  // synchronous tick, before React re-renders, so a state-based value read
  // inside handleSSEComplete's closure would still see the previous render's
  // (often null) value. A ref is read/written outside the render cycle, so
  // handleSSEComplete always sees the value 'complete' just set.
  const pendingQueryLogIdRef = useRef<string | null>(null);
  const [sourcesOpen, setSourcesOpen]       = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [shortcutsOpen, setShortcutsOpen]     = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);

  const {
    messages, isStreaming, currentQueryId,
    sendQuery, clearChat,
    appendStreamToken, finalizeStreamingMessage, setStreamingError,
    documents,
    conversationHistory, clearHistory,
    lastCompletedQuery, clearLastCompletedQuery,
    splitScreenEnabled, toggleSplitScreen,
    liveChunks, queryPhase,
    setMessageFeedback,
  } = useRagStore(
    useShallow((s) => ({
      messages: s.messages,
      isStreaming: s.isStreaming,
      currentQueryId: s.currentQueryId,
      sendQuery: s.sendQuery,
      clearChat: s.clearChat,
      appendStreamToken: s.appendStreamToken,
      finalizeStreamingMessage: s.finalizeStreamingMessage,
      setStreamingError: s.setStreamingError,
      documents: s.documents,
      conversationHistory: s.conversationHistory,
      clearHistory: s.clearHistory,
      lastCompletedQuery: s.lastCompletedQuery,
      clearLastCompletedQuery: s.clearLastCompletedQuery,
      splitScreenEnabled: s.splitScreenEnabled,
      toggleSplitScreen: s.toggleSplitScreen,
      liveChunks: s.liveChunks,
      queryPhase: s.queryPhase,
      setMessageFeedback: s.setMessageFeedback,
    })),
  );

  // Query history (localStorage-backed)
  const historyHook = useQueryHistory();
  const isMobile = useIsMobile(768);
  const toast = useAppToast();

  // Split-mode citation highlight (lifted to Chat level)
  const splitHighlight = useCitationHighlight();
  // Lets the last assistant message register its copy handler, so
  // handleCopyLast (below) can trigger it without querying the DOM.
  const lastMessageCopyRegistry = useLastMessageCopyRegistry();

  // Number of complete exchanges (user+assistant pairs) in history
  const exchangeCount = Math.floor(conversationHistory.length / 2);

  const sseUrl = currentQueryId ? getQueryStreamUrl(currentQueryId) : null;

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'searching':
        setStreamPhase('searching');
        useRagStore.setState({ queryPhase: 'searching', liveChunks: [] });
        break;
      case 'found': {
        const chunks = Array.isArray(event.data['chunks'])
          ? (event.data['chunks'] as Array<Record<string, unknown>>)
          : [];
        const citations: Citation[] = chunks.map((s, i) => ({
            documentId:   String(s['documentId']   ?? ''),
            documentName: String(s['filename']     ?? ''),
            chunkId:      String(s['chunkId']      ?? ''),
            chunkRef:     `Chunk ${i + 1}`,
            similarity:   typeof s['similarity'] === 'number' ? s['similarity'] : 0,
            excerpt:      String(s['excerpt']      ?? ''),
          }));
        setFoundCount(chunks.length);
        setStreamPhase('found');
        useRagStore.setState({ queryPhase: 'streaming', liveChunks: citations });
        break;
      }
      case 'generating':
        setStreamPhase('generating');
        break;
      case 'token':
        if (typeof event.data['content'] === 'string') appendStreamToken(event.data['content']);
        break;
      case 'complete':
        // queryLogId is the query_logs row id — the handle used later by
        // POST /api/query/:queryId/feedback. It's absent (undefined) if the
        // backend's fire-and-forget log write failed; feedback is simply
        // unavailable for that one message in that case.
        pendingQueryLogIdRef.current =
          typeof event.data['queryLogId'] === 'string' ? event.data['queryLogId'] : null;
        break;
      case 'error': {
        const msg = typeof event.data['message'] === 'string' ? event.data['message'] : 'Stream error';
        setStreamingError(msg);
        setStreamPhase('idle');
        useRagStore.setState({ queryPhase: 'idle' });
        break;
      }
    }
  }, [appendStreamToken, setStreamingError]);

  const handleSSEComplete = useCallback(() => {
    const startTs   = messages[messages.length - 2]?.timestamp ?? Date.now();
    const latencyMs = Date.now() - startTs;
    finalizeStreamingMessage(latencyMs, pendingQueryLogIdRef.current);
    pendingQueryLogIdRef.current = null;
    setStreamPhase('idle');
  }, [finalizeStreamingMessage, messages]);

  const handleSSEError = useCallback((error: Error) => {
    setStreamingError(error.message);
    setStreamPhase('idle');
  }, [setStreamingError]);

  const { isConnected, disconnect } = useSSE(sseUrl, {
    onEvent: handleSSEEvent,
    onComplete: handleSSEComplete,
    onError: handleSSEError,
  });

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Close shortcuts panel on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (shortcutsRef.current && !shortcutsRef.current.contains(event.target as Node)) {
        setShortcutsOpen(false);
      }
    };

    if (shortcutsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [shortcutsOpen]);

  // Persist completed queries to history (localStorage)
  useEffect(() => {
    if (!lastCompletedQuery) return;
    historyHook.add({
      query: lastCompletedQuery.query,
      timestamp: new Date().toISOString(),
      citationCount: lastCompletedQuery.citationCount,
      confidenceLevel: lastCompletedQuery.confidenceLevel,
    });
    clearLastCompletedQuery();
  }, [lastCompletedQuery, historyHook, clearLastCompletedQuery]);

  const handleSubmit = useCallback((e?: FormEvent): void => {
    e?.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;
    if (trimmed.length < MIN_QUERY_LENGTH) {
      toast.toast(`Question must be at least ${MIN_QUERY_LENGTH} characters`, { variant: 'info' });
      return;
    }
    const docIds = selectedDocIds.size > 0 ? Array.from(selectedDocIds) : undefined;
    setInputValue('');
    void sendQuery(trimmed, docIds);
  }, [inputValue, isStreaming, selectedDocIds, sendQuery, toast]);

  const handleReQuery = useCallback((query: string) => {
    setInputValue(query);
    setTimeout(() => {
      const docIds = selectedDocIds.size > 0 ? Array.from(selectedDocIds) : undefined;
      void sendQuery(query, docIds);
    }, 0);
  }, [selectedDocIds, sendQuery]);

  // Optimistic update: reflect the rating immediately, revert on API failure.
  const handleFeedback = useCallback((messageId: string, queryLogId: string, feedback: QueryFeedback) => {
    const previous = messages.find((m) => m.id === messageId)?.feedback ?? null;
    setMessageFeedback(messageId, feedback);
    submitQueryFeedback(queryLogId, feedback).catch(() => {
      setMessageFeedback(messageId, previous);
      toast.toast('Could not save feedback — try again', { variant: 'error' });
    });
  }, [messages, setMessageFeedback, toast]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSubmit(); }
  }, [handleSubmit]);

  const fillSuggestion = useCallback((q: string) => {
    setInputValue(q);
    inputRef.current?.focus();
  }, []);

  const toggleDoc = useCallback((id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((all: boolean) => {
    if (all) setSelectedDocIds(new Set(documents.filter((d) => d.status === 'ready').map((d) => d.id)));
    else     setSelectedDocIds(new Set());
  }, [documents]);

  const handleStop = useCallback(() => {
    disconnect();
    setStreamPhase('idle');
    finalizeStreamingMessage(null);
  }, [disconnect, finalizeStreamingMessage]);

  const handleNewConversation = useCallback(() => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 2000);
    } else {
      setConfirmingClear(false);
      clearHistory();
      clearChat();
    }
  }, [confirmingClear, clearHistory, clearChat]);

  const handleExport = useCallback(() => {
    // Convert store messages to export format
    const exportMessages: ExportChatMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      citations: msg.citations?.map((c, i) => {
        const parsed = parseInt(c.chunkRef.replace(/\D/g, ''), 10);
        return {
          index: i + 1,
          filename: c.documentName,
          chunkIndex: Number.isNaN(parsed) ? i + 1 : parsed,
          similarity: c.similarity,
        };
      }),
    }));
    downloadConversation(exportMessages);
  }, [messages]);

  const handleCopyLast = useCallback(() => {
    // Find the last completed assistant message
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.isStreaming);
    if (lastAssistant) {
      // Routed through ChatLayoutContext — the last (non-streaming) assistant
      // message registers its own copy handler there (see AssistantMessage.tsx),
      // so this triggers the copy directly rather than querying the DOM for a
      // copy button to click.
      lastMessageCopyRegistry.copyLastMessage();
    }
  }, [messages, lastMessageCopyRegistry]);

  const handleToggleSplitScreen = useCallback(() => {
    if (isMobile) {
      toast.toast('Split-screen is available on wider screens', { variant: 'info' });
      return;
    }
    toggleSplitScreen();
  }, [isMobile, toggleSplitScreen, toast]);

  // Register keyboard shortcuts (disabled during streaming)
  useKeyboardShortcuts(
    {
      onFocusInput: () => inputRef.current?.focus(),
      onSend: handleSubmit,
      onClearInput: () => setInputValue(''),
      onExport: handleExport,
      onCopyLast: handleCopyLast,
      onToggleHistory: () => setSourcesOpen((prev) => !prev),
    },
    !isStreaming,
  );

  const readyDocs = documents.filter((d) => d.status === 'ready');
  const showOnboarding = documents.length === 0 && messages.length === 0;

  return (
    <div
      className="flex flex-col md:grid md:grid-cols-[200px_1fr] lg:grid-cols-[240px_1fr] h-full overflow-hidden"
    >
      {/* ── Desktop: vertical source catalog sidebar (hidden ≤768px) ──────── */}
      <div
        className="hidden md:flex md:flex-col h-full overflow-hidden"
        data-testid="source-catalog-panel"
      >
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <DocFilterPanel
            selectedIds={selectedDocIds}
            onToggle={toggleDoc}
            onSelectAll={handleSelectAll}
          />
        </div>
        <div style={{ flexShrink: 0, maxHeight: '40%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <QueryHistoryPanel
            entries={historyHook.entries}
            isStreaming={isStreaming}
            onRerun={fillSuggestion}
            onRemove={historyHook.remove}
            onClear={historyHook.clear}
          />
        </div>
      </div>

      {/* ── Mobile: horizontal source top bar (hidden ≥769px) ─────────────── */}
      <MobileSourceTopBar
        readyCount={readyDocs.length}
        selectedCount={selectedDocIds.size}
        onOpen={() => setSourcesOpen(true)}
      />

      {/* Mobile sources drawer */}
      <MobileSourcesDrawer
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        selectedIds={selectedDocIds}
        onToggle={toggleDoc}
        onSelectAll={handleSelectAll}
        historyEntries={historyHook.entries}
        isStreaming={isStreaming}
        onRerun={fillSuggestion}
        onDeleteHistory={historyHook.remove}
        onClearHistory={historyHook.clear}
      />

      {/* ── Chat area — full width on mobile, right column on desktop ──────── */}
      <div
        className={`flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden ${splitScreenEnabled && !isMobile ? 'md:grid md:grid-cols-[55fr_45fr]' : ''}`}
        style={{ background: '#F7F5F0' }}
      >
        <ChatLayoutProvider
          value={{
            splitScreenEnabled: splitScreenEnabled && !isMobile,
            hideIndexCards: splitScreenEnabled && !isMobile,
            hideTimeline: splitScreenEnabled && !isMobile,
            activeCitation: splitHighlight.activeCitation,
            onCitationEnter: splitHighlight.onCitationEnter,
            onCitationLeave: splitHighlight.onLeave,
            onCitationClick: splitHighlight.onCitationClick,
            ...lastMessageCopyRegistry,
          }}
        >
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Top bar */}
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 md:px-7 md:py-3.5"
          style={{
            background: '#FFFFFF',
            borderBottom: '1px solid #D8D4C8',
            flexShrink: 0,
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h1
              className="font-display truncate"
              style={{ fontSize: '22px', fontWeight: 900, fontStyle: 'italic', color: '#1C1B19' }}
            >
              Reading Room
            </h1>

            {isConnected && (
              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '12px', color: '#2D5A4A', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2D5A4A', animation: 'pulse 1.5s infinite' }} aria-hidden="true" />
                Live
              </span>
            )}

            {/* Split-screen toggle — hidden on mobile */}
            <button
              type="button"
              data-testid="split-toggle"
              onClick={handleToggleSplitScreen}
              aria-pressed={splitScreenEnabled}
              aria-label="Toggle split-screen mode"
              className="hidden md:flex"
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                background: splitScreenEnabled ? 'rgba(255,77,46,0.08)' : 'transparent',
                border: `1px solid ${splitScreenEnabled ? '#FF4D2E' : '#D8D4C8'}`,
                color: splitScreenEnabled ? '#FF4D2E' : '#8A8578',
                padding: '5px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 150ms ease',
                whiteSpace: 'nowrap',
              }}
              title={splitScreenEnabled ? 'Disable split-screen mode' : 'Enable split-screen mode'}
              onMouseEnter={(e) => {
                if (!splitScreenEnabled) {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#1C1B19';
                  (e.currentTarget as HTMLButtonElement).style.color = '#1C1B19';
                }
              }}
              onMouseLeave={(e) => {
                if (!splitScreenEnabled) {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#D8D4C8';
                  (e.currentTarget as HTMLButtonElement).style.color = '#8A8578';
                }
              }}
            >
              <Columns2 size={13} aria-hidden="true" />
              Split
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Active sources badge — desktop only (mobile uses top bar) */}
            <span
              className="hidden md:inline"
              style={{
                background: '#E8F5E9',
                color: '#2D5A4A',
                border: '1px solid #2D5A4A',
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                padding: '3px 10px',
              }}
            >
              {selectedDocIds.size > 0
                ? `${pluralize(selectedDocIds.size, 'source')} active`
                : `${pluralize(readyDocs.length, 'source')} available`}
            </span>

            {/* Export button — single button, visible on all screen sizes */}
            <button
              type="button"
              onClick={handleExport}
              disabled={messages.length === 0}
              aria-label="Export conversation as Markdown file"
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                letterSpacing: '0.04em',
                background: 'transparent',
                border: '1px solid #D8D4C8',
                color: '#8A8578',
                padding: '5px 12px',
                cursor: messages.length === 0 ? 'not-allowed' : 'pointer',
                opacity: messages.length === 0 ? 0.4 : 1,
                transition: 'all 150ms ease',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => {
                if (messages.length > 0) {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#1C1B19';
                  (e.currentTarget as HTMLButtonElement).style.color = '#1C1B19';
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#D8D4C8';
                (e.currentTarget as HTMLButtonElement).style.color = '#8A8578';
              }}
            >
              Export →
            </button>

            {/* New conversation button */}
            <button
              id="new-conversation-btn"
              type="button"
              onClick={handleNewConversation}
              aria-label="Start new conversation"
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                background: 'transparent',
                border: '1px solid #D8D4C8',
                color: confirmingClear ? '#FF4D2E' : '#8A8578',
                padding: '4px 10px',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                whiteSpace: 'nowrap',
              }}
            >
              {confirmingClear ? 'Sure? Click again' : 'New conversation'}
            </button>

            {messages.length > 0 && (
              <Button variant="ghost" size="sm" iconLeft={<Trash2 size={12} />} onClick={clearChat} aria-label="Clear chat history">
                Clear
              </Button>
            )}

            {/* Keyboard shortcuts help button */}
            <div ref={shortcutsRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShortcutsOpen(!shortcutsOpen)}
                aria-label="Show keyboard shortcuts"
                style={{
                  width: '28px',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: '1px solid #D8D4C8',
                  color: '#8A8578',
                  cursor: 'pointer',
                  transition: 'all 150ms ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#1C1B19';
                  (e.currentTarget as HTMLButtonElement).style.color = '#1C1B19';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#D8D4C8';
                  (e.currentTarget as HTMLButtonElement).style.color = '#8A8578';
                }}
              >
                <HelpCircle size={14} aria-hidden="true" />
              </button>

              {/* Shortcuts dropdown panel */}
              {shortcutsOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '8px',
                    background: '#FFFFFF',
                    border: '1px solid #D8D4C8',
                    padding: '16px',
                    zIndex: 50,
                    minWidth: '320px',
                  }}
                  role="dialog"
                  aria-label="Keyboard shortcuts"
                >
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      <tr>
                        <td style={{ fontFamily: "'Space Mono', monospace", fontSize: '12px', color: '#FF4D2E', padding: '4px 8px', verticalAlign: 'top' }}>Ctrl+K</td>
                        <td style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#1C1B19', padding: '4px 8px', verticalAlign: 'top' }}>Focus query input</td>
                      </tr>
                      <tr>
                        <td style={{ fontFamily: "'Space Mono', monospace", fontSize: '12px', color: '#FF4D2E', padding: '4px 8px', verticalAlign: 'top' }}>Ctrl+Enter</td>
                        <td style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#1C1B19', padding: '4px 8px', verticalAlign: 'top' }}>Send query</td>
                      </tr>
                      <tr>
                        <td style={{ fontFamily: "'Space Mono', monospace", fontSize: '12px', color: '#FF4D2E', padding: '4px 8px', verticalAlign: 'top' }}>Escape</td>
                        <td style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#1C1B19', padding: '4px 8px', verticalAlign: 'top' }}>Clear focused input</td>
                      </tr>
                      <tr>
                        <td style={{ fontFamily: "'Space Mono', monospace", fontSize: '12px', color: '#FF4D2E', padding: '4px 8px', verticalAlign: 'top' }}>Ctrl+Shift+E</td>
                        <td style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#1C1B19', padding: '4px 8px', verticalAlign: 'top' }}>Export conversation</td>
                      </tr>
                      <tr>
                        <td style={{ fontFamily: "'Space Mono', monospace", fontSize: '12px', color: '#FF4D2E', padding: '4px 8px', verticalAlign: 'top' }}>Ctrl+Shift+C</td>
                        <td style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#1C1B19', padding: '4px 8px', verticalAlign: 'top' }}>Copy last answer</td>
                      </tr>
                      <tr>
                        <td style={{ fontFamily: "'Space Mono', monospace", fontSize: '12px', color: '#FF4D2E', padding: '4px 8px', verticalAlign: 'top' }}>Ctrl+H</td>
                        <td style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', color: '#1C1B19', padding: '4px 8px', verticalAlign: 'top' }}>Toggle query history</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messages area */}
        <div
          className="flex-1 overflow-y-auto px-4 py-6 md:px-7 md:py-6 flex flex-col gap-4"
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
        >
          {showOnboarding ? (
            <OnboardingFlow />
          ) : messages.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', textAlign: 'center' }}>
              <div style={{ marginBottom: '8px' }}>
                <MessageSquare size={36} style={{ color: '#D8D4C8', margin: '0 auto 12px' }} aria-hidden="true" />
                <h2 className="font-display" style={{ fontSize: '20px', fontWeight: 900, fontStyle: 'italic', color: '#1C1B19', marginBottom: '8px' }}>
                  Ask about your documents
                </h2>
                <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '14px', color: '#8A8578', maxWidth: '380px', lineHeight: '1.6' }}>
                  Select one or more documents from the left panel, then ask a question. The AI will search through your documents and answer based on what it finds.
                </p>
              </div>

              {/* Suggested queries */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '480px' }}>
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    data-testid="suggested-query"
                    type="button"
                    onClick={() => fillSuggestion(q)}
                    style={{
                      textAlign: 'left',
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: '14px',
                      color: '#5C5850',
                      background: '#FFFFFF',
                      border: '1px solid #D8D4C8',
                      padding: '12px 20px',
                      cursor: 'pointer',
                      width: '100%',
                      transition: 'border-color 150ms ease, color 150ms ease',
                    }}
                    aria-label={`Use suggested query: ${q}`}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = '#FF4D2E';
                      (e.currentTarget as HTMLButtonElement).style.color = '#1C1B19';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = '#D8D4C8';
                      (e.currentTarget as HTMLButtonElement).style.color = '#5C5850';
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div data-testid="chat-message-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} role="list">
              {(() => {
                // Computed once per render (single pass over messages), not
                // once per assistant message rendered inside the loop below —
                // avoids O(n^2) re-scans during streaming, when every SSE
                // token triggers a re-render of the whole list.
                const lastAssistantIdx = messages.reduce(
                  (acc, m, i) => (m.role === 'assistant' ? i : acc),
                  -1,
                );
                return messages.map((msg, idx) => {
                  if (msg.role === 'assistant') {
                    const isLastAssistant = idx === lastAssistantIdx;
                    return (
                      <AssistantMessage
                        key={msg.id}
                        content={msg.content}
                        citations={msg.citations?.map((c) => toChatCitation(c)) ?? []}
                        isStreaming={msg.isStreaming}
                        timestamp={new Date(msg.timestamp).toISOString()}
                        messageIndex={idx}
                        sourceQuery={isLastAssistant ? msg.sourceQuery : undefined}
                        onReQuery={isLastAssistant ? handleReQuery : undefined}
                        queryLogId={msg.queryLogId}
                        feedback={msg.feedback}
                        onFeedback={
                          msg.queryLogId
                            ? (feedback) => handleFeedback(msg.id, msg.queryLogId!, feedback)
                            : undefined
                        }
                      />
                    );
                  }
                  return (
                    <ChatMessage
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      streaming={msg.isStreaming}
                      citations={msg.citations?.map((c) => toChatCitation(c))}
                      timestamp={new Date(msg.timestamp).toISOString()}
                    />
                  );
                });
              })()}
            </div>
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>
        {/* Status indicator */}
        <StatusBar phase={streamPhase} foundCount={foundCount} />

        {/* Thread pill — only shown when history exists */}
        {exchangeCount > 0 && (
          <div
            data-testid="thread-pill"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 28px',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                color: '#8A8578',
                background: '#F7F5F0',
                border: '1px solid #D8D4C8',
                padding: '3px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              ◎ {exchangeCount}-turn thread
              <button
                type="button"
                onClick={() => { clearHistory(); clearChat(); }}
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '10px',
                  color: '#FF4D2E',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0',
                  textDecoration: 'underline',
                }}
                aria-label="Clear conversation thread"
              >
                Clear →
              </button>
            </span>
          </div>
        )}

        {/* Input bar */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 px-4 py-3.5 md:px-7 md:py-3.5 flex-shrink-0"
          style={{
            background: '#FFFFFF',
            borderTop: '1px solid #D8D4C8',
          }}
          aria-label="Ask a question"
        >
          <div className="flex items-center gap-2.5">
          <textarea
            ref={inputRef}
            data-testid="query-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question…"
            style={{
              flex: 1,
              border: 'none',
              borderBottom: `1.5px solid ${inputValue ? '#FF4D2E' : '#D8D4C8'}`,
              background: 'transparent',
              padding: '8px 0',
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: '14px',
              color: '#1C1B19',
              outline: 'none',
              resize: 'none',
              minHeight: '40px',
              maxHeight: '160px',
              transition: 'border-color 150ms ease',
            }}
            rows={1}
            disabled={isStreaming}
            aria-label="Question input"
            aria-disabled={isStreaming}
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              aria-label="Stop generating"
              style={{
                background: '#C0392B',
                color: '#FFFFFF',
                border: 'none',
                padding: '10px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <StopCircle size={17} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={inputValue.trim().length < MIN_QUERY_LENGTH}
              aria-label="Send question"
              style={{
                background: inputValue.trim().length >= MIN_QUERY_LENGTH ? '#FF4D2E' : '#F0EDEA',
                color: inputValue.trim().length >= MIN_QUERY_LENGTH ? '#FFFFFF' : '#B8B4AC',
                border: 'none',
                padding: '10px 22px',
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: '13px',
                cursor: inputValue.trim().length >= MIN_QUERY_LENGTH ? 'pointer' : 'not-allowed',
                transition: 'all 150ms ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Send size={15} aria-hidden="true" />
              Send →
            </button>
          )}
          </div>
          {/* Keyboard shortcut hints — desktop only */}
          <p
            className="hidden md:block text-center"
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '10px',
              color: '#8A8578',
            }}
          >
            Ctrl+Enter to send · Ctrl+K to focus · Ctrl+Shift+E to export · Ctrl+H history
          </p>
        </form>
        </div>
        </ChatLayoutProvider>

        {/* Source panel — only in split-screen mode, desktop only */}
        {splitScreenEnabled && !isMobile && (
          <SourcePanel
            liveChunks={liveChunks}
            queryPhase={queryPhase}
          />
        )}
      </div>
    </div>
  );
}

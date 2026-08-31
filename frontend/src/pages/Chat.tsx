/**
 * @file Chat.tsx
 * @description Research-tool chat interface — responsive two-panel layout.
 *   Desktop (≥769px): vertical source catalog sidebar + chat area.
 *   Mobile (≤768px): horizontal source top bar + full-width chat (drawer for filter).
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Send, StopCircle, Trash2, MessageSquare, HelpCircle, Columns2 } from 'lucide-react';
import { useSSE, type SSEEvent, safeParseCitations } from '../hooks/useSSE';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useQueryHistory } from '../hooks/useQueryHistory';
import { useIsMobile } from '../hooks/useMobileBreakpoint';
import { useShallow } from 'zustand/react/shallow';
import { useRagStore, type Citation } from '../stores/ragStore';
import {
  getQueryStreamUrl,
  submitQueryFeedback,
  getSuggestedTopics,
  getQueryHistory,
  type QueryFeedback,
} from '../services/api';
import type { HistoryEntry } from '../utils/queryHistory';
import { ChatMessage } from '../design-system/components/ChatMessage';
import { AssistantMessage } from '../design-system/components/AssistantMessage';
import { Button } from '../design-system/components/Button';
import { QueryHistoryPanel } from '../design-system/components/QueryHistoryPanel';
import { SourcePanel } from '../design-system/components/SourcePanel';
import { OnboardingFlow } from '../design-system/components/OnboardingFlow';
import { StatusBar, type StreamPhase } from '../design-system/components/StatusBar';
import { DocFilterPanel } from '../design-system/components/DocFilterPanel';
import { MobileSourceTopBar } from '../design-system/components/MobileSourceTopBar';
import { MobileSourcesDrawer } from '../design-system/components/MobileSourcesDrawer';
import { ChatLayoutProvider, useLastMessageCopyRegistry } from '../contexts/ChatLayoutContext';
import { useCitationHighlight } from '../hooks/useCitationHighlight';
import { useAppToast } from '../contexts/ToastContext';
import {
  downloadConversation,
  type ChatMessage as ExportChatMessage,
} from '../utils/exportConversation';
import { toChatCitation } from '../utils/chatCitations';
import { pluralize } from '../utils/pluralize';
import { clientLog } from '../utils/clientLogger';

const SUGGESTED_QUERIES = [
  'Summarize all uploaded documents',
  'What are the key topics covered?',
  'What are the main conclusions?',
];

/** Must match QueryRequestSchema's query min in backend/src/schemas/query.schema.ts. */
const MIN_QUERY_LENGTH = 3;

// ---------------------------------------------------------------------------
// Chat page
// ---------------------------------------------------------------------------

/**
 * Research-tool chat page — two-panel full-bleed layout.
 * Left: ink.base source catalog (240px). Right: paper.base chat area.
 */
export function Chat(): React.JSX.Element {
  const [inputValue, setInputValue] = useState('');
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  // True once the 'generating' SSE event has fired for the current query —
  // the one bit of granularity StatusBar needs (distinguishing "sources
  // found, about to generate" from "actively writing the answer") that
  // queryPhase's coarser 'streaming' value doesn't carry on its own.
  const [isGenerating, setIsGenerating] = useState(false);
  const [foundCount, setFoundCount] = useState(0);
  // Not React state: 'complete' sets this and calls onComplete in the same
  // synchronous tick, before React re-renders, so a state-based value read
  // inside handleSSEComplete's closure would still see the previous render's
  // (often null) value. A ref is read/written outside the render cycle, so
  // handleSSEComplete always sees the value 'complete' just set.
  const pendingQueryLogIdRef = useRef<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Content-aware suggestions (real section headings from the selected/ready
  // documents), falling back to SUGGESTED_QUERIES when empty — either no
  // documents are selected yet, or none of them have detected section
  // structure (e.g. plain unstructured text).
  const [contentSuggestions, setContentSuggestions] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const shortcutsPanelRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isStreaming,
    currentQueryId,
    sendQuery,
    clearChat,
    appendStreamToken,
    finalizeStreamingMessage,
    setStreamingError,
    documents,
    conversationHistory,
    clearHistory,
    lastCompletedQuery,
    clearLastCompletedQuery,
    splitScreenEnabled,
    toggleSplitScreen,
    liveChunks,
    queryPhase,
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

  // Backend-searched history (the durable full query_logs history, distinct
  // from historyHook's 10-entry localStorage cache) — only fetched when the
  // user actually types into QueryHistoryPanel's search box.
  const [historySearchResults, setHistorySearchResults] = useState<HistoryEntry[]>([]);
  const [historySearchLoading, setHistorySearchLoading] = useState(false);
  const handleHistorySearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setHistorySearchResults([]);
      setHistorySearchLoading(false);
      return;
    }
    setHistorySearchLoading(true);
    getQueryHistory({ search: trimmed, limit: 20 })
      .then((result) => {
        // Adapts the backend's QueryHistoryEntry shape into the local
        // HistoryEntry shape QueryHistoryPanel renders, so the panel's
        // internals don't need to know about two different entry types.
        // citationCount/confidenceLevel have no backend equivalent (the
        // panel hides the delete/clear controls that would need them to be
        // meaningful anyway while search results are showing), so they're
        // filled with neutral placeholders rather than fabricated data.
        setHistorySearchResults(
          result.entries.map((e) => ({
            id: e.id,
            query: e.queryText,
            timestamp: e.createdAt,
            citationCount: 0,
            confidenceLevel: 'none' as const,
          })),
        );
      })
      .catch(() => setHistorySearchResults([]))
      .finally(() => setHistorySearchLoading(false));
  }, []);

  // Split-mode citation highlight (lifted to Chat level)
  const splitHighlight = useCitationHighlight();
  // Lets the last assistant message register its copy handler, so
  // handleCopyLast (below) can trigger it without querying the DOM.
  const lastMessageCopyRegistry = useLastMessageCopyRegistry();

  // Number of complete exchanges (user+assistant pairs) in history
  const exchangeCount = Math.floor(conversationHistory.length / 2);

  const sseUrl = currentQueryId ? getQueryStreamUrl(currentQueryId) : null;

  // Derived from the store's queryPhase (single source of truth) plus the
  // one extra bit of granularity StatusBar needs beyond it — avoids
  // maintaining a second, independently-set phase state machine that can
  // silently drift from queryPhase's vocabulary (as happened previously:
  // this handler set queryPhase: 'complete' on finish while the old local
  // streamPhase state went to 'idle', so StatusBar and SourcePanel disagreed
  // about what "done" meant for the same stream).
  const streamPhase: StreamPhase = useMemo(() => {
    if (queryPhase === 'idle' || queryPhase === 'complete') return 'idle';
    if (queryPhase === 'searching') return 'searching';
    return isGenerating ? 'generating' : 'found';
  }, [queryPhase, isGenerating]);

  const handleSSEEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case 'searching':
          setIsGenerating(false);
          useRagStore.setState({ queryPhase: 'searching', liveChunks: [] });
          break;
        case 'found': {
          const chunks = safeParseCitations(event.data['chunks']);
          const citations: Citation[] = chunks.map((s) => ({
            documentId: s.documentId,
            documentName: s.filename,
            chunkId: s.chunkId,
            chunkRef: `Chunk ${s.citationNumber}`,
            similarity: s.similarity,
            excerpt: s.excerpt,
            citationNumber: s.citationNumber,
          }));
          setFoundCount(chunks.length);
          useRagStore.setState({ queryPhase: 'streaming', liveChunks: citations });
          break;
        }
        case 'generating':
          setIsGenerating(true);
          break;
        case 'token':
          if (typeof event.data['content'] === 'string') {
            appendStreamToken(event.data['content']);
          } else {
            clientLog('warn', 'Dropped malformed token SSE event (non-string content)', event.data);
          }
          break;
        case 'complete': {
          // queryLogId is the query_logs row id — the handle used later by
          // POST /api/query/:queryId/feedback. It's absent (undefined) if the
          // backend's fire-and-forget log write failed; feedback is simply
          // unavailable for that one message in that case.
          pendingQueryLogIdRef.current =
            typeof event.data['queryLogId'] === 'string' ? event.data['queryLogId'] : null;

          // The backend narrows `citations` down to only what the model's
          // generated text actually cited via [N] markers (see
          // filterCitationsByModelOutput in backend/src/services/llm.ts) —
          // distinct from `liveChunks`, which is every chunk retrieval found,
          // set earlier by the 'found' handler. Re-narrow liveChunks to that
          // cited subset here so finalizeStreamingMessage (which reads
          // liveChunks as its single source of truth for the final message's
          // citations) reflects what was actually cited, not just what was
          // searched. Falls back to leaving liveChunks untouched if the field
          // is missing/malformed, matching the backend's own "cited nothing ->
          // show everything retrieved" fallback.
          if (Array.isArray(event.data['citations'])) {
            const citedChunks = safeParseCitations(event.data['citations']);
            const citedChunkIds = new Set(citedChunks.map((c) => c.chunkId));
            useRagStore.setState((state) => ({
              liveChunks: state.liveChunks.filter((c) => citedChunkIds.has(c.chunkId)),
            }));
          }
          break;
        }
        case 'error': {
          const msg =
            typeof event.data['message'] === 'string' ? event.data['message'] : 'Stream error';
          setStreamingError(msg);
          setIsGenerating(false);
          useRagStore.setState({ queryPhase: 'idle' });
          break;
        }
      }
    },
    [appendStreamToken, setStreamingError],
  );

  const handleSSEComplete = useCallback(() => {
    // The streaming assistant message's own `timestamp` is set at creation
    // time in sendQuery (see ragStore.ts), before the query is even
    // submitted — i.e. it already *is* the query's start time. Look it up
    // by role + isStreaming rather than assuming it's always exactly two
    // slots before the end of the array (that positional assumption breaks
    // if the array shape ever changes, e.g. system messages, multi-turn
    // batching).
    const streamingAssistant = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.isStreaming);
    const startTs = streamingAssistant?.timestamp ?? Date.now();
    const latencyMs = Date.now() - startTs;
    finalizeStreamingMessage(latencyMs, pendingQueryLogIdRef.current);
    pendingQueryLogIdRef.current = null;
    setIsGenerating(false);
  }, [finalizeStreamingMessage, messages]);

  const handleSSEError = useCallback(
    (error: Error) => {
      setStreamingError(error.message);
      setIsGenerating(false);
      useRagStore.setState({ queryPhase: 'idle' });
    },
    [setStreamingError],
  );

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

  useFocusTrap(shortcutsPanelRef, {
    open: shortcutsOpen,
    onClose: () => setShortcutsOpen(false),
    lockBodyScroll: false,
  });

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

  const handleSubmit = useCallback(
    (e?: FormEvent): void => {
      e?.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed || isStreaming) return;
      if (trimmed.length < MIN_QUERY_LENGTH) {
        toast.toast(`Question must be at least ${MIN_QUERY_LENGTH} characters`, {
          variant: 'info',
        });
        return;
      }
      const docIds = selectedDocIds.size > 0 ? Array.from(selectedDocIds) : undefined;
      setInputValue('');
      void sendQuery(trimmed, docIds);
    },
    [inputValue, isStreaming, selectedDocIds, sendQuery, toast],
  );

  const handleReQuery = useCallback(
    (query: string) => {
      setInputValue(query);
      setTimeout(() => {
        const docIds = selectedDocIds.size > 0 ? Array.from(selectedDocIds) : undefined;
        void sendQuery(query, docIds);
      }, 0);
    },
    [selectedDocIds, sendQuery],
  );

  // Optimistic update: reflect the rating immediately, revert on API failure.
  const handleFeedback = useCallback(
    (messageId: string, queryLogId: string, feedback: QueryFeedback) => {
      const previous = messages.find((m) => m.id === messageId)?.feedback ?? null;
      setMessageFeedback(messageId, feedback);
      submitQueryFeedback(queryLogId, feedback).catch(() => {
        setMessageFeedback(messageId, previous);
        toast.toast('Could not save feedback — try again', { variant: 'error' });
      });
    },
    [messages, setMessageFeedback, toast],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const fillSuggestion = useCallback((q: string) => {
    setInputValue(q);
    inputRef.current?.focus();
  }, []);

  const toggleDoc = useCallback((id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (all: boolean) => {
      if (all)
        setSelectedDocIds(new Set(documents.filter((d) => d.status === 'ready').map((d) => d.id)));
      else setSelectedDocIds(new Set());
    },
    [documents],
  );

  // Fetches real section headings for content-aware query suggestions,
  // scoped to the selected documents (or all ready documents if none are
  // explicitly selected, matching how an unfiltered query searches the whole
  // corpus). Only worth fetching while the empty-state suggestion buttons are
  // actually visible — no messages sent yet. Falls back to the generic
  // SUGGESTED_QUERIES list (rendered below) when the response is empty or
  // the request fails, so a plain/unstructured knowledge base is never left
  // with no suggestions at all.
  useEffect(() => {
    if (messages.length > 0) return;
    const readyIds = documents.filter((d) => d.status === 'ready').map((d) => d.id);
    const targetIds = selectedDocIds.size > 0 ? Array.from(selectedDocIds) : readyIds;
    if (targetIds.length === 0) {
      setContentSuggestions([]);
      return;
    }
    let cancelled = false;
    getSuggestedTopics(targetIds.slice(0, 10))
      .then((topics) => {
        if (!cancelled) setContentSuggestions(topics);
      })
      .catch(() => {
        if (!cancelled) setContentSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [messages.length, documents, selectedDocIds]);

  // Real section headings formatted as questions, capped to the same count
  // as the generic list so the empty state never grows unpredictably tall.
  const displaySuggestions =
    contentSuggestions.length > 0
      ? contentSuggestions
          .slice(0, SUGGESTED_QUERIES.length)
          .map((topic) => `Tell me about ${topic}`)
      : SUGGESTED_QUERIES;

  const handleStop = useCallback(() => {
    disconnect();
    setIsGenerating(false);
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
      citations: msg.citations?.map((c, i) => ({
        index: i + 1,
        filename: c.documentName,
        chunkIndex: i + 1,
        similarity: c.similarity,
      })),
    }));
    downloadConversation(exportMessages);
  }, [messages]);

  const handleCopyLast = useCallback(() => {
    // Find the last completed assistant message
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && !m.isStreaming);
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
    <div className="flex flex-col md:grid md:grid-cols-[200px_1fr] lg:grid-cols-[240px_1fr] h-full overflow-hidden">
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
        <div
          style={{
            flexShrink: 0,
            maxHeight: '40%',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <QueryHistoryPanel
            entries={historyHook.entries}
            isStreaming={isStreaming}
            onRerun={fillSuggestion}
            onRemove={historyHook.remove}
            onClear={historyHook.clear}
            onSearch={handleHistorySearch}
            searchResults={historySearchResults}
            searchLoading={historySearchLoading}
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
        onSearchHistory={handleHistorySearch}
        historySearchResults={historySearchResults}
        historySearchLoading={historySearchLoading}
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
                  style={{
                    fontSize: '22px',
                    fontWeight: 900,
                    fontStyle: 'italic',
                    color: '#1C1B19',
                  }}
                >
                  Reading Room
                </h1>

                {isConnected && (
                  <span
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: '12px',
                      color: '#2D5A4A',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#2D5A4A',
                        animation: 'pulse 1.5s infinite',
                      }}
                      aria-hidden="true"
                    />
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
                  title={
                    splitScreenEnabled ? 'Disable split-screen mode' : 'Enable split-screen mode'
                  }
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
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<Trash2 size={12} />}
                    onClick={clearChat}
                    aria-label="Clear chat history"
                  >
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
                      ref={shortcutsPanelRef}
                      tabIndex={-1}
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
                        outline: 'none',
                      }}
                      role="dialog"
                      aria-label="Keyboard shortcuts"
                    >
                      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <tbody>
                          <tr>
                            <td
                              style={{
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '12px',
                                color: '#FF4D2E',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Ctrl+K
                            </td>
                            <td
                              style={{
                                fontFamily: "'Space Grotesk', sans-serif",
                                fontSize: '13px',
                                color: '#1C1B19',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Focus query input
                            </td>
                          </tr>
                          <tr>
                            <td
                              style={{
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '12px',
                                color: '#FF4D2E',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Ctrl+Enter
                            </td>
                            <td
                              style={{
                                fontFamily: "'Space Grotesk', sans-serif",
                                fontSize: '13px',
                                color: '#1C1B19',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Send query
                            </td>
                          </tr>
                          <tr>
                            <td
                              style={{
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '12px',
                                color: '#FF4D2E',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Escape
                            </td>
                            <td
                              style={{
                                fontFamily: "'Space Grotesk', sans-serif",
                                fontSize: '13px',
                                color: '#1C1B19',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Clear focused input
                            </td>
                          </tr>
                          <tr>
                            <td
                              style={{
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '12px',
                                color: '#FF4D2E',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Ctrl+Shift+E
                            </td>
                            <td
                              style={{
                                fontFamily: "'Space Grotesk', sans-serif",
                                fontSize: '13px',
                                color: '#1C1B19',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Export conversation
                            </td>
                          </tr>
                          <tr>
                            <td
                              style={{
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '12px',
                                color: '#FF4D2E',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Ctrl+Shift+C
                            </td>
                            <td
                              style={{
                                fontFamily: "'Space Grotesk', sans-serif",
                                fontSize: '13px',
                                color: '#1C1B19',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Copy last answer
                            </td>
                          </tr>
                          <tr>
                            <td
                              style={{
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '12px',
                                color: '#FF4D2E',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Ctrl+H
                            </td>
                            <td
                              style={{
                                fontFamily: "'Space Grotesk', sans-serif",
                                fontSize: '13px',
                                color: '#1C1B19',
                                padding: '4px 8px',
                                verticalAlign: 'top',
                              }}
                            >
                              Toggle query history
                            </td>
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
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '16px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ marginBottom: '8px' }}>
                    <MessageSquare
                      size={36}
                      style={{ color: '#D8D4C8', margin: '0 auto 12px' }}
                      aria-hidden="true"
                    />
                    <h2
                      className="font-display"
                      style={{
                        fontSize: '20px',
                        fontWeight: 900,
                        fontStyle: 'italic',
                        color: '#1C1B19',
                        marginBottom: '8px',
                      }}
                    >
                      Ask about your documents
                    </h2>
                    <p
                      style={{
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontSize: '14px',
                        color: '#8A8578',
                        maxWidth: '380px',
                        lineHeight: '1.6',
                      }}
                    >
                      Select one or more documents from the left panel, then ask a question. The AI
                      will search through your documents and answer based on what it finds.
                    </p>
                  </div>

                  {/* Suggested queries */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      width: '100%',
                      maxWidth: '480px',
                    }}
                  >
                    {displaySuggestions.map((q) => (
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
                <div
                  data-testid="chat-message-list"
                  style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
                  role="list"
                >
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
                    onClick={handleNewConversation}
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
                    {confirmingClear ? 'Sure? Click again' : 'Clear →'}
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
                      background:
                        inputValue.trim().length >= MIN_QUERY_LENGTH ? '#FF4D2E' : '#F0EDEA',
                      color: inputValue.trim().length >= MIN_QUERY_LENGTH ? '#FFFFFF' : '#B8B4AC',
                      border: 'none',
                      padding: '10px 22px',
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor:
                        inputValue.trim().length >= MIN_QUERY_LENGTH ? 'pointer' : 'not-allowed',
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
          <SourcePanel liveChunks={liveChunks} queryPhase={queryPhase} />
        )}
      </div>
    </div>
  );
}

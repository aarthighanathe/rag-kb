/**
 * @file ragStore.ts
 * @description Zustand global store — documents, upload queue, chat, and job polling.
 *   Async actions call the API directly so pages stay thin.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { create } from 'zustand';
import {
  listDocuments,
  deleteDocument as apiDeleteDocument,
  uploadDocument,
  extractErrorMessage,
  initiateQuery,
  getJobStatus,
  TypedApiError,
  type DocumentRecord,
  type QueryRequest,
} from '../services/api';
import { calculateConfidence, type ConfidenceLevel } from '../utils/calculateConfidence';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A single turn in the multi-turn conversation context. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Must match ConversationTurnSchema's content max in backend/src/schemas/query.schema.ts. */
const MAX_HISTORY_CONTENT_LENGTH = 2000;
/** Must match QueryRequestSchema's history max in backend/src/schemas/query.schema.ts. */
const MAX_HISTORY_TURNS = 6;

/** Job status polling interval, in ms. */
const POLL_INTERVAL_MS = 3000;
/**
 * Maximum number of poll ticks before a job is treated as timed out.
 * 200 attempts * 3s = 10 minutes — well beyond the backend document worker's
 * own 5-minute hard per-job timeout (JOB_TIMEOUT_MS in documentWorker.ts),
 * so this cap only ever fires for the pathological case that timeout can't
 * cover: a worker process crashing outright without writing status='failed'.
 */
const MAX_POLL_ATTEMPTS = 200;

/**
 * Appends a turn to conversation history, truncating its content to the
 * backend's max length and trimming the oldest turns beyond the cap.
 * @param history - Current conversation history
 * @param turn - Turn to append
 * @returns New history array, truncated and capped
 */
function appendHistoryTurn(history: ConversationTurn[], turn: ConversationTurn): ConversationTurn[] {
  const safeTurn = turn.content.length > MAX_HISTORY_CONTENT_LENGTH
    ? { ...turn, content: turn.content.slice(0, MAX_HISTORY_CONTENT_LENGTH) }
    : turn;
  const updated = [...history, safeTurn];
  return updated.length > MAX_HISTORY_TURNS ? updated.slice(updated.length - MAX_HISTORY_TURNS) : updated;
}

/** A queued / in-flight / finished upload item. */
export interface UploadItem {
  /** Client-side UUID for React keying. */
  id: string;
  /** Original File reference — needed for actual upload. */
  file: File;
  /** Upload progress 0-100. */
  progress: number;
  /** Lifecycle status. */
  status: 'queued' | 'uploading' | 'processing' | 'ready' | 'failed';
  /** Document UUID returned after a successful upload. */
  documentId?: string;
  /** BullMQ job ID used for polling. */
  jobId?: string;
  /** Human-readable error (failed state only). */
  error?: string;
  /** Date.now() when processing began — used for ETA calculation. */
  processingStartedAt?: number;
  /** File size in bytes — used for ETA calculation. */
  fileSizeBytes: number;
}

/** Source citation attached to an assistant message. */
export interface Citation {
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkRef: string;
  similarity: number;
  excerpt: string;
}

/** Helpfulness rating for a completed assistant answer. Mirrors the backend's query_logs.feedback enum. */
export type MessageFeedback = 'helpful' | 'not_helpful';

/** Single message in the conversation. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  isStreaming?: boolean;
  timestamp: number;
  /** Time in ms from query initiation to final token — set on complete. */
  latencyMs?: number | null;
  /** Original query that produced this answer, used by ReQueryButtons. */
  sourceQuery?: string;
  /**
   * query_logs row id from the SSE `complete` event payload (assistant messages
   * only) — the handle used by POST /api/query/:queryId/feedback. Null/absent
   * when the backend failed to log the query (logQuery errors are swallowed
   * server-side so they never block the response) — feedback is simply
   * unavailable for that one message in that case.
   */
  queryLogId?: string | null;
  /** The user's submitted helpfulness rating for this answer, if any. */
  feedback?: MessageFeedback | null;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

/** Metadata about the most recently completed query, used by Chat.tsx to add to history. */
export interface LastCompletedQuery {
  /** The original query text */
  query: string;
  /** Number of citations returned */
  citationCount: number;
  /** Confidence level derived from citation similarities */
  confidenceLevel: ConfidenceLevel | 'none';
}

export interface RAGStore {
  // ── Documents ──────────────────────────────────────────────────────────────
  documents: DocumentRecord[];
  documentsLoading: boolean;
  documentsError: string | null;
  /** Fetches the full document list from the API and stores it. */
  fetchDocuments: () => Promise<void>;
  /** Deletes a document from the API and removes it from local state. */
  deleteDocument: (id: string) => Promise<void>;

  // ── Upload queue ───────────────────────────────────────────────────────────
  uploadQueue: UploadItem[];
  /** Adds File objects to the queue with status='queued'. */
  addToUploadQueue: (files: File[]) => void;
  /** Uploads all 'queued' items concurrently, tracking progress per item. */
  startUpload: () => Promise<{ succeeded: number; failed: number }>;
  /** Re-queues a failed item by id and immediately retries upload. */
  retryQueueItem: (id: string) => Promise<{ succeeded: number; failed: number }>;
  /** Removes an item from the queue by filename. */
  removeFromQueue: (filename: string) => void;

  // ── Chat ───────────────────────────────────────────────────────────────────
  messages: ChatMessage[];
  currentQuery: string;
  isStreaming: boolean;
  streamingText: string;
  citations: Citation[];
  /** Set by sendQuery; read by Chat page to build the SSE URL. */
  currentQueryId: string | null;
  /**
   * Initiates a RAG query: adds messages, calls initiateQuery, sets currentQueryId.
   * The Chat page then connects to the SSE stream via useSSE.
   */
  sendQuery: (query: string, documentIds?: string[]) => Promise<void>;
  clearChat: () => void;
  setCurrentQuery: (q: string) => void;
  /** Appends a streaming token to the last assistant message. */
  appendStreamToken: (token: string) => void;
  /**
   * Finalises the streaming message, attaches citations, clears stream state.
   * Citations are read from `liveChunks` (set by the SSE 'found' event) rather
   * than being passed in — `liveChunks` is the single source of truth for the
   * current stream's retrieved chunks, so the caller no longer needs to track
   * its own parallel copy just to hand it back at completion.
   */
  finalizeStreamingMessage: (latencyMs: number | null, queryLogId?: string | null) => void;
  /** Marks streaming as failed and appends an error note. */
  setStreamingError: (error: string) => void;
  /**
   * Optimistically sets the feedback rating on a message by id, before the
   * API call resolves. Chat.tsx calls submitQueryFeedback separately and
   * reverts this on failure.
   */
  setMessageFeedback: (messageId: string, feedback: MessageFeedback | null) => void;

  // ── Query history bridge ─────────────────────────────────────────────────
  /** Metadata about the most recently completed query (set by finalizeStreamingMessage, consumed by Chat.tsx). */
  lastCompletedQuery: LastCompletedQuery | null;
  /** Clears lastCompletedQuery after Chat.tsx has processed it. */
  clearLastCompletedQuery: () => void;

  // ── Split-screen mode ────────────────────────────────────────────────────
  /** Whether split-screen mode is active (persisted in localStorage). */
  splitScreenEnabled: boolean;
  /** Toggle split-screen on/off and persist to localStorage. */
  toggleSplitScreen: () => void;
  /** Chunks for the currently streaming query (cleared on new query). */
  liveChunks: Citation[];
  /** SSE phase for SourcePanel state management. */
  queryPhase: 'idle' | 'searching' | 'streaming' | 'complete';

  // ── Conversation history (multi-turn memory) ────────────────────────────────
  /** Last 6 messages (3 user+assistant exchanges) sent to the API. */
  conversationHistory: ConversationTurn[];
  /** Append a turn; trims to last 6 entries (oldest pair removed first). */
  addToHistory: (turn: ConversationTurn) => void;
  /** Clears conversation history — called by clearChat(). */
  clearHistory: () => void;

  // ── Job polling ────────────────────────────────────────────────────────────
  pollingJobs: Record<string, ReturnType<typeof setInterval>>;
  /**
   * Starts polling `getJobStatus` every 3s for a given job/document pair.
   * Safe to call again for a jobId that's already being polled — the prior
   * interval is cleared first (see POLL_INTERVAL_MS/MAX_POLL_ATTEMPTS).
   */
  startPolling: (jobId: string, documentId: string) => void;
  stopPolling: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useRagStore = create<RAGStore>((set, get) => ({
  // ── Documents ──────────────────────────────────────────────────────────────
  documents: [],
  documentsLoading: false,
  documentsError: null,

  fetchDocuments: async () => {
    set({ documentsLoading: true, documentsError: null });
    try {
      const res = await listDocuments(1, 100);
      set({ documents: res.data });
      // Reconcile any queue items whose polling interval died (e.g. dev HMR churn)
      // before it ever saw the backend's completion — the document itself may
      // already be 'ready' or 'failed' even though the queue item is stuck.
      const byId = new Map(res.data.map((d) => [d.id, d]));
      get().uploadQueue.forEach((item) => {
        if (
          (item.status === 'processing' || item.status === 'uploading') &&
          item.documentId
        ) {
          const doc = byId.get(item.documentId);
          if (doc?.status === 'ready') {
            if (item.jobId) get().stopPolling(item.jobId);
            set((state) => ({
              uploadQueue: state.uploadQueue.map((i) =>
                i.id === item.id ? { ...i, status: 'ready' as const, progress: 100 } : i,
              ),
            }));
          } else if (doc?.status === 'failed') {
            if (item.jobId) get().stopPolling(item.jobId);
            set((state) => ({
              uploadQueue: state.uploadQueue.map((i) =>
                i.id === item.id
                  ? { ...i, status: 'failed' as const, error: doc.error_message ?? 'Processing failed' }
                  : i,
              ),
            }));
          }
        }
      });
    } catch (err) {
      set({ documentsError: extractErrorMessage(err, 'Failed to load documents') });
    } finally {
      set({ documentsLoading: false });
    }
  },

  deleteDocument: async (id) => {
    await apiDeleteDocument(id);
    set((state) => ({ documents: state.documents.filter((d) => d.id !== id) }));
  },

  // ── Upload queue ───────────────────────────────────────────────────────────
  uploadQueue: [],

  addToUploadQueue: (files) => {
    const items: UploadItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'queued',
      fileSizeBytes: file.size,
    }));
    set((state) => ({ uploadQueue: [...state.uploadQueue, ...items] }));
  },

  startUpload: async () => {
    const queued = get().uploadQueue.filter((i) => i.status === 'queued');
    let succeeded = 0;
    let failed = 0;

    const updateItem = (id: string, patch: Partial<UploadItem>) =>
      set((state) => ({
        uploadQueue: state.uploadQueue.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      }));

    await Promise.all(
      queued.map(async (item) => {
        updateItem(item.id, { status: 'uploading', progress: 0, error: undefined });
        try {
          const result = await uploadDocument(item.file, (pct) => {
            updateItem(item.id, { progress: pct });
          });
          updateItem(item.id, {
            status: 'processing',
            progress: 100,
            documentId: result.documentId,
            jobId: result.jobId,
            processingStartedAt: Date.now(),
          });
          get().startPolling(result.jobId, result.documentId);
          succeeded += 1;
        } catch (err) {
          failed += 1;
          updateItem(item.id, {
            status: 'failed',
            error: extractErrorMessage(err, 'Upload failed'),
          });
        }
      }),
    );

    return { succeeded, failed };
  },

  retryQueueItem: async (id) => {
    set((state) => ({
      uploadQueue: state.uploadQueue.map((i) =>
        i.id === id
          ? { ...i, status: 'queued' as const, progress: 0, error: undefined, processingStartedAt: undefined }
          : i,
      ),
    }));
    return get().startUpload();
  },

  removeFromQueue: (filename) =>
    set((state) => ({
      uploadQueue: state.uploadQueue.filter((i) => i.file.name !== filename),
    })),

  // ── Chat ───────────────────────────────────────────────────────────────────
  messages: [],
  currentQuery: '',
  isStreaming: false,
  streamingText: '',
  citations: [],
  currentQueryId: null,
  lastCompletedQuery: null,
  liveChunks: [],
  queryPhase: 'idle' as const,

  // ── Split-screen init from localStorage ─────────────────────────────────
  splitScreenEnabled: (() => {
    try { return localStorage.getItem('rag-kb:split-screen') === 'true'; } catch { return false; }
  })(),

  sendQuery: async (query, documentIds) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: Date.now(),
      sourceQuery: query,
    };

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      currentQuery: query,
      isStreaming: true,
      streamingText: '',
      citations: [],
      currentQueryId: null,
      queryPhase: 'searching' as const,
      liveChunks: [],
    }));

    // Compute the prospective history (current turn included) without
    // committing it to state yet — only persisted on success, so a failed
    // request doesn't leave an orphaned turn for the next retry to inherit.
    const prospectiveHistory = appendHistoryTurn(get().conversationHistory, { role: 'user', content: query });

    // matchCount and similarityThreshold must match backend QueryRequestSchema field names
    const request: QueryRequest = {
      query,
      documentIds,
      matchCount: 5,
      // Scores are clamped to [0, 1] by the SQL GREATEST() fix. Default of 0
      // means no floor — matchCount (top-K) bounds context size instead.
      similarityThreshold: 0,
      // Send prospective history (includes the current user turn, trimmed to 6)
      history: prospectiveHistory,
    };
    try {
      const { queryId } = await initiateQuery(request);
      set({ currentQueryId: queryId, conversationHistory: prospectiveHistory });
    } catch (err) {
      get().setStreamingError(err instanceof Error ? err.message : 'Failed to initiate query');
    }
  },

  clearChat: () => {
    get().clearHistory();
    set({ messages: [], currentQuery: '', isStreaming: false, streamingText: '', citations: [], currentQueryId: null });
  },

  setCurrentQuery: (q) => set({ currentQuery: q }),

  appendStreamToken: (token) => {
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        messages[messages.length - 1] = { ...last, content: last.content + token };
      }
      return { messages, streamingText: state.streamingText + token };
    });
  },

  finalizeStreamingMessage: (latencyMs, queryLogId = null) => {
    set((state) => {
      const citations = state.liveChunks;
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        messages[messages.length - 1] = { ...last, isStreaming: false, citations, latencyMs, queryLogId };
        // Add the completed assistant turn to conversation history
        get().addToHistory({ role: 'assistant', content: last.content });
      }

      // Find the user query text (the message just before the assistant message)
      const userMsg = messages.length >= 2 ? messages[messages.length - 2] : null;
      const queryText = userMsg?.role === 'user' ? userMsg.content : state.currentQuery;

      // Calculate confidence from citation similarities
      const similarities = citations.map((c) => c.similarity);
      const confidence = calculateConfidence(similarities);

      return {
        messages,
        isStreaming: false,
        citations,
        currentQueryId: null,
        queryPhase: 'complete' as const,
        lastCompletedQuery: {
          query: queryText,
          citationCount: citations.length,
          confidenceLevel: confidence.level,
        },
      };
    });
  },

  setStreamingError: (error) => {
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + `\n\n⚠️ ${error}`,
          isStreaming: false,
        };
      }
      return { messages, isStreaming: false, currentQueryId: null };
    });
  },

  setMessageFeedback: (messageId, feedback) => {
    set((state) => ({
      messages: state.messages.map((m) => (m.id === messageId ? { ...m, feedback } : m)),
    }));
  },

  // ── Query history bridge ─────────────────────────────────────────────────
  clearLastCompletedQuery: () => set({ lastCompletedQuery: null }),

  // ── Split-screen mode ────────────────────────────────────────────────────
  toggleSplitScreen: () => {
    set((state) => {
      const next = !state.splitScreenEnabled;
      try { localStorage.setItem('rag-kb:split-screen', String(next)); } catch { /* ignore */ }
      return { splitScreenEnabled: next };
    });
  },

  // ── Conversation history ────────────────────────────────────────────────────
  conversationHistory: [],

  addToHistory: (turn) => {
    set((state) => ({ conversationHistory: appendHistoryTurn(state.conversationHistory, turn) }));
  },

  clearHistory: () => set({ conversationHistory: [] }),

  // ── Job polling ────────────────────────────────────────────────────────────
  pollingJobs: {},

  startPolling: (jobId, documentId) => {
    // A prior interval for this exact jobId (e.g. from a component remount or
    // a racing upload-start path) must be cleared before starting a new one —
    // otherwise the original interval is orphaned (overwritten in
    // pollingJobs but never cleared) and keeps firing every 3s forever.
    const existing = get().pollingJobs[jobId];
    if (existing !== undefined) clearInterval(existing);

    let pollCount = 0;

    const intervalId = setInterval(async () => {
      pollCount += 1;

      const patch = (p: Partial<UploadItem>) =>
        set((state) => ({
          uploadQueue: state.uploadQueue.map((i) =>
            i.jobId === jobId ? { ...i, ...p } : i,
          ),
        }));

      // Cap total polling duration — a worker that crashes without writing
      // status='failed' would otherwise leave getJobStatus returning 'active'
      // indefinitely, and this interval would poll every 3s for the tab's
      // entire lifetime with no user-facing signal. The backend's own hard
      // per-job timeout is 5 minutes (JOB_TIMEOUT_MS in documentWorker.ts);
      // MAX_POLL_ATTEMPTS gives it comfortable headroom beyond that before
      // the frontend gives up and surfaces a timeout to the user.
      if (pollCount > MAX_POLL_ATTEMPTS) {
        get().stopPolling(jobId);
        patch({ status: 'failed', error: 'Processing timed out — please try again' });
        return;
      }

      try {
        // Poll document status (public endpoint) rather than admin-only queue endpoint
        const status = await getJobStatus(documentId);

        if (status.state === 'completed') {
          get().stopPolling(jobId);
          patch({ status: 'ready' });
          // Refresh the documents list so the new doc appears
          void get().fetchDocuments();
        } else if (status.state === 'failed') {
          get().stopPolling(jobId);
          patch({ status: 'failed', error: status.error ?? 'Processing failed' });
        } else if (status.state === 'active') {
          patch({ progress: status.progress });
        }
      } catch (err) {
        // A 404 means the document was deleted mid-poll — this is permanent,
        // not a transient network blip, so stop immediately instead of
        // retrying for up to MAX_POLL_ATTEMPTS (~10 minutes).
        if (err instanceof TypedApiError && err.statusCode === 404) {
          get().stopPolling(jobId);
          patch({ status: 'failed', error: 'Document was deleted' });
          return;
        }
        // Ignore other (transient) polling errors — retry next tick
      }
    }, POLL_INTERVAL_MS);

    set((state) => ({
      pollingJobs: { ...state.pollingJobs, [jobId]: intervalId },
    }));
  },

  stopPolling: (jobId) => {
    const { pollingJobs } = get();
    const id = pollingJobs[jobId];
    if (id !== undefined) clearInterval(id);
    set((state) => {
      const next = { ...state.pollingJobs };
      delete next[jobId];
      return { pollingJobs: next };
    });
  },
}));

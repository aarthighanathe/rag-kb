# RAG Knowledge Base — Feature Reference

> Last updated: 2026-07-23 (production-readiness fixes applied)
> Stack: React 19 + Vite + TypeScript · Express 5 · Supabase pgvector ·
> BullMQ + Redis · Groq API · HuggingFace Embeddings · Clerk (Google OAuth)

## Status Legend
- ✅ Implemented and working
- 🔶 Partially implemented (note what's missing)
- ❌ Scaffolded but not functional
- 🔲 Planned but not started

---

## 1. Document Ingestion

### 1.1 File Upload
Status: ✅

How it works:
- Client sends `multipart/form-data` to `POST /api/upload` with field name `files` (up to 5 files).
- `multer` (memory storage) applies a MIME allowlist (`fileFilter`) and per-file/total limits before the handler runs.
- `UploadRequestSchema` (Zod) re-validates the parsed file array (count 1–5, mimetype enum, size ≤ `MAX_FILE_SIZE_MB`).
- Each file passes through `validateFile()` (see §1.1.1) for magic-byte and filename security checks.
- A `documentId` (UUID) is generated, the file is written to `backend/uploads/{documentId}_{sanitizedName}`, and a `documents` row is inserted with `status: 'pending'`.
- A BullMQ job is enqueued (`jobId = documentId`) and the HTTP response returns immediately with `{id, filename, status: 'pending', jobId}` per file — processing happens asynchronously.
- The temp file on disk is deleted by the worker after processing completes or fails (`cleanupFile`).
- Each file in a batch is processed independently (`Promise.allSettled`), so one file failing validation or storage does not discard files that already succeeded. If every file in the batch fails, the response is a single error via the standard error pipeline; if only some fail, the response is `207 Multi-Status` with `data.documents` (the succeeded files) and `data.errors` (an array of `{filename, message}` for the failed ones).
- **Rollback on partial failure**: if `createDocument` fails after the file has already been written to disk, the temp file is deleted before the error propagates. If `addDocumentJob` fails after the DB row was already created (e.g. a transient Redis blip), both the `documents` row and the temp file are rolled back in reverse order — so a mid-sequence failure never leaves an orphaned `'pending'` row with no queue job ever created to process or clean it up. Rollback failures are logged as warnings and never mask the original error.

API: `POST /api/upload`
Accepted types: PDF, DOCX, TXT, MD
Size limit: per-file cap driven by `MAX_FILE_SIZE_MB` (default 10 MB) — multer's limit, the file-validation pipeline, and the Zod request schema all read the same env-configured value, so raising the env var raises the effective limit everywhere consistently.
Max files per request: 5
Validation: multer MIME allowlist → Zod schema → magic bytes → filename security
Response codes: `200` (all files succeeded), `207` (partial success — see above), `4xx/5xx` (all files failed, or request-level validation failed before per-file processing began)

#### 1.1.1 File Validation Pipeline
Status: ✅

How it works:
1. **Size check** — rejects if larger than `MAX_FILE_SIZE_MB`.
2. **Filename security** — rejects embedded script patterns (`<script`, `javascript:`, `onload=`, etc.), null bytes, path traversal (`..`, `/`, `\`), and double-extension attacks: only the final extension and the one immediately preceding it are checked against the dangerous-extension set (`.exe`, `.js`, `.sh`, etc.), so `malware.pdf.exe` is caught while a benign filename with an unrelated word elsewhere (e.g. `my.js.notes.txt`) is not falsely rejected.
3. **Extension resolution** — maps `.pdf/.docx/.txt/.md(.markdown)` to an internal file type; anything else is rejected.
4. **Magic-byte check** — PDF must start with `%PDF` (`0x25504446`); DOCX must start with the ZIP local-file-header signature `PK\x03\x04` (`0x504B0304`); TXT/MD are validated as well-formed UTF-8.
5. **Zip bomb detection (DOCX only)** — parses raw ZIP local file headers without decompressing; rejects if any entry's uncompressed:compressed ratio exceeds 100:1, cumulative uncompressed size exceeds 500 MB (scans up to 1000 entries), or an entry uses a streaming data descriptor (general-purpose bit 3 — sizes reported as 0 in the local header, real sizes only available after decompression) since that entry's true compressed length can't be read without risking a desynced parse of the rest of the archive. A deeply nested recursive zip-in-zip bomb that lies in its own headers can still bypass this check (documented residual risk).
6. The filename is sanitized (basename only, unsafe characters replaced with `_`, length capped at 255) before being used in the storage path.

### 1.2 Document Processing Queue
Status: ✅

How it works:
- BullMQ queue named `document-processing`, backed by Redis (`REDIS_URL`).
- Triggered by the upload route enqueuing a `process-document` job with `{documentId, filePath, fileType, originalName, correlationId}`.
- Worker concurrency is fixed at **1** — deliberately serialized so concurrent jobs don't exhaust the HuggingFace free-tier rate limit.
- Each job has a 5-minute hard timeout (custom `Promise.race`-based, not BullMQ's native timeout), with the BullMQ lock duration set to 5.5 minutes to give the timeout a grace window before the job is reassigned.
- Progress is reported via `job.updateProgress()` at four checkpoints: 20% (text extracted), 40% (chunked), 70% (embedded), 90% (stored), 100% (finished).
- On failure at any step, the document's `status` is set to `failed` with an `error_message`, the temp file is cleaned up, and BullMQ retries the job per the backoff policy below.
- On success, status is set to `ready` (via `updateChunkCount`, then redundantly again via `updateDocumentStatus`), and the temp upload file is deleted.
- If a job outlives its 5-minute hard timeout, the in-flight processing call is not forcibly cancelled (Node has no way to abort arbitrary in-flight work) — but a real per-attempt `AbortSignal` (`backend/src/queues/cancellation.ts`) is checked before every write-performing pipeline call (`embedBatch`, `upsertChunks`, `updateChunkCount`, `updateDocumentStatus`), so a slow run that loses the timeout race stops at its next checkpoint instead of overwriting whatever a subsequent retry of the same document has already produced.
- **Terminal-failure backstop**: the worker's `failed` event handler checks whether `job.attemptsMade` has reached the configured `attempts` ceiling; if so, it explicitly writes `status='failed'` there as well. This covers the one case the per-attempt cancellation path can't: a `JobCancelledError` on the *final* attempt (e.g. its own timeout fires with no retry left to supersede it) deliberately skips writing status to avoid clobbering a live retry — but with attempts exhausted there is no live retry, so without this backstop the document would stay `'processing'` forever with nothing shown to the user.
- **Delete verifies ownership before touching the queue**: `DELETE /api/documents/:id` first calls `getDocument(id, userId)` — which 404s on a mismatched owner exactly like every other per-user lookup in `vectorStore.ts` — before calling `cancelDocumentJob(documentId)` or the SQL delete. This closes an IDOR window where a caller who merely knew/guessed another user's `documentId` could cancel that user's in-flight processing job ahead of the ownership check.
- **Delete cancels in-flight processing**: `cancelDocumentJob` aborts an active attempt's `AbortSignal` if one is running (stopping it at its next checkpoint before any further HuggingFace call or DB write), or removes the job outright if it's still waiting/delayed in the queue. If the job is `'active'` in Redis but hasn't registered its abort controller yet (a narrow startup race between the worker claiming the job and its `beginAttempt()` call), cancellation retries the in-process abort a few times (50ms/150ms/300ms) before giving up and logging a warning — rather than silently no-op'ing and letting the worker fully process a document that's about to be deleted. Best-effort: a cancellation failure is logged but never blocks the delete itself.
- **Empty/unparseable documents fail fast, not after 3 doomed retries**: `createChunks` producing zero chunks throws BullMQ's `UnrecoverableError` instead of a plain `Error` — since re-processing the same empty/corrupt file deterministically fails every time, BullMQ skips the remaining retry attempts and the document reaches `'failed'` status immediately instead of after ~3 rounds of exponential backoff.
- **A cancellation racing job start can no longer crash out uncaught**: the initial `updateDocumentStatus(..., 'processing', ...)` write now runs inside the same try/catch as the rest of the pipeline (it previously ran before the `try` block), so a signal already aborted at that exact instant throws `JobCancelledError` through the normal handled path instead of propagating uncaught to BullMQ's `'failed'` event and writing a `'failed'` status over what should be a clean cancelled exit.

Queue: BullMQ + Redis
Worker concurrency: 1 (serialized — protects the HuggingFace free-tier quota)
Retries: 3 attempts, exponential backoff starting at 1000 ms (BullMQ `backoff: {type: 'exponential', delay: 1000}`), except deterministic failures (empty/unparseable documents) which are marked unrecoverable and skip retry entirely
Job retention: last 100 completed jobs, last 50 failed jobs kept (`removeOnComplete`/`removeOnFail`)

Known gap: there is no Bull Board (or equivalent) monitoring dashboard. The worker uses its own `completed`/`failed`/`error` listeners for job lifecycle tracking; `GET /api/queue/status` and `GET /api/queue/job/:jobId` (admin-only) are the only way to inspect queue state today.

### 1.3 Text Extraction
Status: ✅

How it works:
- PDF: `pdf-parse` (dynamic import) extracts raw text; output is sanitized to strip NUL bytes and unpaired UTF-16 surrogates.
- DOCX: `mammoth.extractRawText` (dynamic import) extracts raw text; parser warnings are logged.
- TXT: line endings are normalized; no further transformation.
- MD: a regex-based stripper removes fenced/inline code, ATX headers, converts images/links to their text, strips bold/italic markers and list/blockquote markers, and collapses excess blank lines.
- Extraction errors are wrapped in a `ChunkingError` (`CHUNKING_PARSE_FAILED` / `CHUNKING_UNSUPPORTED_FORMAT`, default HTTP 422 if surfaced via API).

### 1.4 Chunking
Status: ✅

How it works:
- The active strategy (`createChunks`, used by the worker) is hierarchical and token-aware: it splits on a separator hierarchy (`\n\n` → `\n` → `. ` → ` `), recursively re-splitting any segment that still exceeds the token budget. The recursive-split threshold is the caller's actual configured `chunkSize` (threaded through from `createChunks` into `splitByHierarchy`'s `maxTokens` parameter), not a hardcoded constant — a custom `chunkSize` now genuinely changes how eagerly oversized segments are re-split.
- Each chunk's `char_start`/`char_end` metadata is resolved by directly locating that chunk's segments in the original source text (`resolveSegmentSpans`, run once per document via a monotonically-advancing cursor), not reconstructed from the length of the re-joined, whitespace-collapsed chunk text — so both offsets always point at the chunk's true position in the source document even across paragraph breaks, irregular whitespace, or verbatim-repeated segments.
- Token count is estimated as `Math.ceil(text.length / 4)` (approximation of ~4 characters per token).
- `extractText`/`createChunks` is the only chunking path in the module — a previously-retained legacy character-based chunker (`chunkText`/`parseDocument`) with no production call sites has been removed, along with its dedicated test coverage, so the module has one obvious chunking path.
- Chunks are inserted via an idempotent upsert keyed on `(document_id, chunk_index)`, so retried jobs don't create duplicates.

Config: chunk_size = 512 tokens, overlap = 50 tokens, separator hierarchy = `['\n\n', '\n', '. ', ' ']`

### 1.5 Embedding
Status: ✅

How it works:
- Calls the HuggingFace Inference router (`POST https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction`) with `Authorization: Bearer ${HUGGINGFACE_TOKEN}` and `wait_for_model: true`.
- Texts are embedded in batches of 32, with a 200 ms pause between batches to stay under free-tier rate limits.
- Each request has a 30-second timeout (`AbortController`) and makes a single attempt per batch — retry for transient HuggingFace failures is BullMQ's job-level concern (3 attempts, exponential backoff; see §1.2), not this module's. A prior in-module 3-attempt retry loop was removed because it compounded with the job-level retry (3 job retries × 3 batch retries × N batches, each burning up to the 30s request timeout while the single-concurrency worker sat blocked).
- Every returned vector is validated to be exactly 384 dimensions of finite numbers before being accepted; an invalid vector throws an `EmbeddingError`.
- Chunks are inserted into `document_chunks` immediately after chunking with a `NULL` embedding, then updated in place once the embedding step completes — this lets the worker checkpoint progress.

Model: `sentence-transformers/all-MiniLM-L6-v2`
Dimensions: 384
Batch size: 32

---

## 2. Vector Storage

### 2.1 Supabase pgvector Schema
Status: ✅

Tables:
- **documents** — `id` (UUID PK), `filename` (server storage key, UUID-prefixed), `original_name` (user-visible name), `file_type` (CHECK in pdf/txt/md/docx), `file_size_bytes`, `status` (CHECK in pending/processing/ready/failed), `chunk_count`, `error_message`, `metadata` (JSONB), `created_at`, `updated_at` (auto-stamped by a trigger on every UPDATE).
- **document_chunks** — `id` (UUID PK), `document_id` (FK → documents, `ON DELETE CASCADE`), `chunk_index`, `content`, `embedding` (`vector(384)`, nullable until embedded), `token_count`, `metadata` (JSONB), `created_at`. `UNIQUE (document_id, chunk_index)` enables idempotent upserts on retry.
- **query_logs** — `id`, `query_text`, `retrieved_chunk_ids` (UUID[]), `response_preview`, `latency_ms`, `feedback` (nullable, CHECK in helpful/not_helpful — see §4.10), `created_at`. Written by `vectorStore.logQuery()`, awaited by the SSE query handler immediately before the `complete` event is emitted (not fire-and-forget — the client needs the inserted row's `id` in that event's payload to later submit feedback); a logging failure is caught, warn-logged, and surfaces as an absent `queryLogId` in that payload rather than blocking or failing the response.

Index: `idx_chunks_embedding_cosine` — IVFFlat (`vector_cosine_ops`, `lists = 100`), chosen over HNSW for lower memory footprint on Supabase's free/pro tiers and faster O(n) build time at the project's expected scale (<100k chunks). A GIN trigram index (`idx_chunks_content_trgm`) also exists on chunk content for fuzzy keyword search, but no application code currently queries it (no `ILIKE`/`similarity()` calls found).
Similarity function: cosine similarity, computed as `1.0 - (embedding <=> query_embedding)` using pgvector's `<=>` cosine-distance operator.
RPC: `match_chunks(query_embedding vector(384), match_count int = 5, similarity_threshold float = -1, filter_document_ids uuid[] = NULL)` → returns `(id, document_id, content, metadata, filename, similarity)`, filtered to `documents.status = 'ready'` and non-null embeddings, ordered by ascending cosine distance, optionally restricted to a caller-supplied document ID list. `similarity_threshold` defaults to `-1` (no real floor) because `all-MiniLM-L6-v2` is not tuned for asymmetric question/passage retrieval — legitimate matches can score anywhere from slightly negative to ~0.3, so `match_count` (top-K) is what actually bounds result size. The returned `filename` column is `documents.original_name`, not the UUID-prefixed storage key, so citations never leak internal storage paths.
`similaritySearch` runs a lightweight runtime shape check on every row the RPC returns (mirroring `embedder.ts`'s `isEmbeddingArrayShape` guard for the analogous external-response boundary) — rows missing/null on any required field are dropped with a logged warning rather than flowing through to `extractCitations`/`buildContextString` and producing a corrupted citation or broken prompt with no error raised anywhere.

Row Level Security is enabled on all three tables. The backend's `service_role` key bypasses RLS by design; per-user isolation for the API is enforced in application code (`vectorStore.ts` filters every query by `user_id`), with `authenticated`-role RLS policies as a second layer for direct Postgres-JWT access. See §9 for the full authentication and isolation model.

---

## 3. Query and Retrieval

### 3.1 Query Flow
Status: ✅

How it works:
- `POST /api/query` validates the request body (`query` 3–1000 chars, optional `documentIds` up to 10, `matchCount` 1–10 default 5, `similarityThreshold` 0..1 default 0, `history` up to 6 turns) and stores it in an in-memory map keyed by a generated `queryId`, with a 2-minute TTL. The route returns `{queryId}` immediately — it does not start the LLM call itself. The Zod schema trims the query *before* enforcing the 3-character minimum (`.transform(trim).pipe(min(3))`), not after — a whitespace-only query (e.g. three space characters) is now correctly rejected with a 400 instead of passing validation and trimming to empty deep in the pipeline.
- A background sweep (`setInterval`, once a minute, `unref()`'d so it never blocks shutdown) evicts expired entries from this map independent of whether `GET /stream` is ever called — a client that posts queries without ever opening the SSE stream can no longer grow this process-local map without bound.
- The client then opens an SSE connection to `GET /api/query/stream?queryId=...`, which claims (but does not delete) the pending query from the map; a missing/expired ID returns a standard 404 `NotFoundError`. The entry is only deleted once the stream reaches a genuine terminal outcome (`complete`, `error`, or the 60s timeout) — a client that reconnects after a mid-stream drop (`useSSE.ts`'s exponential-backoff retry) re-claims the same still-live entry and restarts retrieval + generation from scratch, rather than 404ing on the retry. There is no server-side token buffer, so a reconnect re-runs the pipeline instead of resuming a partial answer.
- The query text is sanitized (`sanitizeQueryText` — strips HTML tags and null bytes, normalizes whitespace, truncates to 2000 chars) before being embedded.
- The sanitized query is embedded via the same HuggingFace model used for documents, then passed to the `match_chunks` RPC along with `matchCount`, `similarityThreshold`, and the optional document-ID filter.
- When `documentIds` filters to more than one document, `match_chunks` caps how many chunks any single document may contribute to the candidate pool (`ceil(matchCount / number of selected documents)`) before ranking by similarity and taking the top `matchCount` overall. This prevents a large or topically-generic document from filling every slot and silently excluding the other documents the user explicitly selected. An unfiltered search (or a single selected document) is unaffected — it remains a pure top-K similarity search across the whole ready corpus.
- If zero chunks are returned, the stream emits a `complete` event with empty citations and ends — the LLM is never called in this case.
- The client-connection state is checked both after the embedding call and again immediately after vector search returns, before the (costly) LLM call is triggered — a client that disconnects while search is in flight no longer causes a full Groq streaming call whose output would just be discarded.
- Before every `complete` event, the query is logged to `query_logs` (query text, retrieved chunk IDs, a 200-char response preview, and total latency) and the inserted row's `id` is included in the `complete` payload as `queryLogId` — this is the handle the client later uses for `POST /api/query/:queryId/feedback` (§4.10), since the pending-query UUID above is deleted the moment the stream starts and can't serve as a durable reference. The insert is awaited (not fire-and-forget) so `queryLogId` is available before the event is sent; a logging failure is caught and warn-logged, and `queryLogId` is simply omitted from the payload rather than blocking or failing the response.

### 3.2 LLM Answer Generation
Status: ✅

How it works:
- Uses the Groq SDK with model `llama-3.1-8b-instant`, `temperature: 0.1`, `max_tokens: 1024`, `stream: true`.
- The system prompt instructs the model to answer only from the provided context, admit when the context doesn't contain the answer, cite sources using the bracketed number shown before each passage (e.g. `[1]`, `[2]`), stay concise, and never hallucinate.
- Conversation history is capped to the most recent 3 exchanges (6 messages) and folded into a single labeled user message inserted between the system prompt and the context message — rather than spliced into the message array under each turn's own claimed role. The client fully controls `history`, including any turn it labels `assistant`; with no server-side session store there's no way to verify a claimed prior turn is genuine. Rendering the whole block as explicitly-untrusted context (the wrapper text states it is not a set of instructions and not the assistant's own verified prior statements) means nothing in the actual Groq message array carries `role: 'assistant'` unless it came from this turn's own live completion — closing off a prompt-injection vector where a forged `assistant` turn would otherwise be weighted by the model as its own authoritative prior claim.
- Retrieved chunks are formatted as `[N] (source: filename)\n{content}` blocks (1-indexed in retrieval order) joined by `\n\n---\n\n` and sent as a single user message, followed by a final user message containing the raw query text. This numbering matches the order `extractCitations()` returns, so citation `[N]` in the model's answer always corresponds to `citations[N-1]` on the response payload — the same convention `parseCitationText` parses into interactive `CitationMarker` components in both the streaming and completed-message views (§4.4).
- The Groq stream is consumed token-by-token; each token is forwarded to the client as an SSE `token` event, and the full assembled text is delivered via `complete`.

Model: `llama-3.1-8b-instant` (Groq)
Context window: up to `matchCount` chunks (default 5, max 10) per query, plus up to 3 prior exchanges (6 messages) of history
Streaming: SSE via `GET /api/query/stream?queryId=...`, event sequence `searching → found → generating → token* → complete` (or `error` at any point); a 60-second server-side hard timeout ends the stream if no completion occurs. On timeout, the underlying Groq request is actually aborted (via an `AbortController` signal passed into the Groq SDK call), not just disconnected from client-side — a slow upstream stream stops consuming tokens once the client has been told it timed out. The same `AbortController` is also aborted the instant the client disconnects (`req.on('close', ...)`), which covers both a dropped connection and the user clicking "Stop" (which closes the client's `EventSource`) — previously only the 60s timeout was wired to the abort controller, so every Stop click or dropped connection still burned the full Groq completion server-side (wasted tokens/cost) even though the UI showed the stream as cancelled. All `res.end()` calls in the stream handler (including the timeout path, `onComplete`, and `onError`) route through a single `isConnected`-guarded helper, so a Groq stream that finishes just after the timeout fires can never trigger a duplicate `res.end()` or an unnecessary `query_logs` write for a request already told it had timed out. A server-sent `error` event is treated as terminal on the client (`useSSE.ts` marks the connection complete and closes it), so the native `EventSource` `onerror` that follows the backend closing the response doesn't trigger a futile reconnect against an already-finished stream.

### 3.3 Multi-turn Conversation Memory
Status: ✅

How it works:
- History is stored client-side only, in the Zustand store's `conversationHistory` array, capped to the last 6 entries (3 user/assistant exchanges) — older turns are trimmed, and each turn's content is truncated to 2000 characters to match the backend's `ConversationTurnSchema` limit.
- On every query submission, the current user turn is appended to a prospective history array (truncated and capped) and sent to the backend as the `history` field of the query request; the backend does not persist conversation state between requests (the in-memory pending-query map is keyed per query, not per session). The prospective array is only committed to the store once the request succeeds, so a rejected or failed submission does not leave an orphaned turn behind for the next retry to inherit.
- The assistant's turn is added to history once the full streamed response completes.
- The query input enforces the backend's 3-character minimum client-side (disabled send button plus a toast on submit attempts below the threshold), so undersized queries never reach the API.
- "New conversation" requires two clicks within 2 seconds (a confirm-toggle button) before clearing both the chat messages and the history array. A "Clear →" link on the thread-turn-count pill performs the same clear without the confirmation step.

---

## 4. Chat Utilities

### 4.1 Copy Answer as Markdown
Status: ✅

How it works:
- Every completed assistant message displays a "Copy" button on hover (absolute positioned at top-right of the message container).
- Clicking the button formats the answer text as clean Markdown with citations formatted as `[1]`, `[2]` footnotes at the bottom.
- Output format: `[The full answer text with citation numbers preserved inline as [1], [2]]\n\n---\n\nSources:\n[1] filename.pdf · Chunk 3 · Similarity: 94%\n[2] other_doc.txt · Chunk 7 · Similarity: 81%`
- Unicode superscript characters (①②) are normalized to standard `[N]` markdown footnote refs — the marker regex and the superscript-to-number conversion are shared via `frontend/src/utils/citationMarkers.ts` (`CITATION_MARKER_REGEX`, `superscriptToNumber`, `normalizeCitationMarkers`), the single source of truth also used by `exportConversation.ts`, `formatAnswerMarkdown.ts`, and `parseCitationText.tsx` — previously each of the three duplicated the same regex/arithmetic independently.
- If citations array is empty, the Sources section and separator line are omitted.
- Similarity scores are formatted as integer percentages (rounded to 0 decimal places).
- The button shows a success state (green border/color, Check icon, "Copied!" tooltip) for 1500ms after a successful copy.
- If clipboard API fails, a toast notification appears: "Copy failed — try selecting text manually".
- The button is only rendered on completed assistant messages (not during streaming, not on user messages).
- Keyboard accessible with Tab navigation and Enter/Space activation.

### 4.2 Export Full Conversation
Status: ✅

How it works:
- An "Export →" button in the Chat page top bar downloads the entire conversation as a single clean Markdown file.
- Filename format: `rag-kb-conversation-[YYYY-MM-DD].md`
- File contents include a header with export timestamp, all messages in order with role labels ("**You:**" for user, "**Knowledge Base:**" for assistant), and each answer's citations as footnotes immediately below that answer.
- Assistant messages with citations include a blockquote Sources section: `> Sources:\n> [1] filename · Chunk N · X% match`
- Multiple message exchanges are separated by `---` lines.
- The export uses `URL.createObjectURL` with a Blob for client-side download — no server round-trip needed.
- The button is disabled (opacity 0.4, cursor not-allowed) when no messages exist.
- On mobile (≤480px), the button collapses to icon-only (DownloadIcon) with a 44x44px minimum tap target.

### 4.3 Keyboard Shortcuts
Status: ✅

How it works:
- Global keyboard shortcuts are registered via a custom React hook (`useKeyboardShortcuts`) that attaches to window keydown events.
- Shortcuts are disabled during streaming to prevent interference with active responses.
- Shortcuts do not fire when typing in unrelated input fields (checks target tagName and data-testid).
- Available shortcuts:
  - `Cmd/Ctrl + K`: Focus the query input
  - `Cmd/Ctrl + Enter`: Send current query (if input has content)
  - `Escape`: Clear query input (if focused and has content)
  - `Cmd/Ctrl + Shift + E`: Export conversation (if messages exist)
  - `Cmd/Ctrl + Shift + C`: Copy last assistant answer as Markdown — routed through `ChatLayoutContext`, which the last (non-streaming) `AssistantMessage` registers its own copy handler into (`registerLastMessageCopyHandler`/`copyLastMessage`), so the shortcut invokes that handler directly rather than querying the DOM for a copy button to click
  - `Cmd/Ctrl + H`: Toggle the sources/query-history panel (opens on mobile; already visible on desktop)
- Modifier matching lowercases `event.key` before comparison, since holding Shift changes letters like `e`/`c` to uppercase `E`/`C` in the raw keyboard event.
- `Cmd/Ctrl + K` and `Cmd/Ctrl + H` overlap with reserved browser shortcuts (address bar search / history) in some browsers; `preventDefault()` is called but behavior can still vary by browser/OS.
- UI hints are displayed below the textarea on desktop only (hidden ≤768px): "Ctrl+Enter to send · Ctrl+K to focus · Ctrl+Shift+E to export · Ctrl+H history"
- A "?" button in the Chat top bar opens a dropdown panel showing all shortcuts in a two-column table (key combination, action description).
- The shortcut panel closes on click outside or Escape key press.

### 4.4 Citation Interactivity (Chunk Peek)
Status: ✅

How it works:
- Hovering/focusing a citation marker [N] in an answer:
  → Highlights the corresponding IndexCard with archive.green border
  → Highlights the cited text span with yellow background
  → Shifts the relevance stamp from red to green
- Clicking a citation marker:
  → Scrolls the corresponding IndexCard into view
  → Triggers a pulse animation on the card
- Hovering an IndexCard:
  → Highlights citation markers that reference it
  → Highlights the cited text span
- State is scoped per message — interactions don't cross messages
- All interactions disabled while answer is streaming
- Touch devices: tap replaces hover, auto-resets after 2s
- Respects prefers-reduced-motion (pulse animation disabled)
- The completed-message view renders through `ReactMarkdown`; citation markers inside it are produced by a `CitationText` leaf component that reads active-citation state from a small local `MarkdownCitationContext` rather than from `components` props, so hovering a marker only re-renders that leaf instead of forcing `ReactMarkdown` to discard and rebuild its whole output tree.

### 4.5 Confidence Indicator
Status: ✅

How it works:
- A horizontal confidence bar renders below each completed assistant message (hidden during streaming).
- Confidence is calculated as the average similarity score across all retrieved citations.
- Thresholds tuned for `all-MiniLM-L6-v2` embeddings, which score much lower than OpenAI's embedding models (0.25–0.40 for a strong match here, vs. 0.7–0.9 for OpenAI):
  - **High confidence**: avg ≥ 0.25 (green bar, archive.green `#2D5A4A`)
  - **Medium confidence**: avg ≥ 0.12 (amber bar, `#8A5A00` — darkened from an earlier `#D68910` that measured 2.82:1 against white; `#8A5A00` measures 5.93:1 on white / 5.44:1 on `#F7F5F0`, meeting WCAG AA's 4.5:1 for normal text)
  - **Low confidence**: avg ≥ 0.04 (red bar, stamp.red `#FF4D2E`) with warning: "The AI found some content but the match to your question is weak. Try rephrasing or asking something more specific."
  - **Very low confidence**: avg < 0.04, or zero citations (danger red, `#C0392B`) with warning: "The AI could not find a strong match in your documents. Try rephrasing your question or check that the right documents are selected."
- The bar fill width normalizes the average to 0–100%.
- ARIA `progressbar` role with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.
- Utility function `calculateConfidence()` is pure and independently testable.

### 4.6 Relevance Timeline
Status: ✅

How it works:
- A collapsible bar chart showing all retrieved chunks sorted by similarity score (descending).
- Collapsed by default; click the toggle button to expand.
- Each bar width = `max(similarity, 0) / maxSimilarity * 100%`, with color coded by score range via `getScoreColor()` (`frontend/src/utils/calculateConfidence.ts`), which reuses the same `THRESHOLDS` constant `calculateConfidence()` is built on — retuning the confidence bands retunes both this timeline and the confidence indicator (§4.5) together.
- Bars animate in with staggered entrance delay (80ms per bar).
- Displays citation number, score percentage, and truncated document name per bar.
- Respects `prefers-reduced-motion` (animation disabled).
- Toggle button shows chunk count and uses `aria-expanded` for accessibility.
- Hidden during streaming; toggle is disabled when `isStreaming=true`.

### 4.7 IndexCard Truncation
Status: ✅

How it works:
- When more than 3 citations exist, only the first 3 IndexCards are shown by default.
- A "+ N more" link appears below the visible cards.
- Clicking the link reveals all remaining cards.
- State is local per AssistantMessage (not global).

### 4.8 Query History
Status: ✅

How it works:
- The last 10 queries are persisted in localStorage (`rag-kb:query-history`) and survive page reloads.
- A collapsible `QueryHistoryPanel` appears at the bottom of the desktop sidebar and inside the mobile sources drawer.
- Each entry shows the query text, a confidence-level color dot, citation count, and a relative timestamp.
- Clicking an entry pre-fills the input (user presses Ctrl+Enter to send); individual entries can be deleted via the × button.
- "Clear all" uses a 2-click confirm pattern with a 3-second timeout to prevent accidental deletion.
- While streaming, the panel is visually dimmed (opacity 0.5) and all interactions are disabled.
- Keyboard shortcut: Ctrl+H toggles the panel open/closed on the Chat page.
- Deduplication: case-insensitive after trim; re-queried items move to the top with updated metadata.

### 4.9 Split-Screen Answer Mode
Status: ✅

How it works:
- A toggle button (Columns2 icon) in the Chat top bar enables split-screen mode: left half shows the streamed answer, right half shows source chunks updating live as they arrive.
- Layout: 55/45 split (`md:grid md:grid-cols-[55fr_45fr]`), with `SourcePanel` on the right.
- The right panel shows: "SOURCE DOCUMENTS" header with count badge, IndexCards with staggered slide-in animation, ConfidenceBar at top, RelevanceTimeline below cards.
- State persists across page reloads via localStorage (`rag-kb:split-screen`), default is off.
- Mobile handling (≤768px): split-screen is always ignored even if enabled; toggle button is hidden; attempting to enable via Ctrl+K shortcut shows a toast "Split-screen is available on wider screens".
- SSE handlers update `queryPhase` and `liveChunks` in real-time: `searching` → `streaming` → `complete`. `liveChunks` is the single source of truth for the current stream's retrieved chunks — `finalizeStreamingMessage` reads citations directly from `liveChunks` rather than requiring the caller to also track a parallel `pendingCitations` copy just to hand the same value back at completion (a previously separate piece of component state in `Chat.tsx`, now removed).
- Citation sync: when split-screen is active, hovering a citation marker in the answer highlights the corresponding IndexCard in the SourcePanel (cross-panel sync via `ChatLayoutContext.tsx`).
- Context: `ChatLayoutContext.tsx` provides shared state (split-screen mode, live chunks, query phase, citation hover, and a registration hook for the last message's copy handler — see §4.3's Ctrl+Shift+C shortcut) to `Chat.tsx`, `AssistantMessage`, and `SourcePanel` without prop drilling.
- CSS animations: card-slide-in (200ms, staggered 150ms per card), search-sweep (indeterminate progress bar), source-panel-slide-in.
- Respects `prefers-reduced-motion`: all animations are skipped.
- Tests: 30+ unit tests covering store state, component rendering, hooks, and panel behavior.

### 4.10 Answer Feedback (Helpful / Not Helpful)
Status: ✅

How it works:
- Once an assistant answer finishes streaming, a "Helpful?" thumbs-up/thumbs-down pair renders below the confidence bar and relevance timeline, styled to match the rest of the message (Space Mono labels, archive-green `#2D5A4A` active state for "Yes", stamp-red `#FF4D2E` active state for "No").
- The buttons only render when the message carries a `queryLogId` — the `query_logs` row id returned in the SSE `complete` event's payload. This id (not the ephemeral pending-query UUID consumed at stream start) is the handle `POST /api/query/:queryId/feedback` operates on; it's `null` if the backend's query-logging write failed, in which case feedback is silently unavailable for that one message rather than shown broken. The frontend reads `queryLogId` off a ref updated synchronously in the same SSE event handler that finalizes the streamed message, rather than off React state — the `complete` event's payload and the completion callback both fire before React re-renders, so reading state there would still observe the previous render's (often `null`) value.
- Clicking a button optimistically updates local state immediately, then calls `submitQueryFeedback()`; on API failure the optimistic update is reverted and a toast reports the failure. One active choice at a time — clicking the already-selected option is a no-op, and selecting the other option overwrites the prior choice both locally and server-side.
- Backend: `POST /api/query/:queryId/feedback` (Zod-validated body `{ feedback: 'helpful' | 'not_helpful' }`) calls `vectorStore.setQueryFeedback()`, which scopes the update to `.eq('id', queryId).eq('user_id', userId)` in the same query — the same ownership-in-the-same-query IDOR pattern as `getDocument`/`deleteDocument` elsewhere in this file. A mismatched owner or nonexistent queryId both update zero rows and surface as the same 404, never a 403. The update is idempotent: resubmitting feedback overwrites the prior value via `UPDATE`, never inserting a duplicate row.
- No aggregation or analytics dashboard on this data yet — it's captured cleanly in `query_logs.feedback` for future reporting/tuning work, not surfaced anywhere in the UI beyond the per-message rating state itself.

### 5.0 Document Relationship Map
Status: ✅

How it works:
- A third view mode ("map") on the Documents page, toggled via a Network icon button in the header alongside the existing Grid/Table toggles.
- The map view renders a force-directed SVG graph where nodes represent documents and edges connect documents with chunk-level cosine similarity above a configurable threshold (default 0.3).
- **Backend endpoint**: `GET /api/documents/similarity?threshold=0.3` returns `{ pairs, documents }` — pairs contain `documentA`, `documentB`, and average `similarity` score; documents array contains full metadata for all `ready`-status documents. The route runs `computeDocumentSimilarity` and `listDocuments` concurrently via `Promise.all` (both are independent reads of the caller's `ready` documents), rather than sequential awaits, to keep the endpoint's latency to roughly one round-trip instead of two.
- **Similarity computation** (`computeDocumentSimilarity`): fetches all `ready` documents, samples up to 5 representative chunks per document (`SAMPLE_SIZE`), computes pairwise average cosine similarity across all chunk combinations, and filters pairs below the threshold. Performance ceiling: N docs × 5 chunks = O(N² × 25) dot products — negligible at the project's expected scale (<100 docs). Chunk fetching itself is a single query for all ready documents (`.in('document_id', ids)`, ordered by document then chunk_index, capped client-side per document at `SAMPLE_SIZE`) rather than one query per document — a 50-document archive previously fired 50 concurrent Supabase requests every time this view opened; now it fires one.
- **Cosine similarity**: pure JS implementation, no external math library. Returns 0 for zero vectors, handles mismatched lengths gracefully.
- **Force-directed layout**: simplified Fruchterman-Reingold simulation with 150 iterations, extracted to a separate testable utility (`runForceLayout`). Constants: REPULSION=8000, ATTRACTION=0.1, DAMPING=0.85, MIN_DIST=30. Nodes initialize in a circle layout for a good starting point.
- **SVG graph**: nodes are color-coded by file type (PDF=stamp.red, Markdown=archive.green, others=ink.base), with file-type labels inside the node circle and filename labels below. Edge opacity and width scale with similarity score (0.15–1.0 opacity, 1–5px width).
- **Interactions**: clicking a node shows a detail panel listing connected documents with similarity percentages; clicking the background deselects. Hover shows a tooltip with filename and chunk count.
- **Legend**: file-type color legend rendered above the graph.
- **Stats bar**: shows document count and relationship count, plus a "Recompute" button.
- **Lazy loading**: the `DocumentRelationMap` component is lazy-loaded (`React.lazy`) when the map view is selected.
- **Data fetching**: auto-fetches similarity data when the user switches to map view; "Recompute" button re-fetches on demand.
- **`prefers-reduced-motion`**: all entrance animations (pulse ring, edge transitions) are skipped when the user prefers reduced motion.
- Route mounting: the `/similarity` endpoint is mounted before `/:id` in the documents router to prevent Express from matching "similarity" as a UUID path parameter.
- Tests: 9 force-layout utility tests, 11 DocumentRelationMap component tests, 4 backend integration tests, 8 backend unit tests.

---

## 5. Frontend — Pages

### 5.1 Landing Page (`/`)
Status: ✅

What it contains — eight full-bleed sections, all static (no API calls, no loading/error/empty states):
1. **Minimal nav** (`LandingNav`, not the shared `AppHeader`) — logo and an "Open app →" button linking to `/upload`.
2. **Hero** (50/50 split on desktop, stacked on mobile) — headline ("Ask your documents. Get answers with receipts."), a single primary CTA (`Start for free →` → `/upload`), and a right-hand static mock of the real chat UI (top bar with Split/Help icons, user query, cited answer, confidence bar, two index cards, retrieval-scores toggle, copy/export/re-query action row) — hidden below the `md` (768px) breakpoint.
3. **Feature ticker** — an orange continuous marquee (`animate-ticker-scroll`, pauses on hover, respects `prefers-reduced-motion` via `motion-safe:`) listing 8 feature bullets (multi-turn memory, bidirectional citations, confidence scoring, split-screen, document map, Markdown export, query history, "100% free").
4. **Before/after comparison** ("THE DIFFERENCE") — 3 stacked rows contrasting a generic AI tool against the app, each with a left "THE OLD WAY" cell and a right "RAG KB" cell (top accent bar on desktop, left border on mobile): citations (hover a citation badge to highlight the source), multi-turn memory (follow-up questions use the last 3 exchanges as context), and confidence/transparency (includes a live mini confidence bar). A caption row below links out to the rest of the feature set.
5. **Three-step explainer** ("FILE IT / ASK IT / CITE IT", `#how-it-works`) — updated copy describing magic-byte validation, 512-token chunking, pgvector/IVFFlat semantic search, and citation/confidence tracing.
6. **Split-screen showcase** — a two-column section (description + bullet list on the left, a static mock of the split-screen answer/source layout on the right) explaining the split-screen feature in detail.
7. **Stats bar** — 4 honest stats (100% free, 384 embedding dimensions, 512 tokens/chunk, 0 hallucinations verified) plus a centered tech-stack line.
8. **Footer CTA** — nav links (Acquisitions Desk/Reading Room/Archive) and a second "Open the app →" button.

### 5.2 Upload Page (`/upload`)
Status: ✅

Page heading reads "Acquisitions Desk" — part of the archive/newsroom naming convention shared across the app's three main pages (Acquisitions Desk → Reading Room → Archive), matching the "Archive / Ink-and-Paper" design theme.

What it contains:
- A drop zone (`FileDropzone` design-system component) supporting drag-and-drop or click-to-browse; accepts `.pdf/.txt/.md/.docx`, caps at 5 files and `VITE_MAX_FILE_SIZE_MB` MB each (frontend env var, default 10 — a client-side pre-check only; kept in sync with the backend's own `MAX_FILE_SIZE_MB`, which remains the enforced source of truth), with per-file progress bars and status icons.
- Before anything is queued, a 3-panel "what happens next" strip (Validated / Chunked & embedded / Ready to ask) fills the space below the drop zone instead of leaving it blank — replaced by the Filing Queue/Just Filed sections once an upload starts.
- A "FILING QUEUE" section showing in-flight items (queued/uploading/processing/failed) and a "JUST FILED" section for items that reached `ready`, each rendered as a `QueueRow` with retry/remove actions.
- A right-hand "Recent Filings" sidebar (fixed width on desktop, full-width accordion on mobile) listing the 8 most recent documents plus a stats footer (docs/chunks/ready counts) and a "View all →" link to `/documents`.
- Upload errors surface both inline (per-row "✗ Failed · {error}" with a Retry button) and via toast notifications summarizing overall success/partial-failure/failure.
- Each file uploads via a raw `XMLHttpRequest` (needed for real `upload.onprogress` events, which `fetch` doesn't expose) with a 5-minute `xhr.timeout` — a stalled (not reset) connection now fails loudly with a retryable error instead of leaving the row showing "Uploading N%" indefinitely with no way to recover.
- The page header (heading + "File document(s) →" button) stacks vertically and the button goes full-width below 480px (`useIsMobile(480)`), instead of forcing both onto one crowded row.
- Once an upload starts, `ragStore.startPolling` polls `GET` job status every 3 seconds per `jobId` until it resolves, is stopped, or hits a 200-attempt (~10 minute) cap — comfortably beyond the document worker's own 5-minute hard per-job timeout. Calling `startPolling` again for a `jobId` already being polled (e.g. a component remount) clears the prior interval first rather than orphaning it. If the cap is reached (a worker crashed without ever writing `status='failed'`), the queue item is marked `failed` with a "Processing timed out" message so the user isn't left staring at an indefinitely stuck "Processing" row. A 404 from the poll (the document was deleted mid-poll) is treated as permanent and stops polling immediately with a "Document was deleted" message, rather than being treated the same as a transient network blip and retried for the full ~10-minute cap.

### 5.3 Chat Page (`/chat`)
Status: ✅

Page heading reads "Reading Room" — the second stage of the app's archive/newsroom naming convention (Acquisitions Desk → Reading Room → Archive).

What it contains:
- A document source filter (`DocFilterPanel`): a vertical "Card Catalog" sidebar on desktop (`≥768px`), collapsed into a tappable top bar that opens a `MobileSourcesDrawer` on mobile. Lists only `ready`-status documents with an "All documents" master checkbox; selecting a subset restricts retrieval to those documents. The drawer is a real focus-trapped dialog (shared `useFocusTrap` hook — traps Tab/Shift+Tab, moves focus in on open, restores it to the trigger on close, closes on Escape), matching its `role="dialog" aria-modal="true"` semantics instead of just declaring them.
- When no documents exist and no messages have been sent, the page shows an `OnboardingFlow` with three step cards ("File it" / "Wait ~1 min" / "Ask anything") and a CTA to upload the first document.
- Once documents exist or messages are present, a message log (`role="log"`) shows an empty state with 3 suggested-query buttons when no messages exist, otherwise a list of `ChatMessage`/`AssistantMessage` components (user messages right-aligned, assistant messages left-aligned with a citation chip row). The index of the most recent assistant message (used to gate re-query buttons and source-query display to only the latest answer) is computed once per render via a single pass over `messages`, not recomputed inside the per-message loop.
- A `StatusBar` during streaming showing phase text ("Searching the catalogue…" / "Retrieved N chunks" / "Composing answer…").
- Citations render as numbered `CitationChip` badges (index-based, not tied to inline markers in the LLM's text) plus an `IndexCard` grid below each assistant message — clicking a chip or card flips/expands it to show the full excerpt.
- Streaming text appends token-by-token with a blinking cursor (`StreamingCursor`) while in progress.
- A thread indicator pill shows "{N}-turn thread" once at least one exchange has completed, with an inline clear action; a top-bar "New conversation" button requires a confirm-click before clearing history.
- The query input is a textarea (Ctrl+Enter to send) with a Send/Stop toggle depending on streaming state.

### 5.4 Documents Page (`/documents`)
Status: ✅

What it contains:
- A 4-tile stats bar: Total Documents, Indexed Chunks, Ready to Query, Processing (the Processing tile turns orange when its count is non-zero).
- Status filter and file-type filter dropdowns (client-side).
- Three view modes: a responsive card grid (1→4 columns depending on breakpoint), a sortable table (horizontal-scroll on small screens) with an expandable row showing chunk placeholders and any error message, or a force-directed relation map (see §5.0) showing document similarity. Table column sorting (Name/Status/Uploaded) is fully keyboard-accessible — the sort control is a real `<button>` (not a non-focusable `<th>` with a decoy inner button), with a dynamic `aria-label` announcing the current sort state and `aria-sort` on the parent `<th>` per the ARIA columnheader pattern.
- Status badges: `pending` (default/gray), `processing` (dashed green border), `ready` (solid green), `failed` (red).
- Bulk and single delete both route through a shared confirmation modal listing the target filename(s); deletions run concurrently and report partial-failure via toast. The table row's delete button has a 44×44px tap target (padding added around the visible icon, table layout unchanged).
- When two or more documents share the same filename (e.g. the same file uploaded twice), the grid card, table row, and delete confirmation modal all show a disambiguating detail — full upload date+time and the first 8 characters of the document ID — instead of relying on the filename alone. Non-duplicate documents keep the plain date-only display everywhere except the delete modal, which always shows the full detail for every listed target.
- Empty states distinguish three cases: "Archive is empty" (zero documents, with an Upload link), "No results" (filters matched nothing), and "Can't reach the server" (the document list fetch failed and nothing is cached) with a Retry action — the last case never shows the Upload link, since uploading would fail for the same reason. If a background refresh fails while documents are already on screen, the table stays visible and a dismissible inline banner reports the error instead of replacing the page.
- The generic empty/no-results state and the three content views (grid/table/map) are mutually exclusive: with zero documents, only "Archive is empty" renders regardless of which view toggle is active. The "No results" case (filters matched nothing) is skipped while in map view, since the relation map isn't affected by the status/type filters — it shows its own "Not enough documents" placeholder there instead, driven by the ready-document count rather than the filtered list.
- Network/API error messages are normalized by `formatUserFacingError` (`frontend/src/utils/formatError.ts`) before display, so raw exception text (e.g. the browser's `TypeError: Failed to fetch`, Firefox's `NetworkError when attempting to fetch resource`, Safari's `Load failed`, or Node's `fetch failed`) is never shown to the user — all map to "Could not reach the server. Ensure the backend is running on port 3000." When the API response carries a machine-readable `error.code` (e.g. `DB_CONNECTIVITY`, `DB_SCHEMA_NOT_MIGRATED` — see `backend/src/utils/dbError.ts`'s `DbErrorCode`), `formatUserFacingError` switches on that code directly instead of re-deriving the same classification by regexing the message text a second time; the regex fallback is now reserved for the one genuinely code-less case — the backend itself never responding at all.

---

## 6. Frontend — Components

| Component | Status | Description | Variants/Notes |
|---|---|---|---|
| AppHeader | ✅ | Dark top nav with logo and tab strip for Upload/Chat/Documents | Full-keyboard tablist (arrow/Home/End nav), responsive label collapsing |
| AssistantMessage | ✅ | Assistant message with bidirectional citation linking | Manages highlight state per message, wired to CitationMarker and IndexCard in both the streaming and completed-message views. Exported wrapped in `React.memo` with a custom by-value comparator (citations compared field-by-field, callback props compared by presence rather than identity) so completed messages skip re-rendering while an unrelated message streams in |
| Badge | ✅ | Small status/label pill | `default`, `success`, `warning`, `danger`, `citation` (dashed border) · `sm`/`md` |
| Button | ✅ | Primary action trigger | `primary`, `secondary`, `ghost`, `danger` · `sm`/`md`/`lg`, loading/icon-only states |
| ChatMessage | ✅ | Renders a single chat turn with citations | `user`/`assistant` roles, streaming cursor, copy-to-clipboard, citation chip + index-card row. Exported wrapped in `React.memo` with a custom by-value comparator for the same reason as AssistantMessage |
| CitationChip | ✅ | Numbered source citation badge | Relevance meter bar, expandable side panel with full excerpt |
| CitationMarker | ✅ | Inline citation superscript with bidirectional highlight | Active state turns red, scrolls card into view on click, accessible with ARIA |
| ConfidenceBar | ✅ | Horizontal confidence bar based on average similarity | Shows level label, progress bar, and optional warning; hidden during streaming |
| DocumentRelationMap | ✅ | Force-directed SVG graph of document similarity | Color-coded nodes by file type, edge opacity/width by similarity, detail panel, recompute button; nodes are keyboard-operable (`tabIndex`, `role="button"`, `aria-label`/`aria-pressed`, Enter/Space activation) |
| EmptyState | ✅ | Centered icon + message + optional action | Used for empty archive, no-results, empty sidebar |
| FileDropzone | ✅ | Drag-and-drop / click upload zone with per-file queue | Hand-rolled drag/drop, no third-party dropzone library |
| IndexCard | ✅ | "Physical index card" citation preview with 3D flip | Deterministic rotation per chunk, respects `prefers-reduced-motion`, supports active highlight state |
| Input | ✅ | Labeled text input with helper/error text and char count | Only used in the internal `/design-system` showcase — app pages use raw styled inputs instead |
| LoadingSpinner | ✅ | Horizontal indeterminate progress-scan bar | `sm`/`md`/`lg` · `indigo`/`green`/`white` |
| Modal | ✅ | Centered/bottom-sheet dialog with focus trap | Used for delete confirmation on the Documents page; focus-trap/restore/Escape logic lives in the shared `useFocusTrap` hook, also adopted by the mobile sources drawer (§5.3) |
| RelevanceTimeline | ✅ | Collapsible bar chart of all chunk relevance scores | Sorted by score, staggered entrance animation, hidden during streaming |
| Select | ✅ | Styled native `<select>` with custom chevron | Used for Documents page status/type filters |
| StreamingCursor | ✅ | Blinking text cursor for in-progress streaming | `aria-hidden` |
| Toast / ToastContainer | ✅ | Sticky-note-styled notification with auto-dismiss | success/error/warning/info variants; error toasts use `role="alert"`/`aria-live="assertive"` so screen readers interrupt, others use `role="status"`/`aria-live="polite"` |
| FilingReport | ✅ | Collapsible chunk quality report card | Grade badge (GOOD/FAIR/POOR) with rotation, tri-color distribution bar, detailed stats |
| OnboardingFlow | ✅ | 3-step empty-KB onboarding | Step cards with stamp-style icons, CTA to /upload, responsive vertical/horizontal layout |
| ReQueryButtons | ✅ | 3 re-query variant buttons | Summarize/takeaways/explain, auto-fills and submits |
| QueryHistoryPanel | ✅ | Collapsible sidebar panel showing recent queries | localStorage-backed, 10 entries, confidence dots, Ctrl+H toggle; per-entry delete button reveals on row hover or keyboard focus (`group-hover`/`focus-visible`), matching the reveal-on-hover convention used elsewhere in the chat UI |
| SourcePanel | ✅ | Right panel for split-screen answer mode | Shows IndexCards, ConfidenceBar, RelevanceTimeline live during streaming |

---

## 7. API Reference Summary

| Method | Path | Auth | Rate Limit | Description |
|---|---|---|---|---|
| GET | /health | — | global (200/window) | Plain liveness check, no envelope — "the process is up," nothing more |
| GET | /api/health | — | global (200/window) | Readiness check with standard envelope — pings Supabase, Redis, HuggingFace, and Groq, and returns `503` (not `200`) if any is unreachable, so an orchestrator/load balancer can route around a degraded instance instead of sending it real traffic |
| GET | /api/docs | — | global (200/window) | Swagger UI |
| POST | /api/upload | Clerk JWT | 5/window (`RATE_LIMIT_MAX_UPLOAD`) | Upload up to 5 documents (PDF/DOCX/TXT/MD), scoped to the caller |
| POST | /api/query | Clerk JWT | 30/window (`RATE_LIMIT_MAX_QUERY`) | Submit a query, returns a `queryId` for streaming |
| GET | /api/query/stream | — (see note) | 30/window (shared with POST /api/query) | SSE stream of retrieval + generated answer for a `queryId` (query string validated by Zod — must be a UUID, a missing/malformed/duplicated value returns 422) |
| POST | /api/query/:queryId/feedback | Clerk JWT | 30/window (shared with POST /api/query) | Rate a completed answer `helpful` \| `not_helpful`; `:queryId` is the `query_logs` row id from the `complete` SSE event, not the pending-query UUID. Idempotent (UPDATE, not INSERT); mismatched owner or unknown id returns 404 |
| GET | /api/documents | Clerk JWT | 100/window (`RATE_LIMIT_MAX_DOCUMENTS`) | Paginated document list, optional status filter — only the caller's documents |
| GET | /api/documents/:id | Clerk JWT | 100/window | Fetch a single document (returns `{document, chunkQuality}` when status is ready) |
| GET | /api/documents/similarity | Clerk JWT | 100/window (shared with documents) | Pairwise document similarity, scoped to the caller's own documents |
| DELETE | /api/documents/:id | Clerk JWT | 100/window | Delete a document (cascades to its chunks) |
| GET | /api/queue/status | `X-Admin-Secret` | 20/window (hardcoded) | BullMQ queue counts (waiting/active/completed/failed/delayed), standard `{success,data,meta}` envelope |
| GET | /api/queue/job/:jobId | `X-Admin-Secret` | 20/window (hardcoded) | Status of a single processing job (jobId validated by Zod as a UUID), standard `{success,data,meta}` envelope |

Note on `GET /api/query/stream`: opened via the browser's native `EventSource`, which cannot attach an `Authorization` header, so this route is not independently gated by `requireAuth`. It inherits its caller's identity from the `queryId` itself — an unguessable UUID, single-use, 2-minute TTL, bound to the userId captured from the authenticated `POST /api/query` call that created it. See §9.3.

Window duration for all limiters: `RATE_LIMIT_WINDOW_MS` (default 60000 ms). Every request also passes through a global 200-req/window limiter in addition to its route-specific limit.

Full Swagger docs available at: `/api/docs` (when backend is running). The documented default and range for `similarityThreshold` (`0`, range `0..1`) and the `Document` response schema's field names (`mime_type`, `size_bytes`, `chunk_count`, `created_at`, `updated_at`, `error_message` — snake_case, matching the real JSON) match the live implementation.

---

## 8. Security

What's implemented:
- **Helmet** — strict CSP (`default-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `style-src` allows `'unsafe-inline'` for Swagger UI), HSTS (1 year, includeSubDomains, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, COEP/COOP/CORP isolation headers, `X-Powered-By` disabled.
- **CORS** — single allowed origin (`CORS_ORIGIN`), plus a non-production-only regex allowance for `*.devtunnels.ms` origins (VS Code dev tunnels); methods restricted to `GET/POST/DELETE`; `credentials: false`; rejections are logged at WARN, including the request's `correlationId` (read directly from the incoming `X-Correlation-ID` header, since the CORS check runs before `correlationIdMiddleware` and the `cors` package's delegate-form origin callback is the only form that exposes the raw request).
- **Rate limiting** — global 200/window plus independent per-route-group limits (upload 5, query 30, documents 100, admin/queue 20), all IP-keyed, with standard `RateLimit-*` headers and a `Retry-After` header on 429s.
- **Input validation** — every route validates its body/query/params against a Zod schema (`schemas/`) before any service logic runs; unknown keys are stripped by default.
- **File validation** — magic-byte verification (not just MIME/extension), filename security checks (script injection, path traversal, double extensions), zip-bomb detection for DOCX, and filename sanitization before the file touches disk. The zip-bomb scan fails closed if it hits its 1,000-entry inspection cap before reaching the end of the archive — an unscanned remainder (potentially the bomb entry itself) is treated the same as the unscannable streaming-data-descriptor case, never silently reported as safe.
- **Error handling** — error responses never leak stack traces; in production, unhandled errors return a generic message. `InternalError` — the type `dbError.ts` falls back to for any Supabase/PostgREST error it doesn't recognize as a connectivity or missing-table pattern — is gated the same way: in production its message is replaced with a generic "Internal server error" before reaching the client, so a constraint violation, RLS permission error, or malformed RPC arg never leaks table/constraint names. Every other `AppError` subclass (`ValidationError`, `NotFoundError`, etc.) keeps its message as-is, since those are intentionally user-facing. Every request carries a UUID v4 `correlationId` (via `X-Correlation-ID`) that's included in error responses and in every structured Winston log line for that request. The 404 handler returns a generic "Route not found" message without leaking the requested path. All domain-specific typed errors (`ChunkingError`, `EmbeddingError`, `VectorStoreError`, `LLMError`, `FileValidationError`, `QueueError`) extend the base `AppError` class, so the global error handler's single `instanceof AppError` branch maps every one of them to its own intended HTTP status code and machine-readable error code — none of them fall through to a generic 500. Internally, all six share one abstract `DomainError<TCode>` base (`backend/src/utils/errors.ts`) that holds the common `code`/`originalError` fields and constructor logic; each concrete class is a thin subclass supplying only its own `name` and its own code-enum type parameter, so `instanceof ChunkingError` etc., `err.name`, `err.code`, `err.statusCode`, and `err.originalError` all behave identically to dedicated hand-written classes.
- **Database access** — all Supabase queries use the SDK's parameterized methods (no raw SQL string interpolation from user input); RLS is enabled on every table.
- **Admin authentication** — `ADMIN_SECRET` requires a minimum of 32 characters (no weak defaults). Admin secret comparison uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Correlation ID validation** — client-provided `X-Correlation-ID` headers are capped at 128 characters to prevent log injection or disk exhaustion.
- **Redis security** — Redis is bound to `127.0.0.1` (not exposed to all interfaces) and requires a password via `--requirepass`.
- **User authentication** — Clerk (Google OAuth only) gates every `/api/upload`, `/api/query` (POST), and `/api/documents/*` route via `requireAuth` middleware, which verifies the bearer JWT server-side with `@clerk/backend`'s `verifyToken()`. See §9 for the full authentication and isolation model.
- **Per-user data isolation (IDOR prevention)** — every document, chunk, and query log is scoped to its owner's Clerk user ID. `getDocument`/`deleteDocument` filter by `user_id` in the same query as the ID lookup, so a mismatched owner returns the same 404 as a nonexistent document — never a 403 — preventing an attacker from probing which document IDs exist.

What's deferred:
- No prompt-injection filtering on query text beyond generic HTML/null-byte sanitization.
- No malware/AV scanning of uploaded file content — only magic-byte and zip-bomb checks.
- `GET /api/query/stream` is not independently authenticated (native `EventSource` can't send custom headers) — it relies on the unguessable, single-use, short-TTL `queryId` as a capability instead. See §9.3 for the threat-model reasoning.

---

## 9. Authentication & User Isolation

### 9.1 Authentication
Status: ✅
Provider: Clerk (clerk.com)
Method: Google OAuth only (email/phone/username sign-in disabled in the Clerk dashboard)

How it works:
- Unauthenticated users hitting a protected route are redirected to `/sign-in` by `ProtectedRoute` (wraps `/upload`, `/chat`, `/documents` in `App.tsx` with Clerk's `SignedIn`/`SignedOut`/`RedirectToSignIn`).
- `/sign-in/*` renders Clerk's hosted `<SignIn>` component, restyled to match the Ink-and-Paper design system; Google is the only enabled connection.
- On success, Clerk issues a session JWT. The frontend attaches it to every backend request as `Authorization: Bearer <token>` via `registerTokenGetter()` (`services/api.ts`), wired up once in `App.tsx` by an `AuthTokenBridge` component that calls Clerk's `useAuth().getToken()`.
- The backend's `requireAuth` middleware (`middleware/requireAuth.ts`) verifies the JWT server-side with `@clerk/backend`'s `verifyToken()` and attaches `{ userId, email }` to `req.auth`. It gates `/api/upload`, `/api/documents/*`, and `POST /api/query` (mounted in `app.ts`, after `correlationIdMiddleware` and before the route handlers).
- The landing page (`/`) stays public. Its nav, hero, and footer CTAs read `useAuth().isSignedIn` to point at `/upload` (signed in) or `/sign-in` (signed out), and the nav button label switches between "Open app →" and "Sign in →".
- `AppHeader` renders Clerk's `<UserButton>` (avatar + sign-out menu) on all interior routes.

### 9.2 User Data Isolation
Status: ✅

How it works:
- `documents` and `query_logs` each carry a `user_id` column (Clerk's `sub` claim, a string — not a Postgres UUID). `document_chunks` needs no column of its own: it's only ever reached through a user-scoped `documents` lookup, or cascade-deleted with its parent.
- Every `vectorStore.ts` function that reads or writes document data takes an explicit `userId` and filters by it: `createDocument`, `listDocuments`, `getDocument`, `deleteDocument`, `getChunkQualityStats`, `similaritySearch` (via the `match_chunks` RPC's `p_user_id` param), `computeDocumentSimilarity`, and `logQuery`.
- **IDOR prevention**: `getDocument`, `deleteDocument`, and `getChunkQualityStats` all include `.eq('user_id', userId)` in the *same* query as the ID lookup — a mismatched owner produces zero rows, which surfaces as an ordinary 404 (`NOT_FOUND`), identical to a nonexistent document. An attacker probing document IDs from another account can never distinguish "not yours" from "doesn't exist," and can never delete a document or read chunk-quality stats they don't own.
- Route handlers (`upload.ts`, `documents.ts`, `query.ts`) all pull `userId` from `req.auth!.userId` (set by `requireAuth`) and pass it straight through — the frontend never sends a user ID itself; it's always derived from the verified JWT.
- Supabase RLS provides a second isolation layer: `supabase/migrations/001_initial.sql` defines `authenticated`-role policies (`users_own_documents`, `users_own_chunks`, `users_own_query_logs`) scoped to `auth.jwt() ->> 'sub'`, for the case where Supabase is configured to trust Clerk's JWKS as a JWT issuer. The backend's `service_role` key bypasses RLS entirely, so these policies are a safety net, not the primary enforcement — that's the application-code filtering above.

### 9.3 GET /api/query/stream — the one unauthenticated route
Status: ✅ (by design)

How it works:
- The frontend opens this route with the browser's native `EventSource`, which cannot attach custom headers — so it cannot carry a bearer token, and `requireAuth` is deliberately **not** mounted on it.
- Instead, `POST /api/query` (which *is* authenticated) captures `req.auth!.userId` into the in-memory `PendingQuery` entry alongside the query params, keyed by a freshly generated `queryId`.
- `GET /api/query/stream?queryId=...` consumes that entry once (`consumePendingQuery` deletes it on read) and uses its stored `userId` — never a fresh auth check — for the `similaritySearch` call and the `query_logs` write.
- The `queryId` itself is the security boundary: an unguessable UUID v4, handed only to the user who created it (in the authenticated POST response), single-use, and expiring after 2 minutes. This is the same trust model as a signed, short-lived download URL.
- Swagger documents this route with `security: []` and an explanatory note rather than `bearerAuth`, so the spec doesn't claim a header requirement that would never actually be checked.

---

## 10. Background Services

### 10.1 BullMQ Queue
- Queue name: `document-processing`. Redis connection via `REDIS_URL` (default `redis://localhost:6379`, run locally via `docker-compose up -d`).
- Job type: single job name `process-document`, with `jobId` set to the document's UUID (so duplicate enqueues for the same document are naturally deduped at the queue level). Job payload carries `userId` (the uploader's Clerk ID) purely for log tracing — ownership is already fixed at upload time via the `documents.user_id` column, so the worker itself never needs to re-check it.
- Worker concurrency: 1 (serialized to protect the HuggingFace free-tier rate limit).
- Retry strategy: 3 attempts, exponential backoff starting at 1000 ms.
- No monitoring dashboard currently exists (see §1.2). Use `GET /api/queue/status` for ad-hoc inspection.

### 10.2 Logging
- Winston, structured JSON output, configurable level via `LOG_LEVEL` (default `info`).
- Every request is tagged with a UUID v4 correlation ID (`middleware/correlationId.ts`), and every log line for that request — including HTTP access logs (via a Morgan→Winston stream) and error logs — carries that ID, enabling full request tracing across the access log, application logs, and the error response body.
- Secrets are never logged: only key presence/names are logged, never values.
- A loud, unmissable `>>> NODE_ENV=... <<<` line is logged first thing on boot, before any other startup noise, so an operator can immediately confirm the resolved value matches what the deploy host was supposed to set.

### 10.3 Readiness Checks
Status: ✅

How it works:
- `checkReadiness()` (`backend/src/utils/readiness.ts`) runs four checks in parallel, each bounded by a 3-second timeout so a single hung dependency can't hang the health endpoint itself: a lightweight head-only Supabase query (`documents` table, `count: 'exact', head: true`); a Redis round-trip (`INFO`, via the same connection BullMQ's queue already uses — chosen over `PING` because BullMQ's Redis-client abstraction doesn't expose it, but `INFO` requires the same live, authenticated connection and surfaces a `NOAUTH`/connection failure the same way); a HuggingFace check against the public model-info endpoint for `all-MiniLM-L6-v2` (metadata only — no inference call, so it costs nothing per poll, unlike calling the real embedding endpoint); and a Groq check via `groq.models.list()` (a metadata call, not a completion request, so it costs no inference tokens per poll).
- `GET /api/health` calls this and returns `200` with `{status: 'ok', checks: {...}}` only if all four dependencies report `ok`; otherwise `503` with per-dependency detail (`{status: 'error', error: '...'}`) for whichever check(s) failed. Without the HuggingFace/Groq checks, a revoked token or provider outage would leave this endpoint reporting `200` while every upload/query silently failed — the load balancer would keep routing real traffic to a degraded instance with no health signal beyond application logs.
- The same check also runs once at boot (`bootstrap()` in `index.ts`), logging a loud failure (not a silent one) if any dependency is unreachable when the process starts — so a misconfigured `REDIS_URL` (e.g. missing the password `docker-compose.yml`'s `--requirepass` enforces) or an invalid `HUGGINGFACE_TOKEN`/`GROQ_API_KEY` surfaces immediately at startup instead of failing invisibly on the first real upload/query.

### 10.4 Graceful Shutdown
Status: ✅

How it works:
- On `SIGTERM`/`SIGINT`, the HTTP server stops accepting new connections first (`server.close()`) and lets in-flight requests — including uploads and open SSE chat streams — finish, bounded by a 30-second timeout after which shutdown proceeds anyway rather than hanging forever.
- Only after the HTTP server has closed (or the timeout elapsed) are the BullMQ queue and worker closed, then the process exits.
- This ordering matters under a rolling deploy or autoscale-down: without it, in-flight uploads and chat streams would be dropped mid-response the instant SIGTERM arrives, rather than being allowed to complete.

---

## 11. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| GROQ_API_KEY | ✅ | — | Groq API key for LLM inference |
| HUGGINGFACE_TOKEN | ✅ | — | HuggingFace Inference API token (read role) |
| SUPABASE_URL | ✅ | — | Supabase project URL |
| SUPABASE_SERVICE_KEY | ✅ | — | Supabase service_role key (not anon) |
| DATABASE_URL | ✅ (for migrations) | — | Postgres connection string, used by `npm run db:migrate` and related scripts only — not validated by the app's Zod env config |
| REDIS_URL | ✅ | — | Redis connection URL for BullMQ. Must embed credentials directly (`redis://:PASSWORD@host:port`) if the target Redis requires auth — the app reads credentials from this URL only, not from `REDIS_PASSWORD` (see below), and `docker-compose.yml`'s bundled Redis always requires a password with no weak default. |
| REDIS_PASSWORD | ✅ (docker-compose only) | — | Only consumed by `docker-compose.yml`'s `--requirepass` for the local dev Redis container — the app itself never reads this var directly. Must be the same value embedded in `REDIS_URL` above, or the app gets `NOAUTH` errors and document ingestion silently stops working. |
| PORT | No | 3000 | HTTP server port |
| NODE_ENV | ✅ | — | `development` \| `production` \| `test`. No default — an unset value fails startup instead of silently running with dev-mode error verbosity, wide-open CORS, and non-JSON logs. The resolved value is also logged loudly (`>>> NODE_ENV=... <<<`) as the first line on boot. |
| CORS_ORIGIN | ✅ | — | Exact allowed frontend origin. No default — an unset value on a deploy host used to silently enforce CORS against `localhost`, blocking every real browser request in a way that looked like a frontend bug rather than a missing env var; now it fails startup instead. |
| MAX_FILE_SIZE_MB | No | 10 | Max upload size per file in MB. Validated to be a positive finite number — a malformed value (empty string, non-numeric) fails startup instead of silently becoming `NaN` and disabling the size check. Read by multer's limit, the file-validation pipeline, and the upload Zod schema alike, so all three stay in sync. |
| RATE_LIMIT_WINDOW_MS | No | 60000 | Rolling rate-limit window in ms. Same positive-number validation as above. |
| RATE_LIMIT_MAX_UPLOAD | No | 5 | Max uploads per IP per window. Same positive-number validation as above. |
| RATE_LIMIT_MAX_QUERY | No | 30 | Max queries per IP per window. Same positive-number validation as above. |
| RATE_LIMIT_MAX_DOCUMENTS | No | 100 | Max document list/delete requests per IP per window. Same positive-number validation as above. |
| ADMIN_SECRET | ✅ | — | Shared secret for `X-Admin-Secret` header on `/api/queue/*` (min 32 characters) |
| CLERK_SECRET_KEY | ✅ | — | Clerk secret key (`sk_...`) — verifies JWTs server-side via `@clerk/backend` |
| CLERK_PUBLISHABLE_KEY | ✅ | — | Clerk publishable key (`pk_...`), backend-side copy (currently unused by any backend call, kept for parity/future use) |
| LOG_LEVEL | No | info | `error` \| `warn` \| `info` \| `debug` |
| VITE_API_BASE_URL | No | `/api` (Vite dev-proxies to `http://localhost:3000`) | Absolute backend base URL, only needed when frontend/backend aren't same-origin (e.g. a devtunnel or split Render/Vercel deploy); documented in `frontend/.env.example`, set per-environment in `frontend/.env.local` (not committed) |
| VITE_CLERK_PUBLISHABLE_KEY | ✅ | — | Clerk publishable key (`pk_...`), same value as `CLERK_PUBLISHABLE_KEY` — required for the frontend to mount `<ClerkProvider>`; documented in `frontend/.env.example` |

---

## 12. Available Scripts

| Script | Where | What it does |
|---|---|---|
| npm run install:all | root | Installs backend and frontend dependencies |
| npm run dev:backend | root | Starts the backend dev server |
| npm run dev:frontend | root | Starts the frontend dev server |
| npm run quality-check | root | Runs backend lint, type-check, test, and complexity-audit in sequence |
| npm run db:migrate / db:status / db:check / db:setup | root (proxies to backend) | Database migration/health scripts |
| npm run dev | backend | `tsx watch` dev server with hot reload |
| npm run build | backend | TypeScript compile to `dist/` |
| npm run start | backend | Run compiled production output |
| npm run test / test:unit / test:integration / test:watch | backend | Vitest test suites |
| npm run lint / lint:check | backend | ESLint (with/without auto-fix) |
| npm run type-check | backend | `tsc --noEmit` |
| npm run complexity-audit | backend | ESLint run with only the `complexity` rule enabled (max 10) — a real, dedicated complexity check, not a duplicate of `lint:check` |
| npm run swagger-validate | backend | Validates the OpenAPI spec |
| npm run db:migrate / db:status / db:check / db:setup | backend | Direct migration/health scripts (see root aliases above) |
| npm run dev | frontend | Vite dev server (port 5173) |
| npm run build | frontend | `tsc && vite build` |
| npm run preview | frontend | Preview the production build locally |
| npm run test / test:watch | frontend | Vitest component unit tests |
| npm run test:e2e / test:e2e:ui | frontend | Playwright E2E suite (headless / UI mode) |
| npm run lint / lint:check | frontend | ESLint (with/without auto-fix) |
| npm run type-check | frontend | `tsc --noEmit` |

---

## 12.1 Continuous Integration

`.github/workflows/ci.yml` runs on every PR and push to `main`, as separate parallel jobs per app: lint, type-check, build (`tsc --project tsconfig.json` for backend, `tsc && vite build` for frontend), complexity-audit (backend only), unit tests, and integration tests (backend only, all external dependencies mocked at the module boundary — no live Redis/Supabase in CI). The build jobs actually produce output (`dist/`), catching emit-time or Vite-specific build failures that `tsc --noEmit` alone would miss, before a broken build surfaces at deploy time instead.

---

## 12.2 Deployment

Status: ✅

How it works: The backend deploys to Render as a single Node web service (`render.yaml` at repo root) — `rootDir: backend`, builds with `npm ci && npm run build`, runs with `npm start`, and is health-checked against `GET /health`. There is no separate worker process: the BullMQ `documentWorker` runs in-process inside the same server (`backend/src/index.ts`), so one Render service handles both HTTP traffic and document-ingestion jobs. All secrets (`GROQ_API_KEY`, `HUGGINGFACE_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, `ADMIN_SECRET`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`) are marked `sync: false` in `render.yaml` and must be entered manually in the Render dashboard — Zod validation in `config/env.ts` fails fast at boot if any are missing. Redis in production is an external managed instance (e.g. Upstash), not the local `docker-compose.yml` Redis, which is dev-only.

The frontend deploys to Vercel (`frontend/vercel.json`) as a static Vite build (`npm run build` → `dist/`), with an SPA rewrite (`/(.*) → /index.html`) so client-side routing works on refresh/deep links. Because the frontend and backend are on different origins, `VITE_API_BASE_URL` must be set in Vercel to the deployed Render backend's full URL (e.g. `https://rag-kb-backend.onrender.com/api`), and the backend's `CORS_ORIGIN` must be set to the deployed Vercel URL — both are required env vars with no production default, by design (see `config/env.ts`).

Supabase (pgvector) is already cloud-hosted regardless of environment — `supabase/migrations/` are applied via `npm run db:migrate` (reads `DATABASE_URL`) against the same project used in dev, or a separate production Supabase project if provisioned.

Clerk Google OAuth uses Clerk's shared dev credentials out of the box (see Known Issues below) — production deployments should wire up dedicated Google Cloud OAuth 2.0 credentials in the Clerk dashboard before going live.

---

## 13. Responsive Breakpoints

Tailwind screens are fully overridden: `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px` (no `2xl`). Playwright's `responsive.spec.ts` tests exactly 5 viewport widths.

| Breakpoint | Width | Layout changes |
|---|---|---|
| Mobile SM | 360px | Single-column layouts everywhere; hero right panel hidden; Documents grid/stats collapse to 1–2 columns; Upload's Recent Filings panel becomes a mobile accordion; Chat shows the mobile source top bar instead of the sidebar |
| Mobile LG | 480px | Same as 360px; touch-target height (≥44px) soft-checked on Chat |
| Tablet | 768px (`md`) | AppHeader tab labels hidden (icon-only); Chat switches from mobile top bar to desktop sidebar at this boundary; hero right panel becomes visible |
| Desktop MD | 1024px (`lg`) | Documents grid moves to 3 columns; Upload sidebar widens to 320px; Chat sidebar grid-template widens |
| Desktop LG | 1440px+ | Full layout — Documents grid at 4 columns, Upload sidebar fully visible, all AppHeader labels shown |

A global CSS rule (`overflow-x: hidden; max-width: 100vw` on `html`/`body`) plus `responsive.spec.ts` enforce no horizontal overflow at any of the 5 breakpoints across Landing/Upload/Chat/Documents. Body font size is asserted ≥16px at all breakpoints to prevent iOS auto-zoom on input focus.

---

## 6. UX Polish

### 6.1 Processing ETA on Upload
Status: ✅

How it works:
- When a document begins processing, the Upload queue item shows a consolidated progress block: a 3px progress bar with ETA and percentage text directly below it, all in one cohesive unit.
- During **uploading**: the bar fills proportionally (0→100%), with ETA ("~30s remaining") on the left and percentage ("67%") on the right, using `tabular-nums` for stable width.
- During **processing**: an indeterminate sliding bar (30% width, `@keyframes indeterminate` animation) with "Chewing… ~15s left" label below.
- ETA is calculated via `estimateProcessingSeconds(fileSizeBytes, fileType)` based on observed throughput (~50KB/s for the embedding pipeline). Multipliers: PDF 1.4x, DOCX 1.2x, TXT/MD 1.0x. Clamped to 5–120 seconds.
- `formatETA(seconds)` renders "~45s", "~2m", or "almost done" (<10s).
- Simulated progress ramps linearly from 5% to 90% over the estimated duration; jumps to 100% on actual completion.
- `prefers-reduced-motion` skips the progress animation; updates every 5 seconds.
- The indeterminate processing bar uses `position: absolute` within an `overflow: hidden` container to slide back and forth.

Files:
- `frontend/src/utils/estimateETA.ts`
- `frontend/src/stores/ragStore.ts` (UploadItem `processingStartedAt`)
- `frontend/src/pages/Upload.tsx` (QueueRow ETA display)

### 6.2 Chunk Quality Report (FilingReport)
Status: ✅

How it works:
- After a document finishes processing, its chunk quality stats are fetched from `GET /api/documents/:id` (which returns `{ document, chunkQuality }`).
- Backend computes `shortChunkCount` (<50 tokens), `longChunkCount` (>600 tokens), `avgTokenCount`, and a `grade` based on the combined short+long ratio (good: <10% of chunks problematic, fair: <30%, poor: ≥30%). `getChunkQualityStats(documentId, userId)` verifies the caller owns the document (same ownership check as `getDocument`/`deleteDocument`) before reading chunk stats, so it's safe to call directly rather than relying on callers to pre-check ownership.
- `FilingReport` is a collapsible card (collapsed by default) showing a grade badge (GOOD/FAIR/POOR with stamp-style rotation), a tri-color distribution bar (red/amber/green), and detailed counts. The toggle button is linked to the expandable region via `aria-controls`/`id` (React `useId()`) for screen-reader users. A plain-language cause hint (`detectLikelyCause`) covers both near-empty extraction (scanned/image-only PDFs) and chunks running too long (dense tables, unbroken text) — the two most common causes of a non-good grade.
- On the Documents page, each ready document card shows a small inline grade badge next to the file extension badge.

Files:
- `frontend/src/design-system/components/FilingReport.tsx`
- `frontend/src/services/api.ts` (ChunkQualityStats, DocumentWithQuality types)
- `backend/src/services/vectorStore.ts` (getChunkQualityStats)
- `backend/src/routes/documents.ts` (GET /:id returns chunkQuality)
- `frontend/src/pages/Documents.tsx` (inline grade badge)

### 6.3 Empty KB Onboarding
Status: ✅

How it works:
- When the knowledge base is empty and no chat messages exist, the Chat page shows an `OnboardingFlow` instead of the usual empty state.
- Three step cards guide the user: "File it", "Wait ~1 min", "Ask anything" — each with a stamp-style icon and step number badge.
- A CTA button navigates to `/upload`.
- Cards have slight rotation offsets for the analog index-card feel.
- Responsive: on mobile (≤768px), cards stack vertically at full width; on desktop they sit side by side at 180px each. Font sizes, padding, and gap scale with `useIsMobile(768)`.

Files:
- `frontend/src/design-system/components/OnboardingFlow.tsx`
- `frontend/src/pages/Chat.tsx` (showOnboarding condition)

### 6.4 Re-Query with One Source
Status: ✅

How it works:
- After the last assistant answer completes, three re-query buttons appear below the answer: "Summarize in 3 bullet points", "What are the key takeaways?", "Explain to a beginner".
- Each button submits a pre-filled query (wrapped in quotes around the original) without requiring the user to type.
- The `ChatMessage` type includes a `sourceQuery` field to identify the original question.
- Only shown on the last assistant message to avoid UI clutter.

Files:
- `frontend/src/design-system/components/ReQueryButtons.tsx`
- `frontend/src/design-system/components/AssistantMessage.tsx`
- `frontend/src/stores/ragStore.ts` (ChatMessage.sourceQuery)
- `frontend/src/pages/Chat.tsx` (handleReQuery, isLastAssistant logic)

### 6.5 Status Favicon
Status: ✅

How it works:
- A Canvas-based dynamic favicon displays a colored dot in the bottom-right corner reflecting the current upload processing state.
- States: idle (gray dot), processing (amber pulsing dot), ready (green dot), error (failed upload = red dot).
- The pulse animation uses `requestAnimationFrame` and is stopped when state changes.
- The original favicon is cached on mount; reset restores it.
- `useFaviconState` hook observes the `uploadQueue` from `ragStore` and drives the favicon manager.
- `initFavicon()` is called once on mount; `setFaviconState()` is called whenever `uploadQueue` changes.

Files:
- `frontend/src/utils/faviconManager.ts`
- `frontend/src/hooks/useFaviconState.ts`
- `frontend/src/App.tsx` (wires useFaviconState at root level)

---

## 14. Known Issues / Limitations

| Issue | Location | Severity | Workaround |
|---|---|---|---|
| Clerk Google OAuth uses Clerk's shared dev credentials by default; production deployments need their own Google Cloud OAuth 2.0 credentials wired into Clerk | Clerk Dashboard → SSO Connections → Google | Med | Follow console.cloud.google.com → APIs → Credentials before going to production |
| `GET /api/query/stream` is not independently authenticated (EventSource can't send an Authorization header) — it trusts the `queryId` capability instead of a fresh JWT check | `backend/src/routes/query.ts` | Low | Intentional design (see FEATURES.md §9.3); queryId is unguessable, single-use, and 2-minute TTL |
| `idx_chunks_content_trgm` (pg_trgm GIN index) is unused — no keyword/ILIKE search is implemented | `supabase/migrations/001_initial.sql` | Low | None; only vector search is exercised |
| Zip bomb detection reads ZIP headers without decompressing — a crafted archive with falsified headers could still bypass the ratio check in ways not covered by the data-descriptor guard | `backend/src/utils/fileValidator.ts` | Med | Full mitigation requires sandboxed decompression |
| No prompt-injection filtering or content/AV scanning on uploaded files beyond magic bytes and zip-bomb checks | `backend/src/utils/sanitize.ts`, `backend/src/utils/fileValidator.ts` | Med | Deferred — would require a classifier (prompt injection) or ClamAV/cloud AV integration (file scanning) |
| Missing unit tests for `validate.ts`, `errorHandler.ts`, `rateLimit.ts`, and `env.ts` (`sanitize.ts` and `errors.ts` now have dedicated unit test coverage) | `backend/tests/unit/` | Medium | Security-critical code paths without direct unit test coverage (covered indirectly via integration tests); add dedicated unit tests before production deployment |
| Chat.tsx is 808 lines and Documents.tsx is 743 lines — large components with multiple nested sub-components | `frontend/src/pages/Chat.tsx`, `frontend/src/pages/Documents.tsx` | Low | Extract sub-components into separate files during next refactor pass |
| A job that outlives its 5-minute hard timeout is signalled via `AbortSignal` at every write checkpoint (extractText itself still runs to completion, since it has no cancellation-aware checkpoints of its own) rather than being forcibly killed — Node has no primitive to abort arbitrary in-flight async work. The abandoned run still consumes worker resources until it naturally reaches its next checkpoint and exits via `JobCancelledError`. | `backend/src/queues/workers/documentWorker.ts` | Low | Acceptable at worker concurrency=1 and the project's expected document sizes; full cancellation would additionally require passing the signal into `extractText` itself |
| `GET /health` returns `{ status, timestamp }` without the standard `{ success, data }` envelope used everywhere else (unlike `GET /api/health`, which is correctly wrapped) | `backend/src/app.ts` | Low | Inconsistent but harmless — `/health` is an infra liveness probe, not a documented API response |
| SSE event payloads (`chunks`, `content`, `message`) are cast with `as` at the point of use with no runtime schema validation | `frontend/src/pages/Chat.tsx` | Med | Add a Zod schema for SSE event shapes and validate at the boundary |
| Upload response body is parsed via `JSON.parse(xhr.responseText) as {...}` with no runtime validation | `frontend/src/services/api.ts` | Med | Add Zod validation on the parsed upload response |
| `response.status === 204` path returns `undefined as T` — a type-unsafe cast | `frontend/src/services/api.ts` | Low | Add a `void`-return overload, or have callers check for null explicitly |
| Deprecated `document.execCommand('copy')` clipboard fallback — modern browsers all support the async Clipboard API | `frontend/src/utils/formatAnswerMarkdown.ts` | Low | Remove the fallback |
| Toast IDs use an unbounded module-level counter (`'toast-' + ++counter`) instead of `crypto.randomUUID()` | `frontend/src/design-system/components/useToast.ts` | Low | Cosmetic — would take ~285 million years of toasts to overflow `Number.MAX_SAFE_INTEGER` |
| Citation expansion panel has `role="dialog"`/`aria-modal="true"` but no focus trap and doesn't reuse the existing focus-trapped `Modal` component | `frontend/src/design-system/components/CitationChip.tsx` | Med | Route through `Modal`, or add an equivalent focus trap |
| Landing page's "Open app →" / "Sign in →" nav button lacks an `aria-label` | `frontend/src/pages/Landing.tsx` | Med | Add `aria-label="Open the application"` |
| Route handler functions in `documents.ts` lack per-function JSDoc (`@param`/`@returns`) required by project convention | `backend/src/routes/documents.ts` | Med | Add JSDoc blocks to each handler |
| No monitoring dashboard for the BullMQ queue (e.g. Bull Board) | — | Low | Use `GET /api/queue/status` / `GET /api/queue/job/:jobId` for ad-hoc inspection; wire up `@bull-board/express` if a dashboard becomes worth the dependency |
| Backend `tsconfig.json` excludes `tests/` from compilation, so `tsc --noEmit` never type-checks test files (a separate `tsconfig.test.json` exists but isn't part of the default `type-check` script) | `backend/tsconfig.json` | Med | Add a CI step running `tsc --noEmit -p tsconfig.test.json`, or fold tests into the default config |

---

## Implementation Gaps

Files referenced in FEATURES.md that were not found on disk:

| File | Feature | Section |
|---|---|---|
| *(none — all referenced files, including `backend/src/utils/readiness.ts`, verified on disk)* | — | — |

All source files cross-referenced against FEATURES.md exist on disk as of 2026-07-23.

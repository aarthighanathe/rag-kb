# Lumina

A production-grade Retrieval-Augmented Generation system. Upload documents (PDF, TXT, MD, DOCX, HTML), ask questions, and receive streamed answers with source citations — powered by HuggingFace embeddings, Supabase pgvector, and Groq LLM.

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> && cd rag-kb
npm run install:all

# 2. Copy env files and fill in secrets
cp backend/.env.example backend/.env               # backend secrets
cp frontend/.env.example frontend/.env.local        # frontend-only (VITE_* vars)
# Edit both files with your API keys (see Environment Variables below)

# 3. Run Supabase migrations — the ONLY supported way, in dev and production alike.
#    Tracks applied migrations in _schema_migrations so re-runs are safe and
#    idempotent. Do not paste migration SQL into the Supabase SQL Editor by
#    hand — that path leaves no record of what's been applied, and mixing the
#    two approaches risks skipped or duplicated migrations.
cd backend && npm run db:migrate

# 4. Start infrastructure
docker-compose up -d   # starts Redis on port 6379

# 5. Start servers
# Terminal 1 — backend
cd backend && npm run dev    # http://localhost:3000

# Terminal 2 — frontend
cd frontend && npm run dev   # http://localhost:5173
```

API docs: http://localhost:3000/api/docs

---

## Architecture

```
                         ┌──────────────────────┐
                         │       Browser         │
                         │  React 19 + Vite SPA   │
                         └──────────┬─────────────┘
                                    │ HTTPS (fetch / EventSource)
                                    ▼
                         ┌──────────────────────┐
                         │   Express 5 API       │
                         │  (Helmet, CORS, Zod,  │
                         │   rate limits, Clerk) │
                         └──────────┬─────────────┘
                 ┌──────────────────┼───────────────────┐
                 ▼                  ▼                    ▼
        ┌────────────────┐ ┌──────────────┐    ┌──────────────────┐
        │  BullMQ Queue   │ │  Supabase     │    │  Groq API         │
        │  (Redis)        │ │  (pgvector)   │    │  llama-3.1-8b-    │
        │  document-      │ │  documents,   │    │  instant          │
        │  processing     │ │  chunks,      │    │  (streaming)      │
        └────────┬────────┘ │  match_chunks │    └──────────────────┘
                 │           └──────────────┘
                 ▼
        ┌────────────────┐
        │ Document Worker │
        │ (concurrency=1) │
        │ extract→chunk→  │──────► HuggingFace Inference API
        │ embed→store     │        (sentence-transformers/all-MiniLM-L6-v2)
        └────────────────┘
```

Redis runs locally via `docker-compose up -d` (or Upstash in production). Supabase is
always remote/cloud-hosted — there is no local Postgres container.

### Upload flow
1. User drops or selects files in `FileDropzone` (Upload.tsx).
2. `ragStore.addToUploadQueue()` adds them as `queued` items in the Zustand store.
3. User clicks "File N document(s) →"; `ragStore.startUpload()` calls `uploadDocument()` (`api.ts`, XHR with progress events) for each file → `POST /api/upload`.
4. Backend: `requireAuth` (Clerk JWT) → `multer` (MIME allowlist + size/count limits) → `UploadRequestSchema` (Zod) → `validateFile()` (magic bytes, filename security, zip-bomb check) → file buffer staged in the Supabase Storage `documents` bucket under key `{documentId}_{sanitizedName}` (not local disk — a redeploy/restart on an ephemeral host like Render would otherwise wipe the file before the worker reads it) → `documents` row inserted (`status: pending`, owned by the authenticated user) → BullMQ job enqueued (`jobId = documentId`) → HTTP response returns immediately.
5. Frontend marks the item `processing` and starts polling `GET /api/documents/:id` every 3 seconds (`startPolling` in `ragStore.ts`).
6. BullMQ worker (concurrency 1) picks up the job: extract text (PDF/DOCX/TXT/MD/HTML) → chunk (512 tokens, 50 overlap, section-aware) → embed in batches of 32 via HuggingFace → upsert chunks + embeddings into `document_chunks` → auto-derive tags from detected section headings → set `documents.status = 'ready'` → delete the staged file from Supabase Storage.
7. Next poll tick sees `status: ready`, stops polling, and the item moves from "FILING QUEUE" to "JUST FILED" in the UI.

### Query flow
1. User types a question into the Chat textarea and submits (`sendQuery` in `ragStore.ts`).
2. Frontend: user turn added to `conversationHistory`; `POST /api/query` sent (with the user's Clerk JWT) with `{query, documentIds?, matchCount, similarityThreshold, relativeFloorGap?, history}`.
3. Backend stores the validated query in an in-memory map keyed by a new `queryId` (2-minute TTL) and returns `{queryId}` immediately.
4. Frontend opens `GET /api/query/stream?queryId=...` via `useSSE` (native `EventSource`, with exponential-backoff reconnect up to 3 attempts). This route can't carry the JWT (EventSource has no custom-header support), so it trusts the unguessable, single-use `queryId` instead.
5. Backend: consumes the pending query → emits `searching` → runs the query through the prompt-injection guard → sanitizes the query text → embeds it via HuggingFace (cache-checked first) → calls the `match_chunks` Supabase RPC (cosine similarity, IVFFlat index, relative-similarity floor, scoped to the query's owner) → re-ranks the results locally (similarity + keyword overlap) → emits `found` with citation data.
6. If chunks were retrieved, backend emits `generating`, then streams the Groq `llama-3.1-8b-instant` completion token-by-token as `token` events (system prompt + capped history + formatted context chunks + query).
7. Backend emits `complete` with final citations and latency; SSE connection closes.
8. Frontend: each `token` event appends to the streaming assistant message; on `complete`, citations are attached and the assistant turn is added to conversation history.

### Key design decisions
- **BullMQ for uploads, not inline processing** — document processing (parse → chunk → embed → store) can take 5–30 seconds per file, which would exceed typical HTTP timeouts. Offloading to a queue lets the upload endpoint respond immediately, and BullMQ's retry/backoff absorbs transient failures without losing the upload.
- **HuggingFace (`all-MiniLM-L6-v2`) over OpenAI embeddings** — free-tier compatible, 384-dimensional vectors keep storage and index size small, and it provides strong semantic similarity performance at this project's scale.
- **pgvector over a dedicated vector database** — keeps embeddings co-located with relational document metadata in the same Postgres instance, enabling JOIN-based filtering and avoiding a second operational dependency. IVFFlat (not HNSW) is the chosen index type for its lower memory footprint on Supabase's free/pro tiers and faster build time at this project's scale (<100k chunks).
- **Groq over OpenAI for LLM inference** — Groq's tokens/second throughput is significantly higher, which matters directly for streaming UX.
- **SSE over WebSocket for streaming answers** — the data flow is strictly one-directional (server → client token stream) and short-lived per query; SSE works over plain HTTP/1.1, simpler to operate behind standard reverse proxies than WebSocket.
- **Worker concurrency fixed at 1** — deliberately serializes document processing so concurrent jobs can't simultaneously exhaust the HuggingFace free-tier embedding rate limit.
- **`similarity_threshold` defaults to a permissive floor, not a strict one** — `all-MiniLM-L6-v2` is not tuned for asymmetric question/passage retrieval; legitimate matches can score anywhere from slightly negative to ~0.3. `match_count` (top-K) is what actually bounds result size.

### External services

| Service | Purpose | Free Tier Limit | Fallback if down |
|---|---|---|---|
| Groq | LLM inference (streaming chat completions) | 14,400 req/day | Query stream emits an `error` SSE event (`LLMError`); no automatic retry — the user must resubmit |
| HuggingFace | Text embeddings (documents + queries) | 1,000 req/day | Embedder retries 3× with exponential backoff (1s/2s/4s); after exhausting retries, throws `EmbeddingError` — upload jobs fail and retry via BullMQ (3 attempts), queries fail the stream with an `error` event |
| Supabase | Document/chunk metadata + pgvector storage | 500 MB (free tier) | Errors are mapped into friendlier messages; requests fail with a 500 `InternalError` |
| Redis (local docker-compose, or Upstash in prod) | BullMQ job queue backing store | Upstash free tier: 10K commands/day | If Redis is unreachable, uploads still accept the file and write the `documents` row, but the BullMQ enqueue call fails — the document stays stuck in `pending` with no processing job |

---

## Project Structure

```
rag-kb/
├── backend/
│   ├── src/
│   │   ├── app.ts                  # Express app factory — middleware chain, route mounts
│   │   ├── index.ts                # Process entrypoint — listen(), graceful shutdown
│   │   ├── config/
│   │   │   └── env.ts              # Zod-validated env vars, fail-fast on startup
│   │   ├── middleware/
│   │   │   ├── security.ts             # Helmet config + CORS allowlist
│   │   │   ├── correlationId.ts        # UUID v4 request tagging
│   │   │   ├── rateLimit.ts            # Per-route express-rate-limit instances
│   │   │   ├── validate.ts             # Generic Zod-schema validation middleware
│   │   │   ├── requireAuth.ts          # Clerk JWT verification
│   │   │   ├── promptInjectionGuard.ts # Query-text prompt-injection detection (POST /api/query)
│   │   │   └── errorHandler.ts         # Global error → JSON envelope translator
│   │   ├── routes/
│   │   │   ├── upload.ts           # POST /api/upload — file upload with progress
│   │   │   ├── query.ts            # POST /api/query + GET /api/query/stream (SSE) + GET /api/query/history
│   │   │   ├── documents.ts        # GET/PATCH/DELETE /api/documents, similarity, suggested-topics
│   │   │   ├── queue.ts            # GET /api/queue/status, GET /api/queue/job/:jobId
│   │   │   └── health.ts           # GET /health/{live,ready,detailed} — thin layer over utils/readiness.ts
│   │   ├── schemas/
│   │   │   ├── upload.schema.ts    # Zod schema for upload requests
│   │   │   ├── query.schema.ts     # Zod schema for query requests
│   │   │   ├── document.schema.ts  # Zod schema for document queries/tags
│   │   │   ├── queue.schema.ts     # Zod schema for admin queue endpoints
│   │   │   └── common.schema.ts    # Shared schema fragments (e.g. UUID params)
│   │   ├── services/
│   │   │   ├── chunker.ts              # Text chunking (token-aware, section-aware, hierarchical split)
│   │   │   ├── embedder.ts             # HuggingFace embedding (all-MiniLM-L6-v2)
│   │   │   ├── queryEmbeddingCache.ts  # Redis cache for single-query embeddings
│   │   │   ├── localReranker.ts        # Local similarity+keyword-overlap re-ranking (no external API)
│   │   │   ├── queryRewriter.ts        # Optional HyDE-lite query rewrite + contextual retrieval
│   │   │   ├── llm.ts                  # Groq LLM streaming (llama-3.1-8b-instant)
│   │   │   ├── answerValidator.ts      # Post-hoc answer validation (hallucination/contradiction checks)
│   │   │   ├── vectorStore.ts          # Supabase pgvector ops, similarity, tags, chunk quality
│   │   │   ├── storage.ts              # Supabase Storage staging (upload → worker handoff)
│   │   │   ├── backupService.ts        # pg_dump / Supabase-API table export + restore
│   │   │   └── dataRetention.ts        # Expired query_logs / audit_logs cleanup
│   │   ├── queues/
│   │   │   ├── documentQueue.ts    # BullMQ queue definition + job helpers
│   │   │   ├── cancellation.ts     # Per-attempt AbortController registry
│   │   │   └── workers/
│   │   │       ├── documentWorker.ts  # extract→chunk→embed→store→auto-tag pipeline
│   │   │       └── index.ts           # Worker registration
│   │   ├── utils/
│   │   │   ├── fileValidator.ts        # Magic bytes, zip bomb, filename security
│   │   │   ├── sanitize.ts             # Input sanitization (HTML, null bytes, query text)
│   │   │   ├── promptInjectionFilter.ts # Pattern/keyword-density injection risk classification
│   │   │   ├── auditLogger.ts          # Winston + durable audit_logs writes
│   │   │   ├── readiness.ts            # Supabase/Redis/HuggingFace/Groq dependency checks
│   │   │   ├── logger.ts               # Winston structured JSON logger
│   │   │   ├── errors.ts               # Custom error classes
│   │   │   └── dbError.ts              # Database error mapping
│   │   ├── types/
│   │   │   └── index.ts            # Shared TS types (AppError, domain types, Supabase row types)
│   │   └── swagger/
│   │       └── spec.ts             # OpenAPI 3.0 spec (served at /api/docs)
│   ├── scripts/                    # migrate.ts, check-supabase.ts, backup.ts (DB/backup CLIs)
│   ├── tests/
│   │   ├── unit/                   # Vitest unit tests
│   │   └── integration/            # Vitest integration tests (Supertest)
│   └── .env.example                # Backend environment variable template
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # Router, lazy page loading, error boundary
│   │   ├── main.tsx                # React root mount
│   │   ├── index.css               # Tailwind imports + global styles
│   │   ├── vite-env.d.ts           # Vite client types
│   │   ├── pages/
│   │   │   ├── Landing.tsx         # Marketing landing page (/)
│   │   │   ├── Upload.tsx          # File upload with queue management (/upload)
│   │   │   ├── Chat.tsx            # RAG chat interface (/chat)
│   │   │   ├── Documents.tsx       # Document archive with grid/table/map views (/documents)
│   │   │   └── DesignSystem.tsx    # Internal component showcase (/design-system)
│   │   ├── design-system/
│   │   │   ├── index.ts            # Barrel export for all design-system components
│   │   │   ├── tokens.ts           # Color/typography/breakpoint design tokens
│   │   │   └── components/
│   │   │       ├── AppHeader.tsx           # Dark top nav with logo and tab strip
│   │   │       ├── AssistantMessage.tsx    # Assistant message with citation linking
│   │   │       ├── Badge.tsx               # Status/label pill
│   │   │       ├── Button.tsx              # Primary action trigger
│   │   │       ├── ChatMessage.tsx         # Single chat turn with citations
│   │   │       ├── CitationChip.tsx        # Numbered source citation badge (focus-trapped expansion panel)
│   │   │       ├── CitationMarker.tsx      # Inline citation superscript
│   │   │       ├── ColHeader.tsx           # Sortable table column header (Documents page)
│   │   │       ├── ConfidenceBar.tsx       # Horizontal confidence bar
│   │   │       ├── DeleteModal.tsx         # Document delete confirmation modal
│   │   │       ├── DocFilterPanel.tsx      # Chat page source-document filter sidebar
│   │   │       ├── DocumentCard.tsx        # Documents page grid card
│   │   │       ├── DocumentRelationMap.tsx # Force-directed SVG similarity graph
│   │   │       ├── EmptyState.tsx          # Centered icon + message + action
│   │   │       ├── ExpandedRow.tsx         # Documents page table-view expanded row (chunk preview + tags)
│   │   │       ├── FileDropzone.tsx        # Drag-and-drop upload zone
│   │   │       ├── FilingReport.tsx        # Chunk quality report card
│   │   │       ├── IndexCard.tsx           # "Physical index card" citation preview
│   │   │       ├── Input.tsx               # Labeled text input
│   │   │       ├── LoadingSpinner.tsx      # Indeterminate progress bar
│   │   │       ├── MobileSourceTopBar.tsx  # Mobile horizontal source bar (Chat page)
│   │   │       ├── MobileSourcesDrawer.tsx # Mobile off-canvas source filter + history drawer
│   │   │       ├── Modal.tsx               # Focus-trapped dialog
│   │   │       ├── OnboardingFlow.tsx      # 3-step empty-KB onboarding
│   │   │       ├── QueryHistoryPanel.tsx   # Collapsible query history sidebar (localStorage + backend search)
│   │   │       ├── ReQueryButtons.tsx      # Re-query variant buttons
│   │   │       ├── RelevanceTimeline.tsx   # Bar chart of chunk relevance scores
│   │   │       ├── Select.tsx              # Styled native select
│   │   │       ├── SourcePanel.tsx         # Split-screen source documents panel
│   │   │       ├── StatusBar.tsx           # Chat page streaming-phase status pill
│   │   │       ├── StreamingCursor.tsx     # Blinking cursor for streaming text
│   │   │       ├── TagEditor.tsx           # Inline document tag chip editor
│   │   │       ├── Toast.tsx              # Sticky-note notification
│   │   │       └── useToast.ts            # Toast hook
│   │   ├── hooks/
│   │   │   ├── useSSE.ts                  # SSE connection with exponential backoff + Zod payload validation
│   │   │   ├── useQueryHistory.ts         # localStorage query history management
│   │   │   ├── useCitationHighlight.ts    # Bidirectional citation highlighting
│   │   │   ├── useKeyboardShortcuts.ts    # Global keyboard shortcut handler
│   │   │   ├── useMobileBreakpoint.ts     # Responsive breakpoint detection
│   │   │   ├── useFocusTrap.ts            # Shared focus-trap logic (Modal, drawers, citation panel)
│   │   │   └── useFaviconState.ts         # Dynamic favicon based on upload state
│   │   ├── stores/
│   │   │   └── ragStore.ts               # Zustand store — documents, upload, chat, history, tags
│   │   ├── contexts/
│   │   │   ├── ToastContext.tsx           # Toast notification provider
│   │   │   └── ChatLayoutContext.tsx      # Split-screen layout state provider
│   │   ├── services/
│   │   │   └── api.ts                    # fetch-based backend client (Zod-validated upload response)
│   │   ├── utils/
│   │   │   ├── formatAnswerMarkdown.ts   # Format answer text as clean Markdown
│   │   │   ├── exportConversation.ts     # Export full conversation as Markdown file
│   │   │   ├── parseCitationText.tsx     # Parse citation markers in LLM output
│   │   │   ├── calculateConfidence.ts    # Compute average similarity confidence
│   │   │   ├── chatCitations.ts          # Store Citation → ChatCitation shape conversion
│   │   │   ├── documentFormatters.ts     # Documents page formatting helpers (bytes, dates, status)
│   │   │   ├── queryHistory.ts           # localStorage CRUD for query history
│   │   │   ├── estimateETA.ts            # Processing time estimation
│   │   │   ├── timeAgo.ts               # Relative timestamp formatting
│   │   │   ├── faviconManager.ts         # Canvas-based dynamic favicon
│   │   │   ├── formatError.ts           # User-facing error message normalization
│   │   │   └── forceLayout.ts           # Fruchterman-Reingold force-directed layout
│   │   └── tests/
│   │       ├── setup.ts                  # Vitest setup (jest-dom, mocks)
│   │       ├── testIds.ts                # Shared test ID constants
│   │       ├── hooks/                    # Hook unit tests
│   │       ├── utils/                    # Utility unit tests
│   │       ├── stores/                   # Store unit tests
│   │       ├── pages/                    # Page component tests
│   │       ├── components/               # Component tests
│   │       └── design-system/            # Design-system component tests
│   ├── playwright/
│   │   └── e2e/                          # Playwright E2E specs
│   └── .env.example                      # Frontend environment variable template
├── supabase/
│   └── migrations/                       # Consolidated schema migration
├── FEATURES.md                           # Complete feature reference
├── docker-compose.yml                    # Local Redis only
└── package.json                          # Monorepo root scripts
```

---

## Available Scripts

### Backend (`cd backend`)

| Script | Description |
|---|---|
| `npm run dev` | Development server with hot reload (tsx watch) |
| `npm run build` | TypeScript compile to `dist/` |
| `npm run start` | Run compiled production output. Reads env vars from the process environment (matches how Render/most hosts inject them) — locally, run `node --env-file .env dist/index.js` instead if you want to test the production build against `backend/.env` |
| `npm run test` | Run all tests (unit + integration) |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | ESLint with auto-fix |
| `npm run lint:check` | ESLint without auto-fix |
| `npm run type-check` | `tsc --noEmit` (zero type errors required) |
| `npm run complexity-audit` | Cyclomatic complexity report (max 10) |
| `npm run swagger-validate` | Validate OpenAPI spec |
| `npm run db:migrate` | Apply pending Supabase migrations |
| `npm run db:status` | Check migration status |
| `npm run db:check` | Check Supabase connectivity |
| `npm run db:setup` | Run migrations + connectivity check |

### Frontend (`cd frontend`)

| Script | Description |
|---|---|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | Production build (`tsc && vite build`) |
| `npm run preview` | Preview production build locally |
| `npm run test` | Vitest component unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e` | Playwright E2E suite (headless) |
| `npm run test:e2e:ui` | Playwright E2E suite (UI mode) |
| `npm run lint` | ESLint with auto-fix |
| `npm run lint:check` | ESLint without auto-fix |
| `npm run type-check` | `tsc --noEmit` |

### Infrastructure (from project root)

| Script | Description |
|---|---|
| `docker-compose up -d` | Start Redis (port 6379) |
| `docker-compose down` | Stop services |
| `npm run db:migrate` | Apply pending Supabase migrations |
| `npm run db:status` | Check migration status |
| `npm run db:check` | Check Supabase connectivity |
| `npm run db:setup` | Run migrations + connectivity check |

---

## Environment Variables

Backend and frontend read from separate env files — see `backend/.env.example` and
`frontend/.env.example`. Setting a `VITE_*` variable in `backend/.env` has no effect;
Vite only reads `frontend/.env.local`.

### Backend — `backend/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | Yes | — | Groq API key for LLM inference (console.groq.com) |
| `HUGGINGFACE_TOKEN` | Yes | — | HuggingFace Inference API token (read role) |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | — | Supabase service_role key (not anon) |
| `DATABASE_URL` | Yes (migrations) | — | Postgres connection string for `npm run db:migrate` |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection URL for BullMQ |
| `REDIS_PASSWORD` | No | `changeme` | Redis password (must match docker-compose) |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | `development` \| `production` \| `test` |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Exact allowed frontend origin |
| `MAX_FILE_SIZE_MB` | No | `10` | Max upload size per file in MB |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rolling rate-limit window in ms |
| `RATE_LIMIT_MAX_UPLOAD` | No | `5` | Max uploads per IP per window |
| `RATE_LIMIT_MAX_QUERY` | No | `30` | Max queries per IP per window |
| `RATE_LIMIT_MAX_DOCUMENTS` | No | `100` | Max document list/delete requests per IP per window |
| `ADMIN_SECRET` | Yes | — | Shared secret for admin endpoints (min 32 chars) |
| `CLERK_SECRET_KEY` | Yes | — | Clerk Dashboard → API Keys (starts with `sk_`) — verifies user JWTs server-side |
| `CLERK_PUBLISHABLE_KEY` | Yes | — | Clerk Dashboard → API Keys (starts with `pk_`) |
| `LOG_LEVEL` | No | `info` | `error` \| `warn` \| `info` \| `debug` |
| `QUERY_REWRITE_ENABLED` | No | `false` | Extra Groq call per query to rewrite the question into a passage-like statement before embedding (HyDE-lite) |
| `CROSS_ENCODER_ENABLED` | No | `true` | Local re-ranking of retrieved chunks (query-term overlap blended with similarity) before generation — no external API call |
| `ANSWER_VALIDATION_ENABLED` | No | `false` | Extra Groq call after each answer to fact-check it against retrieved chunks, for a later confidence badge — does not alter the response already shown to the user |

### Frontend — `frontend/.env.local`

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_BASE_URL` | No | `/api` | Absolute backend URL (only when frontend/backend aren't same-origin, e.g. a split Render/Vercel deploy) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | — | Same value as `CLERK_PUBLISHABLE_KEY` (pk_...) — used by the frontend Clerk provider |

---

## Testing

```bash
# Backend unit + integration
cd backend && npm run test

# Backend unit only
cd backend && npm run test:unit

# Backend integration only
cd backend && npm run test:integration

# Frontend unit
cd frontend && npm run test

# E2E (Playwright)
cd frontend && npm run test:e2e

# Type check (both)
cd backend && npm run type-check
cd frontend && npm run type-check

# Full quality pipeline
npm run lint && npm run type-check && npm run test
```

Test coverage targets: 80% lines, 80% functions, 75% branches.

---

## Deployment

### Backend → Render (free tier)

1. Connect GitHub repo to Render
2. Root directory: `backend`
3. Build command: `npm run build`
4. Start command: `node dist/index.js`
5. Add all env vars in Render dashboard
6. Redis: use Upstash (free tier, add `REDIS_URL`)

### Frontend → Vercel (free tier)

1. Connect GitHub repo to Vercel
2. Root directory: `frontend`
3. Framework preset: Vite
4. Add `VITE_API_BASE_URL` pointing to your Render backend URL

### Database → Supabase (already set up)

- Run migrations via `cd backend && npm run db:migrate` (see Quick Start above) — the
  only supported migration path, so production stays in sync with what `_schema_migrations`
  says has been applied
- The same Supabase project works in both dev and production

### Estimated monthly cost: $0

All services used are on permanently free tiers.

---

## Security

- **Helmet** — strict CSP, HSTS, X-Content-Type-Options, Referrer-Policy, COEP/COOP/CORP
- **CORS** — single allowed origin (`CORS_ORIGIN`), methods restricted to GET/POST/DELETE
- **Rate limiting** — global 200/window + per-route limits (upload 5, query 30, documents 100)
- **Input validation** — Zod schemas on every route, unknown keys stripped
- **File validation** — magic-byte verification, filename security, zip-bomb detection
- **Error handling** — no stack traces leaked, correlation IDs on every request
- **Database access** — parameterized queries only, RLS enabled on all tables
- **Admin auth** — `crypto.timingSafeEqual` for secret comparison
- **User authentication** — Clerk JWT verification (Google OAuth) on `/api/upload`, `/api/documents`, and `/api/query`; every document and query is scoped to its owning user
- **Prompt injection filtering** — query text is classified for injection risk before validation; high-risk queries are rejected, medium-risk queries are sanitized in place, and the filter fails open (never blocks legitimate traffic on an internal error)
- **Audit logging** — document upload, document delete, and query submission are persisted to a durable `audit_logs` table, not just the application log

**Deferred:**
- No AV/malware scanning of uploaded file *content* (only magic-byte and zip-bomb checks — the prompt-injection filtering above covers query text, not file contents)

---

## Documentation

| Document | What it contains |
|---|---|
| [FEATURES.md](./FEATURES.md) | Complete feature reference — what's built, how each feature works, current status |
| [API docs](http://localhost:3000/api/docs) | Interactive Swagger UI (run backend first) |

---

## Known Limitations

- `GET /api/query/stream` cannot carry an Authorization header (EventSource limitation) — it relies on a short-lived, single-use `queryId` capability instead of a fresh JWT check (see [FEATURES.md](./FEATURES.md) §9.3)
- HuggingFace free tier: 1,000 req/day (query embeddings are cached to reduce repeat calls — see FEATURES.md §3.1c — but document ingestion still consumes real quota)
- Relation map similarity computation is hard-capped at 150 ready documents (fails fast with a clear message rather than a slow/degraded response) — no approximate-nearest-neighbor search yet
- In-memory query store (`queryId` map) — lost on backend restart
- No AV/malware scanning of uploaded file *content* — magic-byte and zip-bomb checks only (query *text* prompt-injection filtering is implemented — see Security above)
- No working dark mode — the toggle scaffolding exists but the color system isn't yet CSS-variable-based (see FEATURES.md Known Issues)

---

## License

MIT

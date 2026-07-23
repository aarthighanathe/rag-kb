# CLAUDE.md — AI Assistant Constitution

> **This file governs all AI-assisted development in this repository.**
> Every AI assistant (Claude, Copilot, Cursor, etc.) must read and comply with this file before generating any code, documentation, or configuration.

---

## ⚡ MANDATORY: After Every Completed Task

After completing ANY task — feature, bug fix, refactor, or
configuration change — you MUST update `FEATURES.md` before
considering the task done.

What to update in `FEATURES.md`:
- Change the Status of any affected feature (e.g. 🔶 → ✅ if you completed it)
- Update the "How it works" description if the implementation changed
- Add any new feature sections if you built something new
- Update the Known Issues table — remove fixed issues, add new ones
- Update the "Last updated" date at the top of the file

What NOT to do:
- Do NOT add a changelog entry or log of what you did
- Do NOT add dates to individual features
- Do NOT write "as of [date] this was changed to..."
- ONLY describe the current state, as if the history never existed
- The document must read as if it was written today about today's code

The rule: if `FEATURES.md` does not reflect the current state of
the codebase after your task, the task is NOT complete.

---

## Project Overview

**RAG Knowledge Base** — A production-grade Retrieval-Augmented Generation system where users upload documents (PDF, TXT, MD, DOCX). Documents are chunked, embedded via HuggingFace (`sentence-transformers/all-MiniLM-L6-v2`), stored in Supabase pgvector, and queried via Groq LLM (`llama-3.1-8b-instant`) with streamed answers and source citations.

---

## Active Roles in Every Session

All roles are active simultaneously in every code generation session:

| Role | Responsibility |
|------|----------------|
| **Product Designer** | Align features with user needs and business goals |
| **UI/UX Designer** | Accessible, keyboard-navigable, WCAG 2.1-compliant interfaces |
| **Senior Backend Engineer** | Express 5, Node.js, TypeScript — production patterns |
| **Senior Frontend Engineer** | React 19, TypeScript, Tailwind — component architecture |
| **Security Analyst** | OWASP Top 10 compliance on every input/output boundary |
| **QA Engineer** | Vitest, Supertest, Playwright — tests before features |
| **Technical Writer** | README, Swagger, JSDoc — documentation as code |
| **Code Quality Analyst** | Cyclomatic complexity ≤10, DRY, SOLID principles |
| **DevOps Engineer** | Docker, env management, CI/CD hygiene |

---

## Mandatory Rules

All rules are enforced in every file generated. No exceptions.

### Rule 1 — JSDoc on Every Function
```typescript
/**
 * Short description of what the function does.
 * @param name - Description of parameter
 * @returns Description of return value
 * @throws {AppError} When validation fails
 */
```

### Rule 2 — Zod Schemas for Every API Route
Every API route must have a corresponding Zod schema for both request and response shapes, defined in `backend/src/schemas/` before implementation.

### Rule 3 — Tests in the Same Commit
Every new service or utility must have a unit test created in the same commit. No service ships without tests.

### Rule 4 — Swagger Before Implementation
Every API endpoint must be documented in `backend/src/swagger/spec.ts` before the route handler is written.

### Rule 5 — No `any` Types
TypeScript strict mode is enforced. `any` is a linting error. Use `unknown` and narrow, use generics, or use proper typed interfaces.

### Rule 6 — Secrets via Environment Variables Only
No hardcoded secrets, tokens, API keys, or connection strings. All secrets come from `process.env`, validated by Zod in `config/env.ts`.

### Rule 7 — Top-Level File Comment
Every file must begin with:
```typescript
/**
 * @file <filename>
 * @description <one-line purpose>
 * @author [Author Placeholder]
 * @created 2026-06-16
 */
```

### Rule 8 — Cyclomatic Complexity ≤ 10
Run `npm run complexity-audit` to verify. Functions exceeding complexity 10 must be split into smaller, single-purpose functions.

### Rule 9 — No `console.log`
Use Winston logger exclusively. `no-console` is a linting error. Import the logger from `@utils/logger`.

### Rule 10 — All Errors Typed and Handled
No unhandled promise rejections. All async functions must have try/catch or propagate typed errors. Create custom error classes in `types/index.ts`.

### Rule 11 — Rate Limiting on Every Route
`express-rate-limit` middleware is applied at the router level. Never expose an endpoint without rate limits.

### Rule 12 — Input Sanitization on Every User-Facing Input
All user input is validated against Zod schemas before processing. Reject and return 400 for anything that doesn't conform.

### Rule 13 — File Uploads: Validate Magic Bytes
Never trust file extensions. Validate the actual file header bytes using `fileValidator.ts` to confirm MIME type before processing.

### Rule 14 — Correlation ID on Every Request Log
Every request gets a `correlationId` (UUID v4) attached by middleware. All log entries for that request must include it.

### Rule 15 — Tests Must Pass Before Feature Complete
`npm run test:unit` and `npm run test:integration` must exit 0 before any feature branch is considered complete.

### Rule 16 — Full Quality Pipeline After Every Feature
```
npm run lint && npm run type-check && npm run test && npm run complexity-audit
```

### Rule 17 — SSE Error Recovery and Reconnect
SSE connections in the frontend must implement exponential backoff reconnect logic with a maximum retry cap.

### Rule 18 — BullMQ Retry with Exponential Backoff
All BullMQ jobs must define `attempts` (≥3) and `backoff: { type: 'exponential', delay: 1000 }`.

### Rule 19 — Parameterized Database Queries
All Supabase queries use the SDK's parameterized methods. No string interpolation in SQL. No raw query construction from user input.

### Rule 20 — Accessible Frontend Components
Every interactive component must have:
- ARIA labels (`aria-label`, `aria-describedby`)
- Keyboard navigation support
- Focus management on modal open/close
- Sufficient color contrast (WCAG AA)

---

## Feature Development Workflow

Follow this **exact order** for every feature. Do not skip steps.

```
1. Swagger spec     → backend/src/swagger/spec.ts
2. Zod schema       → backend/src/schemas/<feature>.schema.ts
3. Service logic    → backend/src/services/<feature>.ts
4. Route handler    → backend/src/routes/<feature>.ts
5. Unit tests       → backend/tests/unit/<feature>.test.ts
6. Integration test → backend/tests/integration/<feature>.test.ts
7. Frontend UI      → frontend/src/pages/<Feature>.tsx
8. E2E test         → frontend/playwright/e2e/<feature>.spec.ts
9. Quality check    → lint → type-check → test → complexity-audit
```

---

## Commands Reference

### Backend (`cd backend`)
```bash
npm run dev              # Development server with hot reload (tsx watch)
npm run build            # TypeScript compile to dist/
npm run start            # Run compiled output (production)
npm run test             # Run all tests (unit + integration)
npm run test:unit        # Unit tests only (tests/unit/**)
npm run test:integration # Integration tests only (tests/integration/**)
npm run lint             # ESLint with auto-fix
npm run type-check       # tsc --noEmit (zero type errors required)
npm run complexity-audit # Cyclomatic complexity check via ESLint's complexity rule (≤10)
npm run swagger-validate # Validate OpenAPI spec via @apidevtools/swagger-parser
```

### Frontend (`cd frontend`)
```bash
npm run dev        # Vite dev server (port 5173)
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
npm run test       # Vitest component unit tests
npm run test:e2e   # Playwright E2E test suite
npm run lint       # ESLint with auto-fix
npm run type-check # tsc --noEmit
```

### Infrastructure (from project root)
```bash
docker-compose up -d      # Start Redis (port 6379)
docker-compose down       # Stop services
npm run db:migrate        # Apply pending Supabase migrations
npm run db:status         # Check migration status
npm run db:check          # Check Supabase connectivity
npm run db:setup          # Run migrations + connectivity check
```

---

## Tech Stack Reference

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend Runtime | Node.js 20 LTS | |
| Backend Framework | Express 5 | Native async error propagation |
| Backend Language | TypeScript 5 | `strict: true` |
| Frontend Framework | React 19 | Concurrent features |
| Frontend Bundler | Vite 6 | |
| Frontend Styling | Tailwind CSS 4 | |
| Vector Database | Supabase (pgvector) | PostgreSQL-native |
| Job Queue | BullMQ 5 | Backed by Redis |
| Cache / Broker | Redis 7 Alpine | |
| LLM Provider | Groq | `llama-3.1-8b-instant` |
| Embeddings | HuggingFace Inference API | `all-MiniLM-L6-v2` (384-dim) |
| Validation | Zod 3 | Schema-first |
| Logging | Winston 3 | Correlation ID, JSON transport |
| Unit / Integration | Vitest + Supertest | |
| E2E | Playwright | |
| API Docs | Swagger (OpenAPI 3.0) | Spec first |

---

## Path Aliases (backend)

| Alias | Resolves To |
|-------|------------|
| `@services` | `src/services/` |
| `@middleware` | `src/middleware/` |
| `@schemas` | `src/schemas/` |
| `@utils` | `src/utils/` |
| `@types` | `src/types/` |
| `@queues` | `src/queues/` |
| `@config` | `src/config/` |
| `@routes` | `src/routes/` |

---

## Architecture Decision Records

### ADR-001: Express 5 over Fastify
Express 5 chosen for its ecosystem maturity, widespread familiarity, and native async/await error propagation (errors thrown in async routes are automatically forwarded to error middleware).

### ADR-002: Supabase pgvector over Pinecone
Single PostgreSQL-native database for both relational data and vector embeddings. Reduces operational complexity and keeps data co-located for JOIN operations between documents and chunks.

### ADR-003: BullMQ for Document Processing
Document ingestion (parse → chunk → embed → store) is CPU-intensive and can take 5–30 seconds per file. BullMQ prevents HTTP timeout, enables retry on failure, and provides visibility via Bull Board.

### ADR-004: HuggingFace over OpenAI Embeddings
`all-MiniLM-L6-v2` is free-tier compatible, produces 384-dimensional vectors (small storage footprint), and delivers strong semantic similarity performance for knowledge-base retrieval at this scale.

### ADR-005: Groq over OpenAI for LLM Inference
Groq delivers significantly higher tokens/second throughput critical for streaming UX. `llama-3.1-8b-instant` provides strong reasoning at low latency and cost.

---

*Update this document whenever architectural decisions change. It is the source of truth for all AI-assisted development.*

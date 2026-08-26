/**
 * @file spec.ts
 * @description OpenAPI 3.0 specification — written FIRST before any route implementation
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

// ─── Re-usable inline schemas ──────────────────────────────────────────────────

const correlationIdHeader = {
  'X-Correlation-ID': {
    schema: { type: 'string', format: 'uuid' },
    description: 'Request correlation ID for log tracing',
  },
};

const rateLimitHeaders = {
  'RateLimit-Limit': {
    schema: { type: 'integer' },
    description: 'Maximum number of requests per window',
  },
  'RateLimit-Remaining': {
    schema: { type: 'integer' },
    description: 'Remaining requests in the current window',
  },
  'RateLimit-Reset': {
    schema: { type: 'integer' },
    description: 'Unix timestamp when the rate-limit window resets',
  },
};

/** Full OpenAPI 3.0 specification. All endpoints documented here before route code is written. */
export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Lumina API',
    version: '1.0.0',
    description: [
      'Upload documents (PDF, DOCX, TXT, MD, HTML), query them via RAG with streamed LLM answers,',
      'and manage your knowledge base. All success responses use the envelope:',
      '`{ success: true, data: T, meta?: { page?, total?, correlationId } }`.',
      'All error responses use: `{ success: false, error: { code, message, details? }, correlationId }`.',
    ].join(' '),
    contact: { name: 'API Support', email: 'support@example.com' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
    { url: 'https://api.example.com', description: 'Production' },
  ],
  tags: [
    { name: 'Health', description: 'Service liveness probes' },
    { name: 'Upload', description: 'Document upload and ingestion (async processing)' },
    { name: 'Query', description: 'RAG query with streamed LLM response via SSE' },
    { name: 'Documents', description: 'Document management — list, get, delete' },
    { name: 'Queue', description: 'Admin queue monitoring (requires X-Admin-Secret header)' },
  ],

  // Default security requirement — a Clerk-issued JWT (Google OAuth) is required on
  // every operation unless overridden with `security: []` at the operation level.
  security: [{ bearerAuth: [] }],

  // ─── Paths ────────────────────────────────────────────────────────────────────
  paths: {
    // ── Health ──────────────────────────────────────────────────────────────────
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'API readiness check',
        operationId: 'getApiHealth',
        description:
          'Returns service readiness — pings Supabase, Redis, HuggingFace, and Groq, and ' +
          'reports 503 if any is unreachable, so a load balancer can route around a ' +
          'degraded instance (e.g. a revoked HuggingFace token or a Groq outage, both of ' +
          'which otherwise fail silently at upload/query time with no health signal). ' +
          'No authentication required. No rate limit.',
        security: [],
        responses: {
          '200': {
            description: 'Service is ready — all dependencies reachable',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: {
                  success: true,
                  data: {
                    status: 'ok',
                    timestamp: '2026-06-16T12:00:00.000Z',
                    checks: {
                      supabase: { status: 'ok' },
                      redis: { status: 'ok' },
                      huggingface: { status: 'ok' },
                      groq: { status: 'ok' },
                    },
                  },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '503': {
            description: 'Service is not ready — one or more dependencies unreachable',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: {
                  success: false,
                  data: {
                    status: 'error',
                    timestamp: '2026-06-16T12:00:00.000Z',
                    checks: {
                      supabase: { status: 'ok' },
                      redis: { status: 'error', error: 'Redis PING check timed out after 3000ms' },
                      huggingface: { status: 'ok' },
                      groq: { status: 'ok' },
                    },
                  },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Basic liveness check',
        operationId: 'getHealthRoot',
        description:
          'The process is up and can answer HTTP requests. Does not check any ' +
          'dependency and does not use the standard {success,data,meta} envelope — ' +
          'mirrors the top-level GET /health in app.ts. No authentication required.',
        security: [],
        responses: {
          '200': {
            description: 'Process is up',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlainHealthResponse' },
                example: { status: 'ok', timestamp: '2026-06-16T12:00:00.000Z' },
              },
            },
          },
        },
      },
    },

    '/health/detailed': {
      get: {
        tags: ['Health'],
        summary: 'Full dependency health breakdown',
        operationId: 'getHealthDetailed',
        description:
          'Runs the same dependency check as GET /api/health (Supabase, Redis, ' +
          "HuggingFace, Groq) but returns it under this route's own plain response " +
          'shape rather than the {success,data,meta} envelope. 503 if any dependency ' +
          'is unreachable. No authentication required.',
        security: [],
        responses: {
          '200': {
            description: 'All dependencies reachable',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlainHealthDetailedResponse' },
                example: {
                  status: 'healthy',
                  timestamp: '2026-06-16T12:00:00.000Z',
                  checks: {
                    supabase: { status: 'ok' },
                    redis: { status: 'ok' },
                    huggingface: { status: 'ok' },
                    groq: { status: 'ok' },
                  },
                },
              },
            },
          },
          '503': {
            description: 'One or more dependencies unreachable',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlainHealthDetailedResponse' },
                example: {
                  status: 'unhealthy',
                  timestamp: '2026-06-16T12:00:00.000Z',
                  checks: {
                    supabase: { status: 'ok' },
                    redis: { status: 'error', error: 'Redis PING check timed out after 3000ms' },
                    huggingface: { status: 'ok' },
                    groq: { status: 'ok' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        operationId: 'getHealthReady',
        description:
          'Returns 200 only if every dependency is reachable, so an orchestrator can ' +
          'hold traffic back from an instance that is up but not actually able to ' +
          'serve requests. No authentication required.',
        security: [],
        responses: {
          '200': {
            description: 'Ready to receive traffic',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlainHealthResponse' },
                example: { status: 'ready', timestamp: '2026-06-16T12:00:00.000Z' },
              },
            },
          },
          '503': {
            description: 'Not ready — one or more dependencies unreachable',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlainHealthDetailedResponse' },
                example: {
                  status: 'not_ready',
                  timestamp: '2026-06-16T12:00:00.000Z',
                  checks: {
                    supabase: { status: 'ok' },
                    redis: { status: 'error', error: 'Redis PING check timed out after 3000ms' },
                    huggingface: { status: 'ok' },
                    groq: { status: 'ok' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        operationId: 'getHealthLive',
        description:
          'The process is alive — no dependency checks. An orchestrator should ' +
          "restart the instance if this doesn't respond, but should not use it to " +
          "gate traffic routing (that is /health/ready's job). No authentication required.",
        security: [],
        responses: {
          '200': {
            description: 'Process is alive',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlainHealthResponse' },
                example: { status: 'alive', timestamp: '2026-06-16T12:00:00.000Z' },
              },
            },
          },
        },
      },
    },

    // ── Upload ──────────────────────────────────────────────────────────────────
    '/api/upload': {
      post: {
        tags: ['Upload'],
        summary: 'Upload one or more documents',
        operationId: 'uploadDocuments',
        description: [
          'Accepts 1–5 files via multipart/form-data. Each file is validated by magic bytes',
          '(not just extension). Accepted types: PDF, DOCX, TXT, MD, HTML. Maximum 10 MB per file.',
          'Returns immediately with document IDs and job IDs — processing is async.',
        ].join(' '),
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['files'],
                properties: {
                  files: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 5,
                    items: {
                      type: 'string',
                      format: 'binary',
                    },
                    description: '1–5 document files. Each max 10 MB.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'All files accepted and queued for processing',
            headers: { ...correlationIdHeader, ...rateLimitHeaders },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UploadSuccessResponse' },
                example: {
                  success: true,
                  data: {
                    documents: [
                      {
                        id: '550e8400-e29b-41d4-a716-446655440001',
                        filename: 'report.pdf',
                        status: 'pending',
                        jobId: '550e8400-e29b-41d4-a716-446655440002',
                      },
                    ],
                  },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '207': {
            description:
              'Partial success — some files were accepted and queued while others failed ' +
              'validation or processing. Each file is processed independently, so a failure ' +
              'in one file does not roll back or discard files that already succeeded.',
            headers: { ...correlationIdHeader, ...rateLimitHeaders },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UploadSuccessResponse' },
                example: {
                  success: true,
                  data: {
                    documents: [
                      {
                        id: '550e8400-e29b-41d4-a716-446655440001',
                        filename: 'report.pdf',
                        status: 'pending',
                        jobId: '550e8400-e29b-41d4-a716-446655440002',
                      },
                    ],
                    errors: [
                      {
                        filename: 'bad-file.exe.pdf',
                        message: 'Invalid filename: double extension',
                      },
                    ],
                  },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '413': { $ref: '#/components/responses/FileTooLarge' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    // ── Documents ───────────────────────────────────────────────────────────────
    '/api/documents': {
      get: {
        tags: ['Documents'],
        summary: 'List all documents',
        operationId: 'listDocuments',
        description:
          'Returns a paginated list of all uploaded documents with optional status filter.',
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: 'Page number (1-based)',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Results per page (max 100)',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by document processing status',
            schema: { type: 'string', enum: ['pending', 'processing', 'ready', 'failed'] },
          },
        ],
        responses: {
          '200': {
            description: 'Paginated document list',
            headers: { ...correlationIdHeader, ...rateLimitHeaders },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ListDocumentsResponse' },
                example: {
                  success: true,
                  data: [
                    {
                      id: '550e8400-e29b-41d4-a716-446655440001',
                      filename: 'report.pdf',
                      mime_type: 'application/pdf',
                      size_bytes: 204800,
                      status: 'ready',
                      chunk_count: 12,
                      created_at: '2026-06-16T10:00:00.000Z',
                      updated_at: '2026-06-16T10:01:30.000Z',
                      error_message: null,
                    },
                  ],
                  meta: {
                    page: 1,
                    total: 1,
                    correlationId: '550e8400-e29b-41d4-a716-446655440000',
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    '/api/documents/{id}': {
      get: {
        tags: ['Documents'],
        summary: 'Get a single document by ID',
        operationId: 'getDocument',
        description:
          'Returns full metadata for a document including chunk count and processing status.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Document UUID',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Document record',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DocumentResponse' },
                example: {
                  success: true,
                  data: {
                    id: '550e8400-e29b-41d4-a716-446655440001',
                    filename: 'report.pdf',
                    mime_type: 'application/pdf',
                    size_bytes: 204800,
                    status: 'ready',
                    chunk_count: 12,
                    created_at: '2026-06-16T10:00:00.000Z',
                    updated_at: '2026-06-16T10:01:30.000Z',
                    error_message: null,
                  },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
      delete: {
        tags: ['Documents'],
        summary: 'Delete a document and all its vector chunks',
        operationId: 'deleteDocument',
        description: [
          'Permanently deletes the document record and all associated chunks from the vector store.',
          'Cascade delete is handled at the database level.',
        ].join(' '),
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Document UUID',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Document and chunks deleted successfully',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DeleteDocumentResponse' },
                example: {
                  success: true,
                  data: {
                    documentId: '550e8400-e29b-41d4-a716-446655440001',
                    message: 'Document deleted successfully.',
                  },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    // ── Documents — Tags ───────────────────────────────────────────────────────
    '/api/documents/{id}/tags': {
      patch: {
        tags: ['Documents'],
        summary: "Replace a document's tags",
        operationId: 'updateDocumentTags',
        description: [
          'Replaces the full tag list for a document. Tags are either auto-derived from',
          'detected section headings during processing, or manually set by the owner via',
          'this endpoint — both share the same field, so this call overwrites auto-tags too.',
        ].join(' '),
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Document UUID',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateDocumentTagsRequest' },
              example: { tags: ['pricing', 'onboarding'] },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tags updated successfully',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateDocumentTagsResponse' },
                example: {
                  success: true,
                  data: {
                    documentId: '550e8400-e29b-41d4-a716-446655440001',
                    tags: ['pricing', 'onboarding'],
                  },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': { $ref: '#/components/responses/NotFound' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    // ── Documents — Similarity ────────────────────────────────────────────────
    '/api/documents/similarity': {
      get: {
        tags: ['Documents'],
        summary: 'Get pairwise document similarity scores',
        operationId: 'getDocumentSimilarity',
        description: [
          'Computes average cosine similarity between each pair of ready documents',
          'by sampling up to 5 representative chunks per document and averaging',
          'pairwise scores. Only returns pairs with similarity above the minimum',
          'threshold. Requires at least 2 ready documents. Every document is capped',
          'at its 8 strongest edges so a "hub" document similar to many others does',
          'not produce an unreadably dense result. If the caller has more than 150',
          'ready documents, computation is skipped entirely and `capped: true` is',
          'returned with an empty `pairs` array — see `readyDocumentCount`.',
        ].join(' '),
        parameters: [
          {
            name: 'threshold',
            in: 'query',
            description: 'Minimum similarity to include a pair (0–1)',
            schema: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
          },
        ],
        responses: {
          '200': {
            description: 'Document similarity pairs and metadata',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimilarityResponse' },
                example: {
                  success: true,
                  data: {
                    pairs: [{ documentA: 'uuid-1', documentB: 'uuid-2', similarity: 0.72 }],
                    documents: [
                      {
                        id: 'uuid-1',
                        filename: 'report.pdf',
                        mime_type: 'application/pdf',
                        size_bytes: 204800,
                        status: 'ready',
                        chunk_count: 12,
                        created_at: '2026-06-16T10:00:00.000Z',
                        updated_at: '2026-06-16T10:01:30.000Z',
                      },
                    ],
                    capped: false,
                    readyDocumentCount: 2,
                  },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    '/api/documents/suggested-topics': {
      get: {
        tags: ['Documents'],
        summary: 'Get content-aware query suggestions for the given documents',
        operationId: 'getSuggestedTopics',
        description: [
          "Returns up to 8 distinct section headings drawn from the given documents' chunks",
          '(populated by section-aware chunking for documents with real structure — headings,',
          'numbered sections). Intended for building "Tell me about X" query suggestions in the',
          'chat UI instead of generic hardcoded prompts. Returns an empty array for documents',
          'with no detected section structure (e.g. plain unstructured text) — the client falls',
          'back to generic suggestions in that case. MUST be mounted before /:id to avoid Express',
          'matching "suggested-topics" as a UUID.',
        ].join(' '),
        parameters: [
          {
            name: 'documentIds',
            in: 'query',
            required: true,
            description: 'Comma-separated list of document UUIDs (1-10)',
            schema: { type: 'string' },
            example: '550e8400-e29b-41d4-a716-446655440001,550e8400-e29b-41d4-a716-446655440002',
          },
        ],
        responses: {
          '200': {
            description: 'Distinct section headings across the given (owned) documents',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuggestedTopicsResponse' },
                example: {
                  success: true,
                  data: { topics: ['Introduction', 'Pricing', 'Getting Started'] },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    // ── Query ───────────────────────────────────────────────────────────────────
    '/api/query': {
      post: {
        tags: ['Query'],
        summary: 'Initiate a RAG query — returns a queryId for the stream endpoint',
        operationId: 'initiateQuery',
        description: [
          'Validates query parameters and stores them server-side.',
          'Returns a `queryId` that must be passed to `GET /api/query/stream` within 2 minutes.',
          'The stream endpoint embeds the query, searches the vector store, and streams the LLM answer.',
        ].join(' '),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/QueryRequest' },
              example: {
                query: 'What are the main conclusions of the report?',
                matchCount: 5,
                similarityThreshold: 0,
                documentIds: ['550e8400-e29b-41d4-a716-446655440001'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Query registered — use the queryId to open the SSE stream',
            headers: { ...correlationIdHeader, ...rateLimitHeaders },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/QueryInitResponse' },
                example: {
                  success: true,
                  data: { queryId: '550e8400-e29b-41d4-a716-446655440099' },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    '/api/query/history': {
      get: {
        tags: ['Query'],
        summary: "Search the caller's full query history",
        operationId: 'getQueryHistory',
        description: [
          'Lists (optionally text-searched) past queries from `query_logs`, most recent first,',
          'scoped to the caller. This is the durable full history — distinct from the 10-entry',
          'localStorage cache the frontend also keeps for instant client-side access without a',
          'round-trip. MUST be mounted before any `/:queryId`-shaped route to avoid Express',
          'matching "history" as a UUID.',
        ].join(' '),
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: 'Page number (1-based)',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Results per page',
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
          {
            name: 'search',
            in: 'query',
            description: 'Case-insensitive substring match against past query text',
            schema: { type: 'string', maxLength: 200 },
          },
        ],
        responses: {
          '200': {
            description: 'Paginated query history',
            headers: { ...correlationIdHeader, ...rateLimitHeaders },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/QueryHistoryResponse' },
                example: {
                  success: true,
                  data: [
                    {
                      id: '550e8400-e29b-41d4-a716-446655440099',
                      queryText: 'What is the refund policy?',
                      responsePreview: 'Refunds are issued within 14 days...',
                      latencyMs: 1240,
                      feedback: 'helpful',
                      validationConfidence: 0.92,
                      createdAt: '2026-06-16T12:00:00.000Z',
                    },
                  ],
                  meta: {
                    page: 1,
                    total: 1,
                    correlationId: '550e8400-e29b-41d4-a716-446655440000',
                  },
                },
              },
            },
          },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    '/api/query/{queryId}/feedback': {
      post: {
        tags: ['Query'],
        summary: "Rate a completed query's answer as helpful or not helpful",
        operationId: 'submitQueryFeedback',
        description: [
          'Records (or updates) a helpfulness rating for a previously completed query.',
          "`queryId` here is the `query_logs` row id returned in the SSE `complete` event's",
          'payload — NOT the ephemeral queryId used by `POST /api/query` / `GET /api/query/stream`,',
          'which is single-use and deleted once the stream starts.',
          '',
          'Idempotent: resubmitting feedback for the same query overwrites the prior value',
          'rather than erroring or creating a duplicate. Scoped to the caller — a queryId',
          "belonging to another user returns 404, not 403, matching this API's IDOR-prevention",
          'convention elsewhere (an attacker cannot distinguish "not yours" from "doesn\'t exist").',
        ].join(' '),
        parameters: [
          {
            name: 'queryId',
            in: 'path',
            required: true,
            description: 'query_logs row id, from the SSE complete event payload',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/QueryFeedbackRequest' },
              example: { feedback: 'helpful' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Feedback recorded',
            headers: { ...correlationIdHeader, ...rateLimitHeaders },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/QueryFeedbackResponse' },
                example: {
                  success: true,
                  data: { queryId: '550e8400-e29b-41d4-a716-446655440099', feedback: 'helpful' },
                  meta: { correlationId: '550e8400-e29b-41d4-a716-446655440000' },
                },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    '/api/query/stream': {
      get: {
        tags: ['Query'],
        summary: 'Stream the RAG answer for a previously initiated query',
        operationId: 'streamQuery',
        // Opened via native EventSource, which cannot send an Authorization header.
        // Not independently authenticated — the queryId itself is the capability
        // (unguessable UUID, single-use, 2-minute TTL, scoped to the user who
        // created it via the authenticated POST /api/query above).
        security: [],
        description: [
          'Opens a Server-Sent Events (SSE) stream. The `queryId` must have been obtained from',
          '`POST /api/query` within the last 2 minutes. Not independently authenticated —',
          'see the security note on this operation for why.',
          '',
          '**Event sequence:**',
          '1. `searching` — vector search in progress',
          '2. `found`     — retrieved chunks (CitationChips)',
          '3. `generating`— LLM inference in progress',
          '4. `token`     — incremental LLM token (repeats)',
          '5. `complete`  — final citations, stream closes',
          '',
          'On failure: `error` event then connection closed.',
        ].join('\n'),
        parameters: [
          {
            name: 'queryId',
            in: 'query',
            required: true,
            description: 'Query ID returned by POST /api/query',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'SSE stream of events',
            headers: {
              ...correlationIdHeader,
              'Content-Type': {
                schema: { type: 'string', enum: ['text/event-stream'] },
              },
              'Cache-Control': {
                schema: { type: 'string', enum: ['no-cache'] },
              },
              'X-Accel-Buffering': {
                schema: { type: 'string', enum: ['no'] },
              },
            },
            content: {
              'text/event-stream': {
                schema: { $ref: '#/components/schemas/SseEventStream' },
                example: [
                  'event: searching',
                  'data: {"type":"searching","message":"Finding relevant chunks..."}',
                  '',
                  'event: found',
                  'data: {"type":"found","chunks":[{"documentId":"...","filename":"report.pdf","chunkId":"...","similarity":0.92,"excerpt":"..."}]}',
                  '',
                  'event: generating',
                  'data: {"type":"generating","message":"Generating answer..."}',
                  '',
                  'event: token',
                  'data: {"type":"token","content":"The main "}',
                  '',
                  'event: token',
                  'data: {"type":"token","content":"conclusion is..."}',
                  '',
                  'event: complete',
                  'data: {"type":"complete","citations":[{"documentId":"...","filename":"report.pdf","chunkId":"...","similarity":0.92,"excerpt":"..."}]}',
                ].join('\n'),
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': {
            description: 'Query ID not found or expired (TTL: 2 minutes)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    // ── Queue (Admin) ───────────────────────────────────────────────────────────
    '/api/queue/status': {
      get: {
        tags: ['Queue'],
        summary: 'Get queue job counts (admin)',
        operationId: 'getQueueStatus',
        description: 'Returns job counts across all states. Requires `X-Admin-Secret` header.',
        security: [{ adminSecret: [] }],
        responses: {
          '200': {
            description: 'Queue job counts',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/QueueStatus' },
                example: {
                  queueName: 'document-processing',
                  waiting: 3,
                  active: 1,
                  completed: 42,
                  failed: 2,
                  delayed: 0,
                },
              },
            },
          },
          '401': {
            description: 'Missing X-Admin-Secret header',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
          '403': {
            description: 'Invalid admin secret',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    '/api/queue/cache-stats': {
      get: {
        tags: ['Queue'],
        summary: 'Get query-embedding cache hit/miss stats (admin)',
        operationId: 'getCacheStats',
        description:
          'Returns in-process hit/miss/error counters for the Redis-backed query-embedding cache ' +
          '(queryEmbeddingCache.ts), plus the derived hit rate. Counters reset on process restart ' +
          'and are not aggregated across instances. Requires `X-Admin-Secret` header.',
        security: [{ adminSecret: [] }],
        responses: {
          '200': {
            description: 'Cache instrumentation snapshot',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CacheStats' },
                example: { hits: 34, misses: 66, errors: 0, hitRatePercent: 34 },
              },
            },
          },
          '401': {
            description: 'Missing X-Admin-Secret header',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
          '403': {
            description: 'Invalid admin secret',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },

    '/api/queue/job/{jobId}': {
      get: {
        tags: ['Queue'],
        summary: 'Get status of a specific job (admin)',
        operationId: 'getJobStatus',
        description:
          'Returns state, progress, result, and failure reason. `jobId` equals `documentId`.',
        security: [{ adminSecret: [] }],
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            description: 'BullMQ job ID (same as documentId)',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Job status snapshot',
            headers: { ...correlationIdHeader },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobStatus' },
                example: {
                  jobId: '550e8400-e29b-41d4-a716-446655440001',
                  state: 'completed',
                  progress: 100,
                  result: { chunkCount: 12, processingTimeMs: 4200 },
                  failedReason: null,
                  timestamp: 1718532000000,
                  finishedOn: 1718532004200,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': {
            description: 'Missing X-Admin-Secret header',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
          '403': {
            description: 'Invalid admin secret',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
  },

  // ─── Components ───────────────────────────────────────────────────────────────
  components: {
    schemas: {
      // ── Envelope schemas ───────────────────────────────────────────────────────
      ErrorDetail: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: {
            type: 'string',
            description: 'Machine-readable error code',
            example: 'VALIDATION_ERROR',
          },
          message: {
            type: 'string',
            description: 'Human-readable description',
            example: 'query must be at least 3 characters',
          },
          details: {
            description: 'Additional structured details (e.g. Zod field errors)',
            nullable: true,
          },
        },
      },

      ErrorEnvelope: {
        type: 'object',
        required: ['success', 'error', 'correlationId'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: { $ref: '#/components/schemas/ErrorDetail' },
          correlationId: { type: 'string', format: 'uuid' },
        },
      },

      // ── Domain schemas ─────────────────────────────────────────────────────────
      HealthResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            required: ['status', 'timestamp'],
            properties: {
              status: { type: 'string', enum: ['ok', 'error'] },
              timestamp: { type: 'string', format: 'date-time' },
              checks: {
                type: 'object',
                properties: {
                  supabase: { $ref: '#/components/schemas/DependencyCheck' },
                  redis: { $ref: '#/components/schemas/DependencyCheck' },
                  huggingface: { $ref: '#/components/schemas/DependencyCheck' },
                  groq: { $ref: '#/components/schemas/DependencyCheck' },
                },
              },
            },
          },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      DependencyCheck: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['ok', 'error'] },
          error: { type: 'string' },
        },
      },

      PlainHealthResponse: {
        type: 'object',
        description:
          'Response shape used by /health, /health/ready, and /health/live — no {success,data,meta} envelope.',
        required: ['status', 'timestamp'],
        properties: {
          status: { type: 'string', enum: ['ok', 'ready', 'not_ready', 'alive'] },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },

      PlainHealthDetailedResponse: {
        type: 'object',
        description:
          'Response shape used by /health/detailed and the 503 case of /health/ready — no {success,data,meta} envelope.',
        required: ['status', 'timestamp'],
        properties: {
          status: { type: 'string', enum: ['healthy', 'unhealthy', 'not_ready'] },
          timestamp: { type: 'string', format: 'date-time' },
          checks: {
            type: 'object',
            properties: {
              supabase: { $ref: '#/components/schemas/DependencyCheck' },
              redis: { $ref: '#/components/schemas/DependencyCheck' },
              huggingface: { $ref: '#/components/schemas/DependencyCheck' },
              groq: { $ref: '#/components/schemas/DependencyCheck' },
            },
          },
        },
      },

      Document: {
        type: 'object',
        required: [
          'id',
          'filename',
          'mime_type',
          'size_bytes',
          'status',
          'chunk_count',
          'created_at',
          'updated_at',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          filename: { type: 'string', example: 'quarterly-report.pdf' },
          mime_type: {
            type: 'string',
            enum: [
              'application/pdf',
              'text/plain',
              'text/markdown',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ],
          },
          size_bytes: { type: 'integer', minimum: 1, example: 204800 },
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'ready', 'failed'],
            description: 'Processing lifecycle status',
          },
          chunk_count: {
            type: 'integer',
            minimum: 0,
            description: 'Number of vector chunks after processing (0 until ready)',
          },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          error_message: {
            type: 'string',
            nullable: true,
            description: 'Set only when status is "failed"',
          },
        },
      },

      UploadedDocumentItem: {
        type: 'object',
        required: ['id', 'filename', 'status', 'jobId'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          filename: { type: 'string' },
          status: { type: 'string', enum: ['pending'] },
          jobId: { type: 'string', description: 'BullMQ job ID for tracking processing progress' },
          duplicateOf: {
            type: 'object',
            nullable: true,
            description:
              "Present only when this upload's content (SHA-256 of the raw file bytes) matches an existing document already owned by the caller. Informational only — the upload still proceeds and creates a new document; this is a hint the client can use to warn the user, not a block.",
            properties: {
              id: {
                type: 'string',
                format: 'uuid',
                description: 'ID of the earlier document with identical content',
              },
              filename: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'processing', 'ready', 'failed'] },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },

      UploadSuccessResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['documents'],
            properties: {
              documents: {
                type: 'array',
                items: { $ref: '#/components/schemas/UploadedDocumentItem' },
              },
              errors: {
                type: 'array',
                description:
                  'Present (207 response) when one or more files in the batch failed ' +
                  'independently while others succeeded.',
                items: {
                  type: 'object',
                  required: ['filename', 'message'],
                  properties: {
                    filename: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      ListDocumentsResponse: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Document' },
          },
          meta: {
            type: 'object',
            required: ['page', 'total', 'correlationId'],
            properties: {
              page: { type: 'integer', minimum: 1 },
              total: { type: 'integer', minimum: 0 },
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      DocumentResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: '#/components/schemas/Document' },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      DeleteDocumentResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['documentId', 'message'],
            properties: {
              documentId: { type: 'string', format: 'uuid' },
              message: { type: 'string', example: 'Document deleted successfully.' },
            },
          },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      SimilarityResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['pairs', 'documents', 'capped', 'readyDocumentCount'],
            properties: {
              pairs: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['documentA', 'documentB', 'similarity'],
                  properties: {
                    documentA: { type: 'string', format: 'uuid' },
                    documentB: { type: 'string', format: 'uuid' },
                    similarity: { type: 'number', minimum: 0, maximum: 1 },
                  },
                },
              },
              documents: {
                type: 'array',
                items: { $ref: '#/components/schemas/Document' },
              },
              capped: {
                type: 'boolean',
                description:
                  'True when readyDocumentCount exceeded the 150-document computation ceiling — pairs is always empty in that case',
              },
              readyDocumentCount: {
                type: 'integer',
                minimum: 0,
                description:
                  "Count of the caller's ready documents considered, whether or not computation actually ran",
              },
            },
          },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      SuggestedTopicsResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['topics'],
            properties: {
              topics: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 8,
                description:
                  "Distinct section headings drawn from the given documents' chunks, in first-seen order",
              },
            },
          },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      UpdateDocumentTagsRequest: {
        type: 'object',
        required: ['tags'],
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 40 },
            maxItems: 20,
            description:
              "Replaces the document's full tag list (both auto-derived and manually-added tags share this one field)",
          },
        },
      },

      UpdateDocumentTagsResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['documentId', 'tags'],
            properties: {
              documentId: { type: 'string', format: 'uuid' },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      QueryRequest: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            minLength: 3,
            maxLength: 1000,
            description: 'Natural-language question to answer from the knowledge base',
            example: 'What are the main conclusions of the quarterly report?',
          },
          documentIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            maxItems: 10,
            description: 'Optional: restrict search to specific documents',
          },
          matchCount: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            default: 5,
            description: 'Number of similar chunks to retrieve for context',
          },
          similarityThreshold: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0,
            description:
              'Minimum cosine similarity score for a chunk to be included. ' +
              'Scores are clamped to [0, 1] (cosine distance artefacts removed). ' +
              'Defaults to 0 — matchCount bounds result size. Raise (e.g. 0.15) ' +
              'if irrelevant chunks appear in answers.',
          },
          history: {
            type: 'array',
            maxItems: 6,
            default: [],
            description:
              'Previous conversation turns (oldest first). Max 6 msgs = 3 user+assistant exchanges. Each content capped at 2000 chars.',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string', maxLength: 2000 },
              },
            },
          },
        },
      },

      QueryInitResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['queryId'],
            properties: {
              queryId: {
                type: 'string',
                format: 'uuid',
                description: 'Pass this to GET /api/query/stream within 2 minutes',
              },
            },
          },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      QueryFeedbackRequest: {
        type: 'object',
        required: ['feedback'],
        properties: {
          feedback: {
            type: 'string',
            enum: ['helpful', 'not_helpful'],
          },
        },
      },

      QueryFeedbackResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['queryId', 'feedback'],
            properties: {
              queryId: { type: 'string', format: 'uuid' },
              feedback: { type: 'string', enum: ['helpful', 'not_helpful'] },
            },
          },
          meta: {
            type: 'object',
            properties: {
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      QueryHistoryResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'queryText', 'createdAt'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                queryText: { type: 'string' },
                responsePreview: { type: 'string', nullable: true },
                latencyMs: { type: 'integer', nullable: true },
                feedback: { type: 'string', enum: ['helpful', 'not_helpful'], nullable: true },
                validationConfidence: { type: 'number', minimum: 0, maximum: 1, nullable: true },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
          meta: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              total: { type: 'integer' },
              correlationId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },

      CitationChip: {
        type: 'object',
        required: ['documentId', 'filename', 'chunkId', 'similarity', 'excerpt'],
        properties: {
          documentId: { type: 'string', format: 'uuid' },
          filename: { type: 'string' },
          chunkId: { type: 'string', format: 'uuid' },
          similarity: { type: 'number', minimum: 0, maximum: 1 },
          excerpt: { type: 'string', description: 'First 200 characters of the chunk' },
        },
      },

      SseEventStream: {
        type: 'string',
        description: [
          'Server-Sent Events stream. Each event is separated by \\n\\n.',
          'Event types: searching | found | generating | token | complete | error',
        ].join(' '),
      },

      CacheStats: {
        type: 'object',
        required: ['hits', 'misses', 'errors', 'hitRatePercent'],
        properties: {
          hits: {
            type: 'integer',
            description: 'Query-embedding cache hits since process start',
            minimum: 0,
          },
          misses: {
            type: 'integer',
            description: 'Query-embedding cache misses since process start (includes Redis errors)',
            minimum: 0,
          },
          errors: {
            type: 'integer',
            description: 'Redis errors encountered during cache lookups (a subset of misses)',
            minimum: 0,
          },
          hitRatePercent: {
            type: 'number',
            description:
              'hits / (hits + misses) as a percentage, 0 when no lookups have occurred yet',
            minimum: 0,
            maximum: 100,
          },
        },
      },

      QueueStatus: {
        type: 'object',
        required: ['queueName', 'waiting', 'active', 'completed', 'failed', 'delayed'],
        properties: {
          queueName: { type: 'string', example: 'document-processing' },
          waiting: { type: 'integer', description: 'Jobs waiting to be picked up', minimum: 0 },
          active: { type: 'integer', description: 'Jobs currently being processed', minimum: 0 },
          completed: { type: 'integer', description: 'Completed jobs (capped at 100)', minimum: 0 },
          failed: { type: 'integer', description: 'Failed jobs (capped at 50)', minimum: 0 },
          delayed: { type: 'integer', description: 'Jobs scheduled for future retry', minimum: 0 },
        },
      },

      JobStatus: {
        type: 'object',
        required: ['jobId', 'state', 'progress', 'timestamp'],
        properties: {
          jobId: { type: 'string' },
          state: {
            type: 'string',
            enum: ['waiting', 'active', 'completed', 'failed', 'delayed', 'unknown'],
          },
          progress: { type: 'number', minimum: 0, maximum: 100 },
          result: {
            type: 'object',
            nullable: true,
            properties: {
              chunkCount: { type: 'integer', minimum: 0 },
              processingTimeMs: { type: 'integer', minimum: 0 },
            },
          },
          failedReason: { type: 'string', nullable: true },
          timestamp: { type: 'integer', description: 'Unix ms when job was created' },
          finishedOn: { type: 'integer', nullable: true, description: 'Unix ms when job finished' },
        },
      },
    },

    // ── Shared responses ───────────────────────────────────────────────────────
    responses: {
      BadRequest: {
        description: 'Bad request — invalid file type, missing required field, or malformed input',
        headers: { ...correlationIdHeader },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            example: {
              success: false,
              error: { code: 'FILE_UNSUPPORTED_TYPE', message: 'Unsupported MIME type: text/html' },
              correlationId: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        },
      },

      UnprocessableEntity: {
        description: 'Unprocessable — request body parsed but failed schema validation',
        headers: { ...correlationIdHeader },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            example: {
              success: false,
              error: {
                code: 'UNPROCESSABLE_ENTITY',
                message: 'Validation failed',
                details: [
                  { field: 'query', message: 'String must contain at least 3 character(s)' },
                ],
              },
              correlationId: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        },
      },

      NotFound: {
        description: 'Resource not found',
        headers: { ...correlationIdHeader },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            example: {
              success: false,
              error: { code: 'NOT_FOUND', message: 'Document abc123 not found' },
              correlationId: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        },
      },

      FileTooLarge: {
        description: 'File exceeds the 10 MB maximum size',
        headers: { ...correlationIdHeader },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            example: {
              success: false,
              error: { code: 'FILE_TOO_LARGE', message: 'File size exceeds the 10 MB limit' },
              correlationId: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        },
      },

      RateLimited: {
        description: 'Too many requests — rate limit exceeded',
        headers: {
          ...correlationIdHeader,
          'RateLimit-Limit': { schema: { type: 'integer' } },
          'RateLimit-Remaining': { schema: { type: 'integer' } },
          'RateLimit-Reset': { schema: { type: 'integer' } },
          'Retry-After': { schema: { type: 'integer' } },
        },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            example: {
              success: false,
              error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests, please try again later.',
              },
              correlationId: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        },
      },

      InternalServerError: {
        description: 'Unexpected server error — stack trace never exposed in production',
        headers: { ...correlationIdHeader },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            example: {
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
              correlationId: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        },
      },
    },

    securitySchemes: {
      adminSecret: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Admin-Secret',
        description: 'Static secret for admin-only queue monitoring endpoints',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Clerk-issued JWT (Google OAuth). Verified server-side via @clerk/backend.',
      },
    },
  },
};

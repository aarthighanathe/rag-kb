/**
 * @file testIds.ts
 * @description Central registry of all data-testid values used in the application.
 *   Import from this module in both tests and components to keep IDs in sync.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

// ─── FileDropzone ─────────────────────────────────────────────────────────────

export const FILE_INPUT       = 'file-input'      as const;
export const FILE_DROPZONE    = 'file-dropzone'   as const;
export const FILE_QUEUE_ITEM  = 'file-queue-item' as const;
export const FILE_ERROR       = 'file-error'      as const;
export const FILE_REMOVE_BTN  = 'file-remove-btn' as const;

// ─── Upload page ──────────────────────────────────────────────────────────────

export const UPLOAD_QUEUE_ITEM  = 'upload-queue-item'  as const;
export const UPLOAD_BUTTON      = 'upload-button'      as const;
export const STATUS_BADGE       = 'status-badge'       as const;

// ─── Chat page ────────────────────────────────────────────────────────────────

export const QUERY_INPUT        = 'query-input'        as const;
export const SEND_BUTTON        = 'send-button'        as const;
export const STOP_BUTTON        = 'stop-button'        as const;
export const USER_MESSAGE       = 'user-message'       as const;
export const ASSISTANT_MESSAGE  = 'assistant-message'  as const;
export const STREAMING_CURSOR   = 'streaming-cursor'   as const;
export const CITATION_CHIP      = 'citation-chip'      as const;
export const EMPTY_STATE        = 'empty-state'        as const;
export const SUGGESTED_QUERY    = 'suggested-query'    as const;
export const CHAT_MESSAGE_LIST  = 'chat-message-list'  as const;
export const CLEAR_CHAT_BTN     = 'clear-chat-btn'     as const;

// ─── Citation interactivity ────────────────────────────────────────────────────

export const CITATION_MARKER    = 'citation-marker'    as const;
export const CITED_SPAN         = 'cited-span'         as const;
export const INDEX_CARD         = 'index-card'          as const;
export const ASSISTANT_MSG      = 'assistant-message'  as const;

// ─── Confidence & Relevance Timeline ──────────────────────────────────────────

export const CONFIDENCE_BAR     = 'confidence-bar'      as const;
export const CONFIDENCE_WARNING = 'confidence-warning'  as const;
export const RELEVANCE_TIMELINE = 'relevance-timeline'  as const;
export const TIMELINE_TOGGLE    = 'timeline-toggle'     as const;

// ─── Query History ───────────────────────────────────────────────────────────

export const HISTORY_SECTION    = 'history-section'      as const;
export const HISTORY_ENTRY      = 'history-entry'        as const;
export const HISTORY_DELETE     = 'history-delete'       as const;
export const HISTORY_CLEAR      = 'history-clear'        as const;
export const HISTORY_TOGGLE     = 'history-toggle'       as const;

// ─── Split-screen ───────────────────────────────────────────────────────────

export const SPLIT_TOGGLE       = 'split-toggle'         as const;
export const SOURCE_PANEL       = 'source-panel'         as const;
export const SOURCE_SEARCHING   = 'source-searching'     as const;
export const SOURCE_PANEL_CARD  = 'source-panel-card'    as const;
export const SOURCE_CONFIDENCE  = 'source-confidence'    as const;

// ─── Documents page ───────────────────────────────────────────────────────────

export const DOCUMENT_ROW       = 'document-row'       as const;
export const STATUS_BADGE_READY = 'status-badge-ready' as const;
export const DELETE_BUTTON      = 'delete-button'      as const;
export const CONFIRM_MODAL      = 'confirm-modal'      as const;
export const CONFIRM_DELETE     = 'confirm-delete'     as const;
export const CANCEL_DELETE      = 'cancel-delete'      as const;
export const REFRESH_BUTTON     = 'refresh-button'     as const;
export const SELECT_ALL_CHECK   = 'select-all-check'   as const;
export const DOC_ROW_CHECK      = 'doc-row-check'      as const;
export const BULK_DELETE_BTN    = 'bulk-delete-btn'    as const;

// ─── Document relation map ─────────────────────────────────────────────────

export const MAP_TOGGLE        = 'map-toggle'          as const;
export const RELATION_MAP      = 'relation-map'        as const;
export const MAP_NODE          = 'map-node'            as const;
export const MAP_EDGE          = 'map-edge'            as const;
export const MAP_DETAIL_PANEL  = 'map-detail-panel'    as const;
export const MAP_RECOMPUTE     = 'map-recompute'       as const;
export const STAT_TOTAL_DOCS   = 'stat-total-docs'     as const;

// ─── Onboarding flow ─────────────────────────────────────────────────────

export const ONBOARDING_STEP   = 'onboarding-step'     as const;
export const ONBOARDING_CTA    = 'onboarding-cta'      as const;

// ─── Filing report ───────────────────────────────────────────────────────

export const FILING_REPORT     = 'filing-report'       as const;
export const FILING_GRADE      = 'filing-grade'        as const;
export const FILING_BAR        = 'filing-bar'          as const;

// ─── Re-query buttons ────────────────────────────────────────────────

export const RE_QUERY_BUTTONS  = 're-query-buttons'    as const;
export const RE_QUERY_BTN      = 're-query-btn'        as const;

// ─── Convenience object (for Playwright `page.getByTestId`) ───────────────────

/** All test IDs collected as a plain object for direct lookup. */
export const TEST_IDS = {
  // FileDropzone
  FILE_INPUT,
  FILE_DROPZONE,
  FILE_QUEUE_ITEM,
  FILE_ERROR,
  FILE_REMOVE_BTN,
  // Upload
  UPLOAD_QUEUE_ITEM,
  UPLOAD_BUTTON,
  STATUS_BADGE,
  // Chat
  QUERY_INPUT,
  SEND_BUTTON,
  STOP_BUTTON,
  USER_MESSAGE,
  ASSISTANT_MESSAGE,
  STREAMING_CURSOR,
  CITATION_CHIP,
  EMPTY_STATE,
  SUGGESTED_QUERY,
  CHAT_MESSAGE_LIST,
  CLEAR_CHAT_BTN,
  // Citation interactivity
  CITATION_MARKER,
  CITED_SPAN,
  INDEX_CARD,
  ASSISTANT_MSG,
  // Confidence & Timeline
  CONFIDENCE_BAR,
  CONFIDENCE_WARNING,
  RELEVANCE_TIMELINE,
  TIMELINE_TOGGLE,
  // Query History
  HISTORY_SECTION,
  HISTORY_ENTRY,
  HISTORY_DELETE,
  HISTORY_CLEAR,
  HISTORY_TOGGLE,
  // Split-screen
  SPLIT_TOGGLE,
  SOURCE_PANEL,
  SOURCE_SEARCHING,
  SOURCE_PANEL_CARD,
  SOURCE_CONFIDENCE,
  // Documents
  DOCUMENT_ROW,
  STATUS_BADGE_READY,
  DELETE_BUTTON,
  CONFIRM_MODAL,
  CONFIRM_DELETE,
  CANCEL_DELETE,
  REFRESH_BUTTON,
  SELECT_ALL_CHECK,
  DOC_ROW_CHECK,
  BULK_DELETE_BTN,
  // Document relation map
  MAP_TOGGLE,
  RELATION_MAP,
  MAP_NODE,
  MAP_EDGE,
  MAP_DETAIL_PANEL,
  MAP_RECOMPUTE,
  STAT_TOTAL_DOCS,
  // Onboarding
  ONBOARDING_STEP,
  ONBOARDING_CTA,
  // Filing report
  FILING_REPORT,
  FILING_GRADE,
  FILING_BAR,
  // Re-query
  RE_QUERY_BUTTONS,
  RE_QUERY_BTN,
} as const;

export type TestId = (typeof TEST_IDS)[keyof typeof TEST_IDS];

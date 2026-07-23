/**
 * @file ChatLayoutContext.tsx
 * @description React context for split-screen chat layout state.
 *   Provides layout mode flags and citation highlight handlers
 *   so AssistantMessage and SourcePanel can sync across panels.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { createContext, useContext, useRef, useCallback, type RefObject } from 'react';

export interface ChatLayoutContextValue {
  /** Whether split-screen mode is active */
  splitScreenEnabled: boolean;
  /** When true, IndexCards are hidden inside AssistantMessage (shown in SourcePanel) */
  hideIndexCards: boolean;
  /** When true, RelevanceTimeline toggle is hidden in AssistantMessage */
  hideTimeline: boolean;
  /** Currently active citation index (1-based), or null — for split-mode sync */
  activeCitation: number | null;
  /** Set active citation on hover/focus of a citation marker */
  onCitationEnter: (index: number) => void;
  /** Clear active citation on mouse leave / blur */
  onCitationLeave: () => void;
  /** Scroll card into view and pulse it */
  onCitationClick: (index: number) => void;
  /**
   * Lets the last-rendered AssistantMessage register its copy handler so
   * other chat-level coordination (e.g. Chat.tsx's "copy last answer"
   * keyboard shortcut) can trigger it without reaching into the DOM.
   * Registering `null` clears the handler (e.g. on unmount).
   */
  registerLastMessageCopyHandler: (handler: (() => void) | null) => void;
  /** Invokes the currently-registered last-message copy handler, if any. */
  copyLastMessage: () => void;
}

/**
 * Backs `registerLastMessageCopyHandler`/`copyLastMessage` for the default
 * (non-provided) context value, so consumers outside a ChatLayoutProvider
 * still get a working, no-op-safe pair instead of throwing.
 */
function createDefaultCopyHandlerRef(): {
  ref: RefObject<(() => void) | null>;
  register: (handler: (() => void) | null) => void;
  invoke: () => void;
} {
  const ref: RefObject<(() => void) | null> = { current: null };
  return {
    ref,
    register: (handler) => { ref.current = handler; },
    invoke: () => { ref.current?.(); },
  };
}

const defaultCopyHandler = createDefaultCopyHandlerRef();

const ChatLayoutContext = createContext<ChatLayoutContextValue>({
  splitScreenEnabled: false,
  hideIndexCards: false,
  hideTimeline: false,
  activeCitation: null,
  onCitationEnter: () => {},
  onCitationLeave: () => {},
  onCitationClick: () => {},
  registerLastMessageCopyHandler: defaultCopyHandler.register,
  copyLastMessage: defaultCopyHandler.invoke,
});

/** Hook to consume ChatLayoutContext. */
export function useChatLayout(): ChatLayoutContextValue {
  return useContext(ChatLayoutContext);
}

/** Provider component for chat layout context. */
export const ChatLayoutProvider = ChatLayoutContext.Provider;

/**
 * Creates a stable `registerLastMessageCopyHandler`/`copyLastMessage` pair
 * for the provider owner (Chat.tsx) to spread into its ChatLayoutProvider
 * `value`. Backed by a ref (not state) since registration happens on every
 * render of the last assistant message and must never itself trigger a
 * re-render.
 */
export function useLastMessageCopyRegistry(): Pick<
  ChatLayoutContextValue,
  'registerLastMessageCopyHandler' | 'copyLastMessage'
> {
  const handlerRef = useRef<(() => void) | null>(null);

  const registerLastMessageCopyHandler = useCallback((handler: (() => void) | null) => {
    handlerRef.current = handler;
  }, []);

  const copyLastMessage = useCallback(() => {
    handlerRef.current?.();
  }, []);

  return { registerLastMessageCopyHandler, copyLastMessage };
}

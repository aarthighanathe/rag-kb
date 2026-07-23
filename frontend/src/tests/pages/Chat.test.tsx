/**
 * @file Chat.test.tsx
 * @description Tests for the Chat page — empty state, messaging, input shortcuts,
 *   citations, and document filter checkboxes.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Chat } from '../../pages/Chat';
import { useRagStore } from '../../stores/ragStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../stores/ragStore', () => ({
  useRagStore: vi.fn(),
}));

vi.mock('../../hooks/useSSE', () => ({
  useSSE: vi.fn(() => ({ isConnected: false, disconnect: vi.fn() })),
}));

vi.mock('../../services/api', () => ({
  getQueryStreamUrl: (id: string) => `/api/query/${id}/stream`,
}));

vi.mock('../../contexts/ToastContext', () => ({
  useAppToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), dismissAll: vi.fn(), toasts: [] }),
}));

const sendQueryMock = vi.fn().mockResolvedValue(undefined);
const clearChatMock = vi.fn();
const appendStreamTokenMock = vi.fn();
const finalizeStreamingMessageMock = vi.fn();
const setStreamingErrorMock = vi.fn();
const fetchDocumentsMock = vi.fn().mockResolvedValue(undefined);
const clearHistoryMock = vi.fn();

const baseStore = {
  messages: [],
  isStreaming: false,
  currentQueryId: null,
  sendQuery: sendQueryMock,
  clearChat: clearChatMock,
  appendStreamToken: appendStreamTokenMock,
  finalizeStreamingMessage: finalizeStreamingMessageMock,
  setStreamingError: setStreamingErrorMock,
  documents: [{ id: 'doc-1', filename: 'test.pdf', status: 'ready', chunk_count: 10 }],
  documentsLoading: false,
  fetchDocuments: fetchDocumentsMock,
  conversationHistory: [],
  clearHistory: clearHistoryMock,
  lastCompletedQuery: null,
  clearLastCompletedQuery: vi.fn(),
};

function renderChat(storeOverrides: object = {}) {
  (useRagStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    ...baseStore,
    ...storeOverrides,
  });
  return render(
    <MemoryRouter>
      <Chat />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Chat page — empty state', () => {
  it('renders without crashing', () => {
    renderChat();
    expect(screen.getByRole('log', { name: /chat messages/i })).toBeInTheDocument();
  });

  it('shows empty state when no messages', () => {
    renderChat();
    expect(screen.getByText(/ask about your documents/i)).toBeInTheDocument();
  });

  it('renders suggested queries', () => {
    renderChat();
    expect(screen.getByRole('button', { name: /summarize all uploaded documents/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /key topics/i })).toBeInTheDocument();
  });

  it('clicking a suggested query pre-fills the input', async () => {
    renderChat();
    await userEvent.click(
      screen.getByRole('button', { name: /summarize all uploaded documents/i }),
    );
    const input = screen.getByRole('textbox', { name: /question input/i });
    expect((input as HTMLTextAreaElement).value).toBe('Summarize all uploaded documents');
  });
});

describe('Chat page — input and submission', () => {
  it('Ctrl+Enter sends the message', async () => {
    renderChat();
    const input = screen.getByRole('textbox', { name: /question input/i });
    await userEvent.type(input, 'What is RAG?');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => {
      expect(sendQueryMock).toHaveBeenCalledWith('What is RAG?', undefined);
    });
  });

  it('send button is disabled when input is empty', () => {
    renderChat();
    const sendBtn = screen.getByRole('button', { name: /send question/i });
    expect(sendBtn).toBeDisabled();
  });

  it('send button enables when input has text', async () => {
    renderChat();
    const input = screen.getByRole('textbox', { name: /question input/i });
    await userEvent.type(input, 'test query');
    const sendBtn = screen.getByRole('button', { name: /send question/i });
    expect(sendBtn).not.toBeDisabled();
  });

  it('input is disabled while streaming', () => {
    renderChat({ isStreaming: true });
    const input = screen.getByRole('textbox', { name: /question input/i });
    expect(input).toBeDisabled();
  });

  it('stop button appears when streaming', () => {
    renderChat({ isStreaming: true });
    expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();
  });
});

describe('Chat page — messages', () => {
  it('renders user and assistant messages', () => {
    renderChat({
      messages: [
        { id: '1', role: 'user',      content: 'Hello?',     timestamp: Date.now(), isStreaming: false },
        { id: '2', role: 'assistant', content: 'Hi there!',  timestamp: Date.now(), isStreaming: false },
      ],
    });
    expect(screen.getByText('Hello?')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows Clear button when there are messages', () => {
    renderChat({
      messages: [{ id: '1', role: 'user', content: 'x', timestamp: Date.now() }],
    });
    expect(screen.getByRole('button', { name: /clear chat history/i })).toBeInTheDocument();
  });

  it('Clear button calls clearChat', async () => {
    renderChat({
      messages: [{ id: '1', role: 'user', content: 'x', timestamp: Date.now() }],
    });
    await userEvent.click(screen.getByRole('button', { name: /clear chat history/i }));
    expect(clearChatMock).toHaveBeenCalledOnce();
  });

  it('renders streaming cursor for streaming messages', () => {
    renderChat({
      messages: [
        { id: '2', role: 'assistant', content: 'Thinking', timestamp: Date.now(), isStreaming: true },
      ],
    });
    // StreamingCursor renders the blinking char; just ensure no crash and message present
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
  });
});

describe('Chat page — Ctrl+Shift+C copies the last completed assistant answer', () => {
  it('copies the LAST completed assistant message, not the first', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderChat({
      messages: [
        { id: '1', role: 'user',      content: 'First question',  timestamp: Date.now(), isStreaming: false },
        { id: '2', role: 'assistant', content: 'First answer',    timestamp: Date.now(), isStreaming: false },
        { id: '3', role: 'user',      content: 'Second question', timestamp: Date.now(), isStreaming: false },
        { id: '4', role: 'assistant', content: 'Second answer',   timestamp: Date.now(), isStreaming: false },
      ],
    });

    // Regression test for the bug where handleCopyLast queried
    // `[data-testid="assistant-message"]` (exact match) against elements that
    // actually render `data-testid="assistant-message-${messageIndex}"` — the
    // selector never matched anything, making Ctrl+Shift+C a silent no-op.
    await userEvent.keyboard('{Control>}{Shift>}C{/Shift}{/Control}');

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    expect(writeText.mock.calls[0]?.[0]).toContain('Second answer');
    expect(writeText.mock.calls[0]?.[0]).not.toContain('First answer');
  });

  it('does nothing when there is no completed assistant message yet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderChat({
      messages: [
        { id: '1', role: 'user', content: 'Only a question so far', timestamp: Date.now(), isStreaming: false },
      ],
    });

    await userEvent.keyboard('{Control>}{Shift>}C{/Shift}{/Control}');

    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('Chat page — citations', () => {
  it('renders CitationChips for assistant messages with citations', () => {
    renderChat({
      messages: [
        {
          id: '3',
          role: 'assistant',
          content: 'Answer text.',
          timestamp: Date.now(),
          isStreaming: false,
          citations: [
            {
              documentId: 'doc1',
              documentName: 'report.pdf',
              chunkId: 'c1',
              chunkRef: 'chunk-1',
              similarity: 0.9,
              excerpt: 'Relevant passage here.',
            },
          ],
        },
      ],
    });
    // Citation chip button should be present (IndexCard front face)
    expect(
      screen.getByRole('button', { name: /report\.pdf.*relevance/i }),
    ).toBeInTheDocument();
  });
});

describe('Chat page — document filter', () => {
  it('renders ready documents as filter checkboxes', () => {
    renderChat({
      documents: [
        {
          id: 'd1', filename: 'guide.pdf', status: 'ready',
          chunk_count: 3, created_at: '2026-06-16T00:00:00Z',
          mime_type: 'application/pdf', size_bytes: 512,
          updated_at: '2026-06-16T00:00:00Z',
        },
      ],
    });
    expect(screen.getByRole('checkbox', { name: /include guide\.pdf/i })).toBeInTheDocument();
  });

  it('select-all checkbox selects all ready documents', async () => {
    renderChat({
      documents: [
        {
          id: 'd1', filename: 'a.pdf', status: 'ready',
          chunk_count: 1, created_at: '2026-06-16T00:00:00Z',
          mime_type: 'application/pdf', size_bytes: 100,
          updated_at: '2026-06-16T00:00:00Z',
        },
        {
          id: 'd2', filename: 'b.pdf', status: 'ready',
          chunk_count: 2, created_at: '2026-06-16T00:00:00Z',
          mime_type: 'application/pdf', size_bytes: 200,
          updated_at: '2026-06-16T00:00:00Z',
        },
      ],
    });
    const allCheckbox = screen.getByRole('checkbox', { name: /select all documents/i });
    await userEvent.click(allCheckbox);
    // After selecting all, both individual checkboxes should be checked
    expect(screen.getByRole('checkbox', { name: /include a\.pdf/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /include b\.pdf/i })).toBeChecked();
  });

  it('sends selected document IDs with query', async () => {
    renderChat({
      documents: [
        {
          id: 'doc-x', filename: 'x.pdf', status: 'ready',
          chunk_count: 1, created_at: '2026-06-16T00:00:00Z',
          mime_type: 'application/pdf', size_bytes: 100,
          updated_at: '2026-06-16T00:00:00Z',
        },
      ],
    });

    // Select the document
    await userEvent.click(screen.getByRole('checkbox', { name: /include x\.pdf/i }));

    // Type and send a query
    const input = screen.getByRole('textbox', { name: /question input/i });
    await userEvent.type(input, 'What does x say?');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      expect(sendQueryMock).toHaveBeenCalledWith(
        'What does x say?',
        expect.arrayContaining(['doc-x']),
      );
    });
  });
});

describe('Chat page — new conversation flow', () => {
  it('renders the "New conversation" button', () => {
    renderChat();
    expect(screen.getByRole('button', { name: /start new conversation/i })).toBeInTheDocument();
  });

  it('"New conversation" button shows confirmation on first click', async () => {
    renderChat();
    const btn = screen.getByRole('button', { name: /start new conversation/i });
    await userEvent.click(btn);
    expect(screen.getByText(/sure\? click again/i)).toBeInTheDocument();
  });

  it('thread pill is visible when conversationHistory has 2 turns', () => {
    renderChat({
      conversationHistory: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
      ],
    });
    expect(screen.getByTestId('thread-pill')).toBeInTheDocument();
    expect(screen.getByText(/1-turn thread/i)).toBeInTheDocument();
  });

  it('thread pill is hidden when conversationHistory is empty', () => {
    renderChat({ conversationHistory: [] });
    expect(screen.queryByTestId('thread-pill')).not.toBeInTheDocument();
  });
});

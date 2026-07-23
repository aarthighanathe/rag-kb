/**
 * @file AppHeader.test.tsx
 * @description Tests for AppHeader — active tab highlighting per route, keyboard
 *   navigation (arrow keys), logo link, and accessibility attributes.
 * @author [Author Placeholder]
 * @created 2026-06-20
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppHeader } from '../../design-system/components/AppHeader';

function renderHeader(initialPath = '/upload') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppHeader />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('AppHeader — structure', () => {
  it('renders the header landmark', () => {
    renderHeader();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders the RAG KB logo link pointing to Upload', () => {
    renderHeader();
    const logo = screen.getByRole('link', { name: /rag kb.*upload/i });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('href', '/upload');
  });

  it('renders tablist with three tabs', () => {
    renderHeader();
    const tabList = screen.getByRole('tablist', { name: /main sections/i });
    const tabs    = screen.getAllByRole('tab');
    expect(tabList).toBeInTheDocument();
    expect(tabs).toHaveLength(3);
  });

  it('renders Upload, Chat, and Documents tabs', () => {
    renderHeader();
    expect(screen.getByRole('tab', { name: /upload/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /documents/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Active tab highlighting per route
// ---------------------------------------------------------------------------

describe('AppHeader — active tab per route', () => {
  it('Upload tab is active on /upload', () => {
    renderHeader('/upload');
    const uploadTab = screen.getByRole('tab', { name: /upload/i });
    // NavLink adds aria-current="page" when active
    expect(uploadTab).toHaveAttribute('aria-current', 'page');
  });

  it('Chat tab is active on /chat', () => {
    renderHeader('/chat');
    expect(screen.getByRole('tab', { name: /chat/i })).toHaveAttribute('aria-current', 'page');
  });

  it('Documents tab is active on /documents', () => {
    renderHeader('/documents');
    expect(screen.getByRole('tab', { name: /documents/i })).toHaveAttribute('aria-current', 'page');
  });

  it('Upload tab is NOT active on /chat', () => {
    renderHeader('/chat');
    const uploadTab = screen.getByRole('tab', { name: /upload/i });
    expect(uploadTab).not.toHaveAttribute('aria-current', 'page');
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe('AppHeader — keyboard navigation', () => {
  it('ArrowRight moves focus from Upload to Chat tab', async () => {
    renderHeader('/upload');
    const uploadTab = screen.getByRole('tab', { name: /upload/i });
    const chatTab   = screen.getByRole('tab', { name: /chat/i });

    uploadTab.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(chatTab).toHaveFocus();
  });

  it('ArrowLeft moves focus from Chat to Upload tab', async () => {
    renderHeader('/chat');
    const chatTab   = screen.getByRole('tab', { name: /chat/i });
    const uploadTab = screen.getByRole('tab', { name: /upload/i });

    chatTab.focus();
    await userEvent.keyboard('{ArrowLeft}');

    expect(uploadTab).toHaveFocus();
  });

  it('Home key moves focus to first tab', async () => {
    renderHeader('/documents');
    const documentsTab = screen.getByRole('tab', { name: /documents/i });
    const uploadTab    = screen.getByRole('tab', { name: /upload/i });

    documentsTab.focus();
    await userEvent.keyboard('{Home}');

    expect(uploadTab).toHaveFocus();
  });

  it('End key moves focus to last tab', async () => {
    renderHeader('/upload');
    const uploadTab    = screen.getByRole('tab', { name: /upload/i });
    const documentsTab = screen.getByRole('tab', { name: /documents/i });

    uploadTab.focus();
    await userEvent.keyboard('{End}');

    expect(documentsTab).toHaveFocus();
  });

  it('ArrowRight wraps from last tab to first', async () => {
    renderHeader('/documents');
    const documentsTab = screen.getByRole('tab', { name: /documents/i });
    const uploadTab    = screen.getByRole('tab', { name: /upload/i });

    documentsTab.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(uploadTab).toHaveFocus();
  });
});

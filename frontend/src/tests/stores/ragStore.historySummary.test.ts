/**
 * @file ragStore.historySummary.test.ts
 * @description Tests for appendHistoryTurn's smart-summarization behavior —
 *   turns dropped by the 6-message cap are condensed into a leading summary
 *   turn instead of being discarded outright.
 */

import { describe, it, expect } from 'vitest';
import { appendHistoryTurn, type ConversationTurn } from '../../stores/ragStore';

function turn(role: ConversationTurn['role'], content: string): ConversationTurn {
  return { role, content };
}

describe('appendHistoryTurn', () => {
  it('appends normally while under the 6-message cap', () => {
    let history: ConversationTurn[] = [];
    history = appendHistoryTurn(history, turn('user', 'first question'));
    history = appendHistoryTurn(history, turn('assistant', 'first answer'));

    expect(history).toEqual([turn('user', 'first question'), turn('assistant', 'first answer')]);
  });

  it('truncates a turn whose content exceeds the backend max length', () => {
    const longContent = 'x'.repeat(3000);
    const history = appendHistoryTurn([], turn('user', longContent));
    expect(history[0]?.content.length).toBe(2000);
  });

  it('never exceeds 6 messages even after many turns', () => {
    let history: ConversationTurn[] = [];
    for (let i = 0; i < 10; i++) {
      history = appendHistoryTurn(history, turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`));
    }
    expect(history.length).toBeLessThanOrEqual(6);
  });

  it('condenses dropped turns into a leading summary turn instead of discarding them', () => {
    let history: ConversationTurn[] = [];
    // Fill exactly to the cap with real turns.
    for (let i = 0; i < 6; i++) {
      history = appendHistoryTurn(history, turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`));
    }
    expect(history).toHaveLength(6);
    expect(history.every((t) => !t.content.startsWith('[Earlier in this conversation]'))).toBe(
      true,
    );

    // One more turn must now trigger a trim + summary.
    history = appendHistoryTurn(history, turn('user', 'turn 6'));
    expect(history).toHaveLength(6);
    expect(history[0]?.content).toContain('[Earlier in this conversation]');
    // The oldest turn ("turn 0") must be represented in the summary, not silently gone.
    expect(history[0]?.content).toContain('turn 0');
  });

  it('keeps the most recent real turns verbatim alongside the summary', () => {
    let history: ConversationTurn[] = [];
    for (let i = 0; i < 8; i++) {
      history = appendHistoryTurn(history, turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`));
    }
    // Summary turn occupies slot 0; the 5 most recent real turns (3..7) fill the rest.
    expect(history[0]?.content).toContain('[Earlier in this conversation]');
    expect(history.slice(1).map((t) => t.content)).toEqual([
      'turn 3',
      'turn 4',
      'turn 5',
      'turn 6',
      'turn 7',
    ]);
  });

  it('extends an existing summary on a later trim instead of replacing it', () => {
    let history: ConversationTurn[] = [];
    for (let i = 0; i < 12; i++) {
      history = appendHistoryTurn(history, turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`));
    }
    // A single summary turn must still be present (not two stacked summaries).
    const summaryTurns = history.filter((t) =>
      t.content.startsWith('[Earlier in this conversation]'),
    );
    expect(summaryTurns).toHaveLength(1);
    // And it must reference turns from well before the retained window (e.g. turn 0),
    // proving earlier summarized content wasn't lost when it was extended.
    expect(summaryTurns[0]?.content).toContain('turn 0');
    expect(history).toHaveLength(6);
  });

  it('caps the summary turn itself at the backend content-length limit', () => {
    let history: ConversationTurn[] = [];
    // Push enough long turns through that the accumulated summary would
    // otherwise exceed 2000 chars if left unbounded.
    for (let i = 0; i < 30; i++) {
      history = appendHistoryTurn(
        history,
        turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i} `.repeat(20)),
      );
    }
    const summaryTurn = history.find((t) => t.content.startsWith('[Earlier in this conversation]'));
    expect(summaryTurn?.content.length).toBeLessThanOrEqual(2000);
  });

  it('truncates a long dropped turn to a short snippet in the summary line', () => {
    let history: ConversationTurn[] = [];
    const longFirstTurn = 'a'.repeat(500);
    history = appendHistoryTurn(history, turn('user', longFirstTurn));
    for (let i = 1; i < 7; i++) {
      history = appendHistoryTurn(history, turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`));
    }
    const summaryTurn = history.find((t) => t.content.startsWith('[Earlier in this conversation]'));
    expect(summaryTurn).toBeDefined();
    // The snippet is truncated (not the full 500 chars) and ellipsized.
    expect(summaryTurn?.content).toContain('…');
    expect(summaryTurn?.content.length).toBeLessThan(600);
  });
});

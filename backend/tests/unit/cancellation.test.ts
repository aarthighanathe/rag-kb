/**
 * @file cancellation.test.ts
 * @description Unit tests for the per-job-attempt cancellation registry
 * @author [Author Placeholder]
 * @created 2026-07-18
 */

import { describe, it, expect } from 'vitest';
import { beginAttempt, endAttempt, throwIfAborted, cancelJob, JobCancelledError } from '@queues/cancellation';

describe('beginAttempt', () => {
  it('returns a fresh, non-aborted AbortController for a new job ID', () => {
    const controller = beginAttempt('job-a');
    expect(controller.signal.aborted).toBe(false);
    endAttempt('job-a', controller);
  });

  it('aborts the previously registered controller for the same job ID', () => {
    const first = beginAttempt('job-b');
    expect(first.signal.aborted).toBe(false);

    const second = beginAttempt('job-b');

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    endAttempt('job-b', second);
  });

  it('does not abort an already-aborted stale controller again (no-op, no throw)', () => {
    const first = beginAttempt('job-c');
    first.abort('timeout');

    expect(() => beginAttempt('job-c')).not.toThrow();
    const second = beginAttempt('job-c');
    expect(second.signal.aborted).toBe(false);
    endAttempt('job-c', second);
  });

  it('does not cross-contaminate controllers registered under different job IDs', () => {
    const a = beginAttempt('job-d1');
    const b = beginAttempt('job-d2');

    expect(a.signal.aborted).toBe(false);
    expect(b.signal.aborted).toBe(false);

    endAttempt('job-d1', a);
    endAttempt('job-d2', b);
  });
});

describe('endAttempt', () => {
  it('removes the registry entry so a later beginAttempt does not see it as stale', () => {
    const first = beginAttempt('job-e');
    endAttempt('job-e', first);

    const second = beginAttempt('job-e');

    // first was cleanly ended, not superseded — it should never have been aborted
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(false);
    endAttempt('job-e', second);
  });

  it('does not remove a newer controller when a stale attempt calls endAttempt with its own (older) controller', () => {
    // Simulates: attempt A times out, its signal is aborted by a retry claiming
    // the job (attempt B) before A's own `finally` runs `endAttempt`.
    const attemptA = beginAttempt('job-f');
    const attemptB = beginAttempt('job-f'); // supersedes A, registry now holds B

    // A's cleanup runs late, after B has already claimed the slot.
    endAttempt('job-f', attemptA);

    // B must still be able to be cleanly ended — its registry entry was not
    // clobbered by A's late cleanup.
    expect(() => endAttempt('job-f', attemptB)).not.toThrow();

    // A fresh attempt after both have ended should not be treated as stale.
    const attemptC = beginAttempt('job-f');
    expect(attemptC.signal.aborted).toBe(false);
    endAttempt('job-f', attemptC);
  });
});

describe('throwIfAborted', () => {
  it('does nothing when the signal is not aborted', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal, 'testStage', {})).not.toThrow();
  });

  it('throws JobCancelledError (not a generic Error) when the signal is aborted', () => {
    const controller = new AbortController();
    controller.abort('timeout');

    expect(() => throwIfAborted(controller.signal, 'testStage', {})).toThrow(JobCancelledError);
  });

  it('includes the stage name in the thrown error message', () => {
    const controller = new AbortController();
    controller.abort('timeout');

    try {
      throwIfAborted(controller.signal, 'upsertChunks', { documentId: 'doc-1' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JobCancelledError);
      expect((err as JobCancelledError).message).toContain('upsertChunks');
    }
  });

  it('JobCancelledError is not an instance of a generic app error base (name is distinct)', () => {
    const controller = new AbortController();
    controller.abort('reason-x');
    try {
      throwIfAborted(controller.signal, 'stage', {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).name).toBe('JobCancelledError');
    }
  });
});

describe('cancelJob', () => {
  it('aborts the in-flight attempt for a registered job ID and returns true', () => {
    const controller = beginAttempt('job-g');
    expect(controller.signal.aborted).toBe(false);

    const result = cancelJob('job-g');

    expect(result).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    endAttempt('job-g', controller);
  });

  it('returns false when no attempt is registered for the job ID (already finished or never started)', () => {
    const result = cancelJob('job-never-started');
    expect(result).toBe(false);
  });

  it('returns false when the registered attempt is already aborted (nothing new to cancel)', () => {
    const controller = beginAttempt('job-h');
    controller.abort('already-done');

    const result = cancelJob('job-h');

    expect(result).toBe(false);
    endAttempt('job-h', controller);
  });

  it('does not affect a different job ID', () => {
    const target = beginAttempt('job-i1');
    const other = beginAttempt('job-i2');

    cancelJob('job-i1');

    expect(target.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    endAttempt('job-i1', target);
    endAttempt('job-i2', other);
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resetSubscriptions, sharedSubscribe } from '../lib/subscriptions';

describe('shared listener cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetSubscriptions();
    vi.useRealTimers();
  });

  test('opens exactly one underlying listener for two subscribers', () => {
    const start = vi.fn(() => vi.fn());
    sharedSubscribe('trip:current', start, vi.fn(), vi.fn());
    sharedSubscribe('trip:current', start, vi.fn(), vi.fn());
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('opens separate listeners for different keys', () => {
    const start = vi.fn(() => vi.fn());
    sharedSubscribe('a', start, vi.fn(), vi.fn());
    sharedSubscribe('b', start, vi.fn(), vi.fn());
    expect(start).toHaveBeenCalledTimes(2);
  });

  test('fans one update out to every subscriber', () => {
    let emit: ((value: number) => void) | null = null;
    const start = (onData: (v: number) => void) => {
      emit = onData;
      return vi.fn();
    };
    const first = vi.fn();
    const second = vi.fn();
    sharedSubscribe<number>('k', start, first, vi.fn());
    sharedSubscribe<number>('k', start, second, vi.fn());

    emit!(42);
    expect(first).toHaveBeenCalledWith(42);
    expect(second).toHaveBeenCalledWith(42);
  });

  test('replays the latest value to a late subscriber immediately', () => {
    let emit: ((value: number) => void) | null = null;
    const start = (onData: (v: number) => void) => {
      emit = onData;
      return vi.fn();
    };
    sharedSubscribe<number>('k', start, vi.fn(), vi.fn());
    emit!(7);

    const late = vi.fn();
    sharedSubscribe<number>('k', start, late, vi.fn());
    // No spinner for a screen that mounts second.
    expect(late).toHaveBeenCalledWith(7);
  });

  test('reports a failure to everyone currently listening', () => {
    let fail: ((err: unknown) => void) | null = null;
    const start = (_onData: (v: number) => void, onError: (e: unknown) => void) => {
      fail = onError;
      return vi.fn();
    };
    const first = vi.fn();
    const second = vi.fn();
    sharedSubscribe<number>('k', start, vi.fn(), first);
    sharedSubscribe<number>('k', start, vi.fn(), second);

    const denied = new Error('permission-denied');
    fail!(denied);

    expect(first).toHaveBeenCalledWith(denied);
    expect(second).toHaveBeenCalledWith(denied);
  });

  test('a failed listener is dropped so the next subscriber retries', () => {
    // Firestore never re-attaches a listener that failed, so caching the error
    // would make a permission-denied during sign-in permanent. Retrying is what
    // lets the app recover on its own.
    const start = vi.fn(
      (_onData: (v: number) => void, onError: (e: unknown) => void) => {
        onError(new Error('denied'));
        return vi.fn();
      },
    );
    sharedSubscribe<number>('k', start, vi.fn(), vi.fn());

    const lateData = vi.fn();
    sharedSubscribe<number>('k', start, lateData, vi.fn());

    expect(start).toHaveBeenCalledTimes(2);
  });

  test('a retry after a failure can succeed', () => {
    let attempt = 0;
    const start = (onData: (v: number) => void, onError: (e: unknown) => void) => {
      attempt += 1;
      if (attempt === 1) onError(new Error('denied'));
      else onData(99);
      return vi.fn();
    };
    sharedSubscribe<number>('k', start, vi.fn(), vi.fn());

    const recovered = vi.fn();
    sharedSubscribe<number>('k', start, recovered, vi.fn());
    expect(recovered).toHaveBeenCalledWith(99);
  });

  test('does not tear down immediately when the last subscriber leaves', () => {
    // This is what protects against the StrictMode unmount/remount cycle that
    // otherwise trips a Firestore internal assertion.
    const stop = vi.fn();
    const unsubscribe = sharedSubscribe('k', () => stop, vi.fn(), vi.fn());
    unsubscribe();
    expect(stop).not.toHaveBeenCalled();
  });

  test('a remount inside the grace period reuses the live listener', () => {
    const stop = vi.fn();
    const start = vi.fn(() => stop);

    const unsubscribe = sharedSubscribe('k', start, vi.fn(), vi.fn());
    unsubscribe();
    vi.advanceTimersByTime(100);
    sharedSubscribe('k', start, vi.fn(), vi.fn());
    vi.advanceTimersByTime(10_000);

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  test('tears down once the grace period expires with nobody listening', () => {
    const stop = vi.fn();
    const unsubscribe = sharedSubscribe('k', () => stop, vi.fn(), vi.fn());
    unsubscribe();
    vi.advanceTimersByTime(6_000);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test('keeps listening while one of two subscribers leaves', () => {
    const stop = vi.fn();
    const start = () => stop;
    const firstOff = sharedSubscribe('k', start, vi.fn(), vi.fn());
    sharedSubscribe('k', start, vi.fn(), vi.fn());

    firstOff();
    vi.advanceTimersByTime(10_000);
    expect(stop).not.toHaveBeenCalled();
  });

  test('a detached subscriber stops receiving updates', () => {
    let emit: ((value: number) => void) | null = null;
    const start = (onData: (v: number) => void) => {
      emit = onData;
      return vi.fn();
    };
    const gone = vi.fn();
    const stays = vi.fn();
    const off = sharedSubscribe<number>('k', start, gone, vi.fn());
    sharedSubscribe<number>('k', start, stays, vi.fn());

    off();
    emit!(1);

    expect(gone).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledWith(1);
  });

  test('a fresh listener is opened after a full teardown', () => {
    const start = vi.fn(() => vi.fn());
    const off = sharedSubscribe('k', start, vi.fn(), vi.fn());
    off();
    vi.advanceTimersByTime(6_000);
    sharedSubscribe('k', start, vi.fn(), vi.fn());
    expect(start).toHaveBeenCalledTimes(2);
  });
});

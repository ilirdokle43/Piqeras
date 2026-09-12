import { describe, expect, test } from 'vitest';
import {
  classifyAuthError,
  authMessageKey,
  isCancellation,
  shouldRetryWithRedirect,
} from '../lib/authErrors';
import { sq } from '../i18n/sq';

const err = (code: string) => ({ code });

describe('classifying sign-in failures', () => {
  test('a closed popup is a cancellation, not an error', () => {
    expect(classifyAuthError(err('auth/popup-closed-by-user'))).toBe('cancelled');
    expect(isCancellation(err('auth/popup-closed-by-user'))).toBe(true);
  });

  test('a superseded popup request is also a cancellation', () => {
    expect(classifyAuthError(err('auth/cancelled-popup-request'))).toBe('cancelled');
  });

  test('a blocked popup is recoverable by redirect', () => {
    expect(classifyAuthError(err('auth/popup-blocked'))).toBe('popupBlocked');
    expect(shouldRetryWithRedirect(err('auth/popup-blocked'))).toBe(true);
  });

  test('an environment without popup support falls back to redirect', () => {
    expect(
      shouldRetryWithRedirect(err('auth/operation-not-supported-in-this-environment')),
    ).toBe(true);
    expect(shouldRetryWithRedirect(err('auth/web-storage-unsupported'))).toBe(true);
  });

  test('a cancellation must NOT trigger a redirect', () => {
    // Bouncing somebody to Google right after they backed out would be hostile.
    expect(shouldRetryWithRedirect(err('auth/popup-closed-by-user'))).toBe(false);
  });

  test('a network failure is reported as such', () => {
    expect(classifyAuthError(err('auth/network-request-failed'))).toBe('network');
    expect(authMessageKey(err('auth/network-request-failed'))).toBe('authNetwork');
  });

  test('a Google account already attached elsewhere is its own case', () => {
    for (const code of [
      'auth/credential-already-in-use',
      'auth/email-already-in-use',
      'auth/account-exists-with-different-credential',
      'auth/provider-already-linked',
    ]) {
      expect(classifyAuthError(err(code)), code).toBe('alreadyLinked');
    }
    expect(authMessageKey(err('auth/credential-already-in-use'))).toBe('authAlreadyLinked');
  });

  test('an unauthorized domain is called out precisely', () => {
    expect(authMessageKey(err('auth/unauthorized-domain'))).toBe('authUnauthorizedDomain');
  });

  test('a disabled account is called out precisely', () => {
    expect(authMessageKey(err('auth/user-disabled'))).toBe('authDisabled');
  });

  test('the provider not being enabled yet is classified separately', () => {
    // This is what a rollout looks like before Google is switched on.
    expect(classifyAuthError(err('auth/operation-not-allowed'))).toBe('providerDisabled');
  });

  test('anything unrecognised falls back without crashing', () => {
    expect(classifyAuthError(err('auth/something-new'))).toBe('unknown');
    expect(classifyAuthError(null)).toBe('unknown');
    expect(classifyAuthError(undefined)).toBe('unknown');
    expect(classifyAuthError(new Error('boom'))).toBe('unknown');
    expect(authMessageKey({})).toBe('authGeneric');
  });

  test('every message key resolves to a real Albanian string', () => {
    for (const code of [
      'auth/popup-closed-by-user',
      'auth/popup-blocked',
      'auth/network-request-failed',
      'auth/credential-already-in-use',
      'auth/unauthorized-domain',
      'auth/user-disabled',
      'auth/operation-not-allowed',
      'auth/whatever',
    ]) {
      const key = authMessageKey(err(code));
      expect(sq[key], code).toBeTruthy();
    }
  });
});

import { HttpErrorResponse } from '@angular/common/http';

/** A backend message we recognise, and what to tell the user instead. */
export interface KnownError { match: RegExp; message: string }

/**
 * Turns a failed API call into something a user can act on.
 * - Unreachable service (status 0) → a connection message.
 * - Server errors (5xx: SQL constraint failures, NPEs…) → `fallback`; the raw detail goes to the console for developers.
 * - Client errors (4xx: validation, not found) → the platform's `errorMessage`, which is written for people.
 * `known` maps specific backend messages to friendlier wording and wins over the rules above.
 */
export function apiErrorMessage(err: unknown, fallback: string, known: KnownError[] = []): string {
  const res = err instanceof HttpErrorResponse ? err : null;
  const raw: string = res?.error?.errorMessage || res?.error?.message || '';
  const hit = known.find(k => k.match.test(raw));
  if (hit) return hit.message;
  if (!res || res.status === 0) return 'Can’t reach the grant service. Check your connection and try again.';
  if (res.status >= 500) {
    console.error('[api]', res.status, res.url, raw || res.error);
    return fallback;
  }
  return raw || fallback;
}

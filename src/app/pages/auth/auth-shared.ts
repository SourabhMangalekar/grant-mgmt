import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Turns an IAM error into a user-facing message. */
export function authErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    switch (err.status) {
      case 0: return 'Can’t reach the server. Check your connection and try again.';
      case 401: return err.error?.message === 'Invalid or expired OTP'
        ? 'That code is invalid or has expired.'
        : 'Incorrect organisation ID, username or password.';
      case 403: return 'That code is invalid or has expired.';
      case 409: return err.error?.message ?? 'An account with these details already exists.';
      case 423: return 'This account is locked after too many attempts. Reset your password to unlock it.';
    }
    if (err.error?.message) return err.error.message;
  }
  return 'Something went wrong. Please try again.';
}

/** At least 8 chars with upper, lower, digit and symbol. */
export const strongPassword: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
  const v: string = c.value ?? '';
  if (!v) return null;
  const ok = v.length >= 8 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v);
  return ok ? null : { weakPassword: true };
};

/** Group validator: `confirm` must equal `password`. */
export const passwordsMatch: ValidatorFn = (g: AbstractControl): ValidationErrors | null => {
  const confirm = g.get('confirm');
  if (!confirm?.value) return null;
  const mismatch = g.get('password')?.value !== confirm.value;
  confirm.setErrors(mismatch ? { mismatch: true } : null);
  return null;
};

export const PASSWORD_HINT = 'At least 8 characters, with upper & lower case, a number and a symbol.';

/**
 * The org ID (tenantLogin) IAM generates from an organisation name on signup, observed live:
 * "Diag Grant Test" → "diag_grant_test", "PCF_pcf" → "pcfpcf". Lowercase, drop everything but letters, digits and
 * spaces, then spaces → "_". (IAM appends a suffix like "-21" if that ID is taken.)
 */
export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_').slice(0, 64);

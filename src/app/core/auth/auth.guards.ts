import { inject } from '@angular/core';
import { CanActivateFn, GuardResult, MaybeAsync, Router } from '@angular/router';
import { map } from 'rxjs';
import { Affiliation } from '../config';
import { affiliationOrDefault, homeOf } from '../nav';
import { AuthStore } from './auth.store';

/**
 * Runs `decide` once the stored session has been checked. If IAM couldn't be reached on startup, navigation waits
 * (behind the app's retry screen) rather than redirecting, so the address bar keeps the page the user was on.
 */
function afterSessionCheck(decide: () => GuardResult): MaybeAsync<GuardResult> {
  const auth = inject(AuthStore);
  return auth.restoreFailed() ? auth.sessionChecked$.pipe(map(decide)) : decide();
}

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return afterSessionCheck(() =>
    auth.isLoggedIn() || router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } }));
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return afterSessionCheck(() => !auth.isLoggedIn() || router.createUrlTree(['/']));
};

/**
 * Joiners stay on /pending until their org admin approves them. Waits for the session check too: it runs alongside
 * authGuard, and reading user() before the user is loaded would let a pending joiner through.
 */
export const approvedGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return afterSessionCheck(() => auth.user()?.approved !== false || router.createUrlTree(['/pending']));
};

/** Keeps each tenant type on its own pages; anything else goes to that type's landing page. */
export const affiliationGuard = (allowed: Affiliation): CanActivateFn => () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return afterSessionCheck(() => {
    const a = auth.user()?.affiliation;
    return affiliationOrDefault(a) === allowed || router.createUrlTree([homeOf(a)]);
  });
};

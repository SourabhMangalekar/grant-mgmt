import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Affiliation } from '../config';
import { affiliationOrDefault, homeOf } from '../nav';
import { AuthStore } from './auth.store';

export const authGuard: CanActivateFn = (_route, state) =>
  inject(AuthStore).isLoggedIn() ||
  inject(Router).createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });

export const guestGuard: CanActivateFn = () =>
  !inject(AuthStore).isLoggedIn() || inject(Router).createUrlTree(['/']);

/** Joiners stay on /pending until their org admin approves them. */
export const approvedGuard: CanActivateFn = () =>
  inject(AuthStore).user()?.approved !== false || inject(Router).createUrlTree(['/pending']);

/** Keeps each tenant type on its own pages; anything else goes to that type's landing page. */
export const affiliationGuard = (allowed: Affiliation): CanActivateFn => () => {
  const a = inject(AuthStore).user()?.affiliation;
  return affiliationOrDefault(a) === allowed || inject(Router).createUrlTree([homeOf(a)]);
};

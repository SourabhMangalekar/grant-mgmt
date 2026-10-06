import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

export const authGuard: CanActivateFn = (_route, state) =>
  inject(AuthStore).isLoggedIn() ||
  inject(Router).createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });

export const guestGuard: CanActivateFn = () =>
  !inject(AuthStore).isLoggedIn() || inject(Router).createUrlTree(['/dashboard']);

/** Joiners stay on /pending until their org admin approves them. */
export const approvedGuard: CanActivateFn = () =>
  inject(AuthStore).user()?.approved !== false || inject(Router).createUrlTree(['/pending']);

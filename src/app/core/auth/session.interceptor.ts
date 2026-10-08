import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { APP_CONFIG } from '../config';
import { AuthStore } from './auth.store';

/** Attaches the session header and sends the user to login when IAM confirms the session is gone. */
export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const id = store.sessionId();
  // Signup calls carry their own (app / governor-tenant) session; don't overwrite it.
  const authed = id && !req.headers.has(APP_CONFIG.sessionHeader)
    ? req.clone({ setHeaders: { [APP_CONFIG.sessionHeader]: id } })
    : req;

  return next(authed).pipe(catchError((err: HttpErrorResponse) => {
    // Only IAM decides whether the session is dead; a 401 from another service (e.g. grant service) shouldn't log out.
    // IAM also uses 401 for "not allowed", so the store re-checks the session before signing the user out.
    if (err.status === 401 && id && req.url.startsWith(APP_CONFIG.iamBaseUrl) && !req.url.includes('/security/')) {
      store.verifySession();
    }
    return throwError(() => err);
  }));
};

import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  Observable, Subject, catchError, filter, finalize, firstValueFrom, forkJoin, map, of, retry, switchMap, take, takeUntil, tap,
  throwError, timer,
} from 'rxjs';
import { APP_CONFIG, Affiliation } from '../config';
import { AuthApi } from './auth.api';
import { CurrentUser, LoginRequest, SignUpRequest, Tenant } from './auth.models';

/** Mock sessions are kept apart, so a mock run can never read, or throw away, a real IAM session (and vice versa). */
const SESSION_KEY = APP_CONFIG.mockApi ? 'gm-mock-session' : 'gm-session';

/** Holds the session id + current user and exposes login/logout/signup. */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);

  readonly sessionId = signal<string | null>(read());
  readonly user = signal<CurrentUser | null>(null);
  readonly isLoggedIn = computed(() => !!this.sessionId());
  /**
   * True when the stored session couldn't be checked because IAM was unreachable or failing. The session is kept:
   * the app shows a retry screen instead of the login page, and routing waits (see auth.guards.ts).
   */
  readonly restoreFailed = signal(false);
  /** Emits once the stored session has been checked, i.e. as soon as `restoreFailed` is false. */
  readonly sessionChecked$: Observable<unknown> = toObservable(this.restoreFailed).pipe(filter(failed => !failed), take(1));

  private verifying = false;
  /** Fires when the session is cleared, so a restore still in flight can't sign the user back in. */
  private readonly cleared$ = new Subject<void>();

  login(req: LoginRequest): Observable<CurrentUser> {
    return this.api.login(req).pipe(switchMap(id => this.startSession(id)));
  }

  /** New organisation: create the tenant (user becomes its admin), stamp its tenantType, sign in. */
  createOrganisation(req: SignUpRequest, password: string, affiliation: Affiliation, preSession: string | null): Observable<CurrentUser> {
    // The signup response has no numeric tenant id, and PATCH /tenants rejects ("not allowed to update detail")
    // without one — so read the new tenant back with its admin session first.
    return this.api.onboardTenant(req, password, preSession).pipe(
      switchMap(({ sessionId }) => this.api.currentTenant(sessionId).pipe(
        switchMap(tenant => this.api.setTenantType(tenant, APP_CONFIG.tenantTypes[affiliation], sessionId)),
        switchMap(() => this.startSession(sessionId)),
      )),
    );
  }

  /** Existing organisation: create the user in it, queue them for org-admin approval, sign in (pending). */
  joinOrganisation(tenantLogin: string, req: SignUpRequest, password: string, preSession: string | null): Observable<CurrentUser> {
    return this.api.activateUser(tenantLogin, req, password, preSession).pipe(
      switchMap(({ sessionId, body }) => this.api.requestApproval(body.id, sessionId)
        .pipe(switchMap(() => this.startSession(sessionId)))),
    );
  }

  /** Re-checks approval (e.g. from the pending page) without signing in again. */
  refresh(): Observable<CurrentUser> {
    const id = this.sessionId();
    return id ? this.startSession(id) : throwError(() => new Error('Not signed in'));
  }

  /**
   * Restores the user for a stored session on app start (and on every refresh or live reload).
   * Only IAM rejecting the session (401) signs the user out; a network blip, a gateway restart or a server error
   * keeps the session and sets `restoreFailed` so the user can retry.
   */
  restore(): Promise<void> {
    const id = this.sessionId();
    if (!id) return Promise.resolve();
    // restoreFailed only changes once the check is over: flipping it early would release the waiting guards
    // (auth.guards.ts) before the user is loaded.
    return firstValueFrom(this.startSession(id).pipe(
      // Unreachable or restarting gateway: try twice more (after 1s, then 2s) before showing the retry screen.
      retry({ count: 2, delay: (err, attempt) => isTransient(err) ? timer(attempt * 1000) : throwError(() => err) }),
      map(() => this.restoreFailed.set(false)),
      catchError(err => {
        if (isRejected(err)) this.clear();
        else this.restoreFailed.set(true);
        return of(undefined);
      }),
      // Signed out meanwhile (e.g. "Sign out" pressed during "Try again"): drop the result.
      takeUntil(this.cleared$),
    ), { defaultValue: undefined });
  }

  /**
   * Called after IAM answers 401. IAM also uses 401 for "not allowed to do this", so that alone doesn't mean the
   * session ended: sign out only if IAM rejects the session itself.
   */
  verifySession() {
    const id = this.sessionId();
    if (!id || this.verifying) return;
    this.verifying = true;
    this.api.sessionContext(id).pipe(finalize(() => (this.verifying = false))).subscribe({
      error: (err: unknown) => {
        if (!isRejected(err) || this.sessionId() !== id) return;
        this.clear();
        this.router.navigate(['/auth/login'], { queryParams: { returnUrl: this.router.url } });
      },
    });
  }

  logout() {
    this.api.logout().pipe(catchError(() => of(null))).subscribe();
    this.clear();
    this.router.navigateByUrl('/auth/login');
  }

  clear() {
    const id = this.sessionId();
    this.cleared$.next();
    this.sessionId.set(null);
    this.user.set(null);
    this.restoreFailed.set(false);
    // Another tab may have signed in since: only forget the stored session if it's still the one this tab used.
    try { if (localStorage.getItem(SESSION_KEY) === id) localStorage.removeItem(SESSION_KEY); } catch {}
  }

  /** Resolves session → user + tenant type + approval, then stores it. */
  private startSession(id: string): Observable<CurrentUser> {
    return forkJoin([this.api.sessionContext(id), this.api.currentTenant(id)]).pipe(
      switchMap(([token, tenant]) => {
        const tenantLogin = token.tenantContext?.tenantLogin ?? tenant.tenantLogin;
        const isOrgAdmin = (token.userContext?.authorities ?? []).includes(`role.${tenantLogin}.admin`);
        const userId = token.userContext?.userId ?? 0;
        const approved$ = isOrgAdmin ? of(true) : this.api.verification(userId, id).pipe(
          // No record means the user predates the approval flow (or was added by an admin): let them in.
          map(v => !v || APP_CONFIG.approvedStatuses.includes(v.verificationStatus ?? '')),
        );
        return approved$.pipe(map((approved): CurrentUser => ({
          userId,
          name: token.userContext?.name || token.userContext?.username || '',
          userLogin: token.userContext?.username ?? '',
          tenantLogin,
          tenantName: token.tenantContext?.tenantName ?? tenant.tenantName,
          affiliation: affiliationOf(tenant),
          isOrgAdmin,
          approved,
        })));
      }),
      tap(u => {
        this.sessionId.set(id);
        this.user.set(u);
        try { localStorage.setItem(SESSION_KEY, id); } catch {}
      }),
    );
  }
}

export function affiliationOf(tenant: Pick<Tenant, 'tenantType'> | null): Affiliation | null {
  const entry = Object.entries(APP_CONFIG.tenantTypes).find(([, type]) => type === tenant?.tenantType);
  return (entry?.[0] as Affiliation) ?? null;
}

/** IAM says the session is gone (expired, signed out elsewhere, or never existed). */
function isRejected(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 401;
}

/** Worth retrying: no response at all, or the gateway / dev-server proxy couldn't reach IAM. */
function isTransient(err: unknown): boolean {
  return err instanceof HttpErrorResponse && [0, 502, 503, 504].includes(err.status);
}

function read(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

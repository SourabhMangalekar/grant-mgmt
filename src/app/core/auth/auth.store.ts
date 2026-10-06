import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, firstValueFrom, forkJoin, map, of, switchMap, tap, throwError } from 'rxjs';
import { APP_CONFIG, Affiliation } from '../config';
import { AuthApi } from './auth.api';
import { CurrentUser, LoginRequest, SignUpRequest, Tenant } from './auth.models';

const SESSION_KEY = 'gm-session';

/** Holds the session id + current user and exposes login/logout/signup. */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);

  readonly sessionId = signal<string | null>(read());
  readonly user = signal<CurrentUser | null>(null);
  readonly isLoggedIn = computed(() => !!this.sessionId());

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

  /** Restores the user for a stored session on app start; clears it if the server rejects it. */
  restore(): Promise<unknown> {
    const id = this.sessionId();
    if (!id) return Promise.resolve();
    return firstValueFrom(this.startSession(id).pipe(
      map(() => undefined),
      catchError(() => { this.clear(); return of(undefined); }),
    ));
  }

  logout() {
    this.api.logout().pipe(catchError(() => of(null))).subscribe();
    this.clear();
    this.router.navigateByUrl('/auth/login');
  }

  clear() {
    this.sessionId.set(null);
    this.user.set(null);
    try { localStorage.removeItem(SESSION_KEY); } catch {}
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

function read(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

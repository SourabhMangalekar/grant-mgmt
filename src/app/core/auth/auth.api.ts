import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { APP_CONFIG } from '../config';
import {
  ForgotPasswordRequest, IamUser, LeadRequest, LoginRequest, OtpResponse, PlatformToken, ResetPasswordRequest,
  SignUpRequest, Tenant, TenantRef, UserVerification,
} from './auth.models';

/** A response that carried a session id in its headers. */
export interface WithSession<T> { sessionId: string; body: T }

/** Thin HTTP client for the commons-iam-service endpoints the app uses. */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly base = APP_CONFIG.iamBaseUrl;
  private readonly appHeaders = { 'X-APPKEY': APP_CONFIG.appKey, 'X-APPCONTEXT': APP_CONFIG.appCode };

  // ── Session ──────────────────────────────────────────────────────────────

  /** Returns the session id from the response header. */
  login(body: LoginRequest): Observable<string> {
    return this.http.post(`${this.base}/api/v1/security/login`, body, { headers: this.appHeaders, observe: 'response' })
      .pipe(map(res => sessionFrom(res.headers)));
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.base}/api/v1/security/logout`, null);
  }

  /** `/api/v2/session/me` 401s on this platform, so use the context endpoint. */
  sessionContext(sessionId?: string): Observable<PlatformToken> {
    return this.http.get<PlatformToken>(`${this.base}/api/v1/session/context`, { headers: withSession(sessionId) });
  }

  /** The logged-in user's tenant, including tenantType. */
  currentTenant(sessionId?: string): Observable<Tenant> {
    return this.http.get<Tenant>(`${this.base}/api/v1/tenants/me`, { headers: withSession(sessionId) });
  }

  /**
   * Anonymous app session for the pre-login signup calls. Resolves to null (calls go out without a session)
   * when no tenant is configured or IAM has no app-key record for it.
   */
  appSession(): Observable<string | null> {
    if (!APP_CONFIG.appKeyTenantLogin) return of(null);
    return this.http.get(`${this.base}/api/v1/api-keys/session`, {
      params: { apiKey: APP_CONFIG.appKey, tenantLogin: APP_CONFIG.appKeyTenantLogin }, observe: 'response',
    }).pipe(map(res => sessionFrom(res.headers, false)), catchError(() => of(null)));
  }

  // ── Password reset ───────────────────────────────────────────────────────

  /** Sends a reset OTP; returns the OTP challenge key. */
  forgotPassword(body: ForgotPasswordRequest): Observable<string> {
    return this.http.patch(`${this.base}/api/v1/security/forget`, body,
      { headers: this.appHeaders, responseType: 'text' });
  }

  resetPassword(body: ResetPasswordRequest): Observable<void> {
    return this.http.patch<void>(`${this.base}/api/v1/security/reset`, body, { headers: this.appHeaders });
  }

  /**
   * Organisations an email or 10-digit mobile belongs to, for the login org picker. Public endpoint (no auth header —
   * the app key is rejected here). Plain usernames can't be looked up, so this resolves to [] for them.
   */
  tenantsForLogin(userLogin: string): Observable<TenantRef[]> {
    const v = userLogin.trim();
    const params: Record<string, string> | null = v.includes('@') ? { email: v } : /^\d{10}$/.test(v) ? { mobile: v } : null;
    if (!params) return of([]);
    return this.http.get<{ tenants?: TenantRef[] }>(`${this.base}/api/v1/signup/exists`, { params })
      .pipe(map(res => res.tenants ?? []));
  }

  // ── Signup ───────────────────────────────────────────────────────────────

  /** Exact lookup of an organisation by its tenant login. Resolves to null when none exists. */
  findTenant(tenantLogin: string, session: string | null): Observable<Tenant | null> {
    return this.http.get<Tenant>(`${this.base}/api/v1/tenants/login`,
      { headers: withSession(session), params: { loginName: tenantLogin } },
    ).pipe(catchError((err: HttpErrorResponse) => err.status === 404 ? of(null) : throwError(() => err)));
  }

  /** New organisation, step 1: register the lead and email an OTP. */
  registerOrganisation(body: LeadRequest, session: string | null): Observable<OtpResponse> {
    return this.http.post<OtpResponse>(`${this.base}/api/v1/signup/register`, body,
      { headers: publicHeaders(session), params: { sendOTP: true } });
  }

  /** Joining an organisation, step 1: register the lead and email an OTP. */
  registerUser(body: LeadRequest, session: string | null): Observable<OtpResponse> {
    return this.http.post<OtpResponse>(`${this.base}/api/v1/signup/register/user`, body,
      { headers: publicHeaders(session), params: { sendOTP: true } });
  }

  resendSignupOtp(key: string, session: string | null): Observable<OtpResponse | null> {
    return this.http.patch<OtpResponse | null>(`${this.base}/api/v1/lead/otp/re-send`, null,
      { headers: publicHeaders(session), params: { key, reSendEmailOTP: true } });
  }

  /** New organisation, step 2: verify the OTP; creates the tenant with this user as its admin. */
  onboardTenant(body: SignUpRequest, password: string, session: string | null): Observable<WithSession<Tenant>> {
    return this.http.post<Tenant>(`${this.base}/api/v1/signup/tenant/markify2`, body,
      { headers: { ...publicHeaders(session), 'X-PASS': password }, params: { messageId: body.messageId ?? '' }, observe: 'response' },
    ).pipe(map(res => ({ sessionId: sessionFrom(res.headers), body: res.body! })));
  }

  /** Signup can't set tenantType, so patch it onto the new tenant with its admin session. */
  setTenantType(tenant: Tenant, tenantType: string, adminSession: string): Observable<void> {
    return this.http.patch<void>(`${this.base}/api/v1/tenants`,
      { id: tenant.id, tenantLogin: tenant.tenantLogin, tenantName: tenant.tenantName, tenantType },
      { headers: withSession(adminSession) });
  }

  /** Joining an organisation, step 2: verify the OTP; creates the user in that tenant. */
  activateUser(tenantLogin: string, body: SignUpRequest, password: string, session: string | null): Observable<WithSession<IamUser>> {
    return this.http.post<IamUser>(`${this.base}/api/v1/signup/user/${encodeURIComponent(tenantLogin)}/activate`, body, {
      headers: { ...publicHeaders(session), 'X-PASS': password, 'X-APPKEY': APP_CONFIG.appKey }, observe: 'response',
    }).pipe(map(res => ({ sessionId: sessionFrom(res.headers), body: res.body! })));
  }

  // ── Org-admin approval of joiners (IAM user-verification) ───────────────

  /** Puts a new joiner into the "not reviewed" queue for their org admin. */
  requestApproval(userId: number, session: string): Observable<UserVerification> {
    return this.http.post<UserVerification>(`${this.base}/api/v1/user-verification/not-reviewed`, null, {
      headers: withSession(session), params: verificationParams(userId),
    });
  }

  /** Resolves to null when the user has no verification record. */
  verification(userId: number, session?: string): Observable<UserVerification | null> {
    return this.http.get<UserVerification>(`${this.base}/api/v1/user-verification`, {
      headers: withSession(session), params: verificationParams(userId),
    }).pipe(catchError((err: HttpErrorResponse) => err.status === 404 ? of(null) : throwError(() => err)));
  }
}

function verificationParams(userId: number) {
  return { userId, appContext: APP_CONFIG.appCode, marketContext: APP_CONFIG.verificationMarketContext };
}

/**
 * Session header when we have one. Pre-login calls (null session) authenticate as the app instead, using the
 * platform app-key scheme `Authorization: Appkey base64("appKey:<key>,appCode:<code>")`; IAM only lets it reach
 * endpoints on the app's open-API allow-list (PATCH /app/open-apis?appDetailsId=46).
 */
function withSession(id?: string | null): Record<string, string> {
  if (id) return { [APP_CONFIG.sessionHeader]: id };
  return id === null ? { Authorization: APP_KEY_AUTH } : {};
}

/**
 * The signup endpoints are on the platform's built-in public list and need no credentials. Sending the app key
 * there makes IAM check its open-API allow-list instead and reject the call ("Not allowed … with app key").
 */
function publicHeaders(id: string | null): Record<string, string> {
  return id ? { [APP_CONFIG.sessionHeader]: id } : {};
}

const APP_KEY_AUTH =`Appkey ${btoa(`appKey:${APP_CONFIG.appKey},appCode:${APP_CONFIG.appCode}`)}`;

function sessionFrom(headers: HttpHeaders): string;
function sessionFrom(headers: HttpHeaders, required: false): string | null;
function sessionFrom(headers: HttpHeaders, required = true): string | null {
  const id = headers.get(APP_CONFIG.sessionHeader) ?? headers.get('SESSIONID');
  if (!id && required) throw new Error('No session id returned by server');
  return id;
}

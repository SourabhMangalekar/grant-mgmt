import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { APP_CONFIG } from './config';
import type { Application } from './application.api';

/**
 * GrantCallDTOReq / GrantCallDTORes — commons-grant-service `/api/v1/grant-calls`.
 * Money is in minor units (paise); dates are epoch milliseconds; the *Json fields are JSON strings.
 */
export interface GrantCall {
  id?: number;
  callCode?: string;
  title?: string;
  theme?: string;
  description?: string;
  state?: string;
  currencyCode?: string;
  envelopeAmountMinor: number;
  minAwardMinor?: number;
  maxAwardMinor?: number;
  opensAt: number;
  closesAt: number;
  postedAt?: number;
  reviewersRequired: number;
  isCsrFunded: boolean;
  isForeignFunded: boolean;
  scheduleViiCode?: string;
  budgetFormat?: string;
  budgetPeriod?: string;
  budgetTemplateRef?: string;
  responseFormat?: string;
  responseConfigJson?: string;
  questionsJson?: string;
  requiredDocsJson?: string;
  rulesJson?: string;
  /** GrantCallDTORes nests the call's applications. Read-only; may be absent depending on the endpoint. */
  applications?: Application[];
}

/**
 * Lifecycle states the grant service accepts for a call: a call is made public by PUBLISHED.
 * Calls saved before the backend validated states may still carry the legacy 'OPEN', which means the same thing.
 */
export type CallState = 'DRAFT' | 'PUBLISHED' | 'CLOSED';
export const isPublished = (state: string | undefined) => state === 'PUBLISHED' || state === 'OPEN';

/** ApplicationDTO (subset) — an application against a grant call. */
export interface GrantApplication {
  id: number;
  referenceCode?: string;
  title?: string;
  organisationId: number;
  state?: string;
  requestedAmountMinor?: number;
  submittedAt?: number;
}

export interface Page<T> { elements?: T[]; totalElements?: number }

@Injectable({ providedIn: 'root' })
export class GrantCallApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${APP_CONFIG.grantBaseUrl}/api/v1/grant-calls`;

  /** ngrok's free tier answers browser requests with an HTML warning page unless this header is sent. */
  private readonly headers: Record<string, string> =
    this.base.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {};

  list(page = 0, size = 50): Observable<GrantCall[]> {
    return this.http.get<Page<GrantCall>>(this.base, { headers: this.headers, params: { page, size } })
      .pipe(map(p => p.elements ?? []));
  }

  get(id: number): Observable<GrantCall> {
    return this.http.get<GrantCall>(`${this.base}/${id}`, { headers: this.headers });
  }

  /**
   * Published (state PUBLISHED) calls from every funder, for grantees. The standard list is tenant-scoped (CodeMill's tenantFilter), so a
   * grantee only sees calls created in its own tenant — i.e. none. This uses the grant service's cross-tenant
   * `GET /grant-calls/open`; until that endpoint exists it falls back to the tenant-scoped list.
   */
  listOpen(page = 0, size = 100): Observable<GrantCall[]> {
    return this.http.get<Page<GrantCall>>(`${this.base}/open`, { headers: this.headers, params: { page, size } }).pipe(
      map(p => p.elements ?? []),
      catchError(err => endpointMissing(err) ? this.list(page, size) : throwError(() => err)),
    );
  }

  /** One published call by id for grantees (`GET /grant-calls/open/{id}`), falling back to the tenant-scoped read. */
  getOpen(id: number): Observable<GrantCall> {
    return this.http.get<GrantCall>(`${this.base}/open/${id}`, { headers: this.headers }).pipe(
      catchError(err => endpointMissing(err) ? this.get(id) : throwError(() => err)),
    );
  }

  applications(id: number, page = 0, size = 50): Observable<Page<GrantApplication>> {
    return this.http.get<Page<GrantApplication>>(`${this.base}/${id}/applications`, { headers: this.headers, params: { page, size } });
  }

  create(call: GrantCall): Observable<GrantCall> {
    return this.http.post<GrantCall>(this.base, call, { headers: this.headers });
  }
}

/**
 * The cross-tenant endpoint isn't deployed yet: no route (404/405), or `/grant-calls/open` being parsed as
 * `/grant-calls/{id}` with id "open" (400).
 */
function endpointMissing(err: unknown): boolean {
  return err instanceof HttpErrorResponse && [400, 404, 405].includes(err.status);
}

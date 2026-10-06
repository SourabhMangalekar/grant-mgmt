import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_CONFIG } from './config';

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
}

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

  applications(id: number, page = 0, size = 50): Observable<Page<GrantApplication>> {
    return this.http.get<Page<GrantApplication>>(`${this.base}/${id}/applications`, { headers: this.headers, params: { page, size } });
  }

  create(call: GrantCall): Observable<GrantCall> {
    return this.http.post<GrantCall>(this.base, call, { headers: this.headers });
  }
}

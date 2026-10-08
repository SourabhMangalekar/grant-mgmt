import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, from, map, of, switchMap, tap, toArray } from 'rxjs';
import { APP_CONFIG } from './config';
import { AuthStore } from './auth/auth.store';
import { Page } from './grant-call.api';

/** ApplicationDTOReq / ApplicationDTORes — commons-grant-service `/api/v1/applications`. Money in paise. */
export interface Application {
  id?: number;
  grantCallId: number;
  organisationId: number;
  disagreementFlagged: boolean;
  title?: string;
  referenceCode?: string;
  state?: string;
  currencyCode?: string;
  requestedAmountMinor?: number;
  durationMonths?: number;
  /** JSON string: { summary, answers: [{ questionId, question, answer }] } */
  answersJson?: string;
  budgetTotalMinor?: number;
  budgetNote?: string;
  consentGivenAt?: number;
  submittedAt?: number;
  awardId?: number;
  budgetFileRef?: string;
  entryCheckResult?: string;
  entryCheckReason?: string;
  /** Nested in ApplicationDTO responses; may be missing or empty depending on the endpoint. */
  applicationBudgetLines?: BudgetLine[];
  applicationDocuments?: ApplicationDocument[];
  reviews?: Review[];
}

/** ApplicationDocumentDTO — a document the applicant attached, held in the organisation's vault. */
export interface ApplicationDocument {
  id?: number;
  applicationId: number;
  vaultDocumentId: number;
  docType?: string;
  source?: string;
}

/** ReviewDTO — one reviewer's scores and recommendation. */
export interface Review {
  id?: number;
  applicationId: number;
  reviewerUserId: number;
  state?: string;
  recommendation?: string;
  comment?: string;
  scoreNeed?: number;
  scoreApproach?: number;
  scoreCapacity?: number;
  scoreBudget?: number;
  totalScore?: number;
  submittedAt?: number;
  /** NOT NULL in the grant service: always send it. */
  conflictDeclared?: boolean;
}

/**
 * AwardDTO — created by the grant service when an application is approved.
 * States: DUE_DILIGENCE | CONTRACTED | ACTIVE | COMPLETED. Its tranches are in core/tranches.ts.
 */
export interface Award {
  id?: number;
  applicationId: number;
  awardCode?: string;
  awardedAmountMinor: number;
  currencyCode?: string;
  state?: string;
  contractedAt?: number;
  auditedYearsOnFile?: number;
  bankAccountVerified?: boolean;
}

/** ApplicationBudgetLineDTO */
export interface BudgetLine {
  id?: number;
  applicationId: number;
  lineNo?: number;
  head?: string;
  item?: string;
  quantity?: number;
  unitCostMinor?: number;
  amountMinor: number;
  periodLabel?: string;
  note?: string;
}

/** OrganisationDTOReq / Res (subset) — the grant service's own record of an applicant organisation. */
export interface Organisation {
  id?: number;
  legalName?: string;
  kind?: string;
  /** NOT NULL in the grant service. The IAM tenant type, e.g. TENANT_TYPE.GRANTEE. */
  orgType?: string;
  contactName?: string;
  contactEmail?: string;
  contactMobile?: string;
  about?: string;
  district?: string;
  stateCode?: string;
  foundedYear?: number;
}

@Injectable({ providedIn: 'root' })
export class ApplicationApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${APP_CONFIG.grantBaseUrl}/api/v1`;
  private readonly headers: Record<string, string> =
    this.base.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {};
  private readonly auth = inject(AuthStore);
  /** Organisation id per tenant login, so switching accounts never reuses another tenant's organisation. */
  private readonly orgIds = new Map<string, number>();

  list(page = 0, size = 100): Observable<Application[]> {
    return this.http.get<Page<Application>>(`${this.base}/applications`, { headers: this.headers, params: { page, size } })
      .pipe(map(p => p.elements ?? []));
  }

  get(id: number): Observable<Application> {
    return this.http.get<Application>(`${this.base}/applications/${id}`, { headers: this.headers });
  }

  budgetLines(id: number): Observable<BudgetLine[]> {
    return this.http.get<Page<BudgetLine>>(`${this.base}/applications/${id}/application-budget-lines`,
      { headers: this.headers, params: { page: 0, size: 100 } }).pipe(map(p => p.elements ?? []));
  }

  /**
   * The grant-service Organisation for the signed-in tenant. Records are tenant-scoped, so the first one is ours;
   * if there's none yet it's created from the IAM tenant details.
   */
  myOrganisation(seed: Organisation): Observable<number> {
    const user = this.auth.user();
    const tenant = user?.tenantLogin ?? '';
    const cached = this.orgIds.get(tenant);
    if (cached != null) return of(cached);
    // org_type is NOT NULL: it's the signed-in tenant's type (granter or grantee).
    const body: Organisation = { orgType: APP_CONFIG.tenantTypes[user?.affiliation ?? 'grantee'], ...seed };
    return this.http.get<Page<Organisation>>(`${this.base}/organisations`, { headers: this.headers, params: { page: 0, size: 1 } }).pipe(
      switchMap(p => p.elements?.[0]?.id != null
        ? of(p.elements[0].id!)
        : this.http.post<Organisation>(`${this.base}/organisations`, body, { headers: this.headers }).pipe(map(o => o.id!))),
      tap(id => this.orgIds.set(tenant, id)),
    );
  }

  /**
   * Saves a proposal: creates the application, then its budget lines one by one, then (optionally) submits it.
   * Resolves to the saved application.
   */
  save(app: Application, lines: Omit<BudgetLine, 'applicationId'>[], submit: boolean): Observable<Application> {
    const body: Application = { referenceCode: newReferenceCode(), ...app };
    return this.http.post<Application>(`${this.base}/applications`, body, { headers: this.headers }).pipe(
      switchMap(created => {
        const id = created.id!;
        const lines$ = lines.length
          ? from(lines).pipe(
              concatMap(l => this.http.post<BudgetLine>(`${this.base}/application-budget-lines`, { ...l, applicationId: id }, { headers: this.headers })),
              toArray())
          : of([]);
        return lines$.pipe(
          switchMap(() => submit
            ? this.http.post<Application>(`${this.base}/applications/${id}/submit`, null, { headers: this.headers })
            : of(created)),
          map(result => ({ ...created, ...result, id })),
        );
      }),
    );
  }
}

/** Letters and digits that can't be misread for each other (no 0/O, 1/I/L). */
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * The application's reference code, e.g. APP-261007-K7Q2XM: the date it was started plus 6 random characters.
 * The grant service stores it NOT NULL (max 40 chars) but doesn't generate it, so the client has to.
 */
export function newReferenceCode(now = new Date()): string {
  const date = [now.getFullYear() % 100, now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, '0')).join('');
  const random = Array.from(crypto.getRandomValues(new Uint32Array(6)), n => REF_ALPHABET[n % REF_ALPHABET.length]).join('');
  return `APP-${date}-${random}`;
}

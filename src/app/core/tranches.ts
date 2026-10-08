import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, concatMap, forkJoin, from, last, map, of, switchMap, throwError, toArray } from 'rxjs';
import { APP_CONFIG } from './config';
import { Award } from './application.api';
import { Page } from './grant-call.api';

/**
 * The money after an award (docs/backend/BACKEND-FOR-FRONTEND.md §6, "The money journey"):
 *
 *   award ──/set-up-tranches──► tranche 1 PLANNED, the rest LOCKED
 *   plan SUBMITTED   ──/tranche-plans/{id}/approve──────► tranche READY
 *   tranche READY    ──/tranches/{id}/release──────────► tranche PAID
 *   report SUBMITTED ──/tranche-reports/{id}/approve────► tranche UTILISED, the next unlocks
 *   all UTILISED     ──/awards/{id}/close
 *
 * The funder sets up tranches, reviews plans and reports, and releases payments; the grantee writes the plans and
 * reports. State only moves through those transition endpoints; the service refuses anything out of order with a 400
 * whose errorMessage is written for people (show it as it is).
 *
 * Known gap (§4/§11): post-award records are still tenant-scoped, so until the backend fixes it each side may get 404s
 * on the other side's records.
 */

/** TrancheDTO. States: LOCKED | PLANNED | READY | PAID | UTILISED. Money in minor units, times in epoch ms. */
export interface Tranche {
  id: number;
  awardId: number;
  sequenceNo: number;
  percentage?: number;
  amountMinor: number;
  currencyCode?: string;
  milestoneLabel?: string;
  isMilestoneMet?: boolean;
  plannedAt?: number;
  reportDueAt?: number;
  paidAt?: number;
  paymentMode?: string;
  paymentReference?: string;
  state?: string;
  tranchePlanId?: number;
  trancheReportId?: number;
  utilisationCertificateId?: number;
}

/** TranchePlanItemDTO: one planned activity. `byDate` is an ISO date-time string (see toByDate). */
export interface TranchePlanItem {
  id?: number;
  tranchePlanId?: number;
  orderNo: number;
  activity: string;
  expectedOutput?: string;
  budgetMinor: number;
  byDate?: string;
}

/** TranchePlanDTO. States: DRAFT | SUBMITTED | APPROVED | CHANGES_REQUESTED. One plan per tranche. */
export interface TranchePlan {
  id?: number;
  trancheId: number;
  attempt: number;
  state?: string;
  submittedAt?: number;
  reviewComment?: string;
  reviewedAt?: number;
  reviewedByUserId?: number;
  tranchePlanItems?: TranchePlanItem[];
}

export type DeliveryState = 'DONE' | 'PARTLY_DONE' | 'NOT_DONE';
export const DELIVERY_STATES: { value: DeliveryState; label: string }[] = [
  { value: 'DONE', label: 'Done' }, { value: 'PARTLY_DONE', label: 'Partly done' }, { value: 'NOT_DONE', label: 'Not done' },
];

/** TrancheReportItemDTO: how one planned activity went. */
export interface TrancheReportItem {
  id?: number;
  trancheReportId?: number;
  tranchePlanItemId: number;
  deliveryState: DeliveryState;
  spentMinor?: number;
  remark?: string;
}

/** TrancheReportDTO. States: DRAFT | SUBMITTED | APPROVED | CHANGES_REQUESTED. One report per tranche. */
export interface TrancheReport {
  id?: number;
  trancheId: number;
  attempt: number;
  state?: string;
  submittedAt?: number;
  summary?: string;
  spentMinor?: number;
  photosFileName?: string;
  ucFileName?: string;
  reviewComment?: string;
  reviewedAt?: number;
  reviewedByUserId?: number;
  trancheReportItems?: TrancheReportItem[];
}

/** What the funder fills in per tranche when setting them up (2–4 tranches, percentages adding to 100). */
export interface TrancheSetup {
  percentage: number;
  milestoneLabel: string;
  plannedAt?: number;
  reportDueAt?: number;
}

/** What the grantee fills in for a plan. */
export type PlanItemInput = Omit<TranchePlanItem, 'id' | 'tranchePlanId'>;

/** What the grantee fills in for a report: one row per plan item, plus a summary. */
export interface ReportInput {
  summary: string;
  items: { tranchePlanItemId: number; deliveryState: DeliveryState; spentMinor: number; remark?: string }[];
  ucFileName?: string;
  photosFileName?: string;
}

/** Payment modes offered when releasing a tranche (TrancheDTO.paymentMode, max 20 chars). */
export const PAYMENT_MODES = [
  { value: 'NEFT', label: 'NEFT' }, { value: 'RTGS', label: 'RTGS' }, { value: 'IMPS', label: 'IMPS' },
  { value: 'UPI', label: 'UPI' }, { value: 'CHEQUE', label: 'Cheque' },
];

/** The tranche-count presets the set-up form offers: the service accepts 2, 3 or 4 tranches. */
export const TRANCHE_SPLITS: Record<2 | 3 | 4, number[]> = { 2: [50, 50], 3: [40, 40, 20], 4: [30, 30, 20, 20] };

/**
 * Where one tranche is, combining its state with its plan and report: decides what each side sees and can do.
 * - locked:          waiting for the previous tranche to be utilised
 * - awaiting-plan:   PLANNED, no plan yet (grantee writes one)
 * - plan-review:     plan SUBMITTED (funder approves or requests changes)
 * - plan-changes:    plan CHANGES_REQUESTED (grantee revises and resubmits)
 * - ready:           READY, plan approved (funder releases the payment)
 * - awaiting-report: PAID, no report yet (grantee reports)
 * - report-review:   report SUBMITTED (funder approves or requests changes)
 * - report-changes:  report CHANGES_REQUESTED (grantee revises and resubmits)
 * - utilised:        UTILISED, done
 */
export type TrancheStage =
  | 'locked' | 'awaiting-plan' | 'plan-review' | 'plan-changes' | 'ready'
  | 'awaiting-report' | 'report-review' | 'report-changes' | 'utilised' | 'other';

export function trancheStage(tranche: Tranche, plan: TranchePlan | null, report: TrancheReport | null): TrancheStage {
  const s = (tranche.state ?? '').toUpperCase();
  const planState = (plan?.state ?? '').toUpperCase();
  const reportState = (report?.state ?? '').toUpperCase();
  switch (s) {
    case 'LOCKED': return 'locked';
    case 'PLANNED':
      if (planState === 'SUBMITTED') return 'plan-review';
      if (planState === 'CHANGES_REQUESTED') return 'plan-changes';
      return 'awaiting-plan';
    case 'READY': return 'ready';
    case 'PAID':
      if (reportState === 'SUBMITTED') return 'report-review';
      if (reportState === 'CHANGES_REQUESTED') return 'report-changes';
      return 'awaiting-report';
    case 'UTILISED': return 'utilised';
    default: return 'other';
  }
}

/** Short label for a tranche or award state: 'DUE_DILIGENCE' → 'Due diligence'. */
export function stateLabel(state: string | undefined): string {
  if (!state) return '—';
  const text = state.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A plan item's `byDate` for the API: local midnight, ISO without a zone ("2026-11-30T00:00:00"). */
export function toByDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00`;
}

/** Reads `byDate` back as a Date, whatever shape the service returned (ISO string, with or without zone, or epoch ms). */
export function fromByDate(value: string | number | undefined | null): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return new Date(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** Splits the award across tranches by percentage; the last tranche takes the rounding remainder so the total is exact. */
export function splitAmount(totalMinor: number, percentages: number[]): number[] {
  const amounts = percentages.map(p => Math.floor((totalMinor * p) / 100));
  amounts[amounts.length - 1] += totalMinor - amounts.reduce((a, b) => a + b, 0);
  return amounts;
}

/** One tranche with its plan and report, as the award pages show it. */
export interface TrancheBundle {
  tranche: Tranche;
  plan: TranchePlan | null;
  report: TrancheReport | null;
  stage: TrancheStage;
}

@Injectable({ providedIn: 'root' })
export class TrancheService {
  private readonly http = inject(HttpClient);
  private readonly base = `${APP_CONFIG.grantBaseUrl}/api/v1`;
  /** ngrok's free tier answers browser requests with an HTML warning page unless this header is sent. */
  private readonly headers: Record<string, string> =
    this.base.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {};

  // ── Reads ──

  /** The award an approved application got; null when there's none, or when it isn't visible to the caller. */
  awardForApplication(applicationId: number): Observable<Award | null> {
    return this.http.get<Award>(`${this.base}/applications/${applicationId}/award`, { headers: this.headers })
      .pipe(map(a => a ?? null), catchError(err => notFound(err) ? of(null) : throwError(() => err)));
  }

  award(awardId: number): Observable<Award> {
    return this.http.get<Award>(`${this.base}/awards/${awardId}`, { headers: this.headers });
  }

  /** The award's tranches, in order. */
  tranches(awardId: number): Observable<Tranche[]> {
    return this.http.get<Page<Tranche>>(`${this.base}/awards/${awardId}/tranches`, { headers: this.headers, params: { page: 0, size: 20 } })
      .pipe(map(p => [...(p.elements ?? [])].sort((a, b) => a.sequenceNo - b.sequenceNo)));
  }

  /** A tranche's plan with its items; null when the grantee hasn't written one. */
  plan(trancheId: number): Observable<TranchePlan | null> {
    return this.http.get<TranchePlan>(`${this.base}/tranches/${trancheId}/tranche-plan`, { headers: this.headers }).pipe(
      catchError(err => notFound(err) ? of(null) : throwError(() => err)),
      switchMap(plan => !plan?.id ? of(plan ?? null) : this.http.get<Page<TranchePlanItem>>(
        `${this.base}/tranche-plans/${plan.id}/tranche-plan-items`, { headers: this.headers, params: { page: 0, size: 100 } },
      ).pipe(
        map(p => ({ ...plan, tranchePlanItems: sortItems(p.elements?.length ? p.elements : plan.tranchePlanItems ?? []) })),
        catchError(() => of({ ...plan, tranchePlanItems: sortItems(plan.tranchePlanItems ?? []) })),
      )),
    );
  }

  /** A tranche's report with its items; null when the grantee hasn't reported. */
  report(trancheId: number): Observable<TrancheReport | null> {
    return this.http.get<TrancheReport>(`${this.base}/tranches/${trancheId}/tranche-report`, { headers: this.headers }).pipe(
      catchError(err => notFound(err) ? of(null) : throwError(() => err)),
      switchMap(report => !report?.id ? of(report ?? null) : this.http.get<Page<TrancheReportItem>>(
        `${this.base}/tranche-reports/${report.id}/tranche-report-items`, { headers: this.headers, params: { page: 0, size: 100 } },
      ).pipe(
        map(p => ({ ...report, trancheReportItems: p.elements?.length ? p.elements : report.trancheReportItems ?? [] })),
        catchError(() => of(report)),
      )),
    );
  }

  /** Every tranche of an award with its plan and report, in order. */
  bundles(awardId: number): Observable<TrancheBundle[]> {
    return this.tranches(awardId).pipe(
      switchMap(tranches => !tranches.length ? of([]) : forkJoin(tranches.map(tranche =>
        forkJoin([this.plan(tranche.id), this.report(tranche.id)]).pipe(
          map(([plan, report]): TrancheBundle => ({ tranche, plan, report, stage: trancheStage(tranche, plan, report) })),
        )))),
    );
  }

  // ── Funder ──

  /** Splits the award into 2–4 tranches. Done once; tranche 1 becomes PLANNED, the rest LOCKED. */
  setUpTranches(award: Award & { id: number }, setup: TrancheSetup[]): Observable<Award> {
    const amounts = splitAmount(award.awardedAmountMinor, setup.map(s => s.percentage));
    const body = setup.map((s, i) => ({
      awardId: award.id, sequenceNo: i + 1, percentage: s.percentage, amountMinor: amounts[i],
      currencyCode: award.currencyCode || 'INR', milestoneLabel: s.milestoneLabel.trim(),
      reportDueAt: s.reportDueAt, isMilestoneMet: false,
    }));
    return this.http.post<Award>(`${this.base}/awards/${award.id}/set-up-tranches`, body, { headers: this.headers });
  }

  /** SUBMITTED → APPROVED; the only thing that makes a tranche READY. The comment is optional. */
  approvePlan(planId: number, comment?: string): Observable<TranchePlan> {
    return this.http.post<TranchePlan>(`${this.base}/tranche-plans/${planId}/approve`, null,
      { headers: this.headers, params: comment?.trim() ? { comment: comment.trim() } : {} });
  }

  /** SUBMITTED → CHANGES_REQUESTED; the comment (required) tells the grantee what to change. */
  requestPlanChanges(planId: number, comment: string): Observable<TranchePlan> {
    return this.http.post<TranchePlan>(`${this.base}/tranche-plans/${planId}/request-changes`, null,
      { headers: this.headers, params: { comment: comment.trim() } });
  }

  /** READY → PAID. Needs the bank's payment reference (UTR). */
  release(trancheId: number, paymentReference: string, paymentMode: string): Observable<Tranche> {
    return this.http.post<Tranche>(`${this.base}/tranches/${trancheId}/release`, null,
      { headers: this.headers, params: { paymentReference: paymentReference.trim(), paymentMode } });
  }

  /** Report SUBMITTED → APPROVED: the tranche becomes UTILISED and the next one unlocks. */
  approveReport(reportId: number, comment?: string): Observable<TrancheReport> {
    return this.http.post<TrancheReport>(`${this.base}/tranche-reports/${reportId}/approve`, null,
      { headers: this.headers, params: comment?.trim() ? { comment: comment.trim() } : {} });
  }

  requestReportChanges(reportId: number, comment: string): Observable<TrancheReport> {
    return this.http.post<TrancheReport>(`${this.base}/tranche-reports/${reportId}/request-changes`, null,
      { headers: this.headers, params: { comment: comment.trim() } });
  }

  /** Closes the award once every tranche is utilised (refused otherwise). */
  closeAward(awardId: number, comment?: string): Observable<Award> {
    return this.http.post<Award>(`${this.base}/awards/${awardId}/close`, null,
      { headers: this.headers, params: comment?.trim() ? { comment: comment.trim() } : {} });
  }

  // ── Grantee ──

  /** Writes the tranche's plan: the plan (SUBMITTED, attempt 1), then its items one by one. */
  submitPlan(trancheId: number, items: PlanItemInput[]): Observable<TranchePlan> {
    return this.http.post<TranchePlan>(`${this.base}/tranche-plans`,
      { trancheId, state: 'SUBMITTED', attempt: 1, submittedAt: Date.now() }, { headers: this.headers },
    ).pipe(switchMap(plan => this.addPlanItems(plan.id!, items).pipe(map(saved => ({ ...plan, tranchePlanItems: saved })))));
  }

  /** After the funder asked for changes: replaces the items, then resubmits (CHANGES_REQUESTED → SUBMITTED). */
  revisePlan(plan: TranchePlan & { id: number }, items: PlanItemInput[]): Observable<TranchePlan> {
    return this.removeAll('tranche-plan-items', plan.tranchePlanItems ?? []).pipe(
      switchMap(() => this.addPlanItems(plan.id, items)),
      switchMap(() => this.http.post<TranchePlan>(`${this.base}/tranche-plans/${plan.id}/resubmit`, null, { headers: this.headers })),
    );
  }

  /** Writes the tranche's report (SUBMITTED, attempt 1) and one item per planned activity. */
  submitReport(trancheId: number, input: ReportInput): Observable<TrancheReport> {
    return this.http.post<TrancheReport>(`${this.base}/tranche-reports`, {
      trancheId, state: 'SUBMITTED', attempt: 1, submittedAt: Date.now(), summary: input.summary.trim(),
      spentMinor: input.items.reduce((sum, i) => sum + i.spentMinor, 0),
      ...(input.ucFileName ? { ucFileName: input.ucFileName } : {}), ...(input.photosFileName ? { photosFileName: input.photosFileName } : {}),
    }, { headers: this.headers }).pipe(
      switchMap(report => this.addReportItems(report.id!, input.items).pipe(map(saved => ({ ...report, trancheReportItems: saved })))),
    );
  }

  /**
   * After the funder asked for changes: updates the summary and spend (PUT without `state`, which only transitions may
   * change), replaces the items, then resubmits.
   */
  reviseReport(report: TrancheReport & { id: number }, input: ReportInput): Observable<TrancheReport> {
    const { state: _state, trancheReportItems: _items, ucFileName: _uc, photosFileName: _photos, ...rest } = report;
    // The PUT is a patch (null = not supplied), so a cleared file name is sent as '' to overwrite the old one.
    const body = {
      ...rest, summary: input.summary.trim(), spentMinor: input.items.reduce((sum, i) => sum + i.spentMinor, 0),
      ucFileName: input.ucFileName ?? '', photosFileName: input.photosFileName ?? '',
    };
    return this.http.put<TrancheReport>(`${this.base}/tranche-reports`, body, { headers: this.headers }).pipe(
      switchMap(() => this.removeAll('tranche-report-items', report.trancheReportItems ?? [])),
      switchMap(() => this.addReportItems(report.id, input.items)),
      switchMap(() => this.http.post<TrancheReport>(`${this.base}/tranche-reports/${report.id}/resubmit`, null, { headers: this.headers })),
    );
  }

  // ── Helpers ──

  private addPlanItems(planId: number, items: PlanItemInput[]): Observable<TranchePlanItem[]> {
    if (!items.length) return of([]);
    return from(items).pipe(
      concatMap((item, i) => this.http.post<TranchePlanItem>(`${this.base}/tranche-plan-items`,
        { ...item, orderNo: item.orderNo ?? i + 1, tranchePlanId: planId }, { headers: this.headers })),
      toArray(),
    );
  }

  private addReportItems(reportId: number, items: ReportInput['items']): Observable<TrancheReportItem[]> {
    if (!items.length) return of([]);
    return from(items).pipe(
      concatMap(item => this.http.post<TrancheReportItem>(`${this.base}/tranche-report-items`,
        { ...item, trancheReportId: reportId }, { headers: this.headers })),
      toArray(),
    );
  }

  /** Soft-deletes rows one by one (DELETE answers 204). */
  private removeAll(collection: string, rows: { id?: number }[]): Observable<unknown> {
    const ids = rows.map(r => r.id).filter((id): id is number => id != null);
    if (!ids.length) return of(null);
    return from(ids).pipe(
      concatMap(id => this.http.delete(`${this.base}/${collection}/${id}`, { headers: this.headers, params: { reason: 'Revised' } })),
      last(),
    );
  }
}

const notFound = (err: unknown) => err instanceof HttpErrorResponse && err.status === 404;
const sortItems = (items: TranchePlanItem[]) => [...items].sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0));

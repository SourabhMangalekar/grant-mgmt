import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap, throwError } from 'rxjs';
import { APP_CONFIG } from './config';
import { Application, ApplicationDocument, Award, BudgetLine, Organisation, Review } from './application.api';
import { GrantCall, GrantCallApi, Page } from './grant-call.api';
import { GrantStatus } from './grant.model';
import { statusOf } from './grantee.service';

/** An application a funder received, joined with the call it was sent to. */
export interface ReceivedApplication extends Application {
  id: number;
  call: GrantCall;
  status: GrantStatus;
}

/** Everything the funder's application page shows. */
export interface ReceivedApplicationDetail {
  application: ReceivedApplication;
  organisation: Organisation | null;
  budgetLines: BudgetLine[];
  documents: ApplicationDocument[];
  reviews: Review[];
}

/**
 * Where an application is in the funder's decision chain. The grant service moves it one step at a time and refuses
 * anything out of order: SCREENING → (start-review) UNDER_REVIEW → (reviews, then send-to-committee) COMMITTEE →
 * (approve | reject) APPROVED | REJECTED.
 */
export type Stage = 'screening' | 'review' | 'committee' | 'approved' | 'rejected' | 'other';

export function stageOf(state: string | undefined): Stage {
  switch (statusOf(state)) {
    case 'Screening': return 'screening';
    case 'In Review': return 'review';
    case 'In Committee': return 'committee';
    case 'Approved': return 'approved';
    case 'Rejected': return 'rejected';
    default: return 'other';
  }
}

/** A reviewer's scores (each 1–5) and recommendation, as the review form collects them. */
export interface ReviewInput {
  reviewerUserId: number;
  scoreNeed: number;
  scoreApproach: number;
  scoreCapacity: number;
  scoreBudget: number;
  recommendation: string;
  comment: string;
  conflictDeclared: boolean;
}

/** The four 1–5 scores as a percentage: 4 + 4 + 4 + 4 out of 20 is 80. */
export const totalScore = (r: Pick<ReviewInput, 'scoreNeed' | 'scoreApproach' | 'scoreCapacity' | 'scoreBudget'>) =>
  Math.round(((r.scoreNeed + r.scoreApproach + r.scoreCapacity + r.scoreBudget) / 20) * 100);

/** `{ summary, answers: [{ questionId, question, answer }] }`: the shape the proposal form stores in answersJson. */
export interface ProposalAnswers {
  summary: string;
  answers: { questionId?: string; question?: string; answer?: string }[];
}

/**
 * The funder side of applications: what grantees sent to the signed-in funder's calls.
 *
 * The grant service filters records by tenant and applications belong to the grantee's tenant, so the funder's
 * reads can come back empty or 404 until the backend lets a call's owner read its applications
 * (docs/backend/grant-service-cross-tenant-access.md §4.2). To show data as soon as any route returns it, every
 * read combines the dedicated endpoint with the copy nested in the call (`GrantCallDTORes.applications`).
 */
@Injectable({ providedIn: 'root' })
export class ReceivedApplicationsService {
  private readonly http = inject(HttpClient);
  private readonly calls = inject(GrantCallApi);
  private readonly base = `${APP_CONFIG.grantBaseUrl}/api/v1`;
  /** ngrok's free tier answers browser requests with an HTML warning page unless this header is sent. */
  private readonly headers: Record<string, string> =
    this.base.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {};

  /** Every application received across the funder's calls, newest first. */
  all(): Observable<ReceivedApplication[]> {
    return this.calls.list(0, 100).pipe(switchMap(calls => this.forCalls(calls)));
  }

  /** Applications received for the given calls (e.g. the calls already shown on a page), newest first. */
  forCalls(calls: GrantCall[]): Observable<ReceivedApplication[]> {
    const withId = calls.filter(c => c.id != null);
    if (!withId.length) return of([]);
    return forkJoin(withId.map(c => this.listed(c.id!).pipe(map(listed => received(c, listed)))))
      .pipe(map(groups => groups.flat().sort(newestFirst)));
  }

  /** One call and the applications it received, newest first. */
  forCall(callId: number): Observable<{ call: GrantCall; applications: ReceivedApplication[] }> {
    return forkJoin([this.calls.get(callId), this.listed(callId)]).pipe(
      map(([call, listed]) => ({ call, applications: received(call, listed).sort(newestFirst) })),
    );
  }

  /** Applicant organisations by id, best effort: ids the service won't return are just missing from the map. */
  organisations(ids: number[]): Observable<Map<number, Organisation>> {
    const unique = [...new Set(ids.filter(id => id != null))];
    if (!unique.length) return of(new Map());
    return this.http.post<Organisation[]>(`${this.base}/organisations/ids`, unique, { headers: this.headers }).pipe(
      map(orgs => new Map((orgs ?? []).filter(o => o.id != null).map(o => [o.id!, o]))),
      catchError(() => of(new Map<number, Organisation>())),
    );
  }

  // ── The decision chain. Each step is its own endpoint; the service checks the order, the number of reviews, the
  //    award range and the required comments, and answers 400 with a message written for people when it refuses. ──

  /** SCREENING → UNDER_REVIEW. */
  startReview(applicationId: number): Observable<Application> {
    return this.http.post<Application>(`${this.base}/applications/${applicationId}/start-review`, null, { headers: this.headers });
  }

  /** One reviewer's review, submitted straight away. The call says how many are needed (reviewersRequired). */
  submitReview(applicationId: number, review: ReviewInput): Observable<Review> {
    return this.http.post<Review>(`${this.base}/reviews`, {
      applicationId, ...review, state: 'SUBMITTED', totalScore: totalScore(review), submittedAt: Date.now(),
    }, { headers: this.headers });
  }

  /**
   * UNDER_REVIEW → COMMITTEE, once enough reviews are in. If the reviewers disagree materially the service refuses;
   * sending again with `override` (and a reason, recorded in the audit trail) goes ahead anyway.
   */
  sendToCommittee(applicationId: number, override?: { comment: string }): Observable<Application> {
    const params: Record<string, string> = override ? { overrideDisagreement: 'true', comment: override.comment } : {};
    return this.http.post<Application>(`${this.base}/applications/${applicationId}/send-to-committee`, null, { headers: this.headers, params });
  }

  /** COMMITTEE → APPROVED; the service creates the award. The comment is shown to the applicant. */
  approve(applicationId: number, amountMinor: number, comment: string): Observable<Application> {
    return this.http.post<Application>(`${this.base}/applications/${applicationId}/approve`, null,
      { headers: this.headers, params: { amountMinor, comment } });
  }

  /** COMMITTEE → REJECTED. The reason is shown to the applicant. */
  reject(applicationId: number, comment: string): Observable<Application> {
    return this.http.post<Application>(`${this.base}/applications/${applicationId}/reject`, null,
      { headers: this.headers, params: { comment } });
  }

  /** The award an approved application got; null when there's none (yet). */
  award(applicationId: number): Observable<Award | null> {
    return this.http.get<Award | null>(`${this.base}/applications/${applicationId}/award`, { headers: this.headers })
      .pipe(catchError(() => of(null)));
  }

  /**
   * One application to one of the funder's calls, with its applicant, budget, documents and reviews.
   * Errors with a 404 HttpErrorResponse when the application doesn't exist, isn't for this call, or is still a draft.
   */
  detail(callId: number, applicationId: number): Observable<ReceivedApplicationDetail> {
    return this.forCall(callId).pipe(
      switchMap(({ call, applications }) => {
        const listed = applications.find(a => a.id === applicationId);
        return this.http.get<Application>(`${this.base}/applications/${applicationId}`, { headers: this.headers }).pipe(
          map(fetched => (listed ? { ...listed, ...fetched } : fetched) as Application),
          catchError(err => (listed ? of(listed) : throwError(() => err))),
          map(app => ({ call, app })),
        );
      }),
      switchMap(({ call, app }) => {
        if (!app || app.id == null || (app.grantCallId != null && app.grantCallId !== callId) || isDraft(app.state)) {
          return throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' }));
        }
        const application: ReceivedApplication = { ...app, id: app.id, grantCallId: callId, call, status: statusOf(app.state) };
        return forkJoin({
          organisation: this.http.get<Organisation>(`${this.base}/organisations/${app.organisationId}`, { headers: this.headers })
            .pipe(catchError(() => of(null))),
          budgetLines: this.nested<BudgetLine>(`/applications/${app.id}/application-budget-lines`, app.applicationBudgetLines),
          documents: this.nested<ApplicationDocument>(`/applications/${app.id}/application-documents`, app.applicationDocuments),
          reviews: this.nested<Review>(`/applications/${app.id}/reviews`, app.reviews),
        }).pipe(map(rest => ({ application, ...rest, budgetLines: rest.budgetLines.sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0)) })));
      }),
    );
  }

  /** `GET /grant-calls/{id}/applications`; an empty list if the service refuses (the nested copy may still have them). */
  private listed(callId: number): Observable<Application[]> {
    return this.calls.applications(callId, 0, 200).pipe(
      map(p => (p.elements ?? []) as Application[]),
      catchError(() => of([] as Application[])),
    );
  }

  /** A paged sub-resource; falls back to the copy nested in the application when the endpoint is empty or refuses. */
  private nested<T>(path: string, fallback: T[] | undefined): Observable<T[]> {
    return this.http.get<Page<T>>(`${this.base}${path}`, { headers: this.headers, params: { page: 0, size: 200 } }).pipe(
      map(p => (p.elements?.length ? p.elements : fallback ?? [])),
      catchError(() => of(fallback ?? [])),
    );
  }
}

/** Parses an application's answersJson; tolerates empty or malformed values. */
export function proposalAnswers(app: Pick<Application, 'answersJson'>): ProposalAnswers {
  try {
    const parsed = JSON.parse(app.answersJson || '{}');
    return { summary: parsed?.summary ?? '', answers: Array.isArray(parsed?.answers) ? parsed.answers : [] };
  } catch {
    return { summary: '', answers: [] };
  }
}

/** The applicant's name, or a stand-in while the service won't share the organisation record. */
export function applicantName(org: Organisation | null | undefined, organisationId: number | undefined): string {
  return org?.legalName || (organisationId != null ? `Organisation #${organisationId}` : 'Unknown applicant');
}

/** Drafts are the grantee's unfinished work: a funder never sees them. Agrees with statusOf, so no state reads as a draft. */
export const isDraft = (state: string | undefined) => statusOf(state) === 'Draft';

/** Merges the call's nested applications with the listed ones (by id) and drops drafts. */
function received(call: GrantCall, listed: Application[]): ReceivedApplication[] {
  const byId = new Map<number, Application>();
  for (const a of [...(call.applications ?? []), ...listed]) {
    if (a?.id != null) byId.set(a.id, { ...byId.get(a.id), ...a });
  }
  return [...byId.values()]
    .filter(a => !isDraft(a.state) && (a.grantCallId == null || a.grantCallId === call.id))
    .map(a => ({ ...a, id: a.id!, grantCallId: call.id!, call, status: statusOf(a.state) }));
}

const newestFirst = (a: Application, b: Application) =>
  (b.submittedAt ?? 0) - (a.submittedAt ?? 0) || (b.id ?? 0) - (a.id ?? 0);

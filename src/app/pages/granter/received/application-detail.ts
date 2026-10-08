import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Observable, Subject, catchError, filter, map, merge, of, startWith, switchMap } from 'rxjs';
import { StatusChip } from '../../../core/status-chip';
import {
  ReceivedApplicationDetail, ReceivedApplicationsService, applicantName, proposalAnswers,
} from '../../../core/received-applications';
import { ApplicationWorkflow } from './application-workflow';
import { REQUIRED_DOCS } from '../grant-call-form/grant-call-form';

type View =
  | { state: 'loading' }
  | { state: 'error'; notFound: boolean }
  | { state: 'ready'; detail: ReceivedApplicationDetail };

const LOADING: View = { state: 'loading' };

/**
 * One application a funder received: the proposal, its budget, the applicant, documents and reviews, and the funder's
 * review and decision on it (ApplicationWorkflow).
 */
@Component({
  selector: 'gm-application-detail',
  imports: [CurrencyPipe, DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, StatusChip, ApplicationWorkflow],
  templateUrl: './application-detail.html',
  styleUrl: './application-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationDetail {
  private readonly received = inject(ReceivedApplicationsService);

  /** Bound from the :id route param (the grant call). */
  readonly id = input.required<string>();
  /** Bound from the :applicationId route param. */
  readonly applicationId = input.required<string>();

  /** Bumped by "Try again" to reload. */
  private readonly attempt = signal(0);

  /** Fired after a review or decision step is saved: reloads in place, keeping the page on screen meanwhile. */
  private readonly reload$ = new Subject<void>();

  protected readonly view = toSignal(
    toObservable(computed(() => ({ callId: Number(this.id()), applicationId: Number(this.applicationId()), attempt: this.attempt() }))).pipe(
      switchMap(({ callId, applicationId }) => merge(
        this.fetch(callId, applicationId).pipe(startWith(LOADING)),
        this.reload$.pipe(switchMap(() => this.fetch(callId, applicationId).pipe(filter(v => v.state === 'ready')))),
      )),
    ),
    { initialValue: LOADING },
  );

  protected readonly state = computed(() => this.view().state);
  protected readonly notFound = computed(() => { const v = this.view(); return v.state === 'error' && v.notFound; });
  private readonly detail = computed(() => { const v = this.view(); return v.state === 'ready' ? v.detail : null; });

  protected readonly app = computed(() => this.detail()?.application ?? null);
  /** The reviews as the service returned them, for the review-and-decision panel. */
  protected readonly rawReviews = computed(() => this.detail()?.reviews ?? []);
  protected readonly org = computed(() => this.detail()?.organisation ?? null);
  protected readonly currency = computed(() => this.app()?.currencyCode || this.app()?.call.currencyCode || 'INR');
  protected readonly applicant = computed(() => applicantName(this.org(), this.app()?.organisationId));
  /** When it was sent: submittedAt, else when the applicant accepted the declaration. */
  protected readonly sentAt = computed(() => this.app()?.submittedAt ?? this.app()?.consentGivenAt);

  protected readonly proposal = computed(() => proposalAnswers(this.app() ?? {}));
  /** Each answer with its question: the text stored with the answer, else the call's question with that id. */
  protected readonly answers = computed(() => {
    const questions = questionTexts(this.app()?.call.questionsJson);
    return this.proposal().answers.map((a, i) => ({
      question: a.question?.trim() || (a.questionId && questions.get(a.questionId)) || `Question ${i + 1}`,
      answer: a.answer?.trim() ?? '',
    }));
  });

  protected readonly lines = computed(() => (this.detail()?.budgetLines ?? []).map(l => ({
    ...l,
    detail: [l.periodLabel, l.note].filter(Boolean).join(' · '),
  })));
  protected readonly linesTotal = computed(() => this.lines().reduce((sum, l) => sum + (l.amountMinor ?? 0), 0));
  /** For the key facts: the total the applicant saved, else the sum of the lines. */
  protected readonly budgetTotal = computed(() => this.app()?.budgetTotalMinor ?? (this.lines().length ? this.linesTotal() : null));
  /** Lines total minus the requested amount when the two disagree; null when they match or can't be compared. */
  protected readonly budgetGap = computed(() => {
    const requested = this.app()?.requestedAmountMinor;
    if (!this.lines().length || requested == null) return null;
    return this.linesTotal() - requested || null;
  });

  /** The call's per-award limits, for context next to the amount requested. */
  protected readonly awardRange = computed(() => {
    const c = this.app()?.call;
    if (!c || (c.minAwardMinor == null && c.maxAwardMinor == null)) return null;
    return { min: c.minAwardMinor ?? null, max: c.maxAwardMinor ?? null };
  });

  /** The organisation's kind; "Grantee" (every applicant's tenant type) says nothing, so it's left out. */
  protected readonly orgKind = computed(() => {
    const o = this.org();
    const kind = o?.kind || o?.orgType;
    const label = kind ? humanise(kind) : null;
    return label === 'Grantee' ? null : label;
  });
  protected readonly orgPlace = computed(() => { const o = this.org(); return [o?.district, o?.stateCode].filter(Boolean).join(', '); });
  protected readonly telHref = computed(() => {
    const mobile = this.org()?.contactMobile?.replace(/[^\d+]/g, '');
    return mobile ? `tel:${mobile}` : null;
  });

  protected readonly documents = computed(() => (this.detail()?.documents ?? []).map(d => ({
    label: docLabel(d.docType),
    source: d.source ? humanise(d.source) : null,
  })));
  /** What the call asks applicants for, shown while the application has no documents attached. */
  protected readonly requiredDocs = computed(() => {
    try {
      const codes = JSON.parse(this.app()?.call.requiredDocsJson || '[]');
      return Array.isArray(codes) ? codes.map(c => docLabel(String(c))) : [];
    } catch { return []; }
  });

  protected readonly reviews = computed(() => (this.detail()?.reviews ?? []).map((r, i) => ({
    reviewer: `Reviewer ${i + 1}`,
    recommendation: r.recommendation ? humanise(r.recommendation) : null,
    tone: tone(r.recommendation),
    score: r.totalScore,
    breakdown: ([['Need', r.scoreNeed], ['Approach', r.scoreApproach], ['Capacity', r.scoreCapacity], ['Budget', r.scoreBudget]] as const)
      .filter(([, score]) => score != null).map(([name, score]) => `${name} ${score}`).join(' · '),
    comment: r.comment?.trim() ?? '',
    submittedAt: r.submittedAt,
    state: r.state ? humanise(r.state) : null,
  })));

  protected retry() { this.attempt.update(n => n + 1); }
  protected refresh() { this.reload$.next(); }

  private fetch(callId: number, applicationId: number): Observable<View> {
    if (!Number.isInteger(callId) || callId <= 0 || !Number.isInteger(applicationId) || applicationId <= 0) {
      return of<View>({ state: 'error', notFound: true });
    }
    return this.received.detail(callId, applicationId).pipe(
      map((detail): View => ({ state: 'ready', detail })),
      catchError(err => of<View>({ state: 'error', notFound: err instanceof HttpErrorResponse && err.status === 404 })),
    );
  }
}

/** The call's questions by id; plain-string questions get the ids the proposal form gives them (Q1, Q2…). */
function questionTexts(raw: string | undefined): Map<string, string> {
  try {
    const list = JSON.parse(raw || '[]') as ({ id?: string; text?: string } | string)[];
    return new Map(list.map((q, i): [string, string] =>
      typeof q === 'string' ? [`Q${i + 1}`, q] : [q?.id ?? `Q${i + 1}`, q?.text ?? '']));
  } catch {
    return new Map();
  }
}

const docLabel = (code: string | undefined) => (code && REQUIRED_DOCS.find(d => d.code === code)?.label) || code || 'Document';

/** 'TENANT_TYPE.GRANTEE' → 'Grantee', 'NOT_RECOMMENDED' → 'Not recommended'. */
function humanise(code: string): string {
  const last = (code.split('.').pop() ?? code).trim();
  // Short acronyms (NGO, FPO, SHG) read better as they are.
  if (/^[A-Z]{2,4}$/.test(last)) return last;
  const text = last.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Colour for a reviewer's recommendation; negatives are checked first so "NOT_RECOMMENDED" isn't read as a yes. */
function tone(recommendation: string | undefined): 'positive' | 'negative' | 'neutral' {
  const r = (recommendation ?? '').toUpperCase();
  if (/REJECT|DECLIN|\bNOT\b|NOT_|^NO$/.test(r)) return 'negative';
  if (/APPROV|FUND|RECOMMEND|ACCEPT|^YES$/.test(r)) return 'positive';
  return 'neutral';
}

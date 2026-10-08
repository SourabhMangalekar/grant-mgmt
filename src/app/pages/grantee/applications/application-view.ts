import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, input, signal, viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Observable, Subject, catchError, filter, finalize, map, merge, of, startWith, switchMap, throwError } from 'rxjs';
import { Application, ApplicationApi, Award } from '../../../core/application.api';
import { apiErrorMessage } from '../../../core/api-error';
import { confirmAction } from '../../../core/confirm-dialog';
import { GrantCall, GrantCallApi } from '../../../core/grant-call.api';
import { GrantStatus } from '../../../core/grant.model';
import { statusOf } from '../../../core/grantee.service';
import { proposalAnswers } from '../../../core/received-applications';
import { StatusChip } from '../../../core/status-chip';
import {
  PAYMENT_MODES, PlanItemInput, ReportInput, Tranche, TrancheBundle, TrancheService, TrancheStage, stateLabel,
} from '../../../core/tranches';
import { TranchePlanForm } from '../../shared/tranches/tranche-plan-form';
import { TranchePlanView } from '../../shared/tranches/tranche-plan-view';
import { TrancheReportForm } from '../../shared/tranches/tranche-report-form';
import { TrancheReportView } from '../../shared/tranches/tranche-report-view';
import { TrancheStateChip } from '../../shared/tranches/tranche-state-chip';

type View =
  | { state: 'loading' }
  | { state: 'error'; notFound: boolean }
  | { state: 'ready'; app: Application & { id: number }; call: GrantCall | null };

/**
 * The "Your grant" section. `bundles` is null when the service won't show the tranches to the grantee: post-award
 * records are still tenant-scoped (docs/backend/BACKEND-FOR-FRONTEND.md §4), so that reads as "not set up yet".
 */
type GrantView =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'none' }
  | { state: 'ready'; award: Award; bundles: TrancheBundle[] | null };

const LOADING: View = { state: 'loading' };
const GRANT_LOADING: GrantView = { state: 'loading' };

/** One plain-language line per stage, under the key facts. */
const EXPLAINERS: Record<GrantStatus, { icon: string; text: string }> = {
  'Draft': { icon: 'edit_note', text: 'This is a draft: it hasn’t been sent to the funder yet.' },
  'Screening': {
    icon: 'fact_check',
    text: 'Your application is with the funder. It goes through their entry checks first, then waits for the review to start.',
  },
  'In Review': {
    icon: 'rate_review',
    text: 'The funder’s reviewers are scoring your application. Once the reviews are in, it goes to their committee.',
  },
  'In Committee': { icon: 'groups', text: 'The reviews are in and the funder’s committee is deciding. You’ll see their decision here.' },
  'Approved': { icon: 'verified', text: 'Good news: your funder approved this application. Your grant and its payments are below.' },
  'Rejected': { icon: 'block', text: 'The funder decided not to fund this application this time. Thank you for applying.' },
  'Closed': { icon: 'inventory_2', text: 'This application is closed.' },
};

/** What the grantee has to do on a tranche at this stage; these cards are highlighted. */
const GRANTEE_TURN: TrancheStage[] = ['awaiting-plan', 'plan-changes', 'awaiting-report', 'report-changes'];
/** Stages where the plan has been approved, so it's shown for reference. */
const PLAN_APPROVED: TrancheStage[] = ['ready', 'awaiting-report', 'report-review', 'report-changes', 'utilised'];

const LOCKED_NOTE = 'Your funder will review it; you can’t edit it unless they ask for changes.';

type Outcome = { trancheId: number; kind: 'success' | 'error'; text: string };

/**
 * One of the grantee's own applications: where it is in the funder's decision chain and, once approved, the grant and
 * its tranches. The grantee writes a plan for each tranche before the funder releases it, then reports on how it went;
 * the funder's approval of the report unlocks the next tranche (core/tranches.ts).
 */
@Component({
  selector: 'gm-application-view',
  imports: [
    CurrencyPipe, DatePipe, NgTemplateOutlet, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, StatusChip,
    TranchePlanForm, TranchePlanView, TrancheReportForm, TrancheReportView, TrancheStateChip,
  ],
  templateUrl: './application-view.html',
  styleUrl: './application-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationView {
  private readonly applications = inject(ApplicationApi);
  private readonly calls = inject(GrantCallApi);
  private readonly tranches = inject(TrancheService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  /** Bound from the :id route param. */
  readonly id = input.required<string>();

  /** Bumped by "Try again" to reload the application, or just the grant section. */
  private readonly attempt = signal(0);
  private readonly grantAttempt = signal(0);
  /** A fresh grant section after a step was saved: replaces the old one in place, without a spinner. */
  private readonly grantReloaded$ = new Subject<GrantView>();

  protected readonly view = toSignal(
    toObservable(computed(() => ({ id: Number(this.id()), attempt: this.attempt() }))).pipe(
      switchMap(({ id }) => this.fetch(id).pipe(startWith(LOADING))),
    ),
    { initialValue: LOADING },
  );

  protected readonly state = computed(() => this.view().state);
  protected readonly notFound = computed(() => { const v = this.view(); return v.state === 'error' && v.notFound; });
  private readonly ready = computed(() => { const v = this.view(); return v.state === 'ready' ? v : null; });
  protected readonly app = computed(() => this.ready()?.app ?? null);
  protected readonly call = computed(() => this.ready()?.call ?? null);

  protected readonly currency = computed(() => this.app()?.currencyCode || this.call()?.currencyCode || 'INR');
  /** An application that failed its entry checks can never be reviewed: it reads as rejected, with the reason. */
  protected readonly ineligible = computed(() => (this.app()?.state ?? '').toUpperCase() === 'INELIGIBLE');
  protected readonly status = computed<GrantStatus>(() => (this.ineligible() ? 'Rejected' : statusOf(this.app()?.state)));
  protected readonly explainer = computed(() => {
    if (!this.ineligible()) return EXPLAINERS[this.status()];
    const reason = this.app()?.entryCheckReason?.trim();
    return { icon: 'block', text: `Your application didn’t pass the call’s entry checks, so it can’t go to review.${reason ? ` ${reason}` : ''}` };
  });
  /** When it was sent; drafts haven't been. */
  protected readonly sentAt = computed(() => {
    const a = this.app();
    return a && this.status() !== 'Draft' ? a.submittedAt ?? a.consentGivenAt ?? null : null;
  });
  protected readonly summary = computed(() => proposalAnswers(this.app() ?? {}).summary.trim());

  // ── Your grant ──

  /** The approved application's id: only then is there a grant to load. */
  private readonly grantFor = computed(() => (this.status() === 'Approved' ? this.app()?.id ?? null : null));

  protected readonly grant = toSignal(
    toObservable(computed(() => ({ id: this.grantFor(), attempt: this.grantAttempt() }))).pipe(
      switchMap(({ id }) => id == null ? of(GRANT_LOADING) : merge(
        this.fetchGrant(id).pipe(startWith(GRANT_LOADING)),
        this.grantReloaded$,
      )),
    ),
    { initialValue: GRANT_LOADING },
  );

  protected readonly award = computed(() => { const g = this.grant(); return g.state === 'ready' ? g.award : null; });
  protected readonly bundles = computed(() => { const g = this.grant(); return g.state === 'ready' ? g.bundles : null; });
  protected readonly grantCurrency = computed(() => this.award()?.currencyCode || this.currency());
  /** Money that has reached the grantee: tranches released (PAID) or already accounted for (UTILISED). */
  protected readonly receivedSoFar = computed(() => {
    const list = this.bundles();
    return list ? list.filter(b => isPaid(b.tranche)).reduce((sum, b) => sum + b.tranche.amountMinor, 0) : null;
  });
  protected readonly receivedPercent = computed(() => {
    const awarded = this.award()?.awardedAmountMinor ?? 0, received = this.receivedSoFar() ?? 0;
    return awarded > 0 ? Math.min(100, Math.round((received / awarded) * 100)) : 0;
  });
  protected readonly completed = computed(() => (this.bundles() ?? []).filter(b => b.stage === 'utilised').length);

  // ── Steps ──

  /** The tranche whose plan or report form is open; one at a time. */
  protected readonly editing = signal<number | null>(null);
  /** The tranche whose plan or report is being sent. */
  protected readonly busy = signal<number | null>(null);
  protected readonly outcome = signal<Outcome | null>(null);
  private readonly result = viewChild<ElementRef<HTMLElement>>('result');
  private readonly formHost = viewChild<ElementRef<HTMLElement>>('formHost');
  private readonly ctas = viewChildren('cta', { read: ElementRef });

  protected retry() { this.attempt.update(n => n + 1); }
  protected retryGrant() { this.grantAttempt.update(n => n + 1); }

  protected readonly refreshing = signal(false);
  /** Reloads the grant in place (no spinner over the page), e.g. after the funder approved a plan or released a payment. */
  protected refresh() {
    const appId = this.grantFor();
    if (appId == null || this.refreshing()) return;
    this.refreshing.set(true);
    this.fetchGrant(appId).pipe(finalize(() => this.refreshing.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe(f => this.grantReloaded$.next(f));
  }

  protected isGranteeTurn(stage: TrancheStage) { return GRANTEE_TURN.includes(stage); }
  protected planApproved(stage: TrancheStage) { return PLAN_APPROVED.includes(stage); }
  protected isPaid(t: Tranche) { return isPaid(t); }
  protected stateLabel(state: string | undefined) { return stateLabel(state); }
  protected paymentMode(mode: string | undefined) { return PAYMENT_MODES.find(m => m.value === mode)?.label ?? mode ?? ''; }
  protected successFor(trancheId: number) { const o = this.outcome(); return o?.kind === 'success' && o.trancheId === trancheId ? o.text : null; }
  protected errorFor(trancheId: number) { const o = this.outcome(); return o?.kind === 'error' && o.trancheId === trancheId ? o.text : null; }
  protected dismiss() { this.outcome.set(null); }

  /** Opens a tranche's plan or report form and moves focus into it, since the button that opened it is gone. */
  protected openForm(trancheId: number) {
    this.editing.set(trancheId);
    this.outcome.set(null);
    afterNextRender(() => this.formHost()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Closes the form and puts focus back on the button that opens it. */
  protected closeForm(trancheId: number) {
    this.editing.set(null);
    afterNextRender(() => this.ctas().find(el => el.nativeElement.dataset['tranche'] === String(trancheId))?.nativeElement.focus(),
      { injector: this.injector });
  }

  /** Sends the tranche's plan, or after the funder asked for changes, replaces it and resubmits. */
  protected submitPlan(b: TrancheBundle, items: PlanItemInput[]) {
    const t = b.tranche, plan = b.plan;
    const revise = b.stage === 'plan-changes' && plan?.id != null;
    const amount = this.money(t.amountMinor, t.currencyCode);
    this.confirmThen(t.id, {
      title: revise ? 'Resubmit this plan?' : 'Submit this plan?', confirm: revise ? 'Resubmit plan' : 'Submit plan', icon: 'send',
      message: `Your plan for tranche ${t.sequenceNo} (${amount}) goes to your funder. ${LOCKED_NOTE}`,
    }, () => revise ? this.tranches.revisePlan({ ...plan, id: plan.id! }, items) : this.tranches.submitPlan(t.id, items),
    revise
      ? 'Plan resubmitted. Your funder will review your changes.'
      : `Plan submitted. Your funder will review it and release ${amount} once they approve it.`,
    'Couldn’t send your plan. Please try again in a few minutes.');
  }

  /** Sends the tranche's report, or after the funder asked for changes, updates it and resubmits. */
  protected submitReport(b: TrancheBundle, input: ReportInput) {
    const t = b.tranche, report = b.report;
    const revise = b.stage === 'report-changes' && report?.id != null;
    const last = t.sequenceNo >= (this.bundles()?.length ?? 0);
    this.confirmThen(t.id, {
      title: revise ? 'Resubmit this report?' : 'Submit this report?', confirm: revise ? 'Resubmit report' : 'Submit report', icon: 'send',
      message: `Your report on tranche ${t.sequenceNo} goes to your funder. ${LOCKED_NOTE}`,
    }, () => revise ? this.tranches.reviseReport({ ...report, id: report.id! }, input) : this.tranches.submitReport(t.id, input),
    revise
      ? 'Report resubmitted. Your funder will review your changes.'
      : `Report submitted. Once your funder approves it, ${last ? 'this tranche is complete' : `tranche ${t.sequenceNo + 1} unlocks`}.`,
    'Couldn’t send your report. Please try again in a few minutes.');
  }

  private confirmThen(trancheId: number, ask: { title: string; message: string; confirm: string; icon: string },
                      request: () => Observable<unknown>, done: string, fallback: string) {
    if (this.busy() != null) return;
    confirmAction(this.dialog, ask).pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.run(trancheId, request(), done, fallback));
  }

  /**
   * Runs one step: the form shows its spinner while the step is saved and the grant reloaded, then the card changes
   * in one go and the outcome message (focused, so keyboard and screen-reader users land on it) appears in it.
   */
  private run(trancheId: number, request: Observable<unknown>, done: string, fallback: string) {
    const appId = this.grantFor();
    if (this.busy() != null || appId == null) return;
    this.busy.set(trancheId);
    this.outcome.set(null);
    request.pipe(
      switchMap(() => this.fetchGrant(appId)),
      finalize(() => this.busy.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: fresh => {
        const refreshed = fresh.state !== 'error';
        if (refreshed) this.grantReloaded$.next(fresh);
        this.editing.set(null);
        this.outcome.set({ trancheId, kind: 'success', text: refreshed ? done : `${done} Reload the page to see the latest.` });
        this.focusResult();
      },
      error: err => {
        // A step is several requests, so part of it may have saved: reload so the card shows what the server now holds.
        this.fetchGrant(appId).pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(f => { if (f.state !== 'error') this.grantReloaded$.next(f); });
        // The service's 400s say exactly what's wrong (and the backend asks for them to be shown as they are).
        this.outcome.set({ trancheId, kind: 'error', text: apiErrorMessage(err, fallback) });
        this.focusResult();
      },
    });
  }

  private focusResult() {
    afterNextRender(() => this.result()?.nativeElement.focus(), { injector: this.injector });
  }

  private money(minor: number, currency?: string) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || this.grantCurrency(), maximumFractionDigits: 0 })
      .format(minor / 100);
  }

  private fetch(id: number): Observable<View> {
    // The service answers a non-numeric id with a 500, so don't ask.
    if (!Number.isInteger(id) || id <= 0) return of<View>({ state: 'error', notFound: true });
    return this.applications.get(id).pipe(
      switchMap(app => {
        if (!app) return throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' }));
        // Closed calls 404 on the open endpoint: the page falls back to "Call #id".
        const call$ = app.grantCallId != null ? this.calls.getOpen(app.grantCallId).pipe(catchError(() => of(null))) : of(null);
        return call$.pipe(map((call): View => ({ state: 'ready', app: { ...app, id: app.id ?? id }, call })));
      }),
      catchError(err => of<View>({ state: 'error', notFound: err instanceof HttpErrorResponse && err.status === 404 })),
    );
  }

  /**
   * The award and its tranches. No award, or one the grantee can't see yet, reads as "not set up yet"; a 404 on the
   * tranches is the cross-tenant gap (§4), so it reads the same way rather than as an error.
   */
  private fetchGrant(applicationId: number): Observable<GrantView> {
    return this.tranches.awardForApplication(applicationId).pipe(
      switchMap(award => award?.id == null ? of<GrantView>({ state: 'none' }) : this.tranches.bundles(award.id).pipe(
        map((bundles): GrantView => ({ state: 'ready', award, bundles })),
        catchError(err => err instanceof HttpErrorResponse && err.status === 404
          ? of<GrantView>({ state: 'ready', award, bundles: null })
          : throwError(() => err)),
      )),
      catchError(() => of<GrantView>({ state: 'error' })),
    );
  }
}

const isPaid = (t: Tranche) => ['PAID', 'UTILISED'].includes((t.state ?? '').toUpperCase());

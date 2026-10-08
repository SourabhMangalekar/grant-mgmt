import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal,
  untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Observable, Subject, catchError, filter, forkJoin, map, of, startWith, switchMap, tap } from 'rxjs';
import { Award } from '../../../core/application.api';
import { apiErrorMessage } from '../../../core/api-error';
import { APP_CONFIG } from '../../../core/config';
import { confirmAction } from '../../../core/confirm-dialog';
import { ReceivedApplicationDetail, ReceivedApplicationsService, applicantName } from '../../../core/received-applications';
import {
  PAYMENT_MODES, PlanItemInput, ReportInput, Tranche, TrancheBundle, TrancheReport, TrancheService, TrancheSetup, TranchePlan,
  stateLabel,
} from '../../../core/tranches';
import { TranchePlanForm } from '../../shared/tranches/tranche-plan-form';
import { TranchePlanView } from '../../shared/tranches/tranche-plan-view';
import { TrancheReportForm } from '../../shared/tranches/tranche-report-form';
import { TrancheReportView } from '../../shared/tranches/tranche-report-view';
import { TrancheStateChip } from '../../shared/tranches/tranche-state-chip';
import { TrancheSetupForm } from './tranche-setup-form';

type SavedAward = Award & { id: number };

type View =
  | { state: 'loading' }
  | { state: 'error'; notFound: boolean }
  | { state: 'ready'; detail: ReceivedApplicationDetail; award: SavedAward | null; bundles: TrancheBundle[]; bundlesFailed: boolean };
type Ready = Extract<View, { state: 'ready' }>;

const LOADING: View = { state: 'loading' };

type Action = 'setup' | 'plan' | 'report' | 'release' | 'close' | 'applicant';
/** Where an outcome message shows: on a tranche's card (its id), or above the tranches for award-wide steps. */
type Place = number | 'award';
interface Outcome { text: string; at: Place }

/** Debug mode: a made-up bank reference (UTR) for releasing test payments. */
const testUtr = () => `SBIN${String(Date.now()).slice(-12)}`;
const TEST_CHANGES = 'Please break the field training into smaller activities, each with its own date.';

/**
 * The funder's view of one grant after approval: the award, and the tranches it's paid in.
 * Set up the tranches once (2–4, shares adding to 100%), then for each tranche in turn: review the applicant's plan,
 * release the payment, review their report. When every tranche is utilised, close the grant.
 * The grant service enforces the order; this shows the next step on the one tranche that's open, and the service's own
 * message when it refuses. Debug mode adds stand-ins for the applicant's side, so one tester can walk the whole journey.
 */
@Component({
  selector: 'gm-award-detail',
  imports: [
    CurrencyPipe, DatePipe, DecimalPipe, ReactiveFormsModule, RouterLink, TextFieldModule, MatButtonModule, MatButtonToggleModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule,
    TrancheSetupForm, TranchePlanForm, TranchePlanView, TrancheReportForm, TrancheReportView, TrancheStateChip,
  ],
  templateUrl: './award-detail.html',
  styleUrl: './award-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AwardDetail {
  private readonly received = inject(ReceivedApplicationsService);
  private readonly tranches = inject(TrancheService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** Bound from the :id route param (the grant call). */
  readonly id = input.required<string>();
  /** Bound from the :applicationId route param. */
  readonly applicationId = input.required<string>();

  protected readonly debug = APP_CONFIG.debugMode;
  protected readonly paymentModes = PAYMENT_MODES;
  protected readonly stateLabel = stateLabel;
  protected readonly now = Date.now();

  /** Bumped by "Try again" to reload the whole page. */
  private readonly attempt = signal(0);
  /** Reloads the award and its tranches in place (after a saved step, or "Refresh"), keeping the page on screen. */
  private readonly reload$ = new Subject<void>();
  /** Run once the in-place reload lands: the outcome of the step that triggered it, focus, and so on. */
  private afterReload: (() => void)[] = [];

  protected readonly view = toSignal(
    toObservable(computed(() => ({ callId: Number(this.id()), applicationId: Number(this.applicationId()), attempt: this.attempt() }))).pipe(
      switchMap(({ callId, applicationId }) => this.fetch(callId, applicationId).pipe(
        switchMap(first => first.state !== 'ready' ? of(first) : this.reload$.pipe(
          switchMap(() => this.refetch(first)),
          tap(() => { const pending = this.afterReload; this.afterReload = []; pending.forEach(fn => fn()); }),
          startWith(first),
        )),
        startWith(LOADING),
      )),
    ),
    { initialValue: LOADING },
  );

  protected readonly state = computed(() => this.view().state);
  protected readonly notFound = computed(() => { const v = this.view(); return v.state === 'error' && v.notFound; });
  private readonly ready = computed(() => { const v = this.view(); return v.state === 'ready' ? v : null; });

  protected readonly app = computed(() => this.ready()?.detail.application ?? null);
  protected readonly award = computed(() => this.ready()?.award ?? null);
  protected readonly bundles = computed(() => this.ready()?.bundles ?? []);
  protected readonly bundlesFailed = computed(() => this.ready()?.bundlesFailed ?? false);
  protected readonly applicant = computed(() => {
    const d = this.ready()?.detail;
    return applicantName(d?.organisation, d?.application.organisationId);
  });
  protected readonly title = computed(() => this.app()?.title?.trim() || 'Untitled proposal');
  protected readonly currency = computed(() => this.award()?.currencyCode || this.app()?.currencyCode || this.app()?.call.currencyCode || 'INR');

  // ── Summary ──
  protected readonly totals = computed(() => {
    const list = this.bundles().map(b => b.tranche);
    const paid = list.filter(t => ['PAID', 'UTILISED'].includes(upper(t.state)));
    const utilised = list.filter(t => upper(t.state) === 'UTILISED');
    return {
      released: sum(paid), utilised: sum(utilised), utilisedCount: utilised.length, count: list.length,
      progress: list.length ? Math.round((utilised.length / list.length) * 100) : 0,
    };
  });
  protected readonly closed = computed(() => upper(this.award()?.state) === 'COMPLETED');
  protected readonly canClose = computed(() =>
    !this.closed() && this.bundles().length > 0 && this.bundles().every(b => b.stage === 'utilised'));

  /** The one tranche that's open: the first that is neither locked nor utilised. Actions only ever show on it. */
  protected readonly active = computed(() => this.bundles().find(b => b.stage !== 'locked' && b.stage !== 'utilised') ?? null);
  private readonly activeKey = computed(() => { const a = this.active(); return a ? `${a.tranche.id}:${a.stage}` : ''; });

  /** One line on what happens next, for the summary card. */
  protected readonly nextStep = computed(() => {
    if (!this.award() || this.bundlesFailed()) return null;
    if (this.closed()) return 'Grant closed: every tranche has been paid and accounted for.';
    if (!this.bundles().length) return 'Next: set up the tranches this grant is paid in.';
    if (this.canClose()) return 'Every tranche is utilised. Next: close the grant.';
    const a = this.active();
    if (!a) return null;
    const n = a.tranche.sequenceNo, who = this.applicant();
    switch (a.stage) {
      case 'awaiting-plan': return `Waiting for ${who}’s plan for tranche ${n}.`;
      case 'plan-review': return `Next: review the plan for tranche ${n}.`;
      case 'plan-changes': return `Waiting for ${who} to revise the plan for tranche ${n}.`;
      case 'ready': return `Next: release the payment for tranche ${n}.`;
      case 'awaiting-report': return `Waiting for ${who}’s report on tranche ${n}.`;
      case 'report-review': return `Next: review the report on tranche ${n}.`;
      case 'report-changes': return `Waiting for ${who} to revise the report on tranche ${n}.`;
      default: return null;
    }
  });

  // ── Forms on the open tranche ──
  /** Plan or report review: approve, or send it back with a comment. */
  protected readonly decision = signal<'approve' | 'changes'>('approve');
  protected readonly decisionForm = this.fb.group({ comment: ['', Validators.maxLength(1000)] });
  protected readonly releaseForm = this.fb.group({
    paymentMode: ['NEFT', Validators.required],
    paymentReference: ['', [Validators.required, Validators.maxLength(120), Validators.pattern(/\S/)]],
  });
  protected readonly closeComment = this.fb.control('', Validators.maxLength(1000));
  /** Debug mode: the tester fills in the open tranche's plan or report as the applicant. */
  protected readonly asApplicant = signal(false);

  // ── Feedback ──
  protected readonly busy = signal<Action | null>(null);
  protected readonly refreshing = signal(false);
  protected readonly success = signal<Outcome | null>(null);
  protected readonly error = signal<Outcome | null>(null);
  private readonly result = viewChild<ElementRef<HTMLElement>>('result');

  constructor() {
    // The open tranche moved on (or it's another grant): fresh forms for whatever its next step is.
    effect(() => {
      this.activeKey();
      untracked(() => {
        this.decision.set('approve');
        this.decisionForm.reset({ comment: '' });
        this.releaseForm.reset({ paymentMode: 'NEFT', paymentReference: this.debug ? testUtr() : '' });
        this.asApplicant.set(false);
      });
    });
    let lastId: string | null = null;
    effect(() => {
      const id = this.applicationId();
      if (id !== lastId) untracked(() => { this.dismiss(); this.closeComment.reset(''); });
      lastId = id;
    });
  }

  protected retry() { this.attempt.update(n => n + 1); }

  /** Re-reads the tranches, e.g. to see whether the applicant has sent their plan. */
  protected refresh() {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.reload(() => {
      this.refreshing.set(false);
      // Announced through the role="status" region (focus stays put), so the check visibly ran.
      this.success.set({ text: `Checked just now. ${this.nextStep() ?? ''}`.trim(), at: 'award' });
    });
  }

  protected dismiss() { this.success.set(null); this.error.set(null); }

  protected setDecision(value: 'approve' | 'changes') {
    this.decision.set(value);
    const c = this.decisionForm.controls.comment;
    // Debug: a sample request for changes; cleared again when switching back to approve.
    if (this.debug && value === 'changes' && !c.value.trim()) c.setValue(TEST_CHANGES);
    if (this.debug && value === 'approve' && c.value === TEST_CHANGES) c.setValue('');
    c.updateValueAndValidity();
  }

  // ── Funder steps ──

  protected setUp(setup: TrancheSetup[]) {
    const award = this.award();
    if (!award) return;
    const shares = setup.map(s => `${s.percentage}%`).join(' + ');
    this.confirmThen({
      title: 'Set up these tranches?', confirm: 'Set up tranches', icon: 'account_tree',
      message: `This splits ${this.money(award.awardedAmountMinor)} into ${setup.length} tranches (${shares}). `
        + 'Tranches can only be set up once, so check the shares, milestones and dates first.',
    }, 'setup', () => this.tranches.setUpTranches(award, setup),
    `Tranches set up. Tranche 1 is open: ${this.applicant()} can now send their plan for it.`, 'award');
  }

  /** Approves the open tranche's plan or report, or sends it back with a comment. */
  protected decide(b: TrancheBundle) {
    const kind = b.stage === 'plan-review' ? 'plan' : b.stage === 'report-review' ? 'report' : null;
    const recordId = kind === 'plan' ? b.plan?.id : b.report?.id;
    if (!kind || recordId == null) return;
    const control = this.decisionForm.controls.comment;
    control.updateValueAndValidity(); // drops a "required" left over from an earlier request for changes
    const comment = control.value.trim();
    const n = b.tranche.sequenceNo;

    if (this.decision() === 'changes') {
      if (!comment) { control.setErrors({ required: true }); control.markAsTouched(); return; }
      if (control.invalid) { control.markAsTouched(); return; }
      const request = kind === 'plan'
        ? this.tranches.requestPlanChanges(recordId, comment)
        : this.tranches.requestReportChanges(recordId, comment);
      this.run(kind, request, `Changes requested. ${this.applicant()} sees your comment and will send a revised ${kind}.`, b.tranche.id);
      return;
    }

    if (control.invalid) { control.markAsTouched(); return; }
    const next = this.bundles().find(x => x.tranche.sequenceNo === n + 1);
    if (kind === 'plan') {
      this.confirmThen({
        title: 'Approve this plan?', confirm: 'Approve plan', icon: 'task_alt',
        message: `Approving the plan makes tranche ${n} (${this.money(b.tranche.amountMinor)}) ready for payment. It can’t be undone.`,
      }, 'plan', () => this.tranches.approvePlan(recordId, comment),
      `Plan approved. Tranche ${n} is ready: release the payment once the bank transfer has gone through.`, b.tranche.id);
    } else {
      this.confirmThen({
        title: 'Approve this report?', confirm: 'Approve report', icon: 'task_alt',
        message: `Tranche ${n} will be marked as utilised${next ? ` and tranche ${n + 1} unlocks` : ''}. It can’t be undone.`,
      }, 'report', () => this.tranches.approveReport(recordId, comment), next
        ? `Report approved. Tranche ${n} is utilised, and tranche ${n + 1} is now open for ${this.applicant()}’s plan.`
        : `Report approved. Tranche ${n} is utilised: that’s every tranche, so you can close the grant.`, b.tranche.id);
    }
  }

  protected release(t: Tranche) {
    if (this.releaseForm.invalid) { this.releaseForm.markAllAsTouched(); return; }
    const { paymentMode, paymentReference } = this.releaseForm.getRawValue();
    this.confirmThen({
      title: 'Record this payment?', confirm: 'Record payment', icon: 'payments',
      message: `Record ${this.money(t.amountMinor)} paid to ${this.applicant()} by ${paymentMode}, reference ${paymentReference}. Do this only after the bank transfer has gone through. It can’t be undone.`,
    }, 'release', () => this.tranches.release(t.id, paymentReference, paymentMode),
    `Payment recorded: tranche ${t.sequenceNo} is paid. Next, ${this.applicant()} reports on how it was used.`, t.id);
  }

  protected closeGrant() {
    const award = this.award();
    if (!award) return;
    if (this.closeComment.invalid) { this.closeComment.markAsTouched(); return; }
    this.confirmThen({
      title: 'Close this grant?', confirm: 'Close grant', icon: 'flag',
      message: `Every tranche of “${this.title()}” is utilised. Closing marks the grant as completed. It can’t be undone.`,
    }, 'close', () => this.tranches.closeAward(award.id, this.closeComment.value),
    'Grant closed. It’s now marked as completed.', 'award');
  }

  // ── Debug-mode stand-ins for the applicant ──

  protected submitTestPlan(t: Tranche, items: PlanItemInput[]) {
    this.run('applicant', this.tranches.submitPlan(t.id, items), 'Test plan submitted as the applicant. Review it below.', t.id);
  }

  protected reviseTestPlan(t: Tranche, plan: TranchePlan, items: PlanItemInput[]) {
    if (plan.id == null) return;
    this.run('applicant', this.tranches.revisePlan({ ...plan, id: plan.id }, items),
      'Revised plan resubmitted as the applicant. Review it below.', t.id);
  }

  protected submitTestReport(t: Tranche, input: ReportInput) {
    this.run('applicant', this.tranches.submitReport(t.id, input), 'Test report submitted as the applicant. Review it below.', t.id);
  }

  protected reviseTestReport(t: Tranche, report: TrancheReport, input: ReportInput) {
    if (report.id == null) return;
    this.run('applicant', this.tranches.reviseReport({ ...report, id: report.id }, input),
      'Revised report resubmitted as the applicant. Review it below.', t.id);
  }

  // ── Template helpers ──

  protected modeLabel(mode: string | undefined) {
    return PAYMENT_MODES.find(m => m.value === mode)?.label ?? (mode || '—');
  }

  /** The report is due and the tranche isn't accounted for yet. */
  protected overdue(b: TrancheBundle) {
    return b.tranche.reportDueAt != null && b.tranche.reportDueAt < this.now
      && ['awaiting-report', 'report-changes'].includes(b.stage);
  }

  // ── Plumbing ──

  private money(minor: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: this.currency(), maximumFractionDigits: 0 }).format(minor / 100);
  }

  private fetch(callId: number, applicationId: number): Observable<View> {
    if (!Number.isInteger(callId) || callId <= 0 || !Number.isInteger(applicationId) || applicationId <= 0) {
      return of<View>({ state: 'error', notFound: true });
    }
    return forkJoin({
      detail: this.received.detail(callId, applicationId),
      award: this.tranches.awardForApplication(applicationId),
    }).pipe(
      switchMap(({ detail, award }) => this.money$(saved(award)).pipe(map((m): View => ({ state: 'ready', detail, ...m })))),
      catchError(err => of<View>({ state: 'error', notFound: err instanceof HttpErrorResponse && err.status === 404 })),
    );
  }

  /** The award again (its state moves on set-up and close) and its tranches; never errors, so the page stays up. */
  private refetch(prev: Ready): Observable<View> {
    return this.tranches.awardForApplication(prev.detail.application.id).pipe(
      catchError(() => of(null)),
      switchMap(award => this.money$(saved(award) ?? prev.award)),
      map((m): View => ({ ...prev, ...m })),
    );
  }

  private money$(award: SavedAward | null): Observable<Pick<Ready, 'award' | 'bundles' | 'bundlesFailed'>> {
    if (!award) return of({ award: null, bundles: [], bundlesFailed: false });
    return this.tranches.bundles(award.id).pipe(
      map(bundles => ({ award, bundles, bundlesFailed: false })),
      catchError(() => of({ award, bundles: [], bundlesFailed: true })),
    );
  }

  private reload(then: () => void) {
    this.afterReload.push(then);
    this.reload$.next();
  }

  private confirmThen(ask: { title: string; message: string; confirm: string; icon: string }, action: Action,
                      request: () => Observable<unknown>, done: string, at: Place) {
    if (this.busy()) return;
    confirmAction(this.dialog, ask).pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.run(action, request(), done, at));
  }

  /**
   * Runs one step: spinner on its button until the tranches have reloaded with the new state, then the outcome message
   * (focused, so keyboard and screen-reader users land on it).
   */
  private run(action: Action, request: Observable<unknown>, done: string, at: Place) {
    if (this.busy()) return;
    this.busy.set(action);
    this.dismiss();
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.reload(() => {
        this.busy.set(null);
        this.success.set({ text: done, at });
        this.focusResult();
      }),
      error: err => {
        this.busy.set(null);
        // The service's 400s say exactly what's wrong ("Tranche 2 is LOCKED…"), so show them as they are.
        this.error.set({ text: apiErrorMessage(err, 'Couldn’t save this step. Please try again in a few minutes.'), at });
        this.focusResult();
      },
    });
  }

  private focusResult() {
    afterNextRender(() => this.result()?.nativeElement.focus(), { injector: this.injector });
  }
}

const upper = (s: string | undefined) => (s ?? '').toUpperCase();
const sum = (list: Tranche[]) => list.reduce((total, t) => total + (t.amountMinor ?? 0), 0);
const saved = (award: Award | null): SavedAward | null => (award?.id != null ? { ...award, id: award.id } : null);

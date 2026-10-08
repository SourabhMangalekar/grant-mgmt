import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal,
  untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Observable, filter, finalize, of, switchMap } from 'rxjs';
import { Review } from '../../../core/application.api';
import { apiErrorMessage } from '../../../core/api-error';
import { AuthStore } from '../../../core/auth/auth.store';
import { APP_CONFIG } from '../../../core/config';
import { confirmAction } from '../../../core/confirm-dialog';
import { ReceivedApplication, ReceivedApplicationsService, Stage, stageOf, totalScore } from '../../../core/received-applications';

const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'screening', label: 'Screening' },
  { stage: 'review', label: 'Reviews' },
  { stage: 'committee', label: 'Committee' },
  { stage: 'approved', label: 'Decision' },
];
const STEP_INDEX: Record<Stage, number> = { screening: 0, review: 1, committee: 2, approved: 3, rejected: 3, other: -1 };

export const SCORES = [
  { value: 1, label: '1 · Weak' }, { value: 2, label: '2 · Below par' }, { value: 3, label: '3 · Adequate' },
  { value: 4, label: '4 · Strong' }, { value: 5, label: '5 · Excellent' },
];
const CRITERIA = [
  { key: 'scoreNeed', label: 'Need' }, { key: 'scoreApproach', label: 'Approach' },
  { key: 'scoreCapacity', label: 'Capacity' }, { key: 'scoreBudget', label: 'Budget' },
] as const;

/** Debug-mode reviews recorded "as a colleague" get ids from here, so one tester can complete a call's reviews. */
const TEST_REVIEWER_BASE = 900_000;

type Action = 'start' | 'review' | 'committee' | 'approve' | 'reject';

/**
 * The funder's review and decision on one application, one step at a time:
 * Screening → start review → reviews (as many as the call requires) → send to committee → approve (creates the award) or reject.
 * The grant service enforces the order and the rules; this shows the next possible step and the service's own message
 * when it refuses. Emits `changed` after every saved step, so the page reloads the application.
 */
@Component({
  selector: 'gm-application-workflow',
  imports: [
    CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink, TextFieldModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule,
  ],
  templateUrl: './application-workflow.html',
  styleUrl: './application-workflow.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationWorkflow {
  private readonly received = inject(ReceivedApplicationsService);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly application = input.required<ReceivedApplication>();
  readonly reviews = input<Review[]>([]);
  /** A step was saved: the parent reloads the application and its reviews. */
  readonly changed = output<void>();

  protected readonly debug = APP_CONFIG.debugMode;
  protected readonly steps = STEPS;
  protected readonly scores = SCORES;
  protected readonly criteria = CRITERIA;

  protected readonly stage = computed(() => stageOf(this.application().state));
  protected readonly stepIndex = computed(() => STEP_INDEX[this.stage()]);
  protected readonly currency = computed(() => this.application().currencyCode || this.application().call.currencyCode || 'INR');

  // ── Reviews ──
  protected readonly required = computed(() => Math.max(1, this.application().call.reviewersRequired ?? 1));
  protected readonly submitted = computed(() => this.reviews().filter(r => (r.state ?? 'SUBMITTED').toUpperCase() === 'SUBMITTED'));
  protected readonly enoughReviews = computed(() => this.submitted().length >= this.required());
  private readonly me = computed(() => this.auth.user()?.userId ?? 0);
  protected readonly reviewedByMe = computed(() => this.reviews().some(r => r.reviewerUserId === this.me()));
  /** Debug mode: the tester records the next review as a stand-in colleague. */
  protected readonly asColleague = signal(false);
  protected readonly showReviewForm = computed(() =>
    this.stage() === 'review' && !this.enoughReviews() && (!this.reviewedByMe() || this.asColleague()));

  protected readonly reviewForm = this.fb.group({
    scoreNeed: [this.debug ? 4 : (null as number | null), Validators.required],
    scoreApproach: [this.debug ? 4 : (null as number | null), Validators.required],
    scoreCapacity: [this.debug ? 4 : (null as number | null), Validators.required],
    scoreBudget: [this.debug ? 4 : (null as number | null), Validators.required],
    recommendation: [this.debug ? 'APPROVE' : '', Validators.required],
    comment: [this.debug ? 'Strong delivery record and a realistic budget.' : '', [Validators.required, Validators.maxLength(2000)]],
    conflictDeclared: [false],
  });
  private readonly reviewValues = toSignal(this.reviewForm.valueChanges, { initialValue: this.reviewForm.getRawValue() });
  protected readonly previewScore = computed(() => {
    const v = this.reviewValues();
    const s = [v.scoreNeed, v.scoreApproach, v.scoreCapacity, v.scoreBudget];
    return s.every(x => x != null) ? totalScore({ scoreNeed: s[0]!, scoreApproach: s[1]!, scoreCapacity: s[2]!, scoreBudget: s[3]! }) : null;
  });

  // ── Committee ──
  /** Set when the service refused to send it on because the reviewers disagree; the funder can override with a reason. */
  protected readonly disagreement = signal<string | null>(null);
  protected readonly overrideReason = this.fb.control('', [Validators.required, Validators.maxLength(1000)]);

  // ── Decision ──
  protected readonly decision = signal<'approve' | 'reject'>('approve');
  protected readonly minAmount = computed(() => toRupees(this.application().call.minAwardMinor));
  protected readonly maxAmount = computed(() => toRupees(this.application().call.maxAwardMinor));
  protected readonly approveForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(1)]],
    comment: ['', [Validators.required, Validators.maxLength(1000)]],
  });
  protected readonly rejectReason = this.fb.control(this.debug ? 'Not this round: the budget doesn’t match the call’s priorities.' : '',
    [Validators.required, Validators.maxLength(1000)]);

  /** The award an approved application got. */
  protected readonly award = toSignal(
    toObservable(computed(() => ({ id: this.application().id, approved: this.stage() === 'approved' }))).pipe(
      switchMap(({ id, approved }) => approved ? this.received.award(id) : of(null)),
    ),
    { initialValue: null },
  );

  // ── Feedback ──
  protected readonly busy = signal<Action | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private readonly result = viewChild<ElementRef<HTMLElement>>('result');

  constructor() {
    // Another application (or the page reloaded it): start from a clean slate, with the amount defaulting to the request.
    effect(() => {
      const a = this.application();
      untracked(() => {
        this.approveForm.reset({
          amount: a.requestedAmountMinor != null ? a.requestedAmountMinor / 100 : null,
          comment: this.debug && a.requestedAmountMinor != null ? `Approved at ₹${(a.requestedAmountMinor / 100).toLocaleString('en-IN')}.` : '',
        });
        const min = toRupees(a.call.minAwardMinor), max = toRupees(a.call.maxAwardMinor);
        this.approveForm.controls.amount.setValidators([
          Validators.required, Validators.min(min ?? 1), ...(max != null ? [Validators.max(max)] : []),
        ]);
        this.approveForm.controls.amount.updateValueAndValidity();
      });
    });
    let lastId: number | null = null;
    effect(() => {
      const id = this.application().id;
      if (id !== lastId) untracked(() => { this.success.set(null); this.error.set(null); this.disagreement.set(null); this.asColleague.set(false); });
      lastId = id;
    });
  }

  protected startReview() {
    this.run('start', this.received.startReview(this.application().id), 'Review started. Reviewers can now score this application.');
  }

  protected submitReview() {
    if (this.reviewForm.invalid) { this.reviewForm.markAllAsTouched(); return; }
    const v = this.reviewForm.getRawValue();
    const reviewer = this.asColleague() ? TEST_REVIEWER_BASE + this.submitted().length + 1 : this.me();
    const done = this.submitted().length + 1;
    this.run('review', this.received.submitReview(this.application().id, {
      reviewerUserId: reviewer,
      scoreNeed: v.scoreNeed!, scoreApproach: v.scoreApproach!, scoreCapacity: v.scoreCapacity!, scoreBudget: v.scoreBudget!,
      recommendation: v.recommendation, comment: v.comment.trim(), conflictDeclared: v.conflictDeclared,
    }), done >= this.required()
      ? `Review saved. All ${this.required()} reviews are in: send it to the committee when you’re ready.`
      : `Review saved: ${done} of ${this.required()}.`,
    () => { this.asColleague.set(false); this.reviewForm.controls.comment.reset(this.debug ? 'Clear plan and a credible team.' : ''); });
  }

  protected sendToCommittee(override = false) {
    if (override && this.overrideReason.invalid) { this.overrideReason.markAsTouched(); return; }
    const req = this.received.sendToCommittee(this.application().id, override ? { comment: this.overrideReason.value.trim() } : undefined);
    this.run('committee', req, override
      ? 'Sent to the committee. Your reason for overriding the reviewers is recorded in the audit trail.'
      : 'Sent to the committee. It can now be approved or rejected.',
    () => this.disagreement.set(null),
    // The reviewers disagree: that's a decision for a person, so show the reasons and offer the override.
    err => {
      const message = err instanceof HttpErrorResponse ? (err.error?.errorMessage || err.error?.message || '') : '';
      if (!override && /disagree/i.test(message)) { this.disagreement.set(message); return true; }
      return false;
    });
  }

  protected approve() {
    if (this.approveForm.invalid) { this.approveForm.markAllAsTouched(); return; }
    const { amount, comment } = this.approveForm.getRawValue();
    const amountMinor = Math.round(amount! * 100);
    const shown = new Intl.NumberFormat('en-IN', { style: 'currency', currency: this.currency(), maximumFractionDigits: 0 }).format(amount!);
    this.confirmThen({
      title: 'Approve this application?', confirm: 'Approve', icon: 'verified',
      message: `This awards ${shown} to “${this.title()}” and creates the award. The applicant sees your comment. It can’t be undone.`,
    }, 'approve', () => this.received.approve(this.application().id, amountMinor, comment.trim()), `Approved for ${shown}. The award has been created.`);
  }

  protected reject() {
    if (this.rejectReason.invalid) { this.rejectReason.markAsTouched(); return; }
    this.confirmThen({
      title: 'Reject this application?', confirm: 'Reject', icon: 'block',
      message: `“${this.title()}” will be rejected and the applicant will see your reason. It can’t be undone.`,
    }, 'reject', () => this.received.reject(this.application().id, this.rejectReason.value.trim()), 'Rejected. The applicant will see your reason.');
  }

  protected dismiss() { this.success.set(null); this.error.set(null); }

  /** 'DUE_DILIGENCE' → 'Due diligence'. */
  protected awardState(state: string) {
    const text = state.replace(/_/g, ' ').toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  private title() { return this.application().title?.trim() || 'Untitled proposal'; }

  private confirmThen(ask: { title: string; message: string; confirm: string; icon: string }, action: Action,
                      request: () => Observable<unknown>, done: string) {
    confirmAction(this.dialog, ask).pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.run(action, request(), done));
  }

  /**
   * Runs one step: spinner on its button, then the outcome message (focused, so keyboard and screen-reader users land
   * on it) and `changed`. `handled` lets a step deal with a refusal itself instead of showing it as an error.
   */
  private run(action: Action, request: Observable<unknown>, done: string, after?: () => void,
              handled?: (err: unknown) => boolean) {
    if (this.busy()) return;
    this.busy.set(action);
    this.success.set(null);
    this.error.set(null);
    request.pipe(finalize(() => this.busy.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.success.set(done);
        after?.();
        this.changed.emit();
        this.focusResult();
      },
      error: err => {
        if (handled?.(err)) { this.focusResult(); return; }
        // The service's 400s say exactly what's missing ("0 of 2 reviews submitted…"), so show them as they are.
        this.error.set(apiErrorMessage(err, 'Couldn’t save this step. Please try again in a few minutes.'));
        this.focusResult();
      },
    });
  }

  private focusResult() {
    afterNextRender(() => this.result()?.nativeElement.focus(), { injector: this.injector });
  }
}

const toRupees = (minor: number | undefined) => (minor != null ? minor / 100 : null);

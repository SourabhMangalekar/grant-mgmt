import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal,
  untracked, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, getCurrencySymbol } from '@angular/common';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { map } from 'rxjs';
import { APP_CONFIG } from '../../../core/config';
import { PlanItemInput, Tranche, TranchePlanItem, fromByDate, toByDate } from '../../../core/tranches';
import { formatMoney, notBlank, paise } from './tranche-utils';

/** Field limits, shared by the validators and the template so they never drift apart. */
export const PLAN_LIMITS = { activity: 500, output: 500, rows: 20, budgetMin: 1 } as const;

type PlanRow = FormGroup<{
  activity: FormControl<string>;
  expectedOutput: FormControl<string>;
  /** Rupees as typed; converted to minor units on submit. */
  budget: FormControl<number | null>;
  byDate: FormControl<Date | null>;
}>;

let nextId = 0;

/**
 * The grantee's plan for one tranche: what they'll do with the money, activity by activity. The activities' budgets
 * must add up to exactly the tranche amount (the funder approves the plan, then releases that amount). Used for the
 * first plan and, prefilled from `initial`, to revise one after the funder asked for changes. The page does the saving:
 * this only emits the items, in minor units, with `byDate` in the API's shape.
 */
@Component({
  selector: 'gm-tranche-plan-form',
  imports: [
    CurrencyPipe, DatePipe, ReactiveFormsModule, MatButtonModule, MatDatepickerModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressSpinnerModule,
  ],
  templateUrl: './tranche-plan-form.html',
  styleUrl: './tranche-plan-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranchePlanForm {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly tranche = input.required<Tranche>();
  /** The plan's current items, when revising it. */
  readonly initial = input<TranchePlanItem[]>([]);
  /** The page is saving: the form locks and the button shows a spinner. */
  readonly busy = input(false);
  readonly submitLabel = input('Submit plan');

  readonly submitted = output<PlanItemInput[]>();
  readonly cancelled = output<void>();

  protected readonly limits = PLAN_LIMITS;
  /** Prefix for element ids, unique per instance. */
  protected readonly uid = `tranche-plan-${nextId++}`;
  protected readonly currency = computed(() => this.tranche().currencyCode || 'INR');
  protected readonly symbol = computed(() => getCurrencySymbol(this.currency(), 'narrow', 'en-IN'));

  protected readonly form = this.fb.group({ rows: this.fb.array<PlanRow>([]) });
  protected readonly rows = this.form.controls.rows as FormArray<PlanRow>;

  private readonly values = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() });
  /** Each row's budget in minor units, as it will be sent. */
  private readonly budgets = computed(() => this.values().rows.map(r => (r.budget != null && r.budget > 0 ? Math.round(r.budget * 100) : 0)));
  protected readonly totalMinor = computed(() => this.budgets().reduce((a, b) => a + b, 0));
  /** Positive: still to plan; negative: over the tranche. */
  protected readonly gapMinor = computed(() => this.tranche().amountMinor - this.totalMinor());

  /** Set by an invalid submit, cleared once everything is fixed. */
  protected readonly problem = signal<string | null>(null);
  private readonly problemEl = viewChild<ElementRef<HTMLElement>>('problemEl');

  constructor() {
    // A different tranche, or the plan being revised: rebuild the rows. Keyed so a reload with the same data doesn't
    // wipe what's being typed.
    let lastKey = '';
    effect(() => {
      const tranche = this.tranche(), initial = this.initial();
      const key = `${tranche.id}|${initial.map(i => i.id ?? `${i.orderNo}:${i.activity}`).join(',')}`;
      if (key === lastKey) return;
      lastKey = key;
      untracked(() => this.build(tranche, initial));
    });
    // Lock the fields while the page saves.
    effect(() => {
      const busy = this.busy();
      untracked(() => busy ? this.form.disable({ emitEvent: false }) : this.form.enable({ emitEvent: false }));
    });
    // The problem message goes away once there's nothing left to fix.
    effect(() => {
      this.values();
      if (untracked(this.problem) && !untracked(() => this.check())) this.problem.set(null);
    });
  }

  protected addRow(focus = true) {
    if (this.rows.length >= PLAN_LIMITS.rows) return;
    this.rows.push(this.row());
    if (focus) this.focusActivity(this.rows.length - 1);
  }

  protected removeRow(i: number) {
    if (this.rows.length <= 1) return;
    this.rows.removeAt(i);
    // The button that had focus is gone: move to the row that took its place (or the new last one).
    this.focusActivity(Math.min(i, this.rows.length - 1));
  }

  protected submit() {
    if (this.busy()) return;
    const problem = this.check();
    if (problem) {
      this.form.markAllAsTouched();
      this.problem.set(problem);
      this.focusProblem();
      return;
    }
    this.problem.set(null);
    const items: PlanItemInput[] = this.form.getRawValue().rows.map((r, i) => {
      const output = r.expectedOutput.trim();
      return {
        orderNo: i + 1,
        activity: r.activity.trim(),
        budgetMinor: Math.round(r.budget! * 100),
        // Absent rather than empty: the service stores whatever it's sent.
        ...(output ? { expectedOutput: output } : {}),
        ...(r.byDate ? { byDate: toByDate(r.byDate) } : {}),
      };
    });
    this.submitted.emit(items);
  }

  /** What's stopping the plan from being submitted, or null when it's good to go. */
  private check(): string | null {
    const cur = this.currency();
    const total = this.totalMinor(), amount = this.tranche().amountMinor;
    const fields = this.rows.invalid ? 'Some activities need attention: check the highlighted fields.' : null;
    const sum = total !== amount
      ? `Activities add up to ${formatMoney(total, cur)}; this tranche is ${formatMoney(amount, cur)}. ` +
        (total < amount ? `Plan the remaining ${formatMoney(amount - total, cur)}.` : `Take ${formatMoney(total - amount, cur)} off.`)
      : null;
    return [fields, sum].filter(Boolean).join(' ') || null;
  }

  private build(tranche: Tranche, initial: TranchePlanItem[]) {
    this.rows.clear({ emitEvent: false });
    this.problem.set(null);
    if (initial.length) {
      for (const item of [...initial].sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0))) {
        this.rows.push(this.row(item.activity ?? '', item.expectedOutput ?? '', item.budgetMinor != null ? item.budgetMinor / 100 : null,
          fromByDate(item.byDate)), { emitEvent: false });
      }
    } else if (APP_CONFIG.debugMode) {
      for (const r of sampleRows(tranche)) this.rows.push(this.row(r.activity, r.output, r.budgetMinor / 100, r.byDate), { emitEvent: false });
    } else {
      this.rows.push(this.row(), { emitEvent: false });
    }
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.form.updateValueAndValidity();
    if (this.busy()) this.form.disable({ emitEvent: false });
  }

  private row(activity = '', expectedOutput = '', budget: number | null = null, byDate: Date | null = null): PlanRow {
    return this.fb.group({
      activity: [activity, [notBlank, Validators.maxLength(PLAN_LIMITS.activity)]],
      expectedOutput: [expectedOutput, Validators.maxLength(PLAN_LIMITS.output)],
      budget: this.fb.control<number | null>(budget, [Validators.required, Validators.min(PLAN_LIMITS.budgetMin), paise]),
      byDate: this.fb.control<Date | null>(byDate),
    });
  }

  private focusActivity(i: number) {
    afterNextRender(() => this.host.nativeElement.querySelectorAll<HTMLInputElement>('input.activity-input')[i]?.focus(),
      { injector: this.injector });
  }

  /** The first broken field if there is one, otherwise the message itself (e.g. when only the total is off). */
  private focusProblem() {
    afterNextRender(() => {
      const field = this.host.nativeElement.querySelector<HTMLElement>('input.ng-invalid, textarea.ng-invalid');
      (field ?? this.problemEl()?.nativeElement)?.focus();
    }, { injector: this.injector });
  }
}

/** Debug mode: two or three believable activities that add up to exactly the tranche amount. */
function sampleRows(tranche: Tranche): { activity: string; output: string; budgetMinor: number; byDate: Date }[] {
  const total = tranche.amountMinor;
  const inMonths = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + n); return d; };
  if (total < 10_000) {
    return [{ activity: 'Community meetings in the project villages', output: 'Meetings held', budgetMinor: total, byDate: inMonths(1) }];
  }
  // Whole rupees for the first two; the last takes the remainder (paise included) so the total is exact.
  const first = Math.floor((total * 0.5) / 100) * 100;
  const second = Math.floor((total * 0.3) / 100) * 100;
  return [
    { activity: 'Community mobilisation meetings in 12 villages', output: '12 village meetings, 600 people reached', budgetMinor: first, byDate: inMonths(1) },
    { activity: 'Training for 40 self-help group leaders', output: '40 leaders trained, attendance sheets', budgetMinor: second, byDate: inMonths(2) },
    { activity: 'Baseline survey and monitoring visits', output: 'Baseline report and 6 visit notes', budgetMinor: total - first - second, byDate: inMonths(3) },
  ];
}

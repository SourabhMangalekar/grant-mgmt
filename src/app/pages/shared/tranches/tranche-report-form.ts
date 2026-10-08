import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal,
  untracked, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, getCurrencySymbol } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { map } from 'rxjs';
import { APP_CONFIG } from '../../../core/config';
import { DELIVERY_STATES, DeliveryState, ReportInput, Tranche, TranchePlanItem, TrancheReport, fromByDate } from '../../../core/tranches';
import { formatMoney, notBlank, paise } from './tranche-utils';

export const REPORT_LIMITS = { summary: 2000, remark: 500, fileName: 250 } as const;

type ReportRow = FormGroup<{
  deliveryState: FormControl<DeliveryState | null>;
  /** Rupees as typed; converted to minor units on submit. */
  spent: FormControl<number | null>;
  remark: FormControl<string>;
}>;

let nextId = 0;

/** A remark is needed when an activity wasn't fully done: the funder will want to know why. */
function remarkWhenShort(control: AbstractControl): ValidationErrors | null {
  const state = control.parent?.get('deliveryState')?.value as DeliveryState | null | undefined;
  return state && state !== 'DONE' && !String(control.value ?? '').trim() ? { explain: true } : null;
}

/**
 * The grantee's report on one paid tranche: how each planned activity went (done, partly done, not done), what was
 * spent on it, and a summary, plus the names of the utilisation certificate and photos (no uploads yet). Spending may
 * come in under the tranche amount but not over it. Used for the first report and, prefilled from `initial`, to revise
 * one after the funder asked for changes. The page does the saving: this only emits what was entered, in minor units.
 */
@Component({
  selector: 'gm-tranche-report-form',
  imports: [
    CurrencyPipe, DatePipe, ReactiveFormsModule, TextFieldModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatProgressSpinnerModule,
  ],
  templateUrl: './tranche-report-form.html',
  styleUrl: './tranche-report-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrancheReportForm {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly tranche = input.required<Tranche>();
  /** The approved plan's activities: one report row each. */
  readonly planItems = input.required<TranchePlanItem[]>();
  /** The current report, when revising it. */
  readonly initial = input<TrancheReport | null>(null);
  /** The page is saving: the form locks and the button shows a spinner. */
  readonly busy = input(false);
  readonly submitLabel = input('Submit report');

  readonly submitted = output<ReportInput>();
  readonly cancelled = output<void>();

  protected readonly limits = REPORT_LIMITS;
  protected readonly states = DELIVERY_STATES;
  protected readonly uid = `tranche-report-${nextId++}`;
  protected readonly currency = computed(() => this.tranche().currencyCode || 'INR');
  protected readonly symbol = computed(() => getCurrencySymbol(this.currency(), 'narrow', 'en-IN'));

  /** The plan items the rows stand for, in plan order (only saved ones: a report row points at the item's id). */
  protected readonly items = signal<(TranchePlanItem & { id: number; date: Date | null })[]>([]);

  protected readonly form = this.fb.group({
    rows: this.fb.array<ReportRow>([]),
    summary: ['', [notBlank, Validators.maxLength(REPORT_LIMITS.summary)]],
    ucFileName: ['', Validators.maxLength(REPORT_LIMITS.fileName)],
    photosFileName: ['', Validators.maxLength(REPORT_LIMITS.fileName)],
  });
  protected readonly rows = this.form.controls.rows as FormArray<ReportRow>;

  private readonly values = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() });
  protected readonly spentMinor = computed(() =>
    this.values().rows.reduce((sum, r) => sum + (r.spent != null && r.spent > 0 ? Math.round(r.spent * 100) : 0), 0));
  /** Positive: unspent; negative: over the tranche. */
  protected readonly gapMinor = computed(() => this.tranche().amountMinor - this.spentMinor());
  protected readonly spentPct = computed(() => {
    const amount = this.tranche().amountMinor;
    return amount > 0 ? Math.min(100, (this.spentMinor() / amount) * 100) : 0;
  });
  protected readonly summaryLength = computed(() => this.values().summary.length);

  protected readonly problem = signal<string | null>(null);
  private readonly problemEl = viewChild<ElementRef<HTMLElement>>('problemEl');

  constructor() {
    // A different tranche, plan or report: rebuild. Keyed so a reload with the same data doesn't wipe what's being typed.
    let lastKey = '';
    effect(() => {
      const tranche = this.tranche(), planItems = this.planItems(), initial = this.initial();
      const key = `${tranche.id}|${planItems.map(i => i.id).join(',')}|${initial?.id ?? ''}:${initial?.attempt ?? ''}`;
      if (key === lastKey) return;
      lastKey = key;
      untracked(() => this.build(tranche, planItems, initial));
    });
    effect(() => {
      const busy = this.busy();
      untracked(() => busy ? this.form.disable({ emitEvent: false }) : this.form.enable({ emitEvent: false }));
    });
    effect(() => {
      this.values();
      if (untracked(this.problem) && !untracked(() => this.check())) this.problem.set(null);
    });
  }

  /**
   * A delivery state was picked: re-check whether a remark is needed, and save some typing on the amount — the full
   * budget for "Done", nothing for "Not done" — when it's still empty.
   */
  protected stateChanged(i: number) {
    const row = this.rows.at(i), item = this.items()[i];
    row.controls.remark.updateValueAndValidity();
    if (row.controls.spent.value != null) return;
    const state = row.controls.deliveryState.value;
    if (state === 'DONE' && item) row.controls.spent.setValue(item.budgetMinor / 100);
    else if (state === 'NOT_DONE') row.controls.spent.setValue(0);
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
    const v = this.form.getRawValue();
    const items = this.items();
    const uc = v.ucFileName.trim(), photos = v.photosFileName.trim();
    this.submitted.emit({
      summary: v.summary.trim(),
      items: v.rows.map((r, i) => {
        const remark = r.remark.trim();
        return {
          tranchePlanItemId: items[i].id, deliveryState: r.deliveryState!, spentMinor: Math.round(r.spent! * 100),
          ...(remark ? { remark } : {}),
        };
      }),
      ...(uc ? { ucFileName: uc } : {}),
      ...(photos ? { photosFileName: photos } : {}),
    });
  }

  private check(): string | null {
    const cur = this.currency();
    const spent = this.spentMinor(), amount = this.tranche().amountMinor;
    const fields = this.form.invalid ? 'Some answers need attention: check the highlighted fields.' : null;
    const over = spent > amount
      ? `Spending adds up to ${formatMoney(spent, cur)}; this tranche is only ${formatMoney(amount, cur)}. Check the amounts spent.`
      : null;
    return [fields, over].filter(Boolean).join(' ') || null;
  }

  private build(tranche: Tranche, planItems: TranchePlanItem[], initial: TrancheReport | null) {
    const items = [...planItems]
      .filter((i): i is TranchePlanItem & { id: number } => i.id != null)
      .sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0))
      .map(i => ({ ...i, date: fromByDate(i.byDate) }));
    this.items.set(items);
    this.problem.set(null);
    this.rows.clear({ emitEvent: false });

    const sample = !initial && APP_CONFIG.debugMode ? sampleReport(tranche, items) : null;
    items.forEach((item, i) => {
      const saved = initial?.trancheReportItems?.find(r => r.tranchePlanItemId === item.id);
      const row = sample?.rows[i] ?? {
        deliveryState: saved?.deliveryState ?? null,
        spent: saved?.spentMinor != null ? saved.spentMinor / 100 : null,
        remark: saved?.remark ?? '',
      };
      const group: ReportRow = this.fb.group({
        deliveryState: this.fb.control<DeliveryState | null>(row.deliveryState, Validators.required),
        spent: this.fb.control<number | null>(row.spent, [Validators.required, Validators.min(0), paise]),
        remark: [row.remark, [remarkWhenShort, Validators.maxLength(REPORT_LIMITS.remark)]],
      });
      // The remark's rule reads its sibling, which only exists now the group does.
      group.controls.remark.updateValueAndValidity({ emitEvent: false });
      this.rows.push(group, { emitEvent: false });
    });

    this.form.patchValue({
      summary: sample?.summary ?? initial?.summary ?? '',
      ucFileName: sample?.ucFileName ?? initial?.ucFileName ?? '',
      photosFileName: sample?.photosFileName ?? initial?.photosFileName ?? '',
    }, { emitEvent: false });
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.form.updateValueAndValidity();
    if (this.busy()) this.form.disable({ emitEvent: false });
  }

  private focusProblem() {
    afterNextRender(() => {
      const field = this.host.nativeElement.querySelector<HTMLElement>(
        'mat-button-toggle-group.ng-invalid button, input.ng-invalid, textarea.ng-invalid');
      (field ?? this.problemEl()?.nativeElement)?.focus();
    }, { injector: this.injector });
  }
}

/** Debug mode: a believable report — mostly done, one activity partly done, spending a little under the tranche. */
function sampleReport(tranche: Tranche, items: TranchePlanItem[]) {
  const rows = items.map((item, i) => {
    const partly = items.length > 1 && i === 1;
    return partly
      ? { deliveryState: 'PARTLY_DONE' as DeliveryState, spent: Math.floor((item.budgetMinor * 0.6) / 100),
          remark: 'Two of the three sessions held; the last moved to next month because of the monsoon.' }
      : { deliveryState: 'DONE' as DeliveryState, spent: item.budgetMinor / 100, remark: '' };
  });
  return {
    rows,
    summary: items.length > 1
      ? 'Most of the planned work went ahead on time. One training session slipped to next month because of heavy rain; the unspent money is set aside for it.'
      : 'The planned work went ahead on time and within budget.',
    ucFileName: `UC-tranche-${tranche.sequenceNo}.pdf`,
    photosFileName: `tranche-${tranche.sequenceNo}-photos.zip`,
  };
}

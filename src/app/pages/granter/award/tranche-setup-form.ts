import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { APP_CONFIG } from '../../../core/config';
import { TRANCHE_SPLITS, TrancheSetup, splitAmount } from '../../../core/tranches';

type Count = 2 | 3 | 4;
const COUNTS: Count[] = [2, 3, 4];

/** Debug-mode milestone names, first to last. */
const TEST_LABELS: Record<Count, string[]> = {
  2: ['Inception & baseline', 'Completion & final report'],
  3: ['Inception & baseline', 'Mid-term delivery', 'Completion & final report'],
  4: ['Inception & baseline', 'Mid-term delivery', 'Scale-up & follow-through', 'Completion & final report'],
};

/** Local midnight `months` months and `days` days from today: datepicker values are start-of-day Dates. */
const fromToday = (months: number, days = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate() + days);
};

/** Percentages are whole numbers, so they add up to exactly 100 (no 33.33 + 33.33 + 33.34 rounding). */
const wholeNumber = (c: AbstractControl): ValidationErrors | null =>
  c.value == null || c.value === '' || Number.isInteger(Number(c.value)) ? null : { whole: true };

/**
 * Splits an award into 2–4 tranches: a share of the grant, a milestone, and when it's released and reported on.
 * The shares must add up to exactly 100%. Emits the set-up; the page confirms and saves it.
 */
@Component({
  selector: 'gm-tranche-setup-form',
  imports: [
    CurrencyPipe, ReactiveFormsModule, MatButtonModule, MatButtonToggleModule, MatDatepickerModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatProgressSpinnerModule,
  ],
  templateUrl: './tranche-setup-form.html',
  styleUrl: './tranche-setup-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrancheSetupForm {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly debug = APP_CONFIG.debugMode;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The awarded amount, in minor units. */
  readonly totalMinor = input.required<number>();
  readonly currency = input('INR');
  readonly busy = input(false);
  readonly submitted = output<TrancheSetup[]>();

  protected readonly counts = COUNTS;
  protected readonly count = signal<Count>(3);

  protected readonly form = this.fb.group({ rows: this.fb.array(this.rowsFor(3)) });
  protected get rows() { return this.form.controls.rows; }

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly shares = computed(() => (this.value().rows ?? []).map(r => Number(r?.percentage) || 0));
  protected readonly sum = computed(() => this.shares().reduce((a, b) => a + b, 0));
  /** Each tranche's amount; the exact split (last tranche takes the rounding) once the shares add up to 100. */
  protected readonly amounts = computed(() => {
    const total = this.totalMinor(), shares = this.shares();
    return this.sum() === 100 ? splitAmount(total, shares) : shares.map(p => Math.floor((total * p) / 100));
  });
  protected amountAt(i: number) { return this.amounts()[i] ?? 0; }
  /** Set when a submit was refused because the shares don't add up to 100. */
  protected readonly sumRefused = signal(false);

  /** New number of tranches: the preset shares; what was typed stays (debug mode refills names and dates). */
  protected setCount(n: Count) {
    if (n === this.count()) return;
    const typed = this.rows.getRawValue();
    this.count.set(n);
    this.sumRefused.set(false);
    this.rows.clear({ emitEvent: false });
    this.rowsFor(n, typed).forEach(row => this.rows.push(row, { emitEvent: false }));
    this.rows.updateValueAndValidity();
  }

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // At 375px the first broken field may be far above the button: take the user to it.
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('input.ng-invalid')?.focus(), { injector: this.injector });
      return;
    }
    if (this.sum() !== 100) { this.sumRefused.set(true); return; }
    this.sumRefused.set(false);
    this.submitted.emit(this.rows.getRawValue().map(r => ({
      percentage: Number(r.percentage),
      milestoneLabel: r.milestoneLabel.trim(),
      ...(r.reportDueAt ? { reportDueAt: r.reportDueAt.getTime() } : {}),
    })));
  }

  private rowsFor(n: Count, typed: { milestoneLabel: string; reportDueAt: Date | null }[] = []) {
    return TRANCHE_SPLITS[n].map((percentage, i) => {
      const kept = this.debug ? undefined : typed[i];
      return this.fb.group({
        percentage: [percentage as number | null, [Validators.required, Validators.min(1), Validators.max(100), wholeNumber]],
        milestoneLabel: [kept?.milestoneLabel ?? (this.debug ? TEST_LABELS[n][i] : ''), [Validators.required, Validators.maxLength(120)]],
        // The service stamps each tranche's planned release itself (at set-up), so only the report date is asked for.
        // Debug: reports due about a month apart.
        reportDueAt: [kept?.reportDueAt ?? (this.debug ? fromToday(i + 1, -7) : null)],
      });
    });
  }
}

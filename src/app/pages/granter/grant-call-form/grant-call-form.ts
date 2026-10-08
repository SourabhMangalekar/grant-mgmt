import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormArray, FormBuilder, FormControl, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GrantCall, GrantCallApi, CallState } from '../../../core/grant-call.api';
import { APP_CONFIG } from '../../../core/config';
import { apiErrorMessage } from '../../../core/api-error';

export const THEMES = ['Education', 'Health', 'Livelihoods', 'Environment', 'Water & Sanitation', 'Women Empowerment', 'Disaster Relief', 'Other'];

/** Companies Act 2013, Schedule VII — the CSR activity categories a CSR-funded call must fall under. */
export const SCHEDULE_VII = [
  { code: 'SCH7_I', label: '(i) Hunger, poverty, healthcare, sanitation, safe drinking water' },
  { code: 'SCH7_II', label: '(ii) Education, vocational skills, livelihood enhancement' },
  { code: 'SCH7_III', label: '(iii) Gender equality, women empowerment, care for senior citizens' },
  { code: 'SCH7_IV', label: '(iv) Environmental sustainability, ecological balance, animal welfare' },
  { code: 'SCH7_V', label: '(v) National heritage, art and culture' },
  { code: 'SCH7_VI', label: '(vi) Benefit of armed forces veterans and their dependents' },
  { code: 'SCH7_VII', label: '(vii) Training to promote sports' },
  { code: 'SCH7_X', label: '(x) Rural development projects' },
  { code: 'SCH7_XI', label: '(xi) Slum area development' },
  { code: 'SCH7_XII', label: '(xii) Disaster management, relief and rehabilitation' },
];

export const REQUIRED_DOCS = [
  { code: 'REGISTRATION_CERTIFICATE', label: 'Registration certificate' },
  { code: 'PAN', label: 'PAN card' },
  { code: '12A', label: '12A certificate' },
  { code: '80G', label: '80G certificate' },
  { code: 'CSR_1', label: 'CSR-1 registration' },
  { code: 'FCRA', label: 'FCRA registration' },
  { code: 'AUDITED_FINANCIALS', label: 'Audited financials (last 3 years)' },
  { code: 'ANNUAL_REPORT', label: 'Latest annual report' },
];

/** Local midnight of `d` plus `days` — datepicker values are always start-of-day Dates. */
const startOfDay = (d: Date, days = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** Calls can be scheduled up to this far ahead; also catches year typos like 2062 for 2026. */
const MAX_YEARS_AHEAD = 2;

/** The two states this form can save a call in: kept private (DRAFT) or made public to grantees (PUBLISHED). */
type SaveState = Extract<CallState, 'DRAFT' | 'PUBLISHED'>;

/** Selectable "reviewers per application" — same 1–10 range as the validators. */
const REVIEWER_COUNTS = Array.from({ length: 10 }, (_, i) => i + 1);

/**
 * Opens before it closes; min ≤ max ≤ envelope.
 * (mat-date-range-input also flags the same date clash on the controls as matStartDateInvalid / matEndDateInvalid.)
 */
const consistent: ValidatorFn = (g: AbstractControl): ValidationErrors | null => {
  const v = g.value;
  const errors: ValidationErrors = {};
  if (v.opensAt instanceof Date && v.closesAt instanceof Date && v.closesAt.getTime() < v.opensAt.getTime()) {
    errors['closesBeforeOpens'] = true;
  }
  if (v.minAward != null && v.maxAward != null && v.minAward > v.maxAward) errors['minAboveMax'] = true;
  if (v.maxAward != null && v.envelope != null && v.maxAward > v.envelope) errors['maxAboveEnvelope'] = true;
  return Object.keys(errors).length ? errors : null;
};

/**
 * "New call for proposals" — a granter publishes a call for proposals (commons-grant-service POST /grant-calls).
 * Saved either as a draft (DRAFT) or published (PUBLISHED) so grantees see it under "Open calls".
 */
@Component({
  selector: 'gm-grant-call-form',
  imports: [ReactiveFormsModule, RouterLink, CurrencyPipe, TextFieldModule, MatFormFieldModule, MatInputModule,
    MatDatepickerModule, MatSelectModule, MatSlideToggleModule, MatCheckboxModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule],
  templateUrl: './grant-call-form.html',
  styleUrl: './grant-call-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrantCallForm {
  private readonly api = inject(GrantCallApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly themes = THEMES;
  protected readonly scheduleVii = SCHEDULE_VII;
  protected readonly docs = REQUIRED_DOCS;
  protected readonly reviewerCounts = REVIEWER_COUNTS;
  protected readonly maxYearsAhead = MAX_YEARS_AHEAD;
  /** Application window bounds: from today (a call can open today) to MAX_YEARS_AHEAD years out. */
  protected readonly minDate = startOfDay(new Date());
  protected readonly maxDate = new Date(this.minDate.getFullYear() + MAX_YEARS_AHEAD, this.minDate.getMonth(), this.minDate.getDate());
  protected readonly saving = signal<SaveState | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(250)]],
    callCode: ['', Validators.maxLength(60)],
    theme: ['', Validators.required],
    description: ['', [Validators.required, Validators.maxLength(2000)]],
    envelope: this.fb.control<number | null>(null, [Validators.required, Validators.min(1)]),
    minAward: this.fb.control<number | null>(null, Validators.min(0)),
    maxAward: this.fb.control<number | null>(null, Validators.min(1)),
    opensAt: this.fb.control<Date | null>(null, Validators.required),
    closesAt: this.fb.control<Date | null>(null, Validators.required),
    reviewersRequired: [2, [Validators.required, Validators.min(1), Validators.max(10)]],
    isCsrFunded: [false],
    scheduleViiCode: [''],
    isForeignFunded: [false],
    responseFormat: ['QUESTIONS', Validators.required],
    budgetPeriod: ['YEARLY'],
    budgetFormat: ['LINE_ITEMS'],
    requiredDocs: this.fb.control<string[]>(['REGISTRATION_CERTIFICATE', 'PAN', '12A', '80G']),
    questions: this.fb.array<FormControl<string>>([
      this.fb.control('What problem does your project address, and for whom?', Validators.required),
      this.fb.control('What outcomes will you achieve, and how will you measure them?', Validators.required),
    ]),
  }, { validators: consistent });

  protected readonly questions = this.form.controls.questions as FormArray<FormControl<string>>;
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly isCsr = computed(() => !!this.values().isCsrFunded);

  protected readonly debug = APP_CONFIG.debugMode;

  constructor() {
    // Schedule VII category is mandatory for CSR money; FCRA is mandatory for foreign money.
    const c = this.form.controls;
    c.isCsrFunded.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(csr => {
      c.scheduleViiCode.setValidators(csr ? Validators.required : null);
      if (!csr) c.scheduleViiCode.setValue('');
      c.scheduleViiCode.updateValueAndValidity();
      this.ensureDoc('CSR_1', csr);
    });
    c.isForeignFunded.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(f => this.ensureDoc('FCRA', f));

    if (this.debug) this.prefill();
  }

  /** Debug mode only: a complete, valid CSR call so "Publish call" can be tested in one click. */
  private prefill() {
    const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '');
    this.form.patchValue({
      title: `[TEST] Foundational Literacy & Numeracy ${stamp}`,
      callCode: `TEST-FLN-${stamp}`,
      theme: 'Education',
      description: 'Test call created in debug mode. Funding for NGOs running foundational literacy and numeracy '
        + 'programmes in government primary schools, with a focus on Grades 1–3 in aspirational districts.',
      envelope: 5000000,
      minAward: 500000,
      maxAward: 1500000,
      opensAt: startOfDay(new Date(), 1),
      closesAt: startOfDay(new Date(), 45),
      reviewersRequired: 2,
      responseFormat: 'QUESTIONS',
      budgetFormat: 'LINE_ITEMS',
      budgetPeriod: 'YEARLY',
    });
    // Through the toggle so its side effects run (Schedule VII required, CSR-1 doc ticked).
    this.form.controls.isCsrFunded.setValue(true);
    this.form.controls.scheduleViiCode.setValue('SCH7_II');
    this.addQuestion();
    this.questions.at(-1).setValue('How will you sustain the programme after the grant ends?');
  }

  protected addQuestion() { this.questions.push(this.fb.control('', Validators.required)); }
  protected removeQuestion(i: number) { this.questions.removeAt(i); }

  protected toggleDoc(code: string, on: boolean) { this.ensureDoc(code, on); }
  protected hasDoc(code: string) { return this.form.controls.requiredDocs.value.includes(code); }

  protected save(state: SaveState) {
    // Drafts only need a title; publishing needs everything.
    if (state === 'PUBLISHED' ? this.form.invalid : this.form.controls.title.invalid) {
      this.form.markAllAsTouched();
      this.error.set(state === 'PUBLISHED' ? 'Fix the highlighted fields before publishing.' : 'Give the call a title to save it as a draft.');
      return;
    }
    this.saving.set(state);
    this.error.set(null);
    this.api.create(this.toDto(state)).subscribe({
      next: () => this.router.navigate(['/grant-calls'], { queryParams: { created: state === 'PUBLISHED' ? 'published' : 'draft' } }),
      error: err => {
        this.saving.set(null);
        this.error.set(apiErrorMessage(err, 'Couldn’t save the call for proposals. Please try again in a few minutes.'));
      },
    });
  }

  private toDto(state: SaveState): GrantCall {
    const v = this.form.getRawValue();
    const paise = (rupees: number | null) => rupees == null ? undefined : Math.round(rupees * 100);
    // Epoch ms in local time: the call opens at 00:00:00.000 on the start date and closes at 23:59:59.999 on the end date.
    const day = (date: Date | null, endOfDay = false) => {
      if (!date) return 0;
      const d = startOfDay(date);
      if (endOfDay) d.setHours(23, 59, 59, 999);
      return d.getTime();
    };
    return {
      title: v.title.trim(),
      callCode: v.callCode.trim() || undefined,
      theme: v.theme || undefined,
      description: v.description.trim() || undefined,
      state,
      currencyCode: 'INR',
      envelopeAmountMinor: paise(v.envelope) ?? 0,
      minAwardMinor: paise(v.minAward),
      maxAwardMinor: paise(v.maxAward),
      opensAt: day(v.opensAt),
      closesAt: day(v.closesAt, true),
      postedAt: state === 'PUBLISHED' ? Date.now() : undefined,
      reviewersRequired: v.reviewersRequired,
      isCsrFunded: v.isCsrFunded,
      scheduleViiCode: v.isCsrFunded ? v.scheduleViiCode || undefined : undefined,
      isForeignFunded: v.isForeignFunded,
      responseFormat: v.responseFormat,
      // Not edited in the form yet; sent as empty JSON so NOT NULL columns are satisfied.
      responseConfigJson: '{}',
      rulesJson: '{}',
      budgetPeriod: v.budgetPeriod,
      budgetFormat: v.budgetFormat,
      requiredDocsJson: JSON.stringify(v.requiredDocs),
      questionsJson: JSON.stringify(v.questions.map(q => q.trim()).filter(Boolean)
        .map((text, i) => ({ id: `Q${i + 1}`, text }))),
    };
  }

  private ensureDoc(code: string, on: boolean) {
    const ctrl = this.form.controls.requiredDocs;
    const set = new Set(ctrl.value);
    on ? set.add(code) : set.delete(code);
    ctrl.setValue([...set]);
  }
}

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, FormControl, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GrantCall, GrantCallApi } from '../../../core/grant-call.api';
import { ApplicationApi } from '../../../core/application.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { APP_CONFIG } from '../../../core/config';
import { apiErrorMessage } from '../../../core/api-error';
import { REQUIRED_DOCS } from '../../granter/grant-call-form/grant-call-form';

export const BUDGET_HEADS = ['Personnel', 'Programme activities', 'Equipment & materials', 'Travel', 'Training & capacity building', 'Monitoring & evaluation', 'Administration & overheads', 'Other'];

type LineGroup = FormGroup<{
  head: FormControl<string>;
  item: FormControl<string>;
  quantity: FormControl<number | null>;
  unitCost: FormControl<number | null>;
}>;

/** answersJson is capped at 8000 characters by the API. */
const ANSWERS_LIMIT = 8000;

/** Field limits — shared by the validators and the template's maxlength/min/max attributes so they never drift apart. */
const LIMITS = {
  title: 250,
  text: 1500,
  item: 500,
  note: 500,
  durationMin: 1,
  durationMax: 60,
  quantityMin: 1,
  unitCostMin: 1,
} as const;

/** Whole numbers only (counts such as months and quantities). Empty values are left to `required`. */
function wholeNumber(control: AbstractControl): ValidationErrors | null {
  const v = control.value as number | null;
  return v == null || Number.isInteger(v) ? null : { wholeNumber: true };
}

/** The requested-amount bounds (rupees) for a call: min is at least ₹1; max only when the call sets one. */
function awardLimits(call: GrantCall | null): { min: number; max: number | null } {
  return {
    min: Math.max(1, (call?.minAwardMinor ?? 100) / 100),
    max: call?.maxAwardMinor != null ? call.maxAwardMinor / 100 : null,
  };
}

/**
 * "New proposal" — a grantee applies to a call for proposals (commons-grant-service):
 * resolves the organisation, POST /applications, POST /application-budget-lines per line, then POST /applications/{id}/submit.
 */
@Component({
  selector: 'gm-proposal-form',
  imports: [ReactiveFormsModule, RouterLink, CurrencyPipe, DatePipe, TextFieldModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatCheckboxModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './proposal-form.html',
  styleUrl: './proposal-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalForm {
  private readonly calls = inject(GrantCallApi);
  private readonly apps = inject(ApplicationApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** Bound from the :id route param (the call being applied to). */
  readonly id = input.required<string>();

  protected readonly heads = BUDGET_HEADS;
  protected readonly limits = LIMITS;
  protected readonly debug = APP_CONFIG.debugMode;
  protected readonly call = signal<GrantCall | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal<'draft' | 'submit' | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly questions = computed(() => parseQuestions(this.call()?.questionsJson));
  protected readonly requiredDocs = computed(() => {
    try { return (JSON.parse(this.call()?.requiredDocsJson || '[]') as string[]).map(c => REQUIRED_DOCS.find(d => d.code === c)?.label ?? c); }
    catch { return []; }
  });
  /** Requested-amount bounds in rupees — the same numbers drive the validators (setUpForCall) and the input's min/max. */
  protected readonly amountMin = computed(() => awardLimits(this.call()).min);
  protected readonly amountMax = computed(() => awardLimits(this.call()).max);

  protected readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(LIMITS.title)]],
    summary: ['', [Validators.required, Validators.maxLength(LIMITS.text)]],
    requestedAmount: this.fb.control<number | null>(null, [Validators.required, Validators.min(1)]),
    durationMonths: this.fb.control<number | null>(12, [Validators.required, Validators.min(LIMITS.durationMin),
      Validators.max(LIMITS.durationMax), wholeNumber]),
    answers: this.fb.array<FormControl<string>>([]),
    lines: this.fb.array<LineGroup>([]),
    budgetNote: ['', Validators.maxLength(LIMITS.note)],
    consent: [false],
  });
  protected readonly answers = this.form.controls.answers;
  protected readonly lines = this.form.controls.lines as FormArray<LineGroup>;

  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly lineTotals = computed(() => (this.values().lines ?? []).map(l => (l.quantity ?? 0) * (l.unitCost ?? 0)));
  protected readonly budgetTotal = computed(() => this.lineTotals().reduce((a, b) => a + b, 0));
  protected readonly budgetGap = computed(() => (this.values().requestedAmount ?? 0) - this.budgetTotal());
  protected readonly answersLength = computed(() => this.answersJson().length);

  constructor() {
    effect(() => this.load(Number(this.id())));
  }

  private load(id: number) {
    this.loading.set(true);
    this.loadError.set(null);
    this.calls.getOpen(id).subscribe({
      next: call => {
        this.call.set(call);
        this.setUpForCall(call);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.loadError.set(err?.status === 404 ? 'This call doesn’t exist or was removed.' : 'Couldn’t load this call.');
      },
    });
  }

  /** Award limits become amount validators; each funder question gets an answer box. */
  private setUpForCall(call: GrantCall) {
    const amount = this.form.controls.requestedAmount;
    const { min, max } = awardLimits(call);
    const v: ValidatorFn[] = [Validators.required, Validators.min(min)];
    if (max != null) v.push(Validators.max(max));
    amount.setValidators(v);
    amount.updateValueAndValidity();

    this.answers.clear();
    for (const _ of parseQuestions(call.questionsJson)) this.answers.push(this.fb.control('', [Validators.required, Validators.maxLength(LIMITS.text)]));
    this.lines.clear();
    this.addLine();
    if (this.debug) this.prefill(call);
  }

  protected addLine(head = '', item = '', quantity: number | null = 1, unitCost: number | null = null) {
    this.lines.push(this.fb.group({
      head: [head, Validators.required],
      item: [item, [Validators.required, Validators.maxLength(LIMITS.item)]],
      quantity: this.fb.control<number | null>(quantity, [Validators.required, Validators.min(LIMITS.quantityMin), wholeNumber]),
      unitCost: this.fb.control<number | null>(unitCost, [Validators.required, Validators.min(LIMITS.unitCostMin)]),
    }));
  }
  protected removeLine(i: number) { this.lines.removeAt(i); }

  protected save(mode: 'draft' | 'submit') {
    const call = this.call();
    if (!call?.id) return;
    if (mode === 'submit') {
      this.form.markAllAsTouched();
      const problem = this.form.invalid ? 'Fix the highlighted fields before submitting.'
        : this.budgetGap() !== 0 ? 'Your budget lines must add up to the amount you’re requesting.'
        : !this.form.controls.consent.value ? 'Confirm the declaration before submitting.'
        : this.answersLength() > ANSWERS_LIMIT ? 'Your answers are too long in total — shorten them a little.'
        : null;
      if (problem) { this.error.set(problem); return; }
    } else if (this.form.controls.title.invalid) {
      this.form.controls.title.markAsTouched();
      this.error.set('Give your proposal a title to save it as a draft.');
      return;
    }

    const v = this.form.getRawValue();
    const user = this.auth.user();
    const paise = (rupees: number | null | undefined) => rupees == null ? undefined : Math.round(rupees * 100);
    // Drafts keep only complete budget lines.
    const lines = v.lines
      .filter(l => l.head && l.item && l.quantity && l.unitCost)
      .map((l, i) => ({
        lineNo: i + 1, head: l.head, item: l.item.trim(), quantity: l.quantity!,
        unitCostMinor: paise(l.unitCost)!, amountMinor: paise(l.quantity! * l.unitCost!)!,
      }));

    this.saving.set(mode);
    this.error.set(null);
    this.apps.myOrganisation({
      legalName: user?.tenantName, kind: 'GRANTEE', contactName: user?.name,
      contactEmail: user?.userLogin.includes('@') ? user.userLogin : undefined,
    }).pipe(
      switchMap(organisationId => this.apps.save({
        grantCallId: call.id!,
        organisationId,
        disagreementFlagged: false,
        title: v.title.trim(),
        state: 'DRAFT',
        currencyCode: call.currencyCode || 'INR',
        requestedAmountMinor: paise(v.requestedAmount),
        durationMonths: v.durationMonths ?? undefined,
        answersJson: this.answersJson(),
        budgetTotalMinor: paise(this.budgetTotal()),
        budgetNote: v.budgetNote.trim() || undefined,
        consentGivenAt: v.consent ? Date.now() : undefined,
      }, lines, mode === 'submit')),
    ).subscribe({
      next: () => this.router.navigate(['/applications'], { queryParams: { created: mode === 'submit' ? 'submitted' : 'draft' } }),
      error: err => {
        this.saving.set(null);
        this.error.set(apiErrorMessage(err, 'Couldn’t save your proposal. Please try again in a few minutes.', [
          // The grant service can't see another organisation's call yet (tenant filter): see docs/backend §4.1b.
          { match: /GrantCall not found/i, message: 'This call isn’t accepting proposals right now. Your answers are still here, so try again later or contact the funder.' },
        ]));
      },
    });
  }

  /** { summary, answers: [{ questionId, question, answer }] } — the shape stored in ApplicationDTO.answersJson. */
  private answersJson(): string {
    const v = this.form.getRawValue();
    return JSON.stringify({
      summary: v.summary.trim(),
      answers: this.questions().map((q, i) => ({ questionId: q.id, question: q.text, answer: (v.answers[i] ?? '').trim() })),
    });
  }

  /** Debug mode only: a complete proposal within the call's limits, so "Submit" can be tested in one click. */
  private prefill(call: GrantCall) {
    const min = (call.minAwardMinor ?? 0) / 100, max = (call.maxAwardMinor ?? call.envelopeAmountMinor) / 100;
    const amount = Math.round(Math.min(max, Math.max(min, 1_200_000)) / 1000) * 1000;
    this.form.patchValue({
      title: `[TEST] Reading Champions — ${call.title ?? 'proposal'}`.slice(0, LIMITS.title),
      summary: 'Test proposal created in debug mode. We will train 60 community volunteers as reading champions to run daily '
        + 'after-school sessions for 1,800 children in Grades 1–3 across 40 villages, with monthly assessments shared with schools.',
      durationMonths: 12,
      requestedAmount: amount,
      budgetNote: 'Volunteer stipends are paid monthly; materials are bought in the first quarter.',
      consent: true,
    });
    const sample = [
      'Most children in our districts reach Grade 3 unable to read a simple paragraph; schools lack time for remedial support.',
      'Grade 3 reading fluency rises from 22% to 50% within a year, measured with ASER-style tools at baseline, midline and endline.',
      'Panchayats co-fund volunteer stipends from year two, and trained volunteers continue under the schools’ management committees.',
    ];
    this.answers.controls.forEach((c, i) => c.setValue(sample[i] ?? 'Answer provided in debug mode.'));
    // Three lines that add up exactly to the requested amount.
    this.lines.clear();
    const stipends = Math.round(amount * 0.5), materials = Math.round(amount * 0.3);
    this.addLine('Personnel', 'Volunteer stipends (60 volunteers × 12 months)', 1, stipends);
    this.addLine('Equipment & materials', 'Graded readers and reading kits', 1, materials);
    this.addLine('Monitoring & evaluation', 'Baseline, midline and endline assessments', 1, amount - stipends - materials);
  }
}

/** Questions from a call's questionsJson: [{ id, text }] or plain strings. */
function parseQuestions(raw: string | undefined): { id: string; text: string }[] {
  try {
    return (JSON.parse(raw || '[]') as ({ id?: string; text?: string } | string)[])
      .map((q, i) => typeof q === 'string' ? { id: `Q${i + 1}`, text: q } : { id: q.id ?? `Q${i + 1}`, text: q.text ?? '' })
      .filter(q => q.text);
  } catch { return []; }
}

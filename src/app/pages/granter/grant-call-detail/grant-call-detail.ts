import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GrantApplication, GrantCall, GrantCallApi } from '../../../core/grant-call.api';
import { REQUIRED_DOCS, SCHEDULE_VII } from '../grant-call-form/grant-call-form';

const RESPONSE_FORMATS: Record<string, string> = {
  QUESTIONS: 'Answer questions online',
  PROPOSAL_UPLOAD: 'Upload a proposal document',
  QUESTIONS_AND_UPLOAD: 'Answer questions and upload a proposal',
};
const BUDGET_FORMATS: Record<string, string> = { LINE_ITEMS: 'Line items', TEMPLATE_UPLOAD: 'Upload funder template' };
const BUDGET_PERIODS: Record<string, string> = { YEARLY: 'Yearly', QUARTERLY: 'Quarterly', MONTHLY: 'Monthly' };

/** Parses one of the API's *Json string fields; tolerates empty or malformed values. */
function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Call for proposals details — GET /grant-calls/{id} plus its applications. */
@Component({
  selector: 'gm-grant-call-detail',
  imports: [CurrencyPipe, DatePipe, TitleCasePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './grant-call-detail.html',
  styleUrl: './grant-call-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrantCallDetail {
  private readonly api = inject(GrantCallApi);

  /** Bound from the :id route param. */
  readonly id = input.required<string>();

  protected readonly call = signal<GrantCall | null>(null);
  protected readonly applications = signal<GrantApplication[]>([]);
  protected readonly applicationsTotal = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly questions = computed(() =>
    parseJson<({ id?: string; text?: string } | string)[]>(this.call()?.questionsJson, [])
      .map(q => typeof q === 'string' ? q : q.text ?? '').filter(Boolean));
  protected readonly docs = computed(() =>
    parseJson<string[]>(this.call()?.requiredDocsJson, [])
      .map(code => REQUIRED_DOCS.find(d => d.code === code)?.label ?? code));
  protected readonly scheduleVii = computed(() => {
    const code = this.call()?.scheduleViiCode;
    return code ? SCHEDULE_VII.find(s => s.code === code)?.label ?? code : null;
  });
  protected readonly responseFormat = computed(() => label(RESPONSE_FORMATS, this.call()?.responseFormat));
  protected readonly budgetFormat = computed(() => label(BUDGET_FORMATS, this.call()?.budgetFormat));
  protected readonly budgetPeriod = computed(() => label(BUDGET_PERIODS, this.call()?.budgetPeriod));
  protected readonly isOpen = computed(() => this.call()?.state === 'OPEN');
  /** Days until the call closes (negative once closed). */
  protected readonly daysLeft = computed(() => {
    const closes = this.call()?.closesAt;
    return closes ? Math.ceil((closes - Date.now()) / 86_400_000) : null;
  });

  /** Where the call is in its window: before opening, accepting applications, or closed. */
  protected readonly phase = computed<'draft' | 'upcoming' | 'live' | 'closed'>(() => {
    const c = this.call();
    if (!c || c.state !== 'OPEN') return 'draft';
    const now = Date.now();
    if (c.opensAt && now < c.opensAt) return 'upcoming';
    if (c.closesAt && now > c.closesAt) return 'closed';
    return 'live';
  });

  /** 0–100: how much of the application window has elapsed. */
  protected readonly windowProgress = computed(() => {
    const c = this.call();
    if (!c?.opensAt || !c.closesAt || c.closesAt <= c.opensAt) return 0;
    return Math.min(100, Math.max(0, ((Date.now() - c.opensAt) / (c.closesAt - c.opensAt)) * 100));
  });

  protected readonly daysToOpen = computed(() => {
    const opens = this.call()?.opensAt;
    return opens ? Math.ceil((opens - Date.now()) / 86_400_000) : null;
  });

  /** Milestones for the timeline, in order, flagged done once their date has passed. */
  protected readonly milestones = computed(() => {
    const c = this.call();
    if (!c) return [];
    const now = Date.now();
    return [
      { label: 'Published', at: c.postedAt, icon: 'campaign' },
      { label: 'Opens', at: c.opensAt, icon: 'lock_open' },
      { label: 'Closes', at: c.closesAt, icon: 'event_busy' },
      { label: 'Review', at: undefined, icon: 'rate_review', hint: `${c.reviewersRequired} reviewer${c.reviewersRequired === 1 ? '' : 's'} each` },
    ].map(m => ({ ...m, done: !!m.at && m.at <= now }));
  });

  protected readonly copied = signal(false);

  protected copyLink() {
    navigator.clipboard?.writeText(location.href).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  constructor() {
    effect(() => this.load(Number(this.id())));
  }

  protected load(id: number) {
    this.loading.set(true);
    this.error.set(null);
    this.api.get(id).subscribe({
      next: call => { this.call.set(call); this.loading.set(false); },
      error: err => {
        this.loading.set(false);
        this.error.set(err?.status === 404 ? 'This call for proposals doesn’t exist or was removed.' : 'Couldn’t load this call for proposals.');
      },
    });
    this.api.applications(id).subscribe({
      next: page => { this.applications.set(page.elements ?? []); this.applicationsTotal.set(page.totalElements ?? page.elements?.length ?? 0); },
      error: () => this.applications.set([]),
    });
  }

  protected retry() { this.load(Number(this.id())); }
}

function label(map: Record<string, string>, code: string | undefined) {
  return code ? map[code] ?? code : '—';
}

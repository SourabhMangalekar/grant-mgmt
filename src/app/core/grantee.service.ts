import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { Application, ApplicationApi } from './application.api';
import { GrantCall, GrantCallApi, isPublished } from './grant-call.api';
import { Grant, GrantStatus } from './grant.model';

/** A funder's open call for proposals, as a grantee sees it in lists. */
export interface OpenCall {
  id: number;
  title: string;
  /** The funder's own call code, if any. (The grant service doesn't expose the funder's name.) */
  code: string;
  program: string;
  maxAmount: number;
  deadline: string;
  raw: GrantCall;
}

/** Grant-service application states → the app's status chips. Unknown states read as in review. */
export function statusOf(state: string | undefined): GrantStatus {
  const s = (state ?? 'DRAFT').toUpperCase();
  if (s.includes('DRAFT')) return 'Draft';
  // Negatives first, so NOT_SELECTED or SHORTLIST_REJECTED never read as good news.
  if (s.includes('REJECT') || s.includes('DECLIN') || /NOT_?SELECT|UNSELECT|DESELECT/.test(s)) return 'Rejected';
  // The grant service's review chain: SCREENING (just submitted) → UNDER_REVIEW → COMMITTEE → APPROVED | REJECTED.
  if (s.includes('SCREEN') || s === 'SUBMITTED') return 'Screening';
  if (s.includes('COMMITTEE')) return 'In Committee';
  if (s.includes('APPROV') || s.includes('AWARD')) return 'Approved';
  if (s.includes('CLOS') || s.includes('WITHDRAW')) return 'Closed';
  return 'In Review';
}

/** Submitted and not yet decided: the stages before approval or rejection. */
export const PENDING: GrantStatus[] = ['Screening', 'In Review', 'In Committee'];

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : '');

/** The grantee side of the app: open calls to apply to, and the organisation's own applications. */
@Injectable({ providedIn: 'root' })
export class GranteeService {
  private readonly calls$ = inject(GrantCallApi);
  private readonly apps$ = inject(ApplicationApi);

  private readonly rawCalls = signal<GrantCall[]>([]);
  private readonly rawApps = signal<Application[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);

  /** Published calls still accepting applications, soonest deadline first. */
  readonly calls = computed<OpenCall[]>(() => this.rawCalls()
    .filter(c => isPublished(c.state) && (!c.closesAt || c.closesAt > Date.now()))
    .sort((a, b) => (a.closesAt ?? 0) - (b.closesAt ?? 0))
    .map(c => ({
      id: c.id!,
      title: c.title || 'Untitled call',
      code: c.callCode || '',
      program: c.theme || 'General',
      maxAmount: (c.maxAwardMinor ?? c.envelopeAmountMinor) / 100,
      deadline: iso(c.closesAt),
      raw: c,
    })));

  readonly applications = computed<Grant[]>(() => {
    const calls = new Map(this.rawCalls().map(c => [c.id, c]));
    return this.rawApps().map(a => ({
      id: a.referenceCode || `APP-${a.id}`,
      title: a.title || calls.get(a.grantCallId)?.title || 'Untitled proposal',
      applicant: calls.get(a.grantCallId)?.title || `Call #${a.grantCallId}`,
      program: calls.get(a.grantCallId)?.theme || 'General',
      amount: (a.requestedAmountMinor ?? 0) / 100,
      status: statusOf(a.state),
      submittedOn: iso(a.submittedAt) || iso(a.consentGivenAt),
      appId: a.id,
    }));
  });

  readonly stats = computed(() => {
    const a = this.applications();
    const funded = a.filter(x => x.status === 'Approved' || x.status === 'Closed');
    return {
      drafts: a.filter(x => x.status === 'Draft').length,
      // Everything submitted and not yet decided.
      inReview: a.filter(x => PENDING.includes(x.status)).length,
      funded: funded.length,
      received: funded.reduce((sum, x) => sum + x.amount, 0),
    };
  });

  /** (Re)loads calls and applications from the grant service. */
  load() {
    this.loading.set(true);
    this.error.set(false);
    forkJoin([this.calls$.listOpen(0, 100), this.apps$.list()]).subscribe({
      next: ([calls, apps]) => { this.rawCalls.set(calls); this.rawApps.set(apps); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Observable, catchError, map, of, startWith, switchMap } from 'rxjs';
import { Organisation } from '../../../core/application.api';
import { GrantCall, isPublished } from '../../../core/grant-call.api';
import { GrantStatus } from '../../../core/grant.model';
import { StatusChip } from '../../../core/status-chip';
import { ReceivedApplication, ReceivedApplicationsService, applicantName } from '../../../core/received-applications';

/** One application as the list shows and searches it. */
interface Row {
  app: ReceivedApplication;
  title: string;
  reference: string;
  applicant: string;
  /** When it was sent: submittedAt, else when the applicant gave consent. */
  sentAt?: number;
  /** Lower-cased title, reference code and applicant name, for the search box. */
  haystack: string;
}

type View =
  | { state: 'loading' }
  | { state: 'error'; notFound: boolean }
  | { state: 'ready'; call: GrantCall; rows: Row[] };

const LOADING: View = { state: 'loading' };

/** Statuses a received application can have (drafts never reach the funder), in display order. */
const STATUSES: GrantStatus[] = ['Screening', 'In Review', 'In Committee', 'Approved', 'Rejected', 'Closed'];
const ALWAYS_COUNTED: GrantStatus[] = ['Screening', 'In Review', 'In Committee', 'Approved'];
const STATUS_CLASS: Record<GrantStatus, string> = {
  'Draft': 'draft', 'Screening': 'screening', 'In Review': 'review', 'In Committee': 'committee',
  'Approved': 'approved', 'Rejected': 'rejected', 'Closed': 'closed',
};

/** The applications one of the funder's calls for proposals has received. Read-only. */
@Component({
  selector: 'gm-call-applications',
  imports: [
    CurrencyPipe, DatePipe, RouterLink, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressSpinnerModule, StatusChip,
  ],
  templateUrl: './call-applications.html',
  styleUrl: './call-applications.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CallApplications {
  private readonly received = inject(ReceivedApplicationsService);

  /** Bound from the :id route param. */
  readonly id = input.required<string>();

  /** Bumped by "Try again" to reload. */
  private readonly attempt = signal(0);
  protected readonly query = signal('');
  protected readonly status = signal<GrantStatus | ''>('');
  protected readonly statusClass = STATUS_CLASS;

  protected readonly view = toSignal(
    toObservable(computed(() => ({ id: Number(this.id()), attempt: this.attempt() }))).pipe(
      switchMap(({ id }) => this.fetch(id).pipe(startWith(LOADING))),
    ),
    { initialValue: LOADING },
  );

  protected readonly state = computed(() => this.view().state);
  protected readonly notFound = computed(() => { const v = this.view(); return v.state === 'error' && v.notFound; });
  protected readonly call = computed(() => { const v = this.view(); return v.state === 'ready' ? v.call : null; });
  protected readonly rows = computed(() => { const v = this.view(); return v.state === 'ready' ? v.rows : []; });
  protected readonly currency = computed(() => this.call()?.currencyCode || 'INR');

  /** Figures for the summary strip: the funder's own decisions always, outcomes that need other actions only when there are some. */
  protected readonly summary = computed(() => {
    const rows = this.rows();
    return {
      received: rows.length,
      requestedMinor: rows.reduce((sum, r) => sum + (r.app.requestedAmountMinor ?? 0), 0),
      byStatus: STATUSES
        .map(status => ({ status, count: rows.filter(r => r.app.status === status).length }))
        .filter(s => ALWAYS_COUNTED.includes(s.status) || s.count > 0),
    };
  });

  /** Filter options: only the statuses this call's applications actually have. */
  protected readonly statuses = computed(() => STATUSES.filter(s => this.rows().some(r => r.app.status === s)));
  protected readonly filtering = computed(() => !!this.query().trim() || !!this.status());
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const s = this.status();
    return this.rows().filter(r => (!s || r.app.status === s) && (!q || r.haystack.includes(q)));
  });

  /** Where the call is in its window, for the empty state. */
  protected readonly phase = computed<'draft' | 'upcoming' | 'live' | 'closed'>(() => {
    const c = this.call();
    if (!c || !isPublished(c.state)) return c?.state === 'CLOSED' ? 'closed' : 'draft';
    const now = Date.now();
    if (c.opensAt && now < c.opensAt) return 'upcoming';
    if (c.closesAt && now > c.closesAt) return 'closed';
    return 'live';
  });
  protected readonly hasClosed = computed(() => { const closes = this.call()?.closesAt; return !!closes && closes < Date.now(); });

  protected retry() { this.attempt.update(n => n + 1); }

  protected clearFilters() {
    this.query.set('');
    this.status.set('');
  }

  /** The call and its applications, then the applicants' names (best effort). */
  private fetch(id: number): Observable<View> {
    if (!Number.isInteger(id) || id <= 0) return of<View>({ state: 'error', notFound: true });
    return this.received.forCall(id).pipe(
      switchMap(({ call, applications }) => this.received.organisations(applications.map(a => a.organisationId)).pipe(
        map((orgs): View => ({ state: 'ready', call, rows: applications.map(app => toRow(app, orgs.get(app.organisationId))) })),
      )),
      catchError(err => of<View>({ state: 'error', notFound: err instanceof HttpErrorResponse && err.status === 404 })),
    );
  }
}

function toRow(app: ReceivedApplication, org: Organisation | undefined): Row {
  const applicant = applicantName(org, app.organisationId);
  return {
    app,
    title: app.title?.trim() || 'Untitled proposal',
    reference: app.referenceCode || `Application #${app.id}`,
    applicant,
    sentAt: app.submittedAt ?? app.consentGivenAt,
    haystack: `${app.title ?? ''} ${app.referenceCode ?? ''} ${applicant}`.toLowerCase(),
  };
}

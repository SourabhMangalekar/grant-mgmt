import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription, map, switchMap } from 'rxjs';
import { Organisation } from '../../core/application.api';
import { GrantStatus } from '../../core/grant.model';
import { ReceivedApplication, ReceivedApplicationsService, applicantName } from '../../core/received-applications';
import { StatusChip } from '../../core/status-chip';

/** One received application, flattened for the table and the cards. */
interface Row {
  id: number;
  callId: number;
  reference: string;
  title: string;
  applicant: string;
  callTitle: string;
  requestedMinor: number | null;
  currency: string;
  submittedAt: number | null;
  status: GrantStatus;
  link: (string | number)[];
  callLink: (string | number)[];
  /** Lower-cased text the search box matches against. */
  search: string;
}

/** Every application the funder has received, across all of its calls for proposals. */
@Component({
  selector: 'gm-grants',
  imports: [
    CurrencyPipe, DatePipe, RouterLink, MatTableModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatIconModule, MatButtonModule, MatProgressSpinnerModule, StatusChip,
  ],
  templateUrl: './grants.html',
  styleUrl: './grants.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Grants {
  private readonly received = inject(ReceivedApplicationsService);
  private readonly router = inject(Router);
  private loadSub?: Subscription;

  /** Funders never see drafts, so there's no Draft filter. */
  protected readonly statuses: GrantStatus[] = ['Screening', 'In Review', 'In Committee', 'Approved', 'Rejected', 'Closed'];
  protected readonly columns = ['reference', 'proposal', 'call', 'requested', 'submitted', 'status'];

  protected readonly all = signal<Row[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly query = signal('');
  protected readonly status = signal<GrantStatus | ''>('');
  protected readonly callId = signal<number | ''>('');

  /** The calls that have received applications, for the Call filter. */
  protected readonly calls = computed(() => {
    const byId = new Map<number, { id: number; title: string; count: number }>();
    for (const r of this.all()) {
      const c = byId.get(r.callId) ?? { id: r.callId, title: r.callTitle, count: 0 };
      c.count++;
      byId.set(r.callId, c);
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  });

  protected readonly filtered = computed(() => !!this.query().trim() || !!this.status() || this.callId() !== '');

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const s = this.status();
    const c = this.callId();
    return this.all().filter(r => (!s || r.status === s) && (c === '' || r.callId === c) && (!q || r.search.includes(q)));
  });

  /** Read out by screen readers as the filters change; empty when nothing is filtered. */
  protected readonly resultCount = computed(() =>
    this.filtered() ? `Showing ${this.rows().length} of ${this.all().length}` : '');

  protected readonly trackRow = (_: number, r: Row) => r.id;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.loadSub?.unsubscribe());
    this.load();
  }

  protected load() {
    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(false);
    this.loadSub = this.received.all().pipe(
      switchMap(apps => this.received.organisations(apps.map(a => a.organisationId)).pipe(map(orgs => toRows(apps, orgs)))),
    ).subscribe({
      next: rows => { this.all.set(rows); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }

  protected clearFilters() {
    this.query.set('');
    this.status.set('');
    this.callId.set('');
  }

  /**
   * A click anywhere on a table row opens the application. Keyboard users reach it through the title link;
   * links inside the row, modified clicks and text selections are left alone.
   */
  protected openRow(event: MouseEvent, row: Row) {
    const target = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.shiftKey || target?.closest('a, button')) return;
    if (window.getSelection()?.toString()) return;
    this.router.navigate(row.link);
  }
}

function toRows(apps: ReceivedApplication[], orgs: Map<number, Organisation>): Row[] {
  return apps.map(a => {
    const callId = a.call.id ?? a.grantCallId;
    const reference = a.referenceCode || `#${a.id}`;
    const title = a.title || a.referenceCode || `Application #${a.id}`;
    const applicant = applicantName(orgs.get(a.organisationId), a.organisationId);
    const callTitle = a.call.title || 'Untitled call';
    return {
      id: a.id,
      callId,
      reference,
      title,
      applicant,
      callTitle,
      requestedMinor: a.requestedAmountMinor ?? null,
      currency: a.currencyCode || a.call.currencyCode || 'INR',
      submittedAt: a.submittedAt ?? a.consentGivenAt ?? null,
      status: a.status,
      link: ['/grant-calls', callId, 'applications', a.id],
      callLink: ['/grant-calls', callId, 'applications'],
      search: `${reference} ${title} ${applicant} ${callTitle}`.toLowerCase(),
    };
  });
}

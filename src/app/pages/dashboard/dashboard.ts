import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { catchError, map, of, switchMap } from 'rxjs';
import { Organisation } from '../../core/application.api';
import { ReceivedApplication, ReceivedApplicationsService, applicantName } from '../../core/received-applications';
import { StatusChip } from '../../core/status-chip';
import { PENDING } from '../../core/grantee.service';

const RECENT = 5;

/** The funder's overview: figures and the newest applications across all of its calls for proposals. */
@Component({
  selector: 'gm-dashboard',
  imports: [CurrencyPipe, DatePipe, RouterLink, MatIconModule, MatButtonModule, MatProgressSpinnerModule, StatusChip],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly received = inject(ReceivedApplicationsService);

  /** Undefined while loading. Applicant names are fetched for the recent few only (best effort). */
  private readonly data = toSignal(this.received.all().pipe(
    switchMap(apps => this.received.organisations(apps.slice(0, RECENT).map(a => a.organisationId)).pipe(
      map(orgs => ({ apps, orgs, error: false })),
    )),
    catchError(() => of({ apps: [] as ReceivedApplication[], orgs: new Map<number, Organisation>(), error: true })),
  ));

  protected readonly loading = computed(() => this.data() === undefined);
  protected readonly error = computed(() => !!this.data()?.error);

  /** Funded counts Approved and Closed; committed is what those applications requested. */
  protected readonly stats = computed(() => {
    const apps = this.data()?.apps ?? [];
    const funded = apps.filter(a => a.status === 'Approved' || a.status === 'Closed');
    return {
      total: apps.length,
      // Everything submitted and not yet decided.
      inReview: apps.filter(a => PENDING.includes(a.status)).length,
      approved: funded.length,
      committed: funded.reduce((sum, a) => sum + (a.requestedAmountMinor ?? 0), 0) / 100,
    };
  });

  /** The newest applications (all() is already newest first). */
  protected readonly recent = computed(() => {
    const d = this.data();
    return (d?.apps ?? []).slice(0, RECENT).map(a => ({
      id: a.id,
      title: a.title?.trim() || a.referenceCode || `Application #${a.id}`,
      applicant: applicantName(d?.orgs.get(a.organisationId), a.organisationId),
      sentAt: a.submittedAt ?? a.consentGivenAt,
      status: a.status,
      link: ['/grant-calls', a.grantCallId, 'applications', a.id],
    }));
  });
}

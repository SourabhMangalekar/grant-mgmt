import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { GranteeService } from '../../../core/grantee.service';
import { GrantStatus } from '../../../core/grant.model';
import { StatusChip } from '../../../core/status-chip';

/** The grantee organisation's own applications; each row opens the application (/applications/:id). */
@Component({
  selector: 'gm-my-applications',
  imports: [CurrencyPipe, DatePipe, RouterLink, MatButtonToggleModule, MatIconModule, StatusChip],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Grantee</span>
          <h1>My applications</h1>
          <p>{{ rows().length }} application{{ rows().length === 1 ? '' : 's' }}</p>
        </div>
      </header>

      @if (created(); as c) {
        <div class="auth-alert success" role="status"><mat-icon>check_circle</mat-icon>
          {{ c === 'submitted' ? 'Proposal submitted — the funder will review it.' : 'Draft saved. You can finish it later.' }}</div>
      }

      <mat-button-toggle-group class="filter" [value]="status()" (change)="status.set($event.value)"
                               aria-label="Filter by status" hideSingleSelectionIndicator>
        <mat-button-toggle value="">All</mat-button-toggle>
        @for (s of statuses; track s) { <mat-button-toggle [value]="s">{{ s }}</mat-button-toggle> }
      </mat-button-toggle-group>

      <section class="surface-card list">
        <ul>
          @for (g of rows(); track g.id) {
            <!-- The title is the link; its ::after stretches over the row, so the whole row is clickable but the link's name stays short. -->
            <li [class.linked]="g.appId != null">
              <div class="info">
                <a class="title" [routerLink]="g.appId != null ? ['/applications', g.appId] : null">{{ g.title }}</a>
                <span class="muted">{{ g.id }} · {{ g.program }} · {{ g.submittedOn | date: 'mediumDate' }}</span>
              </div>
              <span class="amount">{{ g.amount | currency: 'INR' : 'symbol' : '1.0-0' : 'en-IN' }}</span>
              <gm-status-chip [status]="g.status" />
              <mat-icon class="chevron" aria-hidden="true">chevron_right</mat-icon>
            </li>
          } @empty {
            <li class="muted">{{ status() ? 'No applications with this status.' : 'You haven’t sent any proposals yet — find an open call to apply to.' }}</li>
          }
        </ul>
      </section>
    </div>
  `,
  styles: `
    .filter { margin-bottom: var(--gm-section-gap); flex-wrap: wrap; }
    .list { padding: var(--gm-space-2) var(--gm-card-pad); }
    ul { list-style: none; margin: 0; padding: 0; }
    li {
      position: relative;
      display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: var(--gm-space-4);
      // Bleeds into the card's padding so the hover background has room around the text.
      margin: 0 calc(var(--gm-space-3) * -1); padding: var(--gm-space-3);
      border-top: 1px solid var(--mat-sys-outline-variant); border-radius: var(--gm-radius-sm);
      &:first-child { border-top: 0; }
      &.linked:hover { background: var(--mat-sys-surface-container); }
      &.linked:has(.title:focus-visible) { outline: 2px solid var(--mat-sys-primary); outline-offset: -2px; }
      @media (max-width: 599.98px) {
        grid-template-columns: 1fr auto auto; gap: var(--gm-space-2) var(--gm-space-3);
        .amount { grid-row: 2; grid-column: 1; }
      }
    }
    .info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title {
      font: var(--mat-sys-title-small); color: inherit; text-decoration: none; overflow-wrap: anywhere;
      &[href]::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
      &:focus-visible { outline: none; }
    }
    li.linked:hover .title { color: var(--mat-sys-primary); }
    .amount { font-family: var(--gm-font-mono); }
    .chevron { color: var(--mat-sys-on-surface-variant); }
    li:not(.linked) .chevron { visibility: hidden; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyApplications {
  /** Bound from ?created=submitted|draft after the proposal form. */
  readonly created = input<string>();
  protected readonly service = inject(GranteeService);

  constructor() { this.service.load(); }
  protected readonly statuses: GrantStatus[] = ['Draft', 'Screening', 'In Review', 'In Committee', 'Approved', 'Rejected'];
  protected readonly status = signal<GrantStatus | ''>('');
  protected readonly rows = computed(() => {
    const s = this.status();
    return this.service.applications().filter(g => !s || g.status === s);
  });
}

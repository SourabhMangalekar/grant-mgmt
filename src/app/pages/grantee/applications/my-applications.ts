import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { GranteeService } from '../../../core/grantee.service';
import { GrantStatus } from '../../../core/grant.model';
import { StatusChip } from '../../../core/status-chip';

/** The grantee organisation's own applications. */
@Component({
  selector: 'gm-my-applications',
  imports: [CurrencyPipe, DatePipe, MatButtonToggleModule, StatusChip],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Grantee</span>
          <h1>My applications</h1>
          <p>{{ rows().length }} application{{ rows().length === 1 ? '' : 's' }}</p>
        </div>
      </header>

      <mat-button-toggle-group class="filter" [value]="status()" (change)="status.set($event.value)"
                               aria-label="Filter by status" hideSingleSelectionIndicator>
        <mat-button-toggle value="">All</mat-button-toggle>
        @for (s of statuses; track s) { <mat-button-toggle [value]="s">{{ s }}</mat-button-toggle> }
      </mat-button-toggle-group>

      <section class="surface-card list">
        <ul>
          @for (g of rows(); track g.id) {
            <li>
              <div class="info">
                <span class="title">{{ g.title }}</span>
                <span class="muted">{{ g.id }} · {{ g.program }} · {{ g.submittedOn | date: 'mediumDate' }}</span>
              </div>
              <span class="amount">{{ g.amount | currency: 'INR' : 'symbol' : '1.0-0' : 'en-IN' }}</span>
              <gm-status-chip [status]="g.status" />
            </li>
          } @empty {
            <li class="muted">No applications with this status.</li>
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
      display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--gm-space-4);
      padding: var(--gm-space-3) 0; border-top: 1px solid var(--mat-sys-outline-variant);
      &:first-child { border-top: 0; }
      @media (max-width: 599.98px) { grid-template-columns: 1fr auto; .amount { grid-row: 2; } }
    }
    .info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title { font: var(--mat-sys-title-small); }
    .amount { font-family: var(--gm-font-mono); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyApplications {
  private readonly service = inject(GranteeService);
  protected readonly statuses: GrantStatus[] = ['Draft', 'In Review', 'Approved', 'Rejected'];
  protected readonly status = signal<GrantStatus | ''>('');
  protected readonly rows = computed(() => {
    const s = this.status();
    return this.service.applications().filter(g => !s || g.status === s);
  });
}

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GrantCall, GrantCallApi } from '../../../core/grant-call.api';

/** The granter's calls for proposals (GrantCall in the API), with the entry point to create a new one. */
@Component({
  selector: 'gm-grant-calls',
  imports: [CurrencyPipe, DatePipe, TitleCasePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Funder</span>
          <h1>Calls for proposals</h1>
          <p>Calls for proposals you’ve drafted or published.</p>
        </div>
        <a mat-flat-button routerLink="/grant-calls/new"><mat-icon>add</mat-icon> New call for proposals</a>
      </header>

      @if (created(); as c) {
        <div class="auth-alert success" role="status"><mat-icon>check_circle</mat-icon>
          {{ c === 'published' ? 'Call for proposals published — grantees can now see it.' : 'Draft saved.' }}</div>
      }

      @if (loading()) {
        <div class="loading-state"><mat-spinner diameter="32" /></div>
      } @else if (error()) {
        <div class="surface-card empty-state">
          <span class="empty-icon error"><mat-icon>cloud_off</mat-icon></span>
          <h2>Couldn’t load your calls for proposals</h2>
          <p>The grant service didn’t respond. Check your connection and try again.</p>
          <div class="empty-actions"><button mat-stroked-button (click)="load()"><mat-icon>refresh</mat-icon> Try again</button></div>
        </div>
      } @else {
        <div class="grid">
          @for (c of calls(); track c.id) {
            <a class="surface-card call" [routerLink]="['/grant-calls', c.id]">
              <div class="top">
                <span class="label-mono">{{ c.theme || 'General' }}{{ c.callCode ? ' · ' + c.callCode : '' }}</span>
                <span class="state" [class.open]="c.state === 'OPEN'">{{ c.state === 'OPEN' ? 'Open' : (c.state || 'Draft') | titlecase }}</span>
              </div>
              <h2>{{ c.title || 'Untitled call' }}</h2>
              <dl>
                <div><dt class="label-mono">Envelope</dt><dd>{{ c.envelopeAmountMinor / 100 | currency: 'INR' : 'symbol' : '1.0-0' : 'en-IN' }}</dd></div>
                <div><dt class="label-mono">Closes</dt><dd>{{ c.closesAt ? (c.closesAt | date: 'mediumDate') : '—' }}</dd></div>
              </dl>
            </a>
          } @empty {
            <div class="surface-card empty-state">
              <span class="empty-icon"><mat-icon>campaign</mat-icon></span>
              <h2>No calls for proposals yet</h2>
              <p>Publish a call to invite grantees to apply. You can save it as a draft first.</p>
              <div class="empty-actions"><a mat-flat-button routerLink="/grant-calls/new"><mat-icon>add</mat-icon> New call for proposals</a></div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .grid { display: grid; gap: var(--gm-section-gap); grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .call { color: inherit; text-decoration: none; transition: border-color .15s, transform .15s;
      &:hover { border-color: var(--mat-sys-primary); transform: translateY(-1px); } }
    .call { display: flex; flex-direction: column; gap: var(--gm-space-2); padding: var(--gm-card-pad); }
    .top { display: flex; justify-content: space-between; align-items: center; gap: var(--gm-space-2); }
    .state { font: var(--mat-sys-label-medium); padding: 2px 10px; border-radius: 999px;
      color: var(--gm-status-draft); background: var(--gm-status-draft-bg); }
    .state.open { color: var(--gm-status-approved); background: var(--gm-status-approved-bg); }
    h2 { font: var(--mat-sys-title-medium); margin: 0; }
    dl { display: flex; gap: var(--gm-space-5); margin: var(--gm-space-2) 0 0; }
    dd { margin: 2px 0 0; font-family: var(--gm-font-mono); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrantCalls {
  private readonly api = inject(GrantCallApi);
  /** Bound from ?created=published|draft after saving the form. */
  readonly created = input<string>();

  protected readonly calls = signal<GrantCall[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  constructor() { this.load(); }

  protected load() {
    this.loading.set(true);
    this.error.set(false);
    this.api.list().subscribe({
      next: calls => { this.calls.set(calls.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }
}

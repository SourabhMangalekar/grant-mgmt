import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GrantCall, GrantCallApi, isPublished } from '../../../core/grant-call.api';
import { ReceivedApplicationsService } from '../../../core/received-applications';

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
          <p>Calls for proposals you’ve drafted or published, and the applications each one has received.</p>
        </div>
        <a mat-flat-button routerLink="/grant-calls/new"><mat-icon>add</mat-icon> New call for proposals</a>
      </header>

      @if (created(); as c) {
        <div class="auth-alert success" role="status"><mat-icon>check_circle</mat-icon>
          {{ c === 'published' ? 'Call for proposals published — grantees can now see it.' : 'Draft saved.' }}</div>
      }

      @if (loading()) {
        <div class="loading-state"><mat-spinner diameter="32" aria-label="Loading calls for proposals" /></div>
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
            <article class="surface-card call">
              <div class="top">
                <span class="label-mono">{{ c.theme || 'General' }}{{ c.callCode ? ' · ' + c.callCode : '' }}</span>
                <span class="state" [class.open]="published(c.state)">{{ published(c.state) ? 'Published' : (c.state || 'Draft') | titlecase }}</span>
              </div>
              <h2><a class="call-link" [routerLink]="['/grant-calls', c.id]">{{ c.title || 'Untitled call' }}</a></h2>
              <dl>
                <div><dt class="label-mono">Envelope</dt><dd>{{ c.envelopeAmountMinor / 100 | currency: 'INR' : 'symbol' : '1.0-0' : 'en-IN' }}</dd></div>
                <div><dt class="label-mono">Closes</dt><dd>{{ c.closesAt ? (c.closesAt | date: 'mediumDate') : '—' }}</dd></div>
              </dl>

              @if (counts(); as m) {
                @let n = m.get(c.id!) ?? 0;
                <a class="received" [class.none]="!n" [routerLink]="['/grant-calls', c.id, 'applications']">
                  <mat-icon>{{ n ? 'inbox' : 'mark_email_unread' }}</mat-icon>
                  <span class="received-text">
                    @if (n) { <strong>{{ n }}</strong> application{{ n === 1 ? '' : 's' }} received } @else { No applications yet }
                    <span class="vh"> for {{ c.title || 'Untitled call' }}</span>
                  </span>
                  <mat-icon class="go">chevron_right</mat-icon>
                </a>
              } @else if (countsLoading()) {
                <div class="received pending" aria-hidden="true"><span class="skeleton"></span></div>
              }
            </article>
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
    .grid { display: grid; gap: var(--gm-section-gap); grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); }
    .call { position: relative; transition: border-color .15s, transform .15s;
      &:hover { border-color: var(--mat-sys-primary); transform: translateY(-1px); } }
    .call { display: flex; flex-direction: column; gap: var(--gm-space-2); padding: var(--gm-card-pad); min-width: 0; }
    @media (prefers-reduced-motion: reduce) { .call, .call:hover { transition: none; transform: none; } }
    .top { display: flex; justify-content: space-between; align-items: center; gap: var(--gm-space-2); }
    .state { font: var(--mat-sys-label-medium); padding: 2px 10px; border-radius: 999px;
      color: var(--gm-status-draft); background: var(--gm-status-draft-bg); }
    .state.open { color: var(--gm-status-approved); background: var(--gm-status-approved-bg); }
    h2 { font: var(--mat-sys-title-medium); margin: 0; overflow-wrap: anywhere; }
    /* The title link covers the whole card (stretched link), so the card stays one big click target. */
    .call-link { color: inherit; text-decoration: none;
      &::after { content: ''; position: absolute; inset: 0; border-radius: var(--gm-radius-lg); }
      &:focus-visible { outline: none; }
      &:focus-visible::after { outline: 2px solid var(--mat-sys-primary); outline-offset: 2px; } }
    dl { display: flex; gap: var(--gm-space-5); margin: var(--gm-space-2) 0 0; }
    dd { margin: 2px 0 0; font-family: var(--gm-font-mono); }

    /* Footer: how many applications the call received. Sits above the stretched link so it's its own target. */
    .received {
      position: relative; z-index: 1;
      display: flex; align-items: center; gap: var(--gm-space-2); min-height: 44px;
      margin: auto calc(-1 * var(--gm-card-pad)) calc(-1 * var(--gm-card-pad));
      padding: var(--gm-space-2) var(--gm-card-pad);
      border-top: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0 0 calc(var(--gm-radius-lg) - 1px) calc(var(--gm-radius-lg) - 1px);
      color: var(--mat-sys-primary); text-decoration: none; font: var(--mat-sys-label-large);
      mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }
      strong { font-family: var(--gm-font-mono); font-variant-numeric: tabular-nums; }
      .go { margin-left: auto; }
      &.none { color: var(--mat-sys-on-surface-variant); }
      &:not(.pending):hover { background: var(--mat-sys-surface-container); }
      &:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: -2px; }
    }
    .received-text { min-width: 0; }
    .pending { pointer-events: none; }
    .skeleton { width: 150px; max-width: 70%; height: 12px; border-radius: 999px; background: var(--mat-sys-surface-container-high);
      animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .5; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
    .vh { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrantCalls {
  private readonly api = inject(GrantCallApi);
  private readonly received = inject(ReceivedApplicationsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly published = isPublished;
  /** Bound from ?created=published|draft after saving the form. */
  readonly created = input<string>();

  protected readonly calls = signal<GrantCall[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  /** Applications received per call id; null while counting or if the count failed (the card footers then stay hidden). */
  protected readonly counts = signal<ReadonlyMap<number, number> | null>(null);
  protected readonly countsLoading = signal(false);

  constructor() { this.load(); }

  protected load() {
    this.loading.set(true);
    this.error.set(false);
    this.counts.set(null);
    this.api.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: calls => {
        const sorted = [...calls].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
        this.calls.set(sorted);
        this.loading.set(false);
        this.loadCounts(sorted);
      },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }

  /** Best effort: the calls are already on screen, so a failure here only hides the footers. */
  private loadCounts(calls: GrantCall[]) {
    this.countsLoading.set(true);
    this.received.forCalls(calls).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: apps => {
        const counts = new Map<number, number>();
        for (const a of apps) counts.set(a.grantCallId, (counts.get(a.grantCallId) ?? 0) + 1);
        this.counts.set(counts);
        this.countsLoading.set(false);
      },
      error: () => this.countsLoading.set(false),
    });
  }
}

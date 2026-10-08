import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { GranteeService } from '../../../core/grantee.service';

/** Calls for proposals the grantee can apply to. */
@Component({
  selector: 'gm-open-calls',
  imports: [CurrencyPipe, DatePipe, RouterLink, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Grantee</span>
          <h1>Open calls</h1>
          <p>{{ rows().length }} call{{ rows().length === 1 ? '' : 's' }} accepting proposals</p>
        </div>
      </header>

      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Search</mat-label>
        <input matInput #searchInput type="search" enterkeyhint="search" autocomplete="off" spellcheck="false"
               aria-label="Search open calls" placeholder="Title, theme or call code…"
               [value]="query()" (input)="query.set(searchInput.value)">
        @if (query()) {
          <button mat-icon-button matSuffix type="button" aria-label="Clear search"
                  (click)="query.set(''); searchInput.focus()">
            <mat-icon>close</mat-icon>
          </button>
        }
      </mat-form-field>

      @if (service.loading()) {
        <div class="loading-state"><mat-spinner diameter="32" /></div>
      } @else if (service.error()) {
        <div class="surface-card empty-state">
          <span class="empty-icon error"><mat-icon>cloud_off</mat-icon></span>
          <h2>Couldn’t load open calls</h2>
          <p>The grant service didn’t respond. Check your connection and try again.</p>
          <div class="empty-actions"><button mat-stroked-button (click)="service.load()"><mat-icon>refresh</mat-icon> Try again</button></div>
        </div>
      } @else {
      <div class="grid">
        @for (c of rows(); track c.id) {
          <a class="surface-card call" [routerLink]="['/calls', c.id]">
            <span class="label-mono">{{ c.program }}{{ c.code ? ' · ' + c.code : '' }}</span>
            <h2>{{ c.title }}</h2>
            <dl>
              <div><dt class="label-mono">Up to</dt><dd>{{ c.maxAmount | currency: 'INR' : 'symbol' : '1.0-0' : 'en-IN' }}</dd></div>
              <div><dt class="label-mono">Deadline</dt><dd>{{ c.deadline | date: 'mediumDate' }}</dd></div>
            </dl>
            <span class="cta"><mat-icon>edit_document</mat-icon> View &amp; apply</span>
          </a>
        } @empty {
          <div class="surface-card empty-state">
            <span class="empty-icon"><mat-icon>search_off</mat-icon></span>
            <h2>No calls match your search</h2>
            <p>{{ query() ? 'Try a different title, theme or call code.' : 'No funder has an open call right now. Check back soon.' }}</p>
          </div>
        }
      </div>
      }
    </div>
  `,
  styles: `
    .search { width: 100%; max-width: 420px; margin-bottom: var(--gm-section-gap); }
    .grid { display: grid; gap: var(--gm-section-gap); grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .call { display: flex; flex-direction: column; gap: var(--gm-space-1); padding: var(--gm-card-pad); }
    h2 { font: var(--mat-sys-title-medium); margin: var(--gm-space-1) 0 0; }
    dl { display: flex; gap: var(--gm-space-5); margin: var(--gm-space-3) 0 var(--gm-space-4); }
    dd { margin: 2px 0 0; font-family: var(--gm-font-mono); }
    .call { color: inherit; text-decoration: none; transition: border-color .15s, transform .15s;
      &:hover { border-color: var(--mat-sys-primary); transform: translateY(-1px); } }
    .cta { display: inline-flex; align-items: center; gap: var(--gm-space-1); margin-top: auto;
      color: var(--mat-sys-primary); font: var(--mat-sys-label-large);
      mat-icon { font-size: 18px; width: 18px; height: 18px; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenCalls {
  protected readonly service = inject(GranteeService);

  constructor() { this.service.load(); }
  protected readonly query = signal('');
  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.service.calls().filter(c => !q || `${c.title} ${c.code} ${c.program}`.toLowerCase().includes(q));
  });
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { GranteeService } from '../../../core/grantee.service';

/** Calls for proposals the grantee can apply to. */
@Component({
  selector: 'gm-open-calls',
  imports: [CurrencyPipe, DatePipe, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule],
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
        <input matInput [value]="query()" (input)="query.set($any($event.target).value)" placeholder="Title, funder, program…">
      </mat-form-field>

      <div class="grid">
        @for (c of rows(); track c.id) {
          <article class="surface-card call">
            <span class="label-mono">{{ c.program }} · {{ c.id }}</span>
            <h2>{{ c.title }}</h2>
            <span class="muted">by {{ c.funder }}</span>
            <dl>
              <div><dt class="label-mono">Up to</dt><dd>{{ c.maxAmount | currency: 'INR' : 'symbol' : '1.0-0' : 'en-IN' }}</dd></div>
              <div><dt class="label-mono">Deadline</dt><dd>{{ c.deadline | date: 'mediumDate' }}</dd></div>
            </dl>
            <button mat-stroked-button type="button"><mat-icon>edit_document</mat-icon> Start application</button>
          </article>
        } @empty {
          <div class="surface-card empty-state">
            <span class="empty-icon"><mat-icon>search_off</mat-icon></span>
            <h2>No calls match your search</h2>
            <p>Try a different title, funder or programme.</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .search { width: 100%; max-width: 420px; margin-bottom: var(--gm-section-gap); }
    .grid { display: grid; gap: var(--gm-section-gap); grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .call { display: flex; flex-direction: column; gap: var(--gm-space-1); padding: var(--gm-card-pad); }
    h2 { font: var(--mat-sys-title-medium); margin: var(--gm-space-1) 0 0; }
    dl { display: flex; gap: var(--gm-space-5); margin: var(--gm-space-3) 0 var(--gm-space-4); }
    dd { margin: 2px 0 0; font-family: var(--gm-font-mono); }
    button { align-self: flex-start; margin-top: auto; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenCalls {
  private readonly service = inject(GranteeService);
  protected readonly query = signal('');
  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.service.calls().filter(c => !q || `${c.title} ${c.funder} ${c.program}`.toLowerCase().includes(q));
  });
}

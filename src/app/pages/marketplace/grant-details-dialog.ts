import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MarketplaceGrant, amountRange, daysLeftLabel, eligibilityOf, funderLabel, stateName,
} from '../../core/marketplace';

/** What a grant's main button does (see Marketplace.cta). */
export type Cta =
  | { kind: 'external'; href: string }           // apply on the funder's own website
  | { kind: 'sign-in'; returnUrl: string }       // ours, signed out: sign in, then on to the proposal form
  | { kind: 'apply'; link: (string | number)[] } // ours, signed-in grantee: straight to the proposal form
  | { kind: 'open-calls' }                       // ours, signed-in grantee, but the card has no call id
  | { kind: 'funder' }                           // ours, signed in as a funder: can't apply
  | { kind: 'none' };

export interface GrantDetailsData { grant: MarketplaceGrant; cta: Cta }

/** Everything about one marketplace grant, with the same apply button as its card. */
@Component({
  selector: 'gm-grant-details-dialog',
  imports: [DatePipe, RouterLink, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    @let g = data.grant;
    <h2 mat-dialog-title>{{ g.title }}</h2>
    <mat-dialog-content>
      <p class="badges">
        @if (g.origin !== 'EXTERNAL') {
          <span class="badge easy"><mat-icon>bolt</mat-icon> Easy apply on Commons.Grants</span>
        } @else {
          <span class="badge ext"><mat-icon>public</mat-icon> From {{ g.sourceName || 'another website' }}</span>
        }
        @if (g.isNew) { <span class="badge new">New</span> }
        @if (g.matchScore != null) { <span class="badge match">{{ g.matchScore }}% match</span> }
      </p>

      <dl class="facts">
        <div><dt>Funder</dt><dd>{{ funder }}</dd></div>
        <div><dt>Grant size</dt><dd>{{ amount ?? 'Not stated' }}</dd></div>
        <div>
          <dt>Deadline</dt>
          <dd>
            @if (g.closesAt) { {{ g.closesAt | date: 'd MMM y' }} }
            @else { Not stated }
            @if (daysLeft) { <span class="muted" [class.soon]="g.closingSoon">· {{ daysLeft }}</span> }
          </dd>
        </div>
        @if (g.theme) { <div><dt>Theme</dt><dd>{{ g.theme }}</dd></div> }
        @if (states.length) { <div><dt>Where</dt><dd>{{ states.join(', ') }}</dd></div> }
      </dl>

      @if (g.summary) {
        <h3>About this grant</h3>
        <p class="summary">{{ g.summary }}</p>
      }

      <h3>Who can apply</h3>
      @if (eligibility.tags.length) {
        <ul class="tags">@for (t of eligibility.tags; track t) { <li><mat-icon>check_circle</mat-icon>{{ t }}</li> }</ul>
      } @else if (eligibility.text) {
        <p class="summary">{{ eligibility.text }}</p>
      } @else {
        <p class="muted">The funder hasn’t set specific requirements.</p>
      }

      @if (g.origin === 'EXTERNAL' && g.sourceUrl) {
        <p class="source muted">
          Listed on <a [href]="g.sourceUrl" target="_blank" rel="noopener noreferrer">{{ g.sourceName || 'the source website' }}<span class="visually-hidden"> (opens in a new tab)</span></a>.
          Check the details there before applying.
        </p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Close</button>
      @let cta = data.cta;
      @if (cta.kind === 'external') {
        <a mat-flat-button [href]="cta.href" target="_blank" rel="noopener noreferrer">
          Apply on funder’s site <mat-icon iconPositionEnd>open_in_new</mat-icon><span class="visually-hidden"> (opens in a new tab)</span>
        </a>
      } @else if (cta.kind === 'sign-in') {
        <a mat-flat-button routerLink="/auth/login" [queryParams]="{ returnUrl: cta.returnUrl }" mat-dialog-close>
          <mat-icon>bolt</mat-icon> Sign in to apply
        </a>
      } @else if (cta.kind === 'apply') {
        <a mat-flat-button [routerLink]="cta.link" mat-dialog-close><mat-icon>bolt</mat-icon> Easy apply</a>
      } @else if (cta.kind === 'open-calls') {
        <a mat-flat-button routerLink="/calls" mat-dialog-close><mat-icon>bolt</mat-icon> Apply from Open calls</a>
      } @else if (cta.kind === 'funder') {
        <span class="muted note">Sign in with a grantee account to apply.</span>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .badges { display: flex; flex-wrap: wrap; gap: var(--gm-space-2); margin: 0 0 var(--gm-space-4); }
    .badge {
      display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; font: var(--mat-sys-label-medium);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .easy { color: var(--mat-sys-on-primary-container); background: var(--mat-sys-primary-container); }
    .ext { color: var(--mat-sys-on-surface-variant); background: var(--mat-sys-surface-container-highest); }
    .new { color: var(--gm-status-screening); background: var(--gm-status-screening-bg); }
    .match { color: var(--gm-status-approved); background: var(--gm-status-approved-bg); }
    .facts {
      display: grid; gap: var(--gm-space-3) var(--gm-space-5); margin: 0 0 var(--gm-space-4);
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      dt { font-family: var(--gm-font-mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--mat-sys-on-surface-variant); }
      dd { margin: 4px 0 0; font: var(--mat-sys-body-large); }
    }
    h3 { margin: var(--gm-space-4) 0 var(--gm-space-2); font: var(--mat-sys-title-small); }
    .summary { margin: 0; line-height: 1.6; white-space: pre-line; }
    .tags {
      list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--gm-space-2);
      li { display: flex; align-items: center; gap: var(--gm-space-2); }
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--gm-status-approved); }
    }
    .soon { color: var(--gm-status-review); font-weight: 600; }
    .source { margin: var(--gm-space-4) 0 0; a { color: var(--mat-sys-primary); } }
    .note { padding: 0 var(--gm-space-2); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrantDetailsDialog {
  protected readonly data = inject<GrantDetailsData>(MAT_DIALOG_DATA);
  protected readonly funder = funderLabel(this.data.grant);
  protected readonly amount = amountRange(this.data.grant);
  protected readonly daysLeft = daysLeftLabel(this.data.grant);
  protected readonly states = (this.data.grant.states ?? []).map(stateName);
  protected readonly eligibility = eligibilityOf(this.data.grant.eligibilityText);
}

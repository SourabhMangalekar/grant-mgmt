import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthStore } from './core/auth/auth.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    @if (auth.restoreFailed()) {
      <main class="offline">
        <section class="surface-card empty-state" role="alert">
          <span class="empty-icon error"><mat-icon>cloud_off</mat-icon></span>
          <h2>Can’t reach Commons.Grants</h2>
          <p>We couldn’t check your sign-in with the server. You’re still signed in, so try again in a moment.</p>
          <div class="empty-actions">
            <button mat-flat-button type="button" (click)="retry()" [disabled]="retrying()">
              @if (retrying()) { <mat-spinner diameter="18" aria-label="Checking your sign-in" /> }
              @else { <ng-container><mat-icon>refresh</mat-icon> Try again</ng-container> }
            </button>
            <button mat-button type="button" (click)="auth.logout()">Sign out</button>
          </div>
        </section>
      </main>
    } @else {
      <router-outlet />
    }
  `,
  styles: `
    .offline { min-height: 100dvh; display: grid; place-items: center; padding: var(--gm-space-4); }
    .offline .empty-state { max-width: 480px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(AuthStore);
  protected readonly retrying = signal(false);

  protected async retry() {
    this.retrying.set(true);
    // On success the navigation waiting in the guards carries on to the page in the address bar.
    try { await this.auth.restore(); } finally { this.retrying.set(false); }
  }
}

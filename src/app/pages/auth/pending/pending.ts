import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthStore } from '../../../core/auth/auth.store';
import { authErrorMessage } from '../auth-shared';

/** Shown to a user who joined an existing organisation until its admin approves them (IAM user-verification). */
@Component({
  selector: 'gm-pending',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <section class="auth-card">
      <h1>Waiting for approval</h1>
      @if (auth.user(); as u) {
        <p class="lede">You’ve asked to join <b>{{ u.tenantName }}</b>. An admin of that organisation needs to approve you before you can continue.</p>
        <p class="lede">You’ll sign in with organisation ID <b>{{ u.tenantLogin }}</b> and username <b>{{ u.userLogin }}</b>.</p>
      }
      @if (message(); as m) { <div class="auth-alert info" role="status"><mat-icon>info</mat-icon> {{ m }}</div> }
      <div class="auth-form">
        <button mat-flat-button class="submit" (click)="check()" [disabled]="loading()">
          @if (loading()) { <mat-spinner diameter="20" /> } @else { Check again }
        </button>
        <button mat-button (click)="auth.logout()"><mat-icon>logout</mat-icon> Sign out</button>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Pending {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly loading = signal(false);
  protected readonly message = signal<string | null>(null);

  protected check() {
    this.loading.set(true);
    this.auth.refresh().subscribe({
      next: u => {
        this.loading.set(false);
        if (u.approved) this.router.navigateByUrl('/dashboard');
        else this.message.set('Still waiting — your admin hasn’t approved you yet.');
      },
      error: err => { this.loading.set(false); this.message.set(authErrorMessage(err)); },
    });
  }
}

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthApi } from '../../../core/auth/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { TenantRef } from '../../../core/auth/auth.models';
import { APP_CONFIG } from '../../../core/config';
import { authErrorMessage } from '../auth-shared';

/**
 * Two-step sign-in:
 * 1. Email / mobile / username → "Next" looks up the organisations it belongs to (GET /signup/exists).
 * 2. Pick the organisation (or type its ID when none were found, e.g. a plain username) + password → sign in.
 */
@Component({
  selector: 'gm-login',
  imports: [ReactiveFormsModule, RouterLink, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule,
    MatIconModule, MatProgressSpinnerModule],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly api = inject(AuthApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  /** Bound from ?returnUrl= */
  readonly returnUrl = input<string>();
  /** Bound from ?reset=1 after a successful password reset */
  readonly reset = input<string>();

  protected readonly demo = APP_CONFIG.mockApi;
  protected readonly step = signal<1 | 2>(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  /** Organisations found for the login; empty means the user types the org ID. */
  protected readonly tenants = signal<TenantRef[]>([]);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    userLogin: ['', Validators.required],
    tenantLogin: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected next() {
    const { userLogin } = this.form.controls;
    if (userLogin.invalid) { userLogin.markAsTouched(); return; }
    this.loading.set(true);
    this.error.set(null);
    this.api.tenantsForLogin(userLogin.value).subscribe({
      next: tenants => this.toStep2(tenants),
      // Lookup is only a convenience — fall back to typing the org ID.
      error: () => this.toStep2([]),
    });
  }

  protected back() {
    this.step.set(1);
    this.error.set(null);
    this.form.controls.password.reset();
  }

  protected submit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    this.auth.login({ ...v, tenantLogin: v.tenantLogin.trim().toLowerCase(), userLogin: v.userLogin.trim() }).subscribe({
      next: u => this.router.navigateByUrl(u.approved ? this.returnUrl() || '/dashboard' : '/pending'),
      error: err => { this.error.set(authErrorMessage(err)); this.loading.set(false); },
    });
  }

  private toStep2(tenants: TenantRef[]) {
    this.loading.set(false);
    this.tenants.set(tenants);
    // Preselect when there's only one organisation; otherwise make the user choose.
    this.form.controls.tenantLogin.setValue(tenants.length === 1 ? tenants[0].login : '');
    this.form.controls.tenantLogin.markAsUntouched();
    this.step.set(2);
  }
}

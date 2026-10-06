import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthApi } from '../../../core/auth/auth.api';
import { APP_CONFIG } from '../../../core/config';
import { PASSWORD_HINT, authErrorMessage, passwordsMatch, strongPassword } from '../auth-shared';

/**
 * PATCH /api/v1/security/forget → OTP key; PATCH /api/v1/security/reset with OTP + new password.
 * A successful reset also unlocks an account locked by failed attempts.
 */
@Component({
  selector: 'gm-forgot-password',
  imports: [ReactiveFormsModule, RouterLink, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './forgot-password.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPassword {
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly demo = APP_CONFIG.mockApi;
  protected readonly hint = PASSWORD_HINT;
  protected readonly step = signal<1 | 2>(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  private otpKey = '';

  protected readonly who = this.fb.group({
    tenantLogin: ['', Validators.required],
    userLogin: ['', Validators.required],
  });

  protected readonly reset = this.fb.group({
    otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    password: ['', [Validators.required, strongPassword]],
    confirm: ['', Validators.required],
  }, { validators: passwordsMatch });

  protected sendCode() {
    if (this.who.invalid) { this.who.markAllAsTouched(); return; }
    this.run(this.api.forgotPassword(this.identity()), key => { this.otpKey = key; this.step.set(2); });
  }

  protected submit() {
    if (this.reset.invalid) { this.reset.markAllAsTouched(); return; }
    const { otp, password } = this.reset.getRawValue();
    this.run(
      this.api.resetPassword({ ...this.identity(), otpKey: this.otpKey, otp, password }),
      () => this.router.navigate(['/auth/login'], { queryParams: { reset: 1 } }),
    );
  }

  protected back() { this.step.set(1); this.error.set(null); }

  private identity() {
    const v = this.who.getRawValue();
    return { tenantLogin: v.tenantLogin.trim().toLowerCase(), userLogin: v.userLogin.trim() };
  }

  private run<T>(obs: Observable<T>, done: (v: T) => void) {
    this.loading.set(true);
    this.error.set(null);
    obs.subscribe({
      next: v => { this.loading.set(false); done(v); },
      error: err => { this.loading.set(false); this.error.set(authErrorMessage(err)); },
    });
  }
}

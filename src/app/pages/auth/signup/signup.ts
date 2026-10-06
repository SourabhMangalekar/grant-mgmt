import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, catchError, debounceTime, distinctUntilChanged, filter, of, shareReplay, switchMap, tap } from 'rxjs';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthApi } from '../../../core/auth/auth.api';
import { AuthStore, affiliationOf } from '../../../core/auth/auth.store';
import { OtpResponse, SignUpRequest, Tenant } from '../../../core/auth/auth.models';
import { APP_CONFIG, Affiliation } from '../../../core/config';
import { PASSWORD_HINT, authErrorMessage, passwordsMatch, slugify, strongPassword } from '../auth-shared';

/** Result of looking up the typed organisation ID. */
type OrgLookup =
  | { state: 'idle' | 'checking' | 'error' }
  | { state: 'new' }
  | { state: 'existing'; tenant: Tenant }
  | { state: 'wrong-type'; tenant: Tenant };

/** tenantLogin charset: IAM generates underscores, older tenants use dashes/dots (e.g. grant-org-01). */
const ORG_ID = /^[a-z0-9_.-]{3,64}$/;

/**
 * Signup as a Granter or Grantee, per commons-iam-service:
 * - New organisation:  POST /signup/register → POST /signup/tenant (user = org admin) → PATCH /tenants (tenantType)
 * - Existing org:      POST /signup/register/user → POST /signup/user/{org}/activate → POST /user-verification/not-reviewed
 *                      (the joiner waits for their org admin's approval)
 * The organisation is matched by exact org ID (GET /tenants/login); IAM has no tenant search.
 */
@Component({
  selector: 'gm-signup',
  imports: [ReactiveFormsModule, RouterLink, MatFormFieldModule, MatInputModule, MatButtonModule, MatButtonToggleModule,
    MatIconModule, MatProgressSpinnerModule],
  templateUrl: './signup.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Signup {
  private readonly api = inject(AuthApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly demo = APP_CONFIG.mockApi;
  protected readonly hint = PASSWORD_HINT;
  protected readonly step = signal<1 | 2>(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly affiliation = signal<Affiliation>('granter');
  protected readonly lookup = signal<OrgLookup>({ state: 'idle' });
  protected readonly joining = computed(() => this.lookup().state === 'existing');

  /** One anonymous app session for all pre-login calls (null if IAM won't issue one). */
  private readonly preSession$ = this.api.appSession().pipe(shareReplay(1));
  private preSession: string | null = null;
  private otp: OtpResponse = { key: '' };

  protected readonly details = this.fb.group({
    organisationName: ['', Validators.required],
    tenantLogin: ['', [Validators.required, Validators.pattern(ORG_ID)]],
    firstName: ['', Validators.required],
    lastName: [''],
    email: ['', [Validators.required, Validators.email]],
    mobile: ['', Validators.pattern(/^[0-9]{10}$/)],
  });

  protected readonly verify = this.fb.group({
    otp: ['', [Validators.required, Validators.pattern(/^\d{4,6}$/)]],
    password: ['', [Validators.required, strongPassword]],
    confirm: ['', Validators.required],
  }, { validators: passwordsMatch });

  constructor() {
    const destroy = inject(DestroyRef);
    const { organisationName, tenantLogin } = this.details.controls;

    // Suggest an org ID from the name until the user edits it themselves.
    organisationName.valueChanges.pipe(takeUntilDestroyed(destroy)).subscribe(name => {
      if (!tenantLogin.dirty) tenantLogin.setValue(slugify(name));
    });

    // Exact lookup of the org ID: free → create a new org; taken → join it (if its type matches the tab).
    tenantLogin.valueChanges.pipe(
      tap(() => this.lookup.set({ state: 'idle' })),
      debounceTime(400),
      distinctUntilChanged(),
      filter(id => ORG_ID.test(id)),
      tap(() => this.lookup.set({ state: 'checking' })),
      switchMap(id => this.preSession$.pipe(
        tap(s => this.preSession = s),
        switchMap(s => this.api.findTenant(id, s)),
        catchError(() => of(undefined)),
      )),
      takeUntilDestroyed(destroy),
    ).subscribe(tenant => this.lookup.set(this.classify(tenant)));
  }

  protected setAffiliation(a: Affiliation) {
    this.affiliation.set(a);
    const l = this.lookup();
    if (l.state === 'existing' || l.state === 'wrong-type') this.lookup.set(this.classify(l.tenant));
  }

  protected sendCode() {
    const l = this.lookup();
    if (this.details.invalid || (l.state !== 'new' && l.state !== 'existing')) {
      this.details.markAllAsTouched();
      if (l.state === 'idle' || l.state === 'checking') this.error.set('Wait for the organisation ID check to finish.');
      return;
    }
    const d = this.details.getRawValue();
    const lead = {
      id: 0 as const, appContext: APP_CONFIG.appCode,
      type: this.joining() ? APP_CONFIG.userLeadType : APP_CONFIG.orgLeadType,
      firstName: d.firstName, lastName: d.lastName || undefined,
      leadContactPersonName: `${d.firstName} ${d.lastName}`.trim(),
      email: d.email, mobile: d.mobile || undefined,
      organizationName: l.state === 'existing' ? l.tenant.tenantName : d.organisationName,
      useMobileAsUserLogin: false,
    };
    const register$ = this.joining()
      ? this.api.registerUser(lead, this.preSession)
      : this.api.registerOrganisation(lead, this.preSession);
    this.run(register$, res => {
      this.otp = res;
      this.step.set(2);
      this.notice.set(`We sent a verification code to ${d.email}.`);
    });
  }

  protected resend() {
    this.run(this.api.resendSignupOtp(this.otp.key, this.preSession), res => {
      if (res) this.otp = { ...this.otp, ...res, key: res.key || this.otp.key };
      this.notice.set('A new code is on its way.');
    });
  }

  protected createAccount() {
    if (this.verify.invalid) { this.verify.markAllAsTouched(); return; }
    const d = this.details.getRawValue();
    const { otp, password } = this.verify.getRawValue();
    const req: SignUpRequest = {
      key: this.otp.key, otp, otpForEmail: otp,
      messageId: this.otp.messageId ?? this.otp.messageIdForEmail,
      messageIdForEmail: this.otp.messageIdForEmail ?? this.otp.messageId,
      email: d.email, mobile: d.mobile || undefined, useMobileAsUserLogin: false,
    };
    const l = this.lookup();
    const done$ = l.state === 'existing'
      ? this.auth.joinOrganisation(l.tenant.tenantLogin, req, password, this.preSession)
      : this.auth.createOrganisation(req, password, this.affiliation(), this.preSession);
    this.run(done$, u => this.router.navigateByUrl(u.approved ? '/dashboard' : '/pending'));
  }

  protected back() {
    this.step.set(1);
    this.error.set(null);
    this.notice.set(null);
  }

  private classify(tenant: Tenant | null | undefined): OrgLookup {
    if (tenant === undefined) return { state: 'error' };
    if (tenant === null) return { state: 'new' };
    // The pre-login lookup (GET /tenants/login) doesn't return tenantType, so only block on a known mismatch;
    // otherwise the org admin's approval is the check.
    const type = affiliationOf(tenant);
    return !tenant.tenantType || type === this.affiliation() ? { state: 'existing', tenant } : { state: 'wrong-type', tenant };
  }

  private run<T>(obs: Observable<T>, done: (v: T) => void) {
    this.loading.set(true);
    this.error.set(null);
    obs.subscribe({
      next: v => { this.loading.set(false); done(v); },
      error: err => { this.loading.set(false); this.notice.set(null); this.error.set(authErrorMessage(err)); },
    });
  }
}

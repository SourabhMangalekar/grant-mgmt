import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { GranteeService } from '../../../core/grantee.service';
import { AuthStore } from '../../../core/auth/auth.store';
import { StatusChip } from '../../../core/status-chip';

/** Grantee landing page: where my applications stand, and calls closing soon. */
@Component({
  selector: 'gm-grantee-home',
  imports: [CurrencyPipe, DatePipe, RouterLink, MatIconModule, MatButtonModule, StatusChip],
  templateUrl: './grantee-home.html',
  styleUrl: '../../dashboard/dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GranteeHome {
  private readonly service = inject(GranteeService);
  private readonly auth = inject(AuthStore);
  protected readonly org = computed(() => this.auth.user()?.tenantName ?? 'your organisation');
  protected readonly stats = this.service.stats;
  protected readonly recent = computed(() =>
    [...this.service.applications()].sort((a, b) => b.submittedOn.localeCompare(a.submittedOn)).slice(0, 3));
  protected readonly closingSoon = computed(() =>
    [...this.service.calls()].sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 3));
}

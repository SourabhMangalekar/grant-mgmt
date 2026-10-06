import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { GrantService } from '../../core/grant.service';
import { StatusChip } from '../../core/status-chip';

@Component({
  selector: 'gm-dashboard',
  imports: [CurrencyPipe, DatePipe, RouterLink, MatIconModule, MatButtonModule, StatusChip],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly service = inject(GrantService);
  protected readonly stats = this.service.stats;
  protected readonly recent = computed(() =>
    [...this.service.grants()].sort((a, b) => b.submittedOn.localeCompare(a.submittedOn)).slice(0, 5));
}

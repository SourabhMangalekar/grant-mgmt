import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { GrantService } from '../../core/grant.service';
import { GrantStatus } from '../../core/grant.model';
import { StatusChip } from '../../core/status-chip';

@Component({
  selector: 'gm-grants',
  imports: [CurrencyPipe, DatePipe, MatTableModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, StatusChip],
  templateUrl: './grants.html',
  styleUrl: './grants.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Grants {
  private readonly service = inject(GrantService);

  protected readonly statuses: GrantStatus[] = ['Draft', 'In Review', 'Approved', 'Rejected', 'Closed'];
  protected readonly columns = ['id', 'title', 'program', 'amount', 'submittedOn', 'status'];
  protected readonly query = signal('');
  protected readonly status = signal<GrantStatus | ''>('');

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const s = this.status();
    return this.service.grants().filter(g =>
      (!s || g.status === s) &&
      (!q || `${g.id} ${g.title} ${g.applicant} ${g.program}`.toLowerCase().includes(q)));
  });
}

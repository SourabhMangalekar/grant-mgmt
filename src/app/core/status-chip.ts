import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GrantStatus } from './grant.model';

const CLASS: Record<GrantStatus, string> = {
  'Draft': 'draft', 'In Review': 'review', 'Approved': 'approved', 'Rejected': 'rejected', 'Closed': 'closed',
};

@Component({
  selector: 'gm-status-chip',
  template: `<span class="chip" [class]="'chip ' + cls()">{{ status() }}</span>`,
  styles: `
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 10px; border-radius: 999px;
      font: var(--mat-sys-label-medium); white-space: nowrap;
      &::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    }
    .draft    { color: var(--gm-status-draft);    background: var(--gm-status-draft-bg); }
    .review   { color: var(--gm-status-review);   background: var(--gm-status-review-bg); }
    .approved { color: var(--gm-status-approved); background: var(--gm-status-approved-bg); }
    .rejected { color: var(--gm-status-rejected); background: var(--gm-status-rejected-bg); }
    .closed   { color: var(--gm-status-closed);   background: var(--gm-status-closed-bg); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusChip {
  readonly status = input.required<GrantStatus>();
  protected readonly cls = computed(() => CLASS[this.status()]);
}

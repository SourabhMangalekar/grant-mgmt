import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { stateLabel } from '../../../core/tranches';

/**
 * Colour per state, reusing the application status palette. Tranches: LOCKED → PLANNED → READY → PAID → UTILISED.
 * Awards: DUE_DILIGENCE → CONTRACTED → ACTIVE → COMPLETED. Plans and reports: DRAFT → SUBMITTED → APPROVED, or
 * CHANGES_REQUESTED back to the grantee.
 */
const CLASS: Record<string, string> = {
  LOCKED: 'draft', PLANNED: 'review', READY: 'committee', PAID: 'closed', UTILISED: 'approved',
  DUE_DILIGENCE: 'review', CONTRACTED: 'committee', ACTIVE: 'closed', COMPLETED: 'approved', CLOSED: 'approved',
  DRAFT: 'draft', SUBMITTED: 'screening', CHANGES_REQUESTED: 'review', APPROVED: 'approved',
  TERMINATED: 'rejected', CANCELLED: 'rejected',
};

/** Pill for a tranche, award, plan or report state: colour plus text, never colour alone. */
/** A PLANNED tranche has no plan yet: it’s open for one, so ‘Planned’ would mislead. */
const LABEL: Record<string, string> = { PLANNED: 'Planning' };

@Component({
  selector: 'gm-tranche-state',
  template: `<span [class]="'chip ' + cls()">{{ label() }}</span>`,
  styles: `
    :host { display: inline-flex; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 10px; border-radius: 999px;
      font: var(--mat-sys-label-medium); white-space: nowrap;
      &::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    }
    .draft     { color: var(--gm-status-draft);     background: var(--gm-status-draft-bg); }
    .review    { color: var(--gm-status-review);    background: var(--gm-status-review-bg); }
    .screening { color: var(--gm-status-screening); background: var(--gm-status-screening-bg); }
    .committee { color: var(--gm-status-committee); background: var(--gm-status-committee-bg); }
    .approved  { color: var(--gm-status-approved);  background: var(--gm-status-approved-bg); }
    .rejected  { color: var(--gm-status-rejected);  background: var(--gm-status-rejected-bg); }
    .closed    { color: var(--gm-status-closed);    background: var(--gm-status-closed-bg); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrancheStateChip {
  readonly state = input.required<string | undefined>();
  protected readonly cls = computed(() => CLASS[(this.state() ?? '').toUpperCase()] ?? 'draft');
  protected readonly label = computed(() => LABEL[(this.state() ?? '').toUpperCase()] ?? stateLabel(this.state()));
}

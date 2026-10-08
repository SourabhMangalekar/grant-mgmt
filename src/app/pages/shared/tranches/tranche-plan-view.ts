import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Tranche, TranchePlan, fromByDate } from '../../../core/tranches';
import { TrancheStateChip } from './tranche-state-chip';

/**
 * A tranche plan, read-only: its state and attempt, the funder's comment when there is one, and the activities with
 * their budgets against the tranche amount. The same view serves the funder reviewing it and the grantee after
 * submitting it. The activities are an ARIA table, so they read as one on narrow screens too, where each row stacks.
 */
@Component({
  selector: 'gm-tranche-plan-view',
  imports: [CurrencyPipe, DatePipe, MatIconModule, TrancheStateChip],
  templateUrl: './tranche-plan-view.html',
  styleUrl: './tranche-plan-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranchePlanView {
  readonly plan = input.required<TranchePlan>();
  readonly tranche = input.required<Tranche>();

  protected readonly currency = computed(() => this.tranche().currencyCode || 'INR');
  protected readonly items = computed(() => [...(this.plan().tranchePlanItems ?? [])]
    .sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0))
    .map(i => ({ ...i, date: fromByDate(i.byDate) })));
  protected readonly totalMinor = computed(() => this.items().reduce((sum, i) => sum + (i.budgetMinor ?? 0), 0));
  /** Positive: short of the tranche; negative: over it. */
  protected readonly gapMinor = computed(() => this.tranche().amountMinor - this.totalMinor());
  protected readonly review = computed(() => reviewNote(this.plan().state));
}

/** How to frame the funder's comment, by the plan's (or report's) state. */
export function reviewNote(state: string | undefined): { tone: 'changes' | 'approved' | ''; title: string; icon: string } {
  switch ((state ?? '').toUpperCase()) {
    case 'CHANGES_REQUESTED': return { tone: 'changes', title: 'Changes requested', icon: 'edit_note' };
    case 'APPROVED': return { tone: 'approved', title: 'Approved', icon: 'verified' };
    default: return { tone: '', title: 'Funder’s comment', icon: 'comment' };
  }
}

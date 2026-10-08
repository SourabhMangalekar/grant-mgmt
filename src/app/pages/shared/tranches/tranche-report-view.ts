import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DELIVERY_STATES, DeliveryState, Tranche, TranchePlanItem, TrancheReport, TrancheReportItem } from '../../../core/tranches';
import { TrancheStateChip } from './tranche-state-chip';
import { reviewNote } from './tranche-plan-view';

const DELIVERY: Record<DeliveryState, { label: string; icon: string; tone: string }> = {
  DONE: { label: label('DONE'), icon: 'check_circle', tone: 'done' },
  PARTLY_DONE: { label: label('PARTLY_DONE'), icon: 'timelapse', tone: 'partly' },
  NOT_DONE: { label: label('NOT_DONE'), icon: 'cancel', tone: 'not' },
};
function label(state: DeliveryState) { return DELIVERY_STATES.find(s => s.value === state)?.label ?? state; }

let nextId = 0;

interface Line {
  key: string;
  activity: string;
  plannedMinor: number | null;
  item: TrancheReportItem | null;
}

/**
 * A tranche report, read-only: state and attempt, the funder's comment when there is one, the summary, what was spent
 * against the tranche amount, how each planned activity went, and the named supporting files. Activities come from
 * `planItems` when given; report rows the plan doesn't explain are listed after them.
 */
@Component({
  selector: 'gm-tranche-report-view',
  imports: [CurrencyPipe, DatePipe, MatIconModule, TrancheStateChip],
  templateUrl: './tranche-report-view.html',
  styleUrl: './tranche-report-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrancheReportView {
  readonly report = input.required<TrancheReport>();
  readonly planItems = input<TranchePlanItem[]>([]);
  readonly tranche = input.required<Tranche>();

  protected readonly delivery = DELIVERY;
  protected readonly uid = `tranche-report-view-${nextId++}`;
  protected readonly currency = computed(() => this.tranche().currencyCode || 'INR');
  protected readonly review = computed(() => reviewNote(this.report().state));

  protected readonly lines = computed<Line[]>(() => {
    const items = this.report().trancheReportItems ?? [];
    const plan = [...this.planItems()].sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0));
    const planned = new Set(plan.map(p => p.id));
    return [
      ...plan.map((p, i) => ({
        key: `p${p.id ?? i}`, activity: p.activity, plannedMinor: p.budgetMinor ?? null,
        item: items.find(r => r.tranchePlanItemId === p.id) ?? null,
      })),
      ...items.filter(r => !planned.has(r.tranchePlanItemId)).map((r, i) => ({
        key: `r${r.id ?? i}`, activity: `Activity #${r.tranchePlanItemId}`, plannedMinor: null, item: r,
      })),
    ];
  });

  /** The report's own total, or the rows' when the service didn't send one. */
  protected readonly spentMinor = computed(() =>
    this.report().spentMinor ?? (this.report().trancheReportItems ?? []).reduce((sum, r) => sum + (r.spentMinor ?? 0), 0));
  /** Positive: unspent; negative: over the tranche. */
  protected readonly gapMinor = computed(() => this.tranche().amountMinor - this.spentMinor());
  protected readonly spentPct = computed(() => {
    const amount = this.tranche().amountMinor;
    return amount > 0 ? Math.min(100, (this.spentMinor() / amount) * 100) : 0;
  });
}

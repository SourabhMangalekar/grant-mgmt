import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Observable, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { AuthStore } from '../../core/auth/auth.store';
import {
  INDIAN_STATES, MarketplaceGrant, MarketplacePage, MarketplaceQuery, MarketplaceScope, MarketplaceService, MarketplaceSort,
  MarketplaceSource, amountRange, applyKey, callIdOf, daysLeftLabel, eligibilityOf, funderLabel, grantKey, stateName,
} from '../../core/marketplace';
import { ThemeService } from '../../core/theme.service';
import { THEMES } from '../granter/grant-call-form/grant-call-form';
import { Cta, GrantDetailsDialog } from './grant-details-dialog';

const PAGE_SIZE = 24;
const SCOPES: MarketplaceScope[] = ['ALL', 'HERE', 'EXTERNAL'];
const SORTS: MarketplaceSort[] = ['CLOSING', 'SIZE', 'MATCH'];

/**
 * The public grant marketplace: every live call on Commons.Grants plus grants gathered from other websites, browsable
 * without signing in. Our calls offer easy apply (sign in, then straight to the proposal form); external ones link to
 * the funder's own application page. Filters live in the URL, so a filtered view can be shared.
 */
@Component({
  selector: 'gm-marketplace',
  imports: [
    DatePipe, RouterLink, MatButtonModule, MatButtonToggleModule, MatChipsModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressSpinnerModule, MatSelectModule,
  ],
  templateUrl: './marketplace.html',
  styleUrl: './marketplace.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Marketplace {
  private readonly market = inject(MarketplaceService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  protected readonly states = INDIAN_STATES;
  protected readonly skeletons = Array.from({ length: 6 }, (_, i) => i);

  // ── Who's looking ──
  protected readonly signedIn = computed(() => this.auth.isLoggedIn() && !!this.auth.user());
  protected readonly isGrantee = computed(() => this.auth.user()?.affiliation === 'grantee');
  /**
   * The signed-in grantee's organisation id, sent with every signed-in request (it drives the match scores).
   * 'pending' while it's being looked up, so the first request already carries it; null when there's none.
   */
  private readonly orgLookup = signal<number | null | 'pending'>('pending');
  private readonly organisationId = computed(() => { const o = this.orgLookup(); return typeof o === 'number' ? o : null; });
  /** Best match needs a signed-in grantee with an organisation (the public endpoint refuses MATCH). */
  protected readonly canMatch = computed(() => this.isGrantee() && this.organisationId() != null);

  // ── Filters (initialised from the URL) ──
  private readonly initial = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly search = signal(this.initial.get('q') ?? '');
  /** The search actually applied: typing settles for 300 ms first. */
  private readonly appliedSearch = toSignal(toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged()),
    { initialValue: this.initial.get('q') ?? '' });
  protected readonly scope = signal<MarketplaceScope>(pick(SCOPES, this.initial.get('scope')?.toUpperCase(), 'ALL'));
  protected readonly themeFilter = signal(this.initial.get('theme') ?? '');
  protected readonly stateFilter = signal(this.initial.get('state') ?? '');
  /** The sort the user picked (or the URL had); null means the default: best match when possible, else closing soonest. */
  private readonly chosenSort = signal<MarketplaceSort | null>(pickOrNull(SORTS, this.initial.get('sort')?.toUpperCase()));
  protected readonly sort = computed<MarketplaceSort>(() => {
    const chosen = this.chosenSort();
    if (chosen === 'MATCH' || chosen == null) return this.canMatch() ? 'MATCH' : 'CLOSING';
    return chosen;
  });
  /** Set by "Sign in to apply": after signing in, carry the grantee on to that call's proposal form. */
  private pendingApply = this.initial.get('apply');

  protected readonly filtering = computed(() =>
    !!this.appliedSearch().trim() || this.scope() !== 'ALL' || !!this.themeFilter() || !!this.stateFilter());

  // ── Results ──
  protected readonly items = signal<MarketplaceGrant[]>([]);
  protected readonly totals = signal<{ total: number; live: number; here: number; elsewhere: number } | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal(false);
  /** Rows the service has sent so far and its own total, for "Show more" (they differ from what's shown when scope is filtered here). */
  private readonly served = signal({ loaded: 0, total: 0 });
  protected readonly hasMore = computed(() => this.served().loaded < this.served().total);
  private page = 0;
  private request?: Subscription;

  /** Themes to filter by: the usual ones plus any seen in results (kept as filters change, so the chips don't jump). */
  private readonly seenThemes = signal<string[]>([]);
  protected readonly themes = computed(() => {
    const all = new Set([...THEMES.filter(t => t !== 'Other'), ...this.seenThemes()]);
    if (this.themeFilter()) all.add(this.themeFilter());
    return [...all].sort((a, b) => a.localeCompare(b));
  });

  protected readonly sources = toSignal(this.market.sources(), { initialValue: [] as MarketplaceSource[] });

  private readonly query = computed<Omit<MarketplaceQuery, 'page' | 'size'>>(() => ({
    q: this.appliedSearch(),
    scope: this.scope(),
    theme: this.themeFilter() || undefined,
    stateCode: this.stateFilter() || undefined,
    sort: this.sort(),
    organisationId: this.organisationId() ?? undefined,
  }));
  /** Signed-in grantees wait for their organisation id, so the first request is already the right one. */
  private readonly ready = computed(() => !this.isGrantee() || this.orgLookup() !== 'pending');

  constructor() {
    // A signed-in grantee's organisation, looked up once (read only: it's never created here).
    effect(() => {
      if (!this.isGrantee()) { untracked(() => this.orgLookup.set(null)); return; }
      if (untracked(this.orgLookup) !== 'pending') return;
      untracked(() => this.market.myOrganisationId().pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(id => this.orgLookup.set(id)));
    });
    // Any filter change: reload from the first page and mirror the filters in the URL.
    effect(() => {
      const q = this.query();
      if (!this.ready()) return;
      untracked(() => { this.load(q, 0); this.syncUrl(); });
    });
  }

  protected setScope(scope: MarketplaceScope) { this.scope.set(scope); }
  protected setSort(sort: MarketplaceSort) { this.chosenSort.set(sort); }
  protected clearFilters() {
    this.search.set('');
    this.scope.set('ALL');
    this.themeFilter.set('');
    this.stateFilter.set('');
  }
  protected loadMore() { if (!this.loadingMore()) this.load(this.query(), this.page + 1); }
  protected retry() { this.load(this.query(), 0); }

  // ── Card helpers ──
  protected readonly key = grantKey;
  protected readonly amount = amountRange;
  protected readonly daysLeft = daysLeftLabel;
  protected readonly funder = funderLabel;
  protected isHere(g: MarketplaceGrant) { return g.origin !== 'EXTERNAL'; }
  protected stateTags(g: MarketplaceGrant) { return (g.states ?? []).map(stateName); }
  protected eligibility(g: MarketplaceGrant) { return eligibilityOf(g.eligibilityText); }

  /** What the card's main button does, depending on the grant and on who's looking. */
  protected cta(g: MarketplaceGrant): Cta {
    if (!this.isHere(g)) {
      const href = g.applyUrl || g.sourceUrl;
      return href ? { kind: 'external', href } : { kind: 'none' };
    }
    if (!this.signedIn()) {
      return { kind: 'sign-in', returnUrl: `/marketplace?apply=${encodeURIComponent(applyKey(g))}` };
    }
    if (!this.isGrantee()) return { kind: 'funder' };
    const id = callIdOf(g);
    return id != null ? { kind: 'apply', link: ['/calls', id, 'apply'] } : { kind: 'open-calls' };
  }

  protected open(g: MarketplaceGrant) {
    this.dialog.open(GrantDetailsDialog, {
      data: { grant: g, cta: this.cta(g) }, width: '640px', maxWidth: 'calc(100vw - 32px)', autoFocus: 'dialog',
    });
  }

  private load(q: Omit<MarketplaceQuery, 'page' | 'size'>, page: number) {
    this.request?.unsubscribe();
    if (page === 0) { this.loading.set(true); this.error.set(false); } else { this.loadingMore.set(true); }
    const query: MarketplaceQuery = { ...q, page, size: PAGE_SIZE };
    // Grantees use the signed-in endpoint (call ids for easy apply, match scores); everyone else browses the public one.
    const source: Observable<MarketplacePage> = this.isGrantee() ? this.market.browseSignedIn(query) : this.market.browse(query);
    this.request = source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        const all = res.elements ?? [];
        // The public endpoint ignores `scope` (it returns both kinds), so the scope is also applied here.
        const rows = q.scope === 'HERE' ? all.filter(g => this.isHere(g)) : q.scope === 'EXTERNAL' ? all.filter(g => !this.isHere(g)) : all;
        this.page = page;
        this.items.update(prev => (page === 0 ? rows : [...prev, ...rows]));
        this.served.update(s => ({ loaded: (page === 0 ? 0 : s.loaded) + all.length, total: res.totalElements ?? all.length }));
        const here = res.applyHereTotal ?? 0, elsewhere = res.elsewhereTotal ?? 0;
        this.totals.set({
          total: q.scope === 'HERE' ? here : q.scope === 'EXTERNAL' ? elsewhere : res.totalElements ?? all.length,
          live: res.liveTotal ?? res.totalElements ?? all.length,
          here, elsewhere,
        });
        const themes = rows.map(r => r.theme).filter((t): t is string => !!t);
        if (themes.length) this.seenThemes.update(seen => [...new Set([...seen, ...themes])]);
        this.loading.set(false);
        this.loadingMore.set(false);
        this.continueApply(rows);
      },
      error: () => {
        if (page === 0) { this.error.set(true); this.items.set([]); }
        this.loading.set(false);
        this.loadingMore.set(false);
      },
    });
  }

  /** After "Sign in to apply": a grantee goes straight to that call's proposal form (or to Open calls to find it). */
  private continueApply(rows: MarketplaceGrant[]) {
    const wanted = this.pendingApply;
    if (!wanted || !this.signedIn()) return;
    this.pendingApply = null;
    this.syncUrl();
    if (!this.isGrantee()) return;
    const id = rows.map(r => (applyKey(r) === wanted ? callIdOf(r) : null)).find(x => x != null);
    void this.router.navigate(id != null ? ['/calls', id, 'apply'] : ['/calls']);
  }

  private syncUrl() {
    const queryParams: Record<string, string | null> = {
      q: this.search().trim() || null,
      scope: this.scope() === 'ALL' ? null : this.scope().toLowerCase(),
      theme: this.themeFilter() || null,
      state: this.stateFilter() || null,
      sort: this.chosenSort()?.toLowerCase() ?? null,
      apply: this.pendingApply || null,
    };
    void this.router.navigate([], { queryParams, replaceUrl: true });
  }
}

function pick<T extends string>(allowed: T[], value: string | undefined, fallback: T): T {
  return pickOrNull(allowed, value) ?? fallback;
}

function pickOrNull<T extends string>(allowed: T[], value: string | undefined): T | null {
  return (allowed as string[]).includes(value ?? '') ? (value as T) : null;
}

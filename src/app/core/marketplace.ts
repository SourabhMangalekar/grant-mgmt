import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { APP_CONFIG } from './config';
import { Page } from './grant-call.api';

/**
 * The grant marketplace (docs/backend/BACKEND-FOR-FRONTEND.md §8): calls published on Commons.Grants plus grants
 * gathered from other websites.
 *
 * - `GET /public/marketplace` needs no session, so anyone can browse. It leaves out match scores, saved marks and call ids.
 * - `GET /marketplace` (signed in) returns the same cards with those extras, so a grantee can go straight to the proposal form.
 * Query: scope ALL | HERE | EXTERNAL | SAVED, theme, stateCode, q, sort MATCH | CLOSING | SIZE, organisationId, page, size.
 */

export type MarketplaceScope = 'ALL' | 'HERE' | 'EXTERNAL';
export type MarketplaceSort = 'CLOSING' | 'SIZE' | 'MATCH';

/** One card. Fields the service has no value for are absent, never null (§7). */
export interface MarketplaceGrant {
  title: string;
  theme?: string;
  summary?: string;
  funderName?: string;
  closesAt?: number;
  daysLeft?: number;
  closingSoon?: boolean;
  isNew?: boolean;
  /** HERE: a call published on Commons.Grants. EXTERNAL: gathered from another website. */
  origin: 'HERE' | 'EXTERNAL' | string;
  /** True for Commons.Grants calls: apply here (signing in first). */
  applyHere?: boolean;
  requiresSignIn?: boolean;
  grantMinMinor?: number;
  grantMaxMinor?: number;
  currencyCode?: string;
  /** State codes (KA) on external grants, full names (Karnataka) on ours; 'ALL' means all of India. */
  states?: string[];
  /** Ours: the call's rulesJson ("[{type, value}]"); external: free text. "{}" means none. */
  eligibilityText?: string;
  // External grants
  externalGrantId?: number;
  applyUrl?: string;
  sourceUrl?: string;
  sourceName?: string;
  // Signed-in extras (not on the public endpoint); names checked defensively
  grantCallId?: number;
  callId?: number;
  matchScore?: number;
}

export interface MarketplacePage extends Page<MarketplaceGrant> {
  liveTotal?: number;
  applyHereTotal?: number;
  elsewhereTotal?: number;
  signedIn?: boolean;
}

export interface MarketplaceQuery {
  q?: string;
  scope?: MarketplaceScope;
  theme?: string;
  stateCode?: string;
  sort?: MarketplaceSort;
  organisationId?: number;
  page: number;
  size: number;
}

/** A place external grants are gathered from (`GET /public/marketplace/sources`). */
export interface MarketplaceSource { name: string; url?: string; count?: number }

@Injectable({ providedIn: 'root' })
export class MarketplaceService {
  private readonly http = inject(HttpClient);
  private readonly base = `${APP_CONFIG.grantBaseUrl}/api/v1`;
  /** ngrok's free tier answers browser requests with an HTML warning page unless this header is sent. */
  private readonly headers: Record<string, string> =
    this.base.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {};

  /** Signed-out browsing: no session needed. */
  browse(query: MarketplaceQuery): Observable<MarketplacePage> {
    return this.http.get<MarketplacePage>(`${this.base}/public/marketplace`, { headers: this.headers, params: params(query) });
  }

  /** Signed-in browsing: adds call ids and match scores. Falls back to the public cards if the service refuses. */
  browseSignedIn(query: MarketplaceQuery): Observable<MarketplacePage> {
    return this.http.get<MarketplacePage>(`${this.base}/marketplace`, { headers: this.headers, params: params(query) })
      .pipe(catchError(() => this.browse({ ...query, organisationId: undefined, sort: query.sort === 'MATCH' ? 'CLOSING' : query.sort })));
  }

  /** Where external grants come from; best effort (an empty list if the service doesn't answer). */
  sources(): Observable<MarketplaceSource[]> {
    return this.http.get<unknown>(`${this.base}/public/marketplace/sources`, { headers: this.headers }).pipe(
      map(res => {
        const rows: unknown[] = Array.isArray(res) ? res : ((res as Page<unknown>)?.elements ?? []);
        return rows.map((r): MarketplaceSource | null => {
          if (typeof r === 'string') return { name: r };
          const o = r as Record<string, unknown>;
          const name = (o['sourceName'] ?? o['name'] ?? o['title']) as string | undefined;
          return name ? { name, url: (o['sourceUrl'] ?? o['url']) as string | undefined, count: (o['count'] ?? o['grantCount']) as number | undefined } : null;
        }).filter((s): s is MarketplaceSource => !!s);
      }),
      catchError(() => of([])),
    );
  }

  /** The signed-in grantee's organisation id, read only (never creates one), for the "best match" sort. */
  myOrganisationId(): Observable<number | null> {
    return this.http.get<Page<{ id?: number }>>(`${this.base}/organisations`, { headers: this.headers, params: { page: 0, size: 1 } })
      .pipe(map(p => p.elements?.[0]?.id ?? null), catchError(() => of(null)));
  }
}

function params(q: MarketplaceQuery): Record<string, string | number> {
  const out: Record<string, string | number> = { page: q.page, size: q.size };
  if (q.q?.trim()) out['q'] = q.q.trim();
  out['scope'] = q.scope ?? 'ALL';
  if (q.theme) out['theme'] = q.theme;
  if (q.stateCode) out['stateCode'] = q.stateCode;
  out['sort'] = q.sort ?? 'CLOSING';
  if (q.organisationId != null) out['organisationId'] = q.organisationId;
  return out;
}

// ── Presentation helpers ──

/** The call id on a signed-in card, whichever name the service uses. */
export const callIdOf = (g: MarketplaceGrant): number | null => g.grantCallId ?? g.callId ?? null;

/** Indian states and union territories by code, for the state filter and for showing codes as names. */
export const INDIAN_STATES: { code: string; name: string }[] = [
  ['AN', 'Andaman & Nicobar'], ['AP', 'Andhra Pradesh'], ['AR', 'Arunachal Pradesh'], ['AS', 'Assam'], ['BR', 'Bihar'],
  ['CH', 'Chandigarh'], ['CT', 'Chhattisgarh'], ['DL', 'Delhi'], ['GA', 'Goa'], ['GJ', 'Gujarat'], ['HP', 'Himachal Pradesh'],
  ['HR', 'Haryana'], ['JH', 'Jharkhand'], ['JK', 'Jammu & Kashmir'], ['KA', 'Karnataka'], ['KL', 'Kerala'], ['LA', 'Ladakh'],
  ['MH', 'Maharashtra'], ['ML', 'Meghalaya'], ['MN', 'Manipur'], ['MP', 'Madhya Pradesh'], ['MZ', 'Mizoram'], ['NL', 'Nagaland'],
  ['OD', 'Odisha'], ['PB', 'Punjab'], ['PY', 'Puducherry'], ['RJ', 'Rajasthan'], ['SK', 'Sikkim'], ['TN', 'Tamil Nadu'],
  ['TS', 'Telangana'], ['TR', 'Tripura'], ['UK', 'Uttarakhand'], ['UP', 'Uttar Pradesh'], ['WB', 'West Bengal'],
].map(([code, name]) => ({ code, name }));
const STATE_NAME = new Map(INDIAN_STATES.map(s => [s.code, s.name]));

/** 'KA' → 'Karnataka', 'ALL' → 'All India'; full names pass through. */
export function stateName(value: string): string {
  const v = value.trim();
  if (v.toUpperCase() === 'ALL') return 'All India';
  return STATE_NAME.get(v.toUpperCase()) ?? v;
}

/** ₹ in the Indian way, compact: ₹950, ₹45,000, ₹5 L, ₹12.5 L, ₹2 Cr. */
export function compactInr(minor: number | undefined): string | null {
  if (minor == null) return null;
  const rupees = minor / 100;
  const trim = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-IN', { maximumFractionDigits: 1 });
  if (rupees >= 1_00_00_000) return `₹${trim(rupees / 1_00_00_000)} Cr`;
  if (rupees >= 1_00_000) return `₹${trim(rupees / 1_00_000)} L`;
  return `₹${Math.round(rupees).toLocaleString('en-IN')}`;
}

/** "₹5 L – ₹15 L", "Up to ₹15 L", "From ₹1 L", or null when the grant states no amount. */
export function amountRange(g: Pick<MarketplaceGrant, 'grantMinMinor' | 'grantMaxMinor'>): string | null {
  const min = compactInr(g.grantMinMinor), max = compactInr(g.grantMaxMinor);
  if (min && max) return min === max ? min : `${min} – ${max}`;
  if (max) return `Up to ${max}`;
  if (min) return `From ${min}`;
  return null;
}

/** "Closes today", "1 day left", "9 days left"; null when there's no deadline. */
export function daysLeftLabel(g: Pick<MarketplaceGrant, 'daysLeft' | 'closesAt'>): string | null {
  const days = g.daysLeft ?? (g.closesAt ? Math.ceil((g.closesAt - Date.now()) / 86_400_000) : null);
  if (days == null) return null;
  if (days <= 0) return 'Closes today';
  return days === 1 ? '1 day left' : `${days} days left`;
}

/** Who can apply, readable: our calls' rules become short tags; external text passes through; "{}" means nothing stated. */
export interface Eligibility { tags: string[]; text: string | null }

export function eligibilityOf(raw: string | undefined): Eligibility {
  const text = raw?.trim() ?? '';
  if (!text || text === '{}' || text === '[]') return { tags: [], text: null };
  if (!text.startsWith('[') && !text.startsWith('{')) return { tags: [], text };
  try {
    const parsed = JSON.parse(text);
    const rules: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : [];
    const tags = rules.map(rule => {
      const type = String(rule['type'] ?? '').toLowerCase();
      const values = Array.isArray(rule['values']) ? (rule['values'] as unknown[]).map(String) : [];
      const value = rule['value'] != null ? String(rule['value']) : values.join(', ');
      if (type === 'cert') return `${value} registered`;
      if (type === 'state') return `Works in ${values.map(stateName).join(', ') || value}`;
      if (type === 'minyears') return `${value}+ years operating`;
      return value ? `${type}: ${value}` : type;
    }).filter(Boolean);
    return { tags, text: null };
  } catch {
    return { tags: [], text };
  }
}

/** A stable key for a card in lists. */
export const grantKey = (g: MarketplaceGrant) =>
  g.origin === 'EXTERNAL' && g.externalGrantId != null ? `x-${g.externalGrantId}` : `h-${callIdOf(g) ?? `${g.title}|${g.closesAt ?? ''}`}`;

/**
 * Identifies one of our calls across the public and signed-in cards (the public card has no call id), so "Sign in to
 * apply" can carry the user on to that call's proposal form after signing in.
 */
export const applyKey = (g: MarketplaceGrant) => `${g.title}|${g.closesAt ?? ''}`;

/** The backend's stand-in when it can't share the funding organisation's name across tenants. */
export function funderLabel(g: MarketplaceGrant): string {
  const name = g.funderName?.trim();
  if (!name || name === 'This funder') return g.origin === 'EXTERNAL' ? 'Funder not named' : 'A funder on Commons.Grants';
  return name;
}

import { Affiliation } from './config';

export interface NavItem { path: string; label: string; icon: string }

/** Side-nav per tenant type. The first item is that type's landing page. */
export const NAV: Record<Affiliation, NavItem[]> = {
  granter: [
    { path: '/dashboard', label: 'Overview', icon: 'space_dashboard' },
    { path: '/grant-calls', label: 'Calls for proposals', icon: 'campaign' },
    { path: '/grants', label: 'Applications', icon: 'request_quote' },
  ],
  grantee: [
    { path: '/home', label: 'Home', icon: 'home' },
    { path: '/calls', label: 'Open calls', icon: 'campaign' },
    { path: '/applications', label: 'My applications', icon: 'assignment' },
  ],
};

/** Tenants with neither tenant type (created before the Granter/Grantee split) get the granter experience. */
export const affiliationOrDefault = (a: Affiliation | null | undefined): Affiliation => a ?? 'granter';

export const homeOf = (a: Affiliation | null | undefined) => NAV[affiliationOrDefault(a)][0].path;

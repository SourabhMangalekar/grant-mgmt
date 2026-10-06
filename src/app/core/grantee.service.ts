import { Injectable, computed, signal } from '@angular/core';
import { Grant } from './grant.model';

/** A funder's open call for proposals, as seen by a grantee. */
export interface GrantCall {
  id: string;
  title: string;
  funder: string;
  program: string;
  maxAmount: number;
  deadline: string;
}

// Placeholder data until the grant APIs exist; mirrors GrantService's seed for the granter side.
const MY_APPLICATIONS: Grant[] = [
  { id: 'GR-1025', title: 'Girls in STEM Scholarships', applicant: 'Kaveri Foundation', program: 'Education', amount: 800000, status: 'In Review', submittedOn: '2026-09-02' },
  { id: 'GR-1029', title: 'Farmer Producer Training', applicant: 'Kaveri Foundation', program: 'Livelihoods', amount: 950000, status: 'Approved', submittedOn: '2026-06-18' },
  { id: 'GR-1031', title: 'Community Libraries', applicant: 'Kaveri Foundation', program: 'Education', amount: 520000, status: 'Draft', submittedOn: '2026-10-01' },
  { id: 'GR-1028', title: 'Digital Literacy for Seniors', applicant: 'Kaveri Foundation', program: 'Education', amount: 300000, status: 'Rejected', submittedOn: '2026-07-30' },
];

const OPEN_CALLS: GrantCall[] = [
  { id: 'CFP-201', title: 'Climate Resilient Agriculture 2027', funder: 'Tata Trusts', program: 'Livelihoods', maxAmount: 2500000, deadline: '2026-11-15' },
  { id: 'CFP-202', title: 'Foundational Literacy & Numeracy', funder: 'Azim Premji Foundation', program: 'Education', maxAmount: 1500000, deadline: '2026-10-31' },
  { id: 'CFP-203', title: 'Primary Health in Aspirational Districts', funder: 'Piramal Foundation', program: 'Health', maxAmount: 3000000, deadline: '2026-12-10' },
  { id: 'CFP-204', title: 'Urban Water Stewardship', funder: 'HDFC Parivartan', program: 'Environment', maxAmount: 1200000, deadline: '2026-10-20' },
];

/** The grantee side of the app: the organisation's own applications and the calls it can apply to. */
@Injectable({ providedIn: 'root' })
export class GranteeService {
  readonly applications = signal<Grant[]>(MY_APPLICATIONS);
  readonly calls = signal<GrantCall[]>(OPEN_CALLS);

  readonly stats = computed(() => {
    const a = this.applications();
    const funded = a.filter(x => x.status === 'Approved' || x.status === 'Closed');
    return {
      drafts: a.filter(x => x.status === 'Draft').length,
      inReview: a.filter(x => x.status === 'In Review').length,
      funded: funded.length,
      received: funded.reduce((sum, x) => sum + x.amount, 0),
    };
  });
}

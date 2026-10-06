import { Injectable, computed, signal } from '@angular/core';
import { Grant } from './grant.model';

const SEED: Grant[] = [
  { id: 'GR-1024', title: 'Rural Water Access', applicant: 'Jal Sewa Trust', program: 'Infrastructure', amount: 1250000, status: 'Approved', submittedOn: '2026-08-12' },
  { id: 'GR-1025', title: 'Girls in STEM Scholarships', applicant: 'Vidya Foundation', program: 'Education', amount: 800000, status: 'In Review', submittedOn: '2026-09-02' },
  { id: 'GR-1026', title: 'Mobile Health Clinics', applicant: 'CareFirst Society', program: 'Health', amount: 2100000, status: 'In Review', submittedOn: '2026-09-10' },
  { id: 'GR-1027', title: 'Urban Tree Canopy', applicant: 'Green Streets Collective', program: 'Environment', amount: 450000, status: 'Draft', submittedOn: '2026-09-21' },
  { id: 'GR-1028', title: 'Digital Literacy for Seniors', applicant: 'Saathi Network', program: 'Education', amount: 300000, status: 'Rejected', submittedOn: '2026-07-30' },
  { id: 'GR-1029', title: 'Farmer Producer Training', applicant: 'Krishi Mitra', program: 'Livelihoods', amount: 950000, status: 'Approved', submittedOn: '2026-06-18' },
  { id: 'GR-1030', title: 'Flood Resilience Housing', applicant: 'Shelter Now', program: 'Infrastructure', amount: 3200000, status: 'Closed', submittedOn: '2026-03-05' },
  { id: 'GR-1031', title: 'Community Libraries', applicant: 'Pustak Ghar', program: 'Education', amount: 520000, status: 'Draft', submittedOn: '2026-10-01' },
];

@Injectable({ providedIn: 'root' })
export class GrantService {
  readonly grants = signal<Grant[]>(SEED);

  readonly stats = computed(() => {
    const g = this.grants();
    const funded = g.filter(x => x.status === 'Approved' || x.status === 'Closed');
    return {
      total: g.length,
      inReview: g.filter(x => x.status === 'In Review').length,
      approved: funded.length,
      committed: funded.reduce((sum, x) => sum + x.amount, 0),
    };
  });
}

export type GrantStatus = 'Draft' | 'In Review' | 'Approved' | 'Rejected' | 'Closed';

export interface Grant {
  id: string;
  title: string;
  applicant: string;
  program: string;
  amount: number;
  status: GrantStatus;
  submittedOn: string;
}

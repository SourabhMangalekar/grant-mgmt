export type GrantStatus = 'Draft' | 'Screening' | 'In Review' | 'In Committee' | 'Approved' | 'Rejected' | 'Closed';

export interface Grant {
  id: string;
  title: string;
  applicant: string;
  program: string;
  amount: number;
  status: GrantStatus;
  submittedOn: string;
  /** The grant service's numeric application id, for links to the application. */
  appId?: number;
}

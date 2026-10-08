import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, delay, of, throwError } from 'rxjs';
import { APP_CONFIG } from '../config';
import { PlatformToken, Tenant } from './auth.models';
import { slugify } from '../../pages/auth/auth-shared';

/**
 * In-browser stand-in for the commons-iam-service endpoints the app uses, active while APP_CONFIG.mockApi is true.
 * Mirrors the real flows: new org (register → signup/tenant → PATCH tenantType) and join (register/user → activate →
 * user-verification not-reviewed). OTP is always "123456".
 * Demo: org "kaveri" (granter), user "meera@kaveri.org" / "Password@123" (admin);
 * org "jalsewa" (grantee), user "ravi@jalsewa.org" / "Password@123" (admin). Join requests stay pending until
 * approved: run `localStorage.setItem('gm-mock-approve', '1')` in the console, then "Check again".
 * To see what happens when IAM is unreachable, set `gm-mock-iam-down` the same way and refresh.
 * Grant service: Meera's call "Foundational Literacy 2027" has received three applications from Jal Sewa Trust (one
 * submitted, one in review with a review and two documents, one approved); Ravi also has a draft for it that funders
 * never see. The approved one's award (id 1) has no tranches yet, so the whole money journey can be demoed: Meera sets
 * up tranches, Ravi plans, Meera approves and releases, Ravi reports, Meera approves and finally closes the award.
 * Post-award records are shared by both demo users; the real service still scopes them to one tenant (§4/§11 of
 * docs/backend/BACKEND-FOR-FRONTEND.md). To see what the grantee gets until that's fixed (404s), set
 * `gm-mock-award-scoped` the same way.
 */
const OTP = '123456';
interface MockUser { id: number; login: string; name: string; password: string; tenantLogin: string; admin: boolean }
const tenants: Tenant[] = [
  { id: 1, tenantLogin: 'kaveri', tenantName: 'Kaveri Foundation', tenantType: APP_CONFIG.tenantTypes.granter },
  { id: 2, tenantLogin: 'jalsewa', tenantName: 'Jal Sewa Trust', tenantType: APP_CONFIG.tenantTypes.grantee },
];
const users: MockUser[] = [
  { id: 1, login: 'meera@kaveri.org', name: 'Meera Iyer', password: 'Password@123', tenantLogin: 'kaveri', admin: true },
  { id: 2, login: 'ravi@jalsewa.org', name: 'Ravi Kumar', password: 'Password@123', tenantLogin: 'jalsewa', admin: true },
];
const pending = new Set<number>();
const sessions = new Map<string, number>(load());
const leads = new Map<string, any>();

/**
 * In-memory commons-grant-service: grant calls (one open call seeded), organisations, applications and their budget
 * lines, documents and reviews. Records are tenant-scoped like the real service: GET /organisations and
 * GET /applications only return the caller's own.
 */
const DAY = 86_400_000;
const NOW = Date.now();
const grantCalls: any[] = [{
  id: 1, title: 'Foundational Literacy 2027', callCode: 'FLN-2027-01', theme: 'Education', state: 'PUBLISHED', currencyCode: 'INR',
  description: 'Funding for NGOs running foundational literacy and numeracy programmes in government primary schools.',
  envelopeAmountMinor: 5_000_000_00, minAwardMinor: 500_000_00, maxAwardMinor: 1_500_000_00,
  opensAt: NOW - 28 * DAY, closesAt: NOW + 30 * DAY, postedAt: NOW - 29 * DAY, reviewersRequired: 2,
  isCsrFunded: true, scheduleViiCode: 'SCH7_II', isForeignFunded: false, responseFormat: 'QUESTIONS',
  budgetFormat: 'LINE_ITEMS', budgetPeriod: 'YEARLY',
  questionsJson: JSON.stringify([
    { id: 'Q1', text: 'What problem does your project address, and for whom?' },
    { id: 'Q2', text: 'What outcomes will you achieve, and how will you measure them?' },
    { id: 'Q3', text: 'How will you sustain the programme after the grant ends?' },
  ]),
  requiredDocsJson: JSON.stringify(['REGISTRATION_CERTIFICATE', 'PAN', '12A', '80G', 'CSR_1']),
}];

/** Which IAM tenant each organisation belongs to. */
const orgTenant = new Map<number, string>([[1, 'jalsewa']]);
const organisations: any[] = [{
  id: 1, legalName: 'Jal Sewa Trust', kind: 'NGO', orgType: APP_CONFIG.tenantTypes.grantee,
  contactName: 'Ravi Kumar', contactEmail: 'ravi@jalsewa.org', contactMobile: '9876543210',
  district: 'Pune', stateCode: 'MH', foundedYear: 2011,
  about: 'A Pune-based trust that has run reading and maths programmes with government primary schools in Haveli, '
    + 'Mulshi and Velhe since 2011, working alongside teachers, school management committees and gram panchayats.',
}];

/** Proposal-form answers ({ summary, answers }) to the seeded call's three questions. */
const proposal = (summary: string, ...replies: string[]) => JSON.stringify({
  summary,
  answers: (JSON.parse(grantCalls[0].questionsJson) as { id: string; text: string }[])
    .map((q, i) => ({ questionId: q.id, question: q.text, answer: replies[i] ?? '' })),
});
/** APP-YYMMDD-XXXXXX, the client's reference format, with a fixed suffix so demo references stay put across reloads. */
const ref = (startedAt: number, suffix: string) => {
  const d = new Date(startedAt);
  return `APP-${[d.getFullYear() % 100, d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('')}-${suffix}`;
};
const applications: any[] = [
  {
    id: 1, grantCallId: 1, organisationId: 1, referenceCode: ref(NOW - 5 * DAY, 'K7Q2XM'), state: 'SCREENING', entryCheckResult: 'PASS',
    title: 'Reading Corners for Haveli Schools', currencyCode: 'INR', durationMonths: 12, disagreementFlagged: false,
    requestedAmountMinor: 960_000_00, budgetTotalMinor: 960_000_00,
    budgetNote: 'Facilitator stipends are paid monthly; the graded reader sets are bought in the first quarter.',
    consentGivenAt: NOW - 2 * DAY - 10 * 60_000, submittedAt: NOW - 2 * DAY,
    answersJson: proposal(
      'Reading corners and a daily 30-minute reading period in 40 government primary schools in Haveli taluka, run by '
        + 'trained local facilitators alongside class teachers.',
      'Many Class 3 children in Haveli’s government schools still can’t read a short Class 1 paragraph in Marathi, and most '
        + 'classrooms have no books beyond the textbook. We’ll work with about 3,200 children in Classes 1 to 3 and their 80 teachers.',
      'By the end of the year, at least 70% of Class 3 children will read a Class 1 paragraph fluently. Facilitators will run '
        + 'short oral reading checks every term, and we’ll share school-wise results with headteachers and the block office.',
      'Teachers co-run the reading period from the second term and take it over in the final quarter. The book sets stay with '
        + 'each school, and 12 gram panchayats have agreed to fund replacement books from their school development budgets.',
    ),
  },
  {
    id: 2, grantCallId: 1, organisationId: 1, referenceCode: ref(NOW - 10 * DAY, 'R4HN8C'), state: 'UNDER_REVIEW', entryCheckResult: 'PASS',
    title: 'Numeracy Champions in Mulshi Block', currencyCode: 'INR', durationMonths: 18, disagreementFlagged: false,
    requestedAmountMinor: 1_250_000_00, budgetTotalMinor: 1_250_000_00,
    budgetNote: 'The block coordinator works full time for all 18 months; maths kits are bought once and stay with the schools.',
    consentGivenAt: NOW - 6 * DAY - 25 * 60_000, submittedAt: NOW - 6 * DAY,
    answersJson: proposal(
      'One trained “numeracy champion” teacher in each of 50 schools in Mulshi block, running activity-based maths lessons '
        + 'backed by community maths melas.',
      'Children in Mulshi’s hill villages fall behind on place value and subtraction by Class 3, and teachers in multi-grade '
        + 'classrooms have little time or material for hands-on maths. We’ll reach around 4,000 children in Classes 1 to 4.',
      'We aim for 60% of Class 3 children to solve two-digit subtraction with borrowing by month 18. We’ll run a baseline and '
        + 'three half-yearly assessments with an ASER-style tool, and observe every champion’s lessons each term.',
      'Champion teachers become cluster resource people who coach their peers, and the block education office has agreed to '
        + 'add the module to its yearly in-service teacher training.',
    ),
  },
  {
    // The grantee's unfinished work: GET /grant-calls/1/applications returns it, and the client must hide it from funders.
    id: 3, grantCallId: 1, organisationId: 1, referenceCode: ref(NOW - DAY, 'D9WT3F'), state: 'DRAFT',
    title: 'Library Period Pilot in Velhe', currencyCode: 'INR', durationMonths: 9, disagreementFlagged: false,
    requestedAmountMinor: 600_000_00, budgetTotalMinor: 600_000_00,
    budgetNote: 'Book sets are bought up front; the librarian’s stipend is paid monthly.',
    consentGivenAt: NOW - DAY,
    answersJson: proposal(
      'A weekly library period in 25 schools in Velhe taluka, with a part-time librarian and read-aloud events.',
      'Schools in Velhe have small book collections kept locked away, so children rarely read for pleasure.',
      'Every child borrows at least one book a fortnight; we’ll track borrowing registers and run two reading assessments.',
    ),
  },
  {
    // Approved, with its award (id 1) waiting for tranches, so the post-award flow can be demoed straight away.
    id: 4, grantCallId: 1, organisationId: 1, referenceCode: ref(NOW - 24 * DAY, 'B6TJ2W'), state: 'APPROVED', entryCheckResult: 'PASS',
    title: 'Catch-up Reading Camps in Mulshi', currencyCode: 'INR', durationMonths: 12, disagreementFlagged: false,
    requestedAmountMinor: 800_000_00, budgetTotalMinor: 800_000_00,
    budgetNote: 'Camp facilitators are paid for the ten camp months; the reading kits are bought before the first camp.',
    consentGivenAt: NOW - 20 * DAY - 15 * 60_000, submittedAt: NOW - 20 * DAY,
    answersJson: proposal(
      'Two six-week reading camps a year in 30 villages of Mulshi block, for Class 3 to 5 children who still read below '
        + 'Class 2 level, run by trained local facilitators with village volunteers.',
      'About a third of Class 3 to 5 children in Mulshi’s government schools still can’t read a Class 2 story, and they fall '
        + 'further behind every year because lessons move on without them. We’ll work with around 1,500 of these children.',
      'At least 65% of camp children will read a Class 2 story fluently by the end of their second camp. Facilitators test '
        + 'every child at the start and end of each camp, and an external team re-checks a 10% sample.',
      'Each camp trains two local volunteers alongside the facilitator, and the village reading groups they start meet weekly '
        + 'after the camps end. Six gram panchayats have offered space and electricity for the camps at no cost.',
    ),
  },
];
const line = (applicationId: number, lineNo: number, head: string, item: string, quantity: number, unitCostMinor: number) =>
  ({ applicationId, lineNo, head, item, quantity, unitCostMinor, amountMinor: quantity * unitCostMinor });
/** Each application's lines add up to its requested amount. */
const budgetLines: any[] = [
  line(1, 1, 'Personnel', 'Literacy facilitators (4 × 12 months)', 48, 10_000_00),
  line(1, 2, 'Programme activities', 'Teacher training workshops', 6, 25_000_00),
  line(1, 3, 'Equipment & materials', 'Graded reader sets (one per school)', 40, 6_000_00),
  line(1, 4, 'Monitoring & evaluation', 'Baseline and endline reading assessments', 2, 45_000_00),
  line(2, 1, 'Personnel', 'Block coordinator (18 months)', 18, 35_000_00),
  line(2, 2, 'Programme activities', 'Community maths melas', 12, 20_000_00),
  line(2, 3, 'Equipment & materials', 'Maths manipulative kits (one per school)', 50, 4_800_00),
  line(2, 4, 'Monitoring & evaluation', 'Baseline and three half-yearly assessments', 4, 35_000_00),
  line(3, 1, 'Personnel', 'Part-time librarian (9 months)', 9, 15_000_00),
  line(3, 2, 'Programme activities', 'Read-aloud events', 15, 7_000_00),
  line(3, 3, 'Equipment & materials', 'Library book sets (one per school)', 25, 12_000_00),
  line(3, 4, 'Monitoring & evaluation', 'Reading assessments', 2, 30_000_00),
  line(4, 1, 'Personnel', 'Camp facilitators (6 × 10 months)', 60, 8_000_00),
  line(4, 2, 'Programme activities', 'Facilitator and volunteer training', 4, 30_000_00),
  line(4, 3, 'Equipment & materials', 'Levelled reading kits (one per village)', 30, 4_000_00),
  line(4, 4, 'Monitoring & evaluation', 'Camp reading tests and external re-check', 2, 40_000_00),
].map((l, i) => ({ id: i + 1, ...l }));
const applicationDocuments: any[] = [
  { id: 1, applicationId: 2, vaultDocumentId: 101, docType: 'REGISTRATION_CERTIFICATE', source: 'VAULT' },
  { id: 2, applicationId: 2, vaultDocumentId: 102, docType: 'PAN', source: 'VAULT' },
  { id: 3, applicationId: 4, vaultDocumentId: 101, docType: 'REGISTRATION_CERTIFICATE', source: 'VAULT' },
  { id: 4, applicationId: 4, vaultDocumentId: 102, docType: 'PAN', source: 'VAULT' },
];
const reviews: any[] = [{
  // A colleague's review (not Meera's), so the demo funder can add the second one the call needs.
  id: 1, applicationId: 2, reviewerUserId: 1001, state: 'SUBMITTED', recommendation: 'APPROVE', conflictDeclared: false,
  scoreNeed: 5, scoreApproach: 4, scoreCapacity: 4, scoreBudget: 3, totalScore: 80, submittedAt: NOW - 3 * DAY,
  comment: 'Clear need and a team with a good track record in Mulshi. The coordinator’s cost is on the high side for an '
    + '18-month pilot; worth asking whether the role could be shared with the block office.',
}, {
  id: 2, applicationId: 4, reviewerUserId: 1001, state: 'SUBMITTED', recommendation: 'APPROVE', conflictDeclared: false,
  scoreNeed: 5, scoreApproach: 4, scoreCapacity: 4, scoreBudget: 4, totalScore: 85, submittedAt: NOW - 14 * DAY,
  comment: 'A well-targeted catch-up model with a sensible plan for keeping the reading groups going after the camps.',
}, {
  id: 3, applicationId: 4, reviewerUserId: 1, state: 'SUBMITTED', recommendation: 'APPROVE', conflictDeclared: false,
  scoreNeed: 4, scoreApproach: 4, scoreCapacity: 5, scoreBudget: 4, totalScore: 85, submittedAt: NOW - 12 * DAY,
  comment: 'Strong team and an honest budget. The external re-check of a 10% sample is a good touch.',
}];

const awards: any[] = [{
  // Application 4's award: due diligence done (bank account verified, three audited years), no tranches yet.
  id: 1, applicationId: 4, awardCode: `${applications.find(a => a.id === 4).referenceCode}-AWD`, awardedAmountMinor: 800_000_00,
  currencyCode: 'INR', state: 'DUE_DILIGENCE', auditedYearsOnFile: 3, bankAccountVerified: true,
}];

/** The money after the award (BACKEND-FOR-FRONTEND.md §6, "The money journey"). Nothing seeded: the funder starts it. */
const tranches: any[] = [];
const tranchePlans: any[] = [];
const tranchePlanItems: any[] = [];
const trancheReports: any[] = [];
const trancheReportItems: any[] = [];
/** The DTO fields each post-award write keeps; like the service (§7), anything else in the body is dropped in silence. */
const TRANCHE_FIELDS = ['awardId', 'sequenceNo', 'percentage', 'amountMinor', 'currencyCode', 'milestoneLabel', 'isMilestoneMet',
  'plannedAt', 'reportDueAt'];
const REVIEWED_FIELDS = ['trancheId', 'attempt', 'state', 'submittedAt', 'reviewComment', 'reviewedAt', 'reviewedByUserId'];
/**
 * Plans and reports work the same way ("the report endpoints mirror the plan ones"): one per tranche, items underneath,
 * and approve / request-changes / resubmit. `opensWhen` is the tranche state in which one can be written.
 */
const KINDS = {
  'tranche-plans': {
    what: 'plan', rows: tranchePlans, fields: REVIEWED_FIELDS, link: 'tranchePlanId', opensWhen: 'PLANNED',
    items: tranchePlanItems, itemFields: ['tranchePlanId', 'orderNo', 'activity', 'expectedOutput', 'budgetMinor', 'byDate'],
  },
  'tranche-reports': {
    what: 'report', rows: trancheReports, fields: [...REVIEWED_FIELDS, 'summary', 'spentMinor', 'photosFileName', 'ucFileName'],
    link: 'trancheReportId', opensWhen: 'PAID',
    items: trancheReportItems, itemFields: ['trancheReportId', 'tranchePlanItemId', 'deliveryState', 'spentMinor', 'remark'],
  },
} as const;
type KindPath = keyof typeof KINDS;
const ITEM_PATHS: Record<string, KindPath> = { 'tranche-plan-items': 'tranche-plans', 'tranche-report-items': 'tranche-reports' };

/** Max id + 1, so records created at runtime never collide with the seeds. */
const nextId = (rows: { id?: number }[]) => rows.reduce((max, x) => Math.max(max, x.id ?? 0), 0) + 1;
const byId = (rows: any[], id: unknown) => rows.find(x => x.id === Number(id));
const pick = (body: any, keys: readonly string[]) => Object.fromEntries(keys.filter(k => body?.[k] != null).map(k => [k, body[k]]));
const bySequence = (a: any, b: any) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0);
const rupees = (minor: number) => (minor / 100).toLocaleString('en-IN');
/** A copy, as if it had crossed the wire: callers never hold (and mutate) the mock's own records. */
const okRes = (body: unknown, status = 200) =>
  of(new HttpResponse({ status, body: body == null ? null : JSON.parse(JSON.stringify(body)) })).pipe(delay(300));
const page = (rows: any[]) => okRes({ elements: [...rows], totalElements: rows.length });
/** A 400 with the grant service's human-readable errorMessage. */
const refuse = (errorMessage: string) =>
  throwError(() => new HttpErrorResponse({ status: 400, error: { errorCode: 'ERR_PLATFORM_GEN_INVALID_INPUT', errorMessage } })).pipe(delay(300));
const notFound = (errorMessage = 'Not found') =>
  throwError(() => new HttpErrorResponse({ status: 404, error: { errorCode: 'ERR_PLATFORM_GEN_NOT_FOUND', errorMessage } })).pipe(delay(300));
/** What the service answers when a NOT NULL column is missing from a create (§7): a 500, not a 400. */
const sqlNull = (column: string) => throwError(() => new HttpErrorResponse({ status: 500, error: {
  errorCode: 'ERR_PLATFORM_GEN_UNKNOWN', errorMessage: `SQLIntegrityConstraintViolationException: Column '${column}' cannot be null` } })).pipe(delay(300));

function grantRoute(req: HttpRequest<any>, path: string): Observable<any> | null {
  const b = req.body ?? {};
  const m = (re: RegExp) => path.match(re);
  let r: RegExpMatchArray | null;
  // The caller and their tenant, from the session the IAM mock issued; scopes the tenant-owned records below.
  const me = users.find(u => u.id === sessions.get(req.headers.get(APP_CONFIG.sessionHeader) ?? ''));
  const tenant = me?.tenantLogin;
  const mine = (organisationId: number) => tenant != null && orgTenant.get(organisationId) === tenant;
  const param = (k: string) => (req.params.get(k) ?? '').trim();
  // Opt-in replay of the service's last tenancy gap (§4/§11): post-award records stay with the funder's tenant.
  if (localStorage.getItem('gm-mock-award-scoped')
    && tenants.find(t => t.tenantLogin === tenant)?.tenantType !== APP_CONFIG.tenantTypes.granter
    && /^\/api\/v1\/(awards|tranches|tranche-plans|tranche-plan-items|tranche-reports|tranche-report-items)(\/|$)|^\/api\/v1\/applications\/\d+\/award$/.test(path)) {
    return notFound();
  }
  if (path === '/api/v1/grant-calls') {
    if (req.method === 'POST') {
      // Mirrors the grant service's validation.
      if (b.state && !['DRAFT', 'PUBLISHED', 'CLOSED'].includes(b.state)) {
        return throwError(() => new HttpErrorResponse({ status: 400, error: {
          errorCode: 'ERR_PLATFORM_GEN_INVALID_INPUT',
          errorMessage: `Unknown grant call state '${b.state}'. Use one of [DRAFT, PUBLISHED, CLOSED]. A call is made public by PUBLISHED, not OPEN.` } })).pipe(delay(300));
      }
      const c = { ...b, id: nextId(grantCalls) }; grantCalls.push(c); return okRes(c, 201);
    }
    return page(grantCalls);
  }
  if (path === '/api/v1/grant-calls/open') return page(grantCalls.filter(c => c.state === 'PUBLISHED'));
  if ((r = m(/^\/api\/v1\/grant-calls\/open\/(\d+)$/))) {
    const c = grantCalls.find(x => x.id === +r![1] && x.state === 'PUBLISHED'); return c ? okRes(c) : notFound();
  }
  if ((r = m(/^\/api\/v1\/grant-calls\/(\d+)\/applications$/))) return page(applications.filter(a => a.grantCallId === +r![1]));
  if ((r = m(/^\/api\/v1\/grant-calls\/(\d+)$/))) { const c = grantCalls.find(x => x.id === +r![1]); return c ? okRes(c) : notFound(); }
  if (path === '/api/v1/organisations') {
    if (req.method === 'POST') {
      if (!b.orgType) return sqlNull('org_type');
      const o = { ...b, id: nextId(organisations) }; organisations.push(o);
      if (tenant) orgTenant.set(o.id, tenant);
      return okRes(o, 201);
    }
    // Only the caller's own record, so the first one is "the caller's organisation" (ravi gets Jal Sewa Trust).
    return page(organisations.filter(o => mine(o.id)).slice(0, 1));
  }
  // Checked before /organisations/{id}; the funder reads applicants' records by id.
  if (path === '/api/v1/organisations/ids' && req.method === 'POST') {
    const ids = Array.isArray(req.body) ? req.body.map(Number) : [];
    return okRes(organisations.filter(o => ids.includes(o.id)));
  }
  if ((r = m(/^\/api\/v1\/organisations\/(\d+)$/))) { const o = organisations.find(x => x.id === +r![1]); return o ? okRes(o) : notFound(); }
  if (path === '/api/v1/applications') {
    if (req.method === 'POST') {
      // Like the grant service, the client has to supply the reference code.
      if (!b.referenceCode) return sqlNull('reference_code');
      const a = { ...b, id: nextId(applications) };
      applications.push(a); return okRes(a, 201);
    }
    return page(applications.filter(a => mine(a.organisationId)));
  }
  if ((r = m(/^\/api\/v1\/applications\/(\d+)\/submit$/))) {
    const a = applications.find(x => x.id === +r![1]); if (!a) return notFound();
    Object.assign(a, { state: 'SCREENING', entryCheckResult: 'PASS', submittedAt: Date.now() }); return okRes(a);
  }

  // ── The funder's review chain, with the grant service's refusals (same wording) ──
  if ((r = m(/^\/api\/v1\/applications\/(\d+)\/(start-review|send-to-committee|approve|reject)$/)) && req.method === 'POST') {
    const a = applications.find(x => x.id === +r![1]); if (!a) return notFound();
    const call = grantCalls.find(c => c.id === a.grantCallId);
    const p = (k: string) => req.params.get(k) ?? '';
    const step = r[2];
    if (step === 'start-review') {
      if (a.state !== 'SCREENING') return refuse(`Review starts from SCREENING. This one is ${a.state}`);
      a.state = 'UNDER_REVIEW'; return okRes(a);
    }
    if (step === 'send-to-committee') {
      if (a.state !== 'UNDER_REVIEW') return refuse(`The committee sits on applications UNDER_REVIEW. This one is ${a.state}`);
      const done = reviews.filter(v => v.applicationId === a.id && v.state === 'SUBMITTED');
      const needed = call?.reviewersRequired ?? 1;
      if (done.length < needed) return refuse(`${done.length} of ${needed} reviews submitted — the committee cannot sit yet`);
      const scores = ['scoreNeed', 'scoreApproach', 'scoreCapacity', 'scoreBudget'];
      const disagree = new Set(done.map(v => v.recommendation)).size > 1
        || scores.some(s => Math.max(...done.map(v => v[s])) - Math.min(...done.map(v => v[s])) >= 2);
      if (disagree && p('overrideDisagreement') !== 'true') {
        return refuse('Reviewers disagree materially (different recommendations, or a score 2 or more apart). '
          + 'Look at the reviews, then send it on with overrideDisagreement=true and a comment explaining why.');
      }
      if (disagree && !p('comment').trim()) return refuse('A comment is required to override the reviewers’ disagreement');
      a.state = 'COMMITTEE'; a.disagreementFlagged = disagree; return okRes(a);
    }
    if (a.state !== 'COMMITTEE') return refuse(`${step === 'approve' ? 'Approval' : 'Rejection'} happens from COMMITTEE. This one is ${a.state}`);
    if (step === 'reject') {
      if (!p('comment').trim()) return refuse('A reason is required — the applicant sees it');
      a.state = 'REJECTED'; return okRes(a);
    }
    if (!p('comment').trim()) return refuse('A comment is required — the applicant sees it');
    const amount = Number(p('amountMinor'));
    if (call?.maxAwardMinor != null && amount > call.maxAwardMinor) return refuse(`Above the call's largest grant of Rs ${rupees(call.maxAwardMinor)}`);
    if (call?.minAwardMinor != null && amount < call.minAwardMinor) return refuse(`Below the call's smallest grant of Rs ${rupees(call.minAwardMinor)}`);
    a.state = 'APPROVED';
    awards.push({ id: nextId(awards), applicationId: a.id, awardCode: `${a.referenceCode}-AWD`, awardedAmountMinor: amount,
      currencyCode: a.currencyCode || 'INR', state: 'DUE_DILIGENCE', auditedYearsOnFile: 0, bankAccountVerified: false });
    return okRes(a);
  }
  if ((r = m(/^\/api\/v1\/applications\/(\d+)\/award$/))) {
    const w = awards.find(x => x.applicationId === +r![1]); return w ? okRes(w) : notFound();
  }
  if (path === '/api/v1/reviews' && req.method === 'POST') {
    if (b.conflictDeclared == null) return sqlNull('conflict_declared');
    const a = applications.find(x => x.id === b.applicationId); if (!a) return notFound();
    if (a.state !== 'UNDER_REVIEW') return refuse(`Reviews are recorded while UNDER_REVIEW. This one is ${a.state}`);
    const v = { ...b, id: nextId(reviews) }; reviews.push(v); return okRes(v, 201);
  }
  if ((r = m(/^\/api\/v1\/applications\/(\d+)\/application-budget-lines$/))) return page(budgetLines.filter(l => l.applicationId === +r![1]));
  if ((r = m(/^\/api\/v1\/applications\/(\d+)\/application-documents$/))) return page(applicationDocuments.filter(d => d.applicationId === +r![1]));
  if ((r = m(/^\/api\/v1\/applications\/(\d+)\/reviews$/))) return page(reviews.filter(v => v.applicationId === +r![1]));
  if ((r = m(/^\/api\/v1\/applications\/(\d+)$/))) { const a = applications.find(x => x.id === +r![1]); return a ? okRes(a) : notFound(); }
  if (path === '/api/v1/application-budget-lines' && req.method === 'POST') {
    const l = { ...b, id: nextId(budgetLines) }; budgetLines.push(l); return okRes(l, 201);
  }
  return moneyRoute(req, path, me?.id, param);
}

/**
 * The money journey after an award (BACKEND-FOR-FRONTEND.md §6), with the service's refusals:
 *   award ──/set-up-tranches──► tranche 1 PLANNED, the rest LOCKED
 *   plan SUBMITTED   ──/tranche-plans/{id}/approve──► tranche READY
 *   tranche READY    ──/tranches/{id}/release──────► tranche PAID (the award goes ACTIVE on the first one)
 *   report SUBMITTED ──/tranche-reports/{id}/approve──► tranche UTILISED, the next one PLANNED
 *   every tranche UTILISED ──/awards/{id}/close──► award COMPLETED
 * Specific sub-paths are matched before the plain /{id} ones.
 */
function moneyRoute(req: HttpRequest<any>, path: string, myId: number | undefined, param: (k: string) => string): Observable<any> | null {
  const b = req.body ?? {};
  const m = (re: RegExp) => path.match(re);
  let r: RegExpMatchArray | null;
  const ofAward = (awardId: number) => tranches.filter(t => t.awardId === awardId).sort(bySequence);

  // ── Awards ──
  if (path === '/api/v1/awards' && req.method === 'GET') return page(awards);
  if ((r = m(/^\/api\/v1\/awards\/(\d+)\/tranches$/)) && req.method === 'GET') return page(ofAward(+r[1]));
  if ((r = m(/^\/api\/v1\/awards\/(\d+)\/set-up-tranches$/)) && req.method === 'POST') {
    const award = byId(awards, r[1]); if (!award) return notFound(`Award not found: ${r[1]}`);
    if (award.state !== 'DUE_DILIGENCE' && award.state !== 'CONTRACTED') {
      return refuse(`Tranches are set up on a DUE_DILIGENCE or CONTRACTED award. This one is ${award.state}`);
    }
    const existing = ofAward(award.id).length;
    if (existing) return refuse(`Tranches are set up once, and this award already has ${existing}`);
    const rows: any[] = Array.isArray(req.body) ? req.body : [];
    if (rows.length < 2 || rows.length > 4) return refuse(`An award is paid in 2, 3 or 4 tranches. This set-up has ${rows.length}`);
    if (rows.some(t => !(Number(t.percentage) > 0))) return refuse('Every tranche needs a share above 0%');
    const percent = Math.round(rows.reduce((sum, t) => sum + Number(t.percentage), 0) * 100) / 100;
    if (percent !== 100) return refuse(`Tranche percentages must add up to 100. These add up to ${percent}`);
    const total = rows.reduce((sum, t) => sum + Number(t.amountMinor ?? 0), 0);
    if (total !== award.awardedAmountMinor) {
      return refuse(`Tranche amounts must add up to the award of Rs ${rupees(award.awardedAmountMinor)}. These add up to Rs ${rupees(total)}`);
    }
    let id = nextId(tranches);
    const created = rows
      .map((t, i) => ({ ...pick(t, TRANCHE_FIELDS), sequenceNo: Number(t.sequenceNo ?? i + 1) }))
      .sort(bySequence)
      .map((t: any, i) => ({
        // Like the real service, the planned release is stamped at set-up.
        ...t, plannedAt: Date.now(), id: id++, awardId: award.id, currencyCode: t.currencyCode ?? award.currencyCode, isMilestoneMet: t.isMilestoneMet ?? false,
        state: i === 0 ? 'PLANNED' : 'LOCKED',
      }));
    tranches.push(...created);
    // Like the real service, set-up starts the grant.
    award.state = 'ACTIVE';
    return okRes({ ...award, tranches: created });
  }
  if ((r = m(/^\/api\/v1\/awards\/(\d+)\/close$/)) && req.method === 'POST') {
    const award = byId(awards, r[1]); if (!award) return notFound(`Award not found: ${r[1]}`);
    if (award.state === 'COMPLETED') return refuse('This award is already closed');
    if (award.state !== 'ACTIVE') return refuse(`Only an ACTIVE grant can be closed. This one is ${award.state}`);
    const own = ofAward(award.id);
    if (!own.length) return refuse('This award has no tranches yet. It closes once its tranches are set up, paid and utilised');
    const open = own.filter(t => t.state !== 'UTILISED').length;
    if (open) {
      return refuse(`${open} of ${own.length} tranches ${open === 1 ? 'is' : 'are'} not utilised yet — an award closes once every tranche is utilised`);
    }
    award.state = 'COMPLETED';
    return okRes(award);
  }
  if ((r = m(/^\/api\/v1\/awards\/(\d+)$/)) && req.method === 'GET') {
    const award = byId(awards, r[1]); return award ? okRes(award) : notFound(`Award not found: ${r[1]}`);
  }

  // ── Tranches ──
  if ((r = m(/^\/api\/v1\/tranches\/(\d+)\/(tranche-plan|tranche-report)$/)) && req.method === 'GET') {
    const kind = KINDS[`${r[2]}s` as KindPath];
    const doc = kind.rows.find(x => x.trancheId === +r![1]);
    return doc ? okRes(doc) : notFound(`Tranche ${r[1]} has no ${kind.what} yet`);
  }
  if ((r = m(/^\/api\/v1\/tranches\/(\d+)\/release$/)) && req.method === 'POST') {
    const t = byId(tranches, r[1]); if (!t) return notFound(`Tranche not found: ${r[1]}`);
    const n = t.sequenceNo;
    if (t.state === 'LOCKED') {
      return refuse(`Tranche ${n} is LOCKED, and a locked tranche can’t be skipped to. It opens once tranche ${n - 1} is utilised`);
    }
    if (t.state === 'PLANNED') {
      const plan = tranchePlans.find(x => x.trancheId === t.id);
      return refuse(`Tranche ${n} is released once its plan is approved. ${plan ? `Its plan is ${plan.state}` : 'The grantee hasn’t submitted one yet'}`);
    }
    if (t.state === 'PAID' || t.state === 'UTILISED') return refuse(`Tranche ${n} has already been released. It’s ${t.state}`);
    if (t.state !== 'READY') return refuse(`A tranche is released from READY. Tranche ${n} is ${t.state}`);
    const reference = param('paymentReference');
    if (!reference) return refuse('A payment reference (the bank’s UTR) is required to release a tranche');
    Object.assign(t, { state: 'PAID', paidAt: Date.now(), paymentReference: reference }, param('paymentMode') ? { paymentMode: param('paymentMode') } : {});
    return okRes(t);
  }
  if ((r = m(/^\/api\/v1\/tranches\/(\d+)$/)) && req.method === 'GET') {
    const t = byId(tranches, r[1]); return t ? okRes(t) : notFound(`Tranche not found: ${r[1]}`);
  }

  // ── Plans and reports ──
  if ((r = m(/^\/api\/v1\/(tranche-plans|tranche-reports)$/)) && req.method === 'POST') {
    const kind = KINDS[r[1] as KindPath];
    const column = ([['trancheId', 'tranche_id'], ['state', 'state'], ['attempt', 'attempt']] as const).find(([k]) => b[k] == null);
    if (column) return sqlNull(column[1]);
    const t = byId(tranches, b.trancheId); if (!t) return notFound(`Tranche not found: ${b.trancheId}`);
    const n = t.sequenceNo;
    if (kind.rows.some(x => x.trancheId === t.id)) {
      return refuse(`Tranche ${n} already has a ${kind.what} (one per tranche). Use PUT /${r[1]} to amend it`);
    }
    if (t.state !== kind.opensWhen) {
      if (t.state === 'LOCKED') return refuse(`Tranche ${n} is LOCKED until tranche ${n - 1} is utilised, so it can’t have a ${kind.what} yet`);
      return refuse(kind.what === 'plan'
        ? `A plan is written while the tranche is PLANNED. Tranche ${n} is ${t.state}`
        : `A report is written once the tranche is PAID. Tranche ${n} is ${t.state}`);
    }
    const doc = { ...pick(b, kind.fields), id: nextId(kind.rows) };
    kind.rows.push(doc);
    t[kind.link] = doc.id;
    return okRes(doc, 201);
  }
  if ((r = m(/^\/api\/v1\/(tranche-plans|tranche-reports)$/)) && req.method === 'PUT') {
    // Amends fields; state only moves through the transitions, so a PUT that changes it is refused (§6).
    const kind = KINDS[r[1] as KindPath];
    const doc = byId(kind.rows, b.id); if (!doc) return notFound(`Tranche ${kind.what} not found: ${b.id}`);
    if (b.state != null && b.state !== doc.state) {
      return refuse(`A state change is not allowed on PUT ({${doc.state}} -> {${b.state}}). `
        + `Use one of: POST /api/v1/${r[1]}/{id}/approve | /request-changes | /resubmit`);
    }
    Object.assign(doc, pick(b, kind.fields.filter(k => k !== 'trancheId' && k !== 'state')));
    return okRes(doc);
  }
  if ((r = m(/^\/api\/v1\/(tranche-plans|tranche-reports)\/(\d+)\/(tranche-plan-items|tranche-report-items)$/)) && req.method === 'GET') {
    const kind = KINDS[r[1] as KindPath];
    return page(kind.items.filter(i => i[kind.link] === +r![2]).sort((x, y) => (x.orderNo ?? x.id) - (y.orderNo ?? y.id)));
  }
  if ((r = m(/^\/api\/v1\/(tranche-plans|tranche-reports)\/(\d+)\/(approve|request-changes|resubmit)$/)) && req.method === 'POST') {
    const kind = KINDS[r[1] as KindPath];
    const doc = byId(kind.rows, r[2]); if (!doc) return notFound(`Tranche ${kind.what} not found: ${r[2]}`);
    const t = byId(tranches, doc.trancheId);
    const comment = param('comment');
    if (r[3] === 'approve') {
      if (doc.state !== 'SUBMITTED') return refuse(`A ${kind.what} is approved from SUBMITTED. This one is ${doc.state}`);
      Object.assign(doc, { state: 'APPROVED', reviewedAt: Date.now(), reviewedByUserId: myId });
      // The approval's own comment, or none: an earlier "please change…" mustn't read as the approval note.
      if (comment) doc.reviewComment = comment; else delete doc.reviewComment;
      if (kind.what === 'plan') {
        // The only thing that makes a tranche READY.
        if (t?.state === 'PLANNED') t.state = 'READY';
      } else if (t) {
        if (t.state === 'PAID') t.state = 'UTILISED';
        const next = ofAward(t.awardId).find(x => x.sequenceNo > t.sequenceNo);
        if (next?.state === 'LOCKED') next.state = 'PLANNED';
      }
      return okRes(doc);
    }
    if (r[3] === 'request-changes') {
      if (!comment) return refuse('A comment is required — the grantee sees it and needs to know what to change');
      if (doc.state !== 'SUBMITTED') return refuse(`Changes are requested on a SUBMITTED ${kind.what}. This one is ${doc.state}`);
      Object.assign(doc, {
        state: 'CHANGES_REQUESTED', attempt: (doc.attempt ?? 1) + 1, reviewComment: comment, reviewedAt: Date.now(), reviewedByUserId: myId,
      });
      return okRes(doc);
    }
    if (doc.state !== 'CHANGES_REQUESTED') return refuse(`Only a ${kind.what} with changes requested can be resubmitted. This one is ${doc.state}`);
    Object.assign(doc, { state: 'SUBMITTED', submittedAt: Date.now() });
    return okRes(doc);
  }
  if ((r = m(/^\/api\/v1\/(tranche-plans|tranche-reports)\/(\d+)$/)) && req.method === 'GET') {
    const kind = KINDS[r[1] as KindPath];
    const doc = byId(kind.rows, r[2]); return doc ? okRes(doc) : notFound(`Tranche ${kind.what} not found: ${r[2]}`);
  }

  // ── Plan and report items ──
  if ((r = m(/^\/api\/v1\/(tranche-plan-items|tranche-report-items)$/)) && req.method === 'POST') {
    const kind = KINDS[ITEM_PATHS[r[1]]];
    if (!byId(kind.rows, b[kind.link])) return notFound(`Tranche ${kind.what} not found: ${b[kind.link]}`);
    const item = { ...pick(b, kind.itemFields), id: nextId(kind.items) };
    kind.items.push(item);
    return okRes(item, 201);
  }
  if ((r = m(/^\/api\/v1\/(tranche-plan-items|tranche-report-items)\/(\d+)$/))) {
    const kind = KINDS[ITEM_PATHS[r[1]]];
    const item = byId(kind.items, r[2]); if (!item) return notFound(`Tranche ${kind.what} item not found: ${r[2]}`);
    if (req.method === 'DELETE') { kind.items.splice(kind.items.indexOf(item), 1); return okRes(null, 204); }
    if (req.method === 'GET') return okRes(item);
  }
  return null;
}

export const mockIamInterceptor: HttpInterceptorFn = (req, next) => {
  if (APP_CONFIG.mockApi && req.url.startsWith(APP_CONFIG.grantBaseUrl)) {
    // Every method (GET, POST, PUT, DELETE) goes through grantRoute; anything it doesn't know falls through to the network.
    const handled = grantRoute(req, req.url.slice(APP_CONFIG.grantBaseUrl.length).split('?')[0]);
    if (handled) return handled;
  }
  if (!APP_CONFIG.mockApi || !req.url.startsWith(APP_CONFIG.iamBaseUrl)) return next(req);
  const path = req.url.slice(APP_CONFIG.iamBaseUrl.length);
  // Simulate the IAM gateway being down: localStorage.setItem('gm-mock-iam-down', '1'), then refresh.
  if (localStorage.getItem('gm-mock-iam-down')) return fail(503, 'Service Unavailable');
  return route(req, path).pipe(delay(500));
};

function route(req: HttpRequest<any>, path: string): Observable<any> {
  const b = req.body ?? {};
  const me = users.find(u => u.id === sessions.get(req.headers.get(APP_CONFIG.sessionHeader) ?? ''));
  const p = (k: string) => req.params.get(k) ?? '';

  const activate = path.match(/^\/api\/v1\/signup\/user\/([^/]+)\/activate$/);
  if (req.method === 'POST' && activate) {
    const lead = leads.get(b.key);
    if (!lead) return fail(404, 'Signup request not found');
    if (b.otp !== OTP) return fail(401, 'Invalid or expired OTP');
    if (!tenants.some(t => t.tenantLogin === activate[1])) return fail(404, 'Tenant not found');
    const u = addUser(lead, req, activate[1], false);
    return session(u.id, { id: u.id, login: u.login }, 201);
  }

  switch (`${req.method} ${path}`) {
    case 'GET /api/v1/api-keys/session':
      return session(0, {});
    case 'POST /api/v1/security/login': {
      const u = users.find(x => x.login === b.userLogin && x.tenantLogin === b.tenantLogin);
      return u && u.password === b.password ? session(u.id, null) : fail(401, 'Invalid credentials');
    }
    case 'POST /api/v1/security/logout':
      sessions.delete(req.headers.get(APP_CONFIG.sessionHeader) ?? '');
      save();
      return ok(null);
    case 'GET /api/v1/session/context': {
      if (!me) return fail(401, 'Session expired');
      const t = tenants.find(x => x.tenantLogin === me.tenantLogin)!;
      const token: PlatformToken = {
        tenantContext: { tenantId: t.id, tenantLogin: t.tenantLogin, tenantName: t.tenantName },
        userContext: { userId: me.id, username: me.login, name: me.name, authorities: me.admin ? [`role.${t.tenantLogin}.admin`] : [] },
      };
      return ok(token);
    }
    case 'GET /api/v1/tenants/me':
      return me ? ok(tenants.find(x => x.tenantLogin === me.tenantLogin)) : fail(401, 'Session expired');
    case 'GET /api/v1/tenants/login': {
      const t = tenants.find(x => x.tenantLogin === p('loginName'));
      return t ? ok(t) : fail(404, 'Tenant not found');
    }
    case 'PATCH /api/v1/tenants': {
      const t = tenants.find(x => x.id === b.id);
      if (!me?.admin || !t || t.tenantLogin !== me.tenantLogin) return fail(403, 'Forbidden');
      t.tenantType = b.tenantType;
      return ok(null);
    }
    case 'GET /api/v1/signup/exists': {
      const found = users.filter(u => u.login === p('email'))
        .map(u => tenants.find(t => t.tenantLogin === u.tenantLogin)!)
        .map(t => ({ id: t.id, login: t.tenantLogin, name: t.tenantName }));
      return ok({ tenants: found, tenantPresent: found.length > 0, leadPresent: false });
    }
    case 'PATCH /api/v1/security/forget':
      return ok(crypto.randomUUID());
    case 'PATCH /api/v1/security/reset': {
      if (b.otp !== OTP) return fail(401, 'Invalid or expired OTP');
      const u = users.find(x => x.login === b.userLogin && x.tenantLogin === b.tenantLogin);
      if (u) u.password = b.password;
      return ok(null);
    }
    case 'POST /api/v1/signup/register':
    case 'POST /api/v1/signup/register/user': {
      const key = crypto.randomUUID();
      leads.set(key, b);
      return ok({ key, messageId: crypto.randomUUID() });
    }
    case 'PATCH /api/v1/lead/otp/re-send':
      return ok({ key: p('key') });
    case 'POST /api/v1/signup/tenant/markify2': {
      const lead = leads.get(b.key);
      if (!lead) return fail(404, 'Signup request not found');
      if (b.otp !== OTP) return fail(401, 'Invalid or expired OTP');
      const login = slugify(String(lead.organizationName));
      if (tenants.some(t => t.tenantLogin === login)) return fail(409, 'Organisation ID is taken');
      const t: Tenant = { id: tenants.length + 1, tenantLogin: login, tenantName: lead.organizationName, tenantType: 'BSP' };
      tenants.push(t);
      const u = addUser(lead, req, login, true);
      return session(u.id, t, 201);
    }
    case 'POST /api/v1/user-verification/not-reviewed':
      pending.add(+p('userId'));
      return ok({ id: +p('userId'), userId: +p('userId'), verificationStatus: 'NOT_REVIEWED' });
    case 'GET /api/v1/user-verification': {
      const id = +p('userId');
      if (!pending.has(id)) return fail(404, 'Not found');
      if (localStorage.getItem('gm-mock-approve')) { pending.delete(id); return ok({ id, userId: id, verificationStatus: 'APPROVED' }); }
      return ok({ id, userId: id, verificationStatus: 'NOT_REVIEWED' });
    }
  }
  return fail(404, 'Not mocked');
}

function addUser(lead: any, req: HttpRequest<any>, tenantLogin: string, admin: boolean): MockUser {
  const u: MockUser = {
    id: users.length + 1, login: lead.email, name: lead.leadContactPersonName,
    password: req.headers.get('X-PASS') ?? '', tenantLogin, admin,
  };
  users.push(u);
  leads.delete(req.body.key);
  return u;
}

function session(userId: number, body: unknown, status = 200) {
  const id = crypto.randomUUID();
  sessions.set(id, userId);
  save();
  return of(new HttpResponse({ status, body, headers: new HttpHeaders({ [APP_CONFIG.sessionHeader]: id }) }));
}
const ok = (body: unknown) => of(new HttpResponse({ status: 200, body }));
const fail = (status: number, message: string) =>
  throwError(() => new HttpErrorResponse({ status, error: { message } })).pipe(delay(500));

// Persist mock sessions so a page reload keeps you signed in (users created this page-load are not persisted).
function load(): [string, number][] {
  try { return JSON.parse(localStorage.getItem('gm-mock-sessions-v3') ?? '[]'); } catch { return []; }
}
function save() {
  try { localStorage.setItem('gm-mock-sessions-v3', JSON.stringify([...sessions])); } catch {}
}

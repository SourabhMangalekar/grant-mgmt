# commons-grant-service — how the backend behaves

**For:** the Commons.Grants front-end team
**Base URL:** `<host>/commons-grant-service`
**Last verified:** 7 October 2026, against the running service

Everything in this document was checked against the live service on the day it was written, not
read off the schema. Where the schema comment and the behaviour disagree, the behaviour is what is
written here, and the disagreement is called out.

---

## 1. The five things that cause most of the confusion

Read these first. Nearly every question we have been asked traces back to one of them.

1. **A funder and an applicant are different IAM tenants.** Almost every read is scoped to the
   caller's tenant. What crosses that boundary is listed in §4 — it is a short list, and everything
   not on it does not cross.
2. **State is never changed by `PUT`.** It moves through named transition endpoints that check
   preconditions. A `PUT` that changes `state` is refused (§6).
3. **State values are plain strings with no validation.** An unknown one is stored happily and then
   matches nothing (§5). This is how `OPEN` and `SELECTED` got as far as a request.
4. **Unknown JSON fields are silently discarded.** A misspelled field name produces no error at all;
   the write simply does not include it (§7).
5. **A page has `totalElements` and `elements`. There is no `content` and no `hasNext`** (§3).

---

## 2. Authentication

Every request needs the IAM session id as a header:

```
X-SESSIONID: <session id>
```

Sign in against IAM, not against this service. The session id comes back in the **`X-SESSIONID`
response header**, not in the body — the login response has no body.

```
POST  <iam>/api/v1/security/login
      X-APPKEY: <app key>
      {"userLogin": "...", "tenantLogin": "...", "password": "..."}
→ 200, and the session id is in the X-SESSIONID response header
```

Without the header:

```json
{"errorCode":"ERR_PLATFORM_GEN_UNAUTHENTICATED","errorMessage":"SessionId is missing"}
```

**One route needs no session at all:** `GET /api/v1/public/marketplace` and
`GET /api/v1/public/marketplace/sources`. GET only — a write under that prefix is still rejected.

CORS is configured for browser use, including on error responses. If a failed request shows nothing
in your code, check that you are reading the body off the **error** object (`error.error` in
Angular, `error.response.data` in axios) — the server does send a JSON body with every 4xx and 5xx.

---

## 3. Envelopes

### A page

```json
{ "elements": [ ... ], "totalElements": 42 }
```

- The collection key is **`elements`**, not `content`.
- **`hasNext` is not serialised.** Do not look for it. Page using `totalElements` against your
  `page`/`size`.
- `totalElements` is the real count of the whole collection, not the page.

Query parameters are `page` (zero-based) and `size`.

### An error

```json
{ "errorCode": "ERR_PLATFORM_GEN_NOT_FOUND", "errorMessage": "Application not found: 99123456" }
```

| errorCode | HTTP | Means |
|---|---|---|
| `ERR_PLATFORM_GEN_UNAUTHENTICATED` | 401 | No session, or an expired one |
| `ERR_PLATFORM_GEN_INVALID_INPUT` | 400 | A guard refused. `errorMessage` says which and why — show it to the user |
| `ERR_PLATFORM_GEN_NOT_FOUND` | 404 | Does not exist, or is not yours. Deliberately indistinguishable |
| `ERR_PLATFORM_GEN_UNKNOWN` | 500 | Something unhandled. If you see one, tell us — it is a bug |

**`errorMessage` on a 400 is written to be shown to a user.** It names the rule and what to do
about it. Do not replace it with your own wording.

### Status codes

| | |
|---|---|
| `POST` creating a row | **201** |
| `POST` a transition (`/approve`, `/submit`, …) | **200** |
| `PUT` | 200 |
| `DELETE` | 204 (it is a soft delete — the row is deactivated, not removed) |

---

## 4. Tenancy: what crosses, and what does not

A grant call belongs to the **funder's** tenant. An application, its budget, its documents and the
applicant's organisation belong to the **applicant's** tenant. By default a read only ever returns
rows in the caller's own tenant, which is why so much came back empty.

### What crosses, today

| Direction | Endpoint | Rule |
|---|---|---|
| Applicant sees funders' calls | `GET /grant-calls/open`, `GET /grant-calls/open/{id}` | Only calls that are `PUBLISHED`, active, and before their deadline |
| Applicant checks eligibility | `GET /grant-calls/{id}/eligibility?organisationId=` | Same set of calls |
| Applicant applies | `POST /applications` | The **call** may be another tenant's. The **organisation** must be your own |
| Applicant submits | `POST /applications/{id}/submit` | Entry checks, award range and deadline all come from the funder's call |
| Funder sees its inbox | `GET /grant-calls/{id}/applications` | You must own the call |
| Funder opens one | `GET /applications/{id}` | You must own the call it was sent to |
| Funder reads its parts | `…/application-budget-lines`, `…/application-result-rows`, `…/application-documents`, `…/reviews`, `…/application-questions`, `…/committee-minute`, `…/award` | Same rule |
| Funder acts | `/start-review`, `/send-to-committee`, `/approve`, `/reject` | Same rule |
| Funder writes | `POST /reviews`, `POST /application-questions`, `POST /committee-minutes` | Same rule |

**The rule in one sentence:** you reach an application through the call you own. Authorization is
always checked before any boundary is crossed, so a call that is not yours gives a 404 and nothing
below it is reachable.

### What does not cross, on purpose

- **`PUT /applications`.** Editing a proposal is the applicant's right. A funder changes the
  application's *state* through the transitions, and nothing else about it. This is not an
  oversight and we do not intend to change it.
- **`GET /applications`** (the plain collection) is your own tenant's applications. A funder uses
  `GET /grant-calls/{id}/applications` instead.
- **`GET /organisations`** stays tenant-scoped.

### What does not cross yet

**Everything after the award.** Awards, tranches, tranche plans, tranche reports and utilisation
certificates are still tenant-scoped. Once an application is approved, the two sides stop seeing the
same records. If you are demonstrating the post-award flow, run both parties in **one** tenant until
we have fixed it. This is the last known tenancy gap.

---

## 5. States

Every `state` column is a plain `VARCHAR` with **no enum and no validation**. An unknown value is
accepted, stored verbatim, and then matches no filter and no guard. We confirmed this: posting
`"state": "BANANA"` returns 201 and stores `BANANA`.

So treat these as closed sets by convention. The only one the server currently validates is
`GrantCall.state`, which rejects anything outside its three values with a 400.

### Grant call — `DRAFT | PUBLISHED | CLOSED`

**It is `PUBLISHED`, not `OPEN`.** `PUBLISHED` is what makes a call visible to applicants and is
what `/submit` requires. This one is validated: an unknown value returns

```
400  Unknown grant call state 'OPEN'. Use one of [DRAFT, PUBLISHED, CLOSED].
     A call is made public by PUBLISHED, not OPEN.
```

### Application — `DRAFT | SUBMITTED | SCREENING | INELIGIBLE | UNDER_REVIEW | COMMITTEE | APPROVED | REJECTED`

You set only the first two. The rest are set by transitions.

| State | Set by |
|---|---|
| `DRAFT` | you, on create |
| `SUBMITTED` | you, on a re-submit; a new application should be `DRAFT` |
| `SCREENING` | `/submit`, when every entry-check rule passed |
| `INELIGIBLE` | `/submit`, when a rule failed. **Terminal** — it can never be reviewed |
| `UNDER_REVIEW` | `/start-review` |
| `COMMITTEE` | `/send-to-committee` |
| `APPROVED` | `/approve` — also creates the award |
| `REJECTED` | `/reject` |

> The schema comment on this column is **wrong**. It omits `DRAFT` and `COMMITTEE`, and lists
> `REVIEWED`, which nothing in the service sets or checks. Use the table above.

### The rest

| Entity | States |
|---|---|
| Review | `ASSIGNED \| SUBMITTED \| RECUSED` |
| Award | `DUE_DILIGENCE \| CONTRACTED \| ACTIVE \| COMPLETED` |
| Tranche | `LOCKED \| PLANNED \| READY \| PAID \| UTILISED`. The schema comment lists `APPROVED` here; the service never sets it, and omits `LOCKED`, which it uses throughout |
| Tranche plan / report | `DRAFT \| SUBMITTED \| APPROVED \| CHANGES_REQUESTED` |
| Tranche report item | `DONE \| PARTLY_DONE \| NOT_DONE` (field is `deliveryState`) |
| Utilisation certificate | `SUBMITTED \| ACCEPTED \| RETURNED` |
| Org registration | `UNVERIFIED \| SELF_DECLARED \| DOC_VERIFIED` (field is `verificationState`) |

---

## 6. Transitions: the only way state moves

A `PUT` that changes `state` is refused:

```
400  A state change is not allowed on PUT ({APPROVED} -> {REJECTED}).
     Use one of: POST /api/v1/applications/{id}/submit | /start-review
     | /send-to-committee | /approve | /reject
```

A `PUT` whose `state` equals the row's current value **succeeds** — it reads as "I did not touch
state". Safest is to leave `state` out of your `PUT` bodies entirely.

### The application journey

```
DRAFT ──/submit──► SCREENING ──/start-review──► UNDER_REVIEW
                        │                             │
                        └──► INELIGIBLE               ├──/send-to-committee──► COMMITTEE
                             (terminal)                                            │
                                                             /approve ◄────────────┤
                                                             /reject  ◄────────────┘
```

| Transition | Preconditions, and what you get back if they are not met |
|---|---|
| `POST /applications/{id}/submit` | From `DRAFT` or `SUBMITTED`. The call must be `PUBLISHED` and before its deadline; the ask must be inside the call's min/max; duration must be 6, 12, 18 or 24 months; a `CUSTOM` call's answers must fit its questions. Runs the entry checks and lands on `SCREENING` or `INELIGIBLE` |
| `POST /applications/{id}/start-review` | From `SCREENING` only. `INELIGIBLE` is refused outright: *"failed its entry checks and cannot be reviewed"* |
| `POST /applications/{id}/send-to-committee?overrideDisagreement=&comment=` | From `UNDER_REVIEW`. Needs the call's `reviewersRequired` count of `SUBMITTED` reviews — *"0 of 2 reviews submitted — the committee cannot sit yet"*. If reviewers disagree materially (different recommendations, or any score apart by 2+) it refuses until you resend with `overrideDisagreement=true` **and** a comment, which is recorded |
| `POST /applications/{id}/approve?amountMinor=&comment=` | From `COMMITTEE`. `comment` is required — *"the applicant sees it"*. `amountMinor` must be inside the call's range. **Creates the award automatically** |
| `POST /applications/{id}/reject?comment=` | From `COMMITTEE`. A reason is required |

### The money journey

```
award ──/set-up-tranches──► tranche 1 PLANNED, the rest LOCKED
   plan SUBMITTED ──/tranche-plans/{id}/approve──► tranche READY
   tranche READY  ──/tranches/{id}/release──────► tranche PAID
   report SUBMITTED ──/tranche-reports/{id}/approve──► tranche UTILISED, next unlocks
```

| Transition | Notes |
|---|---|
| `POST /awards/{id}/set-up-tranches` | Body is an array. **2, 3 or 4 tranches**, percentages adding to 100. Done once |
| `POST /tranche-plans/{id}/approve?comment=` | From `SUBMITTED`. This is the **only** thing that makes a tranche `READY` |
| `POST /tranche-plans/{id}/request-changes?comment=` | A comment is required. Bumps `attempt` |
| `POST /tranche-plans/{id}/resubmit` | Only from `CHANGES_REQUESTED` |
| `POST /tranches/{id}/release?paymentReference=&paymentMode=` | Needs an approved plan and a UTR. A `LOCKED` tranche cannot be skipped to |
| `POST /tranche-reports/{id}/approve?comment=` | Utilises the tranche and unlocks the next |
| `POST /awards/{id}/close?comment=` | Refused while any tranche is unutilised |

The report endpoints mirror the plan ones.

---

## 7. Writing: the traps

### Unknown fields are discarded in silence

A misspelled field name produces **no error**. We posted a review containing `"madeUpField"` and got
a clean 201 with the field ignored. If a value is not arriving, check the spelling before anything
else — the API will not tell you.

### Null is never sent; a field is simply absent

A field with no value is **omitted from the response JSON** rather than sent as `null`. Code for the
key being missing.

### Required fields, by entity

These are `NOT NULL` with no default. Omit one and you get a 500 carrying
`SQLIntegrityConstraintViolationException`, which is the clearest signal you have missed one.

| Entity | You must send |
|---|---|
| `applications` | `referenceCode`, `title`, `state`, `grantCallId`, `organisationId`, `disagreementFlagged` |
| `grant-calls` | `callCode`, `title`, `state`, `currencyCode`, `envelopeAmountMinor`, `opensAt`, `closesAt`, `reviewersRequired`, `scheduleViiCode`, `responseFormat`, `budgetFormat`, `isCsrFunded`, `isForeignFunded` |
| `organisations` | `legalName`, `orgType`, `kind` |
| `reviews` | `applicationId`, `reviewerUserId`, `state` |
| `awards` | `applicationId`, `awardCode`, `state`, `awardedAmountMinor`, `currencyCode`, `bankAccountVerified`, `auditedYearsOnFile` |
| `org-registrations` | `organisationId`, `registrationType`, `registrationNumber`, `verificationState` |
| `vault-documents` | `organisationId`, `docType`, `fileName`, `uploadedAt` |
| `application-budget-lines` | `applicationId`, `item`, `amountMinor` |
| `application-result-rows` | `applicationId`, `framework`, `level`, `narrative` |
| `application-questions` | `applicationId`, `body`, `sentAt` |
| `committee-minutes` | `applicationId`, `body` |
| `tranche-plans` / `tranche-reports` | `trancheId`, `state`, `attempt` |

> **Correction to something we told you earlier:** `conflictDeclared` is **not** required on a
> review — there is no such column. We were wrong. A review with only `applicationId`,
> `reviewerUserId` and `state` is accepted.

### Booleans

Boolean columns are `BIT NOT NULL`. If your DTO omits one, Hibernate writes `null` and the insert
fails. Always send `disagreementFlagged`, `isCsrFunded`, `isForeignFunded`, `bankAccountVerified`
explicitly — including when the value is `false`.

### Money and dates

- **All money is in minor units.** ₹12,00,000 is `120000000`. Never send rupees.
- **All timestamps are epoch milliseconds**, as numbers.
- `targetDate` on an OKR key result is the exception: it is a date string, `YYYY-MM-DD`.

### One-to-one constraints

A tranche has at most one plan, one report and one certificate. An application has at most one set
of committee minutes. A second `POST` is refused with a clear 400, not a 500 — use `PUT` to amend.

---

## 8. Reading: endpoints you will actually use

### Finding grants (applicant)

| | |
|---|---|
| `GET /grant-calls/open?theme=&page=&size=` | Published, open calls from **every** funder |
| `GET /grant-calls/open/{id}` | One of them. 404 if it is a draft, closed, or unknown — all three look the same |
| `GET /grant-calls/{id}/eligibility?organisationId=` | The ✓/✕ **per rule** before applying. Read-only; nothing is created |
| `GET /organisations/{id}/eligibility?callIds=1,2,3` | The same verdict for many calls at once, for a list screen |
| `GET /marketplace?scope=&theme=&stateCode=&q=&sort=&organisationId=&page=&size=` | Calls here plus external grants. `scope` is `ALL \| HERE \| EXTERNAL \| SAVED`; `sort` is `MATCH \| CLOSING \| SIZE` |
| `GET /public/marketplace?...` | The same cards with **no session**, minus match scores, saved marks and call ids |

### Tracking (applicant)

| | |
|---|---|
| `GET /applications?page=&size=` | Your own applications |
| `GET /organisations/{id}/applications` | The same, for one organisation |
| `GET /applications/{id}/application-questions` | What the funder asked |
| `PUT /application-questions` | The applicant's reply: `{id, replyBody, repliedAt}`. One reply per question |

### The inbox (funder)

| | |
|---|---|
| `GET /grant-calls/{id}/applications?page=&size=` | Applications sent to **your** call, whatever tenant they came from |
| `GET /applications/inbox?state=&grantCallId=&page=&size=` | The same, filtered. `state=ALL` for everything |
| `GET /applications/counts-by-state` | The tab counts in one call |
| `GET /applications/{id}` + its sub-resources | The full proposal (see §4) |

### Dashboards

`GET /dashboard/overview`, `/dashboard/by-theme`, `/dashboard/needs-attention`.

### The audit trail

`GET /decision-log-entries?page=&size=` — append-only, **ordered oldest first**. For recent
activity you must read the **last** page: ask for `size=1` to learn `totalElements`, then request
page `floor((total-1)/size)`. Asking for page 0 gives you the beginning of history, which looks
plausible and is wrong.

Rows carry `entityType`, `entityId`, `fromState`, `toState`, `comment`, `actorUserId`, `actedAt`.
Resolve names yourself from the entity collections — the log stores ids only, and it outlives the
rows it describes, so expect ids that no longer resolve.

---

## 9. Response and budget formats

A call declares how applicants must answer. Your form must follow `responseFormat`:

| `responseFormat` | What the applicant fills in |
|---|---|
| `NARRATIVE` | Free text |
| `CUSTOM` | The call's own questions, in `questionsJson` |
| `LOGFRAME` | Rows at levels `GOAL, OUTCOME, OUTPUT, ACTIVITY` |
| `THEORY_OF_CHANGE` | Rows at `PROBLEM, ACTIVITY, OUTPUT, OUTCOME, IMPACT` |
| `OKR` | One `OBJECTIVE` with `initiatives`, then `KEY_RESULT` rows with `targetValue` and `targetDate`, each carrying `parentRowId` pointing at the objective |

Rows go to `POST /application-result-rows` with `framework`, `level`, `orderNo`, `narrative`.

`questionsJson` is a JSON array of `{id, label, type, required, limit, options}`. `type` is
`SHORT | LONG | NUMBER | DATE | SINGLE_CHOICE | MULTI_CHOICE`. **A `LONG` question must carry a
`limit` above zero** — the server refuses a published `CUSTOM` call otherwise. Answers go back in
`answersJson`, keyed by question id, and the server checks them against the form at `/submit`.

| `budgetFormat` | What to collect |
|---|---|
| `LINE_ITEM` | Rows in `application-budget-lines` |
| `LONGITUDINAL` | The same rows, each with a `periodLabel`; the call's `budgetPeriod` is `MONTHLY` or `QUARTERLY` |
| `APPROX_TOTAL` | A single total plus `budgetNote` |
| `EXCEL_TEMPLATE` | A single total plus `budgetFileRef` |

Set `budgetTotalMinor` on the application for **every** format.

---

## 10. Eligibility rules

A call's `rulesJson` is an array. The engine evaluates every rule and reports each one, so an
applicant is told everything that is wrong, not just the first thing.

```json
[{"type":"cert","value":"12A"},
 {"type":"cert","value":"80G"},
 {"type":"state","values":["Karnataka"]},
 {"type":"minYears","value":3}]
```

The verdict comes back as `entryCheckReason`, a JSON array of `{rule, pass, reason}` — the same
shape from `/eligibility` before applying and from the application after submitting, so one
renderer serves both.

> Note the two vocabularies, which look like an inconsistency and are not: rules say `12A` and
> `80G`, while an organisation's registrations use `SEC_12A`, `SEC_80G`, `CSR_1`, `FCRA`. The
> engine maps between them.

---

## 11. Known issues

Things that will bite you, which we have not fixed yet.

| | |
|---|---|
| **Post-award is tenant-scoped** | Awards, tranches, plans, reports and certificates do not cross tenants. Demo the post-award flow with both parties in one tenant |
| **`Application.state` is unvalidated** | An unknown value is stored and then matches nothing. Only `GrantCall.state` is checked |
| **A non-numeric id gives a 500** | `GET /grant-calls/abc` returns `NumberFormatException` rather than a 400 |
| **State data is inconsistent** | Calls name states in full (`Karnataka`); external grants use codes (`KA`). They do not match each other, so a filter value finds one or the other |
| **Hand-written endpoints are missing from Swagger** | Anything on a `ControllerExt` — the transitions, `/open`, `/eligibility`, the dashboards, the public marketplace — does not appear in `/v2/api-docs`. Swagger shows the generated CRUD only. Use this document for those |
| **Swagger's "try it out" does not send a session** | There is no auth box wired up, so requests from that page return 401 |

---

## 12. If something looks wrong

Send us the **request** and the **response body**, not a screenshot of the console. The
`errorMessage` almost always names the rule that refused and what to do instead, and a 404 on a
cross-tenant read means something different from a 404 on an id that does not exist — we can tell
which from the body.

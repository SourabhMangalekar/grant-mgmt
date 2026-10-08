# commons-grant-service — cross-tenant access for calls and applications

| | |
|---|---|
| **For** | commons-grant-service backend |
| **From** | Commons.Grants frontend (`grant-management`, Angular) |
| **Date** | 2026-10-07 |
| **Priority** | P0 blocks grantees from seeing and applying to calls (§4.1, §4.1b). P1 blocks funders from seeing proposals sent to them (§4.2). |

## TL;DR

In Commons.Grants, **funders (granters) and applicants (grantees) are different IAM tenants**. The tenant type is `TENANT_TYPE.GRANTER` or `TENANT_TYPE.GRANTEE`. The grant service is CodeMill-generated, so every standard read is filtered to the caller's tenant. That means data never crosses from a funder to an applicant or back:

1. **P0:** a grantee cannot see any funder's published calls for proposals, and creating an application against one fails with `GrantCall not found` (§4.1b).
2. **P1:** once a grantee applies, the funder cannot see the application on its own call, or review, approve or reject it.

**Ask:** add two read-only endpoints for published calls (§4.1). Then let a funder reach the applications on its own calls (§4.2). The frontend already calls the new endpoints, so nothing changes on our side when they ship.

---

## 1. Who creates what

| Entity | Created by | Saved with `tenant_id` of | Must also be visible to |
|---|---|---|---|
| `GrantCall` | Funder | Funder | **Every grantee** (only when published) |
| `Organisation`, `Application`, `ApplicationBudgetLine`, `ApplicationDocument`, `ApplicationResultRow` | Grantee | Grantee | **The funder that owns the call** |
| `Review` | Funder (its reviewers) | Funder | Nobody else; reviews stay internal to the funder |
| `Award`, `Tranche` | Funder | Funder | The grantee, for its own application (see §5) |
| `TranchePlan`, `TrancheReport`, `UtilisationCertificate` | Grantee | Grantee | The funder (see §5) |

## 2. Reproduce

Observed in the app: the funder's call **#44** shows as open to the funder (closes 20 Nov 2026). A grantee's **Open calls** page shows **0 calls**, and the browser does make the request below.

```bash
BASE=https://c520-49-200-149-202.ngrok-free.app/commons-grant-service   # current ngrok tunnel

# 1. As the funder: the call is listed
curl -s "$BASE/api/v1/grant-calls?page=0&size=100" -H "X-SESSIONID: <funder session>" -H "ngrok-skip-browser-warning: true"

# 2. As any grantee: expected to be empty → {"elements":[],"totalElements":0}
curl -s "$BASE/api/v1/grant-calls?page=0&size=100" -H "X-SESSIONID: <grantee session>" -H "ngrok-skip-browser-warning: true"

# 3. As the grantee, the call by id: expected 404
curl -s -i "$BASE/api/v1/grant-calls/44" -H "X-SESSIONID: <grantee session>" -H "ngrok-skip-browser-warning: true"
```

## 3. Root cause

`BaseTransactionalEntity` declares `@Filter(name = "tenantFilter", condition = ":tenantId = tenant_id")`. `TenantAwareInterceptor` turns it on for every query declared on `BaseRepository` or on the generated `XRepository`. That covers `findAll(Pageable)`, `findById` and the generated relationship finders behind `/grant-calls/{id}/applications`. `tenant_id` is stamped in `@PrePersist` from `PlatformSecurityUtil.getCurrentTenantId()`.

So a `GrantCall` carries the funder's `tenant_id`, and a grantee's read adds `tenant_id = <grantee>` and matches nothing.

Reference: *Working on a CodeMill-generated service*, §6 "Repositories, and a trap in `RepositoryExt`" (`commons-guidelines-practices/commons_design_instructions/code_mill/working_on_a_codemill-generated_service.md`).

### Every request affected

| Request | Caller | Today | Needed |
|---|---|---|---|
| `GET /grant-calls` | grantee | empty | published calls from all funders → **new** `/grant-calls/open` (§4.1) |
| `GET /grant-calls/{id}` | grantee | 404 | the call, if published → **new** `/grant-calls/open/{id}` (§4.1) |
| `POST /applications` with another tenant's `grantCallId` | grantee | **404 `GrantCall not found: 1`** (confirmed, §4.1b) | 201 |
| `GET /grant-calls/{id}/applications` | funder | only applications in the funder's own tenant, i.e. none | all applications to *its* call (§4.2) |
| `GET /applications/{id}` and its `/application-budget-lines`, `/application-documents`, `/application-result-rows`, `/reviews` | funder | 404 / empty | allowed when the call is the funder's (§4.2) |
| `POST /applications/{id}/start-review`, `/send-to-committee`, `/approve`, `/reject` | funder | 404 | allowed when the call is the funder's (§4.2) |
| `GET /applications` | grantee | own applications | ✅ correct as-is |
| `GET /grant-calls` | funder | own calls, including drafts | ✅ correct as-is |

---

## 4. Required changes

### 4.1 P0 — published calls for grantees (read-only)

| Endpoint | Returns |
|---|---|
| `GET /api/v1/grant-calls/open?page=0&size=100` | `PageDTO<GrantCallDTO>` with `state = 'PUBLISHED'`, `isActive = true`, `closesAt > now`, sorted by `closesAt` ascending |
| `GET /api/v1/grant-calls/open/{id}` | that `GrantCallDTO` if it meets the same conditions, otherwise **404** |

Before relying on `state = 'PUBLISHED'`, migrate calls saved before state validation existed: `UPDATE grant_call SET state = 'PUBLISHED' WHERE state = 'OPEN'` (table name as generated).

Rules:
- **Callers:** any authenticated session, from any tenant.
- **Read-only:** no write endpoints. Funders keep editing through the existing tenant-scoped `PUT /grant-calls`.
- **Don't return `applications` in these responses.** `GrantCallDTORes` includes an `applications` array, which here would leak other organisations' proposals to every grantee. Null it out or map to a DTO without it.
- **Route matching:** `/grant-calls/open` doesn't clash with the generated `/grant-calls/{id}`, because Spring prefers the literal path segment.
- **Swagger:** endpoints on a `ControllerExt` don't appear in the generated OpenAPI spec. That's fine; we don't generate clients from it.

**Implementation sketch.** The tenant filter only switches on for queries declared on `BaseRepository`, so put these queries on a repository that extends **`PlatformBaseRepository`**. On that repository the active filter still applies, and the tenant filter does not. Also write the predicates out explicitly rather than relying on the filters:

```java
@Repository
public interface OpenGrantCallRepository extends PlatformBaseRepository<GrantCall, Long> {

    @Query(value = "FROM GrantCall g WHERE g.state = 'PUBLISHED' AND g.isActive = true AND g.closesAt > :now ORDER BY g.closesAt ASC",
           countQuery = "SELECT count(g) FROM GrantCall g WHERE g.state = 'PUBLISHED' AND g.isActive = true AND g.closesAt > :now")
    Page<GrantCall> findOpen(@Param("now") Long now, Pageable pageable);

    @Query("FROM GrantCall g WHERE g.id = :id AND g.state = 'PUBLISHED' AND g.isActive = true AND g.closesAt > :now")
    Optional<GrantCall> findOpenById(@Param("id") Long id, @Param("now") Long now);
}
```

```java
// GrantCallControllerExt (same base path as the generated controller)
@GetMapping("/open")
public ResponseEntity<PageDTO<GrantCallDTO>> open(@RequestParam(defaultValue = "0") Integer page,
                                                 @RequestParam(defaultValue = "10") Integer size) {
    return ResponseEntity.ok(service.findOpen(page, size));   // map like the generated getAll(), with applications = null
}

@GetMapping("/open/{id}")
public ResponseEntity<GrantCallDTO> openById(@PathVariable Long id) {
    return ResponseEntity.ok(service.findOpenById(id));       // throw NotFoundException when empty → 404 envelope
}
```

Don't do either of these instead:
- **Put the queries in `GrantCallRepositoryExt`.** It extends `BaseRepository`, so the tenant filter would apply again.
- **Switch `GrantCall` to `NonMultiTenantBaseTransactionalEntity`.** That would make every funder's **drafts** visible to everyone through `GET /grant-calls`, and editable by anyone through `PUT /grant-calls`, since the generated endpoints have no authorization.

### 4.1b P0 — creating an application against a funder's call (confirmed)

**Confirmed on 2026-10-07.** A grantee submits a proposal for call 1, which belongs to the funder's tenant. `POST /api/v1/applications` with `"grantCallId": 1` returns:

```json
{ "errorCode": "ERR_PLATFORM_GEN_NOT_FOUND", "errorMessage": "GrantCall not found: 1" }
```

On application create, the service resolves `grantCallId` with the tenant-filtered `findById`, so the funder's call is invisible to the grantee's session. Before this, `POST /organisations` (org_type) and the call reads succeed; this is the request that fails.

**Fix.** Find where `"GrantCall not found"` is thrown on the application create path (the service, a hook, or the assembler resolving the relation). Replace that lookup with the cross-tenant, published-only lookup from §4.1:

```java
// ApplicationServiceExtImpl — wherever the call is resolved for a new application
GrantCall call = openGrantCalls.findOpenById(dto.getGrantCallId(), System.currentTimeMillis())
        .orElseThrow(() -> new InvalidInputException("This call isn't accepting applications"));
application.setGrantCall(call);   // the application keeps the grantee's tenant_id (stamped in @PrePersist)
```

Rules:
- Only **published, unexpired** calls can receive applications. Drafts, closed calls and expired calls give a 400 with a clear message, never a silent create.
- The same check applies on `POST /applications/{id}/submit`, which loads the application (grantee-owned, so the filtered read is fine) and then its call (cross-tenant).
- `PUT /applications` (grantee editing a draft) needs the same cross-tenant lookup if it re-resolves `grantCallId`.

### 4.2 P1 — funders can reach applications to their own calls

**The rule.** A caller may read or act on an application when **`grantCall.tenantId == PlatformSecurityUtil.getCurrentTenantId()`**, i.e. the caller's tenant owns the call it was submitted to. The grantee's existing tenant-scoped access stays as it is.

| Endpoint | Change |
|---|---|
| `GET /grant-calls/{id}/applications` | **Keep the path.** Load the call through the normal tenant-scoped `findById` (it must be the caller's). Then list its applications **without** the tenant filter. |
| `GET /applications/{id}` and its sub-resources (budget lines, documents, result rows, reviews) | Allow when the caller is the application's tenant **or** the call's tenant. |
| `GET /organisations/{id}`, `POST /organisations/ids` | Also allow an organisation that has a **submitted** application to one of the caller's calls, so the funder can see who applied (name, contacts). Bank details and PAN can stay hidden from funders until an award. |
| Drafts | A grantee's `DRAFT` applications stay private: leave them out of the funder's reads (the frontend hides them too). |
| Funder review chain | **Confirmed working cross-tenant.** The funder's application page now drives `POST /applications/{id}/start-review` → `POST /reviews` (one per reviewer, `conflictDeclared` always sent) → `POST /applications/{id}/send-to-committee` (with `overrideDisagreement=true&comment=` when the reviewers disagree) → `POST /applications/{id}/approve?amountMinor=&comment=` or `/reject?comment=`, and reads `GET /applications/{id}/award`. It shows the service's 400 messages as they are. The earlier `PUT /applications` state change is gone. |
| `start-review`, `send-to-committee`, `approve`, `reject` | Allow only for the call's tenant, the funder. Otherwise return **403** (`UnAuthorizedAccessException`). |
| Reading an application the caller has no claim to | **404** (`NotFoundException`), so the API doesn't reveal that it exists. |

Sketch (adjust the entity field names; the DTO calls it `grantCallId`, and the entity is probably `grantCall`):

```java
@Repository
public interface CrossTenantApplicationRepository extends PlatformBaseRepository<Application, Long> {

    @Query(value = "FROM Application a WHERE a.grantCall.id = :callId AND a.isActive = true",
           countQuery = "SELECT count(a) FROM Application a WHERE a.grantCall.id = :callId AND a.isActive = true")
    Page<Application> findByCall(@Param("callId") Long callId, Pageable pageable);

    @Query("FROM Application a WHERE a.id = :id AND a.isActive = true")
    Optional<Application> findAnyTenant(@Param("id") Long id);
}

// ApplicationServiceExtImpl — one guard reused by every funder-side operation
private Application requireForFunder(Long applicationId) {
    Application a = crossTenantApplications.findAnyTenant(applicationId)
            .orElseThrow(() -> new NotFoundException("Application not found: " + applicationId));
    Long me = PlatformSecurityUtil.getCurrentTenantId();
    if (!me.equals(a.getGrantCall().getTenantId()))   // the call's owner = the funder
        throw new UnAuthorizedAccessException("Only the funder of this call can do that");
    return a;
}
```

Keep the frontend contract the same: same paths, same DTOs. Only the access rule changes.

---

## 5. Heads-up — after an award, both parties work on the same records

Everything after approval involves both sides. The funder approves, which creates the `Award`, then sets up and releases `Tranche`s. The grantee submits `TranchePlan`, `TrancheReport` and `UtilisationCertificate`. The funder approves those or requests changes. With the tenant filter, each side will get 404s on the other side's records: for example, the grantee can't read the `Award` on its own application.

Before we build the post-award screens, please pick **one access model** for this whole chain, rather than patching it endpoint by endpoint. One option:
- Store the funder's tenant on the `Application` when it's created (for example `funderTenantId`, copied from `grantCall.tenantId`).
- Give the whole chain, from `Application` down to `UtilisationCertificate`, a single rule: **caller ∈ {applicant tenant, funder tenant}**.
- Restrict individual actions on top of that (only the funder approves; only the applicant submits).

Also: `enableTenantFilter()` lets the query run unfiltered if enabling the filter fails (guide §6). So treat the filter as a convenience, not the security boundary, and keep these checks explicit.

## 6. Please also verify

1. ~~`POST /applications` with another tenant's `grantCallId`~~ — confirmed broken; see §4.1b.
2. **Server-side checks on application create and submit.** The call must be `PUBLISHED` and inside its window, and `requestedAmountMinor` must be within the call's min/max award. The frontend checks these too, but the API should enforce them.
3. **State values.** The frontend now sends `GrantCall.state` = `DRAFT` | `PUBLISHED`, matching the service's new validation (`DRAFT`, `PUBLISHED`, `CLOSED`). Calls saved before that validation may still hold `OPEN`; the frontend treats `OPEN` as `PUBLISHED`. Please either migrate those rows (`UPDATE grant_call SET state = 'PUBLISHED' WHERE state = 'OPEN'`), or accept `OPEN` in the open-call queries. Applications are created with `state = DRAFT` before `/submit`; please confirm the canonical application states and which ones `/submit`, `/approve` and so on move between.
4. **`GET /organisations` stays tenant-scoped.** The frontend treats the first element as the caller's own organisation.

## 7. Acceptance checks

Setup: tenant **A** = funder, **D** = a second funder, **B** and **C** = grantees.

| # | Action | Expected |
|---|---|---|
| 1 | A creates call X with `state PUBLISHED`, `closesAt` in the future. B calls `GET /grant-calls/open`. | X is listed, with **no `applications`** in the payload |
| 2 | A creates draft Y. B calls `GET /grant-calls/open` and `GET /grant-calls/open/{Y}`. | Y isn't listed; the by-id call returns 404 |
| 3 | A has a call Z whose `closesAt` has passed | Z isn't listed |
| 4 | A calls `GET /grant-calls` | Only A's calls, including drafts (unchanged) |
| 5 | B posts `POST /applications` for X, then calls `/submit` | 201, then 200; the application is linked to X |
| 6 | B and then C call `GET /applications` | B sees its application; C doesn't |
| 7 | A calls `GET /grant-calls/{X}/applications` | B's application is listed |
| 8 | D calls `GET /grant-calls/{X}/applications` and `GET /applications/{B's id}` | 404 |
| 9 | A calls `POST /applications/{id}/start-review`; D calls the same | A gets 200; D gets 403 |
| 10 | With SQL logging on (`spring.jpa.show-sql`), call the new open endpoints | No `tenant_id = ?` predicate on the open-call queries; `is_active` filter present |

## 8. Frontend contract (already shipped)

| Screen | Calls | Behaviour until the backend ships |
|---|---|---|
| Grantee → Open calls, Home | `GET /grant-calls/open?page=0&size=100` | On 400, 404 or 405 it falls back to `GET /grant-calls` (today's tenant-scoped behaviour) |
| Grantee → call page, proposal form | `GET /grant-calls/open/{id}` | On 400, 404 or 405 it falls back to `GET /grant-calls/{id}` |
| Funder → calls list (counts), call page, applications list, Applications page | `GET /grant-calls`, `GET /grant-calls/{id}`, `GET /grant-calls/{id}/applications` | Merges the list endpoint with the `applications` nested in the call payload, so it shows whichever returns data. Starts working once §4.2 ships. |
| Funder → application page | `GET /applications/{id}`, `/applications/{id}/application-budget-lines`, `/application-documents`, `/reviews`, `GET /organisations/{id}`, `POST /organisations/ids` | Each falls back to the copy nested in the call / application payload; the applicant shows as "Organisation #id" until the organisation read is allowed. |

Fields the frontend reads from a call: `id`, `title`, `callCode`, `theme`, `description`, `state`, `currencyCode`, `envelopeAmountMinor`, `minAwardMinor`, `maxAwardMinor`, `opensAt`, `closesAt`, `postedAt`, `reviewersRequired`, `isCsrFunded`, `isForeignFunded`, `scheduleViiCode`, `responseFormat`, `budgetFormat`, `budgetPeriod`, `questionsJson`, `requiredDocsJson`.

Contact the frontend team if you'd prefer different paths. It's a two-line change on our side (`src/app/core/grant-call.api.ts`).

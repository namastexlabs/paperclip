# Wish: Complete Permissions & Human Collaborator System

- **Status:** SHIPPED
- **Slug:** complete-permissions
- **Date:** 2026-03-09
- **Design:** [DESIGN.md](../../brainstorms/human-collaborator-invite/DESIGN.md)

## Problem

The permissions and membership system is incomplete: company creators have zero permissions, humans cannot be invited through the UI, members cannot be listed or managed, `tasks:assign_scope` is never enforced, and permission changes are not logged.

## Summary

This wish finishes the entire permissions feature set end-to-end — from role presets and human invites through scope enforcement and audit logging.

## Role Preset Definitions

| Permission | Owner | Admin | Contributor | Viewer |
|---|---|---|---|---|
| `users:invite` | yes | yes | no | no |
| `users:manage_permissions` | yes | yes | no | no |
| `agents:create` | yes | yes | no | no |
| `tasks:assign` | yes | yes | yes | no |
| `tasks:assign_scope` | yes | yes | yes | no |
| `joins:approve` | yes | yes | no | no |
| Can delete/archive company | yes | no | no | no |

**Hierarchy:** Owner (0) > Admin (1) > Contributor (2) > Viewer (3). Lower ordinal = higher authority.

## Scope

### IN
1. Role presets (Owner/Admin/Contributor/Viewer) as shared constants with permission mappings
2. Owner auto-permissions on company creation
3. Owner permission backfill migration for existing companies
4. Human invite UI on Company Settings with role preset picker and 24hr TTL
5. Members management UI — list, edit permissions, remove, suspend/unsuspend
6. Role hierarchy enforcement (admins can't modify owners)
7. `tasks:assign_scope` enforcement with chain-of-command scope validation
8. `scope` field parsing/validation in `hasPermission()`
9. `membershipRole` made functional — tied to presets, displayed in UI
10. Member removal endpoint (DELETE membership + grants)
11. Member suspension — implement "suspended" status
12. Agent API key claim UI
13. Frontend API client methods: `listMembers`, `updateMemberPermissions`, `removeMember`, `suspendMember`, `unsuspendMember`, `revokeInvite` (6 new; `createCompanyInvite` and `claimJoinRequestApiKey` already exist)
14. Activity logging for all permission grant changes
15. Remove dead "pending" membership status from constants

### OUT
- Email-based invites
- Human inbox / task assignment UI
- Instance admin management UI
- Rate limiting on permission endpoints
- New permission keys beyond the existing 6
- Notification system for invite/permission events

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Invite delivery | Copy-paste link | Matches agent invite pattern, no email infra |
| Human invite TTL | 24 hours | 10min too tight for human workflows |
| Role presets | Owner > Admin > Contributor > Viewer | 4 tiers with ordinal hierarchy |
| Owner auto-grant | Explicit grants on creation | Auditable, no auth bypass |
| Owner protection | Role ordinal comparison | Simple: owner=0, admin=1, contributor=2, viewer=3 |
| Scope model | `subtree:<agentId>` only for v1 | Start simple, `getChainOfCommand()` is battle-tested |
| "pending" status | Remove | Never used; agent joins use join_requests table |
| "suspended" status | Implement | Useful for temp revocation without deletion |
| Company deletion | Owner-only (not admin) | Explicit in role preset table |

## Success Criteria

- [x] 1. Company creator automatically receives Owner preset permissions
- [x] 2. Existing company owners backfilled with Owner permissions (migration)
- [x] 3. Human invite link generated from Company Settings with role preset picker
- [x] 4. Invite expires after 24hrs, single-use, revocable
- [ ] 5. Collaborator accepts invite → gets membership + preset permissions → sees company immediately
- [x] 6. Members section lists all members with role and permissions
- [x] 7. Member permissions editable with role hierarchy enforcement
- [x] 8. Members can be removed (deletes membership + grants)
- [x] 9. Members can be suspended/unsuspended
- [x] 10. Admins cannot modify Owner permissions
- [x] 11. `tasks:assign_scope` enforced — scoped grants restrict assignment to subtree
- [x] 12. `scope` field parsed and validated in `hasPermission()`
- [x] 13. Agent API key claim completable from UI
- [x] 14. `membershipRole` reflects preset, displayed in UI
- [x] 15. Permission grant changes logged in activity log
- [x] 16. "pending" membership status removed from constants
- [x] 17. Frontend API client has `listMembers`, `updateMemberPermissions`, `removeMember`, `revokeInvite`

---

## Execution Groups

### Group 1: Shared Constants & Role Presets

**Goal:** Establish role presets, hierarchy ordinals, and TTL constants as the foundation everything else builds on.

**Deliverables:**
- Add `ROLE_PRESETS` constant mapping each role to its permission keys
- Add `ROLE_HIERARCHY` ordinal map (owner=0, admin=1, contributor=2, viewer=3)
- Add `MEMBERSHIP_ROLES` constant array: `["owner", "admin", "contributor", "viewer"]`
- Add `HUMAN_INVITE_TTL_MS` constant (24 hours)
- Remove `"pending"` from `MEMBERSHIP_STATUSES` (verify no code references it)
- Update `ensureMembership()` at `server/src/services/access.ts:192` — change the status parameter type from `"pending" | "active" | "suspended"` to `"active" | "suspended"` (or use the narrowed `MembershipStatus` type directly)
- Export `RolePreset` and `MembershipRole` types

**Files:**
- `packages/shared/src/constants.ts`

**Acceptance Criteria:**
- Role presets map each of the 4 roles to correct permission keys matching the table above
- Hierarchy ordinals are exported and usable for comparison
- "pending" removed from MEMBERSHIP_STATUSES without breaking builds
- TypeScript compiles cleanly

**Validation:**
```bash
cd packages/shared && pnpm tsc --noEmit && grep -q "ROLE_PRESETS" src/constants.ts && grep -q "ROLE_HIERARCHY" src/constants.ts && echo "PASS"
```

---

### Group 2: Owner Auto-Permissions & Backfill Migration

**Goal:** Company creators get Owner preset on creation; existing owners are backfilled.

**Depends on:** Group 1 (uses `ROLE_PRESETS` constant)

**Deliverables:**
- **MODIFY** `server/src/routes/companies.ts:115` — add `setPrincipalGrants()` call with Owner preset right after the existing `ensureMembership()` call in the POST `/` route
- **MODIFY** `server/src/index.ts:227` — add `setPrincipalGrants()` call with Owner preset after the bootstrap membership creation path
- **MODIFY** `server/src/board-claim.ts:129-137` — add `setPrincipalGrants()` call with Owner preset after board claim membership creation/update
- Create DB migration `0028_owner_permission_backfill.sql` that inserts Owner preset grants for all existing memberships where `membership_role = 'owner'` (use `ON CONFLICT DO NOTHING`)
- **MODIFY** `ensureMembership()` at `server/src/services/access.ts:191` — fix default `membershipRole` parameter (currently defaults to `"member"`)
- **MODIFY** `setUserCompanyAccess()` at `server/src/services/access.ts:179` — fix hardcoded `membershipRole: "member"` inline value

**Files:**
- `server/src/routes/companies.ts`
- `server/src/index.ts`
- `server/src/board-claim.ts`
- `server/src/services/access.ts`
- `packages/db/src/migrations/0028_owner_permission_backfill.sql` (new)

**Acceptance Criteria:**
- New company creation results in owner having all 6 permission grants
- Migration backfills grants for existing owners (idempotent with `ON CONFLICT DO NOTHING`)
- `membershipRole` correctly reflects "owner" for creators

**Validation:**
```bash
cd server && pnpm tsc --noEmit && pnpm test && echo "PASS"
```

---

### Group 3: Permission Service Enhancements

**Goal:** Add scope validation to `hasPermission()`, role hierarchy enforcement, activity logging for grant changes, and member removal/suspension.

**Depends on:** Group 1 (uses `ROLE_HIERARCHY` ordinals), Group 2 (`ensureMembership` changes)

**Deliverables:**
- **MODIFY `hasPermission()` (line 45-66)**: Add scope field parsing — but do NOT add `getChainOfCommand()` here (cross-service dependency; `getChainOfCommand` lives in `agentService`, not `accessService`). Instead, parse the `scope` field and return the scope data so the route layer can perform subtree validation where both services are available (see Group 4)
- **CREATE `canModifyMember(actorRole, targetRole)`**: Returns true only if actor ordinal < target ordinal (or actor is instance admin)
- **MODIFY `setPrincipalGrants()` (line 221-252)**: Add `logActivity()` call with freeform action string `"permissions.updated"` after grant changes
- **MODIFY `setMemberPermissions()` (line 86-126)**: Add `logActivity()` call with freeform action string `"permissions.updated"` after permission changes
- **CREATE `removeMember(companyId, memberId)`**: Deletes membership + all permission grants; call `logActivity()` with `"member.removed"`
- **CREATE `suspendMember(companyId, memberId)`**: Sets membership status to `"suspended"`; call `logActivity()` with `"member.suspended"`
- **CREATE `unsuspendMember(companyId, memberId)`**: Sets membership status to `"active"`; call `logActivity()` with `"member.unsuspended"`
- **`tasks:assign_scope` enforcement**: In task assignment route, when user has `tasks:assign_scope` grant with scope, validate target agent is in subtree

> **Note:** Activity logging uses freeform action strings passed to `logActivity()` (e.g. `"permissions.updated"`, `"member.removed"`). The `action` field in `LogActivityInput` is `string` — there is no event type registry or enum to modify. No changes needed to `activity-log.ts` itself.

> **Note (cross-service dependency):** `getChainOfCommand()` lives in `agentService` (`services/agents.ts`), while `hasPermission()` lives in `accessService` (`services/access.ts`). Recommendation: keep `hasPermission()` scope-unaware and do subtree validation in the route layer (Group 4) where both services are available.

**Files:**
- `server/src/services/access.ts` — scope parsing, hierarchy check, logging, removal, suspension
- `server/src/routes/issues.ts` — scope enforcement on task assignment

**Acceptance Criteria:**
- `hasPermission()` respects scope field when present
- `tasks:assign_scope` with `subtree:<agentId>` blocks assignment outside subtree
- Role hierarchy prevents admin from modifying owner grants
- Permission grant changes produce activity log entries
- Member removal deletes company_membership record and all associated rows in principal_permission_grants
- Member suspension sets membership status to "suspended"; `hasPermission()` returns false for suspended members

**Validation:**
```bash
cd server && pnpm tsc --noEmit && pnpm test && echo "PASS"
```

---

### Group 4: Backend API Endpoints

**Goal:** Add missing endpoints for member management, human invite TTL, and role hierarchy guards.

**Depends on:** Groups 1, 3 (uses constants and service functions)

**Deliverables:**
- **CREATE `DELETE /companies/:companyId/members/:memberId`** — remove member (requires `users:manage_permissions` + role hierarchy check via `canModifyMember()`)
- **CREATE `POST /companies/:companyId/members/:memberId/suspend`** — suspend member (requires `users:manage_permissions` + hierarchy check)
- **CREATE `POST /companies/:companyId/members/:memberId/unsuspend`** — unsuspend member (requires `users:manage_permissions` + hierarchy check)
- **MODIFY `PATCH /companies/:companyId/members/:memberId/permissions` (line 2543)** — add role hierarchy guard using `canModifyMember()` before calling `setMemberPermissions()`
- **MODIFY `POST /companies/:companyId/invites` (line 1628)** — branch TTL by `allowedJoinTypes`: modify `companyInviteExpiresAt()` at `access.ts:76-78` to accept optional `ttlMs` parameter (`function companyInviteExpiresAt(nowMs = Date.now(), ttlMs = COMPANY_INVITE_TTL_MS)`); in `createCompanyInviteForCompany()` at `access.ts:1576`, pass `HUMAN_INVITE_TTL_MS` when `input.allowedJoinTypes === "human"`
- **MODIFY company archive/delete route** — enforce Owner-only (not just `assertBoard`)
- **VERIFY `GET /companies/:companyId/members` (line 2536)** — already returns `membershipRole` via full `select()`; just verify it works correctly
- **Scope enforcement in routes**: When a user has `tasks:assign_scope` with `subtree:<agentId>` scope, validate the target agent is within the subtree using `getChainOfCommand()` from `agentService` (both services are available in the route layer)

**Files:**
- `server/src/routes/access.ts` — new endpoints, hierarchy guards, TTL logic
- `server/src/routes/companies.ts` — owner-only delete guard

**Acceptance Criteria:**
- Member removal endpoint deletes company_membership record and all principal_permission_grants rows, returns 204
- Suspend/unsuspend toggles membership status correctly
- Permission update rejects if actor role ordinal >= target role ordinal
- Human invites get 24hr TTL, agent invites keep 10min
- Company deletion requires Owner role (not just board access)
- Members list includes `membershipRole` field

**Validation:**
```bash
cd server && pnpm tsc --noEmit && pnpm test && echo "PASS"
```

---

### Group 5: Frontend API Client Methods

**Goal:** Add all missing API client methods so the UI can call the new and existing endpoints.

**Depends on:** Group 4 (endpoint signatures must be finalized)

**Already exist (no creation needed):**
- `createCompanyInvite()` (line 79-87) — already supports `defaultsPayload`; human invite UI just needs to populate it with role preset permissions
- `claimJoinRequestApiKey()` (line 119-123) — works as-is; verify during integration

**CREATE (6 new methods):**
- `listMembers(companyId)` — calls `GET /companies/:companyId/members`
- `updateMemberPermissions(companyId, memberId, grants)` — calls `PATCH /companies/:companyId/members/:memberId/permissions`
- `removeMember(companyId, memberId)` — calls `DELETE /companies/:companyId/members/:memberId`
- `suspendMember(companyId, memberId)` — calls `POST /companies/:companyId/members/:memberId/suspend`
- `unsuspendMember(companyId, memberId)` — calls `POST /companies/:companyId/members/:memberId/unsuspend`
- `revokeInvite(inviteId)` — calls `POST /invites/:inviteId/revoke`

**Files:**
- `ui/src/api/access.ts`

**Acceptance Criteria:**
- All methods typed correctly with request/response types
- Methods match the endpoint signatures from Group 4
- TypeScript compiles cleanly

**Validation:**
```bash
cd ui && pnpm tsc --noEmit && grep -q "listMembers\|removeMember\|suspendMember\|revokeInvite" src/api/access.ts && echo "PASS"
```

---

### Group 6: Human Invite UI

**Goal:** Add "Invite Collaborator" section to Company Settings with role preset picker and copyable link.

**Depends on:** Groups 4, 5 (needs updated invite endpoint with 24hr TTL + client methods)

**Deliverables:**
- New section on `CompanySettings.tsx` between the existing OpenClaw section and Danger Zone
- Role preset dropdown (Owner / Admin / Contributor / Viewer) defaulting to Contributor
- "Generate Invite Link" button that calls `createCompanyInvite()` (already exists at `ui/src/api/access.ts:79-87`) with `allowedJoinTypes: "human"` and `defaultsPayload` populated from selected role preset
- Display generated invite URL in a copyable field (same UX pattern as OpenClaw invite)
- Show expiry countdown (24hrs)
- "Copy link" button with confirmation feedback

> **Existing patterns to follow in `CompanySettings.tsx`:**
> - Lines 46-47: State variables (`inviteError`, `inviteSnippet`) — use separate state for human invite (e.g. `humanInviteUrl`, `humanInviteError`) to avoid conflicts with OpenClaw state
> - Lines 78-85: `inviteMutation` using `useMutation` — follow same pattern for human invite mutation
> - Lines 310-364: OpenClaw invite UI with textarea, copy button (`navigator.clipboard.writeText()`), error display — replicate this UX pattern

**Files:**
- `ui/src/pages/CompanySettings.tsx`

**Acceptance Criteria:**
- Section visible on company settings page
- Role preset picker shows all 4 roles
- Generated link is copyable and includes correct token
- Link expires after 24 hours (shown in UI)
- Follows existing OpenClaw invite UX pattern: textarea with copyable content, "Copy" button with pulse confirmation, loading state while generating

**Validation:**
```bash
cd ui && pnpm tsc --noEmit && pnpm build && echo "PASS"
```

---

### Group 7: Members Management UI

**Goal:** Build members section for listing, editing, removing, and suspending company members.

**Depends on:** Groups 5, 6 (needs client methods; ships alongside invite UI on same page)

**Deliverables:**
- New `ui/src/components/MembersSection.tsx` component (separate file to avoid conflicts with Group 6's CompanySettings edits)
- Import and render `MembersSection` in `CompanySettings.tsx` as a new section
- Members list showing: name/email, role badge, status (active/suspended), join date
- Per-member actions dropdown: Edit Permissions, Suspend/Unsuspend, Remove
- Edit Permissions modal: role preset picker + individual permission toggles
- Role hierarchy enforcement in UI: grey out/hide actions for members at same or higher role level
- Confirmation dialogs for Remove and Suspend actions
- Visual distinction for suspended members (dimmed, status badge)

**Files:**
- `ui/src/components/MembersSection.tsx` (new — primary component)
- `ui/src/pages/CompanySettings.tsx` (import and render MembersSection)
- New component files as needed for modals/list items

**Acceptance Criteria:**
- Members list loads and displays all company members
- Role badges match preset (Owner/Admin/Contributor/Viewer)
- Edit permissions respects role hierarchy (can't edit higher roles)
- Remove triggers confirmation, calls API, refreshes list
- Suspend/unsuspend toggles status with visual feedback
- Suspended members show distinct visual state

**Validation:**
```bash
cd ui && pnpm tsc --noEmit && grep -q "MembersSection" src/components/MembersSection.tsx && pnpm build && echo "PASS"
```

---

### Group 8: Agent API Key Claim UI

**Goal:** Complete the agent join flow by making API key claim accessible from the frontend.

**Depends on:** Group 5 (uses `claimJoinRequestApiKey` client method)

**Deliverables:**
- After an agent join request is approved (in Inbox), show a "Claim API Key" action
- Claim flow calls `claimJoinRequestApiKey()` with the claim secret
- Display the one-time plaintext API key with copy button and warning that it won't be shown again
- Clear visual distinction that this is a one-time display

**Files:**
- `ui/src/pages/Inbox.tsx` (or related join request component)
- `ui/src/api/access.ts` (verify `claimJoinRequestApiKey` works)

**Acceptance Criteria:**
- Approved agent join requests show "Claim API Key" button
- API key displayed once with copy functionality
- Warning shown that key won't be visible again
- Claim secret validated and consumed on use

**Validation:**
```bash
cd ui && pnpm tsc --noEmit && pnpm build && echo "PASS"
```

---

### Group 9: Tests

**Goal:** Test coverage for all new permission logic, role hierarchy, scope enforcement, and invite TTL.

**Depends on:** Groups 1-4 (tests exercise all backend changes)

**Deliverables:**
- **`role-presets.test.ts`** — verify preset mappings, hierarchy ordinal comparisons
- **`owner-auto-permissions.test.ts`** — company creation grants Owner preset
- **`role-hierarchy.test.ts`** — admin can't modify owner, owner can modify admin, instance admin bypasses
- **`scope-enforcement.test.ts`** — `tasks:assign_scope` with subtree validates chain-of-command
- **`member-management.test.ts`** — removal deletes grants, suspension blocks access, unsuspend restores
- **`human-invite-ttl.test.ts`** — human invites get 24hr TTL, agent invites keep 10min
- **`permission-activity-log.test.ts`** — grant changes produce activity log entries

**Files:**
- `server/src/__tests__/role-presets.test.ts` (new)
- `server/src/__tests__/owner-auto-permissions.test.ts` (new)
- `server/src/__tests__/role-hierarchy.test.ts` (new)
- `server/src/__tests__/scope-enforcement.test.ts` (new)
- `server/src/__tests__/member-management.test.ts` (new)
- `server/src/__tests__/human-invite-ttl.test.ts` (new)
- `server/src/__tests__/permission-activity-log.test.ts` (new)

**Acceptance Criteria:**
- All tests pass
- Core permission logic has coverage for happy path and edge cases
- Role hierarchy edge cases tested (same-level, cross-level, instance admin bypass)
- Scope enforcement tested with valid and invalid subtree assignments

**Validation:**
```bash
cd server && pnpm test && echo "PASS"
```

---

## Dependencies

- **External depends-on:** none — all infrastructure exists
- **External blocks:** none identified

### Internal Group Dependencies (execution order)

```
Group 1 (Constants)
  └─► Group 2 (Owner Auto-Permissions)
       └─► Group 3 (Permission Service)
            └─► Group 4 (Backend API)
                 ├─► Group 5 (Frontend API Client)
                 │    ├─► Group 6 (Human Invite UI)
                 │    ├─► Group 7 (Members UI)
                 │    └─► Group 8 (Agent Key Claim UI)
                 └─► Group 9 (Tests) — after Groups 1-4
```

Groups 6, 7, 8 can run in parallel once Group 5 is complete.

## Assumptions & Risks

| Assumption | Risk if Wrong |
|------------|--------------|
| `getChainOfCommand()` is performant enough for per-request scope checks | May need caching if orgs are deep; mitigated by max 50 depth limit |
| `"pending"` is referenced in `ensureMembership()` type signature | Handled: Group 1 includes deliverable to update `access.ts:192` type sig |
| Migration backfill won't conflict with existing grants | Use `ON CONFLICT DO NOTHING` in migration SQL |
| `membershipRole` column accepts arbitrary text values | Need to verify no DB constraint limits values to specific strings |
| Agent API key claim secret is still valid for existing approved requests | Secrets expire after 7 days; old approvals may need re-invite |

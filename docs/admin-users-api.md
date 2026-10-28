# Admin Users & RBAC API

Backend scope for Dev 2 / STORY-ADM-03. Base path: `/api/v1/identity/admin/users`.
Every endpoint requires `Authorization: Bearer <access-token>`, an active,
non-deleted account, the `ADMIN` role, and the privileges below.

| Method | Relative path   | Privilege                                                                                      | Success             |
| ------ | --------------- | ---------------------------------------------------------------------------------------------- | ------------------- |
| GET    | `/`             | `USER.LIST`                                                                                    | 200 paginated users |
| GET    | `/:id`          | `USER.VIEW`                                                                                    | 200 user            |
| PATCH  | `/:id/status`   | `USER.UPDATE`                                                                                  | 200 updated user    |
| PATCH  | `/:id/roles`    | `USER.ROLE.ASSIGN` for assignment; `USER.ROLE.REVOKE` for revocation; both for a mixed request | 200 updated user    |
| PATCH  | `/:id/password` | `USER.CHANGE_PASSWORD`                                                                         | 204, no body        |

The existing `/api/v1/admin/users` routes remain available, including legacy
`PATCH :id/lock`, `PATCH :id/unlock`, `POST :id/roles`,
`DELETE :id/roles/:roleCode`, and soft deletion through `DELETE :id`.

## List and detail

Example: `GET /api/v1/identity/admin/users?search=hoang&role=SELLER&status=LOCKED&page=1&limit=20`.

- `search`: trimmed string, maximum 150 characters; matches name, email or phone.
- `role`: role code, normalized to uppercase; matches a non-deleted role.
- `status`: `ACTIVE`, `LOCKED`, or `SUSPENDED`.
- `page`: integer >= 1, default 1.
- `limit`: integer 1–100, default 20.
- `sortBy`: `fullName` (default), `email`, `createdAt`, or `status`.
- `sortOrder`: `ASC` (default) or `DESC`; user ID breaks ties.

The application response interceptor wraps successful JSON in
`{ "success": true, "data": ... }`. List data has this shape:

```json
{
  "items": [],
  "page": 1,
  "limit": 20,
  "total": 0,
  "totalPages": 0
}
```

Each user contains `id`, `email`, `phone`, `fullName`, `identityNumber`, `gender`,
`address`, `dateOfBirth`, `status`, `roles`, `createdAt`, and `updatedAt`.
Password hashes, token versions, refresh tokens and authentication secrets are
never included. Deleted accounts are excluded from list and detail queries.
Missing or deleted detail targets return 404.

## Lock and unlock

```json
{ "status": "LOCKED", "reason": "Violation confirmed by support" }
```

Use `ACTIVE` to unlock. The optional reason is recorded with the actor and status
change in audit/outbox records. `LOCKED` is the canonical API and database value;
the sprint document's `BANNED` label is not a supported enum value. No schema
migration or status translation is needed.

A manual lock clears `lockedUntil` and persists until an administrator unlocks
the account. Brute-force protection is a separate login mechanism using a
`lockedUntil` deadline. `SUSPENDED` accounts cannot be changed through this route.
A real status change increments `tokenVersion` and revokes refresh tokens, so
old access tokens and refresh tokens cannot continue the session. Self-locking
and disabling the last active administrator are rejected with 409.

## Assign and revoke roles

```json
{ "assign": ["SELLER"], "revoke": ["STAFF"] }
```

Either array can be omitted; at least one must be nonempty. Null arrays,
duplicates, overlapping assignments/revocations and malformed role codes are
rejected. Roles must exist and not be deleted. Assigning an existing membership
is idempotent; revoking an absent membership returns 404. `BUYER` is retained
unless explicitly revoked. All requested changes and their audit/outbox records
are written in one transaction; one invalid operation aborts the whole batch.

An administrator cannot revoke their own `ADMIN` membership. Removing the final
active administrator is rejected. Admin-removal operations serialize through a
shared PostgreSQL transaction advisory lock before locking the target account,
so concurrent admin changes cannot both pass a stale count check.

## Administrative password change

```json
{ "newPassword": "Replacement123!" }
```

Requires `USER.CHANGE_PASSWORD`; `USER.UPDATE` alone does not authorize it.
No current password is needed. The new password follows the existing policy:
at least 8 characters, uppercase, lowercase, a digit and one of `!@#$%^&*`.
Reusing the current password is rejected. The password is stored as an Argon2id
hash; existing access and refresh sessions are invalidated. Audit/outbox records
identify the actor and target without recording the password or hash.

## Errors and events

- 400: invalid UUID, query or body, conflicting/empty role arrays, weak or unchanged password.
- 401: missing/invalid access token, inactive/deleted account, or stale token version.
- 403: missing ADMIN role or required privilege.
- 404: missing/deleted user or role, or absent role membership on revocation.
- 409: protected administrator or unsupported suspended-account transition.

Audit and identity outbox records use the repository's existing uppercase event
convention (such as `USER_ROLE_ASSIGNED` and `USER_ROLE_REVOKED`). Database
transactions preserve consistency between user changes and these records.

## Verification

```sh
npm test
npm run test:e2e -- test/admin-user.e2e-spec.ts
npm run lint
npm run typecheck
npm run build
```

HTTP tests use real Nest routing, validation and authorization guards with mocked
business/database dependencies. They do not connect to Supabase or modify real
accounts. Service tests exercise transactions, audit failures, administrator
protection and session invalidation with controlled repository fakes.

# Security

_How Constructly protects tenant data. Reflects the implemented system; update with every security-relevant change._

## Threat model

Multi-tenant SaaS: the primary risk is one company reading or mutating another's data. Defense is **three independent layers**, any one of which is sufficient to deny access — the app never relies on the client.

## Three-layer authorization

1. **UI gating** — owner-only controls are hidden from PROJECT_MANAGERs. Convenience only; never a security boundary.
2. **Server guards** — every server action calls `requireUser()` (throws `UNAUTHENTICATED` if no session), then `assertOwner()` / `assertProjectAccess()` before any mutation. Owner-only financial actions (create/update vendor, approve/delete PO, delete payment) throw `FORBIDDEN` for PMs **before touching the database** (tested in `src/features/procurement/server/permissions.test.ts`).
3. **Postgres RLS** (`prisma/rls.sql`) — the backstop. Every domain table has a policy scoping rows to `current_company_id()`; project-linked tables (attendance, POs, payments, goods receipts) additionally require `can_access_project()`, and `vendor_payments` UPDATE/DELETE require `is_owner()`. Even a compromised app role cannot cross tenants.

Tenant identity is **always derived server-side** from the session — a `company_id` from the client is never trusted.

## Web protections

| Risk | Mitigation |
|---|---|
| **CSRF** | Next.js Server Actions are POST-only with an origin check + action-id binding; no custom mutation endpoints accept cross-site form posts. `form-action 'self'` in CSP. |
| **XSS** | React escapes all interpolated content; no `dangerouslySetInnerHTML` in the app. Strict CSP (`script-src 'self'`, `object-src 'none'`) blocks injected/inline third-party scripts in production. |
| **SQL injection** | All queries go through Prisma's parameterized client — no string-built SQL. The one raw query (`select 1` health probe) takes no input. |
| **Clickjacking** | `X-Frame-Options: DENY` + `frame-ancestors 'none'`. |
| **MIME sniffing** | `X-Content-Type-Options: nosniff`. |
| **Transport** | `Strict-Transport-Security` (prod), `Referrer-Policy: strict-origin-when-cross-origin`. |
| **Feature abuse** | `Permissions-Policy` disables camera/mic; geolocation self-only. |

Security headers are defined in `next.config.ts` and applied to every route.

## Rate limiting

`/api/sync` is rate-limited per user (`src/lib/rate-limit.ts`, token bucket, 120 req/min) and caps batch size at 500 mutations. The limiter is in-process (single-instance safe); swap the store for Redis/Upstash when scaling horizontally — the interface is unchanged.

## Input validation

Every boundary parses input with a **Zod schema** (forms, server-action inputs, `/api/sync` payloads). Client-side validation is UX only; the server re-validates. Money is integer paise end-to-end — no float rounding attacks.

## Sessions & auth

Supabase Auth manages sessions (httpOnly cookies), password reset, and OAuth. The app reads the session server-side via the Supabase server client; `auth.uid()` anchors every RLS policy. Demo mode (`CONSTRUCTLY_DEMO`) bypasses auth for local/preview only and must never run in production.

## File uploads

Documents record a Supabase Storage path + metadata (filename, size, MIME) via server actions; Storage bucket policies scope objects per company. Uploads are size/type-recorded; enforce max-size and content-type allowlists at the bucket policy + a server check before GA (see Production Checklist).

## Audit logging

Financial and status changes write immutable `ActivityLog` rows (actor, action, entity, meta, timestamp) — PO create/approve/revise, payment recorded/deleted, project stage changes. Feeds the dashboard activity feed and the audit trail. Payment deletion is owner-only and always logged.

## Dependency scanning

`npm audit` runs in CI (`security` job): the build **fails on critical** advisories and reports high ones non-blocking.

**Tracked exception — `xlsx` (SheetJS), high:** the advisory (prototype pollution + ReDoS) is in the spreadsheet **parsing** path. Constructly uses `xlsx` **only to generate exports** (JSON → workbook → download) and never parses untrusted files, so the vulnerable code is unreachable. Mitigation on the roadmap: migrate to the SheetJS CDN distribution (which carries the fix) at the next dependency pass. Re-audit before enabling any spreadsheet-import feature — that would change the risk.

## Observability

Structured logging (`src/lib/logger.ts`, JSON in prod) and a single `reportError()` sink used by server catches, route error boundaries, and the client error reporter — one line wires Sentry. `/api/health` (+ `?deep=1` for a DB check) backs uptime monitoring.

## Reporting

Security issues → the repository owner privately. Do not open public issues for vulnerabilities.

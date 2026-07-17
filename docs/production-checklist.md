# Production Checklist

_Run before any release to production. Every box must be checked or explicitly waived with a reason._

## Automated gates (CI — must be green)

- [ ] **No TypeScript errors** — `npm run typecheck`
- [ ] **No ESLint warnings** — `npm run lint` (`--max-warnings 0`)
- [ ] **Green test suite** — `npm test` (unit + integration + permission + sync)
- [ ] **Successful production build** — `npm run build`
- [ ] **E2E pass** — `npm run e2e` (Playwright)
- [ ] **Accessibility pass** — axe suite, no serious/critical violations
- [ ] **Dependency audit** — `npm audit --audit-level=high` clean

## Manual verification

### Correctness & data
- [ ] **Database migrations apply cleanly** — `prisma migrate deploy` + `rls.sql` on a fresh DB
- [ ] **RLS enforced** — a PM cannot read another tenant's rows or unassigned projects
- [ ] **Financial calculations verified** — budget, GST (subtotal + GST = grand total), outstanding = Σ POs − Σ payments, aging buckets, labour snapshots; spot-check the demo numbers against the dashboard, project, and reports (they must match exactly)
- [ ] **Role permissions verified** — owner-only actions (approve/delete PO, delete payment, manage vendors) refused for PMs at the server
- [ ] **Immutable history** — approved POs cannot be edited; editing a rate does not change past records
- [ ] **Offline sync verified** — record attendance offline, reconnect, confirm it persists with no data loss

### Experience
- [ ] **No console errors** on any route (check dashboard, projects, procurement, vendors, labor, reports, settings)
- [ ] **Responsive behavior** — mobile (375px), tablet, desktop; no horizontal overflow
- [ ] **Dark mode** — every surface legible; charts/tokens theme-aware
- [ ] **Accessibility (manual)** — full keyboard navigation, visible focus order, skip-to-content link, screen-reader labels on icon buttons + charts, reduced-motion honored, AA contrast

### Security & ops
- [ ] **Security headers present** — CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy (`curl -sI`)
- [ ] **`CONSTRUCTLY_DEMO` is unset** in the production environment
- [ ] **Health endpoint** — `/api/health` ok; `/api/health?deep=1` reports `database: ok`
- [ ] **Secrets** — all env vars set in Vercel; none committed; `.env` gitignored
- [ ] **Rate limiting** — `/api/sync` returns 429 past the per-user limit
- [ ] **Error reporting** — `reportError()` wired to the monitoring platform (or a documented decision to defer)
- [ ] **Backups** — Supabase point-in-time recovery enabled; snapshot taken before migration

## Sign-off

| Check | Owner | Date |
|---|---|---|
| Automated gates green | | |
| Manual verification complete | | |
| Deploy approved | | |

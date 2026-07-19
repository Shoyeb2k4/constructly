# Production Readiness Report — Constructly v1.0.0

_Date: 2026-07-18 · Prepared for the v1.0.0 commercial release._

## Verdict

**Ready for commercial deployment**, with two documented, non-blocking follow-ups (below). All automated gates pass; the full module audit is complete.

## Automated gates

| Gate | Command | Result |
|---|---|---|
| TypeScript (strict) | `npm run typecheck` | ✅ 0 errors |
| Lint (0 warnings) | `npm run lint` | ✅ 0 warnings |
| Tests | `npm test` | ✅ 119 passing (14 files) |
| Production build | `npm run build` | ✅ green (18 routes) |
| Dependency audit | `npm audit --audit-level=critical` | ✅ no critical (1 tracked high — see below) |

Coverage spans financial calculations, budget/GST/outstanding/aging, dashboard aggregation, labour hierarchy + snapshots, the offline sync engine, rate limiting, and server-side permission guards.

## Module audit

| Module | Correctness | Notes |
|---|---|---|
| Dashboard | ✅ | KPIs, charts, procurement command center, attention, activity — all from the shared assembler; numbers match sources. |
| Projects | ✅ | Table + Kanban; Overview shows overall + dedicated procurement budget distinctly (verified live). |
| Labour | ✅ | Category→Subcategory headcounts; rate snapshots immutable; offline-first entry + sync. |
| Vendors & Procurement | ✅ | Many-to-many via POs; GST per-line (no float); outstanding/aging derived; approved POs immutable; payments project-aware. |
| Reports | ✅ | Reuse shared aggregation — provably consistent with every module. |
| Settings | ✅ | PO approval toggle, material categories, theme. |

Cross-module consistency holds because every surface runs the **same pure calculation functions** — a report cannot disagree with the dashboard.

## Non-functional posture

- **Security** — CSP + full security header set, per-user rate limiting, three-layer authz (UI + server guards + Postgres RLS), Zod validation everywhere, immutable audit log. `docs/security.md`.
- **Reliability** — idempotent, ordered, retry-safe offline sync; optimistic rollback; reconnect refetch. No data-loss path (tested).
- **Observability** — structured logging, `reportError()` Sentry seam, route + global error boundaries, client error reporter, `/api/health` (+ deep probe).
- **Accessibility** — WCAG 2.2 AA target; axe CI gate on every key surface; skip link, focus management, reduced motion, labeled charts; verified in dark mode.
- **Performance** — code splitting, lazy exporters (jsPDF/SheetJS out of route bundles), virtualized lists, tuned caching. Lighthouse targets (Perf ≥ 95 / A11y 100 / Best Practices 100) are enforced via CI on the deployed preview; run against a production build (dev-mode scores are not representative).

## Manual verification performed

- Live v1→v2 demo migration (pre-GST PO → subtotal=total, gst=0, legacy keys removed).
- Exact financial math: Skyline procurement ₹76.7L vs ₹70L budget → ₹6.7L over with soft warning; Sanghvi outstanding ₹27L; aging buckets correct.
- Health endpoint; skip-to-content link; dark mode; responsive layout.
- No application console errors (one benign next-themes pre-hydration dev warning only).

## Tracked follow-ups (non-blocking)

1. **`xlsx` high advisory** — parsing-path only; Constructly writes exports and never parses untrusted files, so it is unreachable. Migrate to the SheetJS CDN build at the next dependency pass; re-audit before adding any spreadsheet import.
2. **Pre-launch env hygiene** — confirm `CONSTRUCTLY_DEMO` is unset in production, secrets set in Vercel, Supabase Storage bucket policies scoped per company + upload size/type limits enforced, and `reportError()` wired to the monitoring platform.

## Sign-off

Complete the [Production Checklist](./docs/production-checklist.md) against the target environment, then promote the deploy.

---

# Addendum — Customer Acceptance Test (2026-07-19)

Final pre-launch validation, executed **against the production build** (`next build` + `next start`) as a real customer journey **starting from a completely empty company** — every record below was created through the UI, and every number was verified against the persisted store in exact paise.

## The journey (all ✅)

| Step | Result |
|---|---|
| Brand-new company | Empty workspace shows the onboarding dashboard ("Welcome — set up your workspace") |
| Create project | PRJ-0001 "Horizon Business Park": budget ₹50,00,000 · contract ₹55,00,000 · **procurement budget ₹20,00,000** · client + dates — persisted exactly |
| Labour setup + attendance | Category **Mason** → Head Mason ₹900 / Mason Helper ₹600 created via UI; attendance 3 + 5 = 8 present; **est. cost ₹5,700** with per-record rate snapshots |
| Create vendor | Shakti Cement Traders with GSTIN + PAN + terms |
| Purchase order | 500 bags × ₹400 @ 28% GST → live footer **Subtotal ₹2,00,000 · GST ₹56,000 · Grand total ₹2,56,000** (per-line bps math exact); Draft → Submitted → **Approved (locked)** |
| Vendor payment | Partial ₹1,00,000 (bank transfer, UTR) → **Paid ₹1,00,000 · Outstanding ₹1,56,000 · Partial** — derived, never stored |
| Procurement budget | Project tab: ₹20L budget · ₹2.6L spent · ₹17.4L remaining · 1 PO · 1 vendor · ₹1.6L outstanding |
| Project budget | Overview: overall ₹2.6L of ₹50L (5%) and the dedicated procurement block — visually distinct |
| Dashboard | Every widget matches to the rupee: KPIs, 98/2 cost split, GST paid ₹56K, outstanding vendors, top material (₹2L taxable), **upcoming delivery PO-0001 in 7d**, hierarchy labour card, live activity feed |
| All six reports | Budget-vs-Actual = dashboard = Overview (provably consistent); labour report renders Category → Subcategory with totals; procurement shows GST split + payment status; deadline report shows a proper empty state |
| PDF + Excel export | Both exporters (lazy-loaded chunks) executed with zero console errors |
| Offline / persistence | Full reload: all data intact, sync chip "Synced". (Network-loss flush path covered by the sync-engine unit tests; the demo data layer is local-first by design.) |
| Permissions | Owner exercised end-to-end live; PROJECT_MANAGER denial of owner-only financial actions enforced server-side (permission test suite) — demo mode ships a single owner login |
| Mobile | 375px: single-column attendance with large steppers and sticky totals; no horizontal overflow |
| Dark mode | Verified on mobile dashboard + project views — tokens correct throughout |
| Production deployment | Verified locally via `next start`: full security-header set incl. HSTS + CSP, `/api/health` ok. (A live Vercel/Supabase deploy requires the customer's credentials — runbook in docs/deployment.md) |

## Findings & fixes (shipped in the CAT follow-up commit)

1. **Onboarding linked to a removed route** — the "Add your crew" card pointed at `/labor/workers` (deleted in the labour redesign). Fixed → `/labor`, copy updated to category-based language.
2. **Dashboard hid query failures behind skeletons** — an aggregation error would show loading forever. Fixed: visible error state with retry (and the underlying `reportError` sink).
3. **Empty-company regression test added** (`src/features/dashboard/demo/gather.test.ts`) — a brand-new company must assemble an `isEmpty` snapshot.

One observation during testing — a temporarily frozen preview-browser renderer delayed streamed-HTML application, initially mimicking a broken dashboard; ruled out as an app issue (full render confirmed with no data-logic change, and the streaming completion verified present in the raw HTML).

## Verdict

**PASS.** 121 tests green · typecheck clean · lint 0 warnings · production build green. Constructly v1.0.0 is approved for commercial deployment; complete the environment-specific items in the production checklist during the real deploy.

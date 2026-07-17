# Testing Strategy

_How we keep Constructly correct. Every critical business workflow has automated coverage._

## Layers

| Layer | Tool | What it covers |
|---|---|---|
| **Unit** | Vitest | Pure business logic — money, budget, GST, outstanding/aging, dashboard assembly, labour hierarchy, wage/cost snapshots, rate limiting, sync engine. |
| **Integration** | Vitest | Demo repositories end-to-end against localStorage (CRUD, filters, migrations, immutability, snapshot semantics). |
| **Permission** | Vitest | Server-side authorization guards — owner-only mutations reject PROJECT_MANAGERs before any DB access. |
| **Offline sync** | Vitest | Enqueue validation, ordered idempotent flush, offline no-op, retry retention, applied cleanup (Dexie + fetch mocked). |
| **E2E** | Playwright | Real user flows in demo mode — dashboard, projects, attendance, procurement, reports. |
| **Accessibility** | Playwright + axe-core | WCAG 2.1/2.2 A + AA machine checks on every key surface; keyboard skip-link. |

## Principle: one source of truth, tested once

All money/budget/GST/outstanding math lives in **pure functions** (`src/features/*/calc.ts`, `src/features/budget/calc.ts`, `src/features/dashboard/assemble.ts`) consumed identically by the demo repo, the Prisma server actions, the dashboard, and every report. Testing the pure function guarantees every surface agrees — a report can never disagree with the dashboard because they run the same code.

## Financial calculation coverage (non-negotiable)

- Integer-paise money utilities (`src/lib/money.test.ts`).
- Budget derivation + PO-counting rules (`src/features/budget`).
- GST per-line rounding, PO totals (subtotal + GST = grand total).
- Outstanding = Σ counted POs − Σ payments; payment status; aging buckets (advances FIFO); vendor/project rollups; vendor ledger running balance.
- Labour cost snapshots (rate frozen at record time — history never rewrites).

Money is never a float; every calc test asserts exact paise.

## Running

```bash
npm test            # unit + integration + permission + sync (Vitest)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint --max-warnings 0
npm run e2e         # Playwright (starts the app in demo mode)
npm run e2e:a11y    # axe accessibility suite only
npm run build       # production build (also typechecks)
```

## Accessibility testing

`tests/e2e/a11y.spec.ts` scans dashboard, projects, procurement, vendors, labor, reports, and settings with axe against `wcag2a/2aa/21a/21aa/22aa` and fails on any serious/critical violation. Machine checks catch ~40% of WCAG; the manual checklist (keyboard-only navigation, screen-reader spot-checks, focus order, contrast, reduced motion) is in the Production Checklist.

## CI

`.github/workflows/ci.yml` runs four jobs on every PR: **quality** (typecheck · lint · unit), **build** (production), **e2e** (Playwright + axe), **security** (`npm audit --audit-level=high`). All must pass before merge.

## Conventions

- Co-locate tests next to code (`*.test.ts`).
- Prefer testing pure functions over mocking; mock only at true boundaries (auth, Dexie, fetch, Prisma proxy).
- Every bug fix adds a regression test.

# Rollback Guide

_How to revert Constructly production fast and safely. App rollbacks are instant and safe; database rollbacks need care because migrations are forward-only._

## 1. App / frontend rollback (instant, safe)

Vercel keeps every deployment immutable. To revert code:

**Dashboard:** Vercel → Project `constructly` → Deployments → pick the last-known-good build → **⋯ → Promote to Production**. Traffic switches in seconds; no rebuild.

**CLI:**
```bash
vercel ls constructly           # list deployments, copy the good URL
vercel promote <deployment-url> # promote it to production
```

Use this for any UI/server-code regression. It does **not** touch the database, so it's always safe when the schema is unchanged.

## 2. Environment-variable rollback

If a bad env change broke production:
```bash
vercel env ls                                   # inspect
vercel env rm <NAME> production --yes           # remove bad value
vercel env add <NAME> production                # re-add correct value (stdin)
vercel deploy --prod --yes                       # redeploy to pick it up
```

## 3. Database rollback (careful — forward-only migrations)

Migrations are **not** auto-reversible. Options, safest first:

**a. Restore from backup / PITR** (preferred for data issues) — see [backup-and-recovery.md](./backup-and-recovery.md). Restores data and schema to a point in time.

**b. Compensating migration** (preferred for a bad schema change) — write a new forward migration that undoes the change (e.g. drop the column you just added). Apply via the Supabase migration flow. Never hand-edit a shipped migration.

**c. Full restore** — only for catastrophic schema corruption. Restore the latest logical dump into a fresh instance and repoint the app.

### Golden rule: decouple app and schema deploys
Ship **additive** schema changes first (new nullable columns/tables), deploy app code that tolerates both old and new shapes, then remove old columns in a later migration. This makes every app rollback safe because the old code still runs against the new schema.

## 4. Decision table

| Symptom | Action |
|---|---|
| UI bug, wrong logic, broken page | Promote previous Vercel deployment (§1) |
| Broke after an env change | Fix env + redeploy (§2) |
| Bad data written by a release | PITR/backup restore (§3a) |
| Bad schema migration | Compensating migration (§3b) or restore (§3a) |
| Total outage / corruption | Full restore (§3c) + app promote |

## 5. After any rollback
1. `GET /api/health?deep=1` → `status: ok`, `database: ok`.
2. Spot-check a critical workflow (sign-in, create PO, dashboard).
3. Confirm no console/server errors.
4. Record the incident + root cause; add a regression test before re-attempting the change.

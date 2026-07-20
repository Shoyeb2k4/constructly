# Backup & Disaster Recovery

_Constructly production data lives in Supabase Postgres (project `rbteppevgibwddihqcpf`, region ap-south-1) and Supabase Storage. This is the plan to never lose customer data and to recover fast._

## What must be protected

| Asset | Store | Criticality |
|---|---|---|
| Companies, projects, labour, vendors, POs, payments, activity log | Postgres `public.*` | **Critical** — financial system of record |
| Uploaded documents | Storage bucket `documents` | High |
| Auth users | Supabase `auth.users` | **Critical** — identities behind RLS |
| Schema + RLS + policies | Migrations in this repo (`prisma/`, applied via Supabase migrations) | Reproducible from git |

## Backups

### Database (automatic)
- **Supabase daily backups** are enabled by plan. Pro plan adds **Point-in-Time Recovery (PITR)** — recommended for a paid product; enable it in Dashboard → Database → Backups. PITR lets you restore to any second within the retention window.
- **Retention**: confirm ≥ 7 days (Pro default), raise for compliance needs.

### Database (manual / off-platform — recommended weekly)
```bash
# Full logical dump via the session pooler (IPv4-safe).
pg_dump "$DIRECT_URL" --no-owner --no-privileges -Fc -f constructly-$(date +%F).dump
# Store encrypted, off-Supabase (e.g. private S3/GCS bucket, 90-day retention).
```
Automate with the GitHub Actions cron in `.github/workflows/` (add a `backup.yml` using a repo secret for `DIRECT_URL`) or a scheduled job on any host.

### Storage
- Bucket objects are **not** covered by Postgres PITR. Mirror them off-platform:
```bash
# Using the Supabase CLI or the storage API, sync the `documents` bucket
# to encrypted object storage weekly. Object keys are <company>/<project>/…
```

### Code + schema
- Everything reproducible is in git: the schema (`prisma/schema.prisma`), RLS (`prisma/rls.sql`), and the exact production DDL (`prisma/migrations-init.sql`). A brand-new database is fully rebuildable from these.

## Recovery objectives

- **RPO** (max data loss): ≤ 24 h with daily backups; ≤ 5 min with PITR enabled.
- **RTO** (max downtime): ≤ 1 h for a database restore; ≤ 15 min for an app rollback (see [rollback-guide.md](./rollback-guide.md)).

## Recovery procedures

### A. Corrupted / bad data write (most common)
1. Identify the time just before the incident.
2. Supabase Dashboard → Database → Backups → **PITR restore** to that timestamp (spins a new instance), or restore the latest daily backup.
3. Point the app at the restored instance (update `DATABASE_URL`/`DIRECT_URL` in Vercel) or promote it per Supabase's restore flow.
4. Verify with `/api/health?deep=1` and a spot-check of the affected records.

### B. Full project loss
1. Create a new Supabase project (same region).
2. Apply schema + RLS + storage: run the three migrations (`initial_schema`, `rls_policies`, `storage_documents_bucket`) — the SQL lives in this repo / the Supabase migration history.
3. Restore data from the latest `pg_dump`: `pg_restore --no-owner --no-privileges -d "$DIRECT_URL" constructly-<date>.dump`.
4. Restore Storage objects from the off-platform mirror.
5. Recreate `auth.users` from the Supabase auth backup (included in full backups).
6. Update Vercel env vars to the new project's URL/keys/connection strings; redeploy.

### C. Accidental table/row delete
- If PITR is on: restore to just before the delete.
- Otherwise: restore the latest daily backup into a scratch instance, export the affected rows, and re-insert.

## Never-lose-data guarantees already in the app

- **Offline attendance** is queued in the browser outbox and re-synced idempotently — a lost connection never loses field entries.
- **Approved POs are immutable**; edits go through Revise (new linked draft), so financial history is append-only.
- **Payments/outstanding are derived**, so a bad derived value is never persisted — recompute fixes it.

## Runbook checklist (keep current)
- [ ] PITR enabled on the production project
- [ ] Weekly off-platform `pg_dump` scheduled + encrypted
- [ ] Weekly Storage mirror scheduled
- [ ] Restore tested end-to-end at least once per quarter
- [ ] `DIRECT_URL` backup secret stored in the CI/secret manager (never in git)

-- Constructly — Row-Level Security scaffold
-- Applied after `prisma migrate`. Establishes the tenant-isolation pattern
-- every domain table inherits. Run against the Supabase database.
--
-- Model: the app connects under an authenticated role; auth.uid() resolves to
-- the Supabase user, which maps 1:1 to public.users.id. A helper returns the
-- caller's company_id, and every policy filters on it.

-- ── Helper: the current caller's company ───────────────────────────────
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.users where id = auth.uid()
$$;

-- ── companies ──────────────────────────────────────────────────────────
alter table public.companies enable row level security;

create policy company_isolation_select on public.companies
  for select using (id = public.current_company_id());

create policy company_isolation_mutate on public.companies
  for update using (id = public.current_company_id());

-- ── users ──────────────────────────────────────────────────────────────
alter table public.users enable row level security;

-- A user can read members of their own company.
create policy users_same_company_select on public.users
  for select using (company_id = public.current_company_id());

-- Only owners may add/modify members within their company.
create policy users_owner_manage on public.users
  for all using (
    company_id = public.current_company_id()
    and exists (
      select 1 from public.users me
      where me.id = auth.uid() and me.role = 'OWNER'
    )
  );

-- ── Helper: is the caller an OWNER? ────────────────────────────────────
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'OWNER'
  )
$$;

-- ── projects ───────────────────────────────────────────────────────────
-- Owners see every project in their company; PMs only assigned ones.
alter table public.projects enable row level security;

create policy projects_read on public.projects
  for select using (
    company_id = public.current_company_id()
    and (public.is_owner() or pm_id = auth.uid())
  );

-- Owners create/delete; owners and the assigned PM may update.
create policy projects_insert on public.projects
  for insert with check (company_id = public.current_company_id() and public.is_owner());

create policy projects_update on public.projects
  for update using (
    company_id = public.current_company_id()
    and (public.is_owner() or pm_id = auth.uid())
  );

create policy projects_delete on public.projects
  for delete using (company_id = public.current_company_id() and public.is_owner());

-- ── Project-scoped children (deadlines, documents, notes) ──────────────
-- Access follows the parent project's visibility.
create or replace function public.can_access_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and p.company_id = public.current_company_id()
      and (public.is_owner() or p.pm_id = auth.uid())
  )
$$;

alter table public.deadlines enable row level security;
create policy deadlines_all on public.deadlines
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

alter table public.project_documents enable row level security;
create policy documents_all on public.project_documents
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

alter table public.notes enable row level security;
create policy notes_all on public.notes
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- ── project_favorites (per-user) ───────────────────────────────────────
alter table public.project_favorites enable row level security;
create policy favorites_own on public.project_favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── activity_logs (read within company; writes via service role) ───────
alter table public.activity_logs enable row level security;
create policy activity_read on public.activity_logs
  for select using (company_id = public.current_company_id());

-- ── contractors & labour categories (tenant-scoped) ────────────────────
alter table public.contractors enable row level security;
create policy contractors_tenant on public.contractors
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Contractor financial history is PROJECT-scoped, not merely tenant-scoped.
--
-- The app reads these only through server actions on Prisma/DIRECT_URL, which
-- bypasses RLS, so these policies change nothing for the application. They close
-- the direct-access path: the publishable key ships to the browser, so a
-- signed-in project-scoped user could otherwise hand-craft a Supabase call and
-- read every contractor ledger entry and settlement in the company.
--
-- RLS cannot see the `contractors.view_all` application permission, so it
-- approximates with is_owner() and is deliberately stricter than the app for a
-- non-Owner Admin — harmless, since no client code reads these tables.
alter table public.contractor_ledger_entries enable row level security;
drop policy if exists contractor_ledger_entries_tenant on public.contractor_ledger_entries;
create policy contractor_ledger_entries_tenant on public.contractor_ledger_entries
  for all using (
    company_id = public.current_company_id()
    and (public.can_access_project(project_id) or (project_id is null and public.is_owner()))
  )
  with check (
    company_id = public.current_company_id()
    and (public.can_access_project(project_id) or (project_id is null and public.is_owner()))
  );

alter table public.contractor_settlements enable row level security;
drop policy if exists contractor_settlements_tenant on public.contractor_settlements;
create policy contractor_settlements_tenant on public.contractor_settlements
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- What a settlement knew about its composition when it ran. Project-scoped from
-- the start via a denormalized project_id.
alter table public.contractor_settlement_breakdowns enable row level security;
drop policy if exists contractor_settlement_breakdowns_all on public.contractor_settlement_breakdowns;
create policy contractor_settlement_breakdowns_all on public.contractor_settlement_breakdowns
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

alter table public.labour_categories enable row level security;
create policy labour_categories_tenant on public.labour_categories
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

alter table public.labour_subcategories enable row level security;
create policy labour_subcategories_tenant on public.labour_subcategories
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Project ↔ contractor assignments (eligibility/config). Project-scoped like
-- labour_attendance/deadlines/documents: a PM can only see/mutate assignments
-- for projects they can access (Owner sees all). RLS is a backstop — the server
-- also enforces projects.edit + ownership via requireProjectWrite.
alter table public.project_contractor_assignments enable row level security;
create policy project_contractor_assignments_all on public.project_contractor_assignments
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- Project ↔ contractor engagement (contractor-first labour config). Supersedes
-- project_contractor_assignments. Project-scoped, same backstop rationale.
alter table public.project_contractors enable row level security;
create policy project_contractors_all on public.project_contractors
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- Project-contractor labour rates (child of project_contractors). Access follows
-- the parent's project visibility, tenant-scoped (mirrors po_line_items).
alter table public.project_contractor_labour_rates enable row level security;
create policy project_contractor_labour_rates_all on public.project_contractor_labour_rates
  for all using (
    exists (
      select 1 from public.project_contractors pc
      where pc.id = project_contractor_id
        and pc.company_id = public.current_company_id()
        and public.can_access_project(pc.project_id)
    )
  );

-- ── Contractor commercial agreements ───────────────────────────────────
-- Every one of these tables carries a DENORMALIZED project_id (from the parent
-- agreement), so they all take the same flat project-scoped policy as
-- project_contractors — no EXISTS subqueries, and a WITH CHECK on every one.
--
-- These definitions are duplicated in prisma/migration-contractor-contracts.sql
-- so a single-file deploy is self-sufficient. THIS FILE IS CANONICAL — keep the
-- two textually identical.
--
-- Postgres has no CREATE POLICY IF NOT EXISTS, so each is drop-then-create:
-- that makes this file re-runnable to convergence whether or not the migration
-- already created the policy. (The migration uses the pg_policies-guarded form
-- instead, so it is a no-op if this file ran first.)
alter table public.contractor_contracts enable row level security;
drop policy if exists contractor_contracts_all on public.contractor_contracts;
create policy contractor_contracts_all on public.contractor_contracts
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- Labour types in an agreement's commercial scope (tier-1 rate carrier).
alter table public.contract_scope_items enable row level security;
drop policy if exists contract_scope_items_all on public.contract_scope_items;
create policy contract_scope_items_all on public.contract_scope_items
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- Append-only effective-dated rate history.
alter table public.contract_scope_rate_revisions enable row level security;
drop policy if exists contract_scope_rate_revisions_all on public.contract_scope_rate_revisions;
create policy contract_scope_rate_revisions_all on public.contract_scope_rate_revisions
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- Earned-value checkpoints.
alter table public.contract_milestones enable row level security;
drop policy if exists contract_milestones_all on public.contract_milestones;
create policy contract_milestones_all on public.contract_milestones
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- Contract value variations / amendments.
alter table public.contract_amendments enable row level security;
drop policy if exists contract_amendments_all on public.contract_amendments;
create policy contract_amendments_all on public.contract_amendments
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- Payments against an agreement (mirrors vendor_payments).
alter table public.contractor_contract_payments enable row level security;
drop policy if exists contractor_contract_payments_all on public.contractor_contract_payments;
create policy contractor_contract_payments_all on public.contractor_contract_payments
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- Tier-2 (attendance-only) rate-change audit trail.
alter table public.project_contractor_labour_rate_revisions enable row level security;
drop policy if exists project_contractor_labour_rate_revisions_all
  on public.project_contractor_labour_rate_revisions;
create policy project_contractor_labour_rate_revisions_all
  on public.project_contractor_labour_rate_revisions
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- ── labour_attendance (tenant + PM-scoped via project access) ──────────
alter table public.labour_attendance enable row level security;
create policy labour_attendance_all on public.labour_attendance
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- ── vendors (tenant-scoped) ────────────────────────────────────────────
alter table public.vendors enable row level security;
create policy vendors_tenant on public.vendors
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

alter table public.vendor_favorites enable row level security;
create policy vendor_favorites_own on public.vendor_favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── purchase_orders (tenant + PM-scoped via project) ───────────────────
alter table public.purchase_orders enable row level security;
create policy purchase_orders_all on public.purchase_orders
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

-- ── po_line_items (via parent PO access) ───────────────────────────────
alter table public.po_line_items enable row level security;
create policy po_line_items_all on public.po_line_items
  for all using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_id
        and po.company_id = public.current_company_id()
        and public.can_access_project(po.project_id)
    )
  );

-- ── vendor_documents (tenant-scoped) ───────────────────────────────────
alter table public.vendor_documents enable row level security;
create policy vendor_documents_tenant on public.vendor_documents
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ── vendor_payments (tenant + PM-scoped via project) ───────────────────
-- Recording is open to owners + the assigned PM; DELETE is owner-only
-- (payments are financial records — removal is audited + restricted).
alter table public.vendor_payments enable row level security;
create policy vendor_payments_select on public.vendor_payments
  for select using (company_id = public.current_company_id() and public.can_access_project(project_id));
create policy vendor_payments_insert on public.vendor_payments
  for insert with check (company_id = public.current_company_id() and public.can_access_project(project_id));
create policy vendor_payments_update on public.vendor_payments
  for update using (company_id = public.current_company_id() and public.is_owner());
create policy vendor_payments_delete on public.vendor_payments
  for delete using (company_id = public.current_company_id() and public.is_owner());

-- ── goods_receipts (tenant + PM-scoped via project) ────────────────────
alter table public.goods_receipts enable row level security;
create policy goods_receipts_all on public.goods_receipts
  for all using (company_id = public.current_company_id() and public.can_access_project(project_id))
  with check (company_id = public.current_company_id() and public.can_access_project(project_id));

alter table public.goods_receipt_items enable row level security;
create policy goods_receipt_items_all on public.goods_receipt_items
  for all using (
    exists (
      select 1 from public.goods_receipts gr
      where gr.id = goods_receipt_id
        and gr.company_id = public.current_company_id()
        and public.can_access_project(gr.project_id)
    )
  );

-- ── Template for future domain tables ──────────────────────────────────
-- alter table public.<table> enable row level security;
-- create policy <table>_tenant on public.<table>
--   for all using (company_id = public.current_company_id())
--   with check (company_id = public.current_company_id());
--
-- Project-scoped tables additionally constrain PROJECT_MANAGER rows to
-- assigned projects; see docs/database.md.

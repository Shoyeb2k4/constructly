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

-- Contractor ledger + settlements (immutable financial records, tenant-scoped).
alter table public.contractor_ledger_entries enable row level security;
create policy contractor_ledger_entries_tenant on public.contractor_ledger_entries
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

alter table public.contractor_settlements enable row level security;
create policy contractor_settlements_tenant on public.contractor_settlements
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

alter table public.labour_categories enable row level security;
create policy labour_categories_tenant on public.labour_categories
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

alter table public.labour_subcategories enable row level security;
create policy labour_subcategories_tenant on public.labour_subcategories
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

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

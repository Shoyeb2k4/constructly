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

-- ── Template for future domain tables ──────────────────────────────────
-- alter table public.<table> enable row level security;
-- create policy <table>_tenant on public.<table>
--   for all using (company_id = public.current_company_id())
--   with check (company_id = public.current_company_id());
--
-- Project-scoped tables additionally constrain PROJECT_MANAGER rows to
-- assigned projects; see docs/database.md.

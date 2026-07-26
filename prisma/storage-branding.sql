-- Constructly — branding storage buckets + RLS.
-- Private buckets; the app serves assets via short-lived signed URLs. Size +
-- MIME limits are enforced at the storage layer as a second line of defense.
-- Isolation: every object path is "{companyId}/…". Company-shared assets are
-- readable/writable by any member of the company; per-user assets (signatures,
-- profile photos) are locked to their owner at "{companyId}/{userId}/…".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('company-logos',      'company-logos',      false, 2097152, ARRAY['image/png','image/jpeg','image/svg+xml','image/webp']),
  ('company-favicons',   'company-favicons',   false,  524288, ARRAY['image/png','image/svg+xml','image/webp','image/x-icon','image/vnd.microsoft.icon']),
  ('company-signatures', 'company-signatures', false, 1048576, ARRAY['image/png','image/jpeg','image/svg+xml','image/webp']),
  ('company-stamps',     'company-stamps',     false, 1048576, ARRAY['image/png','image/jpeg','image/svg+xml','image/webp']),
  ('profile-photos',     'profile-photos',     false, 1048576, ARRAY['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- storage.objects already has RLS enabled by Supabase. Replace any prior
-- combined policy with two: company-shared and per-user.
drop policy if exists "branding_company_rw" on storage.objects;
drop policy if exists "branding_user_rw" on storage.objects;

-- Company-shared assets: first path segment must equal the caller's company.
create policy "branding_company_rw" on storage.objects
  for all to authenticated
  using (
    bucket_id in ('company-logos','company-favicons','company-stamps')
    and (storage.foldername(name))[1] = public.current_company_id()::text
  )
  with check (
    bucket_id in ('company-logos','company-favicons','company-stamps')
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- Per-user assets: "{companyId}/{userId}/…" — the caller's company AND their own
-- uid. A member cannot read or write another member's signature or photo.
create policy "branding_user_rw" on storage.objects
  for all to authenticated
  using (
    bucket_id in ('company-signatures','profile-photos')
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id in ('company-signatures','profile-photos')
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Constructly — branding storage buckets + RLS.
-- Four private buckets; the app serves assets via short-lived signed URLs.
-- Size + MIME limits are enforced at the storage layer as a second line of
-- defense (the app validates first). Company isolation: every object path is
-- "{companyId}/…", and RLS ties access to the caller's company.

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

-- storage.objects already has RLS enabled by Supabase. One company-scoped
-- policy across all four branding buckets: a user may read/write only objects
-- whose first path segment equals their company_id.
drop policy if exists "branding_company_rw" on storage.objects;
create policy "branding_company_rw" on storage.objects
  for all to authenticated
  using (
    bucket_id in ('company-logos','company-favicons','company-signatures','company-stamps','profile-photos')
    and (storage.foldername(name))[1] = public.current_company_id()::text
  )
  with check (
    bucket_id in ('company-logos','company-favicons','company-signatures','company-stamps','profile-photos')
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

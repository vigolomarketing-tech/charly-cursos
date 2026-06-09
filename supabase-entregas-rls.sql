-- Run this in the Supabase SQL Editor for the production project.
-- It allows students to create/read only their own entregas and allows
-- the main admin to review and update every entrega.

alter table public.entregas enable row level security;

drop policy if exists "entregas_insert_own" on public.entregas;
drop policy if exists "entregas_select_own" on public.entregas;
drop policy if exists "entregas_admin_select_all" on public.entregas;
drop policy if exists "entregas_admin_update_all" on public.entregas;

create policy "entregas_insert_own"
on public.entregas
for insert
to authenticated
with check (
  user_email = (auth.jwt() ->> 'email')
);

create policy "entregas_select_own"
on public.entregas
for select
to authenticated
using (
  user_email = (auth.jwt() ->> 'email')
);

create policy "entregas_admin_select_all"
on public.entregas
for select
to authenticated
using (
  (auth.jwt() ->> 'email') = 'fitnesstrainingzone16@gmail.com'
);

create policy "entregas_admin_update_all"
on public.entregas
for update
to authenticated
using (
  (auth.jwt() ->> 'email') = 'fitnesstrainingzone16@gmail.com'
)
with check (
  (auth.jwt() ->> 'email') = 'fitnesstrainingzone16@gmail.com'
);

-- Optional Storage policies for the public bucket named "entregas".
-- Keep these if uploads ever fail with a storage RLS error.

drop policy if exists "storage_entregas_insert_own_folder" on storage.objects;
drop policy if exists "storage_entregas_public_read" on storage.objects;

create policy "storage_entregas_insert_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'entregas'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_entregas_public_read"
on storage.objects
for select
to public
using (
  bucket_id = 'entregas'
);

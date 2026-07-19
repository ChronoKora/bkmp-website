insert into storage.buckets (id, name, public)
values ('update-images', 'update-images', true)
on conflict (id) do update set public = true;

grant usage on schema storage to anon;
grant usage on schema storage to authenticated;

grant select, insert, update, delete on storage.objects to anon;
grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists "Allow anon read update images" on storage.objects;
create policy "Allow anon read update images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'update-images');

drop policy if exists "Allow anon upload update images" on storage.objects;
create policy "Allow anon upload update images"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'update-images');

drop policy if exists "Allow anon update update images" on storage.objects;
create policy "Allow anon update update images"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'update-images')
with check (bucket_id = 'update-images');

drop policy if exists "Allow anon delete update images" on storage.objects;
create policy "Allow anon delete update images"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'update-images');

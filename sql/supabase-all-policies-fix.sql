grant usage on schema public to anon;
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.incomes to anon, authenticated;
grant select, insert, update, delete on public.expenses to anon, authenticated;
grant select, insert, update, delete on public.investors to anon, authenticated;
grant select, insert, update, delete on public.updates to anon, authenticated;
grant select, insert, update, delete on public.wishes to anon, authenticated;
grant select, insert, update, delete on public.streamer_links to anon, authenticated;
grant select, insert, update, delete on public.about_blocks to anon, authenticated;
grant select, insert, update, delete on public.partner_shops to anon, authenticated;

alter table public.incomes enable row level security;
alter table public.expenses enable row level security;
alter table public.investors enable row level security;
alter table public.updates enable row level security;
alter table public.wishes enable row level security;
alter table public.streamer_links enable row level security;
alter table public.about_blocks enable row level security;
alter table public.partner_shops enable row level security;

drop policy if exists "Allow anon read incomes" on public.incomes;
create policy "Allow anon read incomes" on public.incomes for select to anon, authenticated using (true);
drop policy if exists "Allow anon insert incomes" on public.incomes;
create policy "Allow anon insert incomes" on public.incomes for insert to anon, authenticated with check (true);
drop policy if exists "Allow anon update incomes" on public.incomes;
create policy "Allow anon update incomes" on public.incomes for update to anon, authenticated using (true) with check (true);
drop policy if exists "Allow anon delete incomes" on public.incomes;
create policy "Allow anon delete incomes" on public.incomes for delete to anon, authenticated using (true);

drop policy if exists "Allow anon read expenses" on public.expenses;
create policy "Allow anon read expenses" on public.expenses for select to anon, authenticated using (true);
drop policy if exists "Allow anon insert expenses" on public.expenses;
create policy "Allow anon insert expenses" on public.expenses for insert to anon, authenticated with check (true);
drop policy if exists "Allow anon update expenses" on public.expenses;
create policy "Allow anon update expenses" on public.expenses for update to anon, authenticated using (true) with check (true);
drop policy if exists "Allow anon delete expenses" on public.expenses;
create policy "Allow anon delete expenses" on public.expenses for delete to anon, authenticated using (true);

drop policy if exists "Allow anon read investors" on public.investors;
create policy "Allow anon read investors" on public.investors for select to anon, authenticated using (true);
drop policy if exists "Allow anon insert investors" on public.investors;
create policy "Allow anon insert investors" on public.investors for insert to anon, authenticated with check (true);
drop policy if exists "Allow anon update investors" on public.investors;
create policy "Allow anon update investors" on public.investors for update to anon, authenticated using (true) with check (true);
drop policy if exists "Allow anon delete investors" on public.investors;
create policy "Allow anon delete investors" on public.investors for delete to anon, authenticated using (true);

drop policy if exists "Allow anon read updates" on public.updates;
create policy "Allow anon read updates" on public.updates for select to anon, authenticated using (true);
drop policy if exists "Allow anon insert updates" on public.updates;
create policy "Allow anon insert updates" on public.updates for insert to anon, authenticated with check (true);
drop policy if exists "Allow anon update updates" on public.updates;
create policy "Allow anon update updates" on public.updates for update to anon, authenticated using (true) with check (true);
drop policy if exists "Allow anon delete updates" on public.updates;
create policy "Allow anon delete updates" on public.updates for delete to anon, authenticated using (true);

drop policy if exists "Allow anon read wishes" on public.wishes;
create policy "Allow anon read wishes" on public.wishes for select to anon, authenticated using (true);
drop policy if exists "Allow anon insert wishes" on public.wishes;
create policy "Allow anon insert wishes" on public.wishes for insert to anon, authenticated with check (true);
drop policy if exists "Allow anon update wishes" on public.wishes;
create policy "Allow anon update wishes" on public.wishes for update to anon, authenticated using (true) with check (true);
drop policy if exists "Allow anon delete wishes" on public.wishes;
create policy "Allow anon delete wishes" on public.wishes for delete to anon, authenticated using (true);

drop policy if exists "Allow anon read streamer links" on public.streamer_links;
create policy "Allow anon read streamer links" on public.streamer_links for select to anon, authenticated using (true);
drop policy if exists "Allow anon insert streamer links" on public.streamer_links;
create policy "Allow anon insert streamer links" on public.streamer_links for insert to anon, authenticated with check (true);
drop policy if exists "Allow anon update streamer links" on public.streamer_links;
create policy "Allow anon update streamer links" on public.streamer_links for update to anon, authenticated using (true) with check (true);
drop policy if exists "Allow anon delete streamer links" on public.streamer_links;
create policy "Allow anon delete streamer links" on public.streamer_links for delete to anon, authenticated using (true);

drop policy if exists "Allow anon read about blocks" on public.about_blocks;
create policy "Allow anon read about blocks" on public.about_blocks for select to anon, authenticated using (true);
drop policy if exists "Allow anon insert about blocks" on public.about_blocks;
create policy "Allow anon insert about blocks" on public.about_blocks for insert to anon, authenticated with check (true);
drop policy if exists "Allow anon update about blocks" on public.about_blocks;
create policy "Allow anon update about blocks" on public.about_blocks for update to anon, authenticated using (true) with check (true);
drop policy if exists "Allow anon delete about blocks" on public.about_blocks;
create policy "Allow anon delete about blocks" on public.about_blocks for delete to anon, authenticated using (true);

drop policy if exists "Allow anon read partner shops" on public.partner_shops;
create policy "Allow anon read partner shops" on public.partner_shops for select to anon, authenticated using (true);
drop policy if exists "Allow anon insert partner shops" on public.partner_shops;
create policy "Allow anon insert partner shops" on public.partner_shops for insert to anon, authenticated with check (true);
drop policy if exists "Allow anon update partner shops" on public.partner_shops;
create policy "Allow anon update partner shops" on public.partner_shops for update to anon, authenticated using (true) with check (true);
drop policy if exists "Allow anon delete partner shops" on public.partner_shops;
create policy "Allow anon delete partner shops" on public.partner_shops for delete to anon, authenticated using (true);

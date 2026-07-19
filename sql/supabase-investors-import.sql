-- Bkmp Investment Dashboard - Investoren Schritt
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

alter table public.investors enable row level security;

drop policy if exists "Allow anon read investors" on public.investors;
create policy "Allow anon read investors" on public.investors for select to anon using (true);

drop policy if exists "Allow anon insert investors" on public.investors;
create policy "Allow anon insert investors" on public.investors for insert to anon with check (true);

drop policy if exists "Allow anon update investors" on public.investors;
create policy "Allow anon update investors" on public.investors for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete investors" on public.investors;
create policy "Allow anon delete investors" on public.investors for delete to anon using (true);

insert into public.investors (name, investment, profit_percent, start_date, end_date, note)
select 'Phil', 100000000, 15, '2026-05-28', '2026-08-28', 'Opphil'
where not exists (
  select 1 from public.investors
  where name = 'Phil' and investment = 100000000 and profit_percent = 15 and start_date = '2026-05-28' and end_date = '2026-08-28'
);

insert into public.investors (name, investment, profit_percent, start_date, end_date, note)
select 'Anonym', 50000000, 9, '2026-05-28', '2026-07-28', null
where not exists (
  select 1 from public.investors
  where name = 'Anonym' and investment = 50000000 and profit_percent = 9 and start_date = '2026-05-28' and end_date = '2026-07-28'
);

insert into public.investors (name, investment, profit_percent, start_date, end_date, note)
select 'Anonym', 150000000, 0, '2026-06-29', '2026-08-30', null
where not exists (
  select 1 from public.investors
  where name = 'Anonym' and investment = 150000000 and profit_percent = 0 and start_date = '2026-06-29' and end_date = '2026-08-30'
);

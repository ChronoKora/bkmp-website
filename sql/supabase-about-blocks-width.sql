-- Bkmp - "Wer sind wir": Blockbreite (nebeneinander setzen)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Erlaubt es, einen Block als "Halbe Breite" zu markieren, damit zwei
-- halbbreite Bloecke nebeneinander stehen statt untereinander.

alter table public.about_blocks add column if not exists width text not null default 'full';

alter table public.about_blocks drop constraint if exists about_blocks_width_check;
alter table public.about_blocks add constraint about_blocks_width_check check (width in ('full', 'half'));

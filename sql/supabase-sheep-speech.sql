-- Bkmp - Sprechblasen-Text fuer das anklickbare Schaf-Easter-Egg im Banner.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Nutzt dieselbe Singleton-Zeile wie der Wartungsmodus-Schalter
-- (site_flags, siehe supabase-site-maintenance-flag.sql) - eine neue
-- Spalte statt einer neuen Tabelle, RLS ist an der Zeile bereits vorhanden
-- (oeffentlich lesbar, nur Admins duerfen schreiben).

alter table public.site_flags
  add column if not exists sheep_speech_text text not null default 'Määäh! 🐑';

update public.site_flags set sheep_speech_text = 'Määäh! 🐑'
  where id = true and (sheep_speech_text is null or sheep_speech_text = '');

-- Legendaeren-Aufstieg (Lategame-Content, Spieler-Vorgabe 16.07.): eine
-- zweite erwachsene Legendaere derselben Art wird als Fodder verbraucht,
-- die behaltene steigt eine Stufe (bis max. 5, siehe
-- BKMP_DRAGON_ASCEND_MAX_LEVEL in idledorf.js) - +10% auf alle Hauptwerte
-- pro Stufe. Exakt dasselbe Prinzip wie der bestehende Runen-Aufstieg
-- (BKMP_RUNE_ASCEND_MAX_LEVEL).
--
-- Idempotent, gleiches Muster wie die anderen player_dragons-Erweiterungen.
alter table public.player_dragons
  add column if not exists ascension_level integer not null default 0;

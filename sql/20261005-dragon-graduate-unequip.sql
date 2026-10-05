-- ============================================================
-- Drachen: Beim Erwachsenwerden den Begleiter-Status loeschen (05.10.2026)
--
-- Problem: Ein Jugendlicher steht im Trainings-Platz (is_companion = true).
-- Beim Erwachsenwerden aenderte das Spiel nur Stufe und Werte - die
-- Markierung blieb. Der Drache war danach still als erwachsener
-- Kampf-Begleiter "ausgeruestet": er blockierte Expeditionen (Teams duerfen
-- keine Begleiter enthalten) und das Freilassen, sammelte Bindung,
-- Begleiter-Zeit und Boss-Siege und tauchte bei vollen Kampf-Plaetzen in
-- keinem Platz auf.
--
-- Der aktuelle Spielstand-Code (bkmpDragonEvolveToAdult) setzt is_companion
-- jetzt selbst auf false. Dieser Trigger sichert dasselbe fuer ALLE Wege ab
-- (auch fuer Browser, die noch eine aeltere Programmversion im Cache haben).
--
-- Rein additiv und idempotent. Aendert keine bestehenden Zeilen; bereits
-- haengende Markierungen raeumt das Spiel beim naechsten Laden selbst auf
-- (bkmpDragonHealStaleCompanions).
-- ============================================================

create or replace function public.player_dragons_graduation_unequip()
returns trigger language plpgsql as $$
begin
  if OLD.stage = 'teen' and NEW.stage = 'adult' then
    NEW.is_companion := false;
  end if;
  return NEW;
end;
$$;

drop trigger if exists player_dragons_graduation_unequip_trg on public.player_dragons;
create trigger player_dragons_graduation_unequip_trg
  before update of stage on public.player_dragons
  for each row execute function public.player_dragons_graduation_unequip();

notify pgrst, 'reload schema';

/* ============================================================
   Sicherheits-Haertung (14.07.): brandneue Accounts duerfen keine
   "ererbten" Riesenwerte einschleusen.

   Root Cause des "Adolf"/"KillTheJews88"/"Heinrich_H"-Vorfalls: bonk_count
   (und die anderen selbst-gemeldeten Zaehler wie achievements_unlocked/
   minutes_spent/panel_opens) werden clientseitig in localStorage gefuehrt
   und beim Sync einfach hochgeladen (siehe upsertPlayerStats in
   supabase.js). localStorage haengt am GERAET, nicht am Account - eine
   Person, die sich nach einer Namenssperre einfach einen NEUEN Account
   registriert, "erbt" dadurch sofort den kompletten lokalen Stand des alten
   Accounts (bonk_count sprang jedes Mal nahtlos weiter: 118k -> 120k -> ...).
   index.html setzt bonk_count beim Ausloggen inzwischen selbst auf 0 zurueck
   (Client-Fix) - das hier ist die serverseitige Absicherung dagegen, falls
   jemand den Client umgeht und direkt per API einen praeparierten Erstwert
   hochlaedt.

   Greift NUR beim allerersten Sync eines Accounts (INSERT, also bevor
   ueberhaupt eine Zeile existiert) - ein bestehender, ehrlich erspielter
   hoher Stand (auch > 100k Bonks) wird bei UPDATEs NICHT angetastet, nur das
   ploetzliche Auftauchen bei einem brandneuen Account wird eingedaemmt.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

create or replace function public.sanitize_new_player_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bonk_count > 200 then
    new.bonk_count := 0;
  end if;
  if new.achievements_unlocked > 10 then
    new.achievements_unlocked := 0;
  end if;
  if new.minutes_spent > 600 then
    new.minutes_spent := 0;
  end if;
  if new.panel_opens > 500 then
    new.panel_opens := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists bkmp_sanitize_new_player_stats on public.player_stats;
create trigger bkmp_sanitize_new_player_stats
  before insert on public.player_stats
  for each row execute function public.sanitize_new_player_stats();

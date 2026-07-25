-- Bkmp - RUECKBLICKENDE SICHERHEITSPRUEFUNG (read-only, keine
-- Schreibzugriffe). Die Prestige-Reparatur ist bereits einmal LIVE
-- gelaufen - mit der ERSTEN, WENIGER STRENGEN Fassung der Migration, die
-- bei einem alten Namen einfach die zeitlich juengste Umbenennung nahm,
-- OHNE zu pruefen, ob dieser alte Name im Laufe der Zeit von MEHR ALS
-- EINEM echten Spieler benutzt wurde (siehe Nachbesserung 3 in der
-- Haupt-Migrationsdatei).
--
-- Diese Abfrage findet Konten, deren idle_prestige_state-Zeile durch eine
-- Umbenennung entstanden ist, bei der der ALTE Name auch von mindestens
-- einem ANDEREN Konto irgendwann benutzt wurde. Ein Treffer hier ist KEIN
-- automatischer Beweis eines Fehlers (die Zuordnung kann trotzdem richtig
-- sein) - aber es lohnt sich, diese Zeilen von Hand zu pruefen (wirkt der
-- prestige_level fuer den Spieler plausibel? kennt der Spieler seinen
-- alten Namen?).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

with my_last_rename as (
  select distinct on (auth_user_id) auth_user_id, old_name, new_name, changed_at
  from public.player_name_history
  order by auth_user_id, changed_at desc
),
shared_old_names as (
  select lower(old_name) as old_name_key
  from public.player_name_history
  group by lower(old_name)
  having count(distinct auth_user_id) > 1
)
select
  ps.auth_user_id,
  ps.display_name as aktueller_name,
  mlr.old_name as woher_umbenannt,
  p.prestige_level,
  p.prestige_points,
  p.updated_at as prestige_zuletzt_geaendert
from public.idle_prestige_state p
join public.player_stats ps on ps.name_key = p.name_key
join my_last_rename mlr on mlr.auth_user_id = ps.auth_user_id
join shared_old_names son on son.old_name_key = lower(mlr.old_name)
order by p.updated_at desc;

-- Liefert diese Abfrage KEINE Zeilen: alles gut, der bereits gelaufene
-- Durchlauf hat garantiert keinen mehrdeutigen Fall getroffen.
-- Liefert sie Zeilen: bitte die aufgelisteten Konten kurz von Hand pruefen
-- (z.B. im Admin-Panel den Spieler fragen/den prestige_level mit dem
-- vergleichen, was plausibel erscheint) - melde dich dann, wir schauen
-- gemeinsam, ob dort tatsaechlich etwas korrigiert werden muss.

-- Bkmp - REIN LESENDE Diagnose: bestaetigt (oder widerlegt) die
-- Arbeitshypothese aus sql/20260811-anticheat-guard-flag-insert-safety-net.sql
-- (dass idle_anticheat_flags.triggered_by ein Array-Typ statt text war/ist).
-- Aendert NICHTS, nur zur Bestaetigung - bitte das Ergebnis kurz melden,
-- dann kann die endgueltige Ursache dokumentiert werden. Der eigentliche
-- Fix (Sicherheitsnetz-Datei) behebt das Speicherproblem unabhaengig vom
-- Ergebnis dieser Abfrage bereits.

select column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'idle_anticheat_flags'
order by ordinal_position;

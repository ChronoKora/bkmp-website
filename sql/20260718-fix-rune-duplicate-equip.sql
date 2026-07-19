-- Bkmp - strukturelle (datenbankseitige) Absicherung gegen doppelt
-- ausgeruestete Runenarten. Supabase Dashboard > SQL Editor > New query >
-- diesen Inhalt ausfuehren.
--
-- HINTERGRUND (Spieler-Bug-Report 18.07.2026): mehrere Spieler hatten 2x
-- Wuchtrune bzw. 2x Gluecksrune gleichzeitig ausgeruestet, obwohl pro
-- Runenart (rune_type) immer nur eine gleichzeitig ausgeruestet sein darf.
-- Ursache: sql/supabase-idle-runes.sql (Zeile 6-7) hat diese Regel von
-- Anfang an bewusst NUR clientseitig durchgesetzt ("rune_type ist KEIN
-- unique-Constraint, das erzwingt idledorf.js beim Ausruesten selbst") -
-- ein clientseitiger Check sieht aber nie, was auf einem ANDEREN
-- Geraet/Tab zwischenzeitlich ausgeruestet wurde, und
-- updatePlayerRuneEquipped() in supabase.js ist ein einfaches
-- Einzelzeilen-Update ohne typuebergreifende Exklusivitaet.
--
-- Der clientseitige Teil ist bereits gefixt (js/systems/bkmp-runes.js:
-- bkmpRuneToggleEquip blockiert jetzt einen Konflikt statt still
-- auszutauschen, bkmpRuneNormalizeDuplicateEquips() heilt beim Laden
-- automatisch bereits bestehende ungueltige Zustaende). Diese Migration
-- ist die zusaetzliche, echte STRUKTURELLE Absicherung auf DB-Ebene, damit
-- ein Race zwischen zwei Geraeten/Tabs kuenftig gar nicht erst als Zeile
-- gespeichert werden kann - unabhaengig vom Client-Code.
--
-- WICHTIG: Schritt 1 (Bereinigung) MUSS vor Schritt 2 (Unique-Index)
-- laufen, sonst lehnt Postgres den Index wegen bereits vorhandener
-- Duplikate ab. Es wird dabei KEINE Rune geloescht - Duplikate werden nur
-- auf equipped=false gesetzt (identische Logik/Regel wie die clientseitige
-- bkmpRuneNormalizeDuplicateEquips(): pro Spieler+Runenart bleibt die
-- rechnerisch staerkste Rune ausgeruestet - Hauptwert * (1 +
-- Aufwertungsstufe * 0.08), bei Gleichstand die aeltere Zeile).

-- Schritt 1: bestehende ungueltige Doppel-Ausruestungen bereinigen.
with ranked as (
  select
    id,
    row_number() over (
      partition by name_key, rune_type
      order by (rolled_value * (1 + upgrade_level * 0.08)) desc, created_at asc
    ) as rn
  from public.idle_player_runes
  where equipped = true
)
update public.idle_player_runes r
set equipped = false
from ranked
where r.id = ranked.id
  and ranked.rn > 1;

-- Schritt 2: pro (Spieler, Runenart) darf nur noch eine Zeile equipped=true
-- sein - macht das Bug-Szenario (2x Wuchtrune gleichzeitig ausgeruestet)
-- ab jetzt auf DB-Ebene unmoeglich, auch bei parallelen Schreibzugriffen
-- von mehreren Geraeten/Tabs.
create unique index if not exists idle_player_runes_one_equipped_per_type
on public.idle_player_runes (name_key, rune_type)
where equipped = true;

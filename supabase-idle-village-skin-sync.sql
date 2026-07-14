-- Bkmp - aktive Dorf-Skin-Wahl serverseitig speichern (Spieler-Wunsch
-- 14.07.: "Jeder mit seinem Dorfskin was er ausgerüstet hat" fuer die
-- Arena-Kampfanimation). Die Wahl lag bisher AUSSCHLIESSLICH in
-- localStorage (bkmpSetActiveVillageSkinId) - andere Spieler (z.B. ein
-- Arena-Gegner) konnten sie serverseitig gar nicht sehen. Wird jetzt
-- zusaetzlich in idle_player_state gespiegelt (siehe bkmpIdleEquipVillageSkin
-- in idledorf.js), damit die Arena-Kampfanimation den echten, aktuell
-- ausgeruesteten Skin beider Seiten anzeigen kann.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_player_state add column if not exists active_village_skin text not null default 'standard';

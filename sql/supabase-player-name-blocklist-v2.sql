-- Bkmp - Namensfilter v2: Leetspeak-/Zahlen-Substitution.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Braucht supabase-player-name-blocklist.sql (Grundtabelle + Trigger).
--
-- Spieler-Anmerkung (14.07.): "auch aehnliche Namen?" - die urspruengliche
-- Normalisierung (klein, Sonderzeichen raus) faengt Formatierungs-Varianten
-- wie "Adolf_Hitler" ab, aber KEINE Leetspeak-Ersetzungen wie "H1tler" oder
-- "4dolfHitler". Diese Version ersetzt zusaetzlich gaengige Zahlen/Symbole
-- durch ihre Buchstaben-Entsprechung, BEVOR verglichen wird.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

create or replace function public.is_name_blocked(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_display_names b
    where length(b.name_key) > 0
    and (
      -- Normalfall: nur Sonderzeichen raus, klein geschrieben
      regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g') like '%' || b.name_key || '%'
      or
      -- Leetspeak-Fall: gaengige Zahlen/Symbole zusaetzlich auf Buchstaben
      -- gemappt (0->o, 1->i, 3->e, 4->a, 5->s, 7->t, 8->b, @->a), erst
      -- danach verbleibende Ziffern/Symbole entfernen und vergleichen.
      -- 1:1-Zeichenzuordnung (translate braucht gleich lange from/to-Strings):
      -- 0134578@ -> oieastba. Schutz: rein numerische Eintraege (z. B. der
      -- Hasscode "1488") wuerden nach dem Ziffern-Entfernen zu einem LEEREN
      -- Suchstring werden - "%%" wuerde dann JEDEN Namen faelschlich blocken.
      -- Deshalb hier nur greifen, wenn nach dem Entfernen noch Buchstaben
      -- uebrig bleiben (der Normalfall oben deckt reine Zahlencodes bereits
      -- ohne Leetspeak-Uebersetzung ab).
      (
        length(regexp_replace(b.name_key, '[0-9]', '', 'g')) > 0
        and regexp_replace(
          translate(lower(coalesce(p_name, '')), '0134578@', 'oieastba'),
          '[^a-z]', '', 'g'
        ) like '%' || regexp_replace(b.name_key, '[0-9]', '', 'g') || '%'
      )
    )
  );
$$;
grant execute on function public.is_name_blocked(text) to anon, authenticated;

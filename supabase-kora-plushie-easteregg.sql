-- Bkmp - Easter Egg: "Koras Pluschie" mit echtem, im Beispiel-Platzhalter
-- versteckten Einloesecode.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- assets/plushies/Kora.png liegt schon im Projekt (per "Ordner scannen"
-- waere id/name identisch entstanden: id "kora", name "Kora Pluschie" -
-- diese Migration legt beides direkt an, ohne dass im Admin-Panel geklickt
-- werden muss, damit der Code unten garantiert zum echten Datensatz passt).
--
-- Der Code "KORA-7F3X-9QLM" wird als Platzhalter-Text im Code-Einloese-
-- Feld angezeigt (index.html), genau wie das bisherige Beispiel
-- "YAKSHA-8F4K-2Q9M" - nur dass dieser hier echt ist. Wer ihn abtippt/
-- kopiert und einloest, bekommt Koras Pluschie + den Erfolg
-- "Du kannst mich austricksen.." + den Titel "SchlauerFinder".

insert into public.plushies (id, name, image_url, description, rarity)
values ('kora', 'Kora Plüshie', 'assets/plushies/Kora.png', 'Ein seltener Fund für alle, die ganz genau hinschauen.', 'Legendär')
on conflict (id) do nothing;

insert into public.plushie_codes (code, plushie_id, note, created_by_admin)
values ('KORA-7F3X-9QLM', 'kora', 'Easter Egg: echter Code im Beispiel-Platzhalter des Code-Einloese-Felds versteckt.', 'system')
on conflict (code) do nothing;

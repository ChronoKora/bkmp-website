-- Bkmp - MapArt Marketplace: Kategorien auf die neue 4er-Liste umgestellt
-- (2D Teppich / 2D All Block / 3D Wolle / 3D All Block statt der alten
-- 6 Kategorien PixelArt/Teppich/Wolle/Allblock/3D/Sonstiges).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt komplett ausfuehren.
--
-- Bestehende Auftraege mit einer alten Kategorie werden NICHT automatisch
-- umgemappt (das waere reines Raten bei echten Kundendaten) - die alten
-- Werte bleiben als gueltige Legacy-Kategorien in der Datenbank erlaubt,
-- damit nichts kaputtgeht. Im Frontend zeigt bkmpMapCategoryLabel() fuer
-- unbekannte/alte Kategorien einfach den rohen Wert an statt zu brechen.

alter table public.map_orders drop constraint if exists map_orders_category_check;
alter table public.map_orders add constraint map_orders_category_check
  check (category in (
    '2d_teppich', '2d_allblock', '3d_wolle', '3d_allblock',
    'pixelart', 'teppich', 'wolle', 'allblock', '3d', 'sonstiges'
  ));

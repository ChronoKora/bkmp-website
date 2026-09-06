-- 06.09.2026: "Tägliches Einreiche-Limit" (create_card_submission, siehe
-- sql/20260902-mod-account-linking-and-submissions.sql, zuletzt per
-- sql/20260904-mod-submission-daily-limit-25.sql von 10 auf 25 erhöht)
-- auf Nutzerwunsch von 25 auf 200 Einreichungen erhöht (eine zwischen-
-- zeitlich erwogene Erhöhung auf 30 wurde nie live ausgeführt - dieser
-- Datei ersetzt jene Vorstufe direkt, kein Zwischenschritt nötig). Einzige
-- Änderung ggü. der zuletzt gültigen Fassung: die Zahl "25" -> "200" in der
-- check_and_record_rate_limit()-Zeile - alles andere (Fensterbreite
-- 86400s = 24h rollierend, kein fester Mitternachts-Reset, siehe
-- check_and_record_rate_limit()'s eigene Definition; Validierung/Insert
-- danach) bleibt byte-identisch zur zuletzt gültigen Fassung. Reine
-- Server-/DB-Änderung - die Mod selbst kennt/prüft diese Zahl nirgends
-- (übersetzt nur den vom Server zurückgegebenen "rate_limited"-Fehlercode
-- in eine deutsche Meldung, siehe SubmissionApiClient.java), braucht also
-- kein neues Deploy für diese Änderung.
create or replace function public.create_card_submission(
  p_raw_token text,
  p_minecraft_name text,
  p_image_url text,
  p_card_name text,
  p_category text,
  p_series text default null,
  p_width_maps integer default null,
  p_height_maps integer default null,
  p_total_maps integer default null,
  p_server text default null,
  p_warp text default null,
  p_seller text default null,
  p_price numeric default null,
  p_creator text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_new_id uuid;
  v_rate_ok boolean;
begin
  v_uid := public._resolve_mod_token(p_raw_token);

  select public.check_and_record_rate_limit('submission_create:' || v_uid::text, 'submission_create', 200, 86400) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;

  if p_card_name is null or length(trim(p_card_name)) = 0 then
    raise exception 'card_name_required';
  end if;
  if p_category is null or length(trim(p_category)) = 0 then
    raise exception 'category_required';
  end if;
  if p_image_url is null or length(trim(p_image_url)) = 0 then
    raise exception 'image_required';
  end if;
  -- Nur Bilder akzeptieren, die tatsaechlich vom neuen Upload-Endpunkt
  -- stammen (api/card-submission-image.js schreibt ausschliesslich in
  -- dieses Praefix) - verhindert, dass ein manipulierter Aufruf eine
  -- beliebige fremde image_url (z.B. eine andere Domain) einschleust.
  if p_image_url not like 'https://zgknyrwzpohvfdweomxf.supabase.co/storage/v1/object/public/update-images/card-submissions/%' then
    raise exception 'invalid_image_url';
  end if;
  if length(coalesce(p_card_name, '')) > 120
    or length(coalesce(p_category, '')) > 60
    or length(coalesce(p_series, '')) > 120
    or length(coalesce(p_server, '')) > 40
    or length(coalesce(p_warp, '')) > 120
    or length(coalesce(p_seller, '')) > 60
    or length(coalesce(p_creator, '')) > 60
    or length(coalesce(p_description, '')) > 2000
    or length(coalesce(p_minecraft_name, '')) > 40
  then
    raise exception 'field_too_long';
  end if;
  if p_price is not null and (p_price < 0 or p_price > 100000000) then
    raise exception 'invalid_price';
  end if;
  if p_width_maps is not null and (p_width_maps < 1 or p_width_maps > 30) then
    raise exception 'invalid_dimensions';
  end if;
  if p_height_maps is not null and (p_height_maps < 1 or p_height_maps > 30) then
    raise exception 'invalid_dimensions';
  end if;

  insert into public.card_submissions (
    auth_user_id, minecraft_name, image_url, card_name, category, series,
    width_maps, height_maps, total_maps, server, warp, seller, price, creator, description, status
  ) values (
    v_uid, nullif(trim(coalesce(p_minecraft_name, '')), ''), p_image_url, trim(p_card_name), trim(p_category), nullif(trim(coalesce(p_series, '')), ''),
    p_width_maps, p_height_maps, p_total_maps, nullif(trim(coalesce(p_server, '')), ''), nullif(trim(coalesce(p_warp, '')), ''),
    nullif(trim(coalesce(p_seller, '')), ''), p_price, nullif(trim(coalesce(p_creator, '')), ''), nullif(trim(coalesce(p_description, '')), ''), 'pending'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.create_card_submission(text, text, text, text, text, text, integer, integer, integer, text, text, text, numeric, text, text) to anon, authenticated;

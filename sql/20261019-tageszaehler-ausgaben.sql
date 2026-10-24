-- ============================================================
-- Tageszaehler-Import: Ausgaben (19.10.2026)
--
-- Erweitert sql/20261015-tageszaehler-import.sql (muss vorher ausgefuehrt sein).
-- Grundsatz des Inhabers: "Einnahmen sind Einnahmen und alles, was wir ankaufen, sind Ausgaben."
-- Der Tageszaehler (ab Version 2.4.0, Importdatei Version 2) liefert je Tag die Verkaeufe als
-- Einnahmen und die Ankaeufe getrennt als Ausgaben. Diese Datei sorgt dafuer, dass die Ausgaben mit
-- denselben Schutzregeln in public.expenses landen wie die Einnahmen in public.incomes:
--   * Protokoll in tageszaehler_import_lines (neue Spalten kind, expense_id),
--     Schluessel 'tz1:<konto>:<JJJJ-MM-TT>:ausgabe:<zaehler-kategorie>'
--   * die Vorschau zeigt auch Ausgaben (fruehere Importe und von Hand erfasste Ausgaben der Tage)
--   * der Stand-Fingerabdruck umfasst auch die Ausgaben der Tage
--   * Anlegen / Aktualisieren / Entfernen / Ueberspringen wie bei den Einnahmen: eine aeltere
--     Revision ueberschreibt nichts, eine Wiederholung bucht nichts doppelt, alles oder nichts.
-- Von Hand erfasste Ausgaben werden nie geaendert oder entfernt (die Vorschau zeigt sie nur an).
-- Bezeichnung der Ausgabe: 'Ankauf <Zaehler-Kategorie>' (z. B. "Ankauf Rohstoffe & Blöcke"); sie
-- zaehlt wie jede Ausgabe in Uebersicht, Finanzen und Mitarbeiter-Abrechnung.
-- Auftraege ohne "kind" (Importdatei Version 1) werden unveraendert als Einnahmen behandelt.
--
-- Ausfuehren: Supabase-Dashboard -> SQL Editor -> diesen Inhalt ausfuehren (nach 20261015-...).
-- Mehrfaches Ausfuehren ist unschaedlich.
-- ============================================================

alter table public.tageszaehler_import_lines add column if not exists kind text not null default 'einnahme';
alter table public.tageszaehler_import_lines add column if not exists expense_id uuid;   -- bewusst KEIN Fremdschluessel (wie income_id)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tageszaehler_import_lines_kind_check') then
    alter table public.tageszaehler_import_lines
      add constraint tageszaehler_import_lines_kind_check check (kind in ('einnahme', 'ausgabe'));
  end if;
end $$;
create index if not exists tageszaehler_import_lines_expense_idx on public.tageszaehler_import_lines (expense_id);

-- ---------- Stand-Fingerabdruck der betroffenen Tage (jetzt mit Ausgaben) ----------
create or replace function public.tageszaehler_import_snapshot(p_konto text, p_dates date[])
returns text language sql stable security definer set search_path = public as $$
  select md5(
    coalesce((select string_agg(concat_ws('#', l.import_key, l.kind, l.status, coalesce(l.income_id::text, '-'),
                                          coalesce(l.expense_id::text, '-'), l.website_category,
                                          l.amount::text, coalesce(l.quantity::text, '-'), l.revision_id, l.fingerprint),
                                '|' order by l.import_key)
              from public.tageszaehler_import_lines l
              where l.konto = p_konto and l.business_date = any(p_dates)), '')
    || '||' ||
    coalesce((select string_agg(concat_ws('#', i.id::text, i.category, i.amount::text, coalesce(i.quantity::text, '-'),
                                          i.date::text, coalesce(i.note, '-')),
                                '|' order by i.id)
              from public.incomes i
              where i.date = any(p_dates)), '')
    || '||' ||
    coalesce((select string_agg(concat_ws('#', e.id::text, e.category, e.amount::text, e.date::text, coalesce(e.note, '-')),
                                '|' order by e.id)
              from public.expenses e
              where e.date = any(p_dates)), '')
  );
$$;

-- ---------- Vorschau (nur lesend; jetzt mit Ausgaben) ----------
create or replace function public.tageszaehler_import_preview(p_konto text, p_dates date[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_dates date[];
begin
  if not public.is_active_admin() then raise exception 'not_admin'; end if;
  if p_konto is null or p_konto !~ '^[a-z0-9-]{1,40}$' then raise exception 'invalid_konto'; end if;
  v_dates := array(select distinct d from unnest(coalesce(p_dates, '{}'::date[])) as d where d is not null order by d);
  if coalesce(array_length(v_dates, 1), 0) = 0 or array_length(v_dates, 1) > 62 then raise exception 'invalid_dates'; end if;

  return jsonb_build_object(
    'snapshot', public.tageszaehler_import_snapshot(p_konto, v_dates),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'import_key', l.import_key,
               'kind', l.kind,
               'date', l.business_date,
               'counter_category_id', l.counter_category_id,
               'counter_category_name', l.counter_category_name,
               'website_category', l.website_category,
               'status', l.status,
               'amount', l.amount,
               'quantity', l.quantity,
               'quantity_status', l.quantity_status,
               'revision_id', l.revision_id,
               'revision_created_at', l.revision_created_at,
               'fingerprint', l.fingerprint,
               'imported_at', l.imported_at,
               'income_id', l.income_id,
               'income', (select jsonb_build_object('id', i.id, 'category', i.category, 'amount', i.amount,
                                                    'quantity', i.quantity, 'date', i.date, 'note', i.note)
                          from public.incomes i where i.id = l.income_id),
               'expense_id', l.expense_id,
               'expense', (select jsonb_build_object('id', e.id, 'category', e.category, 'amount', e.amount,
                                                     'date', e.date, 'note', e.note)
                           from public.expenses e where e.id = l.expense_id))
             order by l.business_date, l.kind, l.counter_category_id)
      from public.tageszaehler_import_lines l
      where l.konto = p_konto and l.business_date = any(v_dates)), '[]'::jsonb),
    'incomes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'category', i.category, 'amount', i.amount, 'quantity', i.quantity,
               'date', i.date, 'note', i.note, 'created_at', i.created_at,
               'from_import', exists (select 1 from public.tageszaehler_import_lines l2 where l2.income_id = i.id))
             order by i.date, i.category, i.created_at, i.id)
      from public.incomes i
      where i.date = any(v_dates)), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'category', e.category, 'amount', e.amount,
               'date', e.date, 'note', e.note, 'created_at', e.created_at,
               'from_import', exists (select 1 from public.tageszaehler_import_lines l2 where l2.expense_id = e.id))
             order by e.date, e.category, e.created_at, e.id)
      from public.expenses e
      where e.date = any(v_dates)), '[]'::jsonb)
  );
end;
$$;

-- ---------- Bestaetigte Uebernahme (schreibt, alles oder nichts; jetzt mit Ausgaben) ----------
create or replace function public.tageszaehler_import_apply(p_batch_id uuid, p_snapshot text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_hash      text;
  v_batch     public.tageszaehler_import_batches%rowtype;
  v_konto     text;
  v_lines     jsonb;
  v_dates     date[];
  v_line      jsonb;
  v_kind      text;
  v_date      date;
  v_cat       text;
  v_cat_name  text;
  v_web       text;
  v_amount    numeric;
  v_qty       numeric;
  v_qstatus   text;
  v_rev       text;
  v_rev_at    timestamptz;
  v_fp        text;
  v_action    text;
  v_key       text;
  v_detail    text;
  v_imp       public.tageszaehler_import_lines%rowtype;
  v_has_imp   boolean;
  v_inc       public.incomes%rowtype;
  v_exp       public.expenses%rowtype;
  v_has_link  boolean;
  v_rid       text;
  v_rid_uuid  uuid;
  v_repl      public.incomes%rowtype;
  v_replaced  jsonb;
  v_note      text;
  v_new_id    uuid;
  v_status    text;
  v_keys      text[] := '{}';
  v_day_rev   jsonb := '{}'::jsonb;
  v_out_lines jsonb := '[]'::jsonb;
  n_created   integer := 0;
  n_updated   integer := 0;
  n_same      integer := 0;
  n_removed   integer := 0;
  n_skipped   integer := 0;
  n_replaced  integer := 0;
  v_result    jsonb;
begin
  if not public.is_active_admin() then raise exception 'not_admin'; end if;
  if p_batch_id is null then raise exception 'invalid_batch'; end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' then raise exception 'invalid_request'; end if;

  -- Importe nacheinander (zwei gleichzeitige Bestaetigungen koennen sich nicht ueberholen).
  perform pg_advisory_xact_lock(hashtext('bkmp_tageszaehler_import'));

  v_hash := md5(p_request::text);
  select * into v_batch from public.tageszaehler_import_batches b where b.batch_id = p_batch_id;
  if found then
    -- Wiederholung desselben Auftrags (z. B. Antwort ging verloren): nichts erneut buchen.
    if v_batch.request_hash <> v_hash then raise exception 'batch_conflict'; end if;
    return v_batch.result || jsonb_build_object('wiederholt', true);
  end if;

  v_konto := p_request ->> 'konto';
  if v_konto is null or v_konto !~ '^[a-z0-9-]{1,40}$' then raise exception 'invalid_konto'; end if;
  v_lines := p_request -> 'lines';
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 2000 then
    raise exception 'invalid_lines';
  end if;

  begin
    v_dates := array(select distinct (x ->> 'date')::date from jsonb_array_elements(v_lines) as x order by 1);
  exception when others then
    raise exception 'invalid_date';
  end;
  if array_length(v_dates, 1) > 62 or array_position(v_dates, null) is not null then raise exception 'invalid_dates'; end if;

  if public.tageszaehler_import_snapshot(v_konto, v_dates) is distinct from p_snapshot then
    raise exception 'stale_preview';
  end if;

  for v_line in select x from jsonb_array_elements(v_lines) as x loop
    -- ---- Felder pruefen ----
    v_kind := coalesce(v_line ->> 'kind', 'einnahme');
    v_date := (v_line ->> 'date')::date;
    v_cat := v_line ->> 'counter_category_id';
    v_cat_name := btrim(coalesce(v_line ->> 'counter_category_name', ''));
    v_action := v_line ->> 'action';
    v_qstatus := v_line ->> 'quantity_status';
    v_rev := v_line ->> 'revision_id';
    v_fp := v_line ->> 'fingerprint';
    if v_kind not in ('einnahme', 'ausgabe') then raise exception 'invalid_kind'; end if;
    if v_cat is null or v_cat !~ '^[a-z0-9_]{1,40}$' then raise exception 'invalid_category'; end if;
    if length(v_cat_name) = 0 or length(v_cat_name) > 60 then raise exception 'invalid_category'; end if;
    if v_kind = 'einnahme' then
      v_web := v_line ->> 'website_category';
      if v_web is null or not (v_web = any(public.tageszaehler_import_website_categories())) then raise exception 'invalid_website_category'; end if;
    else
      -- Ausgaben haben auf der Website keine Kategorie, nur eine Bezeichnung; sie wird hier gebildet.
      v_web := 'Ankauf ' || v_cat_name;
    end if;
    if v_action is null or v_action not in ('create', 'update', 'remove', 'skip') then raise exception 'invalid_action'; end if;
    if v_kind = 'ausgabe' then v_qstatus := coalesce(v_qstatus, 'offen'); end if;
    if v_qstatus is null or v_qstatus not in ('vollstaendig', 'teilweise', 'offen') then raise exception 'invalid_quantity'; end if;
    if v_rev is null or length(v_rev) = 0 or length(v_rev) > 80 then raise exception 'invalid_revision'; end if;
    if v_fp is null or v_fp !~ '^[0-9a-f]{64}$' then raise exception 'invalid_fingerprint'; end if;
    begin
      v_rev_at := (v_line ->> 'revision_created_at')::timestamptz;
      v_amount := (v_line ->> 'amount')::numeric;
      v_qty := case when v_line -> 'quantity' is null or jsonb_typeof(v_line -> 'quantity') = 'null' then null
                    else (v_line ->> 'quantity')::numeric end;
    exception when others then
      raise exception 'invalid_number';
    end;
    if v_rev_at is null then raise exception 'invalid_revision'; end if;
    if v_amount is null or v_amount < 0 or v_amount >= 1000000000000 or v_amount <> round(v_amount, 2) then raise exception 'invalid_amount'; end if;
    if v_qty is not null and (v_qty < 0 or v_qty <> trunc(v_qty) or v_qty >= 1000000000) then raise exception 'invalid_quantity'; end if;
    if v_qstatus <> 'vollstaendig' and v_qty is not null then raise exception 'invalid_quantity'; end if;
    if v_kind = 'ausgabe' then
      if v_qty is not null then raise exception 'invalid_quantity'; end if;
      v_qstatus := 'offen';
      v_detail := nullif(btrim(coalesce(v_line ->> 'note', '')), '');
      if v_detail is not null and length(v_detail) > 300 then raise exception 'invalid_note'; end if;
    end if;

    -- Ein Tag = genau eine Revision des Zaehlers.
    if v_day_rev ? v_date::text then
      if v_day_rev -> v_date::text <> jsonb_build_array(v_rev, v_fp) then raise exception 'mixed_revisions'; end if;
    else
      v_day_rev := v_day_rev || jsonb_build_object(v_date::text, jsonb_build_array(v_rev, v_fp));
    end if;

    -- Schluessel wird hier gebildet, nicht vom Browser uebernommen.
    v_key := 'tz1:' || v_konto || ':' || v_date::text || ':' || case when v_kind = 'ausgabe' then 'ausgabe:' else '' end || v_cat;
    if v_key = any(v_keys) then raise exception 'duplicate_line'; end if;
    v_keys := v_keys || v_key;

    select * into v_imp from public.tageszaehler_import_lines l where l.import_key = v_key for update;
    v_has_imp := found;
    v_has_link := false;
    if v_has_imp and v_kind = 'einnahme' and v_imp.income_id is not null then
      select * into v_inc from public.incomes i where i.id = v_imp.income_id for update;
      v_has_link := found;
    elsif v_has_imp and v_kind = 'ausgabe' and v_imp.expense_id is not null then
      select * into v_exp from public.expenses e where e.id = v_imp.expense_id for update;
      v_has_link := found;
    end if;

    -- Eine aeltere Revision darf nie eine neuere zuruecksetzen.
    if v_has_imp and v_action <> 'skip' and v_rev_at < v_imp.revision_created_at then
      raise exception 'older_revision';
    end if;

    -- ---- Ausdruecklich ausgewaehlte, von Hand erfasste Einnahmen ersetzen (nur Einnahmen) ----
    v_replaced := '[]'::jsonb;
    if v_line ? 'replace_income_ids' and jsonb_typeof(v_line -> 'replace_income_ids') = 'array'
       and jsonb_array_length(v_line -> 'replace_income_ids') > 0 then
      if v_kind <> 'einnahme' or v_action not in ('create', 'update') then raise exception 'invalid_replace'; end if;
      for v_rid in select jsonb_array_elements_text(v_line -> 'replace_income_ids') loop
        begin
          v_rid_uuid := v_rid::uuid;
        exception when others then
          raise exception 'invalid_replace';
        end;
        select * into v_repl from public.incomes i where i.id = v_rid_uuid for update;
        if not found or v_repl.date <> v_date or v_repl.category <> v_web
           or exists (select 1 from public.tageszaehler_import_lines l where l.income_id = v_repl.id) then
          raise exception 'invalid_replace';
        end if;
        v_replaced := v_replaced || jsonb_build_array(jsonb_build_object(
          'id', v_repl.id, 'category', v_repl.category, 'amount', v_repl.amount, 'quantity', v_repl.quantity,
          'date', v_repl.date, 'note', v_repl.note, 'created_at', v_repl.created_at));
        delete from public.incomes i where i.id = v_repl.id;
        n_replaced := n_replaced + 1;
      end loop;
    end if;

    v_note := case when v_kind = 'ausgabe'
                   then 'Ankauf aus Tageszähler: ' || v_cat_name || coalesce(' – ' || v_detail, '')
                   else 'Netto aus Tageszähler: ' || v_cat_name end;
    v_status := null;

    if v_action = 'skip' then
      v_status := 'uebersprungen';
      n_skipped := n_skipped + 1;

    elsif v_action = 'create' then
      if v_has_imp and v_imp.status = 'aktiv' and v_has_link then raise exception 'already_imported'; end if;
      if v_kind = 'ausgabe' then
        insert into public.expenses (category, amount, date, note)
        values (v_web, v_amount, v_date, v_note)
        returning id into v_new_id;
      else
        insert into public.incomes (category, amount, date, note, quantity)
        values (v_web, v_amount, v_date, v_note, v_qty)
        returning id into v_new_id;
      end if;
      if v_has_imp then
        update public.tageszaehler_import_lines l set
          counter_category_name = v_cat_name, website_category = v_web,
          income_id = case when v_kind = 'einnahme' then v_new_id end,
          expense_id = case when v_kind = 'ausgabe' then v_new_id end,
          status = 'aktiv', amount = v_amount, quantity = v_qty, quantity_status = v_qstatus, revision_id = v_rev,
          revision_created_at = v_rev_at, fingerprint = v_fp, last_batch_id = p_batch_id, imported_at = now(),
          imported_by = v_uid,
          history = l.history || jsonb_build_array(jsonb_build_object(
            'at', now(), 'action', 'create', 'batch', p_batch_id, 'previous_status', l.status,
            'previous_income_id', l.income_id, 'previous_expense_id', l.expense_id, 'previous_amount', l.amount,
            'previous_revision', l.revision_id, 'replaced', v_replaced))
        where l.import_key = v_key;
      else
        insert into public.tageszaehler_import_lines (import_key, kind, konto, business_date, counter_category_id,
          counter_category_name, website_category, income_id, expense_id, status, amount, quantity, quantity_status,
          revision_id, revision_created_at, fingerprint, last_batch_id, imported_by, history)
        values (v_key, v_kind, v_konto, v_date, v_cat, v_cat_name, v_web,
          case when v_kind = 'einnahme' then v_new_id end, case when v_kind = 'ausgabe' then v_new_id end,
          'aktiv', v_amount, v_qty, v_qstatus, v_rev, v_rev_at, v_fp, p_batch_id, v_uid,
          jsonb_build_array(jsonb_build_object('at', now(), 'action', 'create', 'batch', p_batch_id, 'replaced', v_replaced)));
      end if;
      v_status := 'angelegt';
      n_created := n_created + 1;

    elsif v_action = 'update' then
      if not v_has_imp or v_imp.status <> 'aktiv' or not v_has_link then raise exception 'not_imported'; end if;
      if v_kind = 'ausgabe' then
        if v_imp.revision_id = v_rev and v_imp.fingerprint = v_fp and v_exp.category = v_web and v_exp.amount = v_amount then
          v_status := 'unveraendert';
          n_same := n_same + 1;
        else
          update public.expenses e set category = v_web, amount = v_amount, note = v_note where e.id = v_exp.id;
          update public.tageszaehler_import_lines l set
            counter_category_name = v_cat_name, website_category = v_web, amount = v_amount, quantity = null,
            quantity_status = v_qstatus, revision_id = v_rev, revision_created_at = v_rev_at, fingerprint = v_fp,
            last_batch_id = p_batch_id, imported_at = now(), imported_by = v_uid,
            history = l.history || jsonb_build_array(jsonb_build_object(
              'at', now(), 'action', 'update', 'batch', p_batch_id,
              'previous', jsonb_build_object('amount', v_exp.amount, 'category', v_exp.category, 'note', v_exp.note,
                                             'revision', l.revision_id, 'fingerprint', l.fingerprint),
              'replaced', v_replaced))
          where l.import_key = v_key;
          v_status := 'aktualisiert';
          n_updated := n_updated + 1;
        end if;
      elsif v_imp.revision_id = v_rev and v_imp.fingerprint = v_fp and v_imp.website_category = v_web
         and v_inc.category = v_web and v_inc.amount = v_amount and v_inc.quantity is not distinct from v_qty
         and jsonb_array_length(v_replaced) = 0 then
        v_status := 'unveraendert';
        n_same := n_same + 1;
      else
        update public.incomes i set category = v_web, amount = v_amount, quantity = v_qty, note = v_note
        where i.id = v_inc.id;
        update public.tageszaehler_import_lines l set
          counter_category_name = v_cat_name, website_category = v_web, amount = v_amount, quantity = v_qty,
          quantity_status = v_qstatus, revision_id = v_rev, revision_created_at = v_rev_at, fingerprint = v_fp,
          last_batch_id = p_batch_id, imported_at = now(), imported_by = v_uid,
          history = l.history || jsonb_build_array(jsonb_build_object(
            'at', now(), 'action', 'update', 'batch', p_batch_id,
            'previous', jsonb_build_object('amount', v_inc.amount, 'quantity', v_inc.quantity, 'category', v_inc.category,
                                           'revision', l.revision_id, 'fingerprint', l.fingerprint),
            'replaced', v_replaced))
        where l.import_key = v_key;
        v_status := 'aktualisiert';
        n_updated := n_updated + 1;
      end if;

    elsif v_action = 'remove' then
      -- Position ist in der neueren Revision dieses Tages nicht mehr enthalten.
      if not v_has_imp or v_imp.status <> 'aktiv' then raise exception 'not_imported'; end if;
      if v_has_link and v_kind = 'ausgabe' then delete from public.expenses e where e.id = v_exp.id; end if;
      if v_has_link and v_kind = 'einnahme' then delete from public.incomes i where i.id = v_inc.id; end if;
      update public.tageszaehler_import_lines l set
        status = 'entfernt', income_id = null, expense_id = null, revision_id = v_rev, revision_created_at = v_rev_at,
        fingerprint = v_fp, last_batch_id = p_batch_id, imported_at = now(), imported_by = v_uid,
        history = l.history || jsonb_build_array(jsonb_build_object(
          'at', now(), 'action', 'remove', 'batch', p_batch_id,
          'previous', case when v_has_link and v_kind = 'ausgabe'
                             then jsonb_build_object('id', v_exp.id, 'amount', v_exp.amount, 'category', v_exp.category, 'note', v_exp.note)
                           when v_has_link
                             then jsonb_build_object('id', v_inc.id, 'amount', v_inc.amount, 'quantity', v_inc.quantity,
                                                     'category', v_inc.category, 'note', v_inc.note)
                           else null end,
          'previous_revision', l.revision_id))
      where l.import_key = v_key;
      v_status := 'entfernt';
      n_removed := n_removed + 1;
    end if;

    v_out_lines := v_out_lines || jsonb_build_array(jsonb_build_object(
      'import_key', v_key, 'kind', v_kind, 'date', v_date, 'counter_category_id', v_cat, 'website_category', v_web,
      'status', v_status, 'amount', v_amount, 'quantity', v_qty, 'replaced', jsonb_array_length(v_replaced)));
  end loop;

  v_result := jsonb_build_object(
    'batch_id', p_batch_id,
    'angelegt', n_created, 'aktualisiert', n_updated, 'unveraendert', n_same, 'entfernt', n_removed,
    'uebersprungen', n_skipped, 'ersetzt_manuell', n_replaced,
    'lines', v_out_lines,
    -- Nachweis: was nach dem Speichern tatsaechlich in Einnahmen und Ausgaben steht.
    'tage', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d,
               'import_summe', coalesce((select sum(i.amount) from public.tageszaehler_import_lines l
                                         join public.incomes i on i.id = l.income_id
                                         where l.konto = v_konto and l.business_date = d and l.status = 'aktiv'), 0),
               'einnahmen_summe', coalesce((select sum(i.amount) from public.incomes i where i.date = d), 0),
               'einnahmen_zeilen', (select count(*) from public.incomes i where i.date = d),
               'ausgaben_import_summe', coalesce((select sum(e.amount) from public.tageszaehler_import_lines l
                                                  join public.expenses e on e.id = l.expense_id
                                                  where l.konto = v_konto and l.business_date = d and l.status = 'aktiv'), 0),
               'ausgaben_summe', coalesce((select sum(e.amount) from public.expenses e where e.date = d), 0),
               'ausgaben_zeilen', (select count(*) from public.expenses e where e.date = d))
             order by d)
      from unnest(v_dates) as d), '[]'::jsonb),
    'snapshot', public.tageszaehler_import_snapshot(v_konto, v_dates),
    'wiederholt', false);

  insert into public.tageszaehler_import_batches (batch_id, request_hash, created_by, result)
  values (p_batch_id, v_hash, v_uid, v_result);
  return v_result;
end;
$$;

revoke all on function public.tageszaehler_import_snapshot(text, date[]) from public, anon, authenticated;
revoke all on function public.tageszaehler_import_preview(text, date[]) from public, anon, authenticated;
revoke all on function public.tageszaehler_import_apply(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.tageszaehler_import_preview(text, date[]) to authenticated;
grant execute on function public.tageszaehler_import_apply(uuid, text, jsonb) to authenticated;

-- REST-Schnittstelle (PostgREST) die geaenderten Funktionen sofort bekannt machen
-- (sonst 404, siehe sql/20260801-reload-postgrest-schema-cache.sql).
notify pgrst, 'reload schema';

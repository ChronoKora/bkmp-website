do $$
declare
  table_name text;
  tables text[] := array[
    'incomes',
    'expenses',
    'investors',
    'updates',
    'wishes',
    'streamer_links',
    'about_blocks',
    'partner_shops'
  ];
begin
  foreach table_name in array tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

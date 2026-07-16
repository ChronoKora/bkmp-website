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
    'partner_shops',
    'raid_instances',
    'raid_participants',
    -- Spieler-Report 15.07. ("mein Schaden steigt in der Liste, von den
    -- anderen aber nicht"): guild_boss_instances/guild_boss_participants
    -- wurden nie in diese Liste aufgenommen, obwohl der Client per
    -- postgres_changes darauf lauscht (bkmpSubscribeToGuildBossInstance).
    -- Ohne Publication-Eintrag feuert Postgres fuer diese Tabellen
    -- ueberhaupt keine Realtime-Events, fuer NIEMANDEN - der eigene
    -- Schaden wirkte trotzdem "live", weil er inzwischen direkt aus der
    -- RPC-Antwort gesetzt wird (siehe supabase-guild-boss-damage-sync-fix.sql),
    -- der Schaden anderer Mitspieler war aber immer ausschliesslich auf
    -- dieses (bisher tote) Realtime-Event angewiesen.
    'guild_boss_instances',
    'guild_boss_participants',
    -- Spieler-Wunsch 16.07. ("wenn Gold eingezahlt wird das es gleich
    -- für alle angezeigt wird, ohne reloaden zu müssen"): guilds/
    -- guild_members hingen bisher aus demselben Grund wie oben (kein
    -- Publication-Eintrag = fuer NIEMANDEN Realtime-Events) komplett tot -
    -- bkmpSubscribeToGuildState() in supabase.js haette sonst ebenfalls
    -- fuer alle Mitspieler wirkungslos im Leeren gelauscht.
    'guilds',
    'guild_members'
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

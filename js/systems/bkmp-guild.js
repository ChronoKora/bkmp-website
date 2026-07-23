// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-guild.js


/* ---------------- Gilden-Kassen-Bonus (siehe supabase-idle-guilds.sql) ----------------
   Gestaffelter Bonus auf Angriff/Verteidigung/Gold fuer ALLE Mitglieder,
   abhaengig vom aktuellen Kassenstand der eigenen Gilde - motiviert
   gemeinsames Beitragen, nicht nur den Anfuehrer. Rein clientseitig
   gecacht (localStorage, gleiches Muster wie die Erfolge-Caches), damit
   bkmpIdleRecomputeEffectiveStats() den Wert nutzen kann, OHNE bei jedem
   Aufruf einen Netzwerk-Request zu brauchen - wird beim Oeffnen des
   Idle-Dorfs und nach jedem Gilden-Wechsel aufgefrischt. */
const BKMP_GUILD_TREASURY_BONUS_CACHE_KEY = 'bkmp-guild-treasury-bonus-cache';
const BKMP_GUILD_TREASURY_TIERS = [
  { threshold: 1000, pct: 2 },
  { threshold: 5000, pct: 5 },
  { threshold: 20000, pct: 8 },
  { threshold: 50000, pct: 12 },
  { threshold: 150000, pct: 18 }
];
/* ---------------- Gilden-Technologie (siehe supabase-guild-tech-tree.sql)
   ----------------
   9 Zweige, jeweils ein fester Prozentsatz pro Stufe (max. 20 Stufen) -
   permanent, einmal gekauft, unabhaengig vom aktuellen Kassenstand
   (im Gegensatz zum bestehenden Kassenstand-Meilenstein-Bonus, der bei
   sinkendem Kassenstand wieder sinken wuerde). Kostenkurve MUSS exakt
   mit der serverseitigen Formel in guild_tech_upgrade() uebereinstimmen
   (200.000 * 1,4^Stufe) - hier nur fuer die Anzeige, bezahlt/geprueft
   wird ausschliesslich serverseitig. */
const BKMP_GUILD_TECH_CATALOG = [
  { id: 'attack', label: 'Angriff', icon: '⚔️', perLevel: 1, statKey: 'attackPct' },
  { id: 'defense', label: 'Verteidigung', icon: '🛡️', perLevel: 1, statKey: 'defensePct' },
  { id: 'gold', label: 'Gold', icon: '💰', perLevel: 1.5, statKey: 'goldPct' },
  { id: 'crit_chance', label: 'Kritchance', icon: '🎯', perLevel: 0.3, statKey: 'critChancePct' },
  { id: 'crit_damage', label: 'Kritischer Schaden', icon: '💥', perLevel: 2, statKey: 'critDamagePct' },
  { id: 'boss_damage', label: 'Bossschaden', icon: '🐉', perLevel: 2.5, statKey: 'bossDamagePct' },
  { id: 'rune_luck', label: 'Runenglück', icon: '🍀', perLevel: 1.5, statKey: 'runeLuckPct' },
  { id: 'xp', label: 'Erfahrungsbonus', icon: '📖', perLevel: 1, statKey: 'xpPct' },
  { id: 'prestige', label: 'Prestigebonus', icon: '🌌', perLevel: 0.5, statKey: 'prestigePct' }
];
const BKMP_GUILD_TECH_MAX_LEVEL = 20;
function bkmpGuildTechCostForLevel(currentLevel) {
  return Math.round(200000 * Math.pow(1.4, currentLevel));
}
const BKMP_GUILD_TECH_CACHE_KEY = 'bkmp-guild-tech-cache';

/* ---------------- Gildenplätze dazukaufen (siehe supabase-guild-extra-
   slots.sql) ----------------
   Spieler-Wunsch (16.07., Discord: "Die Gilde ist voll wir brauchen mehr
   Platz... So eine Funktion für Gilden mehr Platz dazu zukaufen"). Fester
   Basis-Deckel von 20 Mitgliedern (siehe join_guild() in
   supabase-idle-guilds.sql) lässt sich um bis zu BKMP_GUILD_SLOT_MAX_BONUS
   weitere Plätze erweitern. Kostenkurve MUSS exakt mit der serverseitigen
   Formel in buy_guild_slot() uebereinstimmen (400.000 * 1,5^bereits
   gekaufte Plätze) - hier nur fuer die Anzeige, bezahlt/geprueft wird
   ausschliesslich serverseitig. */
const BKMP_GUILD_SLOT_MAX_BONUS = 10;
function bkmpGuildSlotCost(currentBonusSlots) {
  return Math.round(400000 * Math.pow(1.5, currentBonusSlots));
}

/* ---------------- Gilden-Erfolge: Kontextfelder (window.BKMP_GUILD_ACHIEVEMENTS_EXTRA
   weiter unten) ----------------
   Gleiches Cache-Muster wie bkmpRaidGetAchievementContextFields, aber ohne
   eigenen Netzwerk-Request - wird im selben bkmpGuildGetMine()-Aufruf wie
   Kassenstand-Bonus/Technologie mit aufgefrischt (siehe
   bkmpGuildRefreshTreasuryBonusCache). Erfolge sind rein clientseitig aus
   dem AKTUELLEN Gildenstand abgeleitet (keine Server-seitige "wer war zum
   Zeitpunkt X Mitglied"-Historie noetig) - jedes aktuelle Mitglied einer
   Gilde, die die Schwelle erreicht hat, sieht den Erfolg als freigeschaltet. */
const BKMP_GUILD_ACHIEVEMENT_CACHE_KEY = 'bkmp-guild-achievement-fields-cache';
const BKMP_GUILD_ACHIEVEMENT_FIELDS_DEFAULT = { inGuild: false, guildRole: '', guildLevel: 1, guildXp: 0, guildBossesDefeated: 0, guildMemberCount: 0 };
function bkmpGuildGetAchievementContextFields() {
  return bkmpAchievementReadCache(BKMP_GUILD_ACHIEVEMENT_CACHE_KEY, BKMP_GUILD_ACHIEVEMENT_FIELDS_DEFAULT);
}

/* Aktualisiert ALLE Gilden-Caches (Kassenstand-Meilenstein, Technologie UND
   Erfolge-Kontext) in einem Rutsch - teilen sich denselben bkmpGuildGetMine()-
   Aufruf statt getrennte Netzwerk-Requests bei jedem der zahlreichen
   Aufrufer (nach Gruenden/Beitreten/Verlassen/Spenden/Kicken/Befoerdern -
   alles Stellen, an denen sich die Gildenzugehoerigkeit oder -kasse aendern
   kann). Name bleibt bewusst "TreasuryBonus" (nicht umbenannt), damit keiner
   der bestehenden Aufrufer angepasst werden muss. */
async function bkmpGuildRefreshTreasuryBonusCache() {
  try {
    const mine = await bkmpGuildGetMine();
    const treasury = mine ? mine.guild.treasuryGold : 0;
    /* BUGFIX (Spieler-Report 14.07., "Irgendwas stimmt mit der Skalierung
       nicht! habe 65k Rüstung... nach 50k gold mehr" -> 192,6K): hier wurde
       versehentlich der ROHE Kassenstand gecacht statt des berechneten
       Bonus-Prozentsatzes - die Stat-Formel hat den Kassenstand (z.B.
       26000) direkt als Prozentwert interpretiert ("+26000%" statt "+8%"). */
    const bonusPct = bkmpIdleGuildTreasuryBonusPct(treasury);
    localStorage.setItem(BKMP_GUILD_TREASURY_BONUS_CACHE_KEY, String(bonusPct));

    const levels = mine ? await bkmpGuildGetTechLevels(mine.guild.id) : {};
    const techTotals = {};
    BKMP_GUILD_TECH_CATALOG.forEach(tech => {
      techTotals[tech.statKey] = (levels[tech.id] || 0) * tech.perLevel;
    });
    localStorage.setItem(BKMP_GUILD_TECH_CACHE_KEY, JSON.stringify(techTotals));

    if (mine && !bkmpGuildLevelThresholds.length) {
      bkmpGuildLevelThresholds = await bkmpGuildGetLevelThresholds();
    }
    const achievementFields = mine ? {
      inGuild: true,
      guildRole: mine.myRole,
      guildLevel: bkmpGuildLevelInfo(mine.guild.guildXp).level,
      guildXp: mine.guild.guildXp,
      guildBossesDefeated: mine.guild.bossesDefeated,
      guildMemberCount: mine.guild.memberCount
    } : { ...BKMP_GUILD_ACHIEVEMENT_FIELDS_DEFAULT };
    localStorage.setItem(BKMP_GUILD_ACHIEVEMENT_CACHE_KEY, JSON.stringify(achievementFields));

    if (typeof bkmpIdleRecomputeEffectiveStats === 'function') bkmpIdleRecomputeEffectiveStats();
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
  } catch (e) { /* offline/kein Login - alter Cache-Stand bleibt bestehen */ }
}

/* ---------------- Rendering: Gilde-Tab (siehe supabase-idle-guilds.sql) ----------------
   Jeder Spieler ist maximal in EINER Gilde - der Tab zeigt je nach Zustand
   entweder die eigene Gilde (Kasse/Mitglieder/Rollen) oder eine Gruenden-/
   Beitreten-Ansicht. Kassen-Bonus-Anzeige nutzt dieselben Meilenstein-
   Stufen wie bkmpIdleGuildTreasuryBonusPct() (Stat-Verdrahtung). */
let bkmpGuildMyAuthUserId = null;
let bkmpGuildState = null;
let bkmpGuildBrowseList = [];
let bkmpGuildLoaded = false;
let bkmpGuildLoading = false;
let bkmpGuildBusy = false;
let bkmpGuildChatMessages = [];
let bkmpGuildChatLoadedForGuildId = null;
let bkmpGuildStateSubscribedForGuildId = null;
let bkmpGuildSettingsOpen = false;
let bkmpGuildMyInviteCode = null;
let bkmpGuildActivityLog = [];
let bkmpGuildActivityLoadedForGuildId = null;
/* ---------------- Beitrittsanfragen (siehe supabase-guild-join-requests.sql) ----------------
   Spieler-Feedback (16.07.): Mitgliederlisten auch in der Durchsuchen-
   Ansicht zeigen, private Gilden dort nicht mehr komplett ausblenden,
   und eine Anfrage-Funktion als Alternative zum reinen Code-Beitritt. */
let bkmpGuildMyJoinRequests = [];
let bkmpGuildJoinRequests = [];
let bkmpGuildJoinRequestsLoadedForGuildId = null;
let bkmpGuildExpandedBrowseGuildId = null;
let bkmpGuildBrowseMembersCache = {};
let bkmpGuildTechLevels = {};
let bkmpGuildTechLoadedForGuildId = null;
let bkmpGuildQuests = [];
let bkmpGuildQuestsLoadedForGuildId = null;
const BKMP_GUILD_QUEST_CATALOG = {
  dragon_kills: { label: 'Drachen besiegen', icon: '🐉', format: v => bkmpIdleFormatNumber(v) },
  gold_earned: { label: 'Gold sammeln', icon: '💰', format: v => bkmpIdleFormatNumber(v) + ' 💰' },
  arena_wins: { label: 'Arena-Kämpfe gewinnen', icon: '⚔️', format: v => bkmpIdleFormatNumber(v) },
  prestige_ups: { label: 'Mal aufsteigen (Prestige)', icon: '🌌', format: v => bkmpIdleFormatNumber(v) }
};
const BKMP_GUILD_QUEST_TIER_REWARD_LABEL = {
  1: '2.000 💰 + 20 💎',
  2: '6.000 💰 + 50 💎 + 🔮 Runenkiste',
  3: '15.000 💰 + 100 💎 + 🥚 Legendäres Ei + 10 🌌'
};
let bkmpGuildPresenceMap = {};
let bkmpGuildPresenceLoadedAt = 0;

/* ---------------- Online-Status (siehe player_presence in
   supabase-guild-extension-foundation.sql) ----------------
   Heartbeat laeuft fuer die gesamte Sitzung, sobald ein Spielername
   bekannt ist (nicht erst beim Oeffnen des Idle-Dorf-Fensters oder gar
   erst im Gilde-Tab) - der Kampf laeuft laut bkmpIdleCloseModal() auch
   im Hintergrund weiter, "online" soll also den ganzen Tab-Besuch
   abdecken, nicht nur ein offenes Popup. */
const BKMP_GUILD_PRESENCE_HEARTBEAT_MS = 25000;
const BKMP_GUILD_PRESENCE_STALE_MS = 45000;
let bkmpGuildPresenceHeartbeatTimer = null;
function bkmpGuildStartPresenceHeartbeat() {
  if (bkmpGuildPresenceHeartbeatTimer) return;
  if (typeof bkmpPlayerHeartbeat !== 'function') return;
  bkmpPlayerHeartbeat();
  bkmpGuildPresenceHeartbeatTimer = window.setInterval(bkmpPlayerHeartbeat, BKMP_GUILD_PRESENCE_HEARTBEAT_MS);
}

function bkmpGuildFormatPresence(lastSeenAt) {
  if (!lastSeenAt) return '⚫ Nie online gewesen';
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (diffMs < BKMP_GUILD_PRESENCE_STALE_MS) return '🟢 Online';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '⚫ Gerade eben offline';
  if (mins < 60) return `⚫ Zuletzt online vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `⚫ Zuletzt online vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `⚫ Zuletzt online vor ${days} Tag${days === 1 ? '' : 'en'}`;
}

/* ---------------- Aktivitätslog (siehe guild_activity_log) ----------------
   Server speichert nur Rohdaten (kind/actor_name/value/extra), die
   deutsche Anzeige entsteht komplett hier - gleiches Prinzip wie ueberall
   sonst in diesem Projekt (z.B. Raid-Teilnehmer speichern rohe Zahlen,
   nicht fertige Saetze). */
function bkmpGuildFormatActivityEntry(entry) {
  const name = entry.actorName ? escapeHtml(entry.actorName) : '';
  switch (entry.kind) {
    case 'contribute': return `💰 ${name} spendete ${bkmpIdleFormatNumber(entry.value)} Gold.`;
    case 'join': return `➕ ${name} trat der Gilde bei.`;
    case 'leave': return `➖ ${name} hat die Gilde verlassen.`;
    case 'kick': return `🚫 ${name} wurde aus der Gilde entfernt.`;
    case 'level_up': return `🏰 Gildenlevel ${entry.value} erreicht!`;
    case 'slot_purchase': return `🏗️ ${name} hat einen Gildenplatz dazugekauft (jetzt ${entry.value} Plätze).`;
    case 'promote': return `⭐ ${name} wurde befördert.`;
    case 'demote': return `⬇️ ${name} wurde degradiert.`;
    case 'boss_defeated': return `🐉 Gildenboss${entry.extra ? ' ' + escapeHtml(entry.extra) : ''} besiegt!`;
    case 'quest_completed': return `🎯 Gildenquest${entry.extra ? ` "${escapeHtml(entry.extra)}"` : ''} abgeschlossen!`;
    default: return `${name} ${escapeHtml(entry.kind)}`;
  }
}

const BKMP_GUILD_ROLE_CHAT_CLASS = {
  leader: 'idle-guild-chat-role-leader',
  officer: 'idle-guild-chat-role-officer',
  veteran: 'idle-guild-chat-role-veteran',
  member: 'idle-guild-chat-role-member'
};

async function bkmpGuildEnsureMyAuthUserId() {
  if (bkmpGuildMyAuthUserId) return bkmpGuildMyAuthUserId;
  const client = typeof bkmpGetPlayerAuthClient === 'function' ? bkmpGetPlayerAuthClient() : null;
  if (!client) return null;
  try {
    const { data: sessionData } = await client.auth.getSession();
    bkmpGuildMyAuthUserId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  } catch (e) { bkmpGuildMyAuthUserId = null; }
  return bkmpGuildMyAuthUserId;
}

let bkmpGuildLevelThresholds = [];

async function bkmpGuildLoadAll() {
  bkmpGuildLoading = true;
  const uid = await bkmpGuildEnsureMyAuthUserId();
  try {
    bkmpGuildState = uid ? await bkmpGuildGetMine() : null;
    bkmpGuildBrowseList = uid && !bkmpGuildState ? await bkmpGuildBrowse(30) : [];
    bkmpGuildMyJoinRequests = uid && !bkmpGuildState && typeof bkmpGuildLoadMyJoinRequests === 'function' ? await bkmpGuildLoadMyJoinRequests() : [];
    if (!bkmpGuildLevelThresholds.length && typeof bkmpGuildGetLevelThresholds === 'function') {
      bkmpGuildLevelThresholds = await bkmpGuildGetLevelThresholds();
    }
  } catch (e) {
    console.warn('Gilden-Daten konnten nicht geladen werden.', e);
  }
  bkmpGuildLoaded = true;
  bkmpGuildLoading = false;
}

/* Levelkurve lebt komplett in guild_level_thresholds (DB) - hier nur die
   reine Client-Berechnung aus dem einmalig geladenen, gecachten Array
   (siehe bkmpGuildGetLevelThresholds in supabase.js). */
function bkmpGuildLevelInfo(xp) {
  const thresholds = bkmpGuildLevelThresholds.length ? bkmpGuildLevelThresholds : [{ level: 1, xpRequired: 0 }];
  let current = thresholds[0];
  let next = null;
  for (let i = 0; i < thresholds.length; i++) {
    if (thresholds[i].xpRequired <= xp) current = thresholds[i];
    else { next = thresholds[i]; break; }
  }
  const span = next ? next.xpRequired - current.xpRequired : 0;
  const progressed = next ? xp - current.xpRequired : 0;
  const pct = next && span > 0 ? Math.min(100, Math.floor((progressed / span) * 100)) : 100;
  return { level: current.level, xpIntoLevel: progressed, xpForLevel: span, nextLevelXp: next ? next.xpRequired : null, pct };
}

const BKMP_GUILD_ROLE_LABELS = { leader: '👑 Anführer', officer: '⭐ Stellvertreter', veteran: '🛡 Veteran', member: '👤 Mitglied' };
const BKMP_GUILD_MEDALS = ['🥇', '🥈', '🥉'];

/* ---------------- Gildenbanner (siehe guilds.banner + supabase-guild-banner.sql)
   ----------------
   Baukasten aus kuratierten Presets statt Bild-Upload (vermeidet
   Moderations-/Storage-Aufwand) - Farbverlauf + Symbol-Emoji, gespeichert
   als {"color":"gold","symbol":"🐉"}. bkmpRenderGuildBanner() wird an
   mehreren Stellen wiederverwendet (Gildenkopf, Gilden-durchsuchen-Karten,
   Gildenboss-Ansicht). */
const BKMP_GUILD_BANNER_COLORS = [
  { id: 'gold', label: 'Gold', from: '#fbbf24', to: '#b45309' },
  { id: 'blue', label: 'Blau', from: '#60a5fa', to: '#1d4ed8' },
  { id: 'red', label: 'Rot', from: '#f87171', to: '#b91c1c' },
  { id: 'purple', label: 'Lila', from: '#c084fc', to: '#6d28d9' },
  { id: 'green', label: 'Grün', from: '#4ade80', to: '#15803d' },
  { id: 'teal', label: 'Türkis', from: '#5eead4', to: '#0f766e' },
  { id: 'silver', label: 'Silber', from: '#e5e7eb', to: '#6b7280' },
  { id: 'black', label: 'Schwarz-Rot', from: '#4b5563', to: '#1f1f1f' }
];
const BKMP_GUILD_BANNER_SYMBOLS = ['🐉', '🛡️', '⚔️', '🔥', '❄️', '🌙', '⭐', '💀', '🦅', '🐺', '🦁', '🌊', '⚡', '👑', '🏰', '🌳'];
/* Rollen-Leiter fuer Befoerdern/Degradieren-Buttons (leader steht bewusst
   NICHT auf der Leiter - Fuehrung wechselt nur automatisch beim
   Gilde-Verlassen des Anfuehrers, siehe leave_guild() RPC, nicht per
   Knopfdruck). */
const BKMP_GUILD_ROLE_LADDER = ['member', 'veteran', 'officer'];
function bkmpGuildNextRoleUp(role) {
  const i = BKMP_GUILD_ROLE_LADDER.indexOf(role);
  return i >= 0 && i < BKMP_GUILD_ROLE_LADDER.length - 1 ? BKMP_GUILD_ROLE_LADDER[i + 1] : null;
}
function bkmpGuildNextRoleDown(role) {
  const i = BKMP_GUILD_ROLE_LADDER.indexOf(role);
  return i > 0 ? BKMP_GUILD_ROLE_LADDER[i - 1] : null;
}

/* ---------------- Gildenboss (siehe supabase-guild-boss.sql) ----------------
   Anders als der Weltboss-Raid KEIN Gegenangriff/keine "Stadt" - reiner
   DPS-Wettlauf gegen ein taegliches Zeitfenster (20:00-21:00 Uhr Berlin,
   Vorbereitung ab 19:55). Deshalb auch kein modal-uebernehmendes
   "Kampfansicht ersetzt alle Tabs" wie beim Raid - der Gildenboss ist ein
   normaler Tab, kein server-weites Pflichtereignis. */
const BKMP_GUILD_BOSS_TICK_MS = 2500;
const BKMP_GUILD_BOSS_JOINED_KEY_PREFIX = 'bkmp-guildboss-joined-';
let bkmpGuildBossState = null;
let bkmpGuildBossParticipants = [];
let bkmpGuildBossJoinedId = null;
let bkmpGuildBossLoopTimer = null;
let bkmpGuildBossPrepCountdownInterval = null;
let bkmpGuildBossResultShown = false;
let bkmpGuildBossBusy = false;

/* TZ-sicherer Helfer: liefert den UTC-Zeitpunkt fuer "Jahr-Monat-Tag
   Stunde:Minute in Europe/Berlin", DST-sicher per "raten + korrigieren"
   (Standardtrick ohne Zeitzonen-Bibliothek). */
function bkmpGuildBossBerlinDateAt(year, month, day, hour, minute) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const berlinStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(utcGuess));
  const [datePart, timePart] = berlinStr.replace(',', '').split(' ');
  const [bm, bd, by] = datePart.split('/').map(Number);
  const [bh, bmin] = timePart.split(':').map(Number);
  const berlinAsUtc = Date.UTC(by, bm - 1, bd, bh, bmin, 0);
  return new Date(utcGuess - (berlinAsUtc - utcGuess));
}
function bkmpGuildBossGetPhaseInfo(now) {
  const d = now || new Date();
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const minutesOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const dateKey = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const fightStartsAt = bkmpGuildBossBerlinDateAt(year, month, day, 20, 0).getTime();
  const fightEndsAt = bkmpGuildBossBerlinDateAt(year, month, day, 21, 0).getTime();
  if (minutesOfDay >= 19 * 60 + 55 && minutesOfDay < 20 * 60) {
    return { phase: 'prep', dateKey, fightStartsAt, fightEndsAt, msUntilFightStart: fightStartsAt - d.getTime() };
  }
  if (minutesOfDay >= 20 * 60 && minutesOfDay < 21 * 60) {
    return { phase: 'fight', dateKey, fightStartsAt, fightEndsAt, msUntilFightEnd: fightEndsAt - d.getTime() };
  }
  return { phase: 'none', dateKey, fightStartsAt, fightEndsAt };
}
function bkmpGuildBossHasJoined(instanceId) {
  try { return localStorage.getItem(BKMP_GUILD_BOSS_JOINED_KEY_PREFIX + instanceId) === '1'; } catch (e) { return false; }
}
function bkmpGuildBossMarkJoined(instanceId) {
  try { localStorage.setItem(BKMP_GUILD_BOSS_JOINED_KEY_PREFIX + instanceId, '1'); } catch (e) {}
  bkmpGuildBossJoinedId = instanceId;
}

function bkmpGuildBossSpawnFx(className, amount, isCrit) {
  const field = document.getElementById('guildBossBattlefield');
  if (!field) return;
  const fx = document.createElement('span');
  fx.className = 'raid-fx ' + className;
  field.appendChild(fx);
  window.setTimeout(() => fx.remove(), 700);
  if (amount != null) {
    const target = document.getElementById('guildBossCreature');
    if (target) {
      const dmg = document.createElement('span');
      dmg.className = 'raid-dmg-float' + (isCrit ? ' raid-dmg-crit' : '');
      dmg.textContent = '-' + bkmpIdleFormatNumber(amount) + (isCrit ? '!' : '');
      target.appendChild(dmg);
      window.setTimeout(() => dmg.remove(), 900);
    }
  }
}
function bkmpGuildBossHitFlash() {
  const el = document.getElementById('guildBossCreature');
  if (!el) return;
  el.classList.remove('raid-hit-flash');
  void el.offsetWidth;
  el.classList.add('raid-hit-flash');
}

/* Bug-Fix (Spieler-Report per Screenshot 15.07.: "Kein Damage" ->
   PostgREST-Fehler "Could not find the function ... in the schema
   cache", dabei fehlte in der Fehlermeldung auffaellig der p_instance_id-
   Parameter): bkmpGuildBossJoin() (siehe supabase.js) liefert ein Objekt
   mit "instanceId" (camelCase), NICHT "id". An 4 Stellen wurde hier
   trotzdem bkmpGuildBossState.id gelesen - existiert auf diesem Objekt
   gar nicht, ergibt also immer "undefined". supabase-js laesst
   undefined-Parameter beim Serialisieren des RPC-Aufrufs komplett weg,
   PostgREST bekam dadurch nur 3 statt der 4 erwarteten Parameter und
   fand keine passende Funktion mehr - kein Cache-Problem, ein simpler
   Tippfehler. Der urspruengliche Beitritt (bkmpIdleRenderGildeBossPanel)
   nutzt an den RICHTIGEN Stellen bereits korrekt "state.instanceId" -
   nur diese 4 spaeteren Aufrufe hatten den falschen Feldnamen. */
/* Spieler-Report (15.07., "nur reload aktualisiert den Schaden"): ein
   eigener Tick/Klick aktualisierte bisher nur bossHp/status lokal - die
   eigene Zeile in bkmpGuildBossParticipants (Rangliste + "Dein Schaden")
   wurde ausschliesslich per Realtime-postgres_changes-Event nachgezogen.
   guild_boss_deal_damage() gab dafuer bisher gar keinen eigenen Schadens-
   stand zurueck. Exakt dasselbe Muster wie beim Raidboss (siehe
   bkmpRaidApplyOwnDamageResult/supabase-raid-damage-sync-fix.sql) - die
   RPC liefert den serverseitig bereits berechneten eigenen Stand jetzt
   direkt mit (siehe supabase-guild-boss-damage-sync-fix.sql), damit die
   eigene Zeile SOFORT lokal gesetzt werden kann statt auf Realtime zu
   warten. */
function bkmpGuildBossApplyOwnDamageResult(result) {
  if (!result || result.ownDamageDealt == null) return;
  const myUid = bkmpGuildMyAuthUserId;
  if (!myUid) return;
  const idx = bkmpGuildBossParticipants.findIndex(p => p.authUserId === myUid);
  if (idx >= 0) {
    bkmpGuildBossParticipants[idx].damageDealt = result.ownDamageDealt;
    bkmpGuildBossParticipants[idx].critsLanded = result.ownCritsLanded;
    bkmpGuildBossParticipants[idx].clicksLanded = result.ownClicksLanded;
    bkmpGuildBossParticipants.sort((a, b) => b.damageDealt - a.damageDealt);
    bkmpGuildBossRequestParticipantsRender();
  }
}

/* Live-Vorfall 15.07. (siehe Kommentar bei bkmpGuildBossDealDamage in
   supabase.js): sobald der Boss besiegt ist, hämmerte der Auto-Tick jedes
   noch aktiven Mitspielers ohne funktionierendes Realtime endlos gegen
   "boss_not_active" - der lokale Zustand erfuhr nie vom Sieg. Statt
   weiterzuticken sofort den eigenen Loop stoppen und den echten Endstand
   nachladen, sobald der Server "final" meldet. */
function bkmpGuildBossResyncAfterFinalError() {
  if (!bkmpGuildBossState) return;
  bkmpGuildBossStopLoop();
  loadGuildBossInstance(bkmpGuildBossState.instanceId).then(info => {
    if (!info || !bkmpGuildBossState) return;
    bkmpGuildBossState.bossHp = info.bossHp;
    bkmpGuildBossState.status = info.status;
    bkmpIdleRenderGildeBossPanel();
    bkmpGuildBossCheckOutcome();
  }).catch(() => {});
}

/* Performance (Nutzer-Auftrag, Section B Prioritaet 4 "Gildenboss-Tick"):
   dasselbe Prinzip wie bkmpIdleCombatVisualsActive() in idledorf.js -
   Schaden/Server-Sync/Ergebnis-Logik laeuft immer unveraendert weiter,
   nur die rein visuellen FX/Render-Aufrufe pausieren, wenn niemand
   hinschauen kann. Anders als der Raidboss nutzt der Gildenboss-Kampf
   den normalen Tab-Mechanismus (Tab-Id 'gildeboss', Panel #idlePanelGildeBoss),
   deshalb hier dieselbe bkmpIdleActiveTab-Pruefung wie beim Hauptkampf. */
function bkmpGuildBossVisualsActive() {
  return bkmpIdleModalOpen === true && bkmpIdleActiveTab === 'gildeboss' && document.visibilityState === 'visible';
}

async function bkmpGuildBossOwnTick() {
  if (!bkmpGuildBossState || bkmpGuildBossState.status !== 'fighting' || !bkmpIdleEffectiveStats) return;
  const showVisuals = bkmpGuildBossVisualsActive();
  const roll = bkmpIdleDamageRoll(bkmpIdleEffectiveStats.attack, bkmpIdleEffectiveStats.critChance, bkmpIdleEffectiveStats.critDamage, 0);
  roll.amount = bkmpIdleApplyBossDamageBonus(roll.amount);
  if (showVisuals) {
    bkmpGuildBossSpawnFx(BKMP_RAID_ATTACK_FX[Math.floor(Math.random() * BKMP_RAID_ATTACK_FX.length)], roll.amount, roll.isCrit);
    bkmpGuildBossHitFlash();
  }
  try {
    const result = await bkmpGuildBossDealDamage(bkmpGuildBossState.instanceId, roll.amount, roll.isCrit, false);
    if (result && result.final) { bkmpGuildBossResyncAfterFinalError(); return; }
    if (result) {
      bkmpGuildBossState.bossHp = result.bossHp;
      bkmpGuildBossState.status = result.status;
      bkmpGuildBossApplyOwnDamageResult(result);
      if (showVisuals) bkmpIdleRenderGildeBossPanel();
      bkmpGuildBossCheckOutcome();
    }
  } catch (e) { /* naechster Tick versucht es erneut */ }
}

function bkmpGuildBossHandleClick() {
  if (!bkmpGuildBossState || bkmpGuildBossState.status !== 'fighting' || !bkmpIdleEffectiveStats) return;
  const isCrit = Math.random() * 100 < bkmpIdleEffectiveStats.critChance;
  const clickDamage = bkmpIdleApplyBossDamageBonus(Math.max(1, Math.round(bkmpIdleEffectiveStats.attack * (0.12 + (bkmpIdleEffectiveStats.clickDamagePct || 0) / 100) * (isCrit ? Math.max(1, bkmpIdleEffectiveStats.critDamage / 100) : 1))));
  bkmpGuildBossSpawnFx('raid-fx-magic', clickDamage, isCrit);
  bkmpGuildBossHitFlash();
  bkmpGuildBossDealDamage(bkmpGuildBossState.instanceId, clickDamage, isCrit, true).then(result => {
    if (result && result.final) { bkmpGuildBossResyncAfterFinalError(); return; }
    if (result) {
      bkmpGuildBossState.bossHp = result.bossHp;
      bkmpGuildBossState.status = result.status;
      bkmpGuildBossApplyOwnDamageResult(result);
      bkmpIdleRenderGildeBossPanel();
      bkmpGuildBossCheckOutcome();
    }
  }).catch(() => {});
}

function bkmpGuildBossStartLoop() {
  bkmpGuildBossStopLoop();
  bkmpGuildBossLoopTimer = window.setInterval(bkmpGuildBossOwnTick, BKMP_GUILD_BOSS_TICK_MS);
  if (typeof bkmpSubscribeToGuildBossInstance === 'function') {
    bkmpSubscribeToGuildBossInstance(bkmpGuildBossState.instanceId, change => {
      if (!bkmpGuildBossState) return;
      if (change.type === 'instance' && change.row) {
        bkmpGuildBossState.bossHp = Number(change.row.boss_hp);
        bkmpGuildBossState.status = change.row.status;
        bkmpGuildBossState.totalDamage = Number(change.row.total_damage || 0);
        bkmpGuildBossState.participantCount = Number(change.row.participant_count || 0);
        bkmpIdleRenderGildeBossPanel();
        bkmpGuildBossCheckOutcome();
      } else if (change.type === 'participants' && change.row) {
        const idx = bkmpGuildBossParticipants.findIndex(p => p.authUserId === change.row.auth_user_id);
        const mapped = { authUserId: change.row.auth_user_id, displayName: change.row.display_name, damageDealt: Number(change.row.damage_dealt || 0), critsLanded: Number(change.row.crits_landed || 0), clicksLanded: Number(change.row.clicks_landed || 0) };
        if (idx >= 0) bkmpGuildBossParticipants[idx] = mapped; else bkmpGuildBossParticipants.push(mapped);
        bkmpGuildBossParticipants.sort((a, b) => b.damageDealt - a.damageDealt);
        bkmpIdleRenderGildeBossPanel();
      }
    });
  }
}
function bkmpGuildBossStopLoop() {
  if (bkmpGuildBossLoopTimer) { window.clearInterval(bkmpGuildBossLoopTimer); bkmpGuildBossLoopTimer = null; }
  if (typeof bkmpUnsubscribeFromGuildBossInstance === 'function') bkmpUnsubscribeFromGuildBossInstance();
}
function bkmpGuildBossCheckOutcome() {
  if (!bkmpGuildBossState || bkmpGuildBossResultShown) return;
  if (bkmpGuildBossState.status !== 'won' && bkmpGuildBossState.status !== 'expired') return;
  bkmpGuildBossResultShown = true;
  bkmpGuildBossStopLoop();
  /* Bug-Fix (Spieler-Frage 16.07., "wann werden die Belohnungen
     ausgezahlt?"): guild_boss_finish() schreibt Gold/Kristalle bei einem
     Sieg SOFORT serverseitig direkt in idle_player_state (siehe
     supabase-guild-boss.sql) - die lokale bkmpIdleState-Kopie im Browser
     erfaehrt davon aber nie. Ohne diesen Abgleich hier ueberschreibt der
     naechste ganz normale Autosave (bkmpIdleFlushSync, spaetestens 4s
     spaeter) den frisch gutgeschriebenen Server-Stand postwendend wieder
     mit dem eigenen, noch alten lokalen Wert - die Belohnung wurde also
     ausgezahlt UND im selben Atemzug durchs eigene Speichern wieder
     geloescht. bkmpIdleMergeRemoteSpendableFields() (bisher nur auf der
     Stream-Seite als Schutz vor Mehrfach-Tab-Konflikten aktiv) macht
     genau das richtig: server_wert + eigener_lokaler_delta_seit_baseline,
     bewahrt also sowohl die externe Gutschrift als auch eigenen
     zwischenzeitlichen Fortschritt. */
  if (bkmpGuildBossState.status === 'won' && typeof bkmpIdleMergeRemoteSpendableFields === 'function') {
    bkmpIdleMergeRemoteSpendableFields().then(() => bkmpIdleRenderHud()).catch(() => {});
  }
  bkmpGuildQuestsLoadedForGuildId = null; /* Aktivitaetslog zeigt jetzt "Boss besiegt" - naechster Panel-Load frisch laden */
  bkmpGuildActivityLoadedForGuildId = null;
  loadGuildBossParticipants(bkmpGuildBossState.instanceId).then(list => { bkmpGuildBossParticipants = list; bkmpIdleRenderGildeBossPanel(); }).catch(() => {});
  /* Spieler-Wunsch (15.07., "Wieviel kriegt man denn? Ruhig anzeigen
     lassen"): weder guild_boss_join() noch guild_boss_deal_damage()
     liefern die Belohnungs-Poolgroesse zurueck (anders als beim Raid, wo
     loadRaidState() das schon erledigt). Dieselbe frische Instanz-Abfrage
     holt jetzt zusaetzlich gold_reward/gem_reward vom verknuepften
     Gildenboss sowie den serverseitig gepflegten participant_count nach -
     letzteres behebt nebenbei "Teilnehmer: 0" in der Ergebnisansicht, da
     dieses Feld sonst nirgends gesetzt wurde. */
  loadGuildBossInstance(bkmpGuildBossState.instanceId).then(info => {
    if (!info || !bkmpGuildBossState) return;
    bkmpGuildBossState.participantCount = info.participantCount;
    bkmpGuildBossState.goldReward = info.goldReward;
    bkmpGuildBossState.gemReward = info.gemReward;
    bkmpGuildBossUpdateCombatUI();
  }).catch(() => {});
}

let bkmpGuildBossPanelRenderedForKey = null;
let bkmpGuildBossUpdateRenderTimer = null;

/* Ohne Drosselung baute diese Funktion bei JEDEM eigenen Tick (alle
   BKMP_GUILD_BOSS_TICK_MS), JEDEM eigenen Klick UND jedem Realtime-Update
   von ANDEREN Gildenmitgliedern das komplette Panel per innerHTML neu -
   inklusive des <video autoplay>-Boss-Sprites, das dabei jedes Mal neu
   gestartet wurde (sichtbares Ruckeln/Flackern alle paar Sekunden,
   staerker mit mehreren gleichzeitig kaempfenden Mitgliedern). Analog zum
   bereits gefixten Raid-Screen (siehe bkmpRaidRenderCombat/
   bkmpRaidRequestParticipantsRender) wird das Grundgeruest (Video, HP-
   Balken-Container, Rangliste-Container) jetzt nur noch EINMAL pro
   Boss-Instanz gebaut; Folge-Updates schreiben nur noch in bestehende
   Knoten (textContent/style.width) bzw. drosseln den Rangliste-Rebuild
   auf max. alle 400ms. */
/* Bug-Fix (Spieler-Meldung 16.07., "Timer läuft nicht runter, nur nach
   Reload"): der "Vorbereitung - Kampf startet in..."-Text wurde bisher NUR
   einmal beim (Neu-)Rendern des Panels aus info.msUntilFightStart berechnet
   und danach nie wieder aktualisiert - stand die Karte einfach offen,
   blieb die Zahl fuer immer auf dem Stand des letzten Renders stehen.
   Gleiches Muster wie bkmpDungeonStartCountdownTicker: ein echter
   1-Sekunden-Tick, der NUR die Countdown-Textzeile lokal aktualisiert
   (kein Server-Roundtrip, kein Neu-Rendern der ganzen Karte/Listener).
   Wechselt die Phase (Vorbereitung vorbei, Kampf beginnt), wird EINMALIG
   ein echter Panel-Re-Render angestossen, damit der "Jetzt kaempfen"-
   Zustand korrekt uebernommen wird. Selbst-beendend: bricht ab, sobald der
   Gildenboss-Tab nicht mehr aktiv ist. */
function bkmpGuildBossStartPrepCountdownTicker() {
  if (bkmpGuildBossPrepCountdownInterval) { clearInterval(bkmpGuildBossPrepCountdownInterval); bkmpGuildBossPrepCountdownInterval = null; }
  bkmpGuildBossPrepCountdownInterval = setInterval(() => {
    if (bkmpIdleActiveTab !== 'gildeboss') {
      clearInterval(bkmpGuildBossPrepCountdownInterval);
      bkmpGuildBossPrepCountdownInterval = null;
      return;
    }
    const info = bkmpGuildBossGetPhaseInfo();
    if (info.phase !== 'prep') {
      clearInterval(bkmpGuildBossPrepCountdownInterval);
      bkmpGuildBossPrepCountdownInterval = null;
      bkmpIdleRenderGildeBossPanel();
      return;
    }
    const el = document.getElementById('idleGuildBossPrepCountdown');
    if (el) el.textContent = `⏳ Vorbereitung - Kampf startet in ${bkmpRaidFormatCountdown(info.msUntilFightStart)}.`;
  }, 1000);
}

function bkmpGuildBossUpdateCombatUI() {
  const g = bkmpGuildBossState;
  if (!g) return;
  const isFinished = g.status === 'won' || g.status === 'expired';
  const hpPct = g.bossMaxHp > 0 ? Math.max(0, Math.min(100, (g.bossHp / g.bossMaxHp) * 100)) : 0;
  const hpFill = document.getElementById('guildBossHpFill');
  if (hpFill) hpFill.style.width = hpPct + '%';
  const hpLabel = document.getElementById('guildBossHpLabel');
  if (hpLabel) hpLabel.textContent = `${bkmpIdleFormatNumber(g.bossHp)} / ${bkmpIdleFormatNumber(g.bossMaxHp)}`;
  const statusText = document.getElementById('guildBossStatusText');
  if (statusText) statusText.textContent = `${isFinished ? (g.status === 'won' ? '🏆 Besiegt!' : '⌛ Zeit abgelaufen.') : `⏳ ${bkmpRaidFormatCountdown(bkmpGuildBossGetPhaseInfo().msUntilFightEnd || 0)} verbleiben`} · ${g.participantCount || bkmpGuildBossParticipants.length} Kämpfer`;
  if (isFinished) {
    /* Der Nachlade-Refresh in bkmpGuildBossCheckOutcome() (frische
       Teilnehmerliste nach Kampfende) loest wegen des unveraenderten
       renderKey KEIN Neubauen des Ergebnis-Grundgeruests mehr aus (siehe
       Kommentar dort) - die Statistik-Werte muessen deshalb hier bei
       jedem Aufruf aktuell gehalten werden, nicht nur einmalig beim Bau. */
    const totalDamage = bkmpGuildBossParticipants.reduce((sum, p) => sum + p.damageDealt, 0);
    const myDamage = bkmpGuildBossParticipants.find(p => p.authUserId === bkmpGuildMyAuthUserId);
    const myRank = myDamage ? bkmpGuildBossParticipants.indexOf(myDamage) + 1 : 0;
    const mvp = bkmpGuildBossParticipants[0];
    const totalEl = document.getElementById('guildBossResultTotalDmg');
    if (totalEl) totalEl.textContent = bkmpIdleFormatNumber(totalDamage);
    const ownEl = document.getElementById('guildBossResultOwnDmg');
    if (ownEl) ownEl.textContent = bkmpIdleFormatNumber(myDamage ? myDamage.damageDealt : 0);
    const rankEl = document.getElementById('guildBossResultRank');
    if (rankEl) rankEl.textContent = myRank ? '#' + myRank : '-';
    const mvpEl = document.getElementById('guildBossResultMvp');
    if (mvpEl) mvpEl.textContent = mvp ? mvp.displayName : '-';
    const participantCountEl = document.getElementById('guildBossResultParticipantCount');
    if (participantCountEl) participantCountEl.textContent = g.participantCount || bkmpGuildBossParticipants.length;
    if (g.status === 'won') {
      /* Eigener Anteil exakt wie guild_boss_finish() serverseitig rechnet
         (Schaden-Anteil * Belohnungs-Pool, siehe supabase-guild-boss.sql) -
         g.goldReward/gemReward kommen aus dem Nachlade-Refresh in
         bkmpGuildBossCheckOutcome() (loadGuildBossInstance()), da die
         Beitritts-/Schadens-RPCs die Pool-Groesse nicht zurueckliefern. */
      const myShare = myDamage && totalDamage > 0 ? myDamage.damageDealt / totalDamage : 0;
      const goldEl = document.getElementById('guildBossResultGold');
      if (goldEl) goldEl.textContent = bkmpIdleFormatNumber(Math.round((g.goldReward || 0) * myShare));
      const gemsEl = document.getElementById('guildBossResultGems');
      if (gemsEl) gemsEl.textContent = bkmpIdleFormatNumber(Math.round((g.gemReward || 0) * myShare));
    }
  }
  bkmpGuildBossRequestParticipantsRender();
}

function bkmpGuildBossRequestParticipantsRender() {
  if (bkmpGuildBossUpdateRenderTimer) return;
  bkmpGuildBossUpdateRenderTimer = window.setTimeout(() => {
    bkmpGuildBossUpdateRenderTimer = null;
    bkmpGuildBossRenderParticipants();
  }, 400);
}

/* Spieler-Report (15.07., Schadenszahlen selbst korrekt, aber ueberall
   "0% Anteil"): g.totalDamage kam nur ueber Realtime-postgres_changes auf
   guild_boss_instances rein (siehe bkmpGuildBossStartLoop) - beim eigenen
   Tick/Klick (viel haeufigerer, direkter Pfad seit dem Own-Damage-Sync-Fix
   oben) wurde es nie gesetzt und blieb damit fuer die gesamte Kampfdauer
   "undefined", die Prozentrechnung landete deshalb immer beim 0-Fallback.
   Robuster: die Summe direkt aus den bereits vorhandenen Teilnehmer-
   Schadenswerten bilden statt auf dieses separate Feld zu vertrauen. */
function bkmpGuildBossRenderParticipants() {
  const g = bkmpGuildBossState;
  if (!g) return;
  const totalDamage = bkmpGuildBossParticipants.reduce((sum, p) => sum + p.damageDealt, 0);
  const myDamage = bkmpGuildBossParticipants.find(p => p.authUserId === bkmpGuildMyAuthUserId);
  const myDmgEl = document.getElementById('guildBossMyDamage');
  if (myDmgEl) myDmgEl.innerHTML = myDamage ? `Dein Schaden: ${bkmpIdleFormatNumber(myDamage.damageDealt)} (${totalDamage > 0 ? Math.round(myDamage.damageDealt / totalDamage * 100) : 0}% Anteil)` : '';
  const listEl = document.getElementById('guildBossParticipantsList');
  if (!listEl) return;
  listEl.innerHTML = bkmpGuildBossParticipants.length === 0 ? '<p class="empty-hint">Noch kein Schaden verursacht.</p>' : bkmpGuildBossParticipants.map((p, i) => `
    <div class="idle-arena-opponent-card">
      <span class="idle-arena-opponent-name">${BKMP_GUILD_MEDALS[i] || `${i + 1}.`} ${escapeHtml(p.displayName)}</span>
      <span class="idle-arena-opponent-rating">${totalDamage > 0 ? Math.round(p.damageDealt / totalDamage * 100) : 0}%</span>
      <span class="idle-arena-opponent-record">${bkmpIdleFormatNumber(p.damageDealt)} Schaden</span>
    </div>
  `).join('');
}

/* ---------------- Gildenquests: Delta-Sammlung (siehe
   supabase-guild-quests.sql) ----------------
   Statt bei jedem Drachen-Kill/Gold-Gewinn/Sieg einen eigenen RPC-Call zu
   feuern, sammeln sich Deltas hier nur lokal und werden im bestehenden
   4s-Autosave-Rhythmus (bkmpIdleFlushSync) gebuendelt mitgeschickt - kein
   zusaetzlicher Netzwerk-Traffic pro Spielaktion. */
let bkmpGuildQuestPendingDeltas = {};
function bkmpGuildQuestAddDelta(type, amount) {
  if (!amount) return;
  bkmpGuildQuestPendingDeltas[type] = (bkmpGuildQuestPendingDeltas[type] || 0) + amount;
}
function bkmpGuildQuestFlushDeltas() {
  if (!Object.keys(bkmpGuildQuestPendingDeltas).length) return;
  /* Bug-Report 17.07. (Postgres-Fehlerlog, ChronoKora): guild_quest_contribute()
     wirft "not_in_guild" fuer jeden Spieler ohne Gilde (siehe
     supabase-guild-quests.sql) - wurde hier aber bisher unabhaengig vom
     Gildenstatus bei JEDEM Autosave mit ausstehenden Deltas gefeuert (also
     praktisch bei jedem aktiven Spieler ohne Gilde, alle ~4s). bkmpGuildState
     ist nur gesetzt, wenn der Gilde-Tab schon mal geladen wurde (siehe
     bkmpGuildLoadAll) - erst dann ist wirklich bekannt, ob eine Gilde
     existiert. Bis dahin/ ohne Gilde sammeln sich die Deltas hier einfach
     folgenlos weiter, statt einen garantiert fehlschlagenden Request zu
     senden. */
  if (!bkmpGuildState || !bkmpGuildState.guild) return;
  const deltas = bkmpGuildQuestPendingDeltas;
  bkmpGuildQuestPendingDeltas = {};
  if (typeof bkmpGuildQuestContribute === 'function') bkmpGuildQuestContribute(deltas);
}

/* ---------------- Gilde: Erfolge (window.BKMP_GUILD_ACHIEVEMENTS_EXTRA) ----------------
   Gleiches Einbinde-Muster wie BKMP_RAID_ACHIEVEMENTS_EXTRA. Rein aus dem
   AKTUELLEN Gildenstand abgeleitet (siehe bkmpGuildGetAchievementContextFields)
   - kein Titel/Kosmetik-Reward verknuepft, genau wie bei Weltboss/Arena. */
window.BKMP_GUILD_ACHIEVEMENTS_EXTRA = [
  { id: 'guild_member', category: 'Gilde', title: 'Gildenmitglied', desc: 'Trete einer Gilde bei.', check: ctx => ctx.inGuild },
  { id: 'guild_leader', category: 'Gilde', title: 'Anführer', desc: 'Werde Anführer einer Gilde.', check: ctx => ctx.guildRole === 'leader' },
  { id: 'guild_level_5', category: 'Gilde', title: 'Aufstrebende Gilde', desc: 'Erreiche Gildenlevel 5.', progress: ctx => [ctx.guildLevel, 5], check: ctx => ctx.guildLevel >= 5 },
  { id: 'guild_level_10', category: 'Gilde', title: 'Etablierte Gilde', desc: 'Erreiche Gildenlevel 10.', progress: ctx => [ctx.guildLevel, 10], check: ctx => ctx.guildLevel >= 10 },
  { id: 'guild_level_20', category: 'Gilde', title: 'Mächtige Gilde', desc: 'Erreiche Gildenlevel 20.', progress: ctx => [ctx.guildLevel, 20], check: ctx => ctx.guildLevel >= 20 },
  { id: 'guild_xp_1m', category: 'Gilde', title: 'Großzügige Gilde', desc: 'Deine Gilde hat insgesamt 1.000.000 Gold in die Kasse eingezahlt.', progress: ctx => [ctx.guildXp, 1000000], check: ctx => ctx.guildXp >= 1000000 },
  { id: 'guild_boss_first', category: 'Gilde', title: 'Erster Gildenboss', desc: 'Besiege deinen ersten Gildenboss.', check: ctx => ctx.guildBossesDefeated >= 1 },
  { id: 'guild_boss_10', category: 'Gilde', title: 'Gildenboss-Bezwinger', desc: 'Besiege 10 Gildenbosse.', progress: ctx => [ctx.guildBossesDefeated, 10], check: ctx => ctx.guildBossesDefeated >= 10 },
  { id: 'guild_full_roster', category: 'Gilde', title: 'Volles Haus', desc: 'Sei Mitglied einer Gilde mit 20 Mitgliedern.', check: ctx => ctx.guildMemberCount >= 20 }
];

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)

function bkmpIdleGuildTreasuryBonusPct(treasuryGold) {
  const gold = Number(treasuryGold || 0);
  let pct = 0;
  BKMP_GUILD_TREASURY_TIERS.forEach(tier => { if (gold >= tier.threshold) pct = tier.pct; });
  return pct;
}
function bkmpIdleGuildNextTreasuryMilestone(treasuryGold) {
  const gold = Number(treasuryGold || 0);
  const next = BKMP_GUILD_TREASURY_TIERS.find(tier => gold < tier.threshold);
  return next ? next.threshold : null;
}
function bkmpIdleGetGuildTreasuryBonusCache() {
  try { return Number(localStorage.getItem(BKMP_GUILD_TREASURY_BONUS_CACHE_KEY) || 0); } catch (e) { return 0; }
}
function bkmpIdleGetGuildTechCache() {
  try { return JSON.parse(localStorage.getItem(BKMP_GUILD_TECH_CACHE_KEY) || '{}'); } catch (e) { return {}; }
}
function bkmpRenderGuildBanner(banner, size) {
  const colorId = (banner && banner.color) || BKMP_GUILD_BANNER_COLORS[0].id;
  const colors = BKMP_GUILD_BANNER_COLORS.find(c => c.id === colorId) || BKMP_GUILD_BANNER_COLORS[0];
  const symbol = (banner && banner.symbol) || BKMP_GUILD_BANNER_SYMBOLS[0];
  const px = size || 48;
  return `<span class="idle-guild-banner" style="width:${px}px;height:${px}px;font-size:${Math.round(px * 0.55)}px;background:linear-gradient(135deg, ${colors.from}, ${colors.to});">${symbol}</span>`;
}

async function bkmpIdleRenderGildePanel() {
  const panel = document.getElementById('idlePanelGilde');
  if (!panel) return;

  if (!bkmpGuildLoaded && !bkmpGuildLoading) {
    panel.innerHTML = '<p class="idle-dungeon-best">⏳ Lade Gilde...</p>';
    await bkmpGuildLoadAll();
  }

  const uid = bkmpGuildMyAuthUserId;
  if (!uid) {
    if (typeof bkmpUnsubscribeFromGuildChat === 'function') bkmpUnsubscribeFromGuildChat();
    if (typeof bkmpUnsubscribeFromGuildState === 'function') bkmpUnsubscribeFromGuildState();
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <h4>🛡️ Gilde</h4>
        <p>Melde dich mit deinem Spieler-Konto an und spiele mindestens einmal im Kampf-Tab, um einer Gilde beizutreten oder eine zu gründen.</p>
      </div>`;
    return;
  }

  if (!bkmpGuildState) {
    if (typeof bkmpUnsubscribeFromGuildChat === 'function') bkmpUnsubscribeFromGuildChat();
    if (typeof bkmpUnsubscribeFromGuildState === 'function') bkmpUnsubscribeFromGuildState();
    bkmpGuildChatLoadedForGuildId = null;
    bkmpGuildStateSubscribedForGuildId = null;
    bkmpGuildActivityLoadedForGuildId = null;
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <h4>🛡️ Gilde gründen</h4>
        <p>Schließ dich mit anderen Spielern zusammen: gemeinsame Kasse, Kassen-Meilensteine geben ALLEN Mitgliedern dauerhafte Boni. Gründung kostet <strong>500.000 Gold</strong> (wird direkt zur Startkasse deiner neuen Gilde).</p>
        <div class="idle-guild-create-row">
          <input type="text" id="idleGuildNameInput" placeholder="Gildenname" aria-label="Gildenname" maxlength="32">
          <input type="text" id="idleGuildTagInput" placeholder="Kürzel (max. 5)" aria-label="Gilden-Kürzel" maxlength="5" style="max-width:110px;">
          <button type="button" class="btn-ja idle-guild-create-btn" id="idleGuildCreateBtn" ${bkmpGuildBusy ? 'disabled' : ''}>Gründen (500.000 Gold)</button>
        </div>
        <p style="margin-top:0.8rem;">Hast du einen Einladungscode für eine private Gilde bekommen?</p>
        <div class="idle-guild-create-row">
          <input type="text" id="idleGuildCodeInput" placeholder="Einladungscode" aria-label="Einladungscode" maxlength="8" style="text-transform:uppercase;">
          <button type="button" class="btn-nein idle-guild-join-code-btn" id="idleGuildJoinCodeBtn" ${bkmpGuildBusy ? 'disabled' : ''}>Beitreten</button>
        </div>
      </div>
      <div class="idle-arena-history">
        <h4 style="margin-top:1rem;">Gilden durchsuchen</h4>
        ${bkmpGuildBrowseList.length === 0 ? '<p class="empty-hint">Noch keine Gilden vorhanden. Gründe die erste!</p>' : bkmpGuildBrowseList.map(g => {
          const level = bkmpGuildLevelInfo(g.guildXp).level;
          const winRate = g.bossAttempts > 0 ? Math.round((g.bossesDefeated / g.bossAttempts) * 100) : null;
          /* Spieler-Feedback (16.07.): private Gilden nicht mehr komplett
             ausblenden (guilds/guild_members sind serverseitig ohnehin
             oeffentlich lesbar, siehe Kommentar bei bkmpGuildBrowse in
             supabase.js) - stattdessen mit 🔒 kennzeichnen und statt des
             Sofort-Beitritts eine Anfrage anbieten, die Anfuehrer/
             Stellvertreter/Veteran annehmen oder ablehnen koennen. */
          const myRequest = bkmpGuildMyJoinRequests.find(r => r.guildId === g.id);
          const isExpanded = bkmpGuildExpandedBrowseGuildId === g.id;
          const members = bkmpGuildBrowseMembersCache[g.id];
          let actionHtml;
          if (g.isPublic) {
            actionHtml = `<button type="button" class="btn-ja idle-guild-join-btn" ${bkmpGuildBusy || g.memberCount >= g.maxMembers ? 'disabled' : ''}>${g.memberCount >= g.maxMembers ? 'Voll' : 'Beitreten'}</button>`;
          } else if (myRequest) {
            actionHtml = `<span class="idle-guild-request-pending">🕓 Anfrage ausstehend</span><button type="button" class="btn-nein idle-guild-cancel-request-btn" data-request-id="${escapeHtml(myRequest.id)}" ${bkmpGuildBusy ? 'disabled' : ''}>Zurückziehen</button>`;
          } else {
            actionHtml = `<button type="button" class="btn-ja idle-guild-request-btn" ${bkmpGuildBusy || g.memberCount >= g.maxMembers ? 'disabled' : ''}>${g.memberCount >= g.maxMembers ? 'Voll' : 'Anfrage senden'}</button>`;
          }
          return `
          <div class="idle-arena-opponent-card" data-guild-id="${escapeHtml(g.id)}">
            <span class="idle-arena-opponent-name">${g.isPublic ? '🌐' : '🔒'} ${bkmpRenderGuildBanner(g.banner, 28)} [${escapeHtml(g.tag)}] ${escapeHtml(g.name)}</span>
            <span class="idle-arena-opponent-rating">💰 ${bkmpIdleFormatNumber(g.treasuryGold)}</span>
            <span class="idle-arena-opponent-record">🏰 Lvl ${level} &middot; ${g.memberCount}/${g.maxMembers} Mitglieder${winRate !== null ? ` &middot; 🐲 ${g.bossesDefeated} (${winRate}%)` : ''}</span>
            <button type="button" class="btn-nein idle-guild-toggle-members-btn">${isExpanded ? 'Mitglieder ausblenden' : 'Mitglieder anzeigen'}</button>
            ${actionHtml}
            ${isExpanded ? `
              <div class="idle-guild-browse-members">
                ${!members ? '<p class="empty-hint">⏳ Lädt...</p>' : members.length === 0 ? '<p class="empty-hint">Keine Mitglieder.</p>' : members.map(m => `<span class="idle-guild-browse-member-chip">${escapeHtml(m.displayName)} &middot; ${BKMP_GUILD_ROLE_LABELS[m.role] || m.role}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        `;
        }).join('')}
      </div>
    `;
    const createBtn = document.getElementById('idleGuildCreateBtn');
    if (createBtn) createBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('idleGuildNameInput');
      const tagInput = document.getElementById('idleGuildTagInput');
      if (!nameInput.value.trim() || !tagInput.value.trim()) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Bitte Name und Kürzel eintragen.', 2800);
        return;
      }
      bkmpGuildBusy = true;
      try {
        await bkmpGuildCreate(nameInput.value.trim(), tagInput.value.trim());
        bkmpGuildLoaded = false;
        bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
    panel.querySelectorAll('.idle-guild-join-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-guild-id]');
        const guildId = card ? card.dataset.guildId : null;
        if (!guildId || bkmpGuildBusy) return;
        bkmpGuildBusy = true;
        try {
          await bkmpGuildJoin(guildId);
          bkmpGuildLoaded = false;
          bkmpGuildRefreshTreasuryBonusCache();
        } catch (e) {
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
        }
        bkmpGuildBusy = false;
        await bkmpIdleRenderGildePanel();
      });
    });
    panel.querySelectorAll('.idle-guild-toggle-members-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-guild-id]');
        const guildId = card ? card.dataset.guildId : null;
        if (!guildId) return;
        if (bkmpGuildExpandedBrowseGuildId === guildId) {
          bkmpGuildExpandedBrowseGuildId = null;
          await bkmpIdleRenderGildePanel();
          return;
        }
        bkmpGuildExpandedBrowseGuildId = guildId;
        if (!bkmpGuildBrowseMembersCache[guildId] && typeof bkmpGuildLoadMembersPublic === 'function') {
          await bkmpIdleRenderGildePanel();
          bkmpGuildBrowseMembersCache[guildId] = await bkmpGuildLoadMembersPublic(guildId).catch(() => []);
        }
        await bkmpIdleRenderGildePanel();
      });
    });
    panel.querySelectorAll('.idle-guild-request-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-guild-id]');
        const guildId = card ? card.dataset.guildId : null;
        if (!guildId || bkmpGuildBusy) return;
        bkmpGuildBusy = true;
        try {
          await bkmpGuildRequestJoin(guildId);
          bkmpGuildMyJoinRequests = await bkmpGuildLoadMyJoinRequests().catch(() => bkmpGuildMyJoinRequests);
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Beitrittsanfrage gesendet!', 3000);
        } catch (e) {
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
        }
        bkmpGuildBusy = false;
        await bkmpIdleRenderGildePanel();
      });
    });
    panel.querySelectorAll('.idle-guild-cancel-request-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (bkmpGuildBusy) return;
        bkmpGuildBusy = true;
        try {
          await bkmpGuildCancelJoinRequest(btn.dataset.requestId);
          bkmpGuildMyJoinRequests = await bkmpGuildLoadMyJoinRequests().catch(() => bkmpGuildMyJoinRequests);
        } catch (e) {
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
        }
        bkmpGuildBusy = false;
        await bkmpIdleRenderGildePanel();
      });
    });
    const joinCodeBtn = document.getElementById('idleGuildJoinCodeBtn');
    if (joinCodeBtn) joinCodeBtn.addEventListener('click', async () => {
      const codeInput = document.getElementById('idleGuildCodeInput');
      const code = (codeInput.value || '').trim();
      if (!code) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Bitte einen Einladungscode eintragen.', 2800);
        return;
      }
      bkmpGuildBusy = true;
      try {
        await bkmpGuildJoinByCode(code);
        bkmpGuildLoaded = false;
        bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
    return;
  }

  const g = bkmpGuildState.guild;
  const isLeader = bkmpGuildState.myRole === 'leader';
  const isLeaderOrOfficer = isLeader || bkmpGuildState.myRole === 'officer';
  const isModerator = isLeaderOrOfficer || bkmpGuildState.myRole === 'veteran';
  const bonusPct = typeof bkmpIdleGuildTreasuryBonusPct === 'function' ? bkmpIdleGuildTreasuryBonusPct(g.treasuryGold) : 0;
  const nextMilestone = typeof bkmpIdleGuildNextTreasuryMilestone === 'function' ? bkmpIdleGuildNextTreasuryMilestone(g.treasuryGold) : null;
  const levelInfo = bkmpGuildLevelInfo(g.guildXp);
  const slotsMaxed = g.bonusMemberSlots >= BKMP_GUILD_SLOT_MAX_BONUS;
  const nextSlotCost = bkmpGuildSlotCost(g.bonusMemberSlots);

  if (isLeader && bkmpGuildMyInviteCode === null && !g.isPublic) {
    bkmpGuildGetMyInviteCode().then(code => { bkmpGuildMyInviteCode = code || ''; bkmpIdleRenderGildePanel(); });
  }
  if (bkmpGuildChatLoadedForGuildId !== g.id) {
    bkmpGuildChatLoadedForGuildId = g.id;
    bkmpGuildGetChatMessages(g.id, 50).then(msgs => { bkmpGuildChatMessages = msgs; bkmpIdleRenderGildePanel(); }).catch(e => console.warn('Idle Dorf: Gildenchat konnte nicht geladen werden.', e));
    /* Echter Realtime-Kanal (Spieler-Wunsch: "moderner wirken") - vorher
       lud der Chat neue Nachrichten anderer Mitglieder erst beim naechsten
       eigenen Rendern/Senden nach. Neue Zeile wird direkt lokal angehaengt
       statt komplett neu zu laden (gleiches Prinzip wie beim Raid-HP-Sync).
       Flag wird SOFORT gesetzt (nicht erst nach Erfolg) - der Realtime-Kanal
       darf bei einem fehlgeschlagenen Erstladen nicht bei jedem Panel-Rerender
       ein zweites Mal abonniert werden. */
    if (typeof bkmpSubscribeToGuildChat === 'function') {
      bkmpSubscribeToGuildChat(g.id, row => {
        if (bkmpGuildChatMessages.some(m => m.id === row.id)) return;
        bkmpGuildChatMessages.push({
          id: row.id, authUserId: row.auth_user_id, displayName: row.display_name,
          message: row.message, createdAt: row.created_at
        });
        if (bkmpGuildChatMessages.length > 50) bkmpGuildChatMessages.shift();
        bkmpIdleRenderGildePanel();
      });
    }
  }
  if (bkmpGuildStateSubscribedForGuildId !== g.id) {
    bkmpGuildStateSubscribedForGuildId = g.id;
    /* Spieler-Wunsch (16.07.): "wenn Gold eingezahlt wird das es gleich
       für alle angezeigt wird, ohne reloaden zu müssen" - bisher patchte
       jede Gilden-Aktion (Beitrag/Levelaufstieg/Technologie/Platzkauf)
       nur den lokalen State des HANDELNDEN Spielers, alle anderen mit
       offenem Gilde-Tab sahen die Aenderung erst nach eigenem Neuladen.
       Siehe bkmpSubscribeToGuildState() in supabase.js fuer die genaue
       Kanal-/Filter-Begruendung. */
    if (typeof bkmpSubscribeToGuildState === 'function') {
      bkmpSubscribeToGuildState(g.id,
        row => {
          if (!bkmpGuildState || typeof bkmpGuildMapRow !== 'function') return;
          bkmpGuildState.guild = bkmpGuildMapRow(row);
          bkmpIdleRenderGildePanel();
        },
        row => {
          if (!bkmpGuildState) return;
          const mapped = {
            authUserId: row.auth_user_id,
            displayName: row.display_name,
            role: row.role,
            contributedGold: Number(row.contributed_gold || 0),
            joinedAt: row.joined_at
          };
          const idx = bkmpGuildState.members.findIndex(m => m.authUserId === mapped.authUserId);
          if (idx >= 0) bkmpGuildState.members[idx] = mapped;
          else bkmpGuildState.members.push(mapped);
          bkmpIdleRenderGildePanel();
        }
      );
    }
  }
  if (bkmpGuildActivityLoadedForGuildId !== g.id) {
    /* Flag erst NACH Erfolg setzen (anders als beim Chat oben, hier haengt
       kein Realtime-Abo dran) - schlaegt der Abruf fehl (z.B. Session noch
       nicht bereit), versucht es der naechste Panel-Rerender einfach erneut,
       statt fuer immer auf dem leeren Zustand stehen zu bleiben. */
    bkmpGuildGetActivityLog(g.id, 30).then(log => { bkmpGuildActivityLoadedForGuildId = g.id; bkmpGuildActivityLog = log; bkmpIdleRenderGildePanel(); }).catch(e => console.warn('Idle Dorf: Gildenaktivitaet konnte nicht geladen werden.', e));
  }
  if (isModerator && bkmpGuildJoinRequestsLoadedForGuildId !== g.id) {
    bkmpGuildLoadJoinRequestsForMyGuild(g.id).then(list => { bkmpGuildJoinRequestsLoadedForGuildId = g.id; bkmpGuildJoinRequests = list; bkmpIdleRenderGildePanel(); }).catch(e => console.warn('Idle Dorf: Beitrittsanfragen konnten nicht geladen werden.', e));
  } else if (!isModerator) {
    bkmpGuildJoinRequests = [];
  }
  if (bkmpGuildQuestsLoadedForGuildId !== g.id) {
    /* Gleicher Grund wie oben beim Aktivitaetslog: Flag erst nach Erfolg
       setzen, sonst blieb "⏳ Lade Quests..." bei jedem fehlgeschlagenen
       ersten Versuch dauerhaft stehen (Spieler-Report per Screenshot). */
    bkmpGuildQuestEnsureToday().then(quests => { bkmpGuildQuestsLoadedForGuildId = g.id; bkmpGuildQuests = quests; bkmpIdleRenderGildePanel(); }).catch(e => console.warn('Idle Dorf: Gildenquests konnten nicht geladen werden.', e));
  }
  if (Date.now() - bkmpGuildPresenceLoadedAt > 20000 && typeof bkmpLoadPresence === 'function') {
    bkmpGuildPresenceLoadedAt = Date.now();
    bkmpLoadPresence(bkmpGuildState.members.map(m => m.authUserId))
      .then(map => { bkmpGuildPresenceMap = map; bkmpIdleRenderGildePanel(); }).catch(() => {});
  }

  /* Gilden-Chat zeigt NUR echte Chat-Nachrichten (Spieler-Feedback: die
     vorherige Vermischung mit dem Aktivitaetslog liess Spenden/Levelaufstiege
     doppelt auftauchen, einmal oben in "Gildenaktivitaet" und nochmal hier).
     Das Aktivitaetslog bleibt ausschliesslich in seiner eigenen Sektion. */
  const roleByUid = {};
  bkmpGuildState.members.forEach(m => { roleByUid[m.authUserId] = m.role; });

  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <div class="idle-guild-header-row">
        ${bkmpRenderGuildBanner(g.banner, 56)}
        <h4>${g.isPublic ? '🌐' : '🔒'} [${escapeHtml(g.tag)}] ${escapeHtml(g.name)}</h4>
      </div>
      ${g.description ? `<p>${escapeHtml(g.description)}</p>` : ''}
      <p>${g.memberCount}/${g.maxMembers} Mitglieder &middot; Deine Rolle: ${BKMP_GUILD_ROLE_LABELS[bkmpGuildState.myRole] || bkmpGuildState.myRole} &middot; ${g.isPublic ? 'Öffentlich' : 'Privat'}</p>
      ${isLeaderOrOfficer ? `<p class="idle-dungeon-best">🏗️ Gildenplätze: ${g.bonusMemberSlots > 0 ? `+${g.bonusMemberSlots} dazugekauft` : 'noch keine dazugekauft'}${slotsMaxed
        ? ' &middot; ✅ Maximale Erweiterung erreicht'
        : ` &middot; <button type="button" class="btn-nein idle-guild-buy-slot-btn" id="idleGuildBuySlotBtn" ${bkmpGuildBusy || g.treasuryGold < nextSlotCost ? 'disabled' : ''}>+1 Platz (${bkmpIdleFormatNumber(nextSlotCost)} 💰)</button>`}</p>` : ''}
      <div class="idle-guild-level-row">
        <span class="idle-guild-level-badge">🏰 Level ${levelInfo.level}</span>
        <span class="idle-guild-level-xp">${bkmpIdleFormatNumber(levelInfo.xpIntoLevel)} / ${levelInfo.nextLevelXp !== null ? bkmpIdleFormatNumber(levelInfo.xpForLevel) : '—'} Erfahrung</span>
      </div>
      <div class="idle-guild-xp-bar">
        <div class="idle-guild-xp-fill" style="width:${levelInfo.pct}%"></div>
        <span class="idle-guild-xp-chest" style="left:${levelInfo.pct}%">💰</span>
      </div>
      <p class="idle-guild-xp-pct">${levelInfo.nextLevelXp !== null ? `${levelInfo.pct}% bis Level ${levelInfo.level + 1}` : 'Maximales Level erreicht!'}</p>
      <p class="idle-dungeon-best">💰 Gildenkasse: ${bkmpIdleFormatNumber(g.treasuryGold)} &middot; 🔺 Aktueller Bonus: +${bonusPct}% Angriff/Verteidigung/Gold für alle Mitglieder</p>
      ${nextMilestone ? `<p>Nächster Kassen-Meilenstein bei ${bkmpIdleFormatNumber(nextMilestone)} 💰 Kasse.</p>` : ''}
      <div class="idle-guild-create-row">
        <input type="number" id="idleGuildContributeInput" placeholder="Gold-Betrag" min="1">
        <button type="button" class="btn-ja idle-guild-contribute-btn" id="idleGuildContributeBtn" ${bkmpGuildBusy ? 'disabled' : ''}>Beitragen</button>
        ${isLeader ? `<button type="button" class="btn-nein" id="idleGuildSettingsToggleBtn">${bkmpGuildSettingsOpen ? 'Einstellungen schließen' : '⚙️ Einstellungen'}</button>` : ''}
        <button type="button" class="btn-nein" id="idleGuildLeaveBtn" ${bkmpGuildBusy ? 'disabled' : ''}>Gilde verlassen</button>
      </div>
    </div>
    ${isLeader && bkmpGuildSettingsOpen ? `
      <div class="idle-dungeon-intro">
        <h4>⚙️ Gilden-Einstellungen</h4>
        <div class="idle-guild-create-row" style="flex-direction:column; align-items:stretch;">
          <textarea id="idleGuildDescInput" maxlength="200" placeholder="Kurze Beschreibung deiner Gilde (max. 200 Zeichen)" style="min-height:60px; padding:0.5rem 0.7rem; border-radius:10px; border:1px solid var(--line); background:var(--paper-2); color:var(--ink); font-family:inherit;">${escapeHtml(g.description || '')}</textarea>
          <input type="text" id="idleGuildGoalInput" maxlength="100" placeholder="Gildenziel (z.B. 'Level 10 bis Ende des Monats', max. 100 Zeichen)" value="${escapeHtml(g.currentGoal || '')}">
          <label class="admin-checkbox-label" style="justify-content:center;">
            <input type="checkbox" id="idleGuildPublicToggle" ${g.isPublic ? 'checked' : ''}>
            Öffentlich (jeder kann direkt beitreten, sonst nur per Einladungscode)
          </label>
          ${!g.isPublic ? `<p class="idle-dungeon-best">🔑 Einladungscode: ${bkmpGuildMyInviteCode ? escapeHtml(bkmpGuildMyInviteCode) : '⏳ lädt...'}</p>
          <button type="button" class="btn-nein" id="idleGuildRegenCodeBtn" style="align-self:center;">Neuen Code erzeugen</button>` : ''}
          <button type="button" class="btn-ja" id="idleGuildSaveSettingsBtn" style="align-self:center;">Speichern</button>
        </div>
        <div class="idle-guild-banner-picker">
          <p style="margin:0.8rem 0 0.4rem;">🚩 Gildenbanner:</p>
          <div class="idle-guild-banner-preview">${bkmpRenderGuildBanner(g.banner, 64)}</div>
          <div class="idle-guild-banner-colors">
            ${BKMP_GUILD_BANNER_COLORS.map(c => `<button type="button" class="idle-guild-banner-color-btn ${((g.banner && g.banner.color) || BKMP_GUILD_BANNER_COLORS[0].id) === c.id ? 'active' : ''}" data-banner-color="${c.id}" style="background:linear-gradient(135deg, ${c.from}, ${c.to});" title="${c.label}"></button>`).join('')}
          </div>
          <div class="idle-guild-banner-symbols">
            ${BKMP_GUILD_BANNER_SYMBOLS.map(s => `<button type="button" class="idle-guild-banner-symbol-btn ${((g.banner && g.banner.symbol) || BKMP_GUILD_BANNER_SYMBOLS[0]) === s ? 'active' : ''}" data-banner-symbol="${s}">${s}</button>`).join('')}
          </div>
        </div>
      </div>
    ` : ''}
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">🎯 Tägliche Gildenquests</h4>
      ${bkmpGuildQuests.length === 0 ? '<p class="empty-hint">⏳ Lade Quests...</p>' : bkmpGuildQuests.map(q => {
        const def = BKMP_GUILD_QUEST_CATALOG[q.questType] || { label: q.questType, icon: '🎯', format: v => v };
        const pct = q.target > 0 ? Math.min(100, Math.floor((q.progress / q.target) * 100)) : 0;
        return `
          <div class="idle-guild-quest-card ${q.completed ? 'is-complete' : ''}">
            <div class="idle-guild-quest-title">${def.icon} ${escapeHtml(def.label)} ${q.completed ? '✅' : ''}</div>
            <div class="idle-guild-quest-bar"><div class="idle-guild-quest-fill" style="width:${pct}%"></div></div>
            <div class="idle-guild-quest-progress">${def.format(q.progress)} / ${def.format(q.target)}</div>
            <div class="idle-guild-quest-reward">Belohnung: ${BKMP_GUILD_QUEST_TIER_REWARD_LABEL[q.tier] || ''}</div>
          </div>
        `;
      }).join('')}
    </div>
    ${isModerator ? `
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">📩 Beitrittsanfragen ${bkmpGuildJoinRequests.length ? `(${bkmpGuildJoinRequests.length})` : ''}</h4>
      ${bkmpGuildJoinRequests.length === 0 ? '<p class="empty-hint">Keine offenen Anfragen.</p>' : bkmpGuildJoinRequests.map(r => `
        <div class="idle-arena-opponent-card" data-request-id="${escapeHtml(r.id)}">
          <span class="idle-arena-opponent-name">${escapeHtml(r.displayName)}</span>
          <span class="idle-arena-opponent-record">${r.message ? escapeHtml(r.message) : ''}</span>
          <button type="button" class="btn-ja idle-guild-request-accept-btn" ${g.memberCount >= g.maxMembers ? 'disabled title="Gilde ist voll"' : ''}>Annehmen</button>
          <button type="button" class="btn-nein idle-guild-request-reject-btn">Ablehnen</button>
        </div>
      `).join('')}
    </div>
    ` : ''}
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">Mitglieder</h4>
      ${bkmpGuildState.members.map(m => `
        <div class="idle-arena-opponent-card" data-member-uid="${escapeHtml(m.authUserId)}">
          <span class="idle-arena-opponent-name">${escapeHtml(m.displayName)}</span>
          <span class="idle-arena-opponent-record">${BKMP_GUILD_ROLE_LABELS[m.role] || m.role} &middot; ${bkmpGuildFormatPresence(bkmpGuildPresenceMap[m.authUserId])}</span>
          <span class="idle-arena-opponent-rating">💰 ${bkmpIdleFormatNumber(m.contributedGold)}</span>
          ${isLeaderOrOfficer && m.authUserId !== uid && m.role !== 'leader' ? `
            ${bkmpGuildState.myRole === 'leader' ? `
              ${bkmpGuildNextRoleUp(m.role) ? `<button type="button" class="btn-nein idle-guild-role-btn" data-role="${bkmpGuildNextRoleUp(m.role)}">⬆️ Befördern</button>` : ''}
              ${bkmpGuildNextRoleDown(m.role) ? `<button type="button" class="btn-nein idle-guild-role-btn" data-role="${bkmpGuildNextRoleDown(m.role)}">⬇️ Degradieren</button>` : ''}
            ` : ''}
            <button type="button" class="btn-nein idle-guild-kick-btn">Entfernen</button>
          ` : ''}
        </div>
      `).join('')}
    </div>
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">🏆 Spendenrangliste</h4>
      ${bkmpGuildState.members.filter(m => m.contributedGold > 0).length === 0 ? '<p class="empty-hint">Noch keine Spenden.</p>' : bkmpGuildState.members.filter(m => m.contributedGold > 0).map((m, i) => `
        <div class="idle-arena-opponent-card">
          <span class="idle-arena-opponent-name">${BKMP_GUILD_MEDALS[i] || `${i + 1}.`} ${escapeHtml(m.displayName)}</span>
          <span class="idle-arena-opponent-rating">${bkmpIdleFormatNumber(m.contributedGold)} 💰</span>
        </div>
      `).join('')}
    </div>
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">📜 Gildenaktivität</h4>
      <div class="idle-guild-activity-log">
        ${bkmpGuildActivityLog.length === 0 ? '<p class="empty-hint">Noch keine Aktivität.</p>' : bkmpGuildActivityLog.map(entry => `
          <p class="idle-guild-activity-entry">${bkmpGuildFormatActivityEntry(entry)} <span class="idle-guild-chat-time">${bkmpArenaFormatTime(entry.createdAt)}</span></p>
        `).join('')}
      </div>
    </div>
    ${g.currentGoal ? `<div class="idle-dungeon-intro idle-guild-goal-banner"><p><strong>🎯 Gildenziel:</strong> ${escapeHtml(g.currentGoal)}</p></div>` : ''}
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">💬 Gilden-Chat</h4>
      <div class="idle-guild-chat-log" id="idleGuildChatLog">
        ${bkmpGuildChatMessages.length === 0 ? '<p class="empty-hint">Noch keine Nachrichten.</p>' : bkmpGuildChatMessages.map(m => {
          const roleClass = BKMP_GUILD_ROLE_CHAT_CLASS[roleByUid[m.authUserId]] || BKMP_GUILD_ROLE_CHAT_CLASS.member;
          const deleteBtn = isModerator ? `<button type="button" class="idle-guild-chat-delete-btn" data-message-id="${escapeHtml(m.id)}" title="Nachricht löschen (Moderation)">🗑️</button>` : '';
          return `<p class="idle-guild-chat-msg"><strong class="${roleClass}">${escapeHtml(m.displayName)}:</strong> ${escapeHtml(m.message)} <span class="idle-guild-chat-time">${bkmpArenaFormatTime(m.createdAt)}</span>${deleteBtn}</p>`;
        }).join('')}
      </div>
      <div class="idle-guild-create-row">
        <input type="text" id="idleGuildChatInput" placeholder="Nachricht an deine Gilde..." maxlength="300">
        <button type="button" class="btn-ja" id="idleGuildChatSendBtn">Senden</button>
      </div>
    </div>
  `;
  const chatLog = document.getElementById('idleGuildChatLog');
  if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;

  const contributeBtn = document.getElementById('idleGuildContributeBtn');
  if (contributeBtn) contributeBtn.addEventListener('click', async () => {
    const input = document.getElementById('idleGuildContributeInput');
    const amount = Math.round(Number(input.value || 0));
    if (!amount || amount <= 0) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Bitte einen gültigen Betrag eintragen.', 2800);
      return;
    }
    bkmpGuildBusy = true;
    try {
      await bkmpGuildContribute(amount);
      /* contribute_gold() zieht das Gold serverseitig sofort ab (siehe
         supabase-idle-guilds.sql), aber bkmpIdleState.gold blieb bisher
         unveraendert - der naechste normale Autosave (bkmpIdleQueueSync ->
         upsertIdlePlayerState, schreibt den KOMPLETTEN State) haette den
         veralteten, noch nicht reduzierten Wert einfach wieder ueber den
         serverseitig schon abgezogenen geschrieben (Spieler-Meldung: "Gold
         wird mir nicht abgezogen") - die Kasse bekam das Gold, der Spieler
         behielt es aber effektiv trotzdem. Gleiches Muster wie bei
         Upgrade-/Runen-Kaeufen (bkmpIdleState.gold -= cost) noetig.*/
      bkmpIdleState.gold -= amount;
      bkmpIdleRenderHud();
      bkmpIdleQueueSync();
      bkmpGuildLoaded = false;
      bkmpGuildRefreshTreasuryBonusCache();
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`💰 ${amount} Gold zur Gildenkasse beigetragen!`, 3200);
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  const leaveBtn = document.getElementById('idleGuildLeaveBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', async () => {
    const confirmed = typeof bkmpConfirmDialog === 'function'
      ? await bkmpConfirmDialog('🛡️ Gilde verlassen?', 'Möchtest du diese Gilde wirklich verlassen?', 'Ja, verlassen', 'Abbrechen')
      : confirm('Gilde wirklich verlassen?');
    if (!confirmed || bkmpGuildBusy) return;
    bkmpGuildBusy = true;
    try {
      await bkmpGuildLeave();
      bkmpGuildLoaded = false;
      bkmpGuildRefreshTreasuryBonusCache();
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  const buySlotBtn = document.getElementById('idleGuildBuySlotBtn');
  if (buySlotBtn) buySlotBtn.addEventListener('click', async () => {
    if (bkmpGuildBusy) return;
    bkmpGuildBusy = true;
    try {
      await bkmpGuildBuySlot();
      bkmpGuildLoaded = false;
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🏗️ Gildenplatz dazugekauft!', 3200);
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  panel.querySelectorAll('.idle-guild-kick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-member-uid]');
      const targetUid = card ? card.dataset.memberUid : null;
      if (!targetUid || bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        await bkmpGuildKickMember(targetUid);
        bkmpGuildLoaded = false;
        bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  panel.querySelectorAll('.idle-guild-role-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-member-uid]');
      const targetUid = card ? card.dataset.memberUid : null;
      const newRole = btn.dataset.role;
      if (!targetUid || bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        await bkmpGuildSetMemberRole(targetUid, newRole);
        bkmpGuildLoaded = false;
        bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  panel.querySelectorAll('.idle-guild-request-accept-btn, .idle-guild-request-reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-request-id]');
      const requestId = card ? card.dataset.requestId : null;
      if (!requestId || bkmpGuildBusy) return;
      const accept = btn.classList.contains('idle-guild-request-accept-btn');
      bkmpGuildBusy = true;
      try {
        await bkmpGuildRespondJoinRequest(requestId, accept);
        bkmpGuildJoinRequestsLoadedForGuildId = null;
        bkmpGuildLoaded = false;
        if (accept) bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  panel.querySelectorAll('.idle-guild-chat-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const messageId = btn.dataset.messageId;
      if (!messageId || bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        await bkmpGuildDeleteChatMessage(messageId);
        bkmpGuildChatMessages = bkmpGuildChatMessages.filter(m => m.id !== messageId);
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  const settingsToggleBtn = document.getElementById('idleGuildSettingsToggleBtn');
  if (settingsToggleBtn) settingsToggleBtn.addEventListener('click', () => {
    bkmpGuildSettingsOpen = !bkmpGuildSettingsOpen;
    bkmpIdleRenderGildePanel();
  });

  const saveSettingsBtn = document.getElementById('idleGuildSaveSettingsBtn');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', async () => {
    const descInput = document.getElementById('idleGuildDescInput');
    const publicToggle = document.getElementById('idleGuildPublicToggle');
    const goalInput = document.getElementById('idleGuildGoalInput');
    if (bkmpGuildBusy) return;
    bkmpGuildBusy = true;
    try {
      const newCode = await bkmpGuildUpdateSettings(descInput.value, publicToggle.checked);
      if (newCode) bkmpGuildMyInviteCode = newCode;
      if (publicToggle.checked) bkmpGuildMyInviteCode = null;
      if (goalInput) await bkmpGuildUpdateGoal(goalInput.value);
      bkmpGuildLoaded = false;
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Gilden-Einstellungen gespeichert.', 2600);
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  const regenCodeBtn = document.getElementById('idleGuildRegenCodeBtn');
  if (regenCodeBtn) regenCodeBtn.addEventListener('click', async () => {
    if (bkmpGuildBusy) return;
    bkmpGuildBusy = true;
    try {
      bkmpGuildMyInviteCode = await bkmpGuildRegenerateInviteCode();
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Neuer Einladungscode erzeugt - alte Codes gelten nicht mehr.', 3200);
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  panel.querySelectorAll('.idle-guild-banner-color-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        const banner = { color: btn.dataset.bannerColor, symbol: (g.banner && g.banner.symbol) || BKMP_GUILD_BANNER_SYMBOLS[0] };
        await bkmpGuildUpdateBanner(banner);
        bkmpGuildLoaded = false;
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  panel.querySelectorAll('.idle-guild-banner-symbol-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        const banner = { color: (g.banner && g.banner.color) || BKMP_GUILD_BANNER_COLORS[0].id, symbol: btn.dataset.bannerSymbol };
        await bkmpGuildUpdateBanner(banner);
        bkmpGuildLoaded = false;
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  const chatSendBtn = document.getElementById('idleGuildChatSendBtn');
  const chatInput = document.getElementById('idleGuildChatInput');
  const sendChat = async () => {
    const msg = (chatInput.value || '').trim();
    if (!msg) return;
    chatInput.value = '';
    try {
      await bkmpGuildSendChatMessage(msg);
      bkmpGuildChatLoadedForGuildId = null;
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    await bkmpIdleRenderGildePanel();
  };
  if (chatSendBtn) chatSendBtn.addEventListener('click', sendChat);
  if (chatInput) chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

/* ---------------- Rendering: Gilden-Technologie-Tab ----------------
   Eigener Tab statt Teil des Gilde-Tabs - 9 Karten brauchen sichtbaren
   Platz, gleiche Trennung wie Skilltree vs. Kampf-Tab. */
async function bkmpIdleRenderGildeTechPanel() {
  const panel = document.getElementById('idlePanelGildeTech');
  if (!panel) return;
  if (!bkmpGuildLoaded && !bkmpGuildLoading) await bkmpGuildLoadAll();

  if (!bkmpGuildState) {
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <h4>🌳 Gilden-Technologie</h4>
        <p>Du musst Mitglied einer Gilde sein, um an der gemeinsamen Technologie mitzuwirken.</p>
      </div>`;
    return;
  }

  const g = bkmpGuildState.guild;
  const canUpgrade = bkmpGuildState.myRole === 'leader' || bkmpGuildState.myRole === 'officer';

  if (bkmpGuildTechLoadedForGuildId !== g.id) {
    bkmpGuildTechLoadedForGuildId = g.id;
    bkmpGuildGetTechLevels(g.id).then(levels => { bkmpGuildTechLevels = levels; bkmpIdleRenderGildeTechPanel(); }).catch(() => {});
  }

  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <h4>🌳 Gilden-Technologie</h4>
      <p>Permanente Boni für ALLE Mitglieder, bezahlt aus der Gildenkasse (💰 ${bkmpIdleFormatNumber(g.treasuryGold)}).${canUpgrade ? '' : ' Nur Anführer oder Stellvertreter dürfen verbessern.'}</p>
    </div>
    <div class="idle-guild-tech-grid">
      ${BKMP_GUILD_TECH_CATALOG.map(tech => {
        const level = bkmpGuildTechLevels[tech.id] || 0;
        const maxed = level >= BKMP_GUILD_TECH_MAX_LEVEL;
        const cost = bkmpGuildTechCostForLevel(level);
        const canAfford = g.treasuryGold >= cost;
        const bonusDisplay = (level * tech.perLevel).toFixed(1).replace(/\.0$/, '');
        return `
          <div class="idle-guild-tech-card">
            <div class="idle-guild-tech-icon">${tech.icon}</div>
            <div class="idle-guild-tech-name">${escapeHtml(tech.label)}</div>
            <div class="idle-guild-tech-level">Stufe ${level}/${BKMP_GUILD_TECH_MAX_LEVEL}</div>
            <div class="idle-guild-tech-bonus">+${bonusDisplay}%</div>
            ${maxed
              ? '<span class="idle-guild-tech-maxed">✅ Maximalstufe</span>'
              : `<button type="button" class="btn-ja idle-guild-tech-upgrade-btn" data-tech-id="${tech.id}" ${!canUpgrade || !canAfford || bkmpGuildBusy ? 'disabled' : ''}>${bkmpIdleFormatNumber(cost)} 💰</button>`}
          </div>
        `;
      }).join('')}
    </div>
  `;

  panel.querySelectorAll('.idle-guild-tech-upgrade-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const techId = btn.dataset.techId;
      if (!techId || bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        const result = await bkmpGuildTechUpgrade(techId);
        if (result) {
          bkmpGuildTechLevels[techId] = result.newLevel;
          bkmpGuildState.guild.treasuryGold = result.treasuryGold;
          bkmpGuildRefreshTreasuryBonusCache();
          const techDef = BKMP_GUILD_TECH_CATALOG.find(t => t.id === techId);
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🌳 ${techDef ? techDef.label : techId} auf Stufe ${result.newLevel}!`, 3000);
        }
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildeTechPanel();
    });
  });
}
async function bkmpIdleRenderGildeBossPanel() {
  const panel = document.getElementById('idlePanelGildeBoss');
  if (!panel) return;
  if (!bkmpGuildLoaded && !bkmpGuildLoading) await bkmpGuildLoadAll();

  if (!bkmpGuildState) {
    bkmpGuildBossPanelRenderedForKey = null;
    panel.innerHTML = `<div class="idle-dungeon-intro"><h4>🐲 Gildenboss</h4><p>Du musst Mitglied einer Gilde sein, um am Gildenboss teilzunehmen.</p></div>`;
    return;
  }

  const info = bkmpGuildBossGetPhaseInfo();
  const fullInstanceId = bkmpGuildState.guild.id + '-' + info.dateKey;

  if (info.phase === 'fight' && bkmpGuildBossHasJoined(fullInstanceId) && !bkmpGuildBossState) {
    bkmpGuildBossJoin().then(state => {
      if (!state) return;
      bkmpGuildBossState = state;
      bkmpGuildBossResultShown = false;
      loadGuildBossParticipants(state.instanceId).then(list => { bkmpGuildBossParticipants = list; bkmpIdleRenderGildeBossPanel(); }).catch(() => {});
      /* Bug-Fix (beim Neu-Testen des kompletten Ablaufs gefunden, 15.07.):
         war der Kampf beim (Wieder-)Oeffnen des Fensters serverseitig
         schon vorbei (won/expired) - z.B. Boss vor dem eigenen Beitritt
         von der Gilde besiegt, oder Seite waehrend 20-21 Uhr neu geladen -
         wurde weder der Loop gestartet NOCH bkmpGuildBossCheckOutcome()
         aufgerufen. Die Ergebnisansicht erschien zwar (isFinished greift
         schon am Status), aber Gold/Kristalle blieben dauerhaft bei "+0",
         weil deren Nachlade-Fetch (loadGuildBossInstance) nur dort drin
         angestossen wird. */
      if (state.status === 'fighting') bkmpGuildBossStartLoop();
      else bkmpGuildBossCheckOutcome();
      bkmpIdleRenderGildeBossPanel();
    }).catch(() => {});
  }

  if (info.phase !== 'fight' && bkmpGuildBossState) {
    bkmpGuildBossStopLoop();
    bkmpGuildBossState = null;
  }

  if (!bkmpGuildBossState) {
    bkmpGuildBossPanelRenderedForKey = null;
    let bodyHtml = '';
    if (info.phase === 'prep') {
      bodyHtml = `<p class="idle-dungeon-best" id="idleGuildBossPrepCountdown">⏳ Vorbereitung - Kampf startet in ${bkmpRaidFormatCountdown(info.msUntilFightStart)}.</p>`;
    } else if (info.phase === 'fight') {
      bodyHtml = `
        <p class="idle-dungeon-best">🐲 ${bkmpRaidFormatCountdown(info.msUntilFightEnd)} verbleiben!</p>
        <button type="button" class="btn-ja idle-guild-boss-join-btn" id="idleGuildBossJoinBtn" ${bkmpGuildBossBusy ? 'disabled' : ''}>⚔️ Jetzt kämpfen</button>
      `;
    } else {
      bodyHtml = `<p>Der Gildenboss erscheint täglich <strong>20:00-21:00 Uhr</strong> (Vorbereitung ab 19:55 Uhr).</p>`;
    }
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <div class="idle-guild-header-row">
          ${bkmpRenderGuildBanner(bkmpGuildState.guild.banner, 40)}
          <h4>🐲 Gildenboss</h4>
        </div>
        <p>Kämpft gemeinsam als Gilde gegen einen riesigen Boss - Belohnung anteilig nach verursachtem Schaden. Bisher besiegt: ${bkmpIdleFormatNumber(bkmpGuildState.guild.bossesDefeated || 0)}.</p>
        ${bodyHtml}
      </div>
    `;
    if (info.phase === 'prep') bkmpGuildBossStartPrepCountdownTicker();
    const joinBtn = document.getElementById('idleGuildBossJoinBtn');
    if (joinBtn) joinBtn.addEventListener('click', async () => {
      if (bkmpGuildBossBusy) return;
      bkmpGuildBossBusy = true;
      try {
        const state = await bkmpGuildBossJoin();
        if (state) {
          bkmpGuildBossMarkJoined(state.instanceId);
          bkmpGuildBossState = state;
          bkmpGuildBossResultShown = false;
          bkmpGuildBossParticipants = await loadGuildBossParticipants(state.instanceId).catch(() => []);
          if (state.status === 'fighting') bkmpGuildBossStartLoop();
          else bkmpGuildBossCheckOutcome();
        }
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBossBusy = false;
      await bkmpIdleRenderGildeBossPanel();
    });
    return;
  }

  const g = bkmpGuildBossState;
  const isFinished = g.status === 'won' || g.status === 'expired';
  /* g.id gibt es nicht (bkmpGuildBossJoin() liefert "instanceId", siehe
     Bug-Fix-Kommentar bei bkmpGuildBossOwnTick) - hier selbst reingefallen
     beim urspruenglichen Render-Throttle-Fix. */
  const renderKey = g.instanceId + '|' + isFinished;

  if (bkmpGuildBossPanelRenderedForKey !== renderKey) {
    bkmpGuildBossPanelRenderedForKey = renderKey;
    if (isFinished) {
      /* Spieler-Report (15.07., "der Drache ist auch einfach immernoch
         da"): bisher wurde bei Sieg/Ablauf nur die "raid-clickable"-Klasse
         entfernt und der Statustext geaendert - das lachend weiterlaufende
         Drachenvideo aus der aktiven Kampfansicht blieb optisch komplett
         unveraendert stehen, kein erkennbarer Sieg-/Ende-Zustand. Analog
         zum bereits vorhandenen Raid-Ergebnisbildschirm (bkmpRaidShowResult)
         jetzt eine eigene Ergebnisansicht statt der Kampfansicht - nutzt
         dieselben raid-result-*-CSS-Klassen, die fuer den Raid schon
         existieren. bkmpGuildBossUpdateCombatUI() unten haelt die Werte
         hier zusaetzlich aktuell, da der spaetere Nachlade-Refresh in
         bkmpGuildBossCheckOutcome() wegen desselben renderKey KEIN erneutes
         Neubauen dieses Grundgeruests mehr ausloest. */
      panel.innerHTML = `
        <div class="idle-dungeon-intro">
          <h4>🐲 ${escapeHtml(g.bossName || 'Gildenboss')}</h4>
        </div>
        <div class="raid-result-title ${g.status === 'won' ? 'won' : 'lost'}">${g.status === 'won' ? '🏆 Gildenboss besiegt!' : '⌛ Zeit abgelaufen'}</div>
        <div class="raid-result-stats">
          <div class="raid-result-stat"><div class="raid-result-stat-label">Gesamtschaden</div><div class="raid-result-stat-value" id="guildBossResultTotalDmg">0</div></div>
          <div class="raid-result-stat"><div class="raid-result-stat-label">Dein Schaden</div><div class="raid-result-stat-value" id="guildBossResultOwnDmg">0</div></div>
          <div class="raid-result-stat"><div class="raid-result-stat-label">Dein Rang</div><div class="raid-result-stat-value" id="guildBossResultRank">-</div></div>
          <div class="raid-result-stat"><div class="raid-result-stat-label">Teilnehmer</div><div class="raid-result-stat-value" id="guildBossResultParticipantCount">${g.participantCount || bkmpGuildBossParticipants.length}</div></div>
          <div class="raid-result-stat"><div class="raid-result-stat-label">MVP</div><div class="raid-result-stat-value raid-result-mvp" id="guildBossResultMvp">-</div></div>
        </div>
        ${g.status === 'won' ? '<div class="raid-result-rewards"><span>💰 +<span id="guildBossResultGold">0</span></span><span>💎 +<span id="guildBossResultGems">0</span></span></div>' : ''}
        <div class="idle-arena-history">
          <h4 style="margin-top:1rem;">🏆 Schadensrangliste</h4>
          <div id="guildBossParticipantsList"></div>
        </div>
      `;
    } else {
      const hpPct = g.bossMaxHp > 0 ? Math.max(0, Math.min(100, (g.bossHp / g.bossMaxHp) * 100)) : 0;
      panel.innerHTML = `
        <div class="idle-dungeon-intro">
          <h4>🐲 ${escapeHtml(g.bossName || 'Gildenboss')}</h4>
          <p class="idle-dungeon-best" id="guildBossStatusText"></p>
        </div>
        <div class="raid-battlefield" id="guildBossBattlefield" style="justify-content:center;">
          <div class="raid-boss raid-clickable" id="guildBossCreature">
            <video class="raid-boss-sprite raid-sprite-malthyros" id="guildBossSprite" src="assets/dragons/malthyros.mp4?v=20260715-2" autoplay muted loop playsinline></video>
            <div class="raid-hp-bar"><div class="raid-hp-fill raid-hp-fill-boss" id="guildBossHpFill" style="width:${hpPct}%"></div></div>
            <div class="raid-hp-label" id="guildBossHpLabel">${bkmpIdleFormatNumber(g.bossHp)} / ${bkmpIdleFormatNumber(g.bossMaxHp)}</div>
            <div class="raid-boss-name" id="guildBossNameLabel">${escapeHtml(g.bossName || '')}</div>
          </div>
        </div>
        <p class="idle-guild-xp-pct" id="guildBossMyDamage"></p>
        <div class="idle-arena-history">
          <h4 style="margin-top:1rem;">🏆 Schadensrangliste</h4>
          <div id="guildBossParticipantsList"></div>
        </div>
      `;
      const creature = document.getElementById('guildBossCreature');
      if (creature) creature.addEventListener('click', bkmpGuildBossHandleClick);
    }
  }

  bkmpGuildBossUpdateCombatUI();
}

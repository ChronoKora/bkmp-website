// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-raid.js

let bkmpRaidLastClickAt = 0;
/* App-Modus (Phase 16): echter Tap-Schaden-Zaehler fuer die aktuelle
   Raid-Teilnahme (kein Fake-Wert - Summe der tatsaechlich per Tipp auf
   den Boss ausgeteilten clickDamage-Betraege, siehe
   bkmpRaidHandleBossClick weiter unten). Setzt sich automatisch zurueck,
   sobald bkmpRaidRenderCombat() eine neue Raid-Id sieht (naechster Raid
   = neue Zaehlung). Auf der normalen Website ungenutzt (kein Element mit
   diesen IDs vorhanden), daher folgenlos. */
let bkmpRaidTapDamageSession = 0;
let bkmpRaidTapDamageSessionId = null;
let bkmpRaidClickBurst = [];
const BKMP_RAID_CLICK_LOCK_KEY = 'bkmp-raid-click-locked-until';
const BKMP_RAID_CLICK_HISTORY_KEY = 'bkmp-raid-click-timestamps';

/* ============================================================
   Weltboss/Raid-Event (stuendlich, siehe supabase-raid-boss-schema.sql)

   Zeitmodell: rein UTC-Uhrzeit-basiert, komplett ohne Server-Cron. Minute
   55-59 jeder Stunde = Vorbereitungsphase fuer den Raid der NAECHSTEN vollen
   Stunde, Minute 0-54 = laufender Kampf des AKTUELLEN Stunden-Raids (endet
   spaetestens Minute 55, danach 'expired' falls Boss/Stadt bis dahin nicht
   entschieden). bkmpRaidCurrentId() (supabase.js) liefert dieselbe
   'YYYYMMDDHH24'-ID wie die SQL-Seite - jeder Client kommt unabhaengig auf
   dieselbe Raid-ID, kein Abstimmen noetig. Boss-HP/Stadt-HP sind
   serverseitig autoritativ (siehe RPCs) - hier wird nur zur Anzeige/fuer
   sofortiges visuelles Feedback lokal simuliert, der tatsaechliche Zaehler
   kommt immer aus der RPC-Antwort bzw. per Realtime von anderen Spielern. */

const BKMP_RAID_JOINED_KEY_PREFIX = 'bkmp-raid-joined-';
const BKMP_RAID_TICK_MS = 2500;
const BKMP_RAID_BOSS_POLL_MS = 1500;
/* Spieler-Meldung 18.07.: "Ich will auch zwischendurch Infos haben wieviel
   Damage jeder macht.. Eine dauerhafte Live-Anzeige von Anfang bis Ende" -
   bisher aktualisierten sich die Schaden-Zahlen ANDERER Spieler nur beim
   Oeffnen der Kampfansicht und kurz vorm Sieg/Niederlage-Ergebnis, dazwischen
   ausschliesslich ueber das Realtime-Abo auf raid_participants (siehe
   bkmpSubscribeToRaidInstance) - das liefert offenbar nicht zuverlaessig
   genug. Gleiches Prinzip wie der bereits bestehende bkmpRaidBossPoll-
   Fallback fuer raid_instances (dessen eigener Kommentar das bereits als
   bekanntes Realtime-Aussetzer-Muster beschreibt): ein simpler Zeit-Poll
   als garantierte Grundlage, Realtime bleibt zusaetzlich fuer schnelleres
   Update aktiv, wenn es funktioniert. */
const BKMP_RAID_PARTICIPANTS_POLL_MS = 3000;

let bkmpRaidState = null;
let bkmpRaidParticipants = [];
let bkmpRaidJoinedId = null;
/* Sync-Fix (Spieler-Meldung 15.07., Screenshot: eigene Zeile in der
   Teilnehmerliste zeigte 0/veraltet, obwohl schon Schaden gemacht wurde):
   bkmpRaidApplyOwnDamageResult matchte die eigene Zeile bisher per
   displayName-String-Vergleich (bkmpGetMcName()), waehrend die Realtime-
   Aktualisierung fuer ALLE ANDEREN Teilnehmer (siehe bkmpSubscribeToRaidInstance
   weiter unten) per authUserId matcht - zwei verschiedene Schluessel fuer
   dieselbe Liste. Sobald der lokale Anzeigename nicht exakt (Gross-/
   Kleinschreibung, Leerzeichen, Sonderzeichen wie Umlaute) mit dem in der
   DB gespeicherten display_name uebereinstimmt, fand der String-Vergleich
   keine Zeile und legte STATTDESSEN eine zweite, verwaiste Zeile
   (authUserId: null) an, die danach nie wieder von Realtime-Updates
   erreicht wird - das Ergebnis sind doppelte/veraltete Eintraege fuer
   denselben Spieler. Gleiches Muster wie bkmpArenaMyAuthUserId/
   bkmpGuildMyAuthUserId - einmal beim Oeffnen der Kampfansicht per
   Session-Check ermittelt, danach fuer den korrekten Abgleich genutzt. */
let bkmpRaidMyAuthUserId = null;
async function bkmpRaidEnsureMyAuthUserId() {
  if (bkmpRaidMyAuthUserId) return bkmpRaidMyAuthUserId;
  const client = typeof bkmpGetPlayerAuthClient === 'function' ? bkmpGetPlayerAuthClient() : null;
  if (!client) return null;
  try {
    const { data: sessionData } = await client.auth.getSession();
    bkmpRaidMyAuthUserId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  } catch (e) { bkmpRaidMyAuthUserId = null; }
  return bkmpRaidMyAuthUserId;
}
let bkmpRaidButtonTimer = null;
let bkmpRaidLoopTimer = null;
let bkmpRaidBossPollTimer = null;
let bkmpRaidParticipantsPollTimer = null;
let bkmpRaidResultShown = false;
let bkmpRaidClickTimestamps = bkmpAutoclickLoadTimestamps(BKMP_RAID_CLICK_HISTORY_KEY);
let bkmpRaidClickLockedUntil = bkmpAutoclickLoadNumber(BKMP_RAID_CLICK_LOCK_KEY);

function bkmpRaidGetPhaseInfo(now) {
  const d = now || new Date();
  const minute = d.getUTCMinutes();
  if (minute >= 55) {
    const fightStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1, 0, 0, 0));
    return { phase: 'prep', raidId: bkmpRaidCurrentId(fightStart), fightStartsAt: fightStart.getTime(), msUntilFightStart: fightStart.getTime() - d.getTime() };
  }
  const fightStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0));
  const fightEnd = fightStart.getTime() + 55 * 60000;
  return { phase: 'fight', raidId: bkmpRaidCurrentId(fightStart), fightStartsAt: fightStart.getTime(), fightEndsAt: fightEnd, msUntilFightEnd: fightEnd - d.getTime() };
}

/* Spieler-Wunsch (17.07.): der staendliche Weltboss-Raid ueberschnitt sich
   in der 20-Uhr-Stunde (Europe/Berlin) mit dem taeglich fest um 20 Uhr
   laufenden Gildenboss (siehe bkmpGuildBossGetPhaseInfo) - beide buhlten
   um dieselbe Aufmerksamkeit. Der Raid faellt jetzt genau in dieser einen
   Stunde jeden Tag aus (alle anderen 23 Stunden laufen unveraendert
   weiter), damit der Fokus auf dem Gildenboss liegt. Berlin-Stunde statt
   UTC-Stunde, DST-sicher, gleiches Muster wie bkmpGuildBossBerlinDateAt.

   FEHLER-FIX (Spieler-Report per Screenshot 15.07.: "Es sollte doch jetzt
   Gilden Boss sein? bin verwirrt" - beide Banner ("Raidboss erscheint
   gleich" UND "Gildenboss-Vorbereitung") gleichzeitig sichtbar): dieser
   Check verglich bisher nur "Stunde === 20", die Gildenboss-Vorbereitung
   (siehe bkmpGuildBossGetPhaseInfo) faengt aber schon um 19:55 an - fuenf
   Minuten lang war das hier also noch Stunde 19 und lieferte faelschlich
   false, obwohl der Gildenboss sich schon in der Vorbereitung befand.
   Jetzt ueber Minuten-des-Tages verglichen (19:55 bis 21:00), exakt
   deckungsgleich mit dem tatsaechlichen Gildenboss-Fenster (prep+fight)
   statt nur dessen Kampf-Phase. */
/* Spieler-Report (15.07., "Warum kommt die Meldung eigentlich jetzt? Die
   haette um 19:55->20:00 kommen sollen"): beide Aufrufer unten riefen
   diese Funktion bisher OHNE Argument auf, sie prüfte also immer die
   AKTUELLE Uhrzeit. Beide Aufrufer laufen aber ausschliesslich waehrend
   der Vorbereitungsphase (info.phase === 'prep', taeglich jeweils :55-:59
   JEDER Stunde) - um 20:55-20:59 (Vorbereitung fuer den ganz normalen
   21-Uhr-Raid) liegt "jetzt" ebenfalls noch im 19:55-21:00-Fenster, die
   Funktion lieferte also faelschlich true und unterdrueckte Button-Glow
   und zeigte das "Weltboss pausiert"-Banner fuer einen Raid, der gar
   nicht pausiert. Jetzt uebergeben beide Aufrufer stattdessen den
   Start-Zeitpunkt DES RAIDS, fuer den gerade vorbereitet wird
   (info.fightStartsAt) - nur DESSEN Stunde entscheidet, nicht "jetzt". */
function bkmpRaidIsGuildBossHourBerlin(now) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, hour: '2-digit', minute: '2-digit' })
    .formatToParts(now || new Date()).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  const minutesOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  return minutesOfDay >= 19 * 60 + 55 && minutesOfDay < 21 * 60;
}

function bkmpRaidFormatCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function bkmpRaidHasJoined(raidId) {
  try { return localStorage.getItem(BKMP_RAID_JOINED_KEY_PREFIX + raidId) === '1'; } catch (e) { return false; }
}
function bkmpRaidMarkJoined(raidId) {
  try { localStorage.setItem(BKMP_RAID_JOINED_KEY_PREFIX + raidId, '1'); } catch (e) {}
  bkmpRaidJoinedId = raidId;
}

/* FEHLER-FIX (Spieler-Report 14.07.: "Er hat gerade den Welt-Raidboss
   gemacht, aber wurde im [OBS-]Overlay nicht angezeigt") - der Beitritt
   wurde bisher AUSSCHLIESSLICH per localStorage-Flag erkannt
   (bkmpRaidHasJoined oben). localStorage ist NICHT geteilt zwischen dem
   normalen Browser (wo "Jetzt beitreten" geklickt wurde) und dem OBS-
   Browser-Source-Prozess (idle-stream.html/idle-stream-mini.html) - selbst
   wenn dort der GLEICHE Account eingeloggt ist, sieht der eigene
   Chromium-Prozess von OBS diesen Flag nie. Die Kampfansicht blieb dadurch
   im Overlay unsichtbar, obwohl der Account serverseitig laengst als
   Teilnehmer registriert war.
   Fix: einmalig pro Raid-ID (bkmpRaidServerJoinCheckedFor als Sperre -
   kein Wiederholungs-Polling, um kein zusaetzliches Egress zu erzeugen)
   serverseitig bei raid_participants nachfragen und den lokalen Flag bei
   Treffer selbst heilen (bkmpRaidMarkJoined) - der naechste Sekunden-Tick
   von bkmpRaidUpdateButtonState sieht dann ganz normal "beigetreten". */
let bkmpRaidServerJoinCheckedFor = null;
async function bkmpRaidSyncJoinFlagFromServer(raidId) {
  if (!raidId || bkmpRaidServerJoinCheckedFor === raidId || bkmpRaidHasJoined(raidId)) return;
  bkmpRaidServerJoinCheckedFor = raidId;
  try {
    const participants = typeof loadRaidParticipants === 'function' ? await loadRaidParticipants(raidId) : [];
    const myName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName().trim().toLowerCase() : '';
    const alreadyJoined = myName && Array.isArray(participants) && participants.some(p => (p.displayName || '').trim().toLowerCase() === myName);
    if (alreadyJoined) bkmpRaidMarkJoined(raidId);
  } catch (e) {
    /* Netzwerkfehler - naechster Phasenwechsel/Seitenaufruf versucht es
       erneut, deshalb die Sperre wieder freigeben statt dauerhaft zu blocken. */
    bkmpRaidServerJoinCheckedFor = null;
  }
}

/* ---------------- Button-Feuer/Glow (laeuft immer, auch ohne offenes Fenster) ---------------- */
function bkmpRaidFormatParticipantCount(count) {
  return count > 0 ? `${count} Spieler bereits angemeldet` : 'Sei der/die Erste, die beitritt!';
}

/* Laeuft 1x/Sekunde global (auch ohne offenes Idle-Dorf-Fenster) - zwei
   Aufgaben: 1) Button-Feuer/Countdown immer aktuell halten, 2) falls das
   Beitritts-Banner gerade offen ist, dessen Countdown live weiterzaehlen
   und automatisch in die Kampfansicht wechseln, sobald die
   Vorbereitungsphase endet - vorher blieb der Countdown bei laenger
   geoeffnetem Fenster einfach auf dem Stand beim Oeffnen stehen. */
function bkmpRaidUpdateButtonState() {
  if (bkmpIdleMaintenanceActive) return;
  const btn = document.getElementById('idleDorfButton');
  const countdownEl = document.getElementById('raidBtnCountdown');
  const info = bkmpRaidGetPhaseInfo();
  if (info.raidId && (info.phase === 'prep' || info.phase === 'fight')) {
    bkmpRaidSyncJoinFlagFromServer(info.raidId);
  }
  if (btn) {
    if (info.phase === 'prep' && !bkmpRaidIsGuildBossHourBerlin(new Date(info.fightStartsAt))) {
      btn.classList.add('raid-prep');
      if (countdownEl) { countdownEl.style.display = ''; countdownEl.textContent = '🔥 ' + bkmpRaidFormatCountdown(info.msUntilFightStart); }
    } else {
      btn.classList.remove('raid-prep');
      if (countdownEl) countdownEl.style.display = 'none';
    }
  }

  /* FEHLER-FIX (Spieler-Wunsch 13.07.: "wenn der stuendliche Boss kommt,
     soll das direkt im schon offenen Idle-Fenster erscheinen, nicht erst
     nach dem Schliessen+Neuoeffnen") - das Banner wurde bisher NUR beim
     (Wieder-)Oeffnen des Fensters gebaut (bkmpRaidRenderJoinBanner() lief
     nur einmal in bkmpIdleOpenModal()). War das Fenster schon offen, als
     die Vorbereitungsphase begann, existierte #raidBannerCountdown (wird
     erst BEIM Bauen des Banners per innerHTML erzeugt) noch nicht - der
     naechste Check unten brach dann sofort per early-return ab, ohne das
     Banner je zu erzeugen. Deshalb hier VOR diesem Check: beim Wechsel in
     die Vorbereitungsphase, waehrend das Fenster offen ist, aber das
     Banner noch nicht gebaut wurde, einmalig nachholen.

     NACHBESSERUNG (Spieler-Report 16.07.: "Das Banner kam erst nach dem
     Reload der Seite - das soll wieder voll automatisch auftauchen"):
     der urspruengliche Fix pruefte "existiert #raidBannerCountdown schon"
     als Ersatz fuer "wurde das Banner fuer DIESE Vorbereitungsphase schon
     gebaut" - das Element wird aber beim Phasenwechsel prep->fight weiter
     unten nur versteckt (banner.style.display = 'none'), NIE aus dem DOM
     entfernt. Ab der ZWEITEN Vorbereitungsphase in derselben Sitzung
     existierte #raidBannerCountdown also bereits als Ueberbleibsel der
     vorherigen Stunde - der Nachhol-Aufruf feuerte nie wieder, das Banner
     blieb unsichtbar (nur der Countdown-Text lief im Verborgenen weiter,
     siehe bannerCountdownEl.textContent unten). Jetzt direkt die
     tatsaechliche Sichtbarkeit des Banners geprueft statt der Existenz
     eines Kindelements, das den Phasenwechsel gar nicht ueberlebt. */
  const raidBanner = document.getElementById('raidJoinBanner');
  if (bkmpIdleModalOpen && info.phase === 'prep' && raidBanner && raidBanner.style.display === 'none') {
    bkmpRaidRenderJoinBanner();
  }

  const bannerCountdownEl = document.getElementById('raidBannerCountdown');
  if (!bannerCountdownEl) return;
  if (info.phase === 'prep') {
    bannerCountdownEl.textContent = bkmpRaidFormatCountdown(info.msUntilFightStart);
    return;
  }
  const banner = document.getElementById('raidJoinBanner');
  if (banner) banner.style.display = 'none';
  /* Nur EINMAL beim Phasenwechsel prep->fight in die Kampfansicht starten,
     nicht bei jedem Sekunden-Tick erneut - bkmpRaidStartCombatView raeumt
     ueber bkmpRaidStartLoops() die laufenden Intervalle (Boss-Poll 1.5s,
     eigener Schaden-Tick 2.5s) ab und setzt sie neu. Ohne diese Sperre
     wurden beide Intervalle jede Sekunde vor ihrer Faelligkeit wieder
     geloescht und neu gestartet und sind dadurch NIE gefeuert - kompletter
     Kampf-Stillstand trotz aktiver Teilnehmer. */
  if (bkmpRaidLoopTimer) return;
  bkmpUnsubscribeFromRaidInstance();
  if (bkmpIdleModalOpen && bkmpRaidShouldShowCombatView()) {
    bkmpIdleStopLoop();
    bkmpRaidStartCombatView(info.raidId);
  }
}

/* ---------------- Beitritts-Banner (Idle-Dorf-Fenster, Vorbereitungsphase) ---------------- */
function bkmpRaidHandlePrepRealtimeChange(change) {
  if (change.type !== 'instance' || !change.row) return;
  const countEl = document.getElementById('raidBannerParticipants');
  if (countEl) countEl.textContent = bkmpRaidFormatParticipantCount(Number(change.row.participant_count || 0));
}

/* Phase 7.1 Stufe 3 (21.07., Nutzer-Auftrag "Raidboss-Banner drastisch
   verkleinern"): sessionStorage-Flag pro Raid-ID (nicht global) - ein
   minimiertes Banner bleibt fuer DIESE Vorbereitungsphase minimiert, ein
   NEUER Raidboss (neue raidId) zeigt den Hinweis automatisch wieder voll
   an, wie im Auftrag verlangt ("keine wichtige Raidbossmeldung dauerhaft
   verstecken"). Reiner Anzeige-Zustand, keine Aenderung an Timer/Beitritt. */
function bkmpRaidBannerMinimizeKey(raidId) { return 'bkmpRaidBannerMin_' + raidId; }
function bkmpRaidBannerIsMinimized(raidId) {
  try { return sessionStorage.getItem(bkmpRaidBannerMinimizeKey(raidId)) === '1'; } catch (e) { return false; }
}
function bkmpRaidBannerSetMinimized(raidId, minimized) {
  try { sessionStorage.setItem(bkmpRaidBannerMinimizeKey(raidId), minimized ? '1' : '0'); } catch (e) {}
  const banner = document.getElementById('raidJoinBanner');
  if (banner) banner.classList.toggle('raid-join-banner-minimized', minimized);
  const btn = document.getElementById('raidBannerMinimizeBtn');
  if (btn) { btn.textContent = minimized ? '⌃' : '⌄'; btn.setAttribute('aria-expanded', String(!minimized)); btn.title = minimized ? 'Raidboss-Hinweis ausklappen' : 'Raidboss-Hinweis minimieren'; }
}

async function bkmpRaidRenderJoinBanner() {
  const banner = document.getElementById('raidJoinBanner');
  if (!banner) return;
  const info = bkmpRaidGetPhaseInfo();
  if (info.phase !== 'prep') { banner.style.display = 'none'; return; }
  if (bkmpRaidIsGuildBossHourBerlin(new Date(info.fightStartsAt))) {
    banner.style.display = '';
    banner.className = 'raid-join-banner';
    banner.innerHTML = `<span class="raid-join-banner-icon" aria-hidden="true">🛡️</span><span class="raid-join-banner-title">Weltboss pausiert diese Stunde - Fokus liegt auf dem Gildenboss um 20 Uhr!</span>`;
    return;
  }

  const joined = bkmpRaidHasJoined(info.raidId);
  const minimized = bkmpRaidBannerIsMinimized(info.raidId);
  banner.style.display = '';
  banner.className = 'raid-join-banner' + (minimized ? ' raid-join-banner-minimized' : '');
  /* Einzeilige Kompakt-Leiste statt bisherigem Hero-Banner: Icon, Titel+
     Teilnehmerzahl in EINEM Textblock (statt eigener .raid-join-banner-
     participants-Zeile mit "flex-basis:100%" - genau das hat bisher immer
     eine dritte Zeile erzwungen, egal wie viel Platz noch da war), dann
     Countdown, dann Beitreten-Button, dann Minimieren-Schalter. Dieselben
     drei Element-IDs (raidBannerCountdown/raidBannerParticipants/
     raidJoinBtn) bleiben erhalten - die bestehende Tick-/Teilnehmerzahl-
     Aktualisierung (siehe weiter oben in dieser Datei) greift unveraendert
     darauf zu, nur die umgebende Struktur ist neu. */
  banner.innerHTML = `
    <button type="button" class="raid-join-banner-minimize" id="raidBannerMinimizeBtn" aria-label="Raidboss-Hinweis minimieren" aria-expanded="${minimized ? 'false' : 'true'}" title="${minimized ? 'Raidboss-Hinweis ausklappen' : 'Raidboss-Hinweis minimieren'}">${minimized ? '⌃' : '⌄'}</button>
    <span class="raid-join-banner-icon" aria-hidden="true">🐉</span>
    <span class="raid-join-banner-text">
      <span class="raid-join-banner-title">Raidboss startet bald</span><span class="raid-join-banner-participants" id="raidBannerParticipants"></span>
    </span>
    <span class="raid-join-banner-countdown" id="raidBannerCountdown">${bkmpRaidFormatCountdown(info.msUntilFightStart)}</span>
    ${joined
      ? '<span class="raid-join-banner-joined">✅ Angemeldet</span>'
      : '<button type="button" class="btn-ja raid-join-banner-btn" id="raidJoinBtn">Beitreten</button>'}
  `;
  const joinBtn = document.getElementById('raidJoinBtn');
  if (joinBtn) joinBtn.addEventListener('click', () => bkmpRaidJoin(info.raidId));
  const minimizeBtn = document.getElementById('raidBannerMinimizeBtn');
  if (minimizeBtn) minimizeBtn.addEventListener('click', () => bkmpRaidBannerSetMinimized(info.raidId, !bkmpRaidBannerIsMinimized(info.raidId)));

  /* Live-Updates fuer die Teilnehmerzahl waehrend das Banner offen bleibt -
     vorher wurde die Zahl nur EINMAL beim Oeffnen geladen und blieb dann
     stehen, waehrend in Wirklichkeit laufend weitere Spieler beitraten. */
  bkmpSubscribeToRaidInstance(info.raidId, bkmpRaidHandlePrepRealtimeChange);

  try {
    const state = await loadRaidState(info.raidId);
    const countEl = document.getElementById('raidBannerParticipants');
    if (countEl && state) countEl.textContent = bkmpRaidFormatParticipantCount(state.participantCount);
  } catch (e) { /* Raid existiert evtl. noch nicht - kein Problem, erster Beitritt legt sie an */ }
}

async function bkmpRaidJoin(raidId) {
  const joinBtn = document.getElementById('raidJoinBtn');
  if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = 'Wird beigetreten...'; }
  try {
    await joinRaid(raidId);
    bkmpRaidMarkJoined(raidId);
    bkmpRaidRenderJoinBanner();
    bkmpRaidRefreshAchievementCache();
  } catch (e) {
    /* UX-Konsistenz (Raidboss-Neu-Durchtest 15.07.): einziger verbliebener
       native alert() im ganzen Gildenboss/Raidboss-Fehlerpfad - wirkt
       neben den sonst ueberall verwendeten Toasts (bkmpShowJannikToast)
       deplatziert/blockierend. */
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e && e.message ? e.message : 'Beitritt fehlgeschlagen. Bitte versuche es erneut.', 4200);
    else alert(e && e.message ? e.message : 'Beitritt fehlgeschlagen. Bitte versuche es erneut.');
    if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Jetzt beitreten'; }
  }
}

/* ---------------- Gemeinsame Kampfansicht ---------------- */
function bkmpRaidShouldShowCombatView() {
  const info = bkmpRaidGetPhaseInfo();
  return info.phase === 'fight' && bkmpRaidHasJoined(info.raidId) && bkmpRaidJoinedId !== 'ended-' + info.raidId;
}

function bkmpRaidToggleCombatView(show) {
  const tabs = document.getElementById('idleDorfTabs');
  const combatView = document.getElementById('raidCombatView');
  const panels = document.querySelectorAll('#idleDorfOverlay .idle-dorf-panel:not(#raidCombatView)');
  /* Bug-Fix 19.07. (Spieler-Meldung: nach Schliessen+Wiederoeffnen des
     Idle-Dorf-Fensters zeigen sich ploetzlich ZWEI Tableisten uebereinander,
     erst ein Seiten-Reload behebt es): bkmpIdleCloseModal() ruft IMMER
     bkmpRaidStopCombatView() -> hier show=false, unabhaengig davon, ob
     ueberhaupt je ein Raid-Kampf lief. Das alte ''-Zuruecksetzen hat damit
     bei JEDEM Schliessen die alte, kategorisierte #idleDorfTabs-Leiste
     wieder sichtbar gemacht, die Prototyp 2 (bkmp-proto-compact-hud.js)
     beim Laden per style.display='none' dauerhaft durch die kompakte
     Nav-Leiste ersetzt hatte - beide lagen danach uebereinander. Jetzt faellt
     der "nicht im Kampf"-Zustand auf 'none' zurueck, wenn der Prototyp
     aktiv ist (er verwaltet #idleDorfTabs exklusiv), statt das '' immer
     bedingungslos zurueckzugeben. */
  const compactHudActive = typeof BKMP_PROTO_COMPACT_HUD_ENABLED !== 'undefined' && BKMP_PROTO_COMPACT_HUD_ENABLED;
  if (tabs) tabs.style.display = show ? 'none' : (compactHudActive ? 'none' : '');
  if (combatView) combatView.style.display = show ? '' : 'none';
  panels.forEach(p => { if (show) p.style.display = 'none'; });
  if (!show) {
    const activeTab = bkmpIdleTabs.find(t => t.id === bkmpIdleActiveTab);
    const p = activeTab ? document.getElementById(activeTab.panel) : null;
    if (p) p.style.display = '';
  }
}

async function bkmpRaidStartCombatView(raidId) {
  bkmpRaidResultShown = false;
  const resultCard = document.getElementById('raidResultCard');
  const battlefield = document.getElementById('raidBattlefield');
  if (resultCard) resultCard.style.display = 'none';
  if (battlefield) battlefield.style.display = '';
  bkmpRaidToggleCombatView(true);
  bkmpRaidEnsureMyAuthUserId();
  try {
    bkmpRaidState = await loadRaidState(raidId);
    bkmpRaidParticipants = await loadRaidParticipants(raidId);
  } catch (e) {
    console.warn('Raid: Zustand konnte nicht geladen werden.', e);
  }
  /* Der Raid kann laengst zuende sein, ohne dass dieser Client das live
     mitbekommen hat (Fenster war zu, als der Sieg/die Niederlage passiert
     ist - bkmpRaidJoinedId wird nur bei einem live beobachteten Ende auf
     'ended-...' gesetzt, siehe bkmpRaidCheckOutcome). Nur ein WIRKLICH
     abgeschlossener Status (won/lost/expired) zaehlt hier als "vorbei" -
     'prep' NICHT, denn der Serverwechsel prep->fighting passiert erst beim
     ERSTEN Aufruf von raid_boss_attack_tick() (siehe bkmpRaidBossPoll,
     gestartet unten via bkmpRaidStartLoops). Genau am Stundenwechsel steht
     die DB-Zeile fuer die ersten paar hundert Millisekunden also noch auf
     'prep', obwohl die Kampfzeit laut Uhr laengst begonnen hat. Wuerde
     dieser Fall hier faelschlich als "schon vorbei" gewertet, bricht der
     JEWEILS ERSTE Client sofort ab, bevor er ueberhaupt raid_boss_attack_tick
     aufrufen konnte - der Statuswechsel passiert dann NIE, und der Raid
     haengt fuer alle Spieler dauerhaft in 'prep' fest (genau das Symptom
     "Kampf beginnt und schliesst sich direkt wieder"). */
  const raidTerminalStatus = bkmpRaidState && (bkmpRaidState.status === 'won' || bkmpRaidState.status === 'lost' || bkmpRaidState.status === 'expired');
  if (raidTerminalStatus) {
    bkmpRaidJoinedId = 'ended-' + raidId;
    bkmpRaidToggleCombatView(false);
    /* Derselbe Loop-Neustart wie in bkmpRaidCheckOutcome, aber fuer einen
       anderen Fall: dort wird ein Raid-Ende live mitverfolgt (Fenster war
       die ganze Zeit offen). Hier oeffnet der Spieler das Idle-Dorf-Fenster
       NEU (oder erneut), nachdem ein Raid, dem er beigetreten war, LAENGST
       zuende ist, ohne dass dieser Client das live mitbekommen hat -
       bkmpIdleOpenModal stoppt den normalen Kampf-Loop bereits VOR diesem
       Aufruf (weil bkmpRaidShouldShowCombatView() faelschlich noch true
       liefert, solange bkmpRaidJoinedId nicht auf 'ended-...' steht), aber
       niemand startet ihn hier wieder - das Idle-Dorf-Fenster oeffnet sich
       dann zwar normal, der automatische Tick bleibt aber fuer den Rest der
       Sitzung tot ("nichts passiert", genau das gemeldete Symptom). */
    if (bkmpIdleModalOpen) bkmpIdleStartLoop();
    return;
  }
  bkmpRaidRenderCombat();
  bkmpSubscribeToRaidInstance(raidId, bkmpRaidHandleRealtimeChange);
  bkmpRaidStartLoops(raidId);
}

function bkmpRaidStopCombatView() {
  bkmpRaidToggleCombatView(false);
  bkmpRaidStopLoops();
  bkmpUnsubscribeFromRaidInstance();
  /* Der normale Auto-Kampf-Loop wurde beim Betreten der Raid-Ansicht
     gestoppt (bkmpIdleStopLoop, siehe bkmpIdleOpenModal/bkmpRaidUpdateButtonState)
     und muss beim Verlassen wieder anlaufen, sonst bleiben automatische
     Angriffe/Animationen fuer den Rest der Sitzung tot (nur manuelle Klicks
     funktionieren noch, da die eigenstaendig sind) - nur, wenn das
     Idle-Dorf-Fenster ueberhaupt noch offen ist (bkmpIdleCloseModal setzt
     bkmpIdleModalOpen VOR diesem Aufruf bereits auf false und stoppt den
     Loop selbst schon explizit). */
  if (bkmpIdleModalOpen) bkmpIdleStartLoop();
}

function bkmpRaidHandleRealtimeChange(change) {
  if (!bkmpRaidState) return;
  if (change.type === 'instance' && change.row) {
    bkmpRaidState.bossHp = Number(change.row.boss_hp || 0);
    bkmpRaidState.cityHp = Number(change.row.city_hp || 0);
    bkmpRaidState.cityAttack = Number(change.row.city_attack || bkmpRaidState.cityAttack || 0);
    bkmpRaidState.cityDefense = Number(change.row.city_defense || bkmpRaidState.cityDefense || 0);
    bkmpRaidState.status = change.row.status;
    bkmpRaidState.participantCount = Number(change.row.participant_count || 0);
    bkmpRaidRenderCombat();
    bkmpRaidCheckOutcome();
  } else if (change.type === 'participants' && bkmpRaidState) {
    /* Eingehende Zeile direkt einsortieren statt bei JEDEM Tick JEDES
       Mitspielers die komplette Liste neu von der DB zu laden - vermeidet
       die Ruckler/kurzen Rueckspruenge auf veraltete Werte, die durch
       ueberholende parallele Refetches entstanden sind. Nur bei
       unerwartetem Payload-Format (z. B. DELETE ohne "new"-Zeile) auf
       einen echten Refetch zurueckfallen. */
    const row = change.row;
    if (row && row.auth_user_id) {
      const mapped = {
        authUserId: row.auth_user_id,
        displayName: row.display_name,
        damageDealt: Number(row.damage_dealt || 0),
        critsLanded: Number(row.crits_landed || 0),
        clicksLanded: Number(row.clicks_landed || 0),
        joinedAt: row.joined_at ? Date.parse(row.joined_at) : 0
      };
      const idx = bkmpRaidParticipants.findIndex(p => p.authUserId === mapped.authUserId);
      if (idx >= 0) bkmpRaidParticipants[idx] = mapped; else bkmpRaidParticipants.push(mapped);
      bkmpRaidParticipants.sort((a, b) => b.damageDealt - a.damageDealt);
      bkmpRaidRequestParticipantsRender();
    } else {
      loadRaidParticipants(bkmpRaidState.id).then(rows => { bkmpRaidParticipants = rows; bkmpRaidRequestParticipantsRender(); }).catch(() => {});
    }
  }
}

function bkmpRaidRenderCombat() {
  if (!bkmpRaidState) return;
  const nameEl = document.getElementById('raidBossName');
  if (nameEl) nameEl.textContent = `👑 ${bkmpRaidState.bossName || 'Weltboss'}`;
  const bossFill = document.getElementById('raidBossHpFill');
  const bossLabel = document.getElementById('raidBossHpLabel');
  if (bossFill) bossFill.style.width = Math.max(0, Math.min(100, (bkmpRaidState.bossHp / Math.max(1, bkmpRaidState.bossMaxHp)) * 100)) + '%';
  if (bossLabel) bossLabel.textContent = `${bkmpIdleFormatNumber(bkmpRaidState.bossHp)} / ${bkmpIdleFormatNumber(bkmpRaidState.bossMaxHp)}`;
  const cityFill = document.getElementById('raidCityHpFill');
  const cityLabel = document.getElementById('raidCityHpLabel');
  if (cityFill) cityFill.style.width = Math.max(0, Math.min(100, (bkmpRaidState.cityHp / Math.max(1, bkmpRaidState.cityMaxHp)) * 100)) + '%';
  if (cityLabel) cityLabel.textContent = `${bkmpIdleFormatNumber(bkmpRaidState.cityHp)} / ${bkmpIdleFormatNumber(bkmpRaidState.cityMaxHp)}`;
  const cityStatsEl = document.getElementById('raidCityStats');
  if (cityStatsEl) cityStatsEl.textContent = `⚔️ ${bkmpIdleFormatNumber(bkmpRaidState.cityAttack || 0)} · 🛡️ ${bkmpIdleFormatNumber(bkmpRaidState.cityDefense || 0)}`;
  const timerEl = document.getElementById('raidCombatTimer');
  if (timerEl) {
    const info = bkmpRaidGetPhaseInfo();
    timerEl.textContent = info.phase === 'fight' ? '⏳ ' + bkmpRaidFormatCountdown(info.msUntilFightEnd) : '';
  }
  /* App-Modus (Phase 16): Tap-Schaden-Zaehler pro Raid zuruecksetzen
     (neue Raid-Id seit letztem Render = neuer Kampf) und zusammen mit
     der Ressourcen-Leiste rendern - beides rein lesend aus bereits
     vorhandenem State, auf der Website ohne Wirkung (Elemente existieren
     dort nicht). */
  if (window.BKMP_APP_MODE) {
    if (bkmpRaidState.id !== bkmpRaidTapDamageSessionId) {
      bkmpRaidTapDamageSessionId = bkmpRaidState.id;
      bkmpRaidTapDamageSession = 0;
    }
    const tapVal = document.querySelector('#raidTapDamagePill .idle-res-val');
    if (tapVal) tapVal.textContent = bkmpIdleFormatNumber(bkmpRaidTapDamageSession);
    const strip = document.getElementById('raidRewardsStrip');
    if (strip && bkmpIdleState) {
      strip.innerHTML = `
        <span class="idle-res-chip idle-res-gold"><i class="idle-res-icon">💰</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.gold)}</b></span>
        <span class="idle-res-chip idle-res-wood"><i class="idle-res-icon">🌳</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.wood)}</b></span>
        <span class="idle-res-chip idle-res-stone"><i class="idle-res-icon">🗿</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.stone)}</b></span>
        <span class="idle-res-chip idle-res-crystal"><i class="idle-res-icon">💎</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.crystals)}</b></span>
        <span class="idle-res-chip idle-res-essence"><i class="idle-res-icon">🧪</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.essence)}</b></span>`;
    }
  }
  /* Ueber den Throttle statt direkt - bkmpRaidRenderCombat wird bei jedem
     eigenen Tick (2.5s), jedem Boss-Poll (1.5s) UND jedem Realtime-Update
     von ANDEREN Mitspielern aufgerufen. Ohne Throttle wurde die komplette
     Teilnehmerliste (innerHTML) dabei mehrfach pro Sekunde neu gebaut -
     sichtbare kurze Ruckler/Sprünge in der Schadensanzeige. */
  bkmpRaidRequestParticipantsRender();
}

let bkmpRaidParticipantsRenderTimer = null;
function bkmpRaidRequestParticipantsRender() {
  if (bkmpRaidParticipantsRenderTimer) return;
  bkmpRaidParticipantsRenderTimer = window.setTimeout(() => {
    bkmpRaidParticipantsRenderTimer = null;
    bkmpRaidRenderParticipants();
  }, 400);
}

/* Eigener Schaden kommt aus der raid_deal_damage-Antwort SOFORT (der
   Server hat ihn im selben Aufruf bereits berechnet) statt erst auf den
   Realtime-Roundtrip zu warten - bei mehreren gleichzeitig tickenden
   Mitspielern konnte die eigene Zahl sonst spuerbar hinterherhinken. */
function bkmpRaidApplyOwnDamageResult(result) {
  if (!result || result.ownDamageDealt == null) return;
  /* Primaer per authUserId matchen (siehe bkmpRaidMyAuthUserId-Kommentar
     oben) - derselbe Schluessel wie die Realtime-Aktualisierung fuer alle
     anderen Teilnehmer. Der Session-Check dahinter ist async und laeuft
     nicht garantiert VOR dem allerersten Tick durch, deshalb bleibt der
     Name-Abgleich als Fallback fuer dieses eine kurze Zeitfenster - sobald
     bkmpRaidMyAuthUserId bekannt ist, greift ab dann immer der robuste Weg. */
  const myUid = bkmpRaidMyAuthUserId;
  const myName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName().trim().toLowerCase() : '';
  const idx = myUid
    ? bkmpRaidParticipants.findIndex(p => p.authUserId === myUid)
    : (myName ? bkmpRaidParticipants.findIndex(p => p.displayName.trim().toLowerCase() === myName) : -1);
  if (idx >= 0) {
    bkmpRaidParticipants[idx].damageDealt = result.ownDamageDealt;
    bkmpRaidParticipants[idx].critsLanded = result.ownCritsLanded;
    bkmpRaidParticipants[idx].clicksLanded = result.ownClicksLanded;
    if (myUid) bkmpRaidParticipants[idx].authUserId = myUid;
  } else if (myName) {
    bkmpRaidParticipants.push({
      authUserId: myUid,
      displayName: bkmpGetMcName(),
      damageDealt: result.ownDamageDealt,
      critsLanded: result.ownCritsLanded,
      clicksLanded: result.ownClicksLanded,
      joinedAt: Date.now()
    });
  }
  bkmpRaidParticipants.sort((a, b) => b.damageDealt - a.damageDealt);
  bkmpRaidRequestParticipantsRender();
}

function bkmpRaidRenderParticipants() {
  const list = document.getElementById('raidParticipantsList');
  if (!list) return;
  const myName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName().trim().toLowerCase() : '';
  list.innerHTML = bkmpRaidParticipants.slice(0, 20).map(p => `
    <div class="raid-participant-row ${p.displayName.trim().toLowerCase() === myName ? 'is-me' : ''}">
      <span>${escapeHtml(p.displayName)}</span>
      <span>${bkmpIdleFormatNumber(p.damageDealt)} Schaden</span>
    </div>`).join('');
}

function bkmpRaidSpawnFx(className, targetId, amount, isCrit) {
  const field = document.getElementById('raidBattlefield');
  if (!field) return;
  const fx = document.createElement('span');
  fx.className = 'raid-fx ' + className;
  field.appendChild(fx);
  window.setTimeout(() => fx.remove(), 700);
  if (amount != null) {
    const target = document.getElementById(targetId);
    if (target) {
      const dmg = document.createElement('span');
      dmg.className = 'raid-dmg-float' + (isCrit ? ' raid-dmg-crit' : '');
      dmg.textContent = '-' + bkmpIdleFormatNumber(amount) + (isCrit ? '!' : '');
      target.appendChild(dmg);
      window.setTimeout(() => dmg.remove(), 900);
    }
  }
}
function bkmpRaidHitFlash(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.classList.remove('raid-hit-flash');
  void el.offsetWidth;
  el.classList.add('raid-hit-flash');
}

const BKMP_RAID_ATTACK_FX = ['raid-fx-arrow', 'raid-fx-fireball', 'raid-fx-lightning', 'raid-fx-magic'];

/* Performance (Nutzer-Auftrag, Section B Prioritaet 3 "Raidboss-Tick"):
   dasselbe Prinzip wie bkmpIdleCombatVisualsActive() in idledorf.js -
   Schaden/Server-Sync/Ergebnis-Logik laeuft immer unveraendert weiter
   (echte Spielwerte, RPC-Aufrufe), nur die rein visuellen FX/Render-
   Aufrufe pausieren, wenn niemand hinschauen kann. Die Raid-Kampfansicht
   ersetzt (anders als Kampf/Dungeon/Turm) das komplette Tab-Panel-System
   per eigenem Vollbild-Umschalter (bkmpRaidToggleCombatView) statt einen
   normalen Tab zu nutzen - deshalb hier die tatsaechliche DOM-Sichtbarkeit
   von #raidCombatView pruefen statt bkmpIdleActiveTab. */
function bkmpRaidVisualsActive() {
  const view = document.getElementById('raidCombatView');
  return bkmpIdleModalOpen === true && !!view && getComputedStyle(view).display !== 'none' && document.visibilityState === 'visible';
}

async function bkmpRaidOwnTick() {
  if (!bkmpRaidState || bkmpRaidState.status !== 'fighting' || !bkmpIdleEffectiveStats) return;
  const showVisuals = bkmpRaidVisualsActive();
  const roll = bkmpIdleDamageRoll(bkmpIdleEffectiveStats.attack, bkmpIdleEffectiveStats.critChance, bkmpIdleEffectiveStats.critDamage, 0);
  roll.amount = bkmpIdleApplyBossDamageBonus(roll.amount);
  if (showVisuals) {
    const fx = BKMP_RAID_ATTACK_FX[Math.floor(Math.random() * BKMP_RAID_ATTACK_FX.length)];
    bkmpRaidSpawnFx(fx, 'raidBoss', roll.amount, roll.isCrit);
    bkmpRaidHitFlash('raidBoss');
  }
  try {
    const result = await submitRaidDamage(bkmpRaidState.id, roll.amount, roll.isCrit, false);
    if (result) {
      bkmpRaidState.bossHp = result.bossHp; bkmpRaidState.status = result.status;
      bkmpRaidApplyOwnDamageResult(result);
      if (showVisuals) bkmpRaidRenderCombat();
      bkmpRaidCheckOutcome();
    }
  } catch (e) { /* naechster Tick versucht es erneut */ }
}

function bkmpRaidPlayBossAttackSprite() {
  const el = document.getElementById('raidBoss');
  if (!el) return;
  el.classList.remove('raid-boss-attacking');
  void el.offsetWidth;
  el.classList.add('raid-boss-attacking');
}

async function bkmpRaidBossPoll() {
  if (!bkmpRaidState) return;
  const showVisuals = bkmpRaidVisualsActive();
  try {
    const result = await tickRaidBossAttack(bkmpRaidState.id);
    if (result) {
      /* Gegen den vorherigen Stand vergleichen, nicht gegen cityMaxHp -
         sonst wuerde die Angriffs-FX/-Animation auf JEDEM Poll erneut
         feuern, sobald die Stadt einmal Schaden hat, statt nur bei einem
         tatsaechlich NEUEN Treffer in diesem Tick. */
      const prevCityHp = bkmpRaidState.cityHp;
      bkmpRaidState.cityHp = result.cityHp;
      bkmpRaidState.bossHp = result.bossHp;
      const changed = bkmpRaidState.status !== result.status;
      bkmpRaidState.status = result.status;
      if (showVisuals) {
        if (changed || result.cityHp < prevCityHp) {
          bkmpRaidSpawnFx('raid-fx-boss-attack', 'raidCity', null, false);
          bkmpRaidHitFlash('raidCity');
          bkmpRaidPlayBossAttackSprite();
        }
        bkmpRaidRenderCombat();
      }
      bkmpRaidCheckOutcome();
      return;
    }
    /* Bug-Report 17.07. (ChronoKora): nach Raid-Ende dauerhaft wiederkehrendes
       Ladesymbol + Netzwerk-Tab voller 400er auf raid_deal_damage/
       raid_boss_attack_tick. Ursache per Live-DB-Check bestaetigt: die RPC
       raid_deal_damage/raid_boss_attack_tick lehnt JEDEN Aufruf ab, sobald
       status != 'fighting' ist (siehe supabase-raid-boss-balance-v4.sql) -
       tickRaidBossAttack() schluckt diesen Fehler in supabase.js und gibt
       einfach null zurueck. Normalerweise erfaehrt der Client vom Raid-Ende
       ueber das Realtime-Abo auf raid_instances (bkmpRaidHandleRealtimeChange)
       - faellt dieses Update aber aus (WS-Aussetzer o.ae.), gab es bisher
       KEINEN Ausweg: beide Loops (Eigener-Schaden-Tick UND dieser Boss-Poll)
       liefen fuer den Rest der Sitzung leer weiter, alle paar Sekunden ein
       400 gegen Supabase, ohne dass der Spieler je das Ergebnis-Fenster sah.
       Deshalb hier ein direkter Zeilen-Read (loadRaidState, kein RPC, kann
       nicht an status='fighting' scheitern) als Fallback, sobald die RPC
       einmal null liefert - erkennt so auch ohne Realtime-Update zuverlaessig,
       dass der Raid vorbei ist, und beendet die Loops. */
    if (typeof loadRaidState === 'function') {
      const fallback = await loadRaidState(bkmpRaidState.id);
      if (fallback && fallback.status !== 'fighting') {
        bkmpRaidState.status = fallback.status;
        bkmpRaidState.bossHp = fallback.bossHp;
        bkmpRaidState.cityHp = fallback.cityHp;
        bkmpRaidRenderCombat();
        bkmpRaidCheckOutcome();
      }
    }
  } catch (e) { /* naechster Poll versucht es erneut */ }
}

function bkmpRaidHandleBossClick() {
  if (!bkmpRaidState || bkmpRaidState.status !== 'fighting' || !bkmpIdleEffectiveStats) return;
  const now = Date.now();
  if (now < bkmpRaidClickLockedUntil) return;

  bkmpRaidClickBurst = bkmpRaidClickBurst.filter(t => now - t <= BKMP_BURST_WINDOW_MS);
  bkmpRaidClickBurst.push(now);
  if (bkmpRaidClickBurst.length >= BKMP_BURST_CLICK_THRESHOLD) {
    bkmpRaidClickLockedUntil = now + BKMP_AUTOCLICK_LOCK_MS;
    bkmpRaidClickBurst = [];
    bkmpRaidClickTimestamps = [];
    bkmpAutoclickSaveNumber(BKMP_RAID_CLICK_LOCK_KEY, bkmpRaidClickLockedUntil);
    bkmpAutoclickSaveTimestamps(BKMP_RAID_CLICK_HISTORY_KEY, bkmpRaidClickTimestamps);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(BKMP_AUTOCLICK_TOAST, 3200);
    return;
  }

  if (now - bkmpRaidLastClickAt < BKMP_CLICK_RATE_CAP_MS) return;
  bkmpRaidLastClickAt = now;
  bkmpRaidClickTimestamps.push(now);
  bkmpRaidClickTimestamps = bkmpRaidClickTimestamps.filter(t => now - t <= BKMP_AUTOCLICK_HISTORY_MS).slice(-BKMP_AUTOCLICK_WINDOW);
  bkmpAutoclickSaveTimestamps(BKMP_RAID_CLICK_HISTORY_KEY, bkmpRaidClickTimestamps);
  if (bkmpIdleDetectAutoclickPattern(bkmpRaidClickTimestamps)) {
    bkmpRaidClickLockedUntil = now + BKMP_AUTOCLICK_LOCK_MS;
    bkmpRaidClickTimestamps = [];
    bkmpAutoclickSaveNumber(BKMP_RAID_CLICK_LOCK_KEY, bkmpRaidClickLockedUntil);
    bkmpAutoclickSaveTimestamps(BKMP_RAID_CLICK_HISTORY_KEY, bkmpRaidClickTimestamps);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(BKMP_AUTOCLICK_TOAST, 3200);
    return;
  }

  const isCrit = Math.random() * 100 < bkmpIdleEffectiveStats.critChance;
  const clickDamage = bkmpIdleApplyBossDamageBonus(Math.max(1, Math.round(bkmpIdleEffectiveStats.attack * (0.12 + (bkmpIdleEffectiveStats.clickDamagePct || 0) / 100) * (isCrit ? Math.max(1, bkmpIdleEffectiveStats.critDamage / 100) : 1))));
  bkmpRaidTapDamageSession += clickDamage;
  bkmpRaidSpawnFx('raid-fx-magic', 'raidBoss', clickDamage, isCrit);
  bkmpRaidHitFlash('raidBoss');
  submitRaidDamage(bkmpRaidState.id, clickDamage, isCrit, true).then(result => {
    if (result) { bkmpRaidState.bossHp = result.bossHp; bkmpRaidState.status = result.status; bkmpRaidApplyOwnDamageResult(result); bkmpRaidRenderCombat(); bkmpRaidCheckOutcome(); }
  }).catch(() => {});
}

/* Garantierte Grundlage fuer die Live-Anzeige ANDERER Spieler (siehe
   Kommentar bei BKMP_RAID_PARTICIPANTS_POLL_MS oben) - unabhaengig davon,
   ob das Realtime-Abo gerade zuverlaessig liefert. Einfacher lesender
   Select (loadRaidParticipants), kein RPC, daher kein Interaktions-Risiko
   mit dem parallel laufenden bkmpRaidBossPoll (eigener Timer, eigener
   Fehlerfall - ein Fehlschlag hier blockiert den naechsten Boss-Poll
   nicht und umgekehrt). */
async function bkmpRaidParticipantsPoll() {
  if (!bkmpRaidState) return;
  try {
    const rows = await loadRaidParticipants(bkmpRaidState.id);
    bkmpRaidParticipants = rows;
    bkmpRaidRequestParticipantsRender();
  } catch (e) { /* naechster Poll versucht es erneut */ }
}

function bkmpRaidStartLoops(raidId) {
  bkmpRaidStopLoops();
  bkmpRaidLoopTimer = window.setInterval(bkmpRaidOwnTick, BKMP_RAID_TICK_MS);
  bkmpRaidBossPollTimer = window.setInterval(bkmpRaidBossPoll, BKMP_RAID_BOSS_POLL_MS);
  bkmpRaidParticipantsPollTimer = window.setInterval(bkmpRaidParticipantsPoll, BKMP_RAID_PARTICIPANTS_POLL_MS);
}
function bkmpRaidStopLoops() {
  if (bkmpRaidLoopTimer) { window.clearInterval(bkmpRaidLoopTimer); bkmpRaidLoopTimer = null; }
  if (bkmpRaidBossPollTimer) { window.clearInterval(bkmpRaidBossPollTimer); bkmpRaidBossPollTimer = null; }
  if (bkmpRaidParticipantsPollTimer) { window.clearInterval(bkmpRaidParticipantsPollTimer); bkmpRaidParticipantsPollTimer = null; }
}

/* raid_finish() vergibt Gold/Kristalle/XP serverseitig atomar direkt in
   idle_player_state - der lokale bkmpIdleState weiss davon nichts. Der
   normale Autosave (bkmpIdleQueueSync -> upsertIdlePlayerState) schreibt den
   KOMPLETTEN lokalen Stand zurueck (kein atomares Increment), und feuert
   frueher oder spaeter sowieso wieder (naechster Drachenkill, Tab-Wechsel,
   Fenster schliessen). Ohne diesen Abgleich wuerde dieser naechste Autosave
   den serverseitig gutgeschriebenen Betrag mit dem veralteten lokalen Stand
   ueberschreiben - die Belohnung waere dann zwar kurz in der DB, aber sofort
   wieder weg, ohne dass irgendwo ein Fehler auftritt. */
async function bkmpRaidSyncIdleStateAfterFinish() {
  if (!bkmpIdleState) return;
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) return;
  try {
    const remote = typeof loadIdlePlayerState === 'function' ? await loadIdlePlayerState(name) : null;
    if (!remote) return;
    bkmpIdleState.gold = remote.gold;
    bkmpIdleState.total_gold_earned = remote.total_gold_earned;
    bkmpIdleState.crystals = remote.crystals;
    bkmpIdleState.xp = remote.xp;
    bkmpIdleRenderHud();
  } catch (e) { console.warn('Raid: Spielstand nach Raid-Ende nicht abgeglichen.', e); }
}

async function bkmpRaidCheckOutcome() {
  if (!bkmpRaidState || bkmpRaidResultShown) return;
  if (bkmpRaidState.status === 'fighting' || bkmpRaidState.status === 'prep') return;
  bkmpRaidResultShown = true;
  bkmpRaidJoinedId = 'ended-' + bkmpRaidState.id;
  bkmpRaidStopLoops();
  bkmpUnsubscribeFromRaidInstance();
  bkmpRaidShowResult();
  bkmpRaidRefreshAchievementCache();
  await bkmpRaidSyncIdleStateAfterFinish();
  /* Der normale Idle-Dorf-Kampf-Loop wurde beim Betreten des Raids gestoppt
     (siehe bkmpRaidUpdateButtonState) und wird bisher NUR wieder gestartet,
     wenn der Spieler die Kampfansicht manuell verlaesst (bkmpRaidStopCombatView).
     Endet ein Raid aber von selbst (gewonnen/verloren/abgelaufen), waehrend
     das Ergebnis-Fenster noch offen ist, lief dieser Pfad nie - der
     automatische Tick (und damit jeder Gegenschlag der Drachen) blieb fuer
     den Rest der Sitzung tot, nur Klicks funktionierten noch weiter (die
     ueberspringen den Gegenschlag grundsaetzlich, siehe bkmpIdleHandleDragonClick)
     - im Ergebnis liess sich jeder Drache nach einem Raid ohne jedes Risiko
     wegklicken, bis die Seite neu geladen wurde. Live von Spielern bestaetigt. */
  if (bkmpIdleModalOpen) bkmpIdleStartLoop();
}

/* Eigener Anteil exakt wie raid_finish() serverseitig rechnet (Schaden-
   Anteil * Belohnungs-Pool, siehe supabase-raid-boss-reward-share.sql) -
   gleiches Prinzip wie beim Gildenboss (bkmpGuildBossRenderParticipants).
   Nur Ressourcen mit einem Pool > 0 werden angezeigt (analog zu
   bkmpDungeonRewardParts). */
function bkmpRaidRewardSpans(state, mine, totalDamage) {
  const share = mine && totalDamage > 0 ? mine.damageDealt / totalDamage : 0;
  const parts = [];
  const add = (icon, pool) => {
    const amount = Math.round((pool || 0) * share);
    if (pool > 0) parts.push(`<span>${icon} +${bkmpIdleFormatNumber(amount)}</span>`);
  };
  add('💰', state.goldReward);
  add('💎', state.gemReward);
  add('✨', state.xpReward);
  add('🌳', state.woodReward);
  add('🗿', state.stoneReward);
  add('🧪', state.essenceReward);
  return parts.join('');
}

/* Nutzerwunsch 19.07.: "Anzeige nach dem Raidboss wieviel damage jeder hat
   zum ausklappen" - bisher zeigte das Ergebnis-Fenster nur den eigenen
   Schaden + den MVP-Namen, nicht die volle Teilnehmerliste. participants
   ist bereits nach Schaden sortiert (server-seitig, siehe loadRaidParticipants)
   - hier nur als ausklappbare Liste gerendert statt permanent Platz zu
   beanspruchen, analog zum bestehenden .achievement-category-Muster. */
function bkmpRaidResultParticipantsHTML(participants, totalDamage, mine) {
  if (!participants.length) return '';
  const rows = participants.map((p, i) => {
    const pct = totalDamage > 0 ? ((p.damageDealt / totalDamage) * 100).toFixed(1) : '0';
    return `<div class="raid-result-participant-row${p === mine ? ' is-me' : ''}">
      <span class="raid-result-participant-rank">#${i + 1}</span>
      <span class="raid-result-participant-name">${escapeHtml(p.displayName)}</span>
      <span class="raid-result-participant-damage">${bkmpIdleFormatNumber(p.damageDealt)} <small>(${pct}%)</small></span>
    </div>`;
  }).join('');
  return `
    <div class="raid-result-participants">
      <button type="button" class="raid-result-participants-toggle" id="raidResultParticipantsToggle" aria-expanded="false">
        <span class="raid-result-participants-toggle-icon">▸</span> Alle Teilnehmer anzeigen (${participants.length})
      </button>
      <div class="raid-result-participants-list" id="raidResultParticipantsList" style="display:none;">${rows}</div>
    </div>`;
}

async function bkmpRaidShowResult() {
  const resultCard = document.getElementById('raidResultCard');
  const battlefield = document.getElementById('raidBattlefield');
  const listEl = document.getElementById('raidParticipantsList');
  if (!resultCard) return;
  let participants = bkmpRaidParticipants;
  try { participants = await loadRaidParticipants(bkmpRaidState.id); } catch (e) {}
  const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '').trim().toLowerCase();
  const mine = participants.find(p => p.displayName.trim().toLowerCase() === myName);
  const myRank = mine ? participants.findIndex(p => p === mine) + 1 : 0;
  const mvp = participants[0];
  const won = bkmpRaidState.status === 'won';
  const flawless = won && bkmpRaidState.cityMaxHp > 0 && bkmpRaidState.cityHp >= bkmpRaidState.cityMaxHp;
  const totalDamage = participants.reduce((sum, p) => sum + p.damageDealt, 0);
  /* Persoenlicher Zerator-Belohnungscode: reine Abfrage einer serverseitig
     (raid_finish(), 5%-Wurf NUR bei echtem Sieg) bereits fertig erzeugten
     Zeile - der Client erzeugt hier nichts selbst, ein erneutes Aufrufen
     dieser Funktion (z.B. durch Neuladen der Seite waehrend das
     Ergebnis-Fenster noch offen ist) liefert daher zuverlaessig denselben
     Code statt einen neuen zu erzeugen. */
  let rewardCode = null;
  if (won && myName) {
    try { rewardCode = await loadRaidRewardCode(bkmpRaidState.id, myName); } catch (e) { console.warn('Raid: Belohnungscode konnte nicht geladen werden.', e); }
  }
  /* Zerathor-Dorf-Skin: kein Einloese-Code wie beim Pluschie (Dorf-Skins
     sind nicht handelbar) - raid_finish() hat den 1%-Wurf serverseitig
     schon direkt in idle_player_village_skins geschrieben, hier wird nur
     erkannt, ob der Skin GERADE NEU dazugekommen ist (Vergleich gegen den
     Stand von vor dem Raid), um die Bonus-Zeile unten anzuzeigen und
     bkmpPlayerVillageSkins/das Skins-Panel sofort zu aktualisieren, ohne
     dass der Spieler das Fenster neu oeffnen muss. */
  let newVillageSkin = false;
  if (won && myName && !bkmpPlayerVillageSkins.includes('zerathordorf')) {
    try {
      const owned = typeof loadPlayerVillageSkins === 'function' ? await loadPlayerVillageSkins(myName) : [];
      const ownedIds = Array.isArray(owned) ? owned.map(r => r.skin_id) : [];
      if (ownedIds.includes('zerathordorf')) {
        newVillageSkin = true;
        bkmpPlayerVillageSkins.push('zerathordorf');
      }
    } catch (e) { console.warn('Raid: Dorf-Skin-Beute konnte nicht geprueft werden.', e); }
  }
  if (battlefield) battlefield.style.display = 'none';
  if (listEl) listEl.style.display = 'none';
  resultCard.style.display = '';
  resultCard.innerHTML = `
    <div class="raid-result-title ${won ? 'won' : 'lost'}">${won ? '🏆 Raid gewonnen!' : bkmpRaidState.status === 'expired' ? '⌛ Raid abgelaufen' : '💀 Raid verloren'}</div>
    ${flawless ? '<div class="raid-result-flawless">🛡️ Perfekt! Die Stadt blieb unbeschadet.</div>' : ''}
    <div class="raid-result-stats">
      <div class="raid-result-stat"><div class="raid-result-stat-label">Gesamtschaden</div><div class="raid-result-stat-value">${bkmpIdleFormatNumber(totalDamage)}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Dein Schaden</div><div class="raid-result-stat-value">${bkmpIdleFormatNumber(mine ? mine.damageDealt : 0)}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Dein Rang</div><div class="raid-result-stat-value">${myRank ? '#' + myRank : '-'}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Deine Krits</div><div class="raid-result-stat-value">${mine ? mine.critsLanded : 0}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Deine Klicks</div><div class="raid-result-stat-value">${mine ? mine.clicksLanded : 0}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Teilnehmer</div><div class="raid-result-stat-value">${participants.length}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">MVP</div><div class="raid-result-stat-value raid-result-mvp">${mvp ? escapeHtml(mvp.displayName) : '-'}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">${won ? 'Stadt-HP übrig' : 'Boss-HP übrig'}</div><div class="raid-result-stat-value">${bkmpIdleFormatNumber(won ? bkmpRaidState.cityHp : bkmpRaidState.bossHp)}</div></div>
    </div>
    ${won ? `<div class="raid-result-rewards">${bkmpRaidRewardSpans(bkmpRaidState, mine, totalDamage)}</div><p class="admin-help-text" style="margin-top:-0.3rem;">Belohnung nach Schadensanteil (${totalDamage > 0 && mine ? ((mine.damageDealt / totalDamage) * 100).toFixed(1) : '0'}% des Gesamtschadens).</p>` : ''}
    ${bkmpRaidResultParticipantsHTML(participants, totalDamage, mine)}
    ${rewardCode ? `
    <div class="raid-result-zerator-code">
      <div class="raid-result-zerator-title">🎁 Plushie! Hier ist dein Code:</div>
      <div class="raid-result-zerator-code-row">
        <span class="raid-result-zerator-code-value" id="raidZeratorCodeValue">${escapeHtml(rewardCode.code)}</span>
        <button type="button" class="btn-nein" id="raidZeratorCodeCopyBtn">Kopieren</button>
      </div>
      <p class="raid-result-zerator-hint">Dieser Code kann nur einmal eingelöst werden – am besten gleich sichern.</p>
    </div>` : ''}
    ${newVillageSkin ? `
    <div class="raid-result-zerator-code">
      <div class="raid-result-zerator-title">🏘️ Seltene Beute! Du hast das Zerathor Dorf freigeschaltet.</div>
      <p class="raid-result-zerator-hint">Zu finden in den Dorf-Skins - dort einfach ausrüsten.</p>
    </div>` : ''}
    <button type="button" class="btn-ja" id="raidResultCloseBtn">Schließen</button>
  `;
  const copyBtn = document.getElementById('raidZeratorCodeCopyBtn');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const text = rewardCode ? rewardCode.code : '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { copyBtn.textContent = 'Kopiert!'; window.setTimeout(() => { copyBtn.textContent = 'Kopieren'; }, 1800); }).catch(() => {});
    }
  });
  const closeBtn = document.getElementById('raidResultCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    bkmpRaidStopCombatView();
    bkmpIdleRenderActiveTabContent();
  });
  const participantsToggle = document.getElementById('raidResultParticipantsToggle');
  const participantsList = document.getElementById('raidResultParticipantsList');
  if (participantsToggle && participantsList) participantsToggle.addEventListener('click', () => {
    const open = participantsList.style.display !== 'none';
    participantsList.style.display = open ? 'none' : '';
    participantsToggle.setAttribute('aria-expanded', String(!open));
    participantsToggle.querySelector('.raid-result-participants-toggle-icon').textContent = open ? '▸' : '▾';
  });
}

/* ---------------- Raid-Bestenliste (in idle-dorf-Bestenliste-Tab eingehaengt) ---------------- */
async function bkmpRaidRenderLeaderboard() {
  const listEl = document.getElementById('idleLeaderboardList');
  if (!listEl) return;
  listEl.innerHTML = '<p class="empty-hint">Lädt...</p>';
  let rows = [];
  try { rows = (await loadRaidLeaderboard()).filter(r => !bkmpIsHiddenTestAccount(r.displayName)); } catch (e) { console.warn('Raid: Bestenliste konnte nicht geladen werden.', e); }
  const field = bkmpIdleActiveLeaderboardTab.replace('raid_', '');
  const fieldMap = { damage: 'totalDamageDealt', bosses: 'totalBossesDefeated', joined: 'totalRaidsJoined', best: 'bestSingleRaidDamage' };
  const key = fieldMap[field] || 'totalDamageDealt';
  const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '').trim().toLowerCase();
  const sorted = rows.filter(r => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 100);
  if (!sorted.length) { listEl.innerHTML = '<p class="empty-hint">Noch keine Raid-Daten vorhanden.</p>'; return; }
  listEl.innerHTML = sorted.map((row, i) => {
    const isMe = Boolean(myName) && row.displayName.trim().toLowerCase() === myName;
    return bkmpLeaderboardRenderSimpleRow(i, row.displayName, bkmpIdleFormatNumber(row[key]), isMe);
  }).join('');
}

/* ---------------- Achievement-Kontext (fuer index.html, gleiches
   Cache-Muster wie bkmpIdleGetAchievementContextFields) ---------------- */
const BKMP_RAID_ACHIEVEMENT_CACHE_KEY = 'bkmp-raid-achievement-fields-cache';
function bkmpRaidGetAchievementContextFields() {
  return bkmpAchievementReadCache(BKMP_RAID_ACHIEVEMENT_CACHE_KEY, { raidsJoined: 0, raidBossesDefeated: 0, raidTotalDamage: 0, raidMvpCount: 0, raidFlawlessWins: 0, raidBestDamage: 0 });
}
async function bkmpRaidRefreshAchievementCache() {
  const client = typeof bkmpGetPlayerAuthClient === 'function' ? bkmpGetPlayerAuthClient() : null;
  if (!client) return;
  try {
    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
    if (!userId) return;
    const { data } = await client
      .from('raid_player_stats')
      .select('total_raids_joined, total_bosses_defeated, total_damage_dealt, total_mvp_count, total_flawless_wins, best_single_raid_damage')
      .eq('auth_user_id', userId)
      .limit(1);
    const row = Array.isArray(data) && data[0] ? data[0] : null;
    const fields = {
      raidsJoined: Number(row ? row.total_raids_joined : 0),
      raidBossesDefeated: Number(row ? row.total_bosses_defeated : 0),
      raidTotalDamage: Number(row ? row.total_damage_dealt : 0),
      raidMvpCount: Number(row ? row.total_mvp_count : 0),
      raidFlawlessWins: Number(row ? row.total_flawless_wins : 0),
      raidBestDamage: Number(row ? row.best_single_raid_damage : 0)
    };
    try { localStorage.setItem(BKMP_RAID_ACHIEVEMENT_CACHE_KEY, JSON.stringify(fields)); } catch (e) {}
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
  } catch (e) { /* Cache bleibt auf altem Stand */ }
}

/* ---------------- Init ---------------- */
function bkmpRaidInit() {
  bkmpRaidUpdateButtonState();
  window.setInterval(bkmpRaidUpdateButtonState, 1000);
  const bossEl = document.getElementById('raidBoss');
  if (bossEl) bossEl.addEventListener('click', bkmpRaidHandleBossClick);
}

/* ---------------- Weltboss/Raid: Erfolge (window.BKMP_RAID_ACHIEVEMENTS_EXTRA) ----------------
   Gleiches Einbinde-Muster wie BKMP_IDLE_ACHIEVEMENTS_EXTRA - wird per
   Spread direkt in BKMP_ACHIEVEMENTS (index.html, bkmpBuildAchievementsList)
   uebernommen und automatisch von Neu-Badge + Zeitstempel-System erfasst. */
window.BKMP_RAID_ACHIEVEMENTS_EXTRA = [
  { id: 'raid_first_join', category: 'Weltboss', title: 'Erster Raid', desc: 'Nimm an deinem ersten Weltboss-Raid teil.', check: ctx => ctx.raidsJoined >= 1 },
  { id: 'raid_first_boss', category: 'Weltboss', title: 'Erster Boss besiegt', desc: 'Besiege deinen ersten Weltboss.', check: ctx => ctx.raidBossesDefeated >= 1 },
  { id: 'raid_boss_10', category: 'Weltboss', title: 'Bossbezwinger', desc: 'Besiege 10 Weltbosse.', progress: ctx => [ctx.raidBossesDefeated, 10], check: ctx => ctx.raidBossesDefeated >= 10 },
  { id: 'raid_boss_100', category: 'Weltboss', title: 'Legendärer Drachenjäger', desc: 'Besiege 100 Weltbosse.', progress: ctx => [ctx.raidBossesDefeated, 100], check: ctx => ctx.raidBossesDefeated >= 100 },
  { id: 'raid_damage_1m', category: 'Weltboss', title: 'Ein Millionen Schaden', desc: 'Verursache insgesamt 1.000.000 Schaden in Weltboss-Raids.', progress: ctx => [ctx.raidTotalDamage, 1000000], check: ctx => ctx.raidTotalDamage >= 1000000 },
  { id: 'raid_mvp', category: 'Weltboss', title: 'MVP', desc: 'Sei der Spieler mit dem meisten Schaden in einem Raid.', check: ctx => ctx.raidMvpCount >= 1 },
  { id: 'raid_flawless', category: 'Weltboss', title: 'Ohne Niederlage gewonnen', desc: 'Gewinne einen Raid, ohne dass die Stadt Schaden nimmt.', check: ctx => ctx.raidFlawlessWins >= 1 }
];

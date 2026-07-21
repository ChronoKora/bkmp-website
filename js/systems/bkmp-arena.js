// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-arena.js


/* ---------------- Rendering: Arena-Tab (siehe supabase-idle-arena.sql) ----------------
   Asynchroner PvP-Kampf gegen die zuletzt synchronisierten Kampfwerte
   anderer Spieler - die eigentliche Kampfabwicklung (Rating-Aenderung,
   Gold-Belohnung) laeuft komplett serverseitig ueber arena_attack(), hier
   nur Anzeige + Angriffs-Button. bkmpArenaMyAuthUserId wird einmalig beim
   ersten Oeffnen des Tabs per Session-Check ermittelt (gleiches Muster wie
   bkmpRaidRefreshAchievementCache). */
let bkmpArenaMyAuthUserId = null;
let bkmpArenaMyRating = null;
let bkmpArenaOpponents = [];
let bkmpArenaRecentBattles = [];
let bkmpArenaLoaded = false;
let bkmpArenaLoading = false;
let bkmpArenaAttacking = null;

async function bkmpArenaEnsureMyAuthUserId() {
  if (bkmpArenaMyAuthUserId) return bkmpArenaMyAuthUserId;
  const client = typeof bkmpGetPlayerAuthClient === 'function' ? bkmpGetPlayerAuthClient() : null;
  if (!client) return null;
  try {
    const { data: sessionData } = await client.auth.getSession();
    bkmpArenaMyAuthUserId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  } catch (e) { bkmpArenaMyAuthUserId = null; }
  return bkmpArenaMyAuthUserId;
}

/* Erfolge-/Titel-Anbindung (gleiches Cache-Muster wie
   bkmpRaidGetAchievementContextFields/bkmpRaidRefreshAchievementCache) -
   arena_ratings.wins wird lokal gecacht, damit Erfolge/Titel auch offline
   ihren letzten bekannten Stand zeigen. */
const BKMP_ARENA_ACHIEVEMENT_CACHE_KEY = 'bkmp-arena-achievement-fields-cache';
function bkmpArenaGetAchievementContextFields() {
  return bkmpAchievementReadCache(BKMP_ARENA_ACHIEVEMENT_CACHE_KEY, { arenaWins: 0, arenaRating: 1000 });
}
async function bkmpArenaRefreshAchievementCache() {
  try {
    const rating = await bkmpArenaGetMyRating();
    const fields = { arenaWins: rating ? rating.wins : 0, arenaRating: rating ? rating.rating : 1000 };
    localStorage.setItem(BKMP_ARENA_ACHIEVEMENT_CACHE_KEY, JSON.stringify(fields));
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
  } catch (e) { /* offline/kein Login - alter Cache-Stand bleibt bestehen */ }
}

async function bkmpArenaLoadAll() {
  bkmpArenaLoading = true;
  const uid = await bkmpArenaEnsureMyAuthUserId();
  try {
    bkmpArenaMyRating = uid ? await bkmpArenaGetMyRating() : null;
    bkmpArenaOpponents = uid ? await bkmpArenaGetOpponents(uid, bkmpArenaMyRating ? bkmpArenaMyRating.rating : 1000, 8) : [];
    bkmpArenaRecentBattles = uid ? await bkmpArenaGetRecentBattles(uid, 15) : [];
  } catch (e) {
    console.warn('Arena-Daten konnten nicht geladen werden.', e);
  }
  bkmpArenaLoaded = true;
  bkmpArenaLoading = false;
}

/* Geschaetzte Gewinnchance (Spieler-Wunsch, Minecraft-Chat 21.07.,
   Lilith57: "ich mag nicht so gern raetselraten, ob ich wen schlagen
   kann") - exakt dieselbe Formel wie arena_attack() serverseitig
   (supabase-idle-arena.sql: Angriff zaehlt am meisten, HP/Verteidigung
   etwas weniger), damit die Anzeige nie von der tatsaechlichen Chance
   abweicht. Reiner Erwartungswert - der echte Kampf bleibt weiterhin
   ein Zufallswurf (random() < winChance), keine Garantie. */
function bkmpArenaPowerScore(attack, defense, hp) {
  return Math.max(1, Number(attack || 0) * 2 + Number(defense || 0) + Number(hp || 0) * 0.3);
}
function bkmpArenaEstimateWinChancePct(myPower, theirPower) {
  const chance = myPower / (myPower + theirPower);
  return Math.round(Math.max(0, Math.min(1, chance)) * 100);
}

function bkmpArenaFormatTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('de-DE'); } catch (e) { return ''; }
}

/* Kampfanimation (Spieler-Wunsch 14.07.: "Dorf gegen Dorf?") - rein
   kosmetisch: arena_attack() hat das Ergebnis schon serverseitig
   entschieden (ein einzelner RPC-Aufruf, kein Mehrfach-Tick-Kampf wie beim
   Weltboss-Raid), die Animation spielt nur eine plausible Annaeherung
   daran ab, bevor das Ergebnis final angezeigt wird. Gibt ein Promise
   zurueck, das nach Ende der Animation aufloest. */
function bkmpArenaPlayBattleAnimation(myName, opponentName, won, myVillageSkin, opponentVillageSkin) {
  return new Promise(resolve => {
    const overlay = document.getElementById('arenaBattleOverlay');
    if (!overlay) { resolve(); return; }
    const meFill = document.getElementById('arenaBattleMeHpFill');
    const oppFill = document.getElementById('arenaBattleOpponentHpFill');
    const resultEl = document.getElementById('arenaBattleResult');
    document.getElementById('arenaBattleMeName').textContent = myName || 'Du';
    document.getElementById('arenaBattleOpponentName').textContent = opponentName || 'Gegner';
    /* Jeder mit seinem eigenen ausgeruesteten Dorf-Skin (Spieler-Wunsch
       14.07.) - eigene Seite: Ownership-Check greift ganz normal, Gegner-
       Seite: Server-Angabe wird vertraut (siehe
       bkmpApplyVillageSkinToElement, checkOwnership:false). */
    bkmpApplyVillageSkinToElement(document.getElementById('arenaBattleMeSprite'), myVillageSkin);
    bkmpApplyVillageSkinToElement(document.getElementById('arenaBattleOpponentSprite'), opponentVillageSkin, { checkOwnership: false });
    meFill.style.width = '100%';
    oppFill.style.width = '100%';
    resultEl.textContent = ' ';
    overlay.classList.add('visible');

    const loserFill = won ? oppFill : meFill;
    const loserId = won ? 'arenaBattleOpponent' : 'arenaBattleMe';
    const winnerFill = won ? meFill : oppFill;
    const winnerId = won ? 'arenaBattleMe' : 'arenaBattleOpponent';
    const winnerFinalPct = 30 + Math.round(Math.random() * 40);
    const ticks = 5;
    let tick = 0;
    const spawnDmg = (targetId, isCrit) => {
      const target = document.getElementById(targetId);
      if (!target) return;
      const dmg = document.createElement('span');
      dmg.className = 'idle-dmg-float' + (isCrit ? ' idle-dmg-crit' : '');
      dmg.textContent = '-' + Math.round(8 + Math.random() * 30) + (isCrit ? '!' : '');
      target.appendChild(dmg);
      window.setTimeout(() => dmg.remove(), 800);
    };
    const step = () => {
      tick++;
      const loserPct = Math.max(0, Math.round(100 - (100 / ticks) * tick));
      const winnerPct = tick >= ticks ? winnerFinalPct : Math.max(winnerFinalPct, Math.round(100 - ((100 - winnerFinalPct) / ticks) * tick));
      loserFill.style.width = loserPct + '%';
      winnerFill.style.width = winnerPct + '%';
      if (typeof bkmpIdleSpawnHitFlash === 'function') {
        bkmpIdleSpawnHitFlash(loserId);
        if (Math.random() < 0.4) bkmpIdleSpawnHitFlash(winnerId);
      }
      spawnDmg(loserId, tick === ticks);
      if (Math.random() < 0.5) spawnDmg(winnerId, false);
      if (tick < ticks) {
        window.setTimeout(step, 420);
      } else {
        resultEl.textContent = won ? '🏆 Sieg!' : '💥 Niederlage';
        resultEl.style.color = won ? '#4ade80' : '#f87171';
        window.setTimeout(() => { overlay.classList.remove('visible'); resolve(); }, 1100);
      }
    };
    window.setTimeout(step, 350);
  });
}

/* ---------------- PvP-Arena: Erfolge (window.BKMP_ARENA_ACHIEVEMENTS_EXTRA) ----------------
   Gleiches Einbinde-Muster wie BKMP_RAID_ACHIEVEMENTS_EXTRA. */
window.BKMP_ARENA_ACHIEVEMENTS_EXTRA = [
  { id: 'arena_first_win', category: 'Arena', title: 'Erster Arena-Sieg', desc: 'Gewinne deinen ersten Arena-Kampf.', check: ctx => ctx.arenaWins >= 1 },
  { id: 'arena_win_10', category: 'Arena', title: 'Arena-Kämpfer', desc: 'Gewinne 10 Arena-Kämpfe.', progress: ctx => [ctx.arenaWins, 10], check: ctx => ctx.arenaWins >= 10 },
  { id: 'arena_win_50', category: 'Arena', title: 'Arena-Veteran', desc: 'Gewinne 50 Arena-Kämpfe.', progress: ctx => [ctx.arenaWins, 50], check: ctx => ctx.arenaWins >= 50 },
  { id: 'arena_win_200', category: 'Arena', title: 'Arena-Champion', desc: 'Gewinne 200 Arena-Kämpfe.', progress: ctx => [ctx.arenaWins, 200], check: ctx => ctx.arenaWins >= 200 },
  { id: 'arena_rating_1500', category: 'Arena', title: 'Aufstrebender Kämpfer', desc: 'Erreiche ein Arena-Rating von 1500.', progress: ctx => [ctx.arenaRating, 1500], check: ctx => ctx.arenaRating >= 1500 }
];

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)


async function bkmpIdleRenderArenaPanel() {
  const panel = document.getElementById('idlePanelArena');
  if (!panel) return;

  if (!bkmpArenaLoaded && !bkmpArenaLoading) {
    panel.innerHTML = '<p class="idle-dungeon-best">⏳ Lade Arena...</p>';
    await bkmpArenaLoadAll();
  }

  const uid = bkmpArenaMyAuthUserId;
  if (!uid) {
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <h4>⚔️ PvP-Arena</h4>
        <p>Melde dich mit deinem Spieler-Konto an und spiele mindestens einmal im Kampf-Tab, um in der Arena gegen andere Spieler anzutreten.</p>
      </div>`;
    return;
  }

  const rating = bkmpArenaMyRating ? bkmpArenaMyRating.rating : 1000;
  const wins = bkmpArenaMyRating ? bkmpArenaMyRating.wins : 0;
  const losses = bkmpArenaMyRating ? bkmpArenaMyRating.losses : 0;
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  /* Tageslimit-Anzeige (Spieler-Wunsch 14.07.: "Arena nur 10x Täglich
     Angreifen reset um 0:00") - reine Client-Schaetzung aus den ohnehin
     schon geladenen letzten Kaempfen (server-seitig ist arena_attack() die
     eigentliche, verbindliche Grenze - siehe supabase-idle-arena-daily-
     limit.sql). Reicht fuer die Anzeige, weil ein Tageslimit von 10 locker
     innerhalb der geladenen 15 juengsten Kaempfe liegt. */
  const todayStr = new Date().toDateString();
  const attacksToday = bkmpArenaRecentBattles.filter(b => b.wasAttacker && new Date(b.occurredAt).toDateString() === todayStr).length;
  const attacksLeft = Math.max(0, 10 - attacksToday);

  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <h4>⚔️ PvP-Arena</h4>
      <p>Asynchroner Kampf gegen die aktuellen Kampfwerte anderer Spieler - kein Echtzeit-Duell, dein Gegner muss nicht online sein. Sieg bringt Rating + Gold, Niederlage kostet nur Rating (nie Gold).</p>
      <p class="idle-dungeon-best">🏅 Dein Rating: <strong>${rating}</strong> &middot; ${wins}S / ${losses}N ${total > 0 ? `(${winRate}% Siegquote)` : ''}</p>
      <p>⚔️ Angriffe heute: <strong>${attacksLeft}/10</strong> übrig &middot; Reset um 0 Uhr</p>
    </div>
    <div class="idle-arena-opponents">
      <h4 style="margin-top:1rem;">Gegner in deiner Nähe</h4>
      ${attacksLeft === 0 ? '<p class="empty-hint">Tageslimit erreicht - morgen um 0 Uhr geht es weiter.</p>' : ''}
      ${bkmpArenaOpponents.length === 0 ? '<p class="empty-hint">Noch keine anderen Spieler in der Arena. Schau später nochmal vorbei.</p>' : bkmpArenaOpponents.map(o => {
        const myPower = bkmpArenaPowerScore(bkmpIdleState ? bkmpIdleState.attack : 0, bkmpIdleState ? bkmpIdleState.defense : 0, bkmpIdleState ? bkmpIdleState.hp : 0);
        const theirPower = bkmpArenaPowerScore(o.attack, o.defense, o.hp);
        const winChancePct = bkmpArenaEstimateWinChancePct(myPower, theirPower);
        const chanceTone = winChancePct >= 60 ? 'idle-arena-chance-good' : winChancePct >= 40 ? 'idle-arena-chance-even' : 'idle-arena-chance-bad';
        return `
        <div class="idle-arena-opponent-card" data-opponent-uid="${escapeHtml(o.authUserId)}">
          <span class="idle-arena-opponent-name">${escapeHtml(o.displayName)}</span>
          <span class="idle-arena-opponent-rating">🏅 ${o.rating}</span>
          <span class="idle-arena-opponent-record">${o.wins}S/${o.losses}N</span>
          <span class="idle-arena-opponent-chance ${chanceTone}" title="Geschätzte Gewinnchance anhand eurer aktuellen Kampfwerte - kein Versprechen, der Kampf bleibt ein Zufallswurf.">🎲 ~${winChancePct}%</span>
          <button type="button" class="btn-ja idle-arena-attack-btn" ${bkmpArenaAttacking || attacksLeft === 0 ? 'disabled' : ''}>${bkmpArenaAttacking === o.authUserId ? '⏳...' : '⚔️ Angreifen'}</button>
        </div>
      `;
      }).join('')}
    </div>
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">Letzte Kämpfe</h4>
      ${bkmpArenaRecentBattles.length === 0 ? '<p class="empty-hint">Noch keine Kämpfe.</p>' : bkmpArenaRecentBattles.map(b => {
        const won = b.wasAttacker ? b.attackerWon : !b.attackerWon;
        const opponentName = escapeHtml(b.wasAttacker ? b.defenderName : b.attackerName);
        /* Spieler-Report (15.07., "Die verloren Nachrichten machen
           grammatisch gar keinen Sinn", Screenshot: "vlceBlade verloren
           gegen", "Kaledoss überrumpelt von dich"): das feste Praefix-
           /Verb-/Suffix-Muster ging nur fuer EINEN der vier Faelle
           (wasAttacker+gewonnen, "Du hast X besiegt") tatsaechlich auf -
           bei den anderen drei landete "gegen"/das Subjekt an der
           falschen Stelle oder fehlte ganz. Jetzt pro Fall ein
           vollstaendiger, eigenstaendiger Satz statt eines generischen
           Bausteins. */
        const phrase = b.wasAttacker
          ? (won ? `Du hast ${opponentName} besiegt` : `Du hast gegen ${opponentName} verloren`)
          : (won ? `Du hast ${opponentName} abgewehrt` : `${opponentName} hat dich überrumpelt`);
        return `<p class="idle-dungeon-best">${won ? '✅' : '❌'} ${phrase} &middot; ${b.wasAttacker ? (won ? '+' : '') + b.ratingChange : (won ? '+' : '') + (-b.ratingChange)} Rating${b.goldReward ? ` &middot; +${b.goldReward} 💰` : ''} &middot; ${bkmpArenaFormatTime(b.occurredAt)}</p>`;
      }).join('')}
    </div>
  `;

  panel.querySelectorAll('.idle-arena-attack-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-opponent-uid]');
      const opponentUid = card ? card.dataset.opponentUid : null;
      const opponent = bkmpArenaOpponents.find(o => o.authUserId === opponentUid);
      const opponentName = opponent ? opponent.displayName : 'Gegner';
      if (!opponentUid || bkmpArenaAttacking) return;
      bkmpArenaAttacking = opponentUid;
      bkmpIdleRenderArenaPanel();
      try {
        const result = await bkmpArenaAttack(opponentUid);
        if (result) {
          const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '') || 'Du';
          const myVillageSkin = typeof bkmpGetActiveVillageSkinId === 'function' ? bkmpGetActiveVillageSkinId() : 'standard';
          const opponentVillageSkin = opponent ? opponent.activeVillageSkin : 'standard';
          await bkmpArenaPlayBattleAnimation(myName, opponentName, result.won, myVillageSkin, opponentVillageSkin);
          if (result.won) bkmpGuildQuestAddDelta('arena_wins', 1);
          const msg = result.won
            ? `⚔️ Sieg gegen ${result.defenderName}! +${result.ratingChange} Rating, +${result.goldReward} 💰 (jetzt ${result.newRating})`
            : `⚔️ Niederlage gegen ${result.defenderName}. ${result.ratingChange} Rating (jetzt ${result.newRating})`;
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(msg, 3800);
          bkmpIdleLog(msg);
          bkmpArenaRefreshAchievementCache();
        }
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message || 'Angriff fehlgeschlagen.', 3200);
      }
      bkmpArenaAttacking = null;
      bkmpArenaLoaded = false;
      await bkmpIdleRenderArenaPanel();
    });
  });
}

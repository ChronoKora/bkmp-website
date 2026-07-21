// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). js/ui/bkmp-hud.js


/* ---------------- Kampf-Loop ---------------- */

const BKMP_IDLE_SPRITE_CLASS_PREFIX = 'idle-sprite-';

/* Nutzerwunsch (18.07.): "wir wechseln jetzt nach und nach die PNG Frame
   Drachen aus" - schrittweiser Umstieg von den bisherigen 4-Frame-PNG-
   Spritesheets (siehe .idle-sprite-<key> Klassen in style.css) auf echte
   Videos, wie es fuer Weltboss/Gildenboss (zerathor.mp4/malthyros.mp4)
   schon laenger funktioniert. Einfach hier eintragen, sobald ein
   Drache ein Video bekommt - alles andere (Spawn, Dungeon-Wellen,
   Angriffs-Puls) lesen automatisch aus dieser Liste, kein Sonderfall
   noetig. Nicht eingetragene Drachen laufen unveraendert ueber die
   PNG-Klasse weiter. */
const BKMP_IDLE_VIDEO_DRAGON_SPRITES = {
  feuerdrache: 'assets/dragons/feuerdrache.mp4?v=20260718-feuerdrachevideo1',
  erddrache: 'assets/dragons/erddrache.mp4?v=20260718-dragonvideos2',
  blitzdrache: 'assets/dragons/blitzdrache.mp4?v=20260718-dragonvideos2',
  winddrache: 'assets/dragons/winddrache.mp4?v=20260718-dragonvideos2',
  cyberdrache: 'assets/dragons/cyberdrache.mp4?v=20260718-cyberdrache1',
  'yaksha-boss': 'assets/dragons/yaksha-boss.mp4?v=20260718-yakshavideos1',
  'yakshas-drache': 'assets/dragons/yakshas-drache.mp4?v=20260718-yakshavideos1',
  wuffdrache: 'assets/dragons/wuffdrache.mp4?v=20260718-lastdragons1',
  schattendrache: 'assets/dragons/schattendrache.mp4?v=20260718-lastdragons1',
  wasserdrache: 'assets/dragons/wasserdrache.mp4?v=20260718-lastdragons1'
};

/* Gemeinsame Sprite-Zuweisung fuer #idleDragonSprite - vorher an zwei
   Stellen (bkmpIdleSpawnDragon, bkmpDungeonApplyDragonVisuals) fast
   identisch dupliziert. Entscheidet pro Drache, ob ein Video
   (BKMP_IDLE_VIDEO_DRAGON_SPRITES) oder die klassische PNG-Sprite-Klasse
   zum Einsatz kommt. */
function bkmpIdleApplyDragonSprite(sprite, spriteKey) {
  if (!sprite) return;
  [...sprite.classList].filter(c => c.startsWith(BKMP_IDLE_SPRITE_CLASS_PREFIX)).forEach(c => sprite.classList.remove(c));
  sprite.classList.remove('idle-sprite-attacking');
  const videoSrc = BKMP_IDLE_VIDEO_DRAGON_SPRITES[spriteKey];
  if (videoSrc) {
    /* Perf-Fix (Nutzer-Videobericht 19.07., "Fenster flackert 1x komplett"
       beim Drachenwechsel): vorher wurde bei JEDEM Drachenwechsel das
       gesamte <video>-Element per innerHTML zerstoert und neu gebaut - ein
       harter Abriss+Neuaufbau der Video-Decodierung/GPU-Textur, ausgerechnet
       in dem Moment, in dem gleichzeitig HP-Balken/Schadenszahl/Reward-
       Anzeige neu rendern. Jetzt wird bei einem Drache-zu-Drache-Wechsel
       (haeufigster Fall) dasselbe <video>-Element weiterverwendet und nur
       src ausgetauscht - deutlich weniger GPU-/Decoder-Umbau in diesem
       kritischen Moment. Ein echter Neuaufbau passiert nur noch, wenn zuvor
       gar kein Video da war (z.B. Wechsel von PNG-Sprite auf Video). */
    let video = sprite.querySelector('video.idle-dragon-sprite-video');
    if (!video) {
      sprite.innerHTML = '';
      video = document.createElement('video');
      video.className = 'idle-dragon-sprite-video';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      sprite.appendChild(video);
    }
    if (video.dataset.spriteKey !== spriteKey) {
      /* Nutzerwunsch (19.07.): Effektmodus "Aus" ODER der Einzelschalter
         "Drachen-Kampfvideo" haelt Drachen-Videos an (Standbild statt
         Endlosschleife) - reiner Anzeige-Unterschied, keine Kampfwerte
         betroffen (siehe bkmpFxDragonVideoOff/bkmpFxApplyMode/
         bkmpIdleSyncDragonVideoPlayback fuer den Live-Umschalt-Fall). */
      const paused = typeof bkmpFxDragonVideoOff === 'function' && bkmpFxDragonVideoOff();
      video.dataset.spriteKey = spriteKey;
      video.src = videoSrc;
      if (paused) video.pause();
      else video.play().catch(() => {});
    }
  } else {
    sprite.innerHTML = '';
    sprite.classList.add(BKMP_IDLE_SPRITE_CLASS_PREFIX + spriteKey);
  }
}

/* Nutzerwunsch (19.07.): haelt/setzt das bereits vorhandene Drachen-Video
   fort, wenn der Effektmodus WAEHREND ein Drache schon zu sehen ist
   umgeschaltet wird (bkmpIdleApplyDragonSprite oben deckt nur den Fall
   "neuer Drache erscheint" ab). Von bkmpFxApplyMode() aufgerufen. */
function bkmpIdleSyncDragonVideoPlayback() {
  const video = document.querySelector('#idleDragonSprite .idle-dragon-sprite-video');
  if (!video) return;
  if (typeof bkmpFxDragonVideoOff === 'function' && bkmpFxDragonVideoOff()) {
    if (!video.paused) video.pause();
  } else if (video.paused) {
    video.play().catch(() => {});
  }
}

function bkmpIdleSpawnDragon() {
  /* Bug-Fix 18.07. (Spieler-Meldung: Liber erscheint bei einem Spieler
     immer wieder auf derselben festen Stufe): bkmpIdleSelectDragonKindId()
     wuerfelt den Event-Drachen-Spawn ueber einen DETERMINISTISCHEN Seed
     (siehe bkmpIdleSeededRoll01) - Absicht war NUR, dass ein Neuladen der
     Seite auf der AKTUELLEN Stufe nicht immer wieder neu wuerfelt (siehe
     Kommentar dort). Der bisherige Seed ("name|killIndex|dragonId") war
     aber unveraendert bei JEDEM erneuten Erreichen derselben Stufe -
     insbesondere nach jedem Prestige-Aufstieg, der die Stufe wieder auf
     niedrige Werte zuruecksetzt und der Spieler dieselben killIndex-Werte
     danach zwangslaeufig erneut durchlaeuft. Traf der Wurf einmal auf einer
     Stufe, traf er dort fuer diesen Spieler ab dann IMMER - genau das vom
     Spieler beschriebene "fest auf Stufe 45-6" (gilt identisch fuer
     Shenloss, derselbe Codepfad). Die Prestige-Stufe zusaetzlich in den
     Seed aufzunehmen aendert den Wurf bei jedem neuen Prestige-Durchlauf,
     bleibt aber INNERHALB eines Durchlaufs bei Reload/Stufenwechsel-und-
     zurueck weiterhin stabil (kein Reroll-Exploit) - echte Zufaelligkeit
     ueber die Spieler-Laufzeit hinweg, keine Wiederholbarkeit pro Reload. */
  const prestigeLevelForSeed = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
  bkmpIdleCurrentDragon = bkmpIdleDragonStatsAt(
    bkmpIdleState.current_dragon_index,
    bkmpIdleDragonDefs,
    bkmpIdleGetMergedDragonScalingCfg(),
    `${bkmpIdleState.name_key}|p${prestigeLevelForSeed}`,
    bkmpIdleEventDragonExcludedIds(),
    bkmpIdleEffectiveStats
  );
  if (!bkmpIdleCurrentDragon) return;
  bkmpIdleCurrentDragon.hp = bkmpIdleCurrentDragon.maxHp;
  const nameEl = document.getElementById('idleDragonName');
  if (nameEl) nameEl.textContent = `${bkmpIdleCurrentDragon.isBoss ? '👑 BOSS: ' : ''}${bkmpIdleCurrentDragon.isEventDragon ? '✨ ' : ''}${bkmpIdleCurrentDragon.name} (Stufe ${bkmpIdleFormatStage(bkmpIdleCurrentDragon.killIndex)})`;
  bkmpIdleApplyDragonSprite(document.getElementById('idleDragonSprite'), bkmpIdleCurrentDragon.spriteKey);
  const dragonEl = document.getElementById('idleDragon');
  if (dragonEl) {
    dragonEl.classList.toggle('idle-dragon-boss', bkmpIdleCurrentDragon.bossTier === 'boss');
    dragonEl.classList.toggle('idle-dragon-miniboss', bkmpIdleCurrentDragon.bossTier === 'miniboss');
    dragonEl.classList.toggle('idle-dragon-event', Boolean(bkmpIdleCurrentDragon.isEventDragon));
  }
  bkmpIdleUpdateDragonHpBar();
  bkmpIdleRenderStageBar();
  bkmpIdleMaybeShowEventDragonPopup();
  bkmpIdleBroadcastCombatState(true);
}

/* Gegenschlag des Drachen - eigene Funktion, damit Tick UND Klick
   (bkmpIdleHandleDragonClick) exakt dieselbe Logik nutzen. Vorher hatte
   NUR der Tick einen Gegenschlag; ein Klick, der den Drachen nicht sofort
   toetete, machte Schaden OHNE dass der Drache je zurueckschlug. Sobald
   ausschliesslich geklickt wurde (z.B. weil der Auto-Tick gerade tot war,
   siehe der Raid-Bug oben, oder einfach weil man schnell durchklickt statt
   zu warten), bekam das Dorf dadurch NIE Schaden - komplettes Nullrisiko.
   Aufgerufen wird sie nur, wenn der Drache den Treffer ueberlebt hat - beim
   toedlichen letzten Treffer bleibt der Gegenschlag weiterhin bewusst aus
   (kein Rachehieb von einem toten Drachen), egal ob per Tick oder Klick.

   Abklingzeit (bkmpIdleLastCounterAttackAt): Tick UND Klicks laufen
   gleichzeitig und unabhaengig voneinander - ohne diese Bremse loeste
   JEDER einzelne Klick zusaetzlich zum laufenden 900ms-Tick einen eigenen
   Gegenschlag aus, wodurch schnelles Klicken das Dorf um ein Vielfaches
   schneller draufgehen liess als vor der obigen Aenderung (genau das
   Gegenteil des beabsichtigten Effekts). Der Drache greift dadurch
   hoechstens einmal pro Tick-Intervall zurueck, egal ob dieser Treffer vom
   Tick oder von einem Klick kam - schliesst weiterhin das Nullrisiko-Klicken
   von oben, ohne Vielfach-Gegenschlaege bei normalem/schnellem Klicken. */
function bkmpIdleDragonCounterAttack(stats, showVisuals) {
  const now = Date.now();
  const cooldownMs = stats.tickIntervalMs || 900;
  if (now - bkmpIdleLastCounterAttackAt < cooldownMs) return;
  bkmpIdleLastCounterAttackAt = now;
  if (showVisuals === undefined) showVisuals = (typeof bkmpIdleCombatVisualsActive === 'function') ? bkmpIdleCombatVisualsActive() : true;

  /* Eis (magie_eis): Chance, den Gegenangriff komplett auszusetzen. */
  const frozen = stats.iceChancePct > 0 && Math.random() * 100 < stats.iceChancePct;
  if (frozen) {
    if (showVisuals) bkmpIdleSpawnIceBlock();
  } else {
    const dRoll = bkmpIdleDamageRoll(bkmpIdleCurrentDragon.attack, 5, 150, stats.defense);
    /* Magieresistenz (magie_resistenz): mindert erlittenen Schaden zusaetzlich. */
    const finalDmg = Math.round(dRoll.amount * (1 - (stats.magicResistPct || 0) / 100));
    bkmpIdleVillageHp = Math.max(0, bkmpIdleVillageHp - finalDmg);
    if (showVisuals) {
      bkmpIdleSpawnProjectile('fire', finalDmg, dRoll.isCrit);
      bkmpIdlePlaySpriteAttack();
      bkmpIdleSpawnHitFlash('idleVillage');
      bkmpIdleUpdateVillageHpBar();
    }
  }

  if (bkmpIdleVillageHp <= 0) {
    bkmpIdleHandleDefeat();
  }
}

function bkmpIdleSpawnBurnTick(amount) {
  const target = document.getElementById('idleDragon');
  if (!target) return;
  const dmg = document.createElement('span');
  dmg.className = 'idle-dmg-float idle-dmg-burn';
  dmg.textContent = '🔥-' + Math.round(amount);
  target.appendChild(dmg);
  window.setTimeout(() => dmg.remove(), 800);
}

function bkmpIdleSpawnLightningBolt(amount) {
  const field = document.getElementById('idleBattlefield');
  if (field) {
    const el = document.createElement('span');
    el.className = 'idle-lightning-bolt';
    field.appendChild(el);
    window.setTimeout(() => el.remove(), 350);
  }
  const target = document.getElementById('idleDragon');
  if (target) {
    const dmg = document.createElement('span');
    dmg.className = 'idle-dmg-float idle-dmg-lightning';
    dmg.textContent = '⚡-' + Math.round(amount);
    target.appendChild(dmg);
    window.setTimeout(() => dmg.remove(), 800);
  }
}

function bkmpIdleSpawnIceBlock() {
  const target = document.getElementById('idleVillage');
  if (!target) return;
  const el = document.createElement('span');
  el.className = 'idle-ice-block';
  el.textContent = '❄️ Eingefroren!';
  target.appendChild(el);
  window.setTimeout(() => el.remove(), 800);
}

function bkmpIdleUpdateDragonHpBar() {
  const fill = document.getElementById('idleDragonHpFill');
  const label = document.getElementById('idleDragonHpLabel');
  if (!fill || !bkmpIdleCurrentDragon) return;
  const pct = Math.max(0, Math.min(100, (bkmpIdleCurrentDragon.hp / bkmpIdleCurrentDragon.maxHp) * 100));
  fill.style.width = pct + '%';
  if (label) label.textContent = `${Math.max(0, Math.round(bkmpIdleCurrentDragon.hp))} / ${bkmpIdleCurrentDragon.maxHp}`;
}

function bkmpIdleUpdateVillageHpBar() {
  const fill = document.getElementById('idleVillageHpFill');
  const label = document.getElementById('idleVillageHpLabel');
  if (!fill || !bkmpIdleEffectiveStats) return;
  const maxHp = bkmpIdleEffectiveStats.hp;
  const pct = Math.max(0, Math.min(100, (bkmpIdleVillageHp / maxHp) * 100));
  fill.style.width = pct + '%';
  if (label) label.textContent = `${Math.round(bkmpIdleVillageHp)} / ${Math.round(maxHp)}`;
}

function bkmpIdleSpawnProjectile(kind, amount, isCrit) {
  const field = document.getElementById('idleBattlefield');
  if (!field) return;
  const el = document.createElement('span');
  el.className = kind === 'arrow' ? 'idle-arrow' : 'idle-fire-breath';
  field.appendChild(el);
  window.setTimeout(() => el.remove(), 500);

  const targetId = kind === 'arrow' ? 'idleDragon' : 'idleVillage';
  const target = document.getElementById(targetId);
  if (target) {
    const dmg = document.createElement('span');
    dmg.className = 'idle-dmg-float' + (isCrit ? ' idle-dmg-crit' : '');
    dmg.textContent = '-' + Math.round(amount) + (isCrit ? '!' : '');
    target.appendChild(dmg);
    window.setTimeout(() => dmg.remove(), 800);
  }
}

/* Spielt den Angriffs-Frame-Zyklus des Drachensprites ab (Elementaratem).
   Nutzt animationend statt eines festen Timeouts, damit ein neuer Angriff
   die laufende Animation sauber neu startet, auch bei sehr kurzen Ticks. */
function bkmpIdlePlaySpriteAttack() {
  const sprite = document.getElementById('idleDragonSprite');
  if (!sprite) return;
  sprite.classList.remove('idle-sprite-attacking');
  void sprite.offsetWidth;
  sprite.classList.add('idle-sprite-attacking');
}

function bkmpIdleSpawnHitFlash(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.classList.remove('idle-hit-flash');
  void el.offsetWidth;
  el.classList.add('idle-hit-flash');
}

function bkmpIdleRenderHud() {
  const hud = document.getElementById('idleDorfHud');
  if (!hud || !bkmpIdleState) return;
  const xpCfg = bkmpIdleConfig.xp_curve || BKMP_IDLE_FALLBACK_CONFIG.xp_curve;
  const xpNeeded = bkmpIdleXpForLevel(bkmpIdleState.level, xpCfg);
  const xpPct = Math.max(0, Math.min(100, (bkmpIdleState.xp / xpNeeded) * 100));
  const s = bkmpIdleEffectiveStats;
  const streakCount = bkmpIdleGetStreakData().count;

  /* Kompakte Portrait-HUD-Vorlage (Spieler-Name+Portrait-Kachel oben,
     Ressourcen als eigene Chip-Zeile) - urspruenglich nur /app
     (window.BKMP_APP_MODE), Redesign Phase 5 (17.07.): jetzt auf JEDEM
     schmalen Viewport aktiv (nicht mehr /app-exklusiv), analog zur
     Bottom-Navigation/Tab-Ueberlauf-Logik (bkmp-app-mode-bootstrap.js) -
     dieselbe Kachel-Zeile war schon vorher fuer schmale Bildschirme
     gebaut, nur faelschlich hinter dem /app-Flag versteckt. Auf breiten
     Viewports unveraendert die bestehende Vorlage weiter unten (dort
     passt die volle Statuszeile besser). Wird bei jedem Tick neu
     ausgewertet (kein "einmal beim Laden" Caching noetig wie bei der
     Tableiste), reagiert dadurch live auf Fenstergroessenaenderungen. */
  if (window.BKMP_APP_MODE || window.matchMedia('(max-width: 760px)').matches) {
    const playerName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '') || bkmpIdleState.name_key || 'Spieler';
    hud.innerHTML = `
      <div class="idle-hud-app-top">
        <div class="idle-hud-app-portrait">
          <span class="idle-hud-app-portrait-icon">🐉</span>
          <span class="idle-hud-app-portrait-level">${bkmpIdleState.level}</span>
        </div>
        <div class="idle-hud-app-identity">
          <div class="idle-hud-app-name">${escapeHtml(playerName)}</div>
          <div class="idle-hud-app-sub">
            ${streakCount > 0 ? `🔥 ${streakCount} Tage Serie` : ''}
            ${bkmpIdleState.skill_points_available > 0 ? ` · 🔹 ${bkmpIdleState.skill_points_available} Skillpunkte` : ''}
          </div>
        </div>
      </div>
      <div class="idle-hud-app-resources">
        <span class="idle-res-chip idle-res-gold" data-app-tab="idleTabBtnUpgrades"><i class="idle-res-icon">💰</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.gold)}</b></span>
        <span class="idle-res-chip idle-res-wood" data-app-tab="idleTabBtnUpgrades"><i class="idle-res-icon">🌳</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.wood)}</b></span>
        <span class="idle-res-chip idle-res-stone" data-app-tab="idleTabBtnUpgrades"><i class="idle-res-icon">🗿</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.stone)}</b></span>
        <span class="idle-res-chip idle-res-crystal" data-app-tab="idleTabBtnUpgrades"><i class="idle-res-icon">💎</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.crystals)}</b></span>
        <span class="idle-res-chip idle-res-essence" data-app-tab="idleTabBtnRunen"><i class="idle-res-icon">🧪</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.essence)}</b></span>
      </div>
      ${s ? `
      <div class="idle-hud-app-stats">
        <span class="idle-res-chip idle-res-hp" title="Maximale Leben"><i class="idle-res-icon">❤️</i><b class="idle-res-val">${bkmpIdleFormatNumber(Math.round(s.hp))}</b></span>
        <span class="idle-res-chip idle-res-atk" title="Angriff"><i class="idle-res-icon">⚔️</i><b class="idle-res-val">${bkmpIdleFormatNumber(Math.round(s.attack))}</b></span>
        <span class="idle-res-chip idle-res-def" title="Verteidigung"><i class="idle-res-icon">🛡️</i><b class="idle-res-val">${bkmpIdleFormatNumber(Math.round(s.defense))}</b></span>
        <span class="idle-res-chip idle-res-lvl" title="Level"><i class="idle-res-icon">⭐</i><b class="idle-res-val">${bkmpIdleState.level}</b></span>
      </div>` : ''}
      <div class="idle-hud-app-xp">
        <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${xpPct}%"></div></div>
        <div class="idle-xp-label">${Math.floor(bkmpIdleState.xp)} / ${xpNeeded} XP</div>
      </div>
    `;
    /* PROTOTYP 2 (18.07., entfernbar): spiegelt dieselben, oben schon
       berechneten Werte zusaetzlich in die kompakte HUD-Leiste - kein
       neuer Wert, reiner No-op wenn der Prototyp inaktiv ist. */
    if (typeof bkmpProtoChudRenderHud === 'function') bkmpProtoChudRenderHud();
    return;
  }

  hud.innerHTML = `
    <div class="idle-hud-top">
      <div class="idle-hud-level-badge"><span class="idle-hud-level-num">${bkmpIdleState.level}</span><span class="idle-hud-level-tag">Level</span></div>
      ${streakCount > 0 ? `<div class="idle-hud-streak-badge" title="Tage in Folge eingeloggt">🔥 ${streakCount}</div>` : ''}
      <div class="idle-hud-xp-wrap">
        <div class="idle-hud-skillpoints">🔹 ${bkmpIdleState.skill_points_available} Skillpunkte</div>
        <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${xpPct}%"></div></div>
        <div class="idle-xp-label">${Math.floor(bkmpIdleState.xp)} / ${xpNeeded} XP</div>
      </div>
    </div>
    ${s ? `
    <div class="idle-hud-stats">
      <span title="Angriff">⚔️ ${bkmpIdleFormatNumber(Math.round(s.attack))}</span>
      <span title="Verteidigung">🛡️ ${bkmpIdleFormatNumber(Math.round(s.defense))}</span>
      <span title="Maximale Leben">❤️ ${bkmpIdleFormatNumber(Math.round(s.hp))}</span>
      <span title="Kritische-Treffer-Chance">🎯 ${s.critChance.toFixed(1)}%</span>
      <span title="Kritischer Schaden">💥 ${Math.round(s.critDamage)}%</span>
      <span title="Angriffstempo (Angriffe pro Sekunde)">⚡ ${(1000 / (s.tickIntervalMs || 900)).toFixed(2)}/s</span>
      <span title="Glücksfaktor (Bonus auf Runen-/Ressourcen-Drops, aus Upgrades/Skills/Titeln/Runen zusammen)">🍀 +${(s.lootBonus || 0).toFixed(1)}%</span>
    </div>` : ''}
    <div class="idle-hud-resources">
      <span>💰 ${bkmpIdleFormatNumber(bkmpIdleState.gold)}</span>
      <span>🌳 ${bkmpIdleFormatNumber(bkmpIdleState.wood)}</span>
      <span>🗿 ${bkmpIdleFormatNumber(bkmpIdleState.stone)}</span>
      <span>💎 ${bkmpIdleFormatNumber(bkmpIdleState.crystals)}</span>
      <span>🧪 ${bkmpIdleFormatNumber(bkmpIdleState.essence)}</span>
      <span>🐉 ${bkmpIdleFormatNumber(bkmpIdleState.dragon_kills)} besiegt</span>
    </div>`;
  /* Phase 7.1 (21.07., Nutzer-Auftrag "Effektmodus darf keine eigene Zeile
     mehr belegen"): #idleFxModeBtn lebt statisch in index.html als
     Geschwister von .idle-stage-bar/.idle-battlefield (NICHT als Kind von
     #idleDorfHud) - genau deshalb ueberlebt es die obige innerHTML-
     Ersetzung unbeschadet und kann hier per Portal-Muster (identisch zu
     #idleAppMoreSheet/#idleCombatLogSheet an anderer Stelle) in die frisch
     gebaute .idle-hud-top eingehaengt werden, statt eine eigene 44px-Zeile
     zwischen Stufenleiste und Schlachtfeld zu belegen. Muss bei JEDEM
     Hud-Render erneut passieren (nicht nur einmalig), weil .idle-hud-top
     selbst jedes Mal neu erzeugt wird. Klick-Listener aus bkmpFxInit()
     bleiben unangetastet (appendChild verschiebt das echte Element, keine
     Kopie). Nur im Desktop-Zweig - die mobile/App-Kachel-Vorlage oben hat
     bereits ihr eigenes Icon (#bkmpProtoChudFxBtn). */
  const fxBtn = document.getElementById('idleFxModeBtn');
  const hudTop = hud.querySelector('.idle-hud-top');
  if (fxBtn && hudTop) hudTop.appendChild(fxBtn);
  /* PROTOTYP 2 (18.07., entfernbar): siehe Kommentar im App-Modus-Zweig
     oben - gleiches Prinzip fuer die Desktop-Vorlage. */
  if (typeof bkmpProtoChudRenderHud === 'function') bkmpProtoChudRenderHud();
}

/* ---------------- Live-Kampf-Broadcast fuers OBS-Mini-Overlay ----------------
   Umbau 17.07. (Nutzerwunsch: "das Große entfernen, das Kleine soll nur
   noch visuell sein - Klicken/Interagieren nur noch Hauptseite... auf der
   Hauptseite kämpft/klickert sie gegen einen Winddrache und das soll man im
   OBS-Stream sehen"): loest das alte Herzschlag+Poll+Lock-System komplett
   ab (zwei Seiten konnten dort unabhaengig voneinander kaempfen, siehe
   Git-Historie). Jetzt gibt es nur noch EINE aktive Spiel-Instanz - die
   Hauptseite - die ihren aktuellen Kampf-Zustand ueber einen reinen
   Realtime-BROADCAST-Kanal sendet (keine Tabelle, keine Persistenz noetig,
   Drachen-HP war noch nie gespeichert und muss es dafuer auch nicht werden).
   Das Mini-Overlay (idle-stream-mini.html) hat KEINE eigene Spiellogik mehr,
   sondern abonniert nur und zeichnet rein visuell nach. */
/* NOTFALL-FIX (20.07., Supabase Realtime Messages: 5 Mio. inklusive, 14.7
   Mio. verbraucht, 9.7 Mio. Ueberschreitung nach nur 5 Tagen - siehe
   Dashboard-Screenshot): die Annahme oben ("kostet quasi nichts") war
   falsch. bkmpIdleTick() lief alle 400-900ms (tickIntervalMs) und rief
   diese Funktion bei JEDEM Tick auf - UND der Kampf-Loop laeuft bewusst
   auch im Hintergrund weiter, solange der Tab offen ist (siehe Kommentar
   bei bkmpIdleCloseModal), also fuer JEDEN eingeloggten Spieler quasi
   durchgehend, nicht nur waehrend ein Stream-Overlay tatsaechlich zusieht.
   Das ergab bis zu ~2,5 Broadcasts/Sekunde PRO SPIELER, dauerhaft - exakt
   der Zeitraum und die Groessenordnung des Kostenanstiegs im Dashboard.
   Fix: harte Zeit-Drosselung auf max. 1 Broadcast alle 3 Sekunden fuer die
   haeufigen Tick-/Klick-Aufrufe; echte Zustandswechsel (neuer Drache, siehe
   bkmpIdleSpawnDragon) rufen weiterhin sofort per force=true durch, damit
   das Overlay bei einem Drachenwechsel nicht sichtbar nachhinkt. */
let bkmpIdleLastCombatBroadcastAt = 0;
const BKMP_IDLE_COMBAT_BROADCAST_MIN_MS = 3000;
function bkmpIdleBroadcastCombatState(force) {
  if (window.BKMP_IDLE_IS_STREAM_PAGE || !bkmpIdleState || !bkmpIdleCurrentDragon || !bkmpIdleEffectiveStats) return;
  if (typeof bkmpBroadcastCombatState !== 'function') return;
  const now = Date.now();
  if (!force && now - bkmpIdleLastCombatBroadcastAt < BKMP_IDLE_COMBAT_BROADCAST_MIN_MS) return;
  bkmpIdleLastCombatBroadcastAt = now;
  bkmpBroadcastCombatState(bkmpIdleState.name_key, {
    dragonSpriteKey: bkmpIdleCurrentDragon.spriteKey,
    dragonName: bkmpIdleCurrentDragon.name,
    dragonHp: bkmpIdleCurrentDragon.hp,
    dragonMaxHp: bkmpIdleCurrentDragon.maxHp,
    isBoss: bkmpIdleCurrentDragon.bossTier === 'boss',
    isMiniboss: bkmpIdleCurrentDragon.bossTier === 'miniboss',
    isEventDragon: Boolean(bkmpIdleCurrentDragon.isEventDragon),
    villageHp: bkmpIdleVillageHp,
    villageMaxHp: bkmpIdleEffectiveStats.hp,
    villageSkinId: typeof bkmpGetActiveVillageSkinId === 'function' ? bkmpGetActiveVillageSkinId() : null,
    level: bkmpIdleState.level
  });
}

/* Spieler-Feedback (viceBlade, 13.7.): "die minus Lebenspunkte [sollen]
   angezeigt werden wo man auch hin klickt anstatt auf einer bestimmten
   Stelle" - clientX/clientY (falls vorhanden, siehe bkmpIdleHandleDragonClick)
   ueberschreiben per Inline-Style die feste CSS-Position (left:65%/top:-6px
   aus .idle-dmg-click) mit der tatsaechlichen Klick-Position relativ zum
   Drachen-Kasten. Ohne Koordinaten (z.B. Leertaste als Klick-Ersatz) faellt
   die Zahl auf die alte, feste Position zurueck. */
function bkmpIdleSpawnClickDamage(amount, clientX, clientY) {
  const target = document.getElementById('idleDragon');
  if (!target) return;
  const dmg = document.createElement('span');
  dmg.className = 'idle-dmg-float idle-dmg-click';
  dmg.textContent = '-' + Math.round(amount);
  if (typeof clientX === 'number' && typeof clientY === 'number') {
    /* Nur left/top ueberschreiben, NICHT transform - die bestehende
       idleDmgFloat-Animation (@keyframes) steuert transform selbst
       (translate(-50%, 0) -> translate(-50%, -34px)) fuer den Hochschweb-
       Effekt. translate(-50%, ...) zentriert die Zahl dabei automatisch
       horizontal genau auf dem hier gesetzten left-Wert - deckt sich exakt
       mit dem Klickpunkt, kein zusaetzlicher Transform noetig/sinnvoll
       (wuerde vom Animations-Keyframe ohnehin sofort ueberschrieben). */
    const rect = target.getBoundingClientRect();
    dmg.style.left = Math.round(clientX - rect.left) + 'px';
    dmg.style.top = Math.round(clientY - rect.top) + 'px';
  }
  target.appendChild(dmg);
  window.setTimeout(() => dmg.remove(), 800);
}

function bkmpIdleHandleDragonClick(e) {
  if (!bkmpIdleModalOpen || !bkmpIdleState || !bkmpIdleCurrentDragon || !bkmpIdleEffectiveStats) return;
  /* Kein Klickschaden, solange das Vorbereitungs-Popup eines Event-
     Drachen noch nicht bestaetigt wurde. */
  if (bkmpIdleEventPauseActive) return;

  const now = Date.now();
  if (now < bkmpIdleClickLockedUntil) return;

  bkmpIdleClickBurst = bkmpIdleClickBurst.filter(t => now - t <= BKMP_BURST_WINDOW_MS);
  bkmpIdleClickBurst.push(now);
  if (bkmpIdleClickBurst.length >= BKMP_BURST_CLICK_THRESHOLD) {
    bkmpIdleClickLockedUntil = now + BKMP_AUTOCLICK_LOCK_MS;
    bkmpIdleClickBurst = [];
    bkmpIdleClickTimestamps = [];
    bkmpAutoclickSaveNumber(BKMP_IDLE_CLICK_LOCK_KEY, bkmpIdleClickLockedUntil);
    bkmpAutoclickSaveTimestamps(BKMP_IDLE_CLICK_HISTORY_KEY, bkmpIdleClickTimestamps);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(BKMP_AUTOCLICK_TOAST, 3200);
    return;
  }

  if (now - bkmpIdleLastClickAt < BKMP_CLICK_RATE_CAP_MS) return;
  bkmpIdleLastClickAt = now;
  bkmpIdleClickTimestamps.push(now);
  bkmpIdleClickTimestamps = bkmpIdleClickTimestamps.filter(t => now - t <= BKMP_AUTOCLICK_HISTORY_MS).slice(-BKMP_AUTOCLICK_WINDOW);
  bkmpAutoclickSaveTimestamps(BKMP_IDLE_CLICK_HISTORY_KEY, bkmpIdleClickTimestamps);
  if (bkmpIdleDetectAutoclickPattern(bkmpIdleClickTimestamps)) {
    bkmpIdleClickLockedUntil = now + BKMP_AUTOCLICK_LOCK_MS;
    bkmpIdleClickTimestamps = [];
    bkmpAutoclickSaveNumber(BKMP_IDLE_CLICK_LOCK_KEY, bkmpIdleClickLockedUntil);
    bkmpAutoclickSaveTimestamps(BKMP_IDLE_CLICK_HISTORY_KEY, bkmpIdleClickTimestamps);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(BKMP_AUTOCLICK_TOAST, 3200);
    return;
  }

  const clickDamage = Math.max(1, Math.round(bkmpIdleEffectiveStats.attack * (0.12 + (bkmpIdleEffectiveStats.clickDamagePct || 0) / 100)));
  bkmpIdleCurrentDragon.hp = Math.max(0, bkmpIdleCurrentDragon.hp - clickDamage);
  bkmpIdleSpawnClickDamage(clickDamage, e && typeof e.clientX === 'number' ? e.clientX : undefined, e && typeof e.clientY === 'number' ? e.clientY : undefined);
  bkmpIdleSpawnHitFlash('idleDragon');
  bkmpIdleUpdateDragonHpBar();

  if (bkmpIdleCurrentDragon.hp <= 0) {
    bkmpIdleHandleDragonDefeated();
  } else {
    /* Ueberlebt der Drache den Klick, schlaegt er jetzt genau wie beim Tick
       zurueck - siehe bkmpIdleDragonCounterAttack. Nur der wirklich
       toedliche Treffer (oben) bleibt weiterhin gegenschlagfrei. */
    bkmpIdleDragonCounterAttack(bkmpIdleEffectiveStats);
    bkmpIdleBroadcastCombatState();
  }
}

/* ---------------- Phase 7.0 (20.07.): Kampf-Log als Bottom-Sheet (mobil) ----------------
   Reine Darstellungs-Huelle um das bestehende #idleDorfLog (siehe
   bkmpIdleLog in idledorf.js) - Log-Inhalt/Filter-Checkbox komplett
   unveraendert, nur ob/wie sie sichtbar sind aendert sich. Auf Desktop
   wirkungslos (Umschalt-Button ist dort per CSS ausgeblendet, das Sheet
   faellt auf einen normalen Block im Dokumentfluss zurueck, siehe
   style.css @media(max-width:768px)). */
let bkmpIdleCombatLogHasUnseen = false;
function bkmpIdleCombatLogMarkUnseen() {
  const sheet = document.getElementById('idleCombatLogSheet');
  if (sheet && sheet.classList.contains('open')) return; // sichtbar - kein Badge noetig
  bkmpIdleCombatLogHasUnseen = true;
  const badge = document.getElementById('idleCombatLogBadge');
  if (badge) badge.style.display = 'inline-block';
}
/* Bug-Fix (beim eigenen Testen per getComputedStyle gefunden): das Sheet
   sitzt im Markup bewusst INNERHALB von #idlePanelKampf (damit es auf
   Desktop unveraendert an Ort und Stelle im Dokumentfluss rendert, siehe
   index.html-Kommentar dort). #idlePanelKampf ist aber ein direktes Kind
   von .idle-dorf-card und bekommt darueber position:relative;z-index:1
   (".idle-dorf-overlay .idle-dorf-card > *", siehe style.css) - das
   erzeugt einen eigenen Stacking-Context, in dem JEDES z-index (auch das
   eigene z-index:49 des Sheets) gefangen bleibt: .joke-buttons (Schliessen/
   Fuer-Streamer-Zeile) ist ein GESCHWISTER von #idlePanelKampf mit
   gleichem z-index:1, steht aber SPAETER im DOM und malt dadurch trotzdem
   ueber das gesamte #idlePanelKampf inkl. Sheet drüber - unabhaengig vom
   eigenen z-index. Exakt dieselbe Ursache/derselbe Fix wie beim "Mehr"-
   Menue (siehe bkmpProtoChudEscapeToOverlay in bkmp-proto-compact-hud.js):
   das Sheet wird beim OEFFNEN einmalig zu einem echten Geschwister auf
   #idleDorfOverlay-Ebene umgehaengt (Portal-Pattern) - auf Desktop nie
   ausgeloest, da der dafuer noetige Umschalt-Button dort per CSS
   ausgeblendet bleibt. */
function bkmpIdleCombatLogEscapeToOverlay(sheetEl) {
  const overlay = document.getElementById('idleDorfOverlay');
  if (sheetEl && overlay && sheetEl.parentElement !== overlay) overlay.appendChild(sheetEl);
}
function bkmpIdleCombatLogOpen() {
  const sheet = document.getElementById('idleCombatLogSheet');
  const btn = document.getElementById('idleCombatLogToggleBtn');
  bkmpIdleCombatLogEscapeToOverlay(sheet);
  if (sheet) sheet.classList.add('open');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  bkmpIdleCombatLogHasUnseen = false;
  const badge = document.getElementById('idleCombatLogBadge');
  if (badge) badge.style.display = 'none';
}
function bkmpIdleCombatLogClose() {
  const sheet = document.getElementById('idleCombatLogSheet');
  const btn = document.getElementById('idleCombatLogToggleBtn');
  if (sheet) sheet.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
function bkmpIdleCombatLogInit() {
  const toggleBtn = document.getElementById('idleCombatLogToggleBtn');
  const closeBtn = document.getElementById('idleCombatLogCloseBtn');
  const sheet = document.getElementById('idleCombatLogSheet');
  if (!toggleBtn || !sheet) return;
  toggleBtn.addEventListener('click', () => {
    if (sheet.classList.contains('open')) bkmpIdleCombatLogClose(); else bkmpIdleCombatLogOpen();
  });
  if (closeBtn) closeBtn.addEventListener('click', bkmpIdleCombatLogClose);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) bkmpIdleCombatLogClose(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('open')) bkmpIdleCombatLogClose();
  });
}

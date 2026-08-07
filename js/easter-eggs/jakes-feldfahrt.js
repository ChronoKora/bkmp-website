/* ============================================================
   Jake's Feldfahrt - eigenstaendiges Website-Easter-Egg-Minispiel
   ============================================================
   Vollstaendig unabhaengig vom Idle-Dorf-Spiel: kein bkmpIdle*-Aufruf,
   keine Idle-State-/Idle-Save-Abhaengigkeit, kein Idle-Import. Eigener
   Canvas, eigener requestAnimationFrame-Loop, eigener localStorage-
   Highscore (bkmp_jakes_feldfahrt_highscore_v1), eigenes Overlay nach dem
   bestehenden .joke-overlay/.joke-card-Muster (nur CSS-Klassen wieder-
   verwendet) - dadurch jederzeit gefahrlos entfernbar (diese Datei + css/
   jakes-feldfahrt.css + die drei <script/link>-Zeilen + der eine Trigger-
   Button in index.html), ohne das Idle-Dorf im Geringsten zu beeinflussen.

   Aktivierung: 5 Klicks auf den kleinen Traktor-Trigger im Plüshies-Tab
   der "Deine Erfolge"-Karte (#jakeFarmEggTrigger) innerhalb von ~4s.

   Nachtrag (07.08.2026, Nutzerwunsch "JakeCrayson-Pluschie ab 500 Punkten
   + Erfolge/Titel-Paket"): dieses Modul ruft jetzt bewusst ZWEI Funktionen
   aus der normalen Website (js/core/bkmp-site.js bzw. supabase.js) auf -
   bkmpGetMcName() (wer ist gerade eingeloggt) und redeemPlushieCode() (die
   bereits bestehende, faelschungssichere Pluschie-Einloese-Infrastruktur,
   dasselbe System wie beim Schaf-/AD-Free-Easter-Egg). Das ist eine
   bewusste, enge Erweiterung NUR fuer diese eine account-gebundene
   Belohnung - betrifft weiterhin an KEINER Stelle das Idle-Dorf (die obige
   Isolationsgarantie bleibt zu 100% bestehen), lockert nur das engere
   Versprechen "ruft keine einzige andere Site-Datei auf". Beide Aufrufe
   sind per typeof-Guard abgesichert und laufen rein optional (kein Absturz,
   falls diese Datei je unabhaengig von der restlichen Website eingebunden
   wuerde). window.BKMP_JAKESFELDFAHRT_SCORE_TIERS (unten) wird von
   bkmp-site.js synchron beim eigenen Laden gelesen - siehe Lade-Reihenfolge-
   Kommentar in index.html (diese Datei muss deshalb VOR bkmp-site.js
   laden).
*/
(function () {
  'use strict';

  /* ---------------- Konfiguration ---------------- */

  var ASSET_PATHS = {
    jake: 'assets/generated/icons/jake-tractor-main.png',
    wheat: 'assets/generated/icons/wheat-item.png',
    carrot: 'assets/generated/icons/carrot-item.png',
    pumpkin: 'assets/generated/icons/pumpkin-item.png',
    goldenHarvest: 'assets/generated/icons/golden-harvest-item.png',
    coin: 'assets/generated/icons/easter-coin-rare.png',
    stone: 'assets/generated/icons/stone-obstacle.png',
    sheep: 'assets/generated/icons/sheep-obstacle.png',
    mud: 'assets/generated/icons/mud-puddle-obstacle.png',
    fence: 'assets/generated/icons/fence-segment.png',
    hayBale: 'assets/generated/icons/hay-bale-prop.png',
    dust: 'assets/generated/effects/dust-puff-effect.png',
    sparkle: 'assets/generated/effects/harvest-sparkle-effect.png',
    fieldTile: 'assets/generated/backgrounds/farm-field-tile.png',
    laneTile: 'assets/generated/backgrounds/dirt-lane-tile.png',
    barn: 'assets/generated/backgrounds/barn-background.png'
  };
  /* harvest-sparkle-effect ist laut asset-manifest.json vorhanden - der
     Canvas-Sternchen-Ersatz (bewusst behalten, falls das Bild aus
     irgendeinem Grund nicht laedt) wird nur als Fallback genutzt, siehe
     drawSparkleParticle(). */
  var HAS_SPARKLE_ASSET = true;

  var ITEM_TYPES = {
    wheat: { points: 1, weight: 42, asset: 'wheat', label: 'Weizen', emoji: '🌾' },
    carrot: { points: 3, weight: 27, asset: 'carrot', label: 'Karotte', emoji: '🥕' },
    pumpkin: { points: 5, weight: 13, asset: 'pumpkin', label: 'Kürbis', emoji: '🎃' },
    goldenHarvest: { points: 25, weight: 3, asset: 'goldenHarvest', label: 'Goldene Ernte', emoji: '✨', triggersFever: true },
    coin: { points: 100, weight: 0.8, asset: 'coin', label: 'Easter-Coin', emoji: '🪙', isRareCoin: true }
  };
  var OBSTACLE_TYPES = {
    stone: { asset: 'stone', weight: 22, effect: 'hardStop' },
    fence: { asset: 'fence', weight: 12, effect: 'hardStop' },
    sheep: { asset: 'sheep', weight: 16, effect: 'softStop', moving: true },
    hayBale: { asset: 'hayBale', weight: 14, effect: 'softStop', rotatesOnHit: true },
    mud: { asset: 'mud', weight: 20, effect: 'slow' }
  };

  var LOGICAL_W = 960;
  var LOGICAL_H = 540;
  var LANE_COUNT = 5;
  var LANE_H = LOGICAL_H / LANE_COUNT;
  var PLAYER_X = LOGICAL_W * 0.2;
  var ROUND_SECONDS = 60;
  var LANE_CHANGE_MS = 200;
  var COMBO_RESET_MS = 2000;
  var FEVER_BASE_MS = 6000;
  var FEVER_MAX_MS = 10000;
  var MAX_DUST_PARTICLES = 30;
  var MAX_SPARKLE_PARTICLES = 36;
  var MAX_POPUPS = 24;
  var HIGHSCORE_KEY = 'bkmp_jakes_feldfahrt_highscore_v1';
  var DEBUG = /[?&]jakeFarmDebug=1\b/.test(location.search);

  /* Punkte-Meilensteine fuer Erfolge/Titel (07.08.2026) - EINZIGE Quelle
     dieser Zahlen/Bezeichnungen, wird von js/core/bkmp-site.js synchron
     beim eigenen Laden gelesen (bkmpBuildAchievementsList()/
     bkmpBuildTitlesList(), exakt dasselbe Verdrahtungsmuster wie
     window.BKMP_IDLE_DRAGON_KILL_TIERS aus idledorf.js) - deshalb bewusst
     als globale Zuweisung ganz oben im Skript, nicht irgendwo tief in der
     Datei versteckt. "5000" ist bewusst der oberste Meilenstein (nicht
     unendlich weiter skaliert wie z. B. bei Bonk) - ein 60-Sekunden-
     Rundenspiel hat eine reale, endliche Obergrenze, 5000 entspricht laut
     eigener Testreihe bereits einer aussergewoehnlich guten/glueck-
     lastigen Runde (deutlich ueber dem, was ein durchschnittlicher
     Durchlauf erreicht) - "fast das Maximum", wie gewuenscht. */
  window.BKMP_JAKESFELDFAHRT_SCORE_TIERS = [
    [100, 'Feld-Neuling'],
    [200, 'Ernte-Helfer'],
    [300, 'Traktorfahrer'],
    [500, 'Ernte-Profi'],
    [750, 'Feld-Meister'],
    [1000, 'Scheunen-Champion'],
    [1500, 'Ernte-Baron'],
    [2000, 'Traktor-Legende'],
    [3000, 'Feld-Gott'],
    [5000, 'Jakes Rekordhalter']
  ];

  /* JakeCrayson-Pluschie: automatische, faelschungssichere Freischaltung ab
     500 Punkten in einer Runde, ueber dasselbe wiederverwendbare-Code-
     System wie das Schaf-/AD-Free-Easter-Egg (siehe redeemPlushieCode()-
     Aufruf in bkmpJakeCraysonMaybeGrant() weiter unten). Der Code selbst
     wird NIE im UI angezeigt. plushie_codes-Zeile liegt in
     sql/20260807-jakecrayson-plushie-code.sql (noch nicht ausgefuehrt) -
     die plushies-Katalogzeile selbst legt der Nutzer ueber den admin.html-
     "Ordner scannen"-Knopf an (Dateiname assets/plushies/JakeCrayson.png
     ergibt automatisch die id "jakecrayson", siehe api/scan-plushie-
     folder.js). */
  var JAKECRAYSON_CODE = 'JAKESFELDFAHRT-500-HARVEST';
  var JAKECRAYSON_SCORE_THRESHOLD = 500;
  var JAKECRAYSON_STATUS_KEY = 'bkmp_jakes_feldfahrt_jakecrayson_status_v1';

  /* ---------------- Modul-Zustand (nur waehrend das Spiel offen ist) ---------------- */

  var els = {};
  var images = {};
  var imagesReady = false;
  var ctx = null;
  var dpr = 1;

  var raf = null;
  var lastFrameTime = 0;
  var running = false;
  var gameState = 'closed'; /* closed | start | countdown | playing | paused | ending | end */

  var previouslyFocusedEl = null;
  var keydownHandler = null;
  var resizeHandler = null;
  var visibilityHandler = null;
  var touchStartY = null;
  var touchStartT = null;

  /* Verfolgt den einzigen im Modul verwendeten setTimeout (Matsch-Ueberfahren-
     Verzoegerung, siehe hitObstacle()) - wird in closeGame() hart geleert,
     damit garantiert kein Timer nach dem Schliessen mehr feuert (Auftrag
     Abschnitt 31: "keine dauerhaft laufenden Effekte nach Schliessen"). */
  var pendingTimeouts = [];
  function trackedTimeout(fn, ms) {
    var id = setTimeout(function () {
      var idx = pendingTimeouts.indexOf(id);
      if (idx !== -1) pendingTimeouts.splice(idx, 1);
      fn();
    }, ms);
    pendingTimeouts.push(id);
    return id;
  }
  function clearAllPendingTimeouts() {
    pendingTimeouts.forEach(function (id) { clearTimeout(id); });
    pendingTimeouts.length = 0;
  }

  var player, entities, dustParticles, sparkleParticles, popups;
  var score, combo, maxCombo, comboTimeoutAt, feverUntil, difficultyT, roundTimeLeft, collisionCount;
  var itemsCollected, spawnTimer, spawnIntervalMs, worldSpeed, bgScrollX, endingT;
  var countdownValue, countdownTimerAt;

  function resetRunState() {
    player = {
      lane: 2,
      renderLane: 2,
      fromLane: 2,
      toLane: 2,
      laneChangeStart: 0,
      laneChangeMs: LANE_CHANGE_MS,
      y: laneCenterY(2),
      tilt: 0,
      bob: 0,
      hitFlashUntil: 0,
      slowUntil: 0,
      slowFactor: 1
    };
    entities = [];
    dustParticles = [];
    sparkleParticles = [];
    popups = [];
    score = 0;
    combo = 0;
    maxCombo = 0;
    comboTimeoutAt = 0;
    feverUntil = 0;
    difficultyT = 0;
    roundTimeLeft = ROUND_SECONDS;
    collisionCount = 0;
    itemsCollected = { wheat: 0, carrot: 0, pumpkin: 0, goldenHarvest: 0, coin: 0 };
    spawnTimer = 0;
    spawnIntervalMs = 1400;
    worldSpeed = 190;
    bgScrollX = 0;
    endingT = 0;
    countdownValue = 3;
    countdownTimerAt = 0;
  }

  function laneCenterY(lane) {
    return lane * LANE_H + LANE_H / 2;
  }

  /* ---------------- Highscore (rein lokal, kein Supabase, kein Idle-Save) ---------------- */

  function loadHighscoreData() {
    try {
      var raw = localStorage.getItem(HIGHSCORE_KEY);
      if (!raw) return { highscore: 0, totalCoins: 0 };
      var parsed = JSON.parse(raw);
      return {
        highscore: Number(parsed.highscore) || 0,
        totalCoins: Number(parsed.totalCoins) || 0
      };
    } catch (e) {
      return { highscore: 0, totalCoins: 0 };
    }
  }
  function saveHighscoreData(data) {
    try { localStorage.setItem(HIGHSCORE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  /* ---------------- Asset-Preload ---------------- */

  function preloadImages(callback) {
    if (imagesReady) { callback(); return; }
    var keys = Object.keys(ASSET_PATHS);
    var remaining = keys.length;
    var failed = [];
    keys.forEach(function (key) {
      var img = new Image();
      img.onload = function () {
        remaining--;
        if (remaining === 0) { imagesReady = true; callback(failed); }
      };
      img.onerror = function () {
        failed.push(key);
        remaining--;
        if (remaining === 0) { imagesReady = true; callback(failed); }
      };
      img.src = ASSET_PATHS[key];
      images[key] = img;
    });
  }

  /* ---------------- DOM-Aufbau (einmalig, beim ersten Oeffnen) ---------------- */

  function buildOverlayIfNeeded() {
    if (document.getElementById('jakeFarmGameOverlay')) return;

    var overlay = document.createElement('div');
    overlay.className = 'joke-overlay';
    overlay.id = 'jakeFarmGameOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', "Jake's Feldfahrt Minispiel");
    overlay.innerHTML =
      '<div class="joke-card jff-card" id="jffCard">' +
        '<div class="jff-header">' +
          '<span class="jff-header-title">🌾 Jake\'s Feldfahrt</span>' +
          '<span class="jff-header-stats">' +
            '<span class="jff-fever-badge" id="jffFeverBadge">✨ ERNTE-FIEBER x2</span>' +
            '<span id="jffScoreOut">🌾 0</span>' +
            '<span class="jff-combo" id="jffComboOut" style="display:none;">🔥 x0</span>' +
            '<span class="jff-timer" id="jffTimerOut">⏱ 60.0s</span>' +
          '</span>' +
          '<button type="button" class="jff-close-btn" id="jffCloseBtn" aria-label="Minispiel schließen">✕</button>' +
        '</div>' +
        '<div class="jff-stage">' +
          '<div class="jff-canvas-wrap" id="jffCanvasWrap">' +
            '<canvas id="jakeFarmGameCanvas"></canvas>' +
          '</div>' +
          '<div class="jff-debug" id="jffDebug"></div>' +
          '<div class="jff-touch-controls" id="jffTouchControls">' +
            '<button type="button" class="jff-touch-btn" id="jffTouchUp" aria-label="Spur nach oben">▲</button>' +
            '<button type="button" class="jff-touch-btn" id="jffTouchDown" aria-label="Spur nach unten">▼</button>' +
          '</div>' +

          '<div class="jff-screen jff-visible" id="jffScreenStart">' +
            '<h2 class="jff-screen-title">🌾 JAKE\'S FELDFAHRT</h2>' +
            '<p class="jff-screen-subtitle">Wie viel Ernte schaffst du in 60 Sekunden?</p>' +
            '<div class="jff-legend">' +
              '<span>🌾 +1</span><span>🥕 +3</span><span>🎃 +5</span><span>✨ Bonus</span><span>🪙 ???</span>' +
            '</div>' +
            '<p class="jff-controls-hint" id="jffControlsHint"></p>' +
            '<div class="jff-btn-row"><button type="button" class="jff-btn-primary" id="jffStartBtn">🚜 TRAKTOR STARTEN</button></div>' +
            '<p class="jff-controls-hint">Pass auf Schafe und Steine auf!</p>' +
          '</div>' +

          '<div class="jff-screen" id="jffScreenCountdown">' +
            '<div class="jff-countdown-number" id="jffCountdownNumber">3</div>' +
          '</div>' +

          '<div class="jff-screen" id="jffScreenPause">' +
            '<h2 class="jff-screen-title">⏸ Pause</h2>' +
            '<div class="jff-btn-row">' +
              '<button type="button" class="jff-btn-primary" id="jffResumeBtn">▶ Weiter</button>' +
              '<button type="button" class="jff-btn-secondary" id="jffRestartFromPauseBtn">🔄 Neustart</button>' +
              '<button type="button" class="jff-btn-secondary" id="jffCloseFromPauseBtn">✕ Schließen</button>' +
            '</div>' +
          '</div>' +

          '<div class="jff-screen" id="jffScreenEnd">' +
            '<h2 class="jff-screen-title">🌾 ERNTE BEENDET!</h2>' +
            '<p class="jff-screen-subtitle" id="jffEndScoreLine"></p>' +
            '<div class="jff-end-stats" id="jffEndStats"></div>' +
            '<div class="jff-btn-row">' +
              '<button type="button" class="jff-btn-primary" id="jffPlayAgainBtn">🚜 NOCHMAL FAHREN</button>' +
              '<button type="button" class="jff-btn-secondary" id="jffCloseFromEndBtn">✕ SCHLIESSEN</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="jff-footer">' +
          '<span id="jffFooterHint">Steuerung: ↑ / ↓ oder Wischen</span>' +
          '<button type="button" class="jff-pause-btn" id="jffPauseBtn">⏸ Pause</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    els.overlay = overlay;
    els.card = document.getElementById('jffCard');
    els.canvasWrap = document.getElementById('jffCanvasWrap');
    els.canvas = document.getElementById('jakeFarmGameCanvas');
    els.debug = document.getElementById('jffDebug');
    if (DEBUG) els.debug.classList.add('jff-visible');
    els.touchControls = document.getElementById('jffTouchControls');
    els.touchUp = document.getElementById('jffTouchUp');
    els.touchDown = document.getElementById('jffTouchDown');
    els.closeBtn = document.getElementById('jffCloseBtn');
    els.pauseBtn = document.getElementById('jffPauseBtn');
    els.scoreOut = document.getElementById('jffScoreOut');
    els.comboOut = document.getElementById('jffComboOut');
    els.timerOut = document.getElementById('jffTimerOut');
    els.feverBadge = document.getElementById('jffFeverBadge');
    els.screenStart = document.getElementById('jffScreenStart');
    els.screenCountdown = document.getElementById('jffScreenCountdown');
    els.screenPause = document.getElementById('jffScreenPause');
    els.screenEnd = document.getElementById('jffScreenEnd');
    els.countdownNumber = document.getElementById('jffCountdownNumber');
    els.startBtn = document.getElementById('jffStartBtn');
    els.resumeBtn = document.getElementById('jffResumeBtn');
    els.restartFromPauseBtn = document.getElementById('jffRestartFromPauseBtn');
    els.closeFromPauseBtn = document.getElementById('jffCloseFromPauseBtn');
    els.playAgainBtn = document.getElementById('jffPlayAgainBtn');
    els.closeFromEndBtn = document.getElementById('jffCloseFromEndBtn');
    els.endScoreLine = document.getElementById('jffEndScoreLine');
    els.endStats = document.getElementById('jffEndStats');
    els.controlsHint = document.getElementById('jffControlsHint');
    els.footerHint = document.getElementById('jffFooterHint');

    updateControlsModeUi();

    ctx = els.canvas.getContext('2d');

    els.closeBtn.addEventListener('click', closeGame);
    els.startBtn.addEventListener('click', function () { startCountdown(); });
    els.pauseBtn.addEventListener('click', function () { pauseGame(true); });
    els.resumeBtn.addEventListener('click', function () { pauseGame(false); });
    els.restartFromPauseBtn.addEventListener('click', function () { resetRunState(); startCountdown(); });
    els.closeFromPauseBtn.addEventListener('click', closeGame);
    els.playAgainBtn.addEventListener('click', function () { resetRunState(); startCountdown(); });
    els.closeFromEndBtn.addEventListener('click', closeGame);
    els.touchUp.addEventListener('click', function () { requestLaneChange(-1); });
    els.touchDown.addEventListener('click', function () { requestLaneChange(1); });

    els.canvasWrap.addEventListener('touchstart', onTouchStart, { passive: true });
    els.canvasWrap.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  /* Wird sowohl beim ersten Aufbau ALS AUCH bei jedem Resize neu geprueft
     (siehe resizeCanvas()) - nicht nur einmalig beim Oeffnen entschieden.
     Bugfund beim eigenen Testen: eine erste Fassung entschied nur einmal
     beim DOM-Aufbau anhand von matchMedia('pointer:coarse') - ein spaeteres
     Verbreitern/Verschmalern des Fensters (ohne Reload, gleiches
     Seitenmuster) aenderte die Touch-Button-Sichtbarkeit danach nie wieder,
     obwohl das Karten-Layout selbst (CSS-Breakpoint) sich weiterhin korrekt
     anpasste - exakt dasselbe "einmal entschieden statt responsiv"-
     Bugmuster, das in diesem Projekt bereits mehrfach dokumentiert ist. */
  function updateControlsModeUi() {
    if (!els.touchControls) return;
    /* Bugfund: identisch zur CSS-Mobile-Bedingung fuer die Vollbild-Karte
       (siehe css/jakes-feldfahrt.css, ".jff-card"-Media-Query) - vorher
       fehlte hier die Quer-Handy-Klausel, wodurch das Layout bereits
       korrekt auf Vollbild-Mobile umschaltete (z. B. 844x390), die Touch-
       Buttons aber trotzdem verborgen blieben. */
    var wantTouch = window.matchMedia && window.matchMedia('(max-width: 760px), (max-height: 500px) and (orientation: landscape), (pointer: coarse)').matches;
    els.touchControls.classList.toggle('jff-visible', wantTouch);
    els.controlsHint.textContent = wantTouch ? 'Steuerung: Wischen nach oben/unten oder die Pfeil-Buttons' : 'Steuerung: W / S oder ↑ / ↓';
    els.footerHint.textContent = wantTouch ? 'Wischen zum Spurwechsel' : 'Steuerung: ↑ / ↓ oder W / S';
  }

  function showScreen(name) {
    ['screenStart', 'screenCountdown', 'screenPause', 'screenEnd'].forEach(function (key) {
      els[key].classList.remove('jff-visible');
    });
    if (name) els[name].classList.add('jff-visible');
  }

  /* ---------------- Eingabe ---------------- */

  function requestLaneChange(direction) {
    if (gameState !== 'playing') return;
    var target = player.toLane + direction;
    if (target < 0 || target > LANE_COUNT - 1) return;
    player.fromLane = player.renderLane;
    player.toLane = target;
    player.lane = target;
    player.laneChangeStart = performance.now();
  }

  function onTouchStart(e) {
    if (!e.touches || !e.touches[0]) return;
    touchStartY = e.touches[0].clientY;
    touchStartT = performance.now();
  }
  function onTouchEnd(e) {
    if (touchStartY == null) return;
    var endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : touchStartY;
    var dy = endY - touchStartY;
    var dt = performance.now() - touchStartT;
    touchStartY = null;
    if (dt > 600 || Math.abs(dy) < 24) return;
    requestLaneChange(dy < 0 ? -1 : 1);
  }

  function onKeydown(e) {
    if (gameState === 'closed') return;
    var key = e.key;
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      e.preventDefault();
      e.stopPropagation();
      requestLaneChange(-1);
    } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
      e.preventDefault();
      e.stopPropagation();
      requestLaneChange(1);
    } else if (key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      if (gameState === 'start') startCountdown();
      else if (gameState === 'end') { resetRunState(); startCountdown(); }
    } else if (key === 'Escape') {
      e.preventDefault();
      /* stopPropagation() ist hier zwingend, nicht nur defensiv: die
         Website hat bereits einen globalen, bubble-phase ESC-Sweep
         (siehe window.BKMP_OVERLAY_CLOSERS in bkmp-site.js), der JEDES
         registrierte Overlay unconditional schliesst. Ohne einen Stopp
         hier wuerde ER nach diesem (capture-phase) Handler ZUSAETZLICH
         feuern und die Pause sofort wieder durch ein echtes Schliessen
         ueberschreiben - reproduziert+bestaetigt: ohne stopPropagation()
         sprang ein einzelner ESC-Druck waehrend "playing" direkt zu
         "closed" statt zu "paused". */
      e.stopPropagation();
      /* Das JakeCrayson-Belohnungs-Popup (07.08.) ist eine ZUSAETZLICHE,
         spaeter geoeffnete Ebene ueber diesem Overlay - waere es gerade
         sichtbar, wuerde ein ESC-Druck ohne diese Pruefung sofort das
         GESAMTE Spiel schliessen (dieser Handler laeuft in der Capture-
         Phase VOR jedem denkbaren eigenen Listener des Popups, ein
         zweiter Listener koennte die Reihenfolge nicht mehr aendern) -
         das Popup selbst wuerde dabei verwaist (sichtbar) stehen
         bleiben, da closeGame() nur #jakeFarmGameOverlay anfasst. */
      var jakeCraysonOverlay = document.getElementById('jakeCraysonRewardOverlay');
      if (jakeCraysonOverlay && jakeCraysonOverlay.classList.contains('visible')) {
        bkmpJakeCraysonHideAnnouncement();
        return;
      }
      if (gameState === 'playing') pauseGame(true);
      else if (gameState === 'paused') pauseGame(false);
      else closeGame();
    }
  }

  /* ---------------- Spawn-System ---------------- */

  function weightedPick(table) {
    var keys = Object.keys(table);
    var total = 0;
    keys.forEach(function (k) { total += table[k].weight; });
    var r = Math.random() * total;
    for (var i = 0; i < keys.length; i++) {
      r -= table[keys[i]].weight;
      if (r <= 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  function difficultyPhase() {
    var t = ROUND_SECONDS - roundTimeLeft;
    if (t < 15) return 0;
    if (t < 30) return 1;
    if (t < 45) return 2;
    return 3;
  }

  function spawnWave() {
    var phase = difficultyPhase();
    /* Wieviele der 5 Spuren diese Welle belegt - nie alle 5, mindestens
       eine bleibt garantiert frei befahrbar (Auftrag Abschnitt 18). */
    var maxLanesThisWave = phase === 0 ? 2 : (phase < 3 ? 3 : 4);
    var laneCount = 1 + Math.floor(Math.random() * maxLanesThisWave);
    laneCount = Math.min(laneCount, LANE_COUNT - 1);

    var lanes = [];
    for (var i = 0; i < LANE_COUNT; i++) lanes.push(i);
    for (var i = lanes.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = lanes[i]; lanes[i] = lanes[j]; lanes[j] = tmp;
    }
    var chosen = lanes.slice(0, laneCount);

    /* Obstacle-Anteil steigt mit der Phase, bleibt aber begrenzt - immer
       genug Sammelitems, damit sich Punkte lohnen. */
    var obstacleChance = [0.12, 0.28, 0.38, 0.46][phase];

    chosen.forEach(function (lane, idx) {
      var isObstacle = Math.random() < obstacleChance;
      var xOffset = idx * (36 + Math.random() * 40);
      if (isObstacle) {
        spawnObstacle(lane, xOffset);
      } else {
        spawnItem(lane, xOffset);
      }
    });

    /* Seltene Sonderfaelle: goldene Ernte etwas riskanter platzieren (in
       einer Spur, die diese Welle bereits ein Hindernis hat, falls
       vorhanden - "riskantere Route"), Coin voellig unabhaengig extrem
       selten irgendwo einstreuen. */
    if (Math.random() < 0.008) {
      var freeLane = lanes[Math.floor(Math.random() * lanes.length)];
      spawnItem(freeLane, 220, 'coin');
    }
  }

  function spawnItem(lane, xOffset, forceType) {
    var type = forceType || weightedPick(ITEM_TYPES);
    var def = ITEM_TYPES[type];
    entities.push({
      kind: 'item',
      type: type,
      def: def,
      lane: lane,
      x: LOGICAL_W + 40 + (xOffset || 0),
      y: laneCenterY(lane),
      radius: type === 'coin' || type === 'goldenHarvest' ? 22 : 18,
      bobPhase: Math.random() * Math.PI * 2,
      rotation: 0,
      dead: false,
      scale: 1
    });
  }

  function spawnObstacle(lane, xOffset) {
    var type = weightedPick(OBSTACLE_TYPES);
    var def = OBSTACLE_TYPES[type];
    entities.push({
      kind: 'obstacle',
      type: type,
      def: def,
      lane: lane,
      baseLaneY: laneCenterY(lane),
      x: LOGICAL_W + 40 + (xOffset || 0),
      y: laneCenterY(lane),
      radius: 24,
      wobblePhase: Math.random() * Math.PI * 2,
      rotation: 0,
      spinVelocity: 0,
      hit: false,
      dead: false,
      scale: 1
    });
  }

  /* ---------------- Update ---------------- */

  function update(dt, now) {
    if (gameState === 'countdown') {
      updateCountdown(now);
      updatePlayerAnimation(dt, now);
      updateParticles(dt);
      return;
    }
    if (gameState !== 'playing' && gameState !== 'ending') return;

    if (gameState === 'playing') {
      roundTimeLeft -= dt / 1000;
      if (roundTimeLeft <= 0) {
        roundTimeLeft = 0;
        gameState = 'ending';
        endingT = 0;
      }
      var phase = difficultyPhase();
      /* Weich zum Phasen-Zielwert hin (statt eines harten Sprungs genau bei
         t=15/30/45s) - Phasentabellen/Schwellen bleiben unangetastet, nur der
         UEBERGANG ist jetzt ueber ~400ms geglaettet. */
      var targetWorldSpeed = [190, 235, 285, 340][phase];
      var targetSpawnIntervalMs = [1500, 1150, 900, 720][phase];
      var diffSmoothing = Math.min(1, dt / 400);
      worldSpeed += (targetWorldSpeed - worldSpeed) * diffSmoothing;
      spawnIntervalMs += (targetSpawnIntervalMs - spawnIntervalMs) * diffSmoothing;

      spawnTimer += dt;
      if (spawnTimer >= spawnIntervalMs) {
        spawnTimer = 0;
        spawnWave();
      }

      if (combo > 0 && now >= comboTimeoutAt) combo = 0;
    } else if (gameState === 'ending') {
      endingT += dt;
      worldSpeed = Math.max(0, worldSpeed - dt * 0.4);
      if (endingT > 900) {
        finishRound();
        return;
      }
    }

    bgScrollX += worldSpeed * (dt / 1000);

    var speedFactor = player.slowUntil > now ? player.slowFactor : 1;
    var moveSpeed = worldSpeed * speedFactor;

    for (var i = entities.length - 1; i >= 0; i--) {
      var e = entities[i];
      e.x -= moveSpeed * (dt / 1000);
      if (e.kind === 'item') {
        if (e.collected) {
          /* Kurzer Pop-Scale (150ms) statt eines sofortigen Verschwindens -
             derselbe "erst am Leben halten, dann sterben lassen"-Trick wie
             beim ueberfahrbaren Matsch-Hindernis, nur ueber dt statt einen
             echten Timer gesteuert (kein zusaetzlicher aufzuraeumender
             setTimeout noetig). */
          var popT = (now - e.collectedAt) / 150;
          if (popT >= 1) { e.dead = true; } else { e.scale = 1 + popT * 0.7; }
        } else {
          e.bobPhase += dt * 0.005;
          e.y = e.lane === undefined ? e.y : laneCenterY(e.lane) + Math.sin(e.bobPhase) * 4;
          if (e.type === 'coin') e.rotation += dt * 0.006;
        }
      } else if (e.kind === 'obstacle') {
        if (e.def.moving) {
          e.wobblePhase += dt * 0.004;
          e.y = e.baseLaneY + Math.sin(e.wobblePhase) * (LANE_H * 0.16);
        }
        if (e.hit && e.def.rotatesOnHit) {
          e.rotation += e.spinVelocity * dt;
          e.spinVelocity *= 0.98;
        }
      }
      if (e.x < -50) { entities.splice(i, 1); continue; }
      checkCollision(e, now);
    }

    for (var i = entities.length - 1; i >= 0; i--) {
      if (entities[i].dead) entities.splice(i, 1);
    }

    updatePlayerAnimation(dt, now);
    maybeEmitDrivingDust(now);
    updateParticles(dt);
    updatePopups(dt);
  }

  function updateCountdown(now) {
    if (now - countdownTimerAt >= 700) {
      countdownTimerAt = now;
      countdownValue -= 1;
      if (countdownValue < 0) {
        gameState = 'playing';
        showScreen(null);
        comboTimeoutAt = now + COMBO_RESET_MS;
      } else {
        els.countdownNumber.textContent = countdownValue === 0 ? 'LOS!' : String(countdownValue);
      }
    }
  }

  function updatePlayerAnimation(dt, now) {
    var t = Math.min(1, (now - player.laneChangeStart) / player.laneChangeMs);
    var eased = 1 - Math.pow(1 - t, 3);
    player.renderLane = player.fromLane + (player.toLane - player.fromLane) * eased;
    player.y = laneCenterY(player.renderLane);
    player.tilt = (player.toLane - player.fromLane) * (1 - eased) * 6;
    player.bob += dt * 0.006;
  }

  function maybeEmitDrivingDust(now) {
    if (gameState !== 'playing' || dustParticles.length >= MAX_DUST_PARTICLES) return;
    if (!player._lastDustAt || now - player._lastDustAt > 90) {
      player._lastDustAt = now;
      spawnDustParticle(PLAYER_X - 34, player.y + 22);
    }
  }

  function spawnDustParticle(x, y) {
    if (dustParticles.length >= MAX_DUST_PARTICLES) dustParticles.shift();
    dustParticles.push({
      x: x, y: y,
      vx: -40 - Math.random() * 30,
      vy: -6 - Math.random() * 10,
      life: 0, maxLife: 500 + Math.random() * 250,
      scale: 0.25 + Math.random() * 0.2
    });
  }
  function spawnSparkleBurst(x, y, count) {
    for (var i = 0; i < count; i++) {
      if (sparkleParticles.length >= MAX_SPARKLE_PARTICLES) sparkleParticles.shift();
      var angle = Math.random() * Math.PI * 2;
      var speed = 30 + Math.random() * 70;
      sparkleParticles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        life: 0, maxLife: 450 + Math.random() * 350,
        scale: 0.18 + Math.random() * 0.22,
        rotation: Math.random() * Math.PI * 2
      });
    }
  }
  function updateParticles(dt) {
    for (var i = dustParticles.length - 1; i >= 0; i--) {
      var p = dustParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { dustParticles.splice(i, 1); continue; }
      p.x += p.vx * (dt / 1000);
      p.y += p.vy * (dt / 1000);
      p.vy += 6 * (dt / 1000);
    }
    for (var i = sparkleParticles.length - 1; i >= 0; i--) {
      var p = sparkleParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { sparkleParticles.splice(i, 1); continue; }
      p.x += p.vx * (dt / 1000);
      p.y += p.vy * (dt / 1000);
      p.vy += 40 * (dt / 1000);
    }
  }

  function spawnPopup(x, y, text, kind) {
    if (popups.length >= MAX_POPUPS) popups.shift();
    popups.push({ x: x, y: y, text: text, kind: kind || 'normal', life: 0, maxLife: 900 });
  }
  function updatePopups(dt) {
    for (var i = popups.length - 1; i >= 0; i--) {
      popups[i].life += dt;
      if (popups[i].life >= popups[i].maxLife) popups.splice(i, 1);
    }
  }

  /* ---------------- Kollision ---------------- */

  function checkCollision(e, now) {
    if (e.dead) return;
    var dx = e.x - PLAYER_X;
    var dy = e.y - player.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var hitRadius = 30 + (e.radius || 20) * 0.6;
    if (dist > hitRadius) return;

    if (e.kind === 'item') {
      if (!e.collected) collectItem(e, now);
    } else if (e.kind === 'obstacle' && !e.hit) {
      hitObstacle(e, now);
    }
  }

  function collectItem(e, now) {
    var def = e.def;
    var isFever = feverUntil > now;
    combo += 1;
    if (combo > maxCombo) maxCombo = combo;
    comboTimeoutAt = now + COMBO_RESET_MS;
    var comboBonus = Math.min(combo, 10);
    var points = (def.points + comboBonus) * (isFever ? 2 : 1);
    score += Math.round(points);
    itemsCollected[e.type] = (itemsCollected[e.type] || 0) + 1;

    spawnSparkleBurst(e.x, e.y, e.type === 'coin' ? 26 : (def.triggersFever ? 20 : 10));
    spawnPopup(e.x, e.y - 10, '+' + Math.round(points), e.type === 'coin' ? 'coin' : (def.triggersFever ? 'fever' : 'normal'));

    if (def.triggersFever) {
      var now2 = performance.now();
      var base = Math.max(feverUntil, now2);
      feverUntil = Math.min(base + FEVER_BASE_MS, now2 + FEVER_MAX_MS);
    }
    if (e.type === 'coin') {
      spawnPopup(e.x, e.y - 34, '✨ GEHEIME FARM-MÜNZE!', 'coin-label');
    }

    /* Kein sofortiges dead:true mehr - das Item bleibt kurz im "eingesammelt"-
       Zustand am Leben (siehe update()), damit drawItem() den Pop-Scale-Effekt
       tatsaechlich noch einen Frame lang zeigen kann, bevor es entfernt wird. */
    e.collected = true;
    e.collectedAt = now;
  }

  function hitObstacle(e, now) {
    e.hit = true;
    collisionCount += 1;
    combo = 0;
    player.hitFlashUntil = now + 260;

    if (e.def.effect === 'hardStop') {
      worldSpeed = Math.max(70, worldSpeed - 90);
      player.slowUntil = now + 650;
      player.slowFactor = 0.55;
    } else if (e.def.effect === 'softStop') {
      worldSpeed = Math.max(90, worldSpeed - 45);
      player.slowUntil = now + 400;
      player.slowFactor = 0.75;
      if (e.def.rotatesOnHit) e.spinVelocity = 0.012 * (Math.random() < 0.5 ? -1 : 1);
    } else if (e.def.effect === 'slow') {
      player.slowUntil = now + 1500;
      player.slowFactor = 0.6;
      spawnDustParticle(e.x, e.y);
      spawnDustParticle(e.x - 10, e.y + 6);
      /* Matsch darf ueberfahren werden (Auftrag 17), kein harter Crash -
         Objekt verschwindet nach kurzer Verzoegerung statt sofort. */
      trackedTimeout(function () { e.dead = true; }, 120);
      return;
    }
    if (e.def.effect !== 'slow') e.dead = true;
  }

  /* ---------------- Render ---------------- */

  function render(now) {
    var w = LOGICAL_W, h = LOGICAL_H;
    ctx.clearRect(0, 0, w, h);

    drawScrollingGround();
    drawLaneDividers();

    entities.forEach(function (e) {
      if (e.kind === 'obstacle') drawObstacle(e);
    });
    entities.forEach(function (e) {
      if (e.kind === 'item') drawItem(e);
    });

    drawDust();
    drawPlayer(now);
    drawSparkles();
    drawPopups();

    if (feverUntil > now) drawFeverVignette();
    if (DEBUG) drawDebug(now);
  }

  function drawImageCover(img, dx, dy, dw, dh) {
    if (!img || !img.complete || !img.naturalWidth) return;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function drawScrollingGround() {
    var tileW = LOGICAL_H; /* Kacheln sind quadratisch (1024x1024), auf Spielfeldhoehe skaliert */
    var img = images.fieldTile;
    var laneImg = images.laneTile;
    if (!img || !img.complete) return;
    var offset = bgScrollX % tileW;
    var startX = -offset;
    var flipToggleBase = Math.floor(bgScrollX / tileW);

    for (var lane = 0; lane < LANE_COUNT; lane++) {
      var useLaneTile = lane === 2; /* mittlere Spur = Jakes bevorzugte Fahrbahn-Textur, dezente Abwechslung */
      var texture = useLaneTile && laneImg && laneImg.complete ? laneImg : img;
      var y = lane * LANE_H;
      var x = startX;
      var idx = flipToggleBase;
      while (x < LOGICAL_W) {
        ctx.save();
        /* Abwechselnde Spiegelung kaschiert die (nicht 100% mathematisch
           nahtlose) Kachelwiederholung, siehe Auftrag Abschnitt 9. */
        if (idx % 2 === 0) {
          ctx.drawImage(texture, x, y, tileW, LANE_H);
        } else {
          ctx.translate(x + tileW, y);
          ctx.scale(-1, 1);
          ctx.drawImage(texture, 0, 0, tileW, LANE_H);
        }
        ctx.restore();
        x += tileW;
        idx++;
      }
    }
  }

  function drawLaneDividers() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (var i = 1; i < LANE_COUNT; i++) {
      var y = i * LANE_H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(LOGICAL_W, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawItem(e) {
    var img = images[e.def.asset];
    if (!img || !img.complete) return;
    var size = e.radius * 2.3 * (e.scale || 1);
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.rotation) ctx.rotate(e.rotation);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawObstacle(e) {
    var img = images[e.def.asset];
    if (!img || !img.complete) return;
    var size = e.radius * 2.3;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.rotation) ctx.rotate(e.rotation);
    ctx.globalAlpha = e.type === 'mud' ? 0.95 : 1;
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawDust() {
    var img = images.dust;
    dustParticles.forEach(function (p) {
      var alpha = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha * 0.85);
      var size = 60 * p.scale * (0.7 + p.life / p.maxLife);
      if (img && img.complete) {
        ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
      } else {
        ctx.fillStyle = '#d8c8a0';
        ctx.beginPath();
        ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawSparkleParticle(p) {
    var img = images.sparkle;
    var alpha = 1 - p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation + p.life * 0.004);
    var size = 46 * p.scale;
    if (HAS_SPARKLE_ASSET && img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      var spikes = 4, outerR = size / 2, innerR = size / 5;
      for (var i = 0; i < spikes * 2; i++) {
        var r = i % 2 === 0 ? outerR : innerR;
        var a = (Math.PI / spikes) * i;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  function drawSparkles() { sparkleParticles.forEach(drawSparkleParticle); }

  function drawPlayer(now) {
    var img = images.jake;
    if (!img || !img.complete) return;
    var w = 108, h = 108;
    var bobY = Math.sin(player.bob) * 2.5;
    var flash = now < player.hitFlashUntil;
    ctx.save();
    ctx.translate(PLAYER_X, player.y + bobY);
    ctx.rotate((player.tilt * Math.PI) / 180);
    if (flash) ctx.globalAlpha = 0.55 + Math.sin(now * 0.05) * 0.2;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(PLAYER_X, player.y + h / 2 - 6, w * 0.32, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPopups() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 20px Inter, sans-serif';
    popups.forEach(function (p) {
      var t = p.life / p.maxLife;
      var y = p.y - t * 36;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.kind === 'coin' ? '#ffd76a' : (p.kind === 'fever' ? '#ffb347' : (p.kind === 'coin-label' ? '#fff2c9' : '#ffffff'));
      ctx.font = p.kind === 'coin-label' ? '700 14px Inter, sans-serif' : '800 20px Inter, sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, y);
      ctx.fillText(p.text, p.x, y);
    });
    ctx.restore();
  }

  function drawFeverVignette() {
    var grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    grad.addColorStop(0, 'rgba(255, 196, 61, 0.16)');
    grad.addColorStop(0.5, 'rgba(255, 196, 61, 0)');
    grad.addColorStop(1, 'rgba(255, 196, 61, 0.16)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.restore();
  }

  function drawDebug(now) {
    var lines = [
      'FPS: ' + (dbgFps || 0).toFixed(0),
      'entities: ' + entities.length,
      'dust: ' + dustParticles.length + '/' + MAX_DUST_PARTICLES,
      'sparkle: ' + sparkleParticles.length + '/' + MAX_SPARKLE_PARTICLES,
      'lane: ' + player.toLane,
      'speed: ' + worldSpeed.toFixed(0),
      'phase: ' + difficultyPhase(),
      'state: ' + gameState
    ];
    els.debug.textContent = lines.join('\n');
  }

  /* ---------------- HUD (DOM, aktualisiert per Frame nur Text, keine neuen Nodes) ---------------- */

  function updateHud(now) {
    els.scoreOut.textContent = '🌾 ' + score.toLocaleString('de-DE');
    if (combo > 1) {
      els.comboOut.style.display = '';
      els.comboOut.textContent = '🔥 x' + combo;
    } else {
      els.comboOut.style.display = 'none';
    }
    var secs = Math.max(0, roundTimeLeft);
    els.timerOut.textContent = '⏱ ' + secs.toFixed(1) + 's';
    els.timerOut.classList.toggle('jff-timer-low', secs <= 10 && gameState === 'playing');
    els.feverBadge.classList.toggle('jff-visible', feverUntil > now);
  }

  /* ---------------- Loop ---------------- */

  var dbgFps = 0, dbgFrames = 0, dbgFpsAt = 0;

  function loop(now) {
    if (!running) return;
    if (!lastFrameTime) lastFrameTime = now;
    var dt = Math.min(now - lastFrameTime, 50);
    lastFrameTime = now;

    if (gameState !== 'paused') {
      update(dt, now);
    }
    render(now);
    updateHud(now);

    if (DEBUG) {
      dbgFrames++;
      if (now - dbgFpsAt >= 500) {
        dbgFps = (dbgFrames * 1000) / (now - dbgFpsAt);
        dbgFrames = 0; dbgFpsAt = now;
      }
    }

    raf = requestAnimationFrame(loop);
  }

  /* ---------------- Canvas-Groesse ---------------- */

  function resizeCanvas() {
    if (!els.canvasWrap || !els.canvas) return;
    var rect = els.canvasWrap.getBoundingClientRect();
    var targetRatio = LOGICAL_W / LOGICAL_H;
    var w = rect.width, h = rect.height;
    if (w / h > targetRatio) w = h * targetRatio; else h = w / targetRatio;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.canvas.style.width = Math.round(w) + 'px';
    els.canvas.style.height = Math.round(h) + 'px';
    els.canvas.width = Math.round(w * dpr);
    els.canvas.height = Math.round(h * dpr);
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale((els.canvas.width / LOGICAL_W), (els.canvas.height / LOGICAL_H));
      ctx.imageSmoothingEnabled = true;
    }
  }

  /* ---------------- Countdown / Pause / Ende ---------------- */

  function startCountdown() {
    gameState = 'countdown';
    countdownValue = 3;
    countdownTimerAt = performance.now();
    els.countdownNumber.textContent = '3';
    showScreen('screenCountdown');
  }

  function pauseGame(pause) {
    if (pause) {
      if (gameState !== 'playing') return;
      gameState = 'paused';
      showScreen('screenPause');
    } else {
      if (gameState !== 'paused') return;
      gameState = 'playing';
      lastFrameTime = 0;
      comboTimeoutAt = performance.now() + COMBO_RESET_MS;
      showScreen(null);
    }
  }

  function finishRound() {
    gameState = 'end';
    var data = loadHighscoreData();
    var isNewHighscore = score > data.highscore;
    data.highscore = Math.max(data.highscore, score);
    data.totalCoins = (data.totalCoins || 0) + itemsCollected.coin;
    saveHighscoreData(data);

    els.endScoreLine.textContent = 'Punkte: ' + score.toLocaleString('de-DE') + (isNewHighscore ? '  🏆 Neuer Bestwert!' : '');
    els.endStats.innerHTML =
      statRow('Bestwert', data.highscore.toLocaleString('de-DE')) +
      statRow('Beste Combo', 'x' + maxCombo) +
      statRow('Weizen', itemsCollected.wheat) +
      statRow('Karotten', itemsCollected.carrot) +
      statRow('Kürbisse', itemsCollected.pumpkin) +
      statRow('Goldene Ernte', itemsCollected.goldenHarvest) +
      statRow('Easter-Coins', itemsCollected.coin) +
      statRow('Kollisionen', collisionCount);
    showScreen('screenEnd');

    /* Sofortiger Erfolge-Refresh (07.08.) - identisches Muster wie
       bkmpMarkStreamerClicked() in bkmp-site.js: ohne diesen Aufruf wuerde
       ein frisch erreichter Punkte-Meilenstein erst mit dem naechsten
       30s-Intervall-Tick der Seite auffallen, statt sofort nach der Runde. */
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
    if (score >= JAKECRAYSON_SCORE_THRESHOLD) bkmpJakeCraysonMaybeGrant();
  }
  function statRow(label, value) {
    return '<span class="jff-stat-label">' + label + '</span><span class="jff-stat-value">' + value + '</span>';
  }

  /* ---------------- JakeCrayson-Pluschie (07.08., ab 500 Punkten) ---------------- */

  function bkmpJakeCraysonGetStatus() {
    try { return localStorage.getItem(JAKECRAYSON_STATUS_KEY) || ''; } catch (e) { return ''; }
  }
  function bkmpJakeCraysonSetStatus(v) {
    try { localStorage.setItem(JAKECRAYSON_STATUS_KEY, v); } catch (e) {}
  }

  /* Eigenes, kleines .joke-overlay - bewusst NICHT dieselbe Karte wie
     #jakeFarmGameOverlay (die ist auf Canvas-Spielfeldgroesse zugeschnitten,
     viel zu gross fuer eine kurze Belohnungs-Meldung) - lebt als Geschwister-
     Overlay in document.body, ueber dem Spiel-Overlay (z-index, siehe css/
     jakes-feldfahrt.css), damit sie waehrend des noch offenen Endscreens
     erscheinen kann, ohne ihn zu ersetzen. */
  function bkmpJakeCraysonAnnouncementOverlay() {
    var overlay = document.getElementById('jakeCraysonRewardOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'joke-overlay';
    overlay.id = 'jakeCraysonRewardOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="joke-card jff-reward-card" id="jakeCraysonRewardCard">' +
        '<button type="button" class="jff-reward-close" id="jakeCraysonRewardCloseBtn" aria-label="Schließen">✕</button>' +
        '<div class="jff-reward-body" id="jakeCraysonRewardBody"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('jakeCraysonRewardCloseBtn').addEventListener('click', bkmpJakeCraysonHideAnnouncement);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) bkmpJakeCraysonHideAnnouncement(); });
    return overlay;
  }
  function bkmpJakeCraysonHideAnnouncement() {
    var overlay = document.getElementById('jakeCraysonRewardOverlay');
    if (overlay) overlay.classList.remove('visible');
  }
  function bkmpJakeCraysonShowAnnouncement(kind) {
    var overlay = bkmpJakeCraysonAnnouncementOverlay();
    var body = document.getElementById('jakeCraysonRewardBody');
    if (kind === 'won') {
      body.innerHTML =
        '<div class="jff-reward-icon">🚜🧸</div>' +
        '<h2 class="jff-reward-title">Belohnung freigeschaltet!</h2>' +
        '<p class="jff-reward-text">Über 500 Punkte in einer Runde – stark! Du hast das <strong>JakeCrayson-Plüshie</strong> gewonnen.</p>' +
        '<p class="jff-reward-hint">Zu finden unter „Deine Erfolge“ → Plüshies.</p>' +
        '<div class="jff-btn-row"><button type="button" class="jff-btn-primary" id="jakeCraysonRewardOkBtn">Nice!</button></div>';
      var okBtn = document.getElementById('jakeCraysonRewardOkBtn');
      if (okBtn) okBtn.addEventListener('click', bkmpJakeCraysonHideAnnouncement);
    } else if (kind === 'login') {
      body.innerHTML =
        '<div class="jff-reward-icon">🌟</div>' +
        '<h2 class="jff-reward-title">Über 500 Punkte!</h2>' +
        '<p class="jff-reward-text">Melde dich mit deinem Minecraft-Namen an, dann bekommst du dafür das <strong>JakeCrayson-Plüshie</strong>.</p>' +
        '<div class="jff-btn-row">' +
          '<button type="button" class="jff-btn-primary" id="jakeCraysonRewardLoginBtn">Jetzt anmelden</button>' +
          '<button type="button" class="jff-btn-secondary" id="jakeCraysonRewardLaterBtn">Später</button>' +
        '</div>';
      var loginBtn = document.getElementById('jakeCraysonRewardLoginBtn');
      if (loginBtn) loginBtn.addEventListener('click', function () {
        bkmpJakeCraysonHideAnnouncement();
        var badge = document.getElementById('mcNameBadge');
        if (badge) badge.click();
      });
      var laterBtn = document.getElementById('jakeCraysonRewardLaterBtn');
      if (laterBtn) laterBtn.addEventListener('click', bkmpJakeCraysonHideAnnouncement);
    }
    overlay.classList.add('visible');
  }

  /* Faelschungssicher: der eigentliche "besitzt es schon?"/"Code gueltig?"-
     Check laeuft server-seitig in api/redeem-plushie-code.js (Service-Role-
     Key, unabhaengig vom hier gefuehrten lokalen Status) - JAKECRAYSON_STATUS_KEY
     ist nur ein schneller lokaler Cache, um nicht bei jeder qualifizierenden
     Runde erneut denselben Netzwerk-Aufruf auszuloesen. Selbst wenn
     localStorage geloescht wird, verhindert die servereseitige unique(name_key,
     plushie_id)-Constraint jede Doppel-Vergabe zuverlaessig. */
  function bkmpJakeCraysonMaybeGrant() {
    if (bkmpJakeCraysonGetStatus() === 'granted') return;
    var name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
    if (!name) {
      bkmpJakeCraysonShowAnnouncement('login');
      return;
    }
    if (typeof redeemPlushieCode !== 'function') return;
    redeemPlushieCode(JAKECRAYSON_CODE, name).then(function (res) {
      if (res && res.ok) {
        bkmpJakeCraysonSetStatus('granted');
        bkmpJakeCraysonShowAnnouncement('won');
        if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
      } else if (res && res.status === 409 && res.body && res.body.error === 'already_owned') {
        /* Kein neuer Gewinn (z. B. bereits in einer anderen Sitzung
           eingeloest) - kein Popup, nur den lokalen Status nachziehen
           (Auftrag "danach nie wieder"). */
        bkmpJakeCraysonSetStatus('granted');
      }
      /* Jeder andere Fehler (Netzwerk/502/not_registered/...) bleibt
         bewusst unmarkiert - der Versuch wiederholt sich einfach beim
         naechsten qualifizierenden Runden-Ende, kein Datenverlust
         moeglich. */
    }).catch(function () {});
  }

  /* ---------------- Sichtbarkeits-Pause (Tab/Fenster) ---------------- */

  function onVisibilityChange() {
    if (gameState === 'closed') return;
    if (document.hidden) {
      if (gameState === 'playing') pauseGame(true);
    }
  }

  /* ---------------- Oeffnen / Schliessen ---------------- */

  function openGame(triggerEl) {
    if (gameState !== 'closed') return; /* nur genau eine Spielinstanz */
    previouslyFocusedEl = triggerEl || document.activeElement;

    buildOverlayIfNeeded();
    resetRunState();
    gameState = 'start';
    showScreen('screenStart');

    els.overlay.removeAttribute('inert');
    els.overlay.classList.add('visible');
    document.body.classList.add('modal-open');
    if (window.BKMP_OVERLAY_CLOSERS) window.BKMP_OVERLAY_CLOSERS.jakeFarmGameOverlay = closeGame;

    preloadImages(function (failedKeys) {
      if (failedKeys && failedKeys.length && window.console) {
        console.warn('[jakes-feldfahrt] Assets nicht geladen:', failedKeys);
      }
    });

    resizeCanvas();
    updateControlsModeUi();
    resizeHandler = function () { resizeCanvas(); updateControlsModeUi(); };
    window.addEventListener('resize', resizeHandler);
    keydownHandler = onKeydown;
    document.addEventListener('keydown', keydownHandler, true);
    visibilityHandler = onVisibilityChange;
    document.addEventListener('visibilitychange', visibilityHandler);

    els.closeBtn.focus();
    trapFocusWithin(els.card);

    running = true;
    lastFrameTime = 0;
    raf = requestAnimationFrame(loop);
  }

  function closeGame() {
    if (gameState === 'closed') return;
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    gameState = 'closed';

    if (els.overlay) {
      els.overlay.classList.remove('visible');
      /* Verteidigungsmassnahme, kein bekannter reproduzierbarer Bug: solange
         pointer-events blockiert (siehe .joke-overlay Basisregel), koennen
         die einmalig gebundenen Button-Listener aus buildOverlayIfNeeded()
         nicht per Maus/Touch feuern - inert schliesst zusaetzlich den rein
         theoretischen Fall eines Tab-fokussierten Buttons waehrend das Spiel
         geschlossen ist, ohne die Listener selbst ab-/wieder anzumelden. */
      els.overlay.setAttribute('inert', '');
    }
    document.body.classList.remove('modal-open');
    if (window.BKMP_OVERLAY_CLOSERS) delete window.BKMP_OVERLAY_CLOSERS.jakeFarmGameOverlay;

    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    if (keydownHandler) { document.removeEventListener('keydown', keydownHandler, true); keydownHandler = null; }
    if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
    if (focusTrapHandler) { document.removeEventListener('keydown', focusTrapHandler, true); focusTrapHandler = null; }

    entities = []; dustParticles = []; sparkleParticles = []; popups = [];
    clearAllPendingTimeouts();

    if (previouslyFocusedEl && typeof previouslyFocusedEl.focus === 'function') {
      previouslyFocusedEl.focus();
    }
    previouslyFocusedEl = null;
  }

  /* ---------------- Minimaler eigener Fokus-Trap (keine externe Abhaengigkeit) ---------------- */

  var focusTrapHandler = null;
  function trapFocusWithin(container) {
    if (focusTrapHandler) document.removeEventListener('keydown', focusTrapHandler, true);
    focusTrapHandler = function (e) {
      if (e.key !== 'Tab') return;
      var focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      var list = Array.prototype.filter.call(focusable, function (el) { return el.offsetParent !== null; });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', focusTrapHandler, true);
  }

  /* ---------------- Easter-Egg-Trigger (5 Klicks in ~4s) ---------------- */

  var TRIGGER_CLICKS_NEEDED = 5;
  var TRIGGER_WINDOW_MS = 4000;
  var triggerClickTimes = [];

  function wireTrigger() {
    var btn = document.getElementById('jakeFarmEggTrigger');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var now = performance.now();
      triggerClickTimes.push(now);
      triggerClickTimes = triggerClickTimes.filter(function (t) { return now - t <= TRIGGER_WINDOW_MS; });
      if (triggerClickTimes.length >= TRIGGER_CLICKS_NEEDED) {
        triggerClickTimes = [];
        openGame(btn);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireTrigger);
  } else {
    wireTrigger();
  }

  /* Fuer QA/Debug erreichbar (?jakeFarmDebug=1 oder Konsole), niemals von
     der normalen Website selbst aufgerufen. */
  window.__jakesFeldfahrtOpen = openGame;
  window.__jakesFeldfahrtClose = closeGame;
  /* Reiner Test-Hook: manueller Tick OHNE requestAnimationFrame, fuer
     Automatisierungs-Browser, in denen RAF in einem nicht fokussierten Tab
     grundsaetzlich nie feuert (browser-natives Verhalten, kein Bug hier -
     der echte Spielbetrieb nutzt ausschliesslich requestAnimationFrame,
     siehe loop()). Ruft dieselben update()/render()/updateHud()-Funktionen
     wie ein echter RAF-Frame auf. */
  window.__jakesFeldfahrtManualTick = function (deltaMs) {
    if (gameState === 'closed') return null;
    var now = performance.now();
    update(deltaMs || 16, now);
    render(now);
    updateHud(now);
    return { gameState: gameState, score: score, roundTimeLeft: roundTimeLeft };
  };
  window.__jakesFeldfahrtState = function () {
    return gameState;
  };
})();

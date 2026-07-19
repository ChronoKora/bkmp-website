// Phase 5.6 Stufe 1 (19.07.) - modulares Kampf-Ebenensystem mit echtem
// transparentem Drachen. Entwickelt aus dem Phase-5.1-Prototyp (18.07.),
// der bereits die gesamte Ebenen-/Sichtbarkeits-/Fallback-Architektur bewies,
// aber mangels echtem Alpha-Asset noch mit einem geblendeten (mix-blend-mode)
// bzw. gerahmten Portrait-Drachen auskommen musste (siehe Git-Historie
// dieser Datei / Abschlussbericht Phase 5.1 fuer die verworfenen Versuche).
// `assets/prototype-battle/feuerdrache-transparent-v1.webm` ist jetzt ein
// echtes VP9/yuva420p-WebM mit echtem Alphakanal (offline per ffmpeg aus
// einem vom Nutzer bereitgestellten Greenscreen-Clip erzeugt, chromakey+
// Crop, KEINE Laufzeit-Chroma-Key-Schleife im Browser - siehe Abschluss-
// bericht Phase 5.6 fuer die genauen Parameter) - dadurch entfaellt der
// Rahmen/Blend-Modus komplett, der Drache schwebt jetzt wirklich frei vor
// der Landschaft.
//
// Diese Datei ist weiterhin die einzige Stelle mit eigener Logik; entfernen
// = diese Datei loeschen + ihr <script>-Tag in index.html + den HTML-Block
// dort + den CSS-Abschnitt in style.css (klar markiert) + die 2 zusaetzlichen
// Hook-Zeilen in js/ui/bkmp-hud.js. Nichts hier veraendert Kampfwerte/
// -berechnung - liest nur bestehende Werte (bkmpIdleCurrentDragon/
// bkmpIdleEffectiveStats/bkmpIdleVillageHp) und ruft fuer Klicks die bereits
// vorhandene bkmpIdleHandleDragonClick() auf, genau wie der bestehende
// Kampfbildschirm.

// Auf false setzen, um das gesamte Ebenensystem zu deaktivieren - dann
// bleibt #idleBattlefield garantiert die einzige Darstellung.
const BKMP_LAYERED_COMBAT_ENABLED = true;

/* ---------------- Abschnitt 5: zentrale Asset-Zuordnung ----------------
   Gegner-ID (spriteKey, siehe BKMP_IDLE_VIDEO_DRAGON_SPRITES in
   bkmp-hud.js) -> Asset-ID sind hier bewusst DIESELBEN Schluessel, damit
   spaeter (Stufe 2+) keine zusaetzliche Uebersetzungstabelle noetig wird -
   trotzdem ueber eine eigene Lookup-Funktion (bkmpCombatAssetFor) getrennt
   abgefragt, nie direkt indiziert, damit ein fehlender Eintrag sauber
   "kein Asset" statt "undefined" liefert. Stufe 1: nur 'feuerdrache'
   befuellt - jeder andere Gegner faellt automatisch auf den bestehenden
   Renderer zurueck (siehe bkmpProtoSyncForCurrentDragon). */
const BKMP_COMBAT_ASSETS = {
  feuerdrache: {
    background: 'assets/prototype-battle/landschaft.mp4',
    idle: 'assets/prototype-battle/feuerdrache-transparent-v1.webm',
    // Stufe 1 hat keine eigenen Angriffs-/Treffer-Video-/Bildassets
    // (nicht bereitgestellt) - der Treffer-/Krit-Effekt laeuft rein ueber
    // eine kleine CSS-Partikel-Ebene (bkmpProtoSpawnHitFx), analog zum
    // bereits bestehenden bkmpFireAchievementConfetti-Muster, kein neues
    // Bild-/Videoasset noetig.
    hitFx: null,
    critFx: null,
    aspectRatio: '1080 / 612',
    position: {
      desktop: { width: '32%', right: '5%', top: '18%' },
      mobile: { width: '38%', right: '3%', top: '16%' }
    },
    // Abschnitt 10: Trefferpunkte/Angriffsanker, Prozentwerte relativ zur
    // gesamten Kampf-Flaeche (#bkmpProtoBattlefield), nicht relativ zur
    // Drachen-Ebene selbst - so bleiben sie auch bei unterschiedlicher
    // Drachen-Groesse/-Position konsistent.
    anchors: { attackOrigin: { x: 74, y: 42 }, villageHit: { x: 26, y: 58 }, dragonHit: { x: 78, y: 46 } }
  },
  /* Stufe 2 (19.07.): drei weitere Gegner mit echtem Alphakanal, nach
     demselben Offline-ffmpeg-Verfahren wie feuerdrache erzeugt (Nutzer-
     bereitgestellte Greenscreen-Clips, chromakey+Crop, siehe Abschluss-
     bericht fuer die exakten Parameter pro Datei). Erd-/Cyber-/Schatten-
     drache waren in dieser Ladung NICHT auf Gruenschirm, sondern auf
     Schwarz gefilmt - da alle drei Motive selbst grossflaechig dunkle/
     schwarze Toene tragen, liess sich der Hintergrund technisch nicht
     sauber vom Motiv trennen (jede Schwellwert-Einstellung riss entweder
     sichtbare graue Kanten stehen oder zerfetzte die Kontur) - bewusst
     NICHT eingetragen, fallen automatisch auf die bestehende Darstellung
     zurueck (siehe bkmpProtoSyncForCurrentDragon). Neue Greenscreen-
     Fassungen dieser drei wuerden genauso funktionieren wie die drei hier. */
  wasserdrache: {
    background: 'assets/prototype-battle/landschaft.mp4',
    idle: 'assets/prototype-battle/wasserdrache-transparent.webm',
    hitFx: null,
    critFx: null,
    aspectRatio: '1080 / 612',
    position: {
      desktop: { width: '32%', right: '5%', top: '18%' },
      mobile: { width: '38%', right: '3%', top: '16%' }
    },
    anchors: { attackOrigin: { x: 74, y: 42 }, villageHit: { x: 26, y: 58 }, dragonHit: { x: 78, y: 46 } }
  },
  winddrache: {
    background: 'assets/prototype-battle/landschaft.mp4',
    idle: 'assets/prototype-battle/winddrache-transparent.webm',
    hitFx: null,
    critFx: null,
    aspectRatio: '1080 / 612',
    position: {
      desktop: { width: '32%', right: '5%', top: '18%' },
      mobile: { width: '38%', right: '3%', top: '16%' }
    },
    anchors: { attackOrigin: { x: 74, y: 42 }, villageHit: { x: 26, y: 58 }, dragonHit: { x: 78, y: 46 } }
  },
  'yaksha-boss': {
    background: 'assets/prototype-battle/landschaft.mp4',
    idle: 'assets/prototype-battle/yaksha-boss-transparent.webm',
    hitFx: null,
    critFx: null,
    aspectRatio: '1080 / 612',
    position: {
      desktop: { width: '32%', right: '5%', top: '18%' },
      mobile: { width: '38%', right: '3%', top: '16%' }
    },
    anchors: { attackOrigin: { x: 74, y: 42 }, villageHit: { x: 26, y: 58 }, dragonHit: { x: 78, y: 46 } }
  }
};

// Getrennte Lookup-Funktion statt direkter Objektzugriff (Abschnitt 5:
// "Gegner-ID und Asset-ID klar trennen") - liefert null statt undefined,
// wenn fuer den aktuellen Gegner (noch) kein Asset existiert.
function bkmpCombatAssetFor(spriteKey) {
  return BKMP_COMBAT_ASSETS[spriteKey] || null;
}

let bkmpProtoState = {
  bgOk: false, dragonOk: false, bgFailed: false, dragonFailed: false,
  revealed: false, pollStarted: false,
  // Abschnitt 3/17: welcher Gegner gerade das Ebenensystem zeigt bzw.
  // zuletzt geprueft wurde - verhindert, dass ein falscher Drache
  // (anderer spriteKey als das geladene Asset) je angezeigt wird.
  loadedForSpriteKey: null, checkedSpriteKey: undefined
};
let bkmpProtoLastVillagePct = null;
let bkmpProtoLastDragonPct = null;

function bkmpProtoTryReveal() {
  if (bkmpProtoState.revealed) return;
  if (!bkmpProtoState.bgOk || !bkmpProtoState.dragonOk) return;
  const proto = document.getElementById('bkmpProtoBattlefield');
  const original = document.getElementById('idleBattlefield');
  if (!proto) return;
  proto.style.display = '';
  if (original) original.style.display = 'none';
  bkmpProtoState.revealed = true;
  bkmpProtoStartPollLoop();
}

// Abschnitt 17: Fallback greift zurueck auf die bestehende Darstellung,
// ohne irgendetwas an Kampfwerten/-zustand zu veraendern - #bkmpProtoBattlefield
// bleibt einfach display:none, #idleBattlefield wird (falls es vorher
// versteckt war) wieder eingeblendet.
function bkmpProtoRevertToOriginal(reason) {
  const proto = document.getElementById('bkmpProtoBattlefield');
  const original = document.getElementById('idleBattlefield');
  if (proto) proto.style.display = 'none';
  if (original) original.style.display = '';
  if (bkmpProtoState.revealed) {
    console.warn('Kampf-Ebenensystem: zurueck zur bestehenden Darstellung (' + reason + ').');
  }
  bkmpProtoState.revealed = false;
}

// Faellt automatisch auf die bestehende Darstellung zurueck, sobald
// eines der beiden Assets nicht laedt - #bkmpProtoBattlefield bleibt
// dann einfach display:none (Ausgangszustand), #idleBattlefield wurde
// nie angefasst. Keine Konsolenflut: jedes Asset meldet seinen eigenen
// Fehler nur einmal (Listener laeuft mit { once: true }).
function bkmpProtoHandleLoadFailure(which) {
  bkmpProtoState[which + 'Failed'] = true;
  console.warn('Kampf-Ebenensystem: Asset "' + which + '" konnte nicht geladen werden - bestehende Darstellung bleibt aktiv.');
  bkmpProtoRevertToOriginal('Asset "' + which + '" fehlgeschlagen');
}

// Laedt Hintergrund+Drache fuer genau EIN Asset-Set (Stufe 1: nur
// 'feuerdrache'). Wird sowohl beim ersten Init als auch dann erneut
// aufgerufen, wenn ein zuvor fehlendes Asset spaeter doch zum aktuellen
// Gegner passt (z.B. Rueckkehr zu einem Feuerdrachen nach einem Gegner
// ohne Asset).
function bkmpProtoLoadAsset(asset) {
  const bgVideo = document.getElementById('bkmpProtoBgVideo');
  const dragonVideo = document.getElementById('bkmpProtoDragonVideo');
  const dragonLayer = document.getElementById('bkmpProtoDragonLayer');
  if (!bgVideo || !dragonVideo) return;

  bkmpProtoState.bgOk = false; bkmpProtoState.dragonOk = false;
  bkmpProtoState.bgFailed = false; bkmpProtoState.dragonFailed = false;

  if (dragonLayer && asset.aspectRatio) dragonLayer.style.aspectRatio = asset.aspectRatio;
  bkmpProtoApplyPosition(asset);

  bgVideo.addEventListener('loadeddata', () => { bkmpProtoState.bgOk = true; bkmpProtoTryReveal(); }, { once: true });
  bgVideo.addEventListener('error', () => bkmpProtoHandleLoadFailure('bg'), { once: true });
  dragonVideo.addEventListener('loadeddata', () => {
    bkmpProtoState.dragonOk = true;
    try { dragonVideo.currentTime = 1.5; } catch (e) { /* egal, spielt trotzdem an */ }
    bkmpProtoTryReveal();
  }, { once: true });
  dragonVideo.addEventListener('error', () => bkmpProtoHandleLoadFailure('dragon'), { once: true });

  bgVideo.preload = 'auto';
  dragonVideo.preload = 'auto';
  if (bgVideo.getAttribute('src') !== asset.background) bgVideo.setAttribute('src', asset.background);
  if (dragonVideo.getAttribute('src') !== asset.idle) dragonVideo.setAttribute('src', asset.idle);
  bgVideo.load();
  dragonVideo.load();
  bkmpProtoState.loadedForSpriteKey = bkmpProtoState.checkedSpriteKey;
}

// Abschnitt 7: Positionierung ausschliesslich relativ zur Kampf-Flaeche
// (Prozentwerte aus BKMP_COMBAT_ASSETS), nie feste Bildschirmkoordinaten.
// Mobile/Desktop-Werte getrennt konfigurierbar (Abschnitt 5) - der
// 640px-Umbruch spiegelt den bestehenden @media-Breakpoint in style.css.
function bkmpProtoApplyPosition(asset) {
  const dragonLayer = document.getElementById('bkmpProtoDragonLayer');
  if (!dragonLayer || !asset.position) return;
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  const pos = (isMobile ? asset.position.mobile : asset.position.desktop) || asset.position.desktop;
  if (!pos) return;
  Object.keys(pos).forEach(prop => { dragonLayer.style[prop] = pos[prop]; });
}

// Abschnitt 3/17: wird von bkmpIdleApplyDragonSprite() (bkmp-hud.js) bei
// JEDEM neuen Gegner aufgerufen (normaler Kampf UND Dungeon/Turm, da beide
// dieselbe Funktion nutzen) - entscheidet pro Gegner, ob das Ebenensystem
// zeigen darf oder auf die bestehende Darstellung zurueckfallen muss. Kein
// falscher Drache moeglich: ohne passenden BKMP_COMBAT_ASSETS-Eintrag
// bleibt/wird #idleBattlefield aktiv, nie ein falsches Asset.
function bkmpProtoSyncForCurrentDragon(spriteKey) {
  if (!BKMP_LAYERED_COMBAT_ENABLED) return;
  if (spriteKey === bkmpProtoState.checkedSpriteKey) return;
  bkmpProtoState.checkedSpriteKey = spriteKey;

  const asset = bkmpCombatAssetFor(spriteKey);
  if (!asset) {
    bkmpProtoRevertToOriginal('kein Asset fuer "' + spriteKey + '"');
    return;
  }
  if (bkmpProtoState.loadedForSpriteKey === spriteKey && (bkmpProtoState.dragonOk || bkmpProtoState.dragonFailed)) {
    // Bereits (erfolgreich oder mit bekanntem Fehlschlag) fuer genau
    // diesen Gegner geladen - nichts erneut anstossen.
    if (bkmpProtoState.dragonOk && bkmpProtoState.bgOk) bkmpProtoTryReveal();
    return;
  }
  bkmpProtoLoadAsset(asset);
}

function bkmpProtoInit() {
  if (!BKMP_LAYERED_COMBAT_ENABLED) return;
  const hitArea = document.getElementById('bkmpProtoHitArea');
  if (hitArea) hitArea.addEventListener('click', (e) => {
    if (typeof bkmpIdleHandleDragonClick === 'function') bkmpIdleHandleDragonClick(e);
  });
  // Erst-Ladung: liest den bereits vorhandenen aktuellen Gegner (falls das
  // Dorf-Fenster schon offen ist) statt auf den naechsten Spawn zu warten.
  if (typeof bkmpIdleCurrentDragon !== 'undefined' && bkmpIdleCurrentDragon) {
    bkmpProtoSyncForCurrentDragon(bkmpIdleCurrentDragon.spriteKey);
  }
}

// Wiederverwendet die bereits in Section B eingefuehrte Sichtbarkeits-
// pruefung (bkmpIdleCombatVisualsActive) und den bestehenden Effekt-
// modus (bkmpFxGetMode) statt eigener neuer Systeme. Ein einzelnes, nie
// doppelt gestartetes Intervall (bkmpProtoState.pollStarted-Schutz)
// steuert Play/Pause beider Videos UND haelt die HP-Anzeigen synchron -
// kein zusaetzlicher Per-Frame-Aufwand, nur ein leichter Tick alle 700ms.
function bkmpProtoStartPollLoop() {
  if (bkmpProtoState.pollStarted) return;
  bkmpProtoState.pollStarted = true;
  bkmpProtoTick();
  window.setInterval(bkmpProtoTick, 700);
}

function bkmpProtoTick() {
  if (!bkmpProtoState.revealed) return;
  const bgVideo = document.getElementById('bkmpProtoBgVideo');
  const dragonVideo = document.getElementById('bkmpProtoDragonVideo');
  if (!bgVideo || !dragonVideo) return;

  const visualsActive = typeof bkmpIdleCombatVisualsActive === 'function' ? bkmpIdleCombatVisualsActive() : false;
  const fxMode = typeof bkmpFxGetMode === 'function' ? bkmpFxGetMode() : 'hoch';
  const wantBgPlaying = visualsActive && fxMode === 'hoch';
  const wantDragonPlaying = visualsActive && fxMode !== 'aus';

  if (wantBgPlaying && bgVideo.paused) bgVideo.play().catch(() => {});
  else if (!wantBgPlaying && !bgVideo.paused) bgVideo.pause();
  if (wantDragonPlaying && dragonVideo.paused) dragonVideo.play().catch(() => {});
  else if (!wantDragonPlaying && !dragonVideo.paused) dragonVideo.pause();

  // Beim Zurueckkehren (Tab/Fenster wieder sichtbar) sofort den echten
  // Zustand zeigen, nicht auf den naechsten Spiel-Tick warten.
  if (visualsActive) {
    if (typeof bkmpIdleUpdateVillageHpBar === 'function') bkmpIdleUpdateVillageHpBar();
    if (typeof bkmpIdleUpdateDragonHpBar === 'function') bkmpIdleUpdateDragonHpBar();
    bkmpProtoSyncDragonName();
  }
}

function bkmpProtoSyncDragonName() {
  const nameEl = document.getElementById('bkmpProtoDragonName');
  if (!nameEl || typeof bkmpIdleCurrentDragon === 'undefined' || !bkmpIdleCurrentDragon) return;
  const label = bkmpIdleCurrentDragon.name || '';
  const stage = typeof bkmpIdleFormatStage === 'function' && typeof bkmpIdleState !== 'undefined' && bkmpIdleState
    ? bkmpIdleFormatStage(bkmpIdleState.highest_dragon_index || 0) : '';
  nameEl.textContent = stage ? `${label} · Stufe ${stage}` : label;
}

// Kleine Trefferreaktion (Hit-Flash) beim Erkennen eines Wertverlusts -
// rein optisch, liest nur die schon von bkmpIdleUpdate*HpBar() gesetzte
// Balkenbreite, veraendert keine Werte. Selbstreinigend (ein Timeout pro
// Treffer, keine Warteschlange noetig).
function bkmpProtoFlashHit(cardId) {
  const fxMode = typeof bkmpFxGetMode === 'function' ? bkmpFxGetMode() : 'hoch';
  if (fxMode === 'aus') return;
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.remove('hit');
  void card.offsetWidth; // Reflow erzwingen, damit die Animation bei schnell aufeinanderfolgenden Treffern jedes Mal neu startet
  card.classList.add('hit');
  window.setTimeout(() => card.classList.remove('hit'), 260);
}

/* ---------------- Abschnitt 9/10: separater Treffereffekt ----------------
   Wird NUR aufgerufen, wenn der bestehende Kampfcode (bkmpIdleSpawnProjectile
   in bkmp-hud.js) ohnehin schon einen Treffer gegen den Drachen meldet -
   liest lediglich das dort bereits gewuerfelte isCrit, wuerfelt selbst
   nichts. Kein eigenes Bild-/Videoasset (keins bereitgestellt/validiert),
   reine CSS-Partikel-Ebene nach demselben bewaehrten Muster wie
   bkmpFireAchievementConfetti/bkmpRewardFireBurst (Phase 5.5) - kurz,
   nicht loopend, raeumt sich selbst auf, keine dauerhaften DOM-Elemente. */
function bkmpProtoSpawnHitFx(isCrit) {
  if (!bkmpProtoState.revealed) return;
  const fxMode = typeof bkmpFxGetMode === 'function' ? bkmpFxGetMode() : 'hoch';
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (fxMode === 'aus') return;
  const layer = document.getElementById('bkmpProtoEffects');
  if (!layer) return;
  const asset = bkmpCombatAssetFor(bkmpProtoState.checkedSpriteKey);
  const anchor = (asset && asset.anchors && asset.anchors.dragonHit) || { x: 78, y: 46 };

  const burst = document.createElement('div');
  burst.className = 'bkmp-proto-hit-fx' + (isCrit ? ' is-crit' : '');
  burst.style.left = anchor.x + '%';
  burst.style.top = anchor.y + '%';
  if (!reducedMotion) {
    const count = fxMode === 'reduziert' ? (isCrit ? 5 : 3) : (isCrit ? 10 : 5);
    burst.innerHTML = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 18 + Math.random() * (isCrit ? 34 : 20);
      const dx = Math.round(Math.cos(angle) * dist);
      const dy = Math.round(Math.sin(angle) * dist);
      const duration = (0.35 + Math.random() * 0.25).toFixed(2);
      return `<span style="--dx:${dx}px; --dy:${dy}px; animation-duration:${duration}s;"></span>`;
    }).join('');
  }
  layer.appendChild(burst);
  window.setTimeout(() => burst.remove(), 700);
}

bkmpProtoInit();

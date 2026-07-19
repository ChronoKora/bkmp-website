// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). js/systems/bkmp-cosmetics.js

function bkmpIdleFormatTitleBonus(title) {
  const fmt = BKMP_IDLE_EFFECT_LABELS[title.effectType];
  return fmt ? fmt(title.effectValue) : '';
}

/* Baut die komplette Titel-Boni-Liste (Ueberschrift + Zaehler + Hinweis +
   alle Zeilen) - wird sowohl im Sammlung- als auch im Erfolge-Tab gezeigt,
   damit man sie nicht extra suchen muss, egal welchen der beiden Tabs man
   zuerst aufmacht. */
function bkmpIdleBuildTitleBonusListHtml() {
  const ctx = bkmpIdleGetAchievementContextFields();
  const bonusTitles = window.BKMP_IDLE_TITLES.filter(t => t.effectType);
  const unlockedCount = bonusTitles.filter(t => bkmpIdleTitleUnlockedSticky(t, ctx)).length;
  const newBadge = typeof bkmpNewBadgeChecker === 'function' ? bkmpNewBadgeChecker('idletitles') : () => '';
  const rows = bonusTitles.map(title => {
    const unlocked = bkmpIdleTitleUnlockedSticky(title, ctx);
    return `
      <div class="achievement-row ${unlocked ? 'unlocked' : 'locked'}">
        ${newBadge(title.id)}
        <span class="achievement-icon">${unlocked ? '✅' : '🔒'}</span>
        <div class="achievement-body">
          <div class="achievement-title">${escapeHtml(title.name)}</div>
          <div class="achievement-desc">${escapeHtml(title.desc)}</div>
        </div>
        <span class="idle-title-bonus ${unlocked ? '' : 'idle-title-bonus-hidden'}">${unlocked ? escapeHtml(bkmpIdleFormatTitleBonus(title)) : '???'}</span>
      </div>`;
  }).join('');
  if (typeof bkmpMarkAllSeen === 'function') bkmpMarkAllSeen('idletitles', bonusTitles.map(t => t.id));
  return `
    <h4 class="idle-sammlung-subheading">🏅 Titel-Boni <span class="idle-sammlung-count">${unlockedCount}/${bonusTitles.length}</span></h4>
    <p class="idle-panel-hint">Jeder freigeschaltete Titel gibt einen dauerhaften Bonus - egal, welchen Titel du gerade als Namenszusatz trägst. Freigeschaltet bleibt freigeschaltet.</p>
    <div class="idle-title-bonus-list">${rows}</div>
  `;
}
const BKMP_ACTIVE_VILLAGE_SKIN_KEY = 'bkmp-active-village-skin';

function bkmpGetActiveVillageSkinId() {
  try { return localStorage.getItem(BKMP_ACTIVE_VILLAGE_SKIN_KEY) || 'standard'; } catch (e) { return 'standard'; }
}
function bkmpSetActiveVillageSkinId(skinId) {
  try { localStorage.setItem(BKMP_ACTIVE_VILLAGE_SKIN_KEY, skinId); } catch (e) { /* localStorage evtl. nicht verfuegbar (Privatmodus) - Auswahl gilt dann nur fuer diese Sitzung */ }
}

function bkmpVillageSkinOwned(skinId) {
  const def = bkmpVillageSkinsCatalog.find(s => s.id === skinId);
  if (!def) return false;
  return def.unlock_type === 'free' || bkmpPlayerVillageSkins.includes(skinId);
}

/* Setzt das tatsaechliche Hintergrundbild von #idleVillageSprite. Faellt
   auf 'standard' zurueck, falls die gewaehlte Skin-ID unbekannt oder (z.B.
   nach einem spaeteren Entzug) nicht mehr besessen ist - gleiche
   Nachpruef-Logik wie bkmpApplyActiveCosmetic bei den Namens-Kosmetiken,
   damit eine manipulierte localStorage-ID kein fremdes Bild erzwingen
   kann, das der Spieler nie freigeschaltet hat. */
/* FEHLER-FIX (Spieler-Report 14.07.: "Haben denn gleich Fehler wie beim
   Schaf! Bild bewegt sich von links nach rechts" statt sauber zu
   springen) - gleiche Ursache wie beim bereits geloesten Schaf-Sprite
   (bkmpSheepFrames, style.css): bei background-size N*100% darf das
   keyframe-Ziel NICHT 100% sein, sonst landen die steps(N)-
   Sprungpositionen von background-position-x auf Bruchteilen einer
   Frame-Breite statt auf ganzen Frame-Grenzen (offset = (Elementbreite -
   Hintergrundbreite) * Prozent/100 - mit Hintergrundbreite = N*Element-
   breite braucht ein glattes 0..100% ueber steps(N) das Ziel
   N/(N-1)*100%, nicht 100%). Da (anders als beim fest codierten Schaf)
   die Frame-Anzahl hier pro Skin variiert, wird das passende Keyframe
   dynamisch pro N erzeugt statt fest in style.css zu stehen. */
function bkmpEnsureVillageFrameKeyframes(frameCount) {
  const name = `idleVillageFrames${frameCount}`;
  let styleEl = document.getElementById('bkmpVillageSkinKeyframes');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'bkmpVillageSkinKeyframes';
    document.head.appendChild(styleEl);
  }
  const flagKey = 'frames' + frameCount;
  if (!styleEl.dataset[flagKey]) {
    const target = (frameCount / (frameCount - 1) * 100).toFixed(4);
    styleEl.appendChild(document.createTextNode(
      `@keyframes ${name} { from { background-position-x: 0%; } to { background-position-x: ${target}%; } }`
    ));
    styleEl.dataset[flagKey] = '1';
  }
  return name;
}

/* Verallgemeinert aus dem urspruenglich fest an #idleVillageSprite
   gebundenen Code (Spieler-Wunsch 14.07.: "Jeder mit seinem Dorfskin was
   er ausgerüstet hat" fuer die Arena-Kampfanimation) - nimmt jetzt ein
   beliebiges Element + eine Skin-ID entgegen, damit dieselbe Anzeige-Logik
   sowohl fuer das eigene Dorf im Kampf-Tab als auch fuer BEIDE Seiten der
   Arena-Animation (eigenes Dorf + Gegner-Dorf, gleichzeitig unterschiedliche
   Skins) genutzt werden kann. Ownership-Check (bkmpVillageSkinOwned) gilt
   nur fuer das EIGENE Dorf - beim Gegner wird jede vom Server gemeldete
   Skin-ID vertrauensvoll angezeigt (kein zusaetzlicher Katalog-Zugriff
   noetig, der Skin-Katalog ist ohnehin komplett bekannt). */
function bkmpApplyVillageSkinToElement(el, skinId, options) {
  if (!el) return;
  const checkOwnership = !options || options.checkOwnership !== false;
  let activeId = skinId || 'standard';
  let def = bkmpVillageSkinsCatalog.find(s => s.id === activeId);
  if (!def || (checkOwnership && !bkmpVillageSkinOwned(activeId))) {
    def = bkmpVillageSkinsCatalog.find(s => s.id === 'standard');
  }
  /* Nutzerwunsch (19.07.): "bei den Effekten deaktivieren-Option einbauen,
     das Flackern/Hochploppen vom Fight UND Dorfskins" - Effektmodus "Aus"
     haelt jetzt auch die Dorf-Skin-Animation an (Video-Skins wie
     Pinguindorf UND die Mehrfach-Frame-Sprite-Streifen wie Pilzdorf),
     gleiches Prinzip wie schon beim Drachen-Kampfvideo
     (bkmpIdleSyncDragonVideoPlayback, js/ui/bkmp-hud.js). Reiner Anzeige-
     Unterschied, keine Kampfwerte betroffen. */
  const fxOff = typeof bkmpFxVillageSkinAnimOff === 'function' && bkmpFxVillageSkinAnimOff();
  if (def && def.video_file) {
    /* Video-Skin (z.B. Pinguindorf) statt Bild-Sprite-Streifen: aspect-
       ratio wird hier auf die ECHTEN Video-Massse gesetzt (frame_aspect_w/h
       zweckentfremdet, siehe supabase-idle-village-skins-pinguindorf.sql),
       damit das Video ohne Zuschneiden/Verzerren exakt in den Container
       passt - object-fit:cover (style.css .idle-village-video) greift bei
       exakt passendem Seitenverhaeltnis ohnehin nicht sichtbar zu. */
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    el.style.animation = 'none';
    const aspectW = Number(def.frame_aspect_w || 16);
    const aspectH = Number(def.frame_aspect_h || 9);
    el.style.aspectRatio = `${aspectW} / ${aspectH}`;
    let video = el.querySelector('.idle-village-video');
    if (!video) {
      video = document.createElement('video');
      video.className = 'idle-village-video';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      el.appendChild(video);
    }
    if (video.dataset.src !== def.video_file) {
      video.src = def.video_file;
      video.dataset.src = def.video_file;
    }
    if (fxOff) { if (!video.paused) video.pause(); } else if (video.paused) { video.play().catch(() => {}); }
  } else if (def && def.image_file) {
    const existingVideo = el.querySelector('.idle-village-video');
    if (existingVideo) existingVideo.remove();
    el.style.backgroundImage = `url('${def.image_file}')`;
    const frameCount = Math.max(1, Number(def.frame_count || 1));
    const aspectW = Number(def.frame_aspect_w || 1164);
    const aspectH = Number(def.frame_aspect_h || 199);
    el.style.aspectRatio = `${aspectW} / ${aspectH}`;
    if (frameCount > 1 && !fxOff) {
      /* Mehrere leicht unterschiedliche Frames (ambiente Partikel-
         Variation, z.B. Pilzdorf) liegen als horizontaler Sprite-Streifen
         vor - background-size auf die Gesamtbreite des Streifens strecken
         und per steps() durchschalten, analog zum bestehenden Schaf-
         Sprite (bkmpSheepFrames). Feste 0.6s pro Frame, damit mehr Frames
         automatisch einen laengeren, ruhigeren Loop ergeben statt eines
         hektischeren. */
      el.style.backgroundSize = `${frameCount * 100}% 100%`;
      const kfName = bkmpEnsureVillageFrameKeyframes(frameCount);
      el.style.animation = `${kfName} ${(frameCount * 0.6).toFixed(1)}s steps(${frameCount}) infinite`;
    } else {
      /* fxOff: bleibt bewusst beim ersten Frame stehen (background-size
         100% statt frameCount*100%) statt nur die Animation zu pausieren -
         steps()-Animationen "pausiert" ueber animation-play-state wuerden
         sonst mitten in einem Frame haengen bleiben koennen, je nachdem
         wann genau umgeschaltet wird. */
      el.style.backgroundSize = '100% 100%';
      el.style.animation = 'none';
    }
  } else {
    const existingVideo = el.querySelector('.idle-village-video');
    if (existingVideo) existingVideo.remove();
    el.style.backgroundImage = '';
    el.style.animation = 'none';
  }
}

function bkmpApplyVillageSkin() {
  bkmpApplyVillageSkinToElement(document.getElementById('idleVillageSprite'), bkmpGetActiveVillageSkinId());
}

function bkmpIdleBuyVillageSkin(skinId) {
  const def = bkmpVillageSkinsCatalog.find(s => s.id === skinId);
  if (!def || def.unlock_type !== 'purchase' || !bkmpIdleState) return;
  if (bkmpVillageSkinOwned(skinId)) return;
  const goldCost = Number(def.price_gold || 0);
  const crystalCost = Number(def.price_crystals || 0);
  if ((bkmpIdleState.gold || 0) < goldCost || (bkmpIdleState.crystals || 0) < crystalCost) return;
  bkmpIdleState.gold -= goldCost;
  bkmpIdleState.crystals -= crystalCost;
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
  const nameKey = bkmpIdleState.name_key;
  Promise.resolve(typeof unlockPlayerVillageSkin === 'function' ? unlockPlayerVillageSkin(nameKey, skinId) : null)
    .then(row => {
      if (row) bkmpPlayerVillageSkins.push(skinId);
      bkmpIdleRenderSkinsPanel();
    })
    .catch(e => {
      /* Kauf-Zeile konnte nicht gespeichert werden (Migration evtl. noch
         nicht ausgefuehrt, oder Netzwerkfehler) - Gold bleibt trotzdem
         abgezogen (gleiches Verhalten wie ein normaler Upgrade-Kauf bei
         Sync-Fehlern), der Spieler kann es beim naechsten Laden erneut
         versuchen. */
      console.warn('Idle Dorf: Dorf-Skin-Kauf konnte nicht gespeichert werden.', e);
    });
}

function bkmpIdleEquipVillageSkin(skinId) {
  if (!bkmpVillageSkinOwned(skinId)) return;
  bkmpSetActiveVillageSkinId(skinId);
  bkmpApplyVillageSkin();
  bkmpIdleRenderSkinsPanel();
  /* Server-Sync (Spieler-Wunsch 14.07., Arena-Kampfanimation: "Jeder mit
     seinem Dorfskin was er ausgerüstet hat") - die aktive Skin-Wahl war
     bisher rein lokal (localStorage), andere Spieler (z.B. ein Arena-Gegner)
     konnten sie serverseitig gar nicht sehen. Landet ganz normal im
     naechsten periodischen Sync mit (bkmpIdleQueueSync), kein Sonderpfad
     noetig - siehe active_village_skin in supabase-idle-village-skin-
     sync.sql. */
  if (bkmpIdleState) {
    bkmpIdleState.active_village_skin = skinId;
    bkmpIdleQueueSync();
  }
}

function bkmpIdleRenderSkinsPanel() {
  const panel = document.getElementById('idlePanelSkins');
  if (!panel || !bkmpIdleState) return;
  const activeVillageId = bkmpGetActiveVillageSkinId();
  if (!bkmpVillageSkinsCatalog.length) {
    panel.innerHTML = `<p class="idle-skin-empty-hint">Noch keine Dorf-Skins verfuegbar - schau bald wieder vorbei.</p>`;
    return;
  }
  panel.innerHTML = `<div class="idle-skin-grid">${bkmpVillageSkinsCatalog.map(def => {
    const owned = bkmpVillageSkinOwned(def.id);
    const isEquipped = owned && activeVillageId === def.id;
    let actionHtml;
    let affordHtml = '';
    if (isEquipped) {
      actionHtml = `<button type="button" class="btn-ja idle-skin-action" disabled>Ausgerüstet</button>`;
    } else if (owned) {
      actionHtml = `<button type="button" class="btn-ja idle-skin-action idle-skin-equip" data-skin-id="${def.id}">Ausrüsten</button>`;
    } else if (def.unlock_type === 'purchase') {
      const goldCost = Number(def.price_gold || 0);
      const crystalCost = Number(def.price_crystals || 0);
      const affordable = (bkmpIdleState.gold || 0) >= goldCost && (bkmpIdleState.crystals || 0) >= crystalCost;
      const priceParts = [];
      if (goldCost > 0) priceParts.push(`💰 ${bkmpIdleFormatNumber(goldCost)}`);
      if (crystalCost > 0) priceParts.push(`💎 ${bkmpIdleFormatNumber(crystalCost)}`);
      actionHtml = `<button type="button" class="btn-ja idle-skin-action idle-skin-buy" data-skin-id="${def.id}" ${affordable ? '' : 'disabled'}>${priceParts.join(' + ') || 'Kaufen'}</button>`;
      /* Nutzerwunsch 19.07.: "mit hinzufügen wieviel man schon hat" - zeigt
         den eigenen Bestand direkt neben dem Preis, damit sichtbar ist, wie
         nah man am Kauf dran ist, statt nur "leistbar/nicht leistbar" zu
         wissen. Nur die Waehrung(en) anzeigen, die der Skin tatsaechlich
         kostet. */
      const ownedParts = [];
      if (goldCost > 0) ownedParts.push(`💰 ${bkmpIdleFormatNumber(bkmpIdleState.gold || 0)}`);
      if (crystalCost > 0) ownedParts.push(`💎 ${bkmpIdleFormatNumber(bkmpIdleState.crystals || 0)}`);
      affordHtml = `<div class="idle-skin-afford ${affordable ? 'is-affordable' : ''}">Du hast: ${ownedParts.join(' + ')}</div>`;
    } else if (def.unlock_type === 'real_money') {
      const priceEur = (Number(def.price_eur_cents || 0) / 100).toFixed(2).replace('.', ',');
      actionHtml = BKMP_REAL_MONEY_PURCHASES_ENABLED
        ? `<button type="button" class="btn-ja idle-skin-action idle-skin-buy-real-money" data-skin-id="${def.id}">Kaufen (${priceEur} €)</button>`
        : `<button type="button" class="btn-ja idle-skin-action idle-skin-buy-real-money-locked" data-skin-id="${def.id}" disabled title="Käufe sind noch nicht freigeschaltet">🔒 Kaufen (${priceEur} €)</button>`;
    } else {
      /* Nutzerwunsch 19.07.: "sollte die Anzahl auch stehen wieviel man
         davon schon hat" - fuer Zerstoertes Dorf/Yakshas Heimat gibt es
         bereits live gezaehlte Fortschritts-Werte (village_defeats/
         yaksha_boss_kills, siehe bkmpIdleCheckZerstoertesDorfUnlock/
         -YakshasHeimatUnlock in idledorf.js) - hier nur ergaenzend
         angezeigt, keine neue Zaehl-Logik. Andere Achievement-/Boss-Drop-
         Skins ohne bekannten Zaehler (Zerathor Dorf, Libers Heimat, ...)
         zeigen weiterhin nur den reinen Hinweistext. */
      const progressSource = {
        zerstoertesdorf: () => ({ current: Number(bkmpIdleState.village_defeats || 0), target: BKMP_ZERSTOERTES_DORF_UNLOCK_THRESHOLD }),
        yakshasheimat: () => ({ current: Number(bkmpIdleState.yaksha_boss_kills || 0), target: BKMP_YAKSHAS_HEIMAT_UNLOCK_THRESHOLD })
      }[def.id];
      const progress = progressSource ? progressSource() : null;
      const progressHtml = progress ? `<div class="idle-skin-afford">Du hast: ${bkmpIdleFormatNumber(progress.current)} von ${bkmpIdleFormatNumber(progress.target)}</div>` : '';
      actionHtml = `${progressHtml}<div class="idle-skin-locked-hint">🔒 ${escapeHtml(def.unlock_hint || (def.unlock_type === 'achievement' ? 'Über einen Erfolg freischaltbar' : 'Seltener Boss-Drop'))}</div>`;
    }
    return `
      <div class="idle-skin-card ${isEquipped ? 'idle-skin-card-equipped' : ''} ${def.unlock_type === 'real_money' ? 'idle-skin-card-premium' : ''}">
        <div class="idle-skin-icon">${def.icon || '🏘️'}</div>
        <div class="idle-skin-name">${escapeHtml(def.name)}</div>
        <div class="idle-skin-desc">${escapeHtml(def.description || '')}</div>
        ${affordHtml}
        ${actionHtml}
      </div>`;
  }).join('')}</div>`;
  panel.querySelectorAll('.idle-skin-buy').forEach(btn => btn.addEventListener('click', () => bkmpIdleBuyVillageSkin(btn.dataset.skinId)));
  panel.querySelectorAll('.idle-skin-equip').forEach(btn => btn.addEventListener('click', () => bkmpIdleEquipVillageSkin(btn.dataset.skinId)));
  panel.querySelectorAll('.idle-skin-buy-real-money').forEach(btn => btn.addEventListener('click', () => bkmpIdleOpenBuyFrameModal(btn.dataset.skinId)));
}

/* ---------------- Echtgeld-Kauf-Dialog (Steampunk Dorf etc.) ----------------
   Eigenes, kleines Modal statt des generischen bkmpConfirmDialog - braucht
   eine echte Checkbox fuer die gesetzlich vorgeschriebene ausdrueckliche
   Zustimmung zum sofortigen Beginn der Vertragsausfuehrung (§ 356 Abs. 5
   BGB, Verlust des 14-taegigen Widerrufsrechts bei digitalen Inhalten). */
function bkmpIdleOpenBuyFrameModal(skinId) {
  const overlay = document.getElementById('idleBuyFrameOverlay');
  const checkbox = document.getElementById('idleBuyFrameConsent');
  const confirmBtn = document.getElementById('idleBuyFrameConfirmBtn');
  const cancelBtn = document.getElementById('idleBuyFrameCancelBtn');
  if (!overlay || !checkbox || !confirmBtn || !cancelBtn || !bkmpIdleState) return;
  const def = bkmpVillageSkinsCatalog.find(s => s.id === skinId);
  const priceEur = (Number((def && def.price_eur_cents) || 0) / 100).toFixed(2).replace('.', ',');
  const nameLabel = document.getElementById('idleBuyFrameName');
  if (nameLabel) nameLabel.textContent = (def && def.name) || 'Artikel';
  checkbox.checked = false;
  confirmBtn.disabled = true;
  confirmBtn.textContent = `Weiter zu Stripe (${priceEur} €)`;
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');

  function onCheck() { confirmBtn.disabled = !checkbox.checked; }
  function cleanup() {
    overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
    checkbox.removeEventListener('change', onCheck);
    confirmBtn.removeEventListener('click', onConfirm);
    cancelBtn.removeEventListener('click', cleanup);
  }
  async function onConfirm() {
    if (!checkbox.checked || confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Wird vorbereitet...';
    try {
      const url = await bkmpCreateStripeCheckoutSession(bkmpIdleState.name_key, skinId);
      window.location.href = url;
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3600);
      confirmBtn.disabled = false;
      confirmBtn.textContent = `Weiter zu Stripe (${priceEur} €)`;
    }
  }
  checkbox.addEventListener('change', onCheck);
  confirmBtn.addEventListener('click', onConfirm);
  cancelBtn.addEventListener('click', cleanup);
}

/* Rueckkehr von Stripe: die success_url traegt NUR zur Anzeige bei ("Danke!"),
   die eigentliche Freischaltung ist zu diesem Zeitpunkt schon (oder in
   Kuerze) ueber den Webhook passiert. Kurzes Nachpollen, falls der Webhook
   minimal langsamer war als der Redirect. */
function bkmpIdleHandleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const purchase = params.get('purchase');
  if (!purchase) return;
  window.history.replaceState({}, '', window.location.pathname);
  if (purchase === 'cancelled') {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Kauf abgebrochen - es wurde nichts abgebucht.', 3200);
    return;
  }
  if (purchase !== 'success') return;
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) return;
  const ownedBefore = bkmpPlayerVillageSkins.length;
  let attempts = 0;
  const poll = () => {
    attempts += 1;
    Promise.resolve(bkmpIdleLoadOrInitState(name))
      .then(() => {
        if (typeof bkmpIdleRenderSkinsPanel === 'function') bkmpIdleRenderSkinsPanel();
        if (bkmpPlayerVillageSkins.length > ownedBefore) {
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🎉 Danke für deinen Kauf! Der neue Dorf-Skin ist freigeschaltet - im Dorf-Skins-Tab ausruestbar.', 4200);
        } else if (attempts < 4) {
          window.setTimeout(poll, 2000);
        } else if (typeof bkmpShowJannikToast === 'function') {
          bkmpShowJannikToast('Zahlung eingegangen - die Freischaltung braucht noch einen Moment, bitte gleich nochmal im Dorf-Skins-Tab nachschauen.', 5000);
        }
      })
      .catch(() => {});
  };
  poll();
}

/* Bug-Fix (Spieler-Meldung Kaledoss 18.07., "Purist"/"Grüner Daumen"/
   "Blaues Blut"/"Violette Vorherrschaft" - Runen-Raritaet-Titel: "wird auf
   der Seite gezaehlt, aber nicht im Game selbst"): Titel UND Kosmetiken
   pruefen ihre unlockCustom-Bedingung bisher IMMER live gegen den
   aktuellen Kontext - bei nicht-monotonen Bedingungen (z.B. "alle 6
   Runen-Plaetze gleiche Raritaet ausgeruestet", "alle Skilltree-Zweige
   maximiert") faellt der Titel/die Kosmetik faelschlich wieder auf
   "gesperrt" zurueck, sobald sich der Zustand seither aendert (Rune
   getauscht, Prestige-Reset) - obwohl sowohl der Hinweistext ("Jeder
   freigeschaltete Titel gibt einen dauerhaften Bonus... Freigeschaltet
   bleibt freigeschaltet.") als auch der Funktionskommentar bei
   bkmpIdleTitleEffectTotals das Gegenteil versprechen. GENAU dasselbe
   Bug-Muster wurde fuer Erfolge (BKMP_ACHIEVEMENTS) bereits am 13.07.
   behoben (siehe bkmpAchievementUnlocked in index.html) - hier dieselbe
   Loesung (localStorage-Merkliste "wurde je erreicht") fuer die beiden
   bisher uebersehenen Parallel-Systeme Titel/Kosmetik nachgezogen. Liegt
   bewusst in idledorf.js statt index.html, weil bkmpIdleTitleEffectTotals
   echte Kampf-Stats beeinflusst und auch auf idle-stream-mini.html
   (laedt index.html's Inline-Script NICHT) korrekt funktionieren muss. */
/* Balance-Audit-Fix (16.07., "kritischer Fund"): vorher lag die Merkliste
   NUR in localStorage - echter Datenverlust bei Geraetewechsel/Cache-Leeren
   (die Dauerboni aus bkmpIdleTitleEffectTotals unten verschwanden dann
   ersatzlos, obwohl Level/Kills/... laengst auf dem Server standen), UND
   mit einem einzigen localStorage-Eintrag im Browser faelschbar, OHNE die
   App je zu beruehren - ein deutlich niedrigerer Aufwand als jede andere
   Manipulation in dieser Wirtschaft. localStorage bleibt als synchroner
   Fast-Cache bestehen (diese Funktion wird sehr haeufig aufgerufen, u.a.
   bei jedem Stat-Rebuild, noch bevor bkmpIdleState immer sicher gesetzt
   ist), der eigentliche Speicherort ist jetzt aber bkmpIdleState.
   titles_unlocked_at (neue Spalte, siehe supabase-idle-title-unlock-
   persist.sql) - der ganz normal ueber upsertIdlePlayerState() mitgesichert
   wird wie der Rest des Spielstands. Alte, nur lokal bekannte
   Freischaltungen (Sessions von vor diesem Fix) werden beim ersten Lesen
   einmalig in bkmpIdleState uebernommen, damit niemand seine bereits
   erspielten Titel-Boni durch dieses Update verliert. */
const BKMP_IDLE_TITLE_UNLOCKED_AT_KEY = 'bkmp-idle-title-unlocked-at';
function bkmpIdleGetTitleUnlockedAtMap() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(BKMP_IDLE_TITLE_UNLOCKED_AT_KEY) || '{}'); } catch (e) {}
  const server = (bkmpIdleState && bkmpIdleState.titles_unlocked_at) || {};
  const merged = { ...local, ...server };
  if (bkmpIdleState && Object.keys(merged).length !== Object.keys(server).length) {
    bkmpIdleState.titles_unlocked_at = merged;
  }
  return merged;
}
function bkmpIdleSetTitleUnlockedAt(id) {
  const map = bkmpIdleGetTitleUnlockedAtMap();
  if (map[id]) return;
  map[id] = new Date().toISOString();
  try { localStorage.setItem(BKMP_IDLE_TITLE_UNLOCKED_AT_KEY, JSON.stringify(map)); } catch (e) {}
  if (bkmpIdleState) bkmpIdleState.titles_unlocked_at = map;
}
function bkmpIdleTitleUnlockedSticky(title, ctx) {
  if (!title.unlockCustom) return false;
  if (Boolean(title.unlockCustom(ctx))) { bkmpIdleSetTitleUnlockedAt(title.id); return true; }
  return Boolean(bkmpIdleGetTitleUnlockedAtMap()[title.id]);
}

/* Gleicher Fix wie bkmpIdleGetTitleUnlockedAtMap oben - siehe Kommentar
   dort. Kosmetiken haben keinen Kampf-Bonus, aber denselben Datenverlust-
   Bug (Freischaltungen verschwanden bei Geraetewechsel/Cache-Leeren). */
const BKMP_IDLE_COSMETIC_UNLOCKED_AT_KEY = 'bkmp-idle-cosmetic-unlocked-at';
function bkmpIdleGetCosmeticUnlockedAtMap() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(BKMP_IDLE_COSMETIC_UNLOCKED_AT_KEY) || '{}'); } catch (e) {}
  const server = (bkmpIdleState && bkmpIdleState.cosmetics_unlocked_at) || {};
  const merged = { ...local, ...server };
  if (bkmpIdleState && Object.keys(merged).length !== Object.keys(server).length) {
    bkmpIdleState.cosmetics_unlocked_at = merged;
  }
  return merged;
}
function bkmpIdleSetCosmeticUnlockedAt(id) {
  const map = bkmpIdleGetCosmeticUnlockedAtMap();
  if (map[id]) return;
  map[id] = new Date().toISOString();
  try { localStorage.setItem(BKMP_IDLE_COSMETIC_UNLOCKED_AT_KEY, JSON.stringify(map)); } catch (e) {}
  if (bkmpIdleState) bkmpIdleState.cosmetics_unlocked_at = map;
}
function bkmpIdleCosmeticUnlockedSticky(cosmetic, ctx) {
  if (!cosmetic.unlockCustom) return false;
  if (Boolean(cosmetic.unlockCustom(ctx))) { bkmpIdleSetCosmeticUnlockedAt(cosmetic.id); return true; }
  return Boolean(bkmpIdleGetCosmeticUnlockedAtMap()[cosmetic.id]);
}

/* Summiert die Boni aller FREIGESCHALTETEN (nicht nur des aktiv
   getragenen) Idle-Dorf-Titel - Sammlung-Prinzip: was du erreicht hast,
   bleibt dauerhaft wirksam, unabhaengig davon welchen Titel du gerade als
   Namenszusatz zeigst. */
function bkmpIdleTitleEffectTotals(ctx) {
  const totals = {};
  window.BKMP_IDLE_TITLES.forEach(title => {
    if (!title.effectType || !bkmpIdleTitleUnlockedSticky(title, ctx)) return;
    totals[title.effectType] = (totals[title.effectType] || 0) + (title.effectValue || 0);
  });
  return totals;
}

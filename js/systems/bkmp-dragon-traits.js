/* ============================================================
   Drachen: Affinitaeten, Eigenschaften, Bindung, Dex
   (Drachendorf-Ausbau Phase 4, 04.10.2026)

   - Eigenschaften: 11 positive Spezialisierungen (nur Expeditionen),
     serverseitig GENAU EINMAL pro Drache vergeben (dragon_ensure_traits).
   - Bindung 1-10: waechst nur durch echte Nutzung (Kampf-Begleiter ueber
     den serverseitigen Aktivitaets-Takt, Expeditionen). Meilensteine:
     2 Symbol, 4 Expeditionsbonus, 6 Rahmen, 8 staerkere Eigenschaft,
     10 "Seelengebunden".
   - Dex: Formen/Affinitaeten/Anzahl/Rekorde/Herkunft pro Art; Rekorde
     dauerhaft in der Chronik gespeichert (bkmpChronicleRecordDex).
   Alle Gutschriften/Zuweisungen sind serverseitig; dieser Client zeigt an
   und stoesst nur an.
   ============================================================ */

/* Anzeigenamen - werden aus dragon_traits ueberschrieben, sobald geladen.
   Gleiche IDs wie BKMP_DRAGON_TRAIT_IDS (bkmp-expedition-rules.js). */
const BKMP_DRAGON_TRAIT_LABELS = {
  gierig: 'Gierig', entdecker: 'Entdecker', sammler: 'Sammler', mutig: 'Mutig', schatzsucher: 'Schatzsucher',
  gesellig: 'Gesellig', einzelgaenger: 'Einzelgänger', forscher: 'Forscher', beschuetzer: 'Beschützer',
  glueckskind: 'Glückskind', heiler: 'Heiler'
};
const BKMP_DRAGON_TRAIT_ICONS = {
  gierig: '🪙', entdecker: '🧭', sammler: '🎒', mutig: '⚔️', schatzsucher: '💎', gesellig: '🐉',
  einzelgaenger: '🌙', forscher: '📚', beschuetzer: '🛡️', glueckskind: '✨', heiler: '🩹'
};
let bkmpDragonTraitCatalog = [];
let bkmpDragonTraitsMissing = false;
let bkmpDragonTraitsLoading = null;
let bkmpDragonTraitsAssignAt = 0;
let bkmpDragonActivityTimer = null;
let bkmpDragonActivityMissing = false;
const BKMP_DRAGON_ACTIVITY_INTERVAL_MS = 60000;

const BKMP_DRAGON_BOND_MILESTONES = {
  2: 'Ein kleines Herz-Symbol zeigt eure Verbindung.',
  4: 'Kleiner Expeditionsbonus für jedes Team.',
  6: 'Ein besonderer Rahmen im Drachenlager.',
  8: 'Die Eigenschaft des Drachen wirkt stärker.',
  10: '❤️ Seelengebunden.'
};

function bkmpDragonTraitsEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }

/* ---------- Katalog + einmalige Vergabe ---------- */
async function bkmpDragonTraitsEnsureCatalog() {
  if (bkmpDragonTraitCatalog.length || bkmpDragonTraitsMissing || typeof loadDragonTraits !== 'function') return;
  if (bkmpDragonTraitsLoading) return bkmpDragonTraitsLoading;
  bkmpDragonTraitsLoading = (async () => {
    try {
      const res = await loadDragonTraits();
      if (res.missing) { bkmpDragonTraitsMissing = true; return; }
      bkmpDragonTraitCatalog = res.rows || [];
      bkmpDragonTraitCatalog.forEach(t => { BKMP_DRAGON_TRAIT_LABELS[t.id] = t.name; BKMP_DRAGON_TRAIT_ICONS[t.id] = t.icon; });
    } catch (e) { /* Anzeige faellt auf die eingebauten Namen zurueck */ }
    finally { bkmpDragonTraitsLoading = null; }
  })();
  return bkmpDragonTraitsLoading;
}
function bkmpDragonTraitInfo(traitId) {
  if (!traitId) return null;
  const row = bkmpDragonTraitCatalog.find(t => t.id === traitId);
  return {
    id: traitId,
    name: BKMP_DRAGON_TRAIT_LABELS[traitId] || traitId,
    icon: BKMP_DRAGON_TRAIT_ICONS[traitId] || '✦',
    description: row ? row.description : ''
  };
}
function bkmpDragonIsGrownSafe(d) {
  return typeof bkmpDragonIsGrown === 'function' ? bkmpDragonIsGrown(d) : (d && d.stage === 'adult');
}
/* Vergibt fehlende Eigenschaften (gedrosselt auf hoechstens alle 30 s). */
async function bkmpDragonTraitsMaybeAssign() {
  if (typeof bkmpPlayerDragons === 'undefined' || typeof bkmpDragonEnsureTraitsRpc !== 'function') return;
  if (!bkmpPlayerDragons.some(d => bkmpDragonIsGrownSafe(d) && !d.trait)) return;
  if (Date.now() - bkmpDragonTraitsAssignAt < 30000) return;
  bkmpDragonTraitsAssignAt = Date.now();
  try {
    const res = await bkmpDragonEnsureTraitsRpc();
    if (res.missing || !res.rows.length) return;
    res.rows.forEach(r => {
      const d = bkmpPlayerDragons.find(x => x.id === r.id);
      if (d) d.trait = r.trait;
    });
    if (typeof bkmpIdleActiveTab !== 'undefined' && bkmpIdleActiveTab === 'drachen' && typeof bkmpIdleRenderDragonsPanel === 'function') bkmpIdleRenderDragonsPanel();
  } catch (e) { /* naechster Versuch beim naechsten Aufbau */ }
}

/* Aufgerufen nach dem Laden der Drachenzucht-Daten (bkmp-breeding.js). */
function bkmpDragonTraitsAfterLoad() {
  bkmpDragonTraitsEnsureCatalog().then(() => bkmpDragonTraitsMaybeAssign()).catch(() => {});
  bkmpDexReconcile();
}

/* ---------- Bindung ---------- */
function bkmpDragonBondOf(d) {
  return typeof bkmpDragonBondLevel === 'function' ? bkmpDragonBondLevel(d && d.bond_xp) : 1;
}
function bkmpDragonBondCardClass(d) {
  const lvl = bkmpDragonBondOf(d);
  return lvl >= 10 ? ' dd-bond-soul' : lvl >= 6 ? ' dd-bond-frame' : '';
}
function bkmpDragonBondProgress(d) {
  const xp = Number((d && d.bond_xp) || 0);
  const lvl = bkmpDragonBondOf(d);
  const t = typeof BKMP_DRAGON_BOND_THRESHOLDS !== 'undefined' ? BKMP_DRAGON_BOND_THRESHOLDS : [0];
  if (lvl >= 10) return { lvl, pct: 100, toNext: 0 };
  const lo = t[lvl - 1] || 0, hi = t[lvl] || lo + 1;
  return { lvl, pct: Math.max(0, Math.min(100, Math.round(((xp - lo) / (hi - lo)) * 100))), toNext: hi - xp };
}
function bkmpDragonAffinityIconsHtml(species) {
  const affs = (species && Array.isArray(species.affinities)) ? species.affinities : [];
  if (!affs.length || typeof BKMP_AFFINITY_META === 'undefined') return '';
  return affs.map(a => BKMP_AFFINITY_META[a] ? `<span class="dd-aff" title="${BKMP_AFFINITY_META[a].label}">${BKMP_AFFINITY_META[a].icon}</span>` : '').join('');
}
/* Kleine Zeile auf der Lager-Karte: Elemente · Eigenschaft · Bindung. */
function bkmpDragonIdentityHtml(d, species) {
  if (!d || !bkmpDragonIsGrownSafe(d)) return '';
  const parts = [];
  const aff = bkmpDragonAffinityIconsHtml(species);
  if (aff) parts.push(`<span class="dd-id-aff">${aff}</span>`);
  const t = bkmpDragonTraitInfo(d.trait);
  if (t) parts.push(`<span class="dd-id-trait" title="${bkmpDragonTraitsEsc(t.description)}">${t.icon} ${bkmpDragonTraitsEsc(t.name)}</span>`);
  const lvl = bkmpDragonBondOf(d);
  parts.push(lvl >= 10
    ? `<span class="dd-id-bond is-soul" title="Seelengebunden">❤️ Seelengebunden</span>`
    : `<span class="dd-id-bond" title="Bindung ${lvl}/10">${lvl >= 2 ? '❤️' : '🤍'} ${lvl}</span>`);
  return `<div class="dd-dragon-identity">${parts.join('<span class="dd-id-sep">·</span>')}</div>`;
}
/* Ausfuehrlicher Block fuer das Drachen-Detailfenster. */
function bkmpDragonDetailExtraHtml(d, species) {
  if (!d) return '';
  const lines = [];
  const aff = bkmpDragonAffinityIconsHtml(species);
  const affNames = (species && species.affinities || []).map(a => (typeof BKMP_AFFINITY_META !== 'undefined' && BKMP_AFFINITY_META[a]) ? BKMP_AFFINITY_META[a].label : a).join(', ');
  if (aff) lines.push(`<div>Elemente: ${aff} ${bkmpDragonTraitsEsc(affNames)}</div>`);
  if (bkmpDragonIsGrownSafe(d)) {
    const t = bkmpDragonTraitInfo(d.trait);
    lines.push(t ? `<div>Eigenschaft: <strong>${t.icon} ${bkmpDragonTraitsEsc(t.name)}</strong> – ${bkmpDragonTraitsEsc(t.description)}</div>` : '<div>Eigenschaft: wird gleich enthüllt…</div>');
    const b = bkmpDragonBondProgress(d);
    lines.push(`<div>Bindung: <strong>${b.lvl >= 10 ? '❤️ Seelengebunden (10/10)' : b.lvl + '/10'}</strong>${b.lvl < 10 ? ` <span class="dd-muted">(${b.pct} % bis Stufe ${b.lvl + 1})</span>` : ''}</div>`);
    const next = [2, 4, 6, 8, 10].find(m => m > b.lvl);
    if (next) lines.push(`<div class="dd-muted">Nächster Meilenstein (Bindung ${next}): ${bkmpDragonTraitsEsc(BKMP_DRAGON_BOND_MILESTONES[next])}</div>`);
    const kills = Number(d.companion_kills || 0), exps = Number(d.expeditions_completed || 0);
    if (kills || exps) lines.push(`<div class="dd-muted">Gemeinsam erlebt: ${typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber(kills) : kills} Siege als Begleiter · ${exps} Expeditionen</div>`);
  }
  return lines.join('');
}

/* ---------- Aktivitaets-Takt (Bindung durch echte Nutzung) ---------- */
async function bkmpDragonActivityTick() {
  if (bkmpDragonActivityMissing || typeof bkmpDragonActivityTickRpc !== 'function') return;
  const overlay = document.getElementById('idleDorfOverlay');
  /* Fenster zu: Takt beenden (startet beim naechsten Oeffnen neu, siehe
     bkmpDragonTraitsOnIdleOpen) - kein Dauer-Intervall im Hintergrund. */
  if (!overlay || !overlay.classList.contains('visible')) {
    if (bkmpDragonActivityTimer) { window.clearInterval(bkmpDragonActivityTimer); bkmpDragonActivityTimer = null; }
    return;
  }
  if (document.hidden) return;
  if (typeof bkmpPlayerDragons === 'undefined' || !bkmpPlayerDragons.some(d => d.is_companion && bkmpDragonIsGrownSafe(d))) return;
  try {
    const res = await bkmpDragonActivityTickRpc();
    if (res.missing) { bkmpDragonActivityMissing = true; return; }
    (res.dragons || []).forEach(row => {
      const d = bkmpPlayerDragons.find(x => x.id === row.id);
      if (!d) return;
      const before = bkmpDragonBondOf(d);
      d.bond_xp = Number(row.bond_xp || 0);
      d.companion_kills = Number(row.companion_kills || 0);
      d.companion_boss_kills = Number(row.companion_boss_kills || 0);
      d.companion_seconds = Number(row.companion_seconds || 0);
      const after = bkmpDragonBondOf(d);
      if (after > before) bkmpDragonAnnounceBond(d, after);
    });
    if ((res.dragons || []).length) bkmpDexReconcile();
  } catch (e) { /* ruhig - naechster Takt */ }
}
function bkmpDragonAnnounceBond(d, lvl) {
  const sp = typeof bkmpDragonSpeciesById === 'function' ? bkmpDragonSpeciesById(d.species_id) : null;
  const name = d.nickname || (sp ? sp.name : 'Dein Drache');
  const extra = BKMP_DRAGON_BOND_MILESTONES[lvl] ? ' – ' + BKMP_DRAGON_BOND_MILESTONES[lvl] : '';
  const text = lvl >= 10 ? `❤️ ${name} ist jetzt seelengebunden!` : `💞 Bindung mit ${name}: Stufe ${lvl}${extra}`;
  if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text, kind: 'success', ms: 4200 });
  else if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(text, 4200);
}
function bkmpDragonTraitsOnIdleOpen() {
  bkmpDragonTraitsEnsureCatalog().catch(() => {});
  if (bkmpDragonActivityTimer) return;
  bkmpDragonActivityTimer = window.setInterval(bkmpDragonActivityTick, BKMP_DRAGON_ACTIVITY_INTERVAL_MS);
  /* Erster Bericht setzt nur die Ausgangswerte (serverseitig). */
  window.setTimeout(bkmpDragonActivityTick, 5000);
}

/* ---------- Dex ---------- */
const BKMP_DEX_FORM_INDEX = { egg: 0, baby: 1, teen: 2, adult: 3, divine: 4 };
function bkmpDexReconcile() {
  if (typeof bkmpChronicleRecordDex !== 'function' || typeof bkmpPlayerDragons === 'undefined') return;
  const per = {};
  (typeof bkmpPlayerDragonEggs !== 'undefined' ? bkmpPlayerDragonEggs : []).forEach(e => {
    per[e.species_id] = per[e.species_id] || [0, 0, 0, 0];
  });
  bkmpPlayerDragons.forEach(d => {
    const r = per[d.species_id] = per[d.species_id] || [0, 0, 0, 0];
    r[0] = Math.max(r[0], BKMP_DEX_FORM_INDEX[d.stage] || 0);
    r[1] = Math.max(r[1], Number(d.ascension_level || 0));
    r[2] = Math.max(r[2], bkmpDragonIsGrownSafe(d) ? bkmpDragonBondOf(d) : 0);
    r[3] += Number(d.expeditions_completed || 0);
  });
  Object.keys(per).forEach(id => bkmpChronicleRecordDex(id, per[id][0], per[id][1], per[id][2], per[id][3]));
}
function bkmpDexRecord(speciesId) {
  const rec = typeof bkmpChronicleDexRecords === 'function' ? bkmpChronicleDexRecords()[speciesId] : null;
  return rec || null;
}
/* Kennzahlen fuer Sammlungsziele (keine fest eingebaute Gesamtzahl). */
function bkmpDexStats() {
  const catalog = (typeof bkmpDragonSpeciesCatalog !== 'undefined' ? bkmpDragonSpeciesCatalog : []).filter(s => s.active !== false);
  const discoveredMap = (bkmpIdleState && bkmpIdleState.dragon_species_discovered_at) || {};
  const recs = typeof bkmpChronicleDexRecords === 'function' ? bkmpChronicleDexRecords() : {};
  const discovered = catalog.filter(s => discoveredMap[s.id]);
  const adultSpecies = catalog.filter(s => (recs[s.id] && recs[s.id][0] >= 3));
  const dragons = typeof bkmpPlayerDragons !== 'undefined' ? bkmpPlayerDragons : [];
  return {
    total: catalog.length,
    discovered: discovered.length,
    pct: catalog.length ? Math.floor((discovered.length / catalog.length) * 100) : 0,
    adultSpecies: adultSpecies.length,
    epicAdult: adultSpecies.filter(s => s.rarity === 'episch').length,
    legendaryAdult: adultSpecies.filter(s => s.rarity === 'legendaer').length,
    expeditionDragons: dragons.filter(d => Number(d.expeditions_completed || 0) > 0).length,
    soulbound: dragons.filter(d => bkmpDragonBondOf(d) >= 10).length,
    divineSpecies: catalog.filter(s => recs[s.id] && recs[s.id][0] >= 4).length
  };
}
function bkmpDexStatsLineHtml() {
  const s = bkmpDexStats();
  if (!s.total) return '';
  return `<p class="dd-muted dd-dex-stats" data-testid="dex-stats">${s.discovered}/${s.total} Arten entdeckt (${s.pct} %) · ${s.adultSpecies} Arten erwachsen gezüchtet · ${s.epicAdult} episch · ${s.legendaryAdult} legendär${s.soulbound ? ` · ❤️ ${s.soulbound} seelengebunden` : ''}</p>`;
}
/* Infoblock im Dex-Detailfenster. */
function bkmpDexInfoHtml(species, discovered) {
  if (!species || !discovered) return '';
  const rec = bkmpDexRecord(species.id) || [0, 0, 0, 0];
  const dragons = (typeof bkmpPlayerDragons !== 'undefined' ? bkmpPlayerDragons : []).filter(d => d.species_id === species.id);
  const eggs = (typeof bkmpPlayerDragonEggs !== 'undefined' ? bkmpPlayerDragonEggs : []).filter(e => e.species_id === species.id).length;
  const affNames = (species.affinities || []).map(a => (typeof BKMP_AFFINITY_META !== 'undefined' && BKMP_AFFINITY_META[a]) ? BKMP_AFFINITY_META[a].icon + ' ' + BKMP_AFFINITY_META[a].label : a).join(', ') || '–';
  const stages = typeof bkmpDragonSpeciesStages === 'function' ? bkmpDragonSpeciesStages(species) : ['egg', 'baby', 'teen', 'adult'];
  const formNames = { egg: 'Ei', baby: 'Baby', teen: 'Jugendlich', adult: 'Erwachsen', divine: species.final_stage_label || 'Göttlich' };
  const reached = stages.filter(st => (BKMP_DEX_FORM_INDEX[st] || 0) <= rec[0]).map(st => formNames[st]).join(' → ');
  const lines = [
    `<div>Elemente: ${bkmpDragonTraitsEsc(affNames)}</div>`,
    `<div>Im Besitz: ${dragons.length} ${dragons.length === 1 ? 'Drache' : 'Drachen'}${eggs ? ` · ${eggs} ${eggs === 1 ? 'Ei' : 'Eier'}` : ''}</div>`,
    `<div>Erreichte Formen: ${bkmpDragonTraitsEsc(reached || 'Ei')}</div>`,
    `<div>Höchster Aufstieg: ${rec[1]} · Höchste Bindung: ${rec[2] || '–'}${rec[2] >= 10 ? ' ❤️' : ''}</div>`,
    `<div>Expeditionen: ${rec[3] || 0}</div>`
  ];
  if (species.event_origin) lines.push(`<div>Herkunft: ${bkmpDragonTraitsEsc(species.event_origin)}</div>`);
  return lines.join('');
}

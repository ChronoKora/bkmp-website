/* ============================================================
   ✨ Goettliche Erweckung (Drachendorf-Ausbau Phase 10, 04.10.2026)

   "Weg zur Goettlichkeit" in der Drachen-Detailansicht fuer alle Arten mit
   fuenfter Form (datengetrieben: dragon_species.stage_count = 5 +
   divine_config, nicht fest auf Lightnix/Darknix). Alle Zahlen kommen vom
   Server (divine_status), Einzahlen/Erwecken laufen nur ueber
   divine_offer/divine_awaken (sql/20261004-09-divine-awakening.sql).
   Nach einer Server-Buchung wird derselbe Betrag lokal gespiegelt (vorher
   wird gespeichert), damit der naechste Autosave nichts zurueckschreibt.
   ============================================================ */

let bkmpDivineBusy = false;

function bkmpDivineEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }
function bkmpDivineFmt(n) { return typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber(n) : String(Math.floor(n)); }
function bkmpDivineToast(text, kind) {
  if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text, kind: kind || 'info', ms: 4000 });
  else if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(text, 4000);
}
function bkmpDivineAura(species) {
  return species && species.special_passive && species.special_passive.divine_aura ? species.special_passive.divine_aura : null;
}
function bkmpDivineSpeciesEligible(species) {
  return !!species && Number(species.stage_count || 4) >= 5;
}

/* Hook aus bkmpDragonOpenDetail (bkmp-breeding.js). */
function bkmpDivineDetailMount(dragon, species, container) {
  if (!container || !dragon || !bkmpDivineSpeciesEligible(species)) return;
  if (dragon.stage !== 'adult' && dragon.stage !== 'divine') {
    const aura = bkmpDivineAura(species);
    container.insertAdjacentHTML('beforeend', `<div class="dd-divine" data-testid="divine-panel">
      <div class="dd-divine-title">✨ Fünfte Form: ${bkmpDivineEsc(species.final_stage_label || 'Göttlich')}</div>
      <div class="dd-muted">Sobald ${bkmpDivineEsc(species.name)} erwachsen ist, beginnt hier der Weg zur Göttlichkeit.${aura ? ` Danach wirkt die ${bkmpDivineEsc(aura.name)}.` : ''}</div>
    </div>`);
    return;
  }
  const box = document.createElement('div');
  box.className = 'dd-divine';
  box.setAttribute('data-testid', 'divine-panel');
  box.setAttribute('data-dragon-id', dragon.id);
  box.innerHTML = '<div class="dd-divine-title">✨ Weg zur Göttlichkeit</div><div class="dd-muted">⏳ Wird geladen…</div>';
  container.appendChild(box);
  bkmpDivineLoadInto(box, dragon, species);
}
async function bkmpDivineLoadInto(box, dragon, species) {
  if (typeof bkmpDivineStatusRpc !== 'function') { box.remove(); return; }
  let st;
  try { st = await bkmpDivineStatusRpc(dragon.id); } catch (e) { box.innerHTML = `<div class="dd-muted">${bkmpDivineEsc(e.message || e)}</div>`; return; }
  if (!st || st.missing || !st.eligible_species) { box.remove(); return; }
  box.innerHTML = bkmpDivinePanelHtml(dragon, species, st);
  box.querySelectorAll('[data-divine-offer]').forEach(btn => btn.addEventListener('click', () => bkmpDivineOffer(dragon.id, Number(btn.dataset.divineOffer) || 0, box, species)));
  const aw = box.querySelector('[data-divine-awaken]');
  if (aw) aw.addEventListener('click', () => bkmpDivineAwaken(dragon.id, box, species));
}
function bkmpDivineLine(icon, label, have, need, fmt) {
  const ok = Number(have) >= Number(need);
  return `<div class="dd-divine-line${ok ? ' is-done' : ''}">${icon} ${bkmpDivineEsc(label)}: <strong>${fmt(have)} / ${fmt(need)}</strong> ${ok ? '✅' : ''}</div>`;
}
function bkmpDivinePanelHtml(dragon, species, st) {
  const aura = bkmpDivineAura(species);
  const auraHtml = aura ? `<div class="dd-divine-aura">${bkmpDivineEsc(aura.icon || '✨')} <strong>${bkmpDivineEsc(aura.name)}</strong><br><span class="dd-muted">${bkmpDivineEsc(aura.text || '')}</span></div>` : '';
  if (st.divine) {
    const since = st.awakened_at ? new Date(st.awakened_at).toLocaleDateString('de-DE') : '';
    return `<div class="dd-divine-title">✨ ${bkmpDivineEsc(species.final_stage_label || 'Göttlich')}${since ? ` <span class="dd-muted">seit ${bkmpDivineEsc(since)}</span>` : ''}</div>
      <div class="dd-divine-line is-done">💪 Stärke: Hauptwerte ×${bkmpDivineEsc(st.divine_multiplier)} · Zusatzwerte ×${bkmpDivineEsc(1 + (Number(st.divine_multiplier) - 1) / 2)}</div>
      ${auraHtml}`;
  }
  const hours = v => (Math.floor(Number(v) / 360) / 10).toLocaleString('de-DE');
  const num = v => bkmpDivineFmt(v);
  const pct = Math.min(100, Math.floor(Number(st.offering_units || 0) / Math.max(1, Number(st.need_units)) * 100));
  const remainingUnits = Math.max(0, Number(st.need_units) - Number(st.offering_units || 0));
  const unit = Math.max(1, Number(st.gold_unit) || 1);
  const remainingGold = Math.ceil(remainingUnits * unit);
  const gold = Math.floor(Number((typeof bkmpIdleState !== 'undefined' && bkmpIdleState && bkmpIdleState.gold) || 0));
  const offerBtn = (label, amount) => {
    const a = Math.min(amount, remainingGold, gold);
    return `<button type="button" class="btn-nein dd-divine-offer-btn" data-divine-offer="${a}" ${a >= unit && !bkmpDivineBusy ? '' : 'disabled'}>${label}<br><small>${num(a)} Gold</small></button>`;
  };
  const usageOk = Number(st.bond_level) >= Number(st.need_bond) && Number(st.companion_seconds) >= Number(st.need_seconds)
    && Number(st.boss_kills) >= Number(st.need_boss_kills) && Number(st.expeditions) >= Number(st.need_expeditions);
  const offeringOk = remainingUnits <= 0;
  const crystals = Number((bkmpIdleState && bkmpIdleState.crystals) || 0), essence = Number((bkmpIdleState && bkmpIdleState.essence) || 0);
  const resOk = crystals >= Number(st.need_crystals) && essence >= Number(st.need_essence);
  const ready = usageOk && offeringOk && resOk && dragon.stage === 'adult';
  return `<div class="dd-divine-title">✨ Weg zur Göttlichkeit</div>
    ${bkmpDivineLine('❤️', 'Bindung', st.bond_level, st.need_bond, v => String(v))}
    ${bkmpDivineLine('⚔️', 'Gemeinsame Kampfzeit (Std.)', st.companion_seconds, st.need_seconds, hours)}
    ${bkmpDivineLine('👑', 'Bosse gemeinsam', st.boss_kills, st.need_boss_kills, num)}
    ${bkmpDivineLine('🧭', 'Expeditionen', st.expeditions, st.need_expeditions, num)}
    <div class="dd-divine-line${offeringOk ? ' is-done' : ''}" data-testid="divine-offering">💰 Opfergabe: <strong>${pct} %</strong> ${offeringOk ? '✅' : `<span class="dd-muted">(noch ${num(remainingGold)} Gold)</span>`}</div>
    <div class="idle-xp-bar dd-divine-bar"><div class="idle-xp-fill" style="width:${pct}%"></div></div>
    ${offeringOk ? '' : `<div class="dd-divine-offers">${offerBtn('Spende 10 %', Math.ceil(Number(st.need_units) * unit * 0.1))}${offerBtn('Spende 25 %', Math.ceil(Number(st.need_units) * unit * 0.25))}${offerBtn('Alles bis zum Ziel', remainingGold)}</div>`}
    <div class="dd-divine-line${resOk ? ' is-done' : ''}">💎 ${num(st.need_crystals)} Kristalle · 🧪 ${num(st.need_essence)} Essenz bei der Erweckung ${resOk ? '✅' : ''}</div>
    <div class="dd-muted">Erweckung ohne Zufall: sind alle Bedingungen erfüllt, gelingt sie immer. Stärke danach: Hauptwerte ×${bkmpDivineEsc(st.stat_multiplier)}, dazu die göttliche Aura.</div>
    ${auraHtml}
    <button type="button" class="btn-ja dd-divine-awaken" data-divine-awaken="1" data-testid="divine-awaken-btn" ${ready && !bkmpDivineBusy ? '' : 'disabled'}>✨ Göttliche Erweckung</button>`;
}

async function bkmpDivineOffer(dragonId, gold, box, species) {
  if (bkmpDivineBusy || gold <= 0) return;
  bkmpDivineBusy = true;
  try {
    if (typeof bkmpIdleFlushSyncNow === 'function') { try { await bkmpIdleFlushSyncNow(); } catch (e) { /* weiter */ } }
    const res = await bkmpDivineOfferRpc(dragonId, gold);
    if (res && bkmpIdleState) {
      bkmpIdleState.gold = Math.max(0, Number(bkmpIdleState.gold || 0) - Number(res.spent || 0));
      const d = bkmpPlayerDragons.find(x => x.id === dragonId);
      if (d) d.divine_offering_gold = Number(d.divine_offering_gold || 0) + Number(res.spent || 0);
      if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
      if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();
      bkmpDivineToast(res.complete ? '💰 Die Opfergabe ist vollständig!' : `💰 ${bkmpDivineFmt(res.spent)} Gold geopfert.`, 'success');
    }
  } catch (e) {
    bkmpDivineToast(e.message || String(e), 'danger');
  }
  bkmpDivineBusy = false;
  const d = bkmpPlayerDragons.find(x => x.id === dragonId);
  if (d && box && box.isConnected) bkmpDivineLoadInto(box, d, species);
}
async function bkmpDivineAwaken(dragonId, box, species) {
  if (bkmpDivineBusy) return;
  const d = bkmpPlayerDragons.find(x => x.id === dragonId);
  if (!d) return;
  const label = species.final_stage_label || 'Göttlich';
  const ok = typeof bkmpConfirmDialog === 'function'
    ? await bkmpConfirmDialog(`✨ ${species.name} erwecken?`, `${species.name} wird ${label}. Name, Eigenschaft, Bindung und alles Erlebte bleiben erhalten.`, 'Erwecken', 'Abbrechen')
    : window.confirm(`${species.name} erwecken?`);
  if (!ok) return;
  bkmpDivineBusy = true;
  try {
    if (typeof bkmpIdleFlushSyncNow === 'function') { try { await bkmpIdleFlushSyncNow(); } catch (e) { /* weiter */ } }
    const res = await bkmpDivineAwakenRpc(dragonId);
    if (res) {
      d.stage = 'divine';
      d.divine_multiplier = Number(res.divine_multiplier) || 1;
      d.awakened_at = res.awakened_at || new Date().toISOString();
      bkmpIdleState.crystals = Math.max(0, Number(bkmpIdleState.crystals || 0) - Number(res.crystals || 0));
      bkmpIdleState.essence = Math.max(0, Number(bkmpIdleState.essence || 0) - Number(res.essence || 0));
      if (typeof bkmpDexReconcile === 'function') bkmpDexReconcile();
      if (typeof bkmpIdleRecomputeEffectiveStats === 'function') bkmpIdleRecomputeEffectiveStats();
      if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
      if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();
      if (typeof bkmpRewardPresent === 'function') {
        bkmpRewardPresent({ tier: 'ceremony', rarity: 'legendaer', title: `✨ ${String(species.name).toUpperCase()} – ${String(label).toUpperCase()}`, description: 'Dieser Drache hat seine göttliche Form erreicht.', dedupeKey: 'divine-' + dragonId });
      } else {
        bkmpDivineToast(`✨ ${species.name} ist jetzt ${label}!`, 'success');
      }
      if (typeof bkmpIdleRenderDragonsPanel === 'function') bkmpIdleRenderDragonsPanel();
      if (typeof bkmpDragonOpenDetail === 'function') bkmpDragonOpenDetail(dragonId);
    }
  } catch (e) {
    bkmpDivineToast(e.message || String(e), 'danger');
  }
  bkmpDivineBusy = false;
  if (box && box.isConnected && d.stage !== 'divine') bkmpDivineLoadInto(box, d, species);
}

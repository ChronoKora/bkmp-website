/* ============================================================
   🏗️ Woechentliches Gildenprojekt (Drachendorf-Ausbau Phase 6, 04.10.2026)

   Abschnitt im Gilde-Reiter. Mitglieder zahlen Ressourcen ein (Server
   rechnet in Projektpunkte um und zieht ab, Client spiegelt den Abzug).
   Fertig -> jede Person mit mind. 10 Punkten holt einmal eine kleine
   Belohnung ab (Kristalle/Essenz serverseitig, Rune wie Dungeon-Funde).
   ============================================================ */

let bkmpGuildProjectStatus = null;
let bkmpGuildProjectMissing = false;
let bkmpGuildProjectLoadedAt = 0;
let bkmpGuildProjectLoading = null;
let bkmpGuildProjectBusy = false;

const BKMP_GUILD_PROJECT_KIND_META = {
  gold: { icon: '💰', label: 'Gold' }, wood: { icon: '🌳', label: 'Holz' }, stone: { icon: '🗿', label: 'Stein' },
  crystals: { icon: '💎', label: 'Kristalle' }, essence: { icon: '🧪', label: 'Essenz' }
};
/* Wie viel einer Ressource ergibt 1 Projektpunkt (identisch zur SQL). */
function bkmpGuildProjectPerPoint(kind) {
  let base = 5;
  if (kind === 'gold') base = 20 * Number((bkmpGuildProjectStatus && bkmpGuildProjectStatus.gold_unit) || 6);
  else if (kind === 'wood' || kind === 'stone') base = 100;
  /* Gildenwoche (Phase 11): Server liefert den laufenden Bonus mit. */
  const mod = Math.max(0, Math.min(100, Number((bkmpGuildProjectStatus && bkmpGuildProjectStatus.point_mod_pct) || 0)));
  return Math.max(1, Math.round(base / (1 + mod / 100)));
}
function bkmpGuildProjectEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }
function bkmpGuildProjectFmt(n) { return typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber(n) : String(n); }
function bkmpGuildProjectToast(text, kind) {
  if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text, kind: kind || 'info', ms: 3600 });
  else if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(text, 3600);
}

async function bkmpGuildProjectEnsureLoaded(force) {
  if (bkmpGuildProjectMissing || typeof bkmpGuildProjectStatusRpc !== 'function') return;
  if (bkmpGuildProjectLoading) return bkmpGuildProjectLoading;
  if (!force && bkmpGuildProjectStatus && Date.now() - bkmpGuildProjectLoadedAt < 30000) return;
  bkmpGuildProjectLoading = (async () => {
    try {
      const st = await bkmpGuildProjectStatusRpc();
      if (st.missing) { bkmpGuildProjectMissing = true; return; }
      bkmpGuildProjectStatus = st;
      bkmpGuildProjectLoadedAt = Date.now();
    } catch (e) { /* letzter Stand bleibt */ }
    finally { bkmpGuildProjectLoading = null; }
  })();
  return bkmpGuildProjectLoading;
}
function bkmpGuildProjectRerenderGuild() {
  if (typeof bkmpIdleActiveTab !== 'undefined' && bkmpIdleActiveTab === 'gilde' && typeof bkmpIdleRenderGildePanel === 'function') bkmpIdleRenderGildePanel();
}

function bkmpGuildProjectSectionHtml() {
  if (bkmpGuildProjectMissing) return '';
  if (!bkmpGuildProjectStatus) {
    bkmpGuildProjectEnsureLoaded(false).then(() => { if (bkmpGuildProjectStatus || bkmpGuildProjectMissing) bkmpGuildProjectRerenderGuild(); }).catch(() => {});
    return `<div class="idle-arena-history dd-gp" data-testid="guild-project"><h4 style="margin-top:1rem;">🏗️ Gildenprojekt der Woche</h4><p class="empty-hint">⏳ Lädt…</p></div>`;
  }
  const st = bkmpGuildProjectStatus;
  if (!st.in_guild || !st.def) return '';
  const pct = st.target_points > 0 ? Math.min(100, Math.floor((st.progress_points / st.target_points) * 100)) : 0;
  const kinds = st.def.resource_kinds || [];
  let action;
  if (st.completed) {
    if (st.claimed) action = `<p class="dd-gp-note">✅ Belohnung abgeholt. Nächste Woche wartet ein neues Projekt.</p>`;
    else if (st.my_points >= 10) action = `<button type="button" class="btn-ja dd-gp-claim" data-gp-claim="1" data-testid="guild-project-claim" ${bkmpGuildProjectBusy ? 'disabled' : ''}>🎁 Belohnung abholen (💎 150 · 🧪 100 · 🔮 Rune)</button>`;
    else action = `<p class="dd-gp-note">Das Projekt ist fertig! Für eine Belohnung hättest du mindestens 10 Punkte beitragen müssen.</p>`;
  } else {
    action = `
      <div class="dd-gp-donate">
        ${kinds.map(k => {
          const meta = BKMP_GUILD_PROJECT_KIND_META[k] || { icon: '', label: k };
          const per = bkmpGuildProjectPerPoint(k);
          const have = Math.floor(Number((bkmpIdleState || {})[k] || 0));
          const can10 = have >= per * 10;
          const can1 = have >= per;
          return `<div class="dd-gp-kind">
            <span class="dd-gp-kind-label">${meta.icon} ${meta.label} <small>(${bkmpGuildProjectFmt(per)} = 1 Punkt)</small></span>
            <button type="button" class="btn-nein" data-gp-give="${k}" data-gp-points="1" ${can1 && !bkmpGuildProjectBusy ? '' : 'disabled'}>+1</button>
            <button type="button" class="btn-ja" data-gp-give="${k}" data-gp-points="10" data-testid="guild-project-give-${k}" ${can10 && !bkmpGuildProjectBusy ? '' : 'disabled'}>+10</button>
          </div>`;
        }).join('')}
      </div>
      <p class="dd-gp-note">Wer mindestens 10 Punkte beiträgt, bekommt nach Fertigstellung eine Belohnung. Neues Projekt jeden Montag.</p>`;
  }
  const top = (st.top || []).map((t, i) => `<li>${i + 1}. ${bkmpGuildProjectEsc(t.name)} – ${bkmpGuildProjectFmt(t.points)} P.</li>`).join('');
  return `
    <div class="idle-arena-history dd-gp" data-testid="guild-project">
      <h4 style="margin-top:1rem;">🏗️ Gildenprojekt der Woche ${st.badges ? `<span class="dd-gp-badges" title="Abgeschlossene Gildenprojekte">🏅 ${st.badges}</span>` : ''}</h4>
      <div class="dd-gp-head"><span class="dd-gp-icon">${bkmpGuildProjectEsc(st.def.icon)}</span><div><strong>${bkmpGuildProjectEsc(st.def.name)}</strong><br><span class="dd-muted">${bkmpGuildProjectEsc(st.def.description)}</span></div></div>
      <div class="idle-guild-quest-bar"><div class="idle-guild-quest-fill" style="width:${pct}%"></div></div>
      <div class="idle-guild-quest-progress" data-testid="guild-project-progress">${bkmpGuildProjectFmt(st.progress_points)} / ${bkmpGuildProjectFmt(st.target_points)} Punkte${st.completed ? ' – fertig! 🎉' : ''} · dein Beitrag: ${bkmpGuildProjectFmt(st.my_points)}</div>
      ${action}
      ${top ? `<ol class="dd-gp-top">${top}</ol>` : ''}
    </div>`;
}

async function bkmpGuildProjectGive(kind, points) {
  if (bkmpGuildProjectBusy || !bkmpGuildProjectStatus) return;
  bkmpGuildProjectBusy = true;
  bkmpGuildProjectRerenderGuild();
  try {
    if (typeof bkmpIdleFlushSyncNow === 'function') { try { await bkmpIdleFlushSyncNow(); } catch (e) { /* weiter */ } }
    const res = await bkmpGuildProjectContributeRpc(kind, bkmpGuildProjectPerPoint(kind) * points);
    if (res && bkmpIdleState) {
      bkmpIdleState[kind] = Math.max(0, Number(bkmpIdleState[kind] || 0) - Number(res.spent || 0));
      if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
      if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();
      bkmpGuildProjectToast(res.completed ? '🎉 Gildenprojekt fertiggestellt!' : `🏗️ +${res.points} Projektpunkte`, 'success');
    }
  } catch (e) {
    bkmpGuildProjectToast(e.message || String(e), 'danger');
  }
  await bkmpGuildProjectEnsureLoaded(true);
  bkmpGuildProjectBusy = false;
  bkmpGuildProjectRerenderGuild();
}
async function bkmpGuildProjectClaim() {
  if (bkmpGuildProjectBusy) return;
  bkmpGuildProjectBusy = true;
  bkmpGuildProjectRerenderGuild();
  try {
    if (typeof bkmpIdleFlushSyncNow === 'function') { try { await bkmpIdleFlushSyncNow(); } catch (e) { /* weiter */ } }
    const res = await bkmpGuildProjectClaimRpc();
    if (res && bkmpIdleState) {
      bkmpIdleState.crystals = Number(bkmpIdleState.crystals || 0) + Number(res.crystals || 0);
      bkmpIdleState.essence = Number(bkmpIdleState.essence || 0) + Number(res.essence || 0);
      if (Number(res.runes || 0) > 0 && typeof bkmpDungeonRollRune === 'function' && typeof bkmpDungeonPersistRunes === 'function') {
        const list = [];
        for (let i = 0; i < Number(res.runes); i++) { const r = bkmpDungeonRollRune(Number(res.rune_tier || 0)); if (r) list.push(r); }
        if (list.length) bkmpDungeonPersistRunes(list);
      }
      if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
      if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();
      bkmpGuildProjectToast(`🎁 Gildenprojekt-Belohnung: 💎 ${res.crystals} · 🧪 ${res.essence} · 🔮 Rune`, 'success');
    }
  } catch (e) {
    bkmpGuildProjectToast(e.message || String(e), 'danger');
  }
  await bkmpGuildProjectEnsureLoaded(true);
  bkmpGuildProjectBusy = false;
  bkmpGuildProjectRerenderGuild();
}

(function bkmpGuildProjectWireClicks() {
  const panel = typeof document !== 'undefined' ? document.getElementById('idlePanelGilde') : null;
  if (!panel) return;
  panel.addEventListener('click', e => {
    const give = e.target.closest('[data-gp-give]');
    if (give && !give.disabled) { bkmpGuildProjectGive(give.getAttribute('data-gp-give'), Number(give.getAttribute('data-gp-points')) || 1); return; }
    const claim = e.target.closest('[data-gp-claim]');
    if (claim && !claim.disabled) bkmpGuildProjectClaim();
  });
})();

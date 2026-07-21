/* Exact tab registry mirrored from bkmpIdleTabs in idledorf.js (~line 2177)
   - copied, not derived, so a capitalization guess (e.g. "gildetech" ->
   "GildeTech" not "Gildetech") never silently points at a non-existent id. */
const IDLE_TABS = [
  { id: 'kampf', btn: 'idleTabBtnKampf', panel: 'idlePanelKampf' },
  { id: 'upgrades', btn: 'idleTabBtnUpgrades', panel: 'idlePanelUpgrades' },
  { id: 'skilltree', btn: 'idleTabBtnSkilltree', panel: 'idlePanelSkilltree' },
  { id: 'erfolge', btn: 'idleTabBtnErfolge', panel: 'idlePanelErfolge' },
  { id: 'prestige', btn: 'idleTabBtnPrestige', panel: 'idlePanelPrestige' },
  { id: 'runen', btn: 'idleTabBtnRunen', panel: 'idlePanelRunen' },
  { id: 'skins', btn: 'idleTabBtnSkins', panel: 'idlePanelSkins' },
  { id: 'dungeon', btn: 'idleTabBtnDungeon', panel: 'idlePanelDungeon' },
  { id: 'turm', btn: 'idleTabBtnTurm', panel: 'idlePanelTurm' },
  { id: 'arena', btn: 'idleTabBtnArena', panel: 'idlePanelArena' },
  { id: 'gilde', btn: 'idleTabBtnGilde', panel: 'idlePanelGilde' },
  { id: 'gildetech', btn: 'idleTabBtnGildeTech', panel: 'idlePanelGildeTech' },
  { id: 'gildeboss', btn: 'idleTabBtnGildeBoss', panel: 'idlePanelGildeBoss' },
  { id: 'bestenliste', btn: 'idleTabBtnBestenliste', panel: 'idlePanelBestenliste' },
  { id: 'drachen', btn: 'idleTabBtnDrachen', panel: 'idlePanelDrachen' }
];

module.exports = { IDLE_TABS };

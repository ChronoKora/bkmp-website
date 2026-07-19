// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-meister.js


/* ---------------- "Meister"-Zweig: Grimbold-Dialogszene ----------------
   Schaltet sich frei, sobald alle 5 Basis-Zweige komplett gemaxed sind
   (siehe bkmpIdleRenderSkilltreePanel) - beim naechsten Rendern des
   Skilltree-Tabs poppt automatisch EINMALIG diese kleine Dialogszene auf,
   danach ist der Zweig normal bedienbar. Ob die Szene schon gesehen wurde,
   merkt sich NUR der Browser (localStorage) - bewusst KEIN Sync-Feld in
   idle_player_state (siehe Erklaerung bei der SQL-Migration/
   BKMP_IDLE_BRANCH_ORDER: nach dem dwarf_unlocked-Vorfall keine neue
   Kern-Spielstand-Spalte mehr ohne vorher ausgefuehrte Migration). Auf
   einem zweiten Geraet wuerde die Szene also notfalls ein zweites Mal
   auftauchen - rein kosmetisch, kein Fortschrittsrisiko. */
const BKMP_MEISTER_DIALOG_SEEN_KEY = 'bkmp-meister-dialog-seen';
function bkmpMeisterDialogSeen() {
  try { return localStorage.getItem(BKMP_MEISTER_DIALOG_SEEN_KEY) === '1'; } catch (e) { return false; }
}
function bkmpMeisterMarkDialogSeen() {
  try { localStorage.setItem(BKMP_MEISTER_DIALOG_SEEN_KEY, '1'); } catch (e) {}
}

const BKMP_MEISTER_DIALOG_LINES = [
  { face: 'neutral', text: '„Hoho! Diese Rauchsäulen sah man meilenweit übers Tal, junger Anführer. Grimbold ist mein Name.“' },
  { face: 'erzaehlend', text: '„Einst hatte mein Clan die größte Schmiede unter dem Eisenberg. Klingen, die selbst Drachenschuppen durchtrennten, kamen aus unseren Essen.“' },
  { face: 'traurig', text: 'Sein Blick verdüstert sich. „Bis der Berg einstürzte. Alles unter sich begraben - die Schmiede, meine Brüder, alles. Nur ich kam raus.“' },
  { face: 'nachdenklich', text: '„Seitdem ziehe ich umher. Suche einen Ort, der mein letztes Werk verdient. Viele Dörfer sah ich - keines hielt stand.“' },
  { face: 'ueberrascht', text: 'Er mustert deine Mauern, deine Truppen, deine Vorräte. „Aber DAS hier... jeder Winkel ausgebaut, jede Fertigkeit gemeistert. Das habe ich lange nicht gesehen.“' },
  { face: 'genervt', text: '„Diese Bögen und Kräuterkissen sind ja ganz nett - aber Stahl, ECHTER Stahl, kennt hier wohl niemand, hm?“' },
  { face: 'lachend', text: 'Er lacht dröhnend und klopft sich auf den Bauch. „Macht nichts! Genau deshalb bin ich hier. Zeig mir Platz an deiner Esse, und ich mach aus deinem Dorf eine Festung, die man in drei Königreichen fürchtet!“' },
  { face: 'empoert', text: '„Also? Worauf wartest du noch?! Ein Zwerg wartet nicht gern - meine Geduld ist so kurz wie meine Beine!“' }
];
let bkmpMeisterDialogIndex = 0;
let bkmpMeisterDialogShowing = false;

function bkmpMeisterMaybeShowDialog() {
  if (bkmpMeisterDialogShowing) return;
  bkmpMeisterDialogShowing = true;
  bkmpMeisterDialogIndex = 0;
  const overlay = document.getElementById('idleMeisterDialogOverlay');
  if (!overlay) { bkmpMeisterDialogShowing = false; return; }
  overlay.classList.add('visible');
  bkmpMeisterRenderDialogStep();
  const nextBtn = document.getElementById('idleMeisterDialogNextBtn');
  if (nextBtn) nextBtn.onclick = bkmpMeisterAdvanceDialog;
}

function bkmpMeisterRenderDialogStep() {
  const line = BKMP_MEISTER_DIALOG_LINES[bkmpMeisterDialogIndex];
  if (!line) return;
  const img = document.getElementById('idleMeisterDialogFace');
  const text = document.getElementById('idleMeisterDialogText');
  const btn = document.getElementById('idleMeisterDialogNextBtn');
  const step = document.getElementById('idleMeisterDialogStep');
  if (img) img.src = `assets/dwarf/dwarf-${line.face}.png`;
  if (text) text.textContent = line.text;
  if (step) step.textContent = `${bkmpMeisterDialogIndex + 1}/${BKMP_MEISTER_DIALOG_LINES.length}`;
  const isLast = bkmpMeisterDialogIndex >= BKMP_MEISTER_DIALOG_LINES.length - 1;
  if (btn) btn.textContent = isLast ? 'Willkommen, Grimbold!' : 'Weiter';
}

function bkmpMeisterAdvanceDialog() {
  if (bkmpMeisterDialogIndex >= BKMP_MEISTER_DIALOG_LINES.length - 1) {
    bkmpMeisterCloseDialog();
    return;
  }
  bkmpMeisterDialogIndex += 1;
  bkmpMeisterRenderDialogStep();
}

function bkmpMeisterCloseDialog() {
  const overlay = document.getElementById('idleMeisterDialogOverlay');
  if (overlay) overlay.classList.remove('visible');
  bkmpMeisterMarkDialogSeen();
  bkmpMeisterDialogShowing = false;
  bkmpIdleRenderSkilltreePanel();
}

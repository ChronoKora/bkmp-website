/* ============================================================
   Idle-Dorf: Dorfentwicklung (Drachendorf-Ausbau, ab 04.10.2026)
   Reiter "🏗️ Dorfentwicklung" in der Kategorie "Entwicklung".
   Phase 1: Platzhalter. Phase 2: Dorfprojekte (Drachenhafen I-III,
   Handelsposten) - siehe unten.
   ============================================================ */

function bkmpIdleRenderDorfPanel() {
  const panel = document.getElementById('idlePanelDorf');
  if (!panel) return;
  panel.innerHTML = `
    <div class="idle-dorf-section">
      <h3>🏗️ Dorfentwicklung</h3>
      <p class="idle-dd-pending">Hier entstehen bald die großen Dorfprojekte – der Drachenhafen und der Handelsposten.</p>
    </div>`;
}

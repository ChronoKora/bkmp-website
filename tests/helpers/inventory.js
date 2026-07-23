/* Generic interactive-element collector (Auftrag Abschnitt 5: automatische
   Bestandsaufnahme aller Bedienelemente). Walks a DOM subtree and records
   the metadata the brief asks for (sichtbarer Text, aria-label, ID, Klasse,
   sichtbar?, aktiv?, anklickbar?) as plain serializable objects - runs
   entirely inside the page via page.evaluate(), no click/interaction here
   (that belongs to the domain-specific suites - combat/runes/dungeon/
   prestige - which actually exercise a button's reaction). */

const SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea',
  '[role="button"]', '[onclick]', '[tabindex]:not([tabindex="-1"])'
].join(',');

async function collectInteractiveElements(page, rootSelector) {
  return page.evaluate(({ selector, rootSel }) => {
    // NOTE: rootSel may itself be a comma-separated list of scopes (e.g. two
    // unrelated containers) - document.querySelector() on a comma-separated
    // selector returns only the FIRST match across the whole document, not
    // "all of these roots", so each root is resolved and searched separately
    // and the results merged (found via an earlier run reporting a
    // suspiciously empty chrome/HUD scope - a test-helper bug, not an app bug).
    const roots = rootSel
      ? Array.from(document.querySelectorAll(rootSel))
      : [document];
    if (!roots.length) return [];
    const seen = new Set();
    const nodes = [];
    roots.forEach(root => {
      root.querySelectorAll(selector).forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        nodes.push(el);
      });
    });
    return nodes.map(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible = rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className && el.className.toString ? el.className.toString() : null,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        ariaLabel: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        type: el.getAttribute('type'),
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        visible,
        opacityVisible: parseFloat(style.opacity || '1') > 0.05,
        pointerEventsNone: style.pointerEvents === 'none',
        hasAccessibleLabel: !!(
          el.getAttribute('aria-label')
          || (el.textContent || '').trim()
          || el.getAttribute('title')
          || el.getAttribute('alt')
          || el.getAttribute('aria-labelledby')
          || el.closest('label')
          || (el.id && document.querySelector(`label[for="${el.id}"]`))
        ),
        placeholderOnly: !!(el.getAttribute('placeholder') && !el.closest('label')),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
      };
    });
  }, { selector: SELECTOR, rootSel: rootSelector || null });
}

module.exports = { collectInteractiveElements };

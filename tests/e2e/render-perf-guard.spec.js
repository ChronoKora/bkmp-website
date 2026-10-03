const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Performance-Fix "Hover reagiert stark verzoegert" (03.10.2026, Spieler-
   Video, siehe CLAUDE.md/style.css-Abschnitt "Performance-Fix ..."): das
   gesamte Dorf-Fenster (.idle-dorf-card) und das Runen-Lager liefen dauerhaft
   mit einer background-position-Animation -> der Browser musste die komplette
   Karte in jedem Bild neu malen (per Chrome-Tracing gemessen: ~6.000 ms
   Rasterarbeit in 3 s, nach dem Fix 0-3 ms). Diese Tests verhindern, dass
   dieselbe Falle unbemerkt zurueckkommt - sie pruefen die tatsaechlich
   laufenden Animationen (Web Animations API), nicht nur CSS-Text. */

test.describe('Render-Performance-Schutz Idle-Dorf', () => {
  test.use({ teststand: 'C' });

  test('Dorf-Fenster selbst hat keine Dauer-Animation (kein Neuzeichnen der ganzen Karte pro Bild)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const r = await page.evaluate(() => {
      const card = document.querySelector('#idleDorfOverlay .idle-dorf-card');
      const drawerPanel = document.querySelector('.idle-runen-drawer-panel');
      return {
        cardAnimations: card.getAnimations().map(a => a.animationName),
        drawerAnimations: drawerPanel ? drawerPanel.getAnimations().map(a => a.animationName) : []
      };
    });
    expect(r.cardAnimations).toEqual([]);
    expect(r.drawerAnimations).toEqual([]);
  });

  test('"Effekte: Aus" - im Dorf-Fenster laeuft keine Endlos-Animation mehr', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const running = await page.evaluate(async () => {
      bkmpFxSetMode('aus');
      bkmpIdleStopLoop();
      await new Promise(res => setTimeout(res, 300));
      return document.getElementById('idleDorfOverlay').getAnimations({ subtree: true })
        .filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity)
        .map(a => a.animationName);
    });
    expect(running).toEqual([]);
  });

  test('Website-Animationen unter dem offenen Fenster pausieren und laufen nach dem Schliessen weiter', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const siteRunning = () => page.evaluate(() => {
      const roots = ['.site-top-bar', '.top-actions-left', '.top-actions', 'header.hero', 'nav.topbar-wrap', '#panelsViewport', 'footer.bkmp-footer'];
      return roots.flatMap(sel => [...document.querySelectorAll(sel)])
        .flatMap(el => el.getAnimations({ subtree: true }))
        .filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity).length;
    });
    expect(await siteRunning()).toBe(0);
    await page.evaluate(() => bkmpIdleCloseModal());
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('mcNameBadge')).animationPlayState)).not.toBe('paused');
  });
});

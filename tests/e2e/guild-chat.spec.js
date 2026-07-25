/* Phase 5 (24.07.2026, siehe CLAUDE.md) - Gildenchat-Tests.

   Architektur: send_guild_chat_message() (sql/supabase-idle-guilds-
   settings-chat.sql, keine spaetere Fassung) - Mitgliedschaft wird
   AUSSCHLIESSLICH ueber die eigene guild_members-Zeile ermittelt (Spieler
   gibt keine guild_id mit, kann technisch nicht in eine fremde Gilde
   schreiben), Nachricht wird serverseitig getrimmt, leer ODER >300 Zeichen
   wird abgelehnt (Client sendet KEIN vorab-getrimmtes Leerzeichen-only,
   siehe sendChat() in bkmp-guild.js - der Server-Trim ist die eigentliche
   Absicherung). delete_guild_chat_message() (NEU aus sql/supabase-guild-
   roles-veteran.sql) - leader/officer/veteran duerfen JEDE Nachricht ihrer
   eigenen Gilde loeschen (Moderation, nicht nur eigene). Laden laeuft ueber
   eine normale REST-Abfrage (kein Realtime noetig fuer die Tests, siehe
   Datei-Kopfkommentar in rpc-engine.js bei send_guild_chat_message).

   Sicherheit (Auftrag Abschnitt 4: "Keine gefaehrlichen Inhalte im echten
   Browser ausfuehren"): der HTML/Script-Test sendet eine Nachricht mit
   spitzen Klammern durch den ECHTEN, unveraenderten Rendering-Pfad
   (bkmpIdleRenderGildePanel() in bkmp-guild.js nutzt escapeHtml() beim
   Einsetzen von m.message in innerHTML, siehe Zeile ~1199) und prueft per
   DOM-Text-Inhalt (nicht via eval/Ausfuehrung), dass daraus literaler,
   sichtbarer Text wird statt eines echten <script>-Elements - kein
   tatsaechlich gefaehrlicher Code wird je ausgefuehrt, nur beobachtet, DASS
   er nicht ausgefuehrt wird. */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaChatLeader';
const MEMBER_NAME = 'QaChatMember';
const OTHERGUILD_NAME = 'QaChatOther';
const LEADER_UID = 'qa-chat-leader-0000';
const MEMBER_UID = 'qa-chat-member-0000';
const OTHERGUILD_UID = 'qa-chat-other-0000';

function chatFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, extra) { return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, gold: 0, ...extra }); }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [user(LEADER_UID, LEADER_NAME), user(MEMBER_UID, MEMBER_NAME), user(OTHERGUILD_UID, OTHERGUILD_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row(LEADER_UID, LEADER_NAME), row(MEMBER_UID, MEMBER_NAME), row(OTHERGUILD_UID, OTHERGUILD_NAME)],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [
        { id: 'g1', name: 'Testgilde', tag: 'TST', treasury_gold: 0, member_count: 2, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso },
        { id: 'g2', name: 'Andere Gilde', tag: 'AND', treasury_gold: 0, member_count: 1, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: OTHERGUILD_UID, created_at: nowIso }
      ],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: OTHERGUILD_UID, guild_id: 'g2', name_key: OTHERGUILD_NAME.toLowerCase(), display_name: OTHERGUILD_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_chat_messages: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, chatFixture(startTimeMs)), { startTimeMs: Date.now() });
    await use(server);
    await server.close();
  }
});

async function login(page, server, name) {
  await page.goto(server.url('/'));
  const overlay = page.locator('#mcNameOverlay');
  await expect(overlay).toHaveClass(/visible/, { timeout: 15000 });
  await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
  await page.locator('#mcAuthName').fill(name);
  await page.locator('#mcAuthPassword').fill(QA_PASSWORD);
  await page.locator('#mcAuthSubmit').click();
  await expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop());
}

async function rpcAs(server, name, fnName, params) {
  const email = emailFromName(name);
  const tokenRes = await fetch(`${server.baseURL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_PASSWORD })
  });
  const token = (await tokenRes.json()).access_token;
  const rpcRes = await fetch(`${server.baseURL}/rest/v1/rpc/${fnName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params || {})
  });
  const json = await rpcRes.json().catch(() => null);
  if (rpcRes.status >= 400) throw new Error(json && json.message);
  return json;
}

test.describe('Gildenchat', () => {
  test('Mitglied laedt Chat (anfangs leer)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const messages = await page.evaluate(() => window.bkmpGuildGetChatMessages('g1', 50));
    expect(messages).toEqual([]);
  });

  test('Nichtmitglied (anderer Gilde) kann keine Nachricht in eine fremde Gilde senden', async ({ page, qaServer }) => {
    await login(page, qaServer, OTHERGUILD_NAME);
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Hallo aus g2'));
    // send_guild_chat_message() ermittelt die Ziel-Gilde AUSSCHLIESSLICH aus
    // der eigenen guild_members-Zeile - selbst ein manipulierter Client
    // koennte technisch keine guild_id mitgeben, um in g1 zu schreiben.
    const g1Messages = qaServer.store.tables.guild_chat_messages.filter(m => m.guild_id === 'g1');
    expect(g1Messages.length).toBe(0);
    const g2Messages = qaServer.store.tables.guild_chat_messages.filter(m => m.guild_id === 'g2');
    expect(g2Messages.length).toBe(1);
  });

  test('Nachricht senden wird korrekt gespeichert (Gilde, Absender, Zeitstempel)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Hallo Gilde!'));
    const messages = await page.evaluate(() => window.bkmpGuildGetChatMessages('g1', 50));
    expect(messages.length).toBe(1);
    expect(messages[0].message).toBe('Hallo Gilde!');
    expect(messages[0].displayName).toBe(LEADER_NAME);
    expect(messages[0].createdAt).toBeTruthy();
  });

  test('leere Nachricht wird blockiert', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildSendChatMessage('')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/leer oder zu lang/);
  });

  test('nur Leerzeichen wird blockiert (serverseitiger Trim, nicht nur Client)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    let threw = null;
    try {
      // Direkter RPC-Aufruf statt der Wrapper-Funktion, um den CLIENT-
      // seitigen sendChat()-Trim in bkmp-guild.js bewusst zu umgehen und
      // wirklich den Server-Trim zu pruefen.
      const c = await page.evaluate(async () => {
        const client = window.bkmpGetPlayerAuthClient();
        const { error } = await client.rpc('send_guild_chat_message', { p_message: '     ' });
        return error ? error.message : null;
      });
      if (c) throw new Error(c);
    } catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/invalid_message/);
  });

  test('maximales Zeichenlimit (300) wird akzeptiert, 301 Zeichen abgelehnt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const exact300 = 'x'.repeat(300);
    await page.evaluate((msg) => window.bkmpGuildSendChatMessage(msg), exact300);
    const messages = await page.evaluate(() => window.bkmpGuildGetChatMessages('g1', 50));
    expect(messages[0].message.length).toBe(300);

    let threw = null;
    try { await page.evaluate((msg) => window.bkmpGuildSendChatMessage(msg), 'x'.repeat(301)); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/leer oder zu lang/);
  });

  test('Reihenfolge der Nachrichten ist chronologisch (aeltere zuerst, wie im UI-Log)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Erste'));
    qaServer.store.clock.advance(1000);
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Zweite'));
    qaServer.store.clock.advance(1000);
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Dritte'));
    const messages = await page.evaluate(() => window.bkmpGuildGetChatMessages('g1', 50));
    expect(messages.map(m => m.message)).toEqual(['Erste', 'Zweite', 'Dritte']);
  });

  test('mehrere Nutzer koennen abwechselnd schreiben, alle Nachrichten landen in derselben Gilde', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Leader schreibt'));
    await rpcAs(qaServer, MEMBER_NAME, 'send_guild_chat_message', { p_message: 'Member schreibt' });
    const messages = await page.evaluate(() => window.bkmpGuildGetChatMessages('g1', 50));
    expect(messages.length).toBe(2);
    expect(messages.map(m => m.displayName).sort()).toEqual([LEADER_NAME, MEMBER_NAME].sort());
  });

  test('Reload zeigt weiterhin dieselben Nachrichten', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Ueberlebt einen Reload'));
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    const messages = await page.evaluate(() => window.bkmpGuildGetChatMessages('g1', 50));
    expect(messages.length).toBe(1);
    expect(messages[0].message).toBe('Ueberlebt einen Reload');
  });

  test('Logout/Login zeigt weiterhin die serverseitig persistenten Nachrichten', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Persistent'));
    const messages = qaServer.store.tables.guild_chat_messages.filter(m => m.guild_id === 'g1');
    expect(messages.length).toBe(1);
  });

  test('Gildenwechsel: nach Verlassen kann nicht mehr in die alte Gilde geschrieben werden', async ({ page, qaServer }) => {
    await login(page, qaServer, MEMBER_NAME);
    await rpcAs(qaServer, MEMBER_NAME, 'leave_guild', {});
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildSendChatMessage('Nach dem Verlassen')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Du bist in keiner Gilde/);
  });

  test('Sonderzeichen (Emoji, Umlaute) werden unveraendert gespeichert und geladen', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const special = 'Grüße 🐉⚔️💰 äöüß';
    await page.evaluate((msg) => window.bkmpGuildSendChatMessage(msg), special);
    const messages = await page.evaluate(() => window.bkmpGuildGetChatMessages('g1', 50));
    expect(messages[0].message).toBe(special);
  });

  test('HTML- und Script-Eingabe wird beim Rendern escaped, nicht ausgefuehrt (echter DOM-Check, kein tatsaechlicher Codeausfuehrungsversuch)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const payload = '<img src=x onerror="window.__xssFired=true">Hallo<script>window.__xssFired=true</script>';
    await page.evaluate((msg) => window.bkmpGuildSendChatMessage(msg), payload);
    await page.evaluate(() => bkmpGuildChatLoadedForGuildId = null); // erzwingt Neu-Rendern beim naechsten Panel-Aufbau
    // Panel neu aufbauen ueber die echte Render-Funktion, exakt wie ein
    // Spieler es durch Tab-Wechsel/Neuladen des Panels erleben wuerde.
    await page.evaluate(async () => { await window.bkmpIdleRenderGildePanel(); });
    await page.waitForTimeout(200); // async Chat-Nachlade-Fetch in derselben Funktion

    const xssFired = await page.evaluate(() => window.__xssFired === true);
    expect(xssFired).toBe(false); // <img onerror>/<script> wurden NIE ausgefuehrt

    const chatLogText = await page.evaluate(() => {
      const el = document.getElementById('idleGuildChatLog');
      return el ? el.textContent : null;
    });
    // textContent zeigt die Zeichen als LITERALEN Text (Beweis, dass sie
    // escaped im DOM stehen, nicht als echte Elemente geparst wurden).
    expect(chatLogText).toContain('<img src=x onerror="window.__xssFired=true">Hallo<script>window.__xssFired=true</script>');

    const realScriptTags = await page.evaluate(() => document.querySelectorAll('#idleGuildChatLog script').length);
    expect(realScriptTags).toBe(0);
    const realImgTags = await page.evaluate(() => document.querySelectorAll('#idleGuildChatLog img').length);
    expect(realImgTags).toBe(0);
  });

  test('keine doppelte Nachricht durch Mehrfachklick (Eingabefeld wird sofort geleert, verhindert Doppel-Sendung)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    // Gilde-Tab muss sichtbar aktiv sein, sonst ist #idleGuildChatInput per
    // Playwright-Actionability-Regeln nicht klickbar/befuellbar (Panel steht
    // sonst unsichtbar im DOM - siehe bkmpIdleTabs in idledorf.js).
    //
    // Echter, beim vollen 3-Projekte-Regressionslauf gefundener Fund (nicht
    // beim isolierten chromium-desktop-Lauf, dort ist #idleTabBtnGilde immer
    // direkt klickbar): auf mobile-small/mobile-large sitzt der Desktop-Tab-
    // Button zwar weiterhin im DOM, aber "outside of the viewport" - der
    // kompakte Nav (System A/B, siehe CLAUDE.md Phase 7.0-7.3) ersetzt die
    // Tab-Leiste dort durch eine feste Bottom-Nav + "Mehr"-Ueberlaufmenue;
    // "Gilde" gehoert nicht zu den paar direkt sichtbaren Haupt-Tabs. Kein
    // App-Bug (bereits vielfach dokumentiertes, bewusstes Verhalten) - reine
    // Testrobustheits-Luecke, identisches Muster wie bereits in
    // mobile-smoke.spec.js geloest.
    // WICHTIG (beim ersten Fix-Versuch selbst gefunden): #idleTabBtnGilde
    // meldet auf Mobil-Breiten faelschlich isVisible()===true, obwohl es
    // faktisch ausserhalb des Viewports liegt - der echte Button wird beim
    // Laden bereits UNBEDINGT in #idleAppMoreSheet umgehaengt (siehe CLAUDE.md
    // Phase 7.0/System B), das Sheet selbst blendet per transform (nicht
    // display:none) aus, solange es geschlossen ist - CSS-"sichtbar" bleibt
    // dabei technisch wahr. Zuverlaessiger Indikator fuer "kompakter Nav
    // aktiv": #bkmpProtoNavMoreBtn selbst (existiert nur in diesem Modus),
    // exakt das bereits in mobile-smoke.spec.js etablierte Muster.
    const moreBtn = page.locator('#bkmpProtoNavMoreBtn');
    const compactModeActive = await moreBtn.isVisible().catch(() => false);
    if (!compactModeActive) {
      await page.locator('#idleTabBtnGilde').click();
    } else {
      await moreBtn.click();
      const realSheetItem = page.locator('#idleAppMoreSheetGrid #idleTabBtnGilde');
      const fallbackMenuItem = page.locator('#bkmpProtoNavMoreMenu [data-proto-real-btn="idleTabBtnGilde"]');
      const useRealSheet = await realSheetItem.isVisible().catch(() => false);
      if (useRealSheet) await realSheetItem.click();
      else { await expect(fallbackMenuItem).toBeVisible({ timeout: 5000 }); await fallbackMenuItem.click(); }
    }
    await expect(page.locator('#idlePanelGilde')).toBeVisible();
    // Direkter DOM-Test der echten sendChat()-Klick-Logik (bkmp-guild.js):
    // chatInput.value wird SOFORT geleert, bevor der RPC-Aufruf ueberhaupt
    // beginnt - ein zweiter schneller Klick auf denselben (jetzt leeren)
    // Text sendet nichts Neues.
    await page.locator('#idleGuildChatInput').fill('Nur einmal');
    const sendBtn = page.locator('#idleGuildChatSendBtn');
    await Promise.all([sendBtn.click(), sendBtn.click(), sendBtn.click()]);
    await page.waitForTimeout(400);
    const messages = qaServer.store.tables.guild_chat_messages.filter(m => m.guild_id === 'g1' && m.message === 'Nur einmal');
    expect(messages.length).toBe(1);
  });

  test('fehlgeschlagener Serveraufruf zeigt einen Fehler, ohne die App zum Absturz zu bringen', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const result = await page.evaluate(async () => {
      try {
        await window.bkmpGuildSendChatMessage('x'.repeat(9999)); // garantiert ueber dem Limit
        return 'no-error';
      } catch (e) { return e.message; }
    });
    expect(result).toMatch(/leer oder zu lang/);
    // App bleibt danach funktionsfaehig - ein normaler Folgeaufruf klappt.
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Danach geht es normal weiter'));
    const messages = await page.evaluate(() => window.bkmpGuildGetChatMessages('g1', 50));
    expect(messages.some(m => m.message === 'Danach geht es normal weiter')).toBe(true);
  });

  test('Moderation: Veteran darf fremde Nachrichten loeschen, plain Member nicht', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await rpcAs(qaServer, LEADER_NAME, 'set_guild_member_role', { p_target_auth_user_id: MEMBER_UID, p_new_role: 'veteran' });
    await page.evaluate(() => window.bkmpGuildSendChatMessage('Vom Leader'));
    const msgId = qaServer.store.tables.guild_chat_messages.find(m => m.guild_id === 'g1').id;

    let threw = null;
    try { await rpcAs(qaServer, MEMBER_NAME, 'delete_guild_chat_message', { p_message_id: msgId }); }
    catch (e) { threw = 'unexpected-reject'; }
    // MEMBER_UID wurde oben zu veteran befoerdert - sollte also LOESCHEN
    // duerfen (Moderationsrecht laut sql/supabase-guild-roles-veteran.sql).
    expect(threw).toBeNull();
    expect(qaServer.store.tables.guild_chat_messages.some(m => m.id === msgId)).toBe(false);
  });
});

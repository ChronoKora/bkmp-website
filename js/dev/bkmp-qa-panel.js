/* QA-Kontrollfenster (Testgrundlage Phase 1, 24.07.2026 - siehe CLAUDE.md).

   Laedt auf JEDER Seite, die diese Datei einbindet, tut aber komplett NICHTS
   ausser window.BKMP_QA_MODE ist true (siehe index.html: nur auf
   localhost/127.0.0.1 MIT ?qa=1 moeglich). Auf der echten Website ist diese
   ganze Datei damit ein reiner No-Op.

   Eigenes, minimal inline gestyltes Panel statt style.css anzufassen - haelt
   dieses reine Entwicklungswerkzeug bewusst isoliert vom eigentlichen
   Redesign-System (siehe CLAUDE.md "Feste Sicherheitsregel").

   Spricht ausschliesslich den lokalen QA-Mock-Server an (dieselbe Origin,
   siehe supabase.js's window.BKMP_QA_MODE-Zweig + tests/mock/server.js's
   /__qa__/*-Endpunkte) - nie das echte Supabase-Projekt. */

(function () {
  if (!window.BKMP_QA_MODE) return;

  /* Muss exakt tests/fixtures/teststands.js spiegeln (gleiche bewusste
     Duplizierung wie teststands.js selbst schon mit bkmpPlayerEmailFromName
     macht - siehe Kommentar dort). Bei Aenderungen an den Teststand-
     Fixtures BEIDE Stellen pflegen. */
  var QA_PASSWORD = 'qa-test-pw-123';
  var TESTSTAND_INFO = {
    A: { name: 'QaNeulingA', label: 'A - Neuer Spieler' },
    B: { name: 'QaMittlerB', label: 'B - Mittlerer Spieler' },
    C: { name: 'QaFortgeschC', label: 'C - Fortgeschritten (alles freigeschaltet)' },
    D: { name: 'QaBeschaedD', label: 'D - Beschaedigte Daten (Fehlerfaelle)' },
    E: { name: 'QaMaxlastE', label: 'E - Maximalbelastung (300 Runen)' },
    F: { name: 'QaVorPrestF', label: 'F - Unmittelbar vor Prestige (Stufe 99/100)' },
    G: { name: 'QaKeineSchlG', label: 'G - Keine Dungeon-Schluessel (0/5)' }
  };

  function qaLog(msg) { console.log('[QA-Panel] ' + msg); }

  function qaFetch(path, opts) {
    return fetch(window.location.origin + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        return { status: res.status, json: json };
      });
    });
  }

  /* NACHBESSERUNG (24.07.2026, beim eigenen manuellen Testen im echten
     Browser gefunden - nicht nur behauptet): eine erste Fassung schrieb
     Werte direkt per /__qa__/patch-state in die Mock-Datenbank und lud dann
     einfach neu. Der Server-Endpunkt selbst arbeitet nachweislich korrekt
     (per curl einzeln bestaetigt) - das Problem lag woanders: waehrend die
     Seite noch offen ist, laeuft die GANZ NORMALE Spiel-Sync-Schleife
     (bkmpIdleQueueSync/bkmpIdleFlushSync, idledorf.js) unveraendert weiter
     und haelt weiterhin die ALTEN Werte im Speicher (bkmpIdleState wurde ja
     nie aktualisiert) - ihr naechster (bis zu 4s spaeter faelliger)
     Speichervorgang ueberschrieb den frisch gepatchten Datenbank-Stand
     zuverlaessig wieder mit den alten Werten, oft noch bevor der eigene
     location.reload() ueberhaupt griff. Kein Bug im Endpunkt, sondern ein
     Wettlauf zwischen zwei unabhaengigen Schreibern auf dieselbe Zeile.
     Fix: bkmpIdleState direkt im Speicher aktualisieren (identisch zu jeder
     anderen Stelle im Spiel, die Werte aendert) und ueber die ECHTE,
     bereits ueberall genutzte bkmpIdleFlushSyncNow() sofort synchron
     schreiben (exakt dieselbe Funktion, die auch tests/e2e/save-load.spec.js
     fuer echte Speicher-Pruefungen nutzt) - der naechste normale Sync-Zyklus
     hat dadurch nichts Widerspruechliches mehr zu ueberschreiben. */
  async function qaPatchState(fields, successMsg) {
    if (typeof bkmpIdleState === 'undefined' || !bkmpIdleState) {
      qaSetMsg('Kein Idle-Dorf-Status geladen - zuerst einen Teststand laden/oeffnen.', true);
      return;
    }
    Object.assign(bkmpIdleState, fields);
    if (typeof bkmpIdleFlushSyncNow === 'function') {
      try { await bkmpIdleFlushSyncNow(); } catch (e) { qaLog('Flush-Fehler: ' + e); }
    } else if (typeof bkmpIdleQueueSync === 'function') {
      bkmpIdleQueueSync();
    }
    qaSetMsg(successMsg + ' - Seite wird neu geladen...', false);
    window.setTimeout(function () { window.location.reload(); }, 300);
  }

  async function qaLoadTeststand(id) {
    qaSetMsg('Lade Teststand ' + id + '...', false);
    var result = await qaFetch('/__qa__/reseed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teststand: id })
    });
    if (result.status !== 200) {
      qaSetMsg('Reseed fehlgeschlagen: ' + JSON.stringify(result.json), true);
      return;
    }
    /* Nach einem Reseed sind alle bisherigen Sessions im Mock-Server
       ungueltig (store.sessionsByAccessToken wurde geleert) - ein weiter im
       localStorage liegendes altes Token wuerde beim naechsten Request nur
       zu 401ern fuehren. localStorage.clear() ist hier unbedenklich: dieser
       Codepfad existiert nur unter BKMP_QA_MODE (localhost + ?qa=1), nie im
       echten Browserprofil eines Spielers. */
    try { window.localStorage.clear(); } catch (e) {}
    window.location.href = window.location.origin + '/?qa=1&stand=' + id;
  }

  function qaWaitFor(check, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var waited = 0;
      var step = 100;
      var timer = window.setInterval(function () {
        waited += step;
        var value = check();
        if (value) { window.clearInterval(timer); resolve(value); return; }
        if (waited >= timeoutMs) { window.clearInterval(timer); reject(new Error('timeout')); }
      }, step);
    });
  }

  async function qaTryAutoLogin() {
    var params = new URLSearchParams(window.location.search);
    var stand = params.get('stand');
    if (!stand) return;
    var info = TESTSTAND_INFO[stand.toUpperCase()];
    if (!info) return;
    try {
      /* Zwei moegliche Ausgangslagen fuer denselben ?stand=-Parameter:
         (a) frischer Reseed -> kein gueltiges Token mehr -> bkmpInitPlayerAuth()
             (bkmp-site.js) zeigt das Login-Formular automatisch.
         (b) ein qaPatchState()-Reload MIT weiterhin gueltiger, im
             localStorage persistierten Session (z.B. nach "Viel Gold
             setzen") -> die Session wird lautlos wiederhergestellt, das
             Login-Formular erscheint NIE. Ein 15s-Warten darauf wuerde hier
             nur unnoetig lange auf etwas warten, das nie kommt (gefunden
             beim eigenen manuellen Testen: Panel blieb 15s auf "Anmeldung
             nicht moeglich" haengen, obwohl der Spieler laengst eingeloggt
             war). Deshalb: kurz (3s) auf das Formular warten, bei Timeout
             einfach direkt annehmen, dass Fall (b) vorliegt. */
      var overlay = document.getElementById('mcNameOverlay');
      var loginFormAppeared = false;
      try {
        await qaWaitFor(function () {
          return overlay && overlay.classList.contains('visible') ? overlay : null;
        }, 3000);
        loginFormAppeared = true;
      } catch (e) { /* Fall (b) - siehe oben */ }

      if (loginFormAppeared) {
        var nameInput = document.getElementById('mcAuthName');
        var passInput = document.getElementById('mcAuthPassword');
        var submitBtn = document.getElementById('mcAuthSubmit');
        if (nameInput && passInput && submitBtn) {
          nameInput.value = info.name;
          passInput.value = QA_PASSWORD;
          submitBtn.click();
          await qaWaitFor(function () { return !overlay.classList.contains('visible'); }, 15000);
        }
      }

      // In BEIDEN Faellen: Idle-Dorf-Fenster oeffnen, falls es nicht schon
      // (z.B. durch eine wiederhergestellte fruehere Sitzung) offen ist.
      var idleOverlay = document.getElementById('idleDorfOverlay');
      if (idleOverlay && !idleOverlay.classList.contains('visible')) {
        var idleBtn = document.getElementById('idleDorfButton');
        if (idleBtn) idleBtn.click();
      }
      qaSetMsg('Teststand ' + stand.toUpperCase() + (loginFormAppeared ? ' angemeldet.' : ' (Sitzung bereits aktiv).'), false);
    } catch (e) {
      qaSetMsg('Automatische Anmeldung fehlgeschlagen - siehe Konsole.', true);
      qaLog('Auto-Login Fehler: ' + e);
    }
  }

  var msgEl = null;
  function qaSetMsg(text, isError) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.color = isError ? '#ff6b6b' : '#8fd694';
  }

  function qaCurrentPlayerSummary() {
    if (typeof bkmpIdleState === 'undefined' || !bkmpIdleState) return 'kein Idle-Dorf-Status geladen';
    return 'Level ' + (bkmpIdleState.level || 0) + ' | Gold ' + (bkmpIdleState.gold || 0) +
      ' | XP ' + (bkmpIdleState.xp || 0) + ' | Name ' + (bkmpIdleState.display_name || bkmpIdleState.name_key || '?');
  }

  function qaFormatSimTime() {
    var now = typeof window.bkmpGetGameNow === 'function' ? window.bkmpGetGameNow() : Date.now();
    var simulated = typeof window.bkmpGameClockIsSimulated === 'function' && window.bkmpGameClockIsSimulated();
    return new Date(now).toLocaleString('de-DE') + (simulated ? ' (simuliert)' : ' (Echtzeit)');
  }

  function qaBuildPanel() {
    var style = document.createElement('style');
    style.textContent = [
      '#bkmpQaPanel{position:fixed;right:12px;bottom:12px;z-index:999999;',
      'width:280px;max-height:80vh;overflow-y:auto;font:12px/1.4 monospace;',
      'background:#14131a;color:#e8e6f0;border:2px solid #ffb020;border-radius:10px;',
      'box-shadow:0 8px 28px rgba(0,0,0,.55);padding:10px}',
      '#bkmpQaPanel h3{margin:0 0 6px;font-size:13px;color:#ffb020}',
      '#bkmpQaPanel .qa-sec{margin-top:8px;padding-top:8px;border-top:1px solid #35323f}',
      '#bkmpQaPanel .qa-sec-title{font-weight:bold;color:#9fd6ff;margin-bottom:4px}',
      '#bkmpQaPanel button{display:inline-block;margin:2px 3px 2px 0;padding:4px 7px;',
      'background:#2a2733;color:#e8e6f0;border:1px solid #4a465a;border-radius:5px;',
      'cursor:pointer;font:11px monospace}',
      '#bkmpQaPanel button:hover{background:#3a3648}',
      '#bkmpQaPanel .qa-state{background:#1c1a24;padding:5px 6px;border-radius:5px;margin-bottom:4px;word-break:break-word}',
      '#bkmpQaPanel .qa-msg{min-height:14px;margin-top:6px}',
      '#bkmpQaPanel .qa-toggle{position:fixed;right:12px;bottom:12px;z-index:999999;',
      'background:#ffb020;color:#14131a;border:none;border-radius:20px;padding:6px 12px;',
      'font:12px/1 monospace;font-weight:bold;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)}'
    ].join('');
    document.head.appendChild(style);

    var panel = document.createElement('div');
    panel.id = 'bkmpQaPanel';
    panel.setAttribute('data-testid', 'qa-panel');

    var teststandButtons = Object.keys(TESTSTAND_INFO).map(function (id) {
      return '<button type="button" data-qa-load="' + id + '" title="' + TESTSTAND_INFO[id].label + '">' + id + '</button>';
    }).join('');

    panel.innerHTML =
      '<h3>QA-Kontrollfenster</h3>' +
      '<div class="qa-state" id="bkmpQaState">lade...</div>' +
      '<div class="qa-sec">' +
        '<div class="qa-sec-title">Testspielstand</div>' +
        teststandButtons +
        '<button type="button" data-qa-reset="1" title="Entspricht Teststand A">🔄 Reset</button>' +
      '</div>' +
      '<div class="qa-sec">' +
        '<div class="qa-sec-title">Werte setzen (aktueller Login)</div>' +
        '<button type="button" data-qa-set="gold">💰 Viel Gold</button>' +
        '<button type="button" data-qa-set="xp">⭐ Viel EXP</button>' +
        '<button type="button" data-qa-set="resources">📦 Testressourcen</button>' +
        '<button type="button" data-qa-set="unlock">🔓 Bereiche freischalten</button>' +
      '</div>' +
      '<div class="qa-sec">' +
        '<div class="qa-sec-title">Spielzeit (GameClock)</div>' +
        '<div class="qa-state" id="bkmpQaClock">-</div>' +
        '<button type="button" data-qa-clock="1h">+1 Std.</button>' +
        '<button type="button" data-qa-clock="1d">+1 Tag</button>' +
        '<button type="button" data-qa-clock="reset">Zuruecksetzen</button>' +
      '</div>' +
      '<div class="qa-sec">' +
        '<div class="qa-sec-title">Ansicht</div>' +
        '<button type="button" data-qa-mobile="1">📱 Mobile-Fenster (390x844)</button>' +
      '</div>' +
      '<div class="qa-msg" id="bkmpQaMsg"></div>' +
      '<button type="button" data-qa-hide="1" style="margin-top:6px">Panel verstecken</button>';

    document.body.appendChild(panel);
    msgEl = document.getElementById('bkmpQaMsg');

    var toggle = document.createElement('button');
    toggle.className = 'qa-toggle';
    toggle.id = 'bkmpQaToggle';
    toggle.type = 'button';
    toggle.textContent = 'QA';
    toggle.style.display = 'none';
    document.body.appendChild(toggle);

    panel.addEventListener('click', function (e) {
      var target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.qaLoad) qaLoadTeststand(target.dataset.qaLoad);
      else if (target.dataset.qaReset) qaLoadTeststand('A');
      else if (target.dataset.qaClock === '1h') { window.bkmpGameClockAdvance(3600000); qaRefreshClock(); }
      else if (target.dataset.qaClock === '1d') { window.bkmpGameClockAdvance(86400000); qaRefreshClock(); }
      else if (target.dataset.qaClock === 'reset') { window.bkmpGameClockReset(); qaRefreshClock(); }
      else if (target.dataset.qaMobile) {
        window.open(window.location.href, 'bkmpQaMobile', 'width=390,height=844');
      } else if (target.dataset.qaHide) {
        panel.style.display = 'none';
        toggle.style.display = '';
      } else if (target.dataset.qaSet === 'gold') {
        qaPatchState({ gold: 10000000 }, 'Gold gesetzt (10.000.000)');
      } else if (target.dataset.qaSet === 'xp') {
        qaPatchState({ xp: 5000000 }, 'EXP gesetzt (5.000.000)');
      } else if (target.dataset.qaSet === 'resources') {
        qaPatchState({ wood: 500000, stone: 500000, crystals: 50000, essence: 50000, mana: 50000, fruit: 50000, meat: 50000 }, 'Testressourcen gesetzt');
      } else if (target.dataset.qaSet === 'unlock') {
        qaPatchState({
          level: 999, highest_dragon_index: 999, current_dragon_index: 500,
          dragon_kills: 100000, boss_kills: 5000, skill_points_available: 50,
          turm_highest_wave: 100
        }, 'Hauptbereiche freigeschaltet');
      }
    });

    toggle.addEventListener('click', function () {
      panel.style.display = '';
      toggle.style.display = 'none';
    });

    qaRefreshState();
    qaRefreshClock();
    window.setInterval(qaRefreshClock, 1000);
    window.setInterval(qaRefreshState, 2000);
  }

  function qaRefreshClock() {
    var el = document.getElementById('bkmpQaClock');
    if (el) el.textContent = qaFormatSimTime();
  }

  async function qaRefreshState() {
    var el = document.getElementById('bkmpQaState');
    if (!el) return;
    var statusResult = await qaFetch('/__qa__/status', { method: 'GET' }).catch(function () { return null; });
    var serverInfo = statusResult && statusResult.status === 200
      ? 'Mock-Server aktiv, Teststand: ' + (statusResult.json.teststand || '?')
      : 'Mock-Server nicht erreichbar!';
    el.innerHTML = '⚠️ QA-MODUS AKTIV<br>' + serverInfo + '<br>' + qaCurrentPlayerSummary();
  }

  function qaInit() {
    qaBuildPanel();
    qaTryAutoLogin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', qaInit);
  } else {
    qaInit();
  }
})();

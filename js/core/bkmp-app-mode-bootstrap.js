    /* ============================================================
       App-Modus-Bootstrap (/app oder ?app=idledorf, Flag+Klasse schon
       ganz oben im <head> gesetzt). Oeffnet das Idle-Dorf automatisch
       ueber die ganz normale bkmpIdleOpenModal()-Funktion (dieselbe, die
       auch der Button auf der Hauptseite auslöst) - kein eigener,
       zweiter Code-Pfad. Steht bewusst als LETZTES Skript vor </body>,
       also erst NACHDEM idledorf.js (bkmpIdleOpenModal, idleDorfButton-
       Listener) und der ESC-Sweep oben (window.BKMP_OVERLAY_CLOSERS)
       schon geladen/eingerichtet sind.
       ============================================================ */
    /* Redesign Phase 5 (17.07.): die Tab-Ueberlauf-Organisation (Icon/Label-
       Split + "Mehr"-Menue) war bisher reines /app-Verhalten. Sie ist aber
       rein darstellerisch (baut nur um, keine neue Spiel-Logik) und genau
       das, was die im selben Redesign-Schritt promovierte, jetzt IMMER
       aktive mobile Bottom-Navigation braucht, um mit 14 statt 3 Tabs nicht
       zu ueberlaufen - deshalb ausgelagert und zusaetzlich bei JEDEM Laden
       auf schmalen Viewports ausgefuehrt (nicht mehr nur unter /app). Auf
       breiten Viewports unangetastet: dort zeigt die neue gruppierte
       Desktop-Tableiste (siehe style.css) ohnehin alle 14 Tabs unveraendert
       nebeneinander, kein Ueberlauf-Menue noetig. */
    function bkmpIdleSetupMobileTabOverflow() {
      /* Bottom-Navigation-Optik (Phase 3): teilt "⚔️ Kampf" einmalig in
         Icon-Zeile + Label-Zeile auf, rein fuer die Darstellung. Das
         Button-Element selbst (ID, Klick-Listener aus bkmpIdleInitTabs)
         bleibt unangetastet - nur sein Inhalt wird umstrukturiert. */
      document.querySelectorAll('.idle-dorf-tab').forEach(function (btn) {
        var text = btn.textContent.trim();
        var match = text.match(/^(\S+)\s*(.*)$/);
        if (!match || !match[2]) return;
        btn.innerHTML =
          '<span class="idle-dorf-tab-icon">' + match[1] + '</span>' +
          '<span class="idle-dorf-tab-label">' + match[2] + '</span>';
      });

      /* Bottom-Navigation "Mehr"-Menue (Nutzerwunsch nach dem ersten
         Live-Test: "Buttons unten muessen viel groesser, die wichtigsten
         gross, ein Mehr-Button fuer den Rest"). Nur die Haupt-Tabs bleiben
         unten, der Rest wandert per appendChild (verschiebt die
         ECHTEN Button-Elemente, keine Kopie) in ein ausklappbares
         Menue - die Klick-Listener aus bkmpIdleInitTabs bleiben dadurch
         unveraendert erhalten, idledorf.js wird nicht angefasst. */
      /* Nutzer-Wunsch nach Live-Test: nur noch 3 grosse Haupt-Tabs
         statt 5 - Kampf (Kernschleife), Dungeon (haeufigste
         Progression/Schluessel-Ressource), Gilde (sozial + Gildenboss).
         Dorf-Skins/Drachenzucht wandern zu den anderen 9 ins
         Mehr-Menue - seltener gecheckte Sammel-/Kosmetik-Bereiche. */
      var PRIMARY_TAB_IDS = ['idleTabBtnKampf', 'idleTabBtnDungeon', 'idleTabBtnGilde'];
      var tabsBar = document.getElementById('idleDorfTabs');
      var moreSheet = document.getElementById('idleAppMoreSheet');
      var moreSheetGrid = document.getElementById('idleAppMoreSheetGrid');
      if (!tabsBar || !moreSheet || !moreSheetGrid) return;
      if (document.getElementById('idleAppMoreBtn')) return; // schon eingerichtet (z.B. erneuter Aufruf)

      /* Recherche-Ergaenzung: verwandte Punkte im "Mehr"-Menue nach
         Kategorie gruppieren statt als eine flache 3x3-Liste (siehe
         NN/g-Subnavigations-Muster) - macht 9 Eintraege deutlich
         schneller erfassbar. */
      var MORE_GROUPS = [
        { title: '📈 Fortschritt', ids: ['idleTabBtnUpgrades', 'idleTabBtnSkilltree', 'idleTabBtnPrestige', 'idleTabBtnRunen'] },
        { title: '⚔️ Kampf & Rang', ids: ['idleTabBtnArena', 'idleTabBtnBestenliste'] },
        { title: '🛡️ Gilde', ids: ['idleTabBtnGildeTech', 'idleTabBtnGildeBoss'] },
        { title: '🏆 Sammlung', ids: ['idleTabBtnErfolge', 'idleTabBtnSkins', 'idleTabBtnDrachen'] }
      ];
      var allTabs = Array.prototype.slice.call(tabsBar.querySelectorAll('.idle-dorf-tab'));
      var byId = {};
      allTabs.forEach(function (btn) { byId[btn.id] = btn; });

      /* Desktop gruppiert die 15 Tabs seit Phase 5.1 (zweite Struktur-
         Korrektur) in echte Container (.idle-dorf-tab-group > -label +
         -buttons, siehe index.html/style.css) statt einer flachen Liste.
         Mobil gilt weiterhin die eigene, aeltere 3-Haupt-Tabs+Mehr-Logik
         hier unten - deshalb zuerst die 3 Haupt-Tabs aus ihren Desktop-
         Gruppen-Containern "auspacken" (appendChild verschiebt das ECHTE
         Element an das Ende von tabsBar, keine Kopie) und danach jeden
         jetzt leeren Gruppen-Container entfernen. So bleibt exakt dieselbe
         flache Mobil-Struktur wie vor der Desktop-Gruppierung erhalten,
         ohne dass die Desktop-Struktur dafuer verschlechtert werden muss. */
      PRIMARY_TAB_IDS.forEach(function (id) { if (byId[id]) tabsBar.appendChild(byId[id]); });

      MORE_GROUPS.forEach(function (group) {
        var present = group.ids.filter(function (id) { return byId[id] && PRIMARY_TAB_IDS.indexOf(id) === -1; });
        if (!present.length) return;
        var heading = document.createElement('div');
        heading.className = 'idle-app-more-sheet-group-title';
        heading.textContent = group.title;
        moreSheetGrid.appendChild(heading);
        present.forEach(function (id) { moreSheetGrid.appendChild(byId[id]); });
      });
      /* Sicherheitsnetz: jeder Tab, der aus irgendeinem Grund in
         keiner Gruppe oben gelistet ist, landet trotzdem im Menue
         (ungruppiert am Ende) statt spurlos zu verschwinden. */
      allTabs.forEach(function (btn) {
        if (PRIMARY_TAB_IDS.indexOf(btn.id) === -1 && !moreSheetGrid.contains(btn)) {
          moreSheetGrid.appendChild(btn);
        }
      });

      /* Jetzt leere Desktop-Gruppen-Huellen (Label + leerer Buttons-Container,
         nachdem alle echten Tabs oben herausgeloest wurden) restlos entfernen -
         sonst blieben leere, aber weiterhin sichtbare Ueberschriften/Rahmen
         in der mobilen Leiste zurueck. */
      Array.prototype.slice.call(tabsBar.querySelectorAll('.idle-dorf-tab-group')).forEach(function (group) {
        group.remove();
      });

      var moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.id = 'idleAppMoreBtn';
      moreBtn.className = 'idle-dorf-tab';
      moreBtn.innerHTML = '<span class="idle-dorf-tab-icon">☰</span><span class="idle-dorf-tab-label">Mehr</span>';
      tabsBar.appendChild(moreBtn);

      function closeMoreSheet() { moreSheet.classList.remove('open'); }
      function toggleMoreSheet() { moreSheet.classList.toggle('open'); }
      window.__bkmpCloseAppMoreSheet = closeMoreSheet;
      window.__bkmpAppMoreSheetOpen = function () { return moreSheet.classList.contains('open'); };

      moreBtn.addEventListener('click', toggleMoreSheet);
      moreSheetGrid.addEventListener('click', function (e) {
        if (e.target.closest('.idle-dorf-tab')) closeMoreSheet();
      });
      moreSheet.addEventListener('click', function (e) {
        if (e.target === moreSheet) closeMoreSheet();
      });

      /* "Mehr"-Button leuchtet mit, solange der aktuell aktive Tab
         einer der verschobenen (jetzt im Menue liegenden) ist - sonst
         saehe es nach dem Schliessen so aus, als waere gar nichts
         mehr ausgewaehlt. */
      new MutationObserver(function () {
        var activeInMenu = Array.prototype.some.call(
          moreSheetGrid.querySelectorAll('.idle-dorf-tab'),
          function (btn) { return btn.classList.contains('active'); }
        );
        moreBtn.classList.toggle('active', activeInMenu);
      }).observe(moreSheetGrid, { attributes: true, attributeFilter: ['class'], subtree: true });
    }
    /* Bei jedem Laden auf schmalen Viewports ausfuehren (Startseite UND
       /app) - derselbe Breakpoint wie die Bottom-Nav-CSS oben. Bewusst
       einmalig bei Ladezeit geprueft statt live auf resize zu reagieren
       (die Idle-Dorf-Tableiste existiert in einem Modal, das i.d.R. nicht
       waehrend eines laufenden Fenster-Groessenwechsels offen ist). */
    if (window.BKMP_APP_MODE || window.matchMedia('(max-width: 760px)').matches) {
      bkmpIdleSetupMobileTabOverflow();
    }

    /* Ressourcen-Kacheln in der Portrait-HUD antippen = direkt zum
       passenden Tab springen (Nutzer-Wunsch: Ressourcenleiste soll mehr
       als reine Anzeige sein). Nutzt Event-Delegation auf #idleDorfHud
       (der Inhalt wird bei jedem Update per innerHTML neu erzeugt, siehe
       bkmpIdleRenderHud) und die data-app-tab-Attribute, die nur die
       kompakte Portrait-Vorlage mitliefert - auf breiten Viewports (alte
       Vorlage ohne data-app-tab) bleibt dieser Listener folgenlos inert.
       Redesign Phase 5 (17.07.): deshalb unconditional, nicht mehr an
       window.BKMP_APP_MODE gebunden - siehe bkmp-hud.js fuer die
       zugehoerige Vorlagen-Umschaltung. */
    (function () {
      var hud = document.getElementById('idleDorfHud');
      if (hud) {
        hud.addEventListener('click', function (e) {
          var target = e.target.closest('[data-app-tab]');
          if (!target) return;
          var btn = document.getElementById(target.getAttribute('data-app-tab'));
          if (btn) btn.click();
        });
      }
    })();

    if (window.BKMP_APP_MODE) {
      (function () {
        document.title = 'Idle Drachen Dorf';

        async function boot() {
          if (typeof bkmpIdleOpenModal === 'function') {
            await bkmpIdleOpenModal();
          }
          /* Egal ob Spiel, Login- oder Wartungs-Overlay dabei geoeffnet
             wurde (alle drei setzen synchron/vor dem Zurueckkehren ihre
             eigene .visible-Klasse) - der Ladebildschirm darf jetzt weg. */
          document.documentElement.classList.add('bkmp-app-ready');
        }
        boot();

        /* Android-Zurueck-Taste/-Geste: schliesst offene Unter-Dialoge
           (Stufen-Auswahl, Hilfe-Popups, Bestaetigungen, ...) einzeln statt
           die App direkt zu verlassen - dieselbe Zuordnung wie der ESC-
           Sweep oben (window.BKMP_OVERLAY_CLOSERS), nur nicht fuer die drei
           "Grundbildschirme" (Idle-Dorf selbst, Login, Wartungshinweis) -
           bei denen soll Zurueck tatsaechlich die App verlassen, statt auf
           einem leeren, dunklen Bildschirm ohne jede Bedienmoeglichkeit
           haengen zu bleiben (Header/Nav/Buttons sind im App-Modus ja
           ausgeblendet). */
        var ROOT_OVERLAY_IDS = ['idleDorfOverlay', 'mcNameOverlay', 'idleMaintenanceOverlay'];
        var guardPushed = false;

        function visibleSubOverlays() {
          return Array.prototype.filter.call(
            document.querySelectorAll('.joke-overlay.visible'),
            function (el) { return ROOT_OVERLAY_IDS.indexOf(el.id) === -1; }
          );
        }
        function closeTopOverlay() {
          var list = visibleSubOverlays();
          if (!list.length) return false;
          var el = list[list.length - 1];
          var closer = window.BKMP_OVERLAY_CLOSERS && window.BKMP_OVERLAY_CLOSERS[el.id];
          if (closer) closer(); else el.classList.remove('visible');
          return true;
        }
        window.addEventListener('popstate', function () {
          if (window.__bkmpAppMoreSheetOpen && window.__bkmpAppMoreSheetOpen()) {
            window.__bkmpCloseAppMoreSheet();
            history.pushState({ bkmpAppGuard: true }, '');
            return;
          }
          if (closeTopOverlay()) history.pushState({ bkmpAppGuard: true }, '');
        });
        /* Statt jeden einzelnen .classList.add('visible')-Aufruf im Code
           aufzuspueren (dutzende Stellen), beobachtet ein MutationObserver
           einfach, ob GERADE ein Unter-Dialog (oder das "Mehr"-Menue)
           sichtbar ist, und haelt per pushState() genau EINEN "Puffer"-
           Eintrag in der History bereit, solange das der Fall ist. */
        new MutationObserver(function () {
          var moreOpen = window.__bkmpAppMoreSheetOpen && window.__bkmpAppMoreSheetOpen();
          var hasSub = visibleSubOverlays().length > 0 || moreOpen;
          if (hasSub && !guardPushed) {
            guardPushed = true;
            history.pushState({ bkmpAppGuard: true }, '');
          } else if (!hasSub) {
            guardPushed = false;
          }
        }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

        /* "Auf den Startbildschirm holen" - Chrome verlangt fuer den
           eigenen Installations-Dialog (beforeinstallprompt) einen
           registrierten Service Worker (siehe sw.js, reines Passthrough,
           kein Caching). Banner erscheint nur, wenn der Browser das
           Event tatsaechlich feuert (heisst: Installations-Kriterien
           erfuellt UND noch nicht installiert) - auf Browsern ohne diese
           API (z.B. Safari/iOS) bleibt es einfach unsichtbar, dort bleibt
           nur "Zum Home-Bildschirm" ueber das Browser-eigene Teilen-Menue. */
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/sw.js').catch(function () {});
        }
        var deferredInstallPrompt = null;
        var installBanner = document.getElementById('idleAppInstallBanner');
        var installBtn = document.getElementById('idleAppInstallBtn');
        window.addEventListener('beforeinstallprompt', function (e) {
          e.preventDefault();
          deferredInstallPrompt = e;
          if (installBanner) installBanner.classList.add('visible');
        });
        if (installBtn) {
          installBtn.addEventListener('click', function () {
            if (installBanner) installBanner.classList.remove('visible');
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            deferredInstallPrompt = null;
          });
        }
        window.addEventListener('appinstalled', function () {
          if (installBanner) installBanner.classList.remove('visible');
          deferredInstallPrompt = null;
        });

        /* Raidboss-Beitritts-Banner (Phase 2 des App-Redesigns): puls/
           blinkt in den letzten 5 Minuten. Liest dafuer nur rein lesend
           bkmpRaidGetPhaseInfo() aus idledorf.js aus (bereits global,
           unveraendert) - idledorf.js selbst bleibt unangetastet. */
        setInterval(function () {
          if (typeof bkmpRaidGetPhaseInfo !== 'function') return;
          var banner = document.getElementById('raidJoinBanner');
          if (!banner) return;
          var info = bkmpRaidGetPhaseInfo();
          var urgent = info.phase === 'prep' && info.msUntilFightStart <= 5 * 60 * 1000;
          banner.classList.toggle('raid-urgent', urgent);
        }, 1000);

        /* Bug-Fix 19.07.: #raidAttackBtn wird jetzt unconditional direkt in
           idledorf.js an bkmpRaidHandleBossClick gehaengt (lief hier bisher
           NUR im echten App-Modus, auf der normalen Website blieb der
           Button dadurch komplett wirkungslos - Spieler-Meldung "Was ist
           das? Es bewirkt nichts?"). Dieser Proxy-Listener hier waere jetzt
           nur noch ein zweiter, ueberfluessiger Ausloeser derselben Aktion. */
      })();
    }

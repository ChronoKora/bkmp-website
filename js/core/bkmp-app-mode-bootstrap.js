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
    /* KOMPLETT-UMBAU (23.07., dringende Spieler-Meldungsflut "Tabs
       verschwinden/nicht klickbar ueber mehrere Faelle: Kampf, Gilde,
       Runen, Bestenliste, Prestige, Skilltree, Drachenzucht, Turm,
       Dungeon, Weltboss", Nutzer-Entscheidung "Punkt 3" - die saubere
       strukturelle Loesung statt eines weiteren Pflasters):
       Root Cause war, dass diese ganze Umverteilung bisher NUR EINMAL beim
       Laden lief und dabei UNWIDERRUFLICH echte DOM-Knoten verschob (6
       Haupt-Tabs bleiben in #idleDorfTabs, 9 wandern in #idleAppMoreSheet)
       und die .idle-dorf-tab-group-Container entfernte. Passte das Fenster
       zum Ladezeitpunkt zufaellig ins schmale/App-Muster (z.B. Browser noch
       nicht maximiert, Snap-Layout, Zoom/DPI, oder echter App-Modus/PWA -
       dort per Absicht IMMER kompakt, siehe bkmpIdleWantCompactTabNav()
       unten), waren 9 der 15 Tabs von da an bis zu einem vollstaendigen
       Neuladen nur noch ueber "Mehr" erreichbar. Ein frueheres
       Resize->Reload-Sicherheitsnetz (siehe Git-Historie) hat das nur
       UNVOLLSTAENDIG aufgefangen: lief nie im echten App-Modus (dort
       bewusst deaktiviert - genau die von mehreren Spielern gemeldeten
       Faelle "Handy/installierte App zeigt kaum noch Tabs"), reagierte nur
       auf ein echtes 'resize'-Event (nicht auf Zoom/DPI/Snap-Faelle, die
       das nicht zuverlaessig feuern) und riss den Spieler bei jedem Treffer
       per vollem Seiten-Reload aus seinem Spielstand.
       Jetzt: dieselbe Umverteilung ist ein JEDERZEIT sicher wiederholbarer
       Soll-Zustand-Abgleich (bkmpIdleSyncTabOverflowForViewport), der beim
       Laden UND bei jeder relevanten Breitenaenderung (debounced 'resize'-
       Listener, siehe unten) erneut ausgefuehrt wird und in BEIDE
       Richtungen funktioniert - kein Reload mehr noetig, kein dauerhaft
       verlorener Tab mehr moeglich, greift jetzt auch im echten App-Modus
       (die dortige Absicht "immer kompakt" bleibt erhalten, siehe
       bkmpIdleWantCompactTabNav()). Die .idle-dorf-tab-group-Container
       muessen dafuer nicht mehr rekonstruiert werden: seit Phase 7.1 Stufe 3
       ist ".idle-dorf-tab-group{display:contents}" ohnehin UNBEDINGT (nicht
       mehr nur mobil) - die 15 Tabs sind strukturell schon eine flache
       Liste, die alten Gruppen-Huellen werden weiterhin einmalig beim
       ersten Aufbau entfernt (rein kosmetisch, spart ein paar leere
       DOM-Knoten), muessen aber nie wieder hergestellt werden. */
    var BKMP_TAB_OVERFLOW_PRIMARY_IDS = ['idleTabBtnKampf', 'idleTabBtnUpgrades', 'idleTabBtnSkilltree', 'idleTabBtnPrestige', 'idleTabBtnDrachen', 'idleTabBtnDungeon'];
    var BKMP_TAB_OVERFLOW_GROUPS = [
      { title: '📈 Fortschritt', ids: ['idleTabBtnRunen', 'idleTabBtnErfolge'] },
      { title: '⚔️ Kampf & Rang', ids: ['idleTabBtnArena', 'idleTabBtnBestenliste', 'idleTabBtnTurm'] },
      { title: '🛡️ Gilde', ids: ['idleTabBtnGilde', 'idleTabBtnGildeTech', 'idleTabBtnGildeBoss'] },
      { title: '🏆 Sammlung', ids: ['idleTabBtnSkins'] }
    ];
    var bkmpTabOverflowAllIdsInOrder = null;
    var bkmpTabOverflowBuilt = false;
    var bkmpTabOverflowCurrentlyCompact = null;

    /* Breite allein reicht nicht: breite-aber-flache Quer-Handys (haeufig
       700-950px breit, siehe schon der Phase-7.0-Fund zu #bkmpProtoCompactNav
       weiter unten in style.css, "(max-height:500px) and (orientation:
       landscape)") wuerden von einem reinen max-width:760px-Check nie erfasst
       - dieselbe Bedingung wie die CSS-Fixierung des Kompakt-Nav muss hier
       exakt gespiegelt sein, sonst zeigt sich (beim 23.07.-Umbau gefunden,
       existierte vorher genauso) auf so einem Geraet die alte Desktop-
       Tableiste in einem viel zu flachen Fenster statt der dafuer gebauten
       kompakten Fassung. */
    function bkmpIdleWantCompactTabNav() {
      return !!(window.BKMP_APP_MODE
        || window.matchMedia('(max-width: 760px)').matches
        || window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches);
    }

    /* Einmaliger Aufbau: Icon/Label-Split, "Mehr"-Button + Listener,
       urspruengliche Tab-Reihenfolge merken. Absichtlich UNBEDINGT (nicht
       mehr an eine Breite gebunden) - baut nur inerte Struktur, entscheidet
       selbst nichts ueber Sichtbarkeit (das macht ausschliesslich
       bkmpIdleSyncTabOverflowForViewport, jederzeit erneut aufrufbar). */
    function bkmpIdleBuildMobileTabOverflowUi() {
      if (bkmpTabOverflowBuilt) return;
      var tabsBar = document.getElementById('idleDorfTabs');
      var moreSheet = document.getElementById('idleAppMoreSheet');
      var moreSheetGrid = document.getElementById('idleAppMoreSheetGrid');
      if (!tabsBar || !moreSheet || !moreSheetGrid) return;
      bkmpTabOverflowBuilt = true;

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

      /* Urspruengliche Reihenfolge merken, BEVOR irgendetwas verschoben
         wird - das ist die kanonische Liste, in die bei Desktop-Breite
         jederzeit zurueckgestellt wird. */
      bkmpTabOverflowAllIdsInOrder = Array.prototype.slice.call(tabsBar.querySelectorAll('.idle-dorf-tab')).map(function (btn) { return btn.id; });

      /* Desktop gruppiert die 15 Tabs seit Phase 5.1 in Container
         (.idle-dorf-tab-group > -label + -buttons, siehe index.html/
         style.css) - seit Phase 7.1 Stufe 3 sind diese Huellen aber auf
         JEDER Breite "display:contents" (rein struktureller Marker ohne
         eigene Optik), die echten Tabs koennen also gefahrlos als direkte
         Kinder von tabsBar herausgeloest werden (appendChild verschiebt
         das ECHTE Element, keine Kopie) - danach die jetzt leeren Huellen
         entfernen. */
      bkmpTabOverflowAllIdsInOrder.forEach(function (id) { var el = document.getElementById(id); if (el) tabsBar.appendChild(el); });
      Array.prototype.slice.call(tabsBar.querySelectorAll('.idle-dorf-tab-group')).forEach(function (group) { group.remove(); });

      var moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.id = 'idleAppMoreBtn';
      moreBtn.className = 'idle-dorf-tab';
      moreBtn.style.display = 'none'; // bkmpIdleSyncTabOverflowForViewport entscheidet
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

    /* Jederzeit sicher wiederholbarer Soll-Zustand-Abgleich: verschiebt (nur
       bei tatsaechlichem Wechsel, siehe bkmpTabOverflowCurrentlyCompact-
       Cache, damit nicht bei jedem Resize-Tick unnoetig im DOM gewuehlt
       wird) die 9 "sekundaeren" Tabs zwischen #idleDorfTabs und dem
       gruppierten "Mehr"-Sheet hin und her - komplett reversibel, kein
       Reload noetig. Wird beim Laden UND bei jeder relevanten
       Breitenaenderung aufgerufen (siehe Resize-Listener unten). */
    function bkmpIdleSyncTabOverflowForViewport() {
      bkmpIdleBuildMobileTabOverflowUi();
      if (!bkmpTabOverflowBuilt) return;
      var wantCompact = bkmpIdleWantCompactTabNav();
      if (wantCompact === bkmpTabOverflowCurrentlyCompact) return;
      bkmpTabOverflowCurrentlyCompact = wantCompact;

      var tabsBar = document.getElementById('idleDorfTabs');
      var moreSheet = document.getElementById('idleAppMoreSheet');
      var moreSheetGrid = document.getElementById('idleAppMoreSheetGrid');
      var moreBtn = document.getElementById('idleAppMoreBtn');
      if (!tabsBar || !moreSheet || !moreSheetGrid || !moreBtn) return;

      if (wantCompact) {
        moreSheetGrid.querySelectorAll('.idle-app-more-sheet-group-title').forEach(function (h) { h.remove(); });
        BKMP_TAB_OVERFLOW_PRIMARY_IDS.forEach(function (id) { var el = document.getElementById(id); if (el) tabsBar.appendChild(el); });
        tabsBar.appendChild(moreBtn);
        BKMP_TAB_OVERFLOW_GROUPS.forEach(function (group) {
          var present = group.ids.filter(function (id) { return !!document.getElementById(id); });
          if (!present.length) return;
          var heading = document.createElement('div');
          heading.className = 'idle-app-more-sheet-group-title';
          heading.textContent = group.title;
          moreSheetGrid.appendChild(heading);
          present.forEach(function (id) { moreSheetGrid.appendChild(document.getElementById(id)); });
        });
        /* Sicherheitsnetz: jeder Tab, der aus irgendeinem Grund in
           keiner Gruppe oben gelistet ist, landet trotzdem im Menue
           (ungruppiert am Ende) statt spurlos zu verschwinden. */
        bkmpTabOverflowAllIdsInOrder.forEach(function (id) {
          if (BKMP_TAB_OVERFLOW_PRIMARY_IDS.indexOf(id) === -1) {
            var el = document.getElementById(id);
            if (el && !moreSheetGrid.contains(el)) moreSheetGrid.appendChild(el);
          }
        });
        moreBtn.style.display = '';
      } else {
        bkmpTabOverflowAllIdsInOrder.forEach(function (id) { var el = document.getElementById(id); if (el) tabsBar.appendChild(el); });
        moreSheetGrid.querySelectorAll('.idle-app-more-sheet-group-title').forEach(function (h) { h.remove(); });
        moreBtn.style.display = 'none';
        if (moreSheet.classList.contains('open')) moreSheet.classList.remove('open');
      }
    }

    bkmpIdleSyncTabOverflowForViewport();

    /* Bei jeder relevanten Breitenaenderung erneut abgleichen (debounced,
       200ms) - ersetzt den frueheren Resize->Reload-Notnagel komplett:
       kein Seiten-Reload mehr, kein verlorener Spielstand, greift jetzt
       auch im echten App-Modus (dort bleibt bkmpIdleWantCompactTabNav()
       durch window.BKMP_APP_MODE ohnehin unabhaengig von der Breite immer
       true - die Absicht "App = immer kompakt" bleibt unangetastet, der
       fruehere Totalausschluss vom Resize-Handling war fuer diesen Zweck
       nie noetig, da die Funktion selbst schon fruehzeitig abbricht, wenn
       sich am Soll-Zustand nichts aendert). */
    var bkmpTabOverflowResizeTimer = null;
    window.addEventListener('resize', function () {
      if (bkmpTabOverflowResizeTimer) window.clearTimeout(bkmpTabOverflowResizeTimer);
      bkmpTabOverflowResizeTimer = window.setTimeout(bkmpIdleSyncTabOverflowForViewport, 200);
    }, { passive: true });

    /* Bug-Fix (Spieler-Meldungen 19./20.07., "seltsamer Balken" mitten in
       Skilltree/Gilde/anderen Tabs auf normaler Desktop-Breite): #idleAppMoreSheet
       steht im Markup als direktes Kind von .idle-dorf-card - genau wie beim
       "Mehr"-Menue-Fund oben (siehe KRITISCHER FUND-Kommentar bei
       "html.bkmp-app-mode .idle-dorf-overlay .idle-dorf-card {transform:none!
       important}" in style.css) macht die Oeffnen-"Pop"-Transform der Karte
       (.joke-overlay.visible .joke-card, IMMER aktiv solange das Fenster offen
       ist, nicht nur waehrend der Animation) die Karte zum neuen Bezugsrahmen
       fuer jedes position:fixed-Kind darin. Der bestehende transform:none!
       important-Fix greift nur innerhalb @media(max-width:760px) UND nur im
       echten App-Modus (html.bkmp-app-mode.zone-game) - bei normaler
       Website-Breite (Desktop, wo die Pop-Animation bewusst erhalten bleiben
       soll, siehe deren eigene Begruendung) bleibt die Luecke bestehen: das
       Sheet (inkl. seines Griff-Balkens, sichtbar auch ohne .open, da nur ein
       Teil der falsch berechneten "geschlossen"-Position noch ins Bild ragt)
       haengt dadurch an der Kartenposition statt am echten Bildschirmrand -
       genau der gemeldete Balken mitten im Tab-Inhalt. Fix: dasselbe
       Portal-Muster wie beim "Mehr"-Menue selbst (siehe
       bkmpProtoChudEscapeToOverlay in bkmp-proto-compact-hud.js) und dem
       Kampf-Log-Sheet (bkmpIdleCombatLogEscapeToOverlay in bkmp-hud.js) -
       das Sheet wird EINMALIG beim Laden (unconditional, jede Breite) zu
       einem echten Geschwister von .idle-dorf-card auf #idleDorfOverlay-Ebene
       umgehaengt, bevor es je sichtbar wird. Rein strukturell, keine
       CSS-Klasse/Funktionalitaet aendert sich dadurch. */
    (function () {
      var sheet = document.getElementById('idleAppMoreSheet');
      var overlay = document.getElementById('idleDorfOverlay');
      if (sheet && overlay && sheet.parentElement !== overlay) overlay.appendChild(sheet);
    })();

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

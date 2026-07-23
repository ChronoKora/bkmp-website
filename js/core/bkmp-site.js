    bkmpInitTheme();
    bkmpInitAccentColor();
    window.addEventListener('load', () => document.body.classList.add('page-loaded'));
    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('page-hidden', document.hidden);
    });

    /* ---------------- Swipe-Tabs ---------------- */
    const track = document.getElementById('panelsTrack');
    const viewport = document.getElementById('panelsViewport');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.panel');
    const prevBtn = document.getElementById('prevTab');
    const nextBtn = document.getElementById('nextTab');
    let current = 0;
    const total = tabBtns.length;
    const savedTab = Number(sessionStorage.getItem('bkmp-active-tab') || 0);
    const newsTabIndex = [...tabBtns].findIndex(b => b.textContent.trim().startsWith("Was gibt's Neues?"));
    /* goTo() ruft bkmpSyncNewsTabDot() auf, die auf "data" (weiter unten im
       Script mit const deklariert) zugreift. goTo() selbst wird aber schon
       HIER, ganz am Anfang des Scripts, fuer die initiale Tab-Wiederherstellung
       aufgerufen - "data" ist an dieser Stelle noch in der Temporal Dead Zone.
       Ohne dieses Flag wuerde JEDER Aufruf von goTo() (auch jeder spaetere
       Tab-Klick) einen "Cannot access 'data' before initialization"-Fehler
       werfen und die Ausfuehrung des GESAMTEN restlichen Scripts abbrechen -
       nicht nur den News-Punkt, sondern buchstaeblich alles danach (Kartenideen,
       Investoren, Achievements, ...). bkmpDataReady wird direkt nach der
       echten Initialisierung von "data" weiter unten auf true gesetzt. */
    let bkmpDataReady = false;

    /* .panels-track ist eine Flex-Reihe mit allen 10 Panels nebeneinander -
       auch mit align-items:flex-start (siehe style.css) bestimmt trotzdem
       IMMER das hoechste Panel die Eigenhoehe der Reihe (so rechnet Flexbox
       die Kreuzachsen-Groesse einer Zeile aus, unabhaengig von align-items).
       Die Kartendatenbank ist mit ~14500px (viele Karten) mit Abstand am
       hoechsten, wodurch .panels-viewport (overflow:hidden) auf diese Hoehe
       mitwuchs und JEDE andere, eigentlich kurze Seite genauso lang
       scrollbar machte (Spieler-Meldung: "auf allen Seiten endlos
       scrollen"). Fix: die Viewport-Hoehe wird explizit auf die Hoehe NUR
       des gerade aktiven Panels gesetzt - bei jedem Tab-Wechsel neu, plus
       einmal verzoegert danach (faengt Karten/Investoren/... ab, die erst
       nach dem Tab-Wechsel asynchron nachgeladen werden) und bei jedem
       Fenster-Resize. Bewusst KEIN ResizeObserver hier - der reagiert auch
       auf Groessenaenderungen, die durch das eigene Setzen von
       viewport.style.height indirekt ausgeloest werden, und kann sich damit
       leicht aufschaukeln. */
    function bkmpSyncPanelHeight() {
      viewport.style.height = panels[current].scrollHeight + 'px';
    }
    window.addEventListener('resize', bkmpSyncPanelHeight);

    function goTo(index, options = {}) {
      current = Math.max(0, Math.min(total - 1, index));
      track.style.transform = `translate3d(-${current * 100}%, 0, 0)`;
      tabBtns.forEach((btn, i) => {
        const active = i === current;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((panel, i) => panel.classList.toggle('active-panel', i === current));
      bkmpSyncPanelHeight();
      setTimeout(bkmpSyncPanelHeight, 400);
      if (!options.skipSave) sessionStorage.setItem('bkmp-active-tab', String(current));
      if (window.bkmpEnhanceImages) window.bkmpEnhanceImages(panels[current]);
      if (typeof bkmpSyncNewsTabDot === 'function') bkmpSyncNewsTabDot();
    }

    tabBtns.forEach((btn, i) => {
      btn.setAttribute('role', 'tab');
      btn.setAttribute('id', 'tab-' + i);
      btn.setAttribute('aria-controls', panels[i].id);
      btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
      panels[i].setAttribute('role', 'tabpanel');
      panels[i].setAttribute('aria-labelledby', 'tab-' + i);
      btn.addEventListener('click', () => goTo(Number(btn.dataset.index)));
    });
    prevBtn.addEventListener('click', () => goTo(current - 1));
    nextBtn.addEventListener('click', () => goTo(current + 1));
    goTo(Number.isFinite(savedTab) ? savedTab : 0, { skipSave: true });

    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') goTo(current - 1);
      if (e.key === 'ArrowRight') goTo(current + 1);
    });

    // Touch-Swipe
    let touchStartX = null;
    viewport.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    viewport.addEventListener('touchend', e => {
      if (touchStartX === null) return;
      const diff = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(diff) > 50) {
        diff < 0 ? goTo(current + 1) : goTo(current - 1);
      }
      touchStartX = null;
    });

    /* ---------------- Kleines Easter Egg ---------------- */
    const easterTarget = 'bkmp';
    let easterBuffer = '';
    const dracheTarget = 'drache';
    let dracheBuffer = '';
    const philTarget = 'phil';
    let philBuffer = '';
    const creeperTarget = 'creeper';
    let creeperBuffer = '';
    const matrixTarget = 'matrix';
    let matrixBuffer = '';
    const zerathorTarget = 'zerathor';
    let zerathorBuffer = '';
    let konamiBuffer = [];
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

    const BKMP_AURA_KEY = 'bkmp-aura-active';
    if (localStorage.getItem(BKMP_AURA_KEY) === '1') document.body.classList.add('bkmp-aura-active');

    function triggerBkmpEasterEgg() {
      const auraNowActive = !document.body.classList.contains('bkmp-aura-active');
      document.body.classList.toggle('bkmp-aura-active', auraNowActive);
      try { localStorage.setItem(BKMP_AURA_KEY, auraNowActive ? '1' : '0'); } catch (e) {}

      if (document.getElementById('bkmpEasterEgg')) return;
      const overlay = document.createElement('div');
      overlay.id = 'bkmpEasterEgg';
      overlay.className = 'bkmp-easter';
      const sparkles = Array.from({ length: 18 }, (_, i) => `<span style="--i:${i}"></span>`).join('');
      overlay.innerHTML = `
        <div class="bkmp-easter-card">
          <small>BKMP Secret</small>
          <strong>${auraNowActive ? 'Aura aktiviert' : 'Aura deaktiviert'}</strong>
          <p>${auraNowActive ? '+2% Style, +2% Flow, +96% gute Laune.' : 'Bis zum nächsten Mal.'}</p>
        </div>
        ${sparkles}
      `;
      document.body.appendChild(overlay);
      document.body.classList.add('bkmp-boost');
      requestAnimationFrame(() => overlay.classList.add('visible'));
      setTimeout(() => {
        overlay.classList.remove('visible');
        document.body.classList.remove('bkmp-boost');
        setTimeout(() => overlay.remove(), 450);
      }, 3600);
    }

    function triggerBkmpLootRain() {
      if (document.getElementById('bkmpLootRain')) return;
      const loot = ['💎', '💰', '⚡', '🗺️', '🏆', '🍀'];
      const overlay = document.createElement('div');
      overlay.id = 'bkmpLootRain';
      overlay.className = 'bkmp-loot-rain';
      const pieces = Array.from({ length: 26 }, (_, i) => {
        const emoji = loot[i % loot.length];
        const left = Math.round(Math.random() * 100);
        const duration = (2.6 + Math.random() * 1.8).toFixed(2);
        const delay = (Math.random() * 1.2).toFixed(2);
        const size = (1.3 + Math.random() * 1.2).toFixed(2);
        return `<span style="left:${left}%; animation-duration:${duration}s; animation-delay:${delay}s; font-size:${size}rem;">${emoji}</span>`;
      }).join('');
      overlay.innerHTML = pieces;
      document.body.appendChild(overlay);
      const banner = document.createElement('div');
      banner.className = 'bkmp-loot-rain-banner';
      banner.textContent = 'Konami-Code aktiviert — Loot-Regen!';
      overlay.appendChild(banner);
      requestAnimationFrame(() => banner.classList.add('visible'));
      setTimeout(() => {
        banner.classList.remove('visible');
        setTimeout(() => overlay.remove(), 500);
      }, 4200);
    }

    function triggerBkmpFireEasterEgg() {
      if (document.getElementById('bkmpFireOverlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'bkmpFireOverlay';
      overlay.className = 'bkmp-fire';
      const flames = Array.from({ length: 22 }, () => {
        const left = Math.round(Math.random() * 100);
        const duration = (1.1 + Math.random() * 0.9).toFixed(2);
        const delay = (Math.random() * 0.5).toFixed(2);
        const size = (1.6 + Math.random() * 1.6).toFixed(2);
        return `<span style="left:${left}%; animation-duration:${duration}s; animation-delay:${delay}s; font-size:${size}rem;">🔥</span>`;
      }).join('');
      overlay.innerHTML = flames;
      document.body.appendChild(overlay);
      document.body.classList.add('bkmp-burning');
      setTimeout(() => {
        document.body.classList.remove('bkmp-burning');
        overlay.classList.add('fading');
        setTimeout(() => overlay.remove(), 500);
      }, 1800);
    }

    /* Easter Egg: "phil" tippen spielt einen Sound ab */
    function triggerBkmpPhilEasterEgg() {
      try {
        const audio = new Audio('assets/phil.mp3');
        audio.volume = 0.85;
        audio.play().catch(() => {});
      } catch (e) {}
    }

    /* Easter Egg: "creeper" tippen - Zischen, Wackeln, Entwarnung */
    function bkmpPlayHissSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const bufferSize = ctx.sampleRate * 1.1;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 900;
        const gain = ctx.createGain();
        gain.gain.value = 0.35;
        noise.connect(filter).connect(gain).connect(ctx.destination);
        noise.start();
        noise.onended = () => ctx.close();
      } catch (e) {}
    }

    function triggerBkmpCreeperEasterEgg() {
      if (document.getElementById('bkmpCreeperOverlay')) return;
      bkmpPlayHissSound();
      document.body.classList.add('bkmp-creeper-shake');
      const overlay = document.createElement('div');
      overlay.id = 'bkmpCreeperOverlay';
      overlay.className = 'bkmp-creeper-flash';
      document.body.appendChild(overlay);
      setTimeout(() => {
        document.body.classList.remove('bkmp-creeper-shake');
        overlay.classList.add('bkmp-creeper-defused');
        overlay.innerHTML = '<div class="bkmp-creeper-message">Puh... nochmal gutgegangen. 🟩</div>';
        setTimeout(() => overlay.remove(), 1800);
      }, 1100);
    }

    /* Easter Egg: "zerathor" tippen - Boss-Erwachen (Drachen-Brüll-Sound, Bildschirm-Flash+Shake) */
    function bkmpPlayZerathorRoar() {
      try {
        const audio = new Audio('assets/zerathor-roar.mp3');
        audio.volume = 0.45;
        audio.play().catch(() => {});
        return audio;
      } catch (e) { return null; }
    }

    function triggerBkmpZerathorEasterEgg() {
      if (document.getElementById('bkmpZerathorOverlay')) return;
      const audio = bkmpPlayZerathorRoar();
      document.body.classList.add('bkmp-zerathor-shake');
      const overlay = document.createElement('div');
      overlay.id = 'bkmpZerathorOverlay';
      overlay.className = 'bkmp-zerathor-flash';
      overlay.innerHTML = '<div class="bkmp-zerathor-message">ZERATHOR ist erwacht 🐉</div>';
      document.body.appendChild(overlay);
      const fadeOutZerathor = () => {
        document.body.classList.remove('bkmp-zerathor-shake');
        overlay.classList.add('bkmp-zerathor-fading');
        setTimeout(() => overlay.remove(), 700);
      };
      /* Blendet aus, sobald der Bruell-Sound zu Ende ist (statt einer fest
         verdrahteten Millisekundenzahl) - Spieler-Wunsch "Animation genau
         so lange wie der Sound". 12s-Fallback falls Autoplay blockiert wird
         und "ended" nie feuert. */
      if (audio) {
        audio.addEventListener('ended', fadeOutZerathor, { once: true });
        setTimeout(fadeOutZerathor, 12000);
      } else {
        setTimeout(fadeOutZerathor, 1500);
      }
    }

    /* Easter Egg: 7x aufs Banner klicken - Diamanten-Regen + Cha-Ching */
    function bkmpPlayChaChing() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [880, 1318.5].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = freq;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.09);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.09 + 0.35);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.09);
          osc.stop(ctx.currentTime + i * 0.09 + 0.4);
        });
        setTimeout(() => ctx.close(), 700);
      } catch (e) {}
    }

    function triggerBkmpDiamondRain() {
      if (document.getElementById('bkmpDiamondRain')) return;
      bkmpPlayChaChing();
      const loot = ['💎', '💵', '🤑'];
      const overlay = document.createElement('div');
      overlay.id = 'bkmpDiamondRain';
      overlay.className = 'bkmp-loot-rain';
      const pieces = Array.from({ length: 30 }, (_, i) => {
        const emoji = loot[i % loot.length];
        const left = Math.round(Math.random() * 100);
        const duration = (2.4 + Math.random() * 1.8).toFixed(2);
        const delay = (Math.random() * 1).toFixed(2);
        const size = (1.4 + Math.random() * 1.3).toFixed(2);
        return `<span style="left:${left}%; animation-duration:${duration}s; animation-delay:${delay}s; font-size:${size}rem;">${emoji}</span>`;
      }).join('');
      overlay.innerHTML = pieces;
      document.body.appendChild(overlay);
      const banner = document.createElement('div');
      banner.className = 'bkmp-loot-rain-banner';
      banner.textContent = 'Diamanten-Regen! 💎';
      overlay.appendChild(banner);
      requestAnimationFrame(() => banner.classList.add('visible'));
      setTimeout(() => {
        banner.classList.remove('visible');
        setTimeout(() => overlay.remove(), 500);
      }, 4200);
    }

    let bkmpBannerClickCount = 0;
    let bkmpBannerClickResetTimer = null;
    const bkmpHeroBannerEl = document.querySelector('.hero-banner');
    if (bkmpHeroBannerEl) {
      bkmpHeroBannerEl.style.cursor = 'pointer';
      bkmpHeroBannerEl.addEventListener('mousedown', e => e.preventDefault());
      bkmpHeroBannerEl.addEventListener('click', () => {
        bkmpBannerClickCount++;
        clearTimeout(bkmpBannerClickResetTimer);
        bkmpBannerClickResetTimer = setTimeout(() => { bkmpBannerClickCount = 0; }, 2500);
        if (bkmpBannerClickCount >= 7) {
          bkmpBannerClickCount = 0;
          triggerBkmpDiamondRain();
          if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('diamond');
        }
      });
    }

    /* ---------------- Bonk-Button (oben links) ---------------- */
    const BKMP_BONK_COUNT_KEY = 'bkmp-bonk-count';
    function bkmpGetBonkCount() {
      try { return Number(localStorage.getItem(BKMP_BONK_COUNT_KEY) || 0); } catch (e) { return 0; }
    }
    function bkmpSetBonkCount(n) {
      try { localStorage.setItem(BKMP_BONK_COUNT_KEY, String(n)); } catch (e) {}
    }
    function bkmpPlayBonkSound() {
      try {
        const audio = new Audio('assets/bonk-sound.mp3');
        audio.volume = 0.85;
        audio.play().catch(() => {});
      } catch (e) {}
    }
    function bkmpFormatBonkCount(count) {
      if (count >= 999500) return (count / 1000000).toFixed(count % 1000000 === 0 ? 0 : 1) + 'M';
      if (count >= 1000) return (count / 1000).toFixed(count % 1000 === 0 ? 0 : 1) + 'k';
      return String(count);
    }
    function bkmpUpdateBonkBadge(count) {
      const label = document.getElementById('bkmpBonkCount');
      if (!label) return;
      label.textContent = bkmpFormatBonkCount(count);
      label.title = count + ' Bonks';
      label.classList.toggle('visible', count > 0);
    }
    let bkmpBonkAnimTimer = null;
    const bkmpBonkButton = document.getElementById('bkmpBonkButton');
    const bkmpBonkImg = document.getElementById('bkmpBonkImg');
    if (bkmpBonkButton && bkmpBonkImg) {
      bkmpUpdateBonkBadge(bkmpGetBonkCount());
      bkmpBonkButton.addEventListener('click', () => {
        const newCount = bkmpGetBonkCount() + 1;
        bkmpSetBonkCount(newCount);
        bkmpUpdateBonkBadge(newCount);
        bkmpPlayBonkSound();
        bkmpBonkImg.removeAttribute('src');
        void bkmpBonkImg.offsetWidth;
        bkmpBonkImg.src = 'assets/bonk-animated.gif';
        clearTimeout(bkmpBonkAnimTimer);
        bkmpBonkAnimTimer = setTimeout(() => { bkmpBonkImg.src = 'assets/bonk-idle.png'; }, 3100);
        if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
      });
    }

    /* Easter Egg: "matrix" tippen - Matrix-Regen */
    function triggerBkmpMatrixRain() {
      if (document.getElementById('bkmpMatrixOverlay')) return;
      const overlay = document.createElement('canvas');
      overlay.id = 'bkmpMatrixOverlay';
      overlay.className = 'bkmp-matrix-overlay';
      document.body.appendChild(overlay);
      const ctx2d = overlay.getContext('2d');
      function resize() { overlay.width = window.innerWidth; overlay.height = window.innerHeight; }
      resize();
      const chars = 'アイウエオカキクケコサシスセソ01BKMP';
      const fontSize = 16;
      const columns = Math.floor(overlay.width / fontSize);
      const drops = Array(columns).fill(1);
      let frame = 0;
      const maxFrames = 260;
      function draw() {
        ctx2d.fillStyle = 'rgba(5, 10, 8, 0.15)';
        ctx2d.fillRect(0, 0, overlay.width, overlay.height);
        ctx2d.fillStyle = '#4ade80';
        ctx2d.font = fontSize + 'px monospace';
        drops.forEach((y, i) => {
          const char = chars[Math.floor(Math.random() * chars.length)];
          ctx2d.fillText(char, i * fontSize, y * fontSize);
          if (y * fontSize > overlay.height && Math.random() > 0.975) drops[i] = 0;
          drops[i]++;
        });
        frame++;
        if (frame < maxFrames) {
          requestAnimationFrame(draw);
        } else {
          overlay.classList.add('fading');
          setTimeout(() => overlay.remove(), 600);
        }
      }
      draw();
    }

    /* Easter Egg: "Jannik der Hase" - versteckter Bereich im Footer.
       Desktop: mehrfach ueber die unsichtbare Zone hovern. Mobil: 5s halten. */
    function bkmpPlayJannikHopSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [660, 880, 990].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = freq;
          osc.type = 'triangle';
          gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.14);
          gain.gain.linearRampToValueAtTime(0.16, ctx.currentTime + i * 0.14 + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.14 + 0.22);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.14);
          osc.stop(ctx.currentTime + i * 0.14 + 0.25);
        });
        setTimeout(() => ctx.close(), 700);
      } catch (e) {}
    }

    /* Generischer Ersatz fuer window.confirm() im hausseigenen .joke-card-Look
       statt der haesslichen nativen Browser-Box. Faellt auf window.confirm()
       zurueck, falls das Overlay-Markup mal nicht im DOM ist (z.B. wenn
       idledorf.js versehentlich auf admin.html denselben Code-Pfad erreichen
       wuerde - #bkmpConfirmOverlay existiert nur in index.html). */
    function bkmpConfirmDialog(title, body, okLabel, cancelLabel) {
      const overlay = document.getElementById('bkmpConfirmOverlay');
      if (!overlay) return Promise.resolve(window.confirm([title, body].filter(Boolean).join('\n\n')));
      return new Promise(resolve => {
        document.getElementById('bkmpConfirmTitle').textContent = title || '';
        document.getElementById('bkmpConfirmBody').textContent = body || '';
        const okBtn = document.getElementById('bkmpConfirmOkBtn');
        const cancelBtn = document.getElementById('bkmpConfirmCancelBtn');
        okBtn.textContent = okLabel || 'OK';
        cancelBtn.textContent = cancelLabel || 'Abbrechen';
        function cleanup(result) {
          overlay.classList.remove('visible');
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          resolve(result);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.classList.add('visible');
      });
    }

    function bkmpShowJannikToast(text, ms) {
      const toast = document.createElement('div');
      toast.className = 'bkmp-jannik-toast';
      toast.textContent = text;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('visible'));
      setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 450);
      }, ms);
    }

    /* ---------------- "Neu"-Badge fuer neue Inhalte (Titel/Erfolge/Pluschies/
       PartnerShops/Idle-Dorf-Sammlung) ----------------
       Generischer, pro Kategorie unabhaengiger "gesehen"-Speicher in
       localStorage. Nutzung pro Render-Durchlauf einer Liste:
         const newBadge = bkmpNewBadgeChecker('titles');   // 1x pro Render
         ... newBadge(t.id) ...                            // pro Zeile
         bkmpMarkAllSeen('titles', BKMP_TITLES.map(t => t.id));  // am Ende
       bkmpNewBadgeChecker() liest den Stand einmalig (nicht pro Zeile) UND
       erkennt den ALLERERSTEN Aufruf ueberhaupt (noch kein gespeicherter
       Stand) - dann wird nichts als "neu" angezeigt, auch wenn noch nichts
       "gesehen" war. Sonst wuerden bei einem brandneuen Besucher ploetzlich
       ALLE bestehenden Titel/Erfolge/etc. faelschlich als neu aufleuchten.
       Das anschliessende bkmpMarkAllSeen() erledigt in diesem Fall
       automatisch das Bootstrapping (speichert erstmals den vollen Stand). */
    const BKMP_SEEN_IDS_PREFIX = 'bkmp-seen-';
    function bkmpGetSeenIds(type) {
      try { return new Set(JSON.parse(localStorage.getItem(BKMP_SEEN_IDS_PREFIX + type) || '[]')); } catch (e) { return new Set(); }
    }
    function bkmpMarkAllSeen(type, ids) {
      const seen = bkmpGetSeenIds(type);
      let changed = false;
      ids.forEach(id => { if (!seen.has(id)) { seen.add(id); changed = true; } });
      if (changed) { try { localStorage.setItem(BKMP_SEEN_IDS_PREFIX + type, JSON.stringify([...seen])); } catch (e) {} }
    }
    function bkmpNewBadgeChecker(type) {
      const isFirstEver = localStorage.getItem(BKMP_SEEN_IDS_PREFIX + type) === null;
      const seen = bkmpGetSeenIds(type);
      return id => (!isFirstEver && !seen.has(id)) ? '<span class="new-badge">Neu</span>' : '';
    }

    /* Roter Punkt am "Was gibt's Neues?"-Tab (nutzt dasselbe Seen-Ids-System
       wie oben, Typ "news"). Anders als die anderen Nutzungen (Titel/
       Erfolge/Pluschies) wird hier NICHT sofort beim Rendern als "gesehen"
       markiert - renderNews() laeuft schon beim Seitenaufruf, unabhaengig
       davon, welcher Tab gerade sichtbar ist. Stattdessen: Punkt zeigen,
       solange man NICHT auf dem News-Tab ist, und erst beim tatsaechlichen
       Wechsel auf diesen Tab (siehe goTo()) als gesehen markieren. Ist man
       z. B. wegen einer gespeicherten Sitzung schon beim Laden auf diesem
       Tab, markiert der erste Aufruf hier direkt alles als gesehen. */
    function bkmpSyncNewsTabDot() {
      if (!bkmpDataReady) return;
      const dot = document.getElementById('newsTabDot');
      if (!dot || newsTabIndex < 0 || !Array.isArray(data.news)) return;
      const ids = data.news.map(n => n.id).filter(id => id !== undefined && id !== null);
      if (current === newsTabIndex) {
        bkmpMarkAllSeen('news', ids);
        dot.classList.remove('visible');
        return;
      }
      const isFirstEver = localStorage.getItem(BKMP_SEEN_IDS_PREFIX + 'news') === null;
      const seen = bkmpGetSeenIds('news');
      const hasUnseen = !isFirstEver && ids.some(id => !seen.has(id));
      dot.classList.toggle('visible', hasUnseen);
    }

    /* Generisches "Achievement freigeschaltet"-Popup fuer JEDEN Erfolg (nicht
       nur Jannik) - unten links, damit es sich nicht mit dem Live-Popup
       unten rechts ueberschneidet. bkmpCheckForNewAchievementUnlocks()
       vergleicht bei jedem renderAchievementBadge()-Aufruf die aktuell
       freigeschalteten Erfolge mit den bereits gemeldeten (localStorage) und
       queued neue Freischaltungen nacheinander. Beim allerersten Aufruf
       (localStorage noch leer) werden bereits erreichte Erfolge nur
       gespeichert, nicht angezeigt - sonst wuerden bei Bestandsspielern
       ploetzlich dutzende Popups auf einmal aufploppen.

       bkmpAchievementNotifyReady: derselbe "Zaehler war beim Login kurz zu
       niedrig"-Effekt, der schon fuer den DB-Sync (siehe force-Parameter bei
       bkmpSyncPlayerStats weiter unten) beobachtet und gefixt wurde, betraf
       bisher NICHT die Popup-Benachrichtigung hier: renderAchievementBadge()
       lief schon MEHRFACH mit einem noch unvollstaendigen Kontext (Pluschies/
       Idle-Dorf/Raid-Felder noch nicht nachgeladen), BEVOR die echten Werte
       ankamen - jeder dieser fruehen Aufrufe hat den "gesehen"-Stand mit dem
       jeweils niedrigen Zwischenwert ueberschrieben, sodass der naechste
       (korrekte, hoehere) Aufruf die Differenz faelschlich als "gerade neu
       freigeschaltet" wertete und ALLE fehlenden Erfolge als Popup-Welle
       zeigte - bei jedem Login neu, weil sich das Muster jedes Mal wiederholt.
       Fix: die Benachrichtigungs-Pruefung (nicht die reine Zaehler-Anzeige!)
       erst ausfuehren, sobald bkmpInitPlayerAuth() den bekannten Hintergrund-
       Ladevorgaengen (Pluschies/Idle-Dorf/Raid) Zeit zum Fertigwerden gegeben
       hat. */
    let bkmpAchievementNotifyReady = false;
    const BKMP_ACHIEVEMENTS_NOTIFIED_KEY = 'bkmp-achievements-notified';
    function bkmpGetNotifiedAchievements() {
      try { return JSON.parse(localStorage.getItem(BKMP_ACHIEVEMENTS_NOTIFIED_KEY) || 'null'); } catch (e) { return null; }
    }
    function bkmpSaveNotifiedAchievements(list) {
      try { localStorage.setItem(BKMP_ACHIEVEMENTS_NOTIFIED_KEY, JSON.stringify(list)); } catch (e) {}
    }

    /* Zeitpunkt der Freischaltung - wird nur fuer Erfolge gesetzt, die AB
       jetzt neu erkannt werden (siehe bkmpCheckForNewAchievementUnlocks).
       Bereits vor diesem Feature freigeschaltete Erfolge haben bewusst
       keinen Eintrag ("Datum unbekannt" in der Anzeige), da der echte
       Freischalt-Zeitpunkt nicht rueckwirkend rekonstruierbar ist. */
    const BKMP_ACHIEVEMENTS_UNLOCKED_AT_KEY = 'bkmp-achievement-unlocked-at';
    function bkmpGetAchievementUnlockedAtMap() {
      try { return JSON.parse(localStorage.getItem(BKMP_ACHIEVEMENTS_UNLOCKED_AT_KEY) || '{}'); } catch (e) { return {}; }
    }
    function bkmpSetAchievementUnlockedAt(id) {
      const map = bkmpGetAchievementUnlockedAtMap();
      if (map[id]) return;
      map[id] = new Date().toISOString();
      try { localStorage.setItem(BKMP_ACHIEVEMENTS_UNLOCKED_AT_KEY, JSON.stringify(map)); } catch (e) {}
    }
    function bkmpFormatAchievementUnlockedAt(id) {
      const iso = bkmpGetAchievementUnlockedAtMap()[id];
      if (!iso) return null;
      const d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      const datePart = d.toLocaleDateString('de-DE');
      const timePart = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      return `${datePart}, ${timePart} Uhr`;
    }
    /* FEHLER-FIX (Spieler-Report ByAlex0, 13.07.: "Ich habe alle Skilltree-
       Zweige gemaxed, aber die Erfolge wurden wieder zurueckgesetzt") -
       Erfolge wie "alle Skilltree-Zweige maxen" oder "alle 6 Runen gleiche
       Seltenheit ausgeruestet" wurden bisher bei JEDEM Rendern live neu
       gegen a.check(ctx) geprueft - sobald der zugrunde liegende Zustand
       sich wieder aendert (Skilltree-Reset, Rune umgeruestet), fiel der
       Erfolg technisch korrekt, aber fuer den Spieler ueberraschend und
       frustrierend wieder auf "gesperrt" zurueck. Standard-Konvention bei
       Achievement-Systemen: einmal geschafft bleibt geschafft. Nutzt die
       bereits vorhandene, geraeteuebergreifend synchronisierte "Freige-
       schaltet am"-Zeitstempel-Liste (siehe bkmpMergeRemoteStatsIntoLocal)
       als Speicher fuer "wurde je erreicht" - kein neues SQL noetig.
       WICHTIG: bkmpCheckForNewAchievementUnlocks() selbst nutzt weiterhin
       das ROHE a.check(ctx) (siehe dort) - die erkennt bewusst den
       Live-Uebergang false->true, um genau EINMAL den Freischalt-Zeitpunkt
       zu setzen und die Popup-Benachrichtigung auszuloesen; diese Funktion
       hier ist fuer alle ANDEREN Stellen (Anzeige/Zaehler/Kosmetik-/
       Titel-Freischaltung), die den STICKY Status sehen sollen. */
    function bkmpAchievementUnlocked(a, ctx) {
      return Boolean(a.check(ctx)) || Boolean(bkmpGetAchievementUnlockedAtMap()[a.id]);
    }
    /* Konfetti-Burst bei Achievement-Freischaltung - rein optisches
       Zuckerl, an derselben Ecke wie die Popup-Karte (unten links). */
    function bkmpFireAchievementConfetti() {
      const colors = ['#c9a56a', '#a78bfa', '#4ade80', '#f87171', '#60a5fa'];
      const burst = document.createElement('div');
      burst.className = 'bkmp-achievement-confetti';
      burst.innerHTML = Array.from({ length: 18 }, (_, i) => {
        const color = colors[i % colors.length];
        const left = Math.round(Math.random() * 85);
        const duration = (0.85 + Math.random() * 0.55).toFixed(2);
        const delay = (Math.random() * 0.15).toFixed(2);
        const rot = Math.round(Math.random() * 320 - 160);
        return `<span style="left:${left}%; background:${color}; animation-duration:${duration}s; animation-delay:${delay}s; --rot:${rot}deg;"></span>`;
      }).join('');
      document.body.appendChild(burst);
      setTimeout(() => burst.remove(), 1700);
    }
    let bkmpAchievementPopupQueue = [];
    let bkmpAchievementPopupShowing = false;
    function bkmpShowAchievementPopup(achievement) {
      const name = achievement.revealName || achievement.title;
      const desc = achievement.revealDesc || achievement.desc || '';
      const card = document.createElement('div');
      card.className = 'bkmp-achievement-popup';
      card.innerHTML = `
        <div class="bkmp-achievement-popup-title">${escapeHtml(name)}</div>
        <p class="bkmp-achievement-popup-desc">${escapeHtml(desc)}</p>
        <div class="bkmp-achievement-popup-unlock">🏆 Achievement freigeschaltet<strong>„${escapeHtml(name)}“</strong></div>
      `;
      document.body.appendChild(card);
      bkmpFireAchievementConfetti();
      requestAnimationFrame(() => card.classList.add('visible'));
      setTimeout(() => {
        card.classList.remove('visible');
        setTimeout(() => {
          card.remove();
          bkmpAchievementPopupShowing = false;
          bkmpProcessAchievementPopupQueue();
        }, 450);
      }, 4200);
    }
    function bkmpProcessAchievementPopupQueue() {
      if (bkmpAchievementPopupShowing || bkmpAchievementPopupQueue.length === 0) return;
      /* Bug-Fix (Phase 5.5, 19.07.): .bkmp-achievement-popup und die neue
         .bkmp-reward-card (js/ui/bkmp-reward-presenter.js) teilen sich dieselbe
         Ecke (left:1.2rem; bottom:1.2rem) - ohne diesen Check koennten beide
         gleichzeitig direkt uebereinander erscheinen. Gegenstueck siehe
         bkmpRewardProcessQueue. Diese Funktion selbst (Dedupe/Mass-Backfill
         ueber bkmpCheckForNewAchievementUnlocks) bleibt unveraendert. */
      if (typeof bkmpRewardShowing !== 'undefined' && bkmpRewardShowing) {
        setTimeout(bkmpProcessAchievementPopupQueue, 300);
        return;
      }
      bkmpAchievementPopupShowing = true;
      const next = bkmpAchievementPopupQueue.shift();
      setTimeout(() => bkmpShowAchievementPopup(next), 400);
    }
    function bkmpQueueAchievementPopup(achievement) {
      bkmpAchievementPopupQueue.push(achievement);
      bkmpProcessAchievementPopupQueue();
    }
    function bkmpCheckForNewAchievementUnlocks(ctx) {
      const notified = bkmpGetNotifiedAchievements();
      const unlocked = BKMP_ACHIEVEMENTS.filter(a => a.check(ctx));
      if (notified === null) {
        bkmpSaveNotifiedAchievements(unlocked.map(a => a.id));
        return;
      }
      const notifiedSet = new Set(notified);
      const newlyUnlocked = unlocked.filter(a => !notifiedSet.has(a.id));
      if (newlyUnlocked.length === 0) return;
      newlyUnlocked.forEach(a => {
        notifiedSet.add(a.id);
        bkmpSetAchievementUnlockedAt(a.id);
        bkmpQueueAchievementPopup(a);
      });
      bkmpSaveNotifiedAchievements([...notifiedSet]);
    }

    function triggerBkmpJannikNormal() {
      bkmpPlayJannikHopSound();
      const bunny = document.createElement('div');
      bunny.className = 'bkmp-jannik-bunny';
      document.body.appendChild(bunny);
      bkmpShowJannikToast('🐰 Jannik der Hase wurde entdeckt!', 2600);
      setTimeout(() => bunny.remove(), 6000);
    }

    function triggerBkmpJannikRare() {
      bkmpShowJannikToast('🥕 Der Hase hat eine Karotte verloren...', 3200);
      const landXvw = 25 + Math.random() * 45;
      const landYvh = 42 + Math.random() * 18;
      const carrot = document.createElement('div');
      carrot.className = 'bkmp-jannik-carrot';
      carrot.textContent = '🥕';
      carrot.style.left = landXvw + 'vw';
      carrot.style.setProperty('--bkmp-carrot-land', landYvh + 'vh');
      document.body.appendChild(carrot);
      setTimeout(() => {
        bkmpPlayJannikHopSound();
        const bunny = document.createElement('div');
        bunny.className = 'bkmp-jannik-bunny';
        bunny.style.bottom = (100 - landYvh) + 'vh';
        document.body.appendChild(bunny);
        const collectDelay = Math.max(150, ((108 - landXvw) / 122) * 6000);
        setTimeout(() => carrot.remove(), collectDelay);
        setTimeout(() => bunny.remove(), 6000);
      }, 1050);
    }

    function triggerBkmpJannikEasterEgg() {
      if (document.querySelector('.bkmp-jannik-bunny') || document.querySelector('.bkmp-jannik-carrot')) return;
      if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('jannik');
      if (Math.random() < 0.05) {
        triggerBkmpJannikRare();
      } else {
        triggerBkmpJannikNormal();
      }
    }

    const bkmpSecretZone = document.getElementById('bkmpSecretZone');
    const bkmpSecretHint = document.getElementById('bkmpSecretHint');
    if (bkmpSecretZone && bkmpSecretHint) {
      let bkmpJannikHoverCount = 0;
      let bkmpJannikHoverResetTimer = null;
      const BKMP_JANNIK_HOVERS_NEEDED = 4;
      function bkmpRevealJannikHint() {
        bkmpSecretHint.classList.add('visible');
      }
      bkmpSecretZone.addEventListener('pointerenter', e => {
        if (e.pointerType !== 'mouse' || bkmpSecretHint.classList.contains('visible')) return;
        bkmpJannikHoverCount++;
        clearTimeout(bkmpJannikHoverResetTimer);
        bkmpJannikHoverResetTimer = setTimeout(() => { bkmpJannikHoverCount = 0; }, 3000);
        if (bkmpJannikHoverCount >= BKMP_JANNIK_HOVERS_NEEDED) bkmpRevealJannikHint();
      });
      let bkmpJannikPressTimer = null;
      function bkmpCancelJannikPress() { clearTimeout(bkmpJannikPressTimer); bkmpJannikPressTimer = null; }
      bkmpSecretZone.addEventListener('touchstart', () => {
        if (bkmpSecretHint.classList.contains('visible')) return;
        bkmpCancelJannikPress();
        bkmpJannikPressTimer = setTimeout(bkmpRevealJannikHint, 5000);
      }, { passive: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach(evt => {
        bkmpSecretZone.addEventListener(evt, bkmpCancelJannikPress, { passive: true });
      });
      bkmpSecretHint.addEventListener('click', triggerBkmpJannikEasterEgg);
    }

    /* Anklickbares Schaf-Easter-Egg: zeigt eine Sprechblase mit einem Text,
       den der Admin im Admin-Panel (Uebersicht > Schaf-Sprechblase) jederzeit
       aendern kann (site_flags.sheep_speech_text, siehe supabase.js
       loadSiteFlags/setSheepSpeechText). Text wird erst beim ersten Klick
       nachgeladen (kein Grund, ihn beim Seitenaufruf ungefragt zu holen). */
    const bkmpSheepEgg = document.getElementById('bkmpSheepEgg');
    const bkmpSheepBubble = document.getElementById('bkmpSheepBubble');
    const bkmpSheepBubbleText = document.getElementById('bkmpSheepBubbleText');
    if (bkmpSheepEgg && bkmpSheepBubble && bkmpSheepBubbleText) {
      let bkmpSheepSpeechCache = null;
      let bkmpSheepBubbleHideTimer = null;
      async function bkmpGetSheepSpeechText() {
        if (bkmpSheepSpeechCache) return bkmpSheepSpeechCache;
        try {
          const text = typeof loadSheepSpeechText === 'function' ? await loadSheepSpeechText() : null;
          bkmpSheepSpeechCache = text || 'Määäh! 🐑';
        } catch (e) {
          bkmpSheepSpeechCache = 'Määäh! 🐑';
        }
        return bkmpSheepSpeechCache;
      }
      function bkmpHideSheepBubble() {
        bkmpSheepBubble.classList.remove('visible');
        bkmpSheepBubble.setAttribute('aria-hidden', 'true');
        clearTimeout(bkmpSheepBubbleHideTimer);
      }
      /* Easter Egg "Schaf-Zitate-Fluesterer": beim ALLERERSTEN Klick (egal
         wann) gibt es einmalig das Easter Egg + die SheepMasterLP-Pluschie -
         siehe supabase-sheep-plushie-easter-egg.sql fuer den (nie im UI
         gezeigten) Einloese-Code, gleiches Muster wie BKMP_ADFREE_CODE. */
      const BKMP_SHEEP_EGG_CODE = 'SHEEP-QUOTE-WHISPERER-EGG';
      async function bkmpSheepGrantEggReward() {
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('sheep');
        const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
        if (name && typeof redeemPlushieCode === 'function') {
          try { await redeemPlushieCode(BKMP_SHEEP_EGG_CODE, name); } catch (e) {}
          if (typeof bkmpRefreshOwnedPlushies === 'function') bkmpRefreshOwnedPlushies();
        }
        if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
      }
      async function bkmpToggleSheepBubble() {
        if (bkmpSheepBubble.classList.contains('visible')) { bkmpHideSheepBubble(); return; }
        const isFirstClick = typeof bkmpGetEggsFound === 'function' && !bkmpGetEggsFound().includes('sheep');
        if (isFirstClick) bkmpSheepGrantEggReward();
        if (typeof bkmpTrackSheepQuoteClick === 'function') bkmpTrackSheepQuoteClick();
        bkmpSheepBubbleText.textContent = await bkmpGetSheepSpeechText();
        bkmpSheepBubble.classList.add('visible');
        bkmpSheepBubble.setAttribute('aria-hidden', 'false');
        clearTimeout(bkmpSheepBubbleHideTimer);
        bkmpSheepBubbleHideTimer = setTimeout(bkmpHideSheepBubble, 5000);
      }
      bkmpSheepEgg.addEventListener('click', bkmpToggleSheepBubble);
      bkmpSheepEgg.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bkmpToggleSheepBubble(); }
      });
      document.addEventListener('click', e => {
        if (bkmpSheepBubble.classList.contains('visible') && !bkmpSheepEgg.contains(e.target) && !bkmpSheepBubble.contains(e.target)) {
          bkmpHideSheepBubble();
        }
      });
    }

    /* Anklickbares Pinguin-Easter-Egg: nur im Hellmodus sichtbar (siehe
       .bkmp-penguin-easter-egg CSS), einmaliger Fund-Reward beim ersten
       Klick, gleiches Grund-Muster wie beim Schaf oben (bkmpMarkEggFound +
       renderAchievementBadge-Refresh), aber ohne eigene Sprechblase - hier
       reicht ein kurzer Toast. */
    const bkmpPenguinEgg = document.getElementById('bkmpPenguinEgg');
    if (bkmpPenguinEgg) {
      async function bkmpTogglePenguinEgg() {
        const isFirstClick = typeof bkmpGetEggsFound === 'function' && !bkmpGetEggsFound().includes('penguin');
        if (!isFirstClick) return;
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('penguin');
        if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🐧 Ein hungriger kleiner Pinguin freut sich über Gesellschaft!', 3200);
      }
      bkmpPenguinEgg.addEventListener('click', bkmpTogglePenguinEgg);
      bkmpPenguinEgg.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bkmpTogglePenguinEgg(); }
      });
    }

    /* Easter Egg: 3 Minuten inaktiv - schläfriger Titel + Zzz-Blase */
    let bkmpIdleTimer = null;
    const bkmpOriginalTitle = document.title;
    let bkmpIsIdle = false;
    let bkmpLastMouseX = null;
    let bkmpLastMouseY = null;
    function bkmpResetIdleTimer() {
      if (bkmpIsIdle) {
        document.title = bkmpOriginalTitle;
        bkmpIsIdle = false;
        const bubble = document.getElementById('bkmpZzzBubble');
        if (bubble) bubble.remove();
      }
      clearTimeout(bkmpIdleTimer);
      bkmpIdleTimer = setTimeout(triggerBkmpIdleEasterEgg, 3 * 60 * 1000);
    }
    function triggerBkmpIdleEasterEgg() {
      bkmpIsIdle = true;
      document.title = '😴 Bist du noch da...?';
      if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('idle');
      const bubble = document.createElement('div');
      bubble.id = 'bkmpZzzBubble';
      bubble.className = 'bkmp-zzz-bubble';
      bubble.textContent = '💤';
      bubble.style.left = (bkmpLastMouseX !== null ? bkmpLastMouseX : window.innerWidth / 2) + 'px';
      bubble.style.top = (bkmpLastMouseY !== null ? bkmpLastMouseY : window.innerHeight / 2) + 'px';
      document.body.appendChild(bubble);
    }
    document.addEventListener('mousemove', e => { bkmpLastMouseX = e.clientX; bkmpLastMouseY = e.clientY; bkmpResetIdleTimer(); });
    ['keydown', 'click', 'scroll', 'touchstart'].forEach(evt => document.addEventListener(evt, bkmpResetIdleTimer, { passive: true }));
    bkmpResetIdleTimer();

    /* Easter Egg: 10 versteckte "DerLiber"-Strichmaennchen auf der ganzen Seite */
    const BKMP_DERLIBER_SPOTS = ['panel-main', 'panel-investors', 'panel-news', 'panel-wishes', 'panel-about', 'panel-partners', 'panel-cardsales', 'panel-cardcatalog', 'panel-leaderboard'];
    function bkmpGetDerLiberFound() {
      try { return JSON.parse(localStorage.getItem('bkmp-derliber-found') || '[]'); } catch (e) { return []; }
    }
    function bkmpMarkDerLiberFound(spotId) {
      const found = bkmpGetDerLiberFound();
      if (found.includes(spotId)) return;
      found.push(spotId);
      try { localStorage.setItem('bkmp-derliber-found', JSON.stringify(found)); } catch (e) {}
      if (found.length >= BKMP_DERLIBER_SPOTS.length + 1 && typeof bkmpMarkEggFound === 'function') {
        bkmpMarkEggFound('derliber');
      }
      if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
    }
    function bkmpMakeDerLiberFigure(spotId) {
      const fig = document.createElement('button');
      fig.type = 'button';
      fig.className = 'bkmp-derliber';
      fig.setAttribute('aria-label', 'Hmm?');
      fig.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2.3"></circle>
          <path d="M12 7.6v7.4"></path>
          <path d="M12 9.8 7 7.2"></path>
          <path d="M12 10.4l5.5 1.6"></path>
          <path d="M12 15l-4 6"></path>
          <path d="M12 15l4.2 6"></path>
        </svg>`;
      fig.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        fig.classList.add('found');
        bkmpMarkDerLiberFound(spotId);
        setTimeout(() => fig.remove(), 400);
      });
      return fig;
    }
    function bkmpSpawnDerLiberFigures() {
      /* bkmp-derliber-found ist NUR lokal (pro Geraet, nie synchronisiert) -
         merkt sich waehrend der laufenden Jagd, welche der 10 Figuren auf
         DIESEM Geraet schon angeklickt wurden. eggsFound (Teil von
         player_stats, geraeteuebergreifend gemerged) ist die eigentliche
         Abschluss-Markierung. Ohne diesen Check wuerden auf einem Geraet,
         auf dem die Jagd nie einzeln durchgespielt wurde (z.B. Erfolg kam
         vom PC), die Figuren dort immer wieder neu auftauchen, obwohl das
         Easter Egg laut Erfolgen laengst komplett ist. Entfernt zusaetzlich
         bereits gespawnte Figuren wieder, falls eggsFound erst NACH dem
         initialen Aufruf (z.B. durch den Cross-Device-Merge beim Login)
         "derliber" bekommen hat. */
      if (bkmpGetEggsFound().includes('derliber')) {
        document.querySelectorAll('.bkmp-derliber').forEach(el => el.remove());
        return;
      }
      const found = bkmpGetDerLiberFound();
      BKMP_DERLIBER_SPOTS.forEach(panelId => {
        if (found.includes(panelId)) return;
        const container = document.getElementById(panelId);
        if (!container || container.querySelector('.bkmp-derliber')) return;
        const fig = bkmpMakeDerLiberFigure(panelId);
        fig.style.left = (4 + Math.random() * 88) + '%';
        fig.style.top = (6 + Math.random() * 80) + '%';
        container.appendChild(fig);
      });
      if (!found.includes('header') && !document.getElementById('bkmpDerLiberHeader')) {
        const fig = bkmpMakeDerLiberFigure('header');
        fig.id = 'bkmpDerLiberHeader';
        fig.classList.add('bkmp-derliber-fixed');
        document.body.appendChild(fig);
      }
    }
    bkmpSpawnDerLiberFigures();
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => setTimeout(bkmpSpawnDerLiberFigures, 200)));

    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      easterBuffer = (easterBuffer + key).slice(-easterTarget.length);
      dracheBuffer = (dracheBuffer + key).slice(-dracheTarget.length);
      philBuffer = (philBuffer + key).slice(-philTarget.length);
      creeperBuffer = (creeperBuffer + key).slice(-creeperTarget.length);
      matrixBuffer = (matrixBuffer + key).slice(-matrixTarget.length);
      zerathorBuffer = (zerathorBuffer + key).slice(-zerathorTarget.length);
      konamiBuffer.push(key);
      konamiBuffer = konamiBuffer.slice(-konamiCode.length);
      if (easterBuffer === easterTarget) {
        triggerBkmpEasterEgg();
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('bkmp');
        easterBuffer = '';
      }
      if (dracheBuffer === dracheTarget) {
        triggerBkmpFireEasterEgg();
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('drache');
        dracheBuffer = '';
      }
      if (philBuffer === philTarget) {
        triggerBkmpPhilEasterEgg();
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('phil');
        philBuffer = '';
      }
      if (creeperBuffer === creeperTarget) {
        triggerBkmpCreeperEasterEgg();
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('creeper');
        creeperBuffer = '';
      }
      if (matrixBuffer === matrixTarget) {
        triggerBkmpMatrixRain();
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('matrix');
        matrixBuffer = '';
      }
      if (zerathorBuffer === zerathorTarget) {
        triggerBkmpZerathorEasterEgg();
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('zerathor');
        zerathorBuffer = '';
      }
      if (konamiBuffer.join('|') === konamiCode.join('|')) {
        triggerBkmpLootRain();
        if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('konami');
        konamiBuffer = [];
      }
    });

    /* Easter Egg: Maus ganz wild hin und her wackeln (klassische "wo ist
       mein Mauszeiger"-Geste) - erkannt ueber schnelle Richtungswechsel der
       X-Bewegung in einem kurzen Zeitfenster, statt Tippen oder Klicks. */
    let bkmpMouseShakeLastX = null;
    let bkmpMouseShakeLastDir = 0;
    let bkmpMouseShakeReversals = [];
    function triggerBkmpMouseShakeEgg(x, y) {
      if (document.getElementById('bkmpMouseShakeBurst')) return;
      const burst = document.createElement('div');
      burst.id = 'bkmpMouseShakeBurst';
      burst.className = 'bkmp-mouseshake-burst';
      burst.style.left = x + 'px';
      burst.style.top = y + 'px';
      const sparkles = Array.from({ length: 14 }, (_, i) => `<span style="--i:${i}"></span>`).join('');
      burst.innerHTML = sparkles;
      document.body.appendChild(burst);
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Da war doch eben die Maus? 🐭✨', 2600);
      setTimeout(() => burst.remove(), 900);
      if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('mouseshake');
    }
    document.addEventListener('mousemove', e => {
      if (bkmpMouseShakeLastX !== null) {
        const dx = e.clientX - bkmpMouseShakeLastX;
        if (Math.abs(dx) > 12) {
          const dir = dx > 0 ? 1 : -1;
          if (bkmpMouseShakeLastDir !== 0 && dir !== bkmpMouseShakeLastDir) {
            const now = performance.now();
            bkmpMouseShakeReversals.push(now);
            bkmpMouseShakeReversals = bkmpMouseShakeReversals.filter(t => now - t < 1100);
            if (bkmpMouseShakeReversals.length >= 6) {
              triggerBkmpMouseShakeEgg(e.clientX, e.clientY);
              bkmpMouseShakeReversals = [];
            }
          }
          bkmpMouseShakeLastDir = dir;
        }
      }
      bkmpMouseShakeLastX = e.clientX;
    });

    /* Easter Egg: 3x hintereinander (innerhalb 2s) rechtsklicken - das
       normale Browser-Kontextmenue bleibt dabei unangetastet, es wird
       nur beim 3. Rechtsklick zusaetzlich eine eigene Karte eingeblendet. */
    let bkmpRightClickTimestamps = [];
    function triggerBkmpRightClickEgg() {
      if (document.getElementById('bkmpRightClickEasterEgg')) return;
      const overlay = document.createElement('div');
      overlay.id = 'bkmpRightClickEasterEgg';
      overlay.className = 'bkmp-easter';
      overlay.innerHTML = `
        <div class="bkmp-easter-card">
          <small>BKMP Secret</small>
          <strong>Neugierig, was? 🖱️</strong>
          <p>Hier gibt's nichts zu klauen - nur ein kleines Dankeschön fürs genaue Hinschauen.</p>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));
      setTimeout(() => {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 450);
      }, 3200);
      if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('rightclick');
    }
    document.addEventListener('contextmenu', () => {
      const now = performance.now();
      bkmpRightClickTimestamps.push(now);
      bkmpRightClickTimestamps = bkmpRightClickTimestamps.filter(t => now - t < 2000);
      if (bkmpRightClickTimestamps.length >= 3) {
        triggerBkmpRightClickEgg();
        bkmpRightClickTimestamps = [];
      }
    });

    /* ---------------- Daten laden & rendern ---------------- */
    const data = bkmpLoadData();
    bkmpDataReady = true;
    function refreshDeferredPanels() {
      return Promise.all([
        syncUpdatesFromSupabase(data, null, { force: true }),
        syncWishesFromSupabase(data, null, { force: true }),
        syncStreamersFromSupabase(data, null, { force: true }),
        syncAboutBlocksFromSupabase(data, null, { force: true }),
        syncPartnerShopsFromSupabase(data, null, { force: true }),
        syncCardSalesFromSupabase(data, null, { force: true }),
        syncCardCatalogFromSupabase(data, null, { force: true })
      ]).then(results => {
        const changed = results.some(Boolean);
        renderStreamers();
        if (typeof renderNews === 'function') renderNews();
        if (typeof renderWishes === 'function') renderWishes();
        if (typeof renderAboutBlocks === 'function') renderAboutBlocks();
        if (typeof renderPartnerShops === 'function') renderPartnerShops();
        if (typeof renderCardSales === 'function') renderCardSales();
        if (typeof renderCardCatalog === 'function') renderCardCatalog();
        if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
        if (typeof renderLeaderboard === 'function') renderLeaderboard();
        return changed;
      });
    }

    function scheduleDeferredSync() {
      const run = () => refreshDeferredPanels().then(changed => {
        if (changed) sessionStorage.setItem('bkmp-main-synced', '1');
      });
      if ('requestIdleCallback' in window) {
        requestIdleCallback(run, { timeout: 1800 });
      } else {
        setTimeout(run, 450);
      }
    }

    function refreshVisibleData() {
      if (document.hidden) return;
      Promise.all([
        syncIncomesFromSupabase(data, null),
        syncInvestorsFromSupabase(data, null),
        syncExpensesFromSupabase(data, null)
      ]).then(results => {
        if (results.some(Boolean) && typeof renderFinancialSections === 'function') renderFinancialSections();
      });
      refreshDeferredPanels();
    }

    /* Egress-Fix: frueher loeste JEDE Aenderung an IRGENDEINER der 10
       live-ueberwachten Tabellen ein volles Neuladen ALLER 10 Tabellen aus
       (refreshVisibleData -> refreshDeferredPanels). Bei z. B. einer neuen
       Wunschkarte wurden dadurch auch Einnahmen/Investoren/Ausgaben/News/
       Twitch-Links/PartnerShops/Kartenverkaeufe/Kartenkatalog komplett neu
       geladen, obwohl sich nur "wishes" geaendert hatte. Jetzt wird pro
       Realtime-Ereignis nur die tatsaechlich betroffene Tabelle neu
       geladen; mehrere Aenderungen innerhalb des 350ms-Fensters werden
       zu einem einzigen Batch-Refresh der betroffenen Tabellen gebuendelt. */
    const BKMP_LIVE_TABLE_HANDLERS = {
      incomes: () => syncIncomesFromSupabase(data, null).then(c => { if (c && typeof renderFinancialSections === 'function') renderFinancialSections(); }),
      expenses: () => syncExpensesFromSupabase(data, null).then(c => { if (c && typeof renderFinancialSections === 'function') renderFinancialSections(); }),
      investors: () => syncInvestorsFromSupabase(data, null).then(c => { if (c && typeof renderFinancialSections === 'function') renderFinancialSections(); }),
      updates: () => syncUpdatesFromSupabase(data, null).then(() => { if (typeof renderNews === 'function') renderNews(); }),
      wishes: () => syncWishesFromSupabase(data, null).then(() => { if (typeof renderWishes === 'function') renderWishes(); }),
      streamer_links: () => syncStreamersFromSupabase(data, null).then(() => renderStreamers()),
      about_blocks: () => syncAboutBlocksFromSupabase(data, null).then(() => { if (typeof renderAboutBlocks === 'function') renderAboutBlocks(); }),
      partner_shops: () => syncPartnerShopsFromSupabase(data, null).then(() => { if (typeof renderPartnerShops === 'function') renderPartnerShops(); }),
      card_sales: () => syncCardSalesFromSupabase(data, null).then(() => { if (typeof renderCardSales === 'function') renderCardSales(); }),
      card_catalog: () => syncCardCatalogFromSupabase(data, null).then(() => { if (typeof renderCardCatalog === 'function') renderCardCatalog(); })
    };

    let liveRefreshTimer = null;
    const bkmpPendingLiveTables = new Set();
    function scheduleLiveDataRefresh(table) {
      bkmpPendingLiveTables.add(table);
      window.clearTimeout(liveRefreshTimer);
      liveRefreshTimer = window.setTimeout(() => {
        const tables = [...bkmpPendingLiveTables];
        bkmpPendingLiveTables.clear();
        Promise.all(tables.map(t => (BKMP_LIVE_TABLE_HANDLERS[t] || (() => Promise.resolve()))())).then(() => {
          if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
          if (typeof renderLeaderboard === 'function') renderLeaderboard();
        });
      }, 350);
    }

    function initSupabaseRealtime() {
      const client = typeof bkmpGetSupabaseClient === 'function' ? bkmpGetSupabaseClient() : null;
      if (!client || typeof client.channel !== 'function' || window.__bkmpRealtimeChannel) return;
      const channel = client.channel('bkmp-live-dashboard');
      Object.keys(BKMP_LIVE_TABLE_HANDLERS).forEach(table => {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleLiveDataRefresh(table));
      });
      channel.subscribe();
      window.__bkmpRealtimeChannel = channel;
    }

    Promise.all([
      syncIncomesFromSupabase(data, null),
      syncInvestorsFromSupabase(data, null),
      syncExpensesFromSupabase(data, null),
      syncStreamersFromSupabase(data, null, { force: true })
    ]).then(results => {
      const changed = results.some(Boolean);
      if (changed) {
        sessionStorage.setItem('bkmp-main-synced', '1');
        if (typeof renderFinancialSections === 'function') renderFinancialSections();
      }
      renderStreamers();
      if (typeof renderNews === 'function') renderNews();
      if (typeof renderWishes === 'function') renderWishes();
      if (typeof renderAboutBlocks === 'function') renderAboutBlocks();
      if (typeof renderPartnerShops === 'function') renderPartnerShops();
      if (typeof renderCardSales === 'function') renderCardSales();
      if (typeof renderCardCatalog === 'function') renderCardCatalog();
      if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
      if (typeof renderLeaderboard === 'function') renderLeaderboard();
      scheduleDeferredSync();
      initSupabaseRealtime();
      if (typeof refreshLeaderboardData === 'function') refreshLeaderboardData();
    });

    // Realtime-Channel deckt sofortige Updates ab (jetzt table-spezifisch,
    // siehe scheduleLiveDataRefresh) - das hier ist wirklich nur noch ein
    // seltener Fallback, falls der Realtime-Channel z. B. nach Schlaf-
    // modus/Netzwerkwechsel still haengen bleibt. 90s war fuer einen reinen
    // Fallback deutlich zu aggressiv (voller Reload ALLER 10 Tabellen bei
    // jedem einzelnen Intervall-Tick, auch ohne jede Aenderung).
    window.setInterval(refreshVisibleData, 600000); // alle 10 Minuten

    // window focus UND document visibilitychange feuern beim Zurueckwechseln
    // in den Tab praktisch immer gemeinsam - vorher loeste das zwei volle
    // 10-Tabellen-Reloads pro Tab-Wechsel aus. Jetzt ein gemeinsamer Handler
    // mit Cooldown, damit haeufiges Hin-und-Herwechseln (Alt-Tab) nicht bei
    // jedem einzelnen Wechsel neu laedt.
    let bkmpLastVisibleRefreshAt = 0;
    function bkmpRefreshVisibleDataThrottled() {
      if (document.hidden) return;
      const now = Date.now();
      if (now - bkmpLastVisibleRefreshAt < 120000) return; // max. alle 2 Min.
      bkmpLastVisibleRefreshAt = now;
      refreshVisibleData();
    }
    window.addEventListener('focus', bkmpRefreshVisibleDataThrottled);
    document.addEventListener('visibilitychange', bkmpRefreshVisibleDataThrottled);

    function renderFinancialSections() {
    const totalIncome = bkmpSum(data.income);
    const totalExpenses = bkmpSum(data.expenses);
    const netProfit = totalIncome - totalExpenses;

    document.getElementById('statIncome').textContent = bkmpFormatCurrency(totalIncome);
    document.getElementById('statExpenses').textContent = bkmpFormatCurrency(totalExpenses);
    const statNet = document.getElementById('statNet');
    statNet.textContent = bkmpFormatCurrency(netProfit);
    statNet.classList.remove('neutral');
    statNet.classList.add(netProfit >= 0 ? 'positive' : 'negative');

    /* Donut-Chart: Anteil jeder Einnahmequelle an den Gesamteinnahmen */
    const chartArea = document.getElementById('chartArea');
    const palette = ['#9333EA', '#C9A56A', '#4ADE80', '#38BDF8', '#F472B6', '#F87171', '#FBBF24'];

    if (data.income.length === 0 || totalIncome === 0) {
      chartArea.innerHTML = '<p class="empty-hint">Noch keine Einnahmen erfasst. Trage sie im Admin-Panel ein, sobald du eingeloggt bist.</p>';
    } else {
      // Gleiche Kategorien zusammenrechnen, aber die Buchungs-Reihenfolge behalten.
      const grouped = {};
      const groupedIncome = [];
      data.income.forEach(item => {
        if (!grouped[item.name]) {
          grouped[item.name] = { name: item.name, amount: 0 };
          groupedIncome.push(grouped[item.name]);
        }
        grouped[item.name].amount += Number(item.amount || 0);
      });
      /* Nutzerwunsch (Feedback von DerJannikHase): hoechste Prozentsaetze
         zuerst, statt in reiner Buchungs-Reihenfolge - macht Legende UND
         Donut-Farbverteilung auf einen Blick lesbarer. */
      groupedIncome.sort((a, b) => b.amount - a.amount);

      let gradientParts = [];
      let cursor = 0;
      let legendHtml = '';

      groupedIncome.forEach((item, i) => {
        const pct = (item.amount / totalIncome) * 100;
        const color = palette[i % palette.length];
        gradientParts.push(`${color} ${cursor}% ${cursor + pct}%`);
        cursor += pct;
        const amountLabel = bkmpFormatCurrency(item.amount);
        const percentLabel = pct.toFixed(1) + '%';
        const tooltip = escapeHtml(`${item.name}: ${amountLabel} = ${percentLabel}`);
        legendHtml += `
          <div class="legend-item" data-tooltip="${tooltip}" tabindex="0" aria-label="${tooltip}">
            <span class="legend-dot" style="background:${color}"></span>
            <span>${escapeHtml(item.name)}</span>
            <span class="amt">${percentLabel}</span>
          </div>`;
      });

      function getIsoWeek(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      }

      function addDays(date, days) {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
      }

      function toIsoDate(date) {
        return date.toISOString().slice(0, 10);
      }

      function shortDateLabel(isoDate) {
        return new Date(isoDate + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      }

      function buildRevenueSeries(mode) {
        const groups = {};
        data.income.forEach(item => {
          if (!item.date) return;
          const d = new Date(item.date + 'T00:00:00');
          let key = item.date;
          let name = formatDate(item.date);
          let shortDate = shortDateLabel(item.date);

          if (mode === 'weekly') {
            const monday = addDays(d, -((d.getDay() + 6) % 7));
            const sunday = addDays(monday, 6);
            key = toIsoDate(monday);
            name = `KW ${getIsoWeek(monday)} · ${shortDateLabel(toIsoDate(monday))} - ${shortDateLabel(toIsoDate(sunday))}`;
            shortDate = `KW ${getIsoWeek(monday)}`;
          }

          if (mode === 'monthly') {
            key = item.date.slice(0, 7);
            name = new Date(item.date.slice(0, 7) + '-01T00:00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            shortDate = new Date(item.date.slice(0, 7) + '-01T00:00:00').toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
          }

          if (!groups[key]) groups[key] = { key, name, shortDate, amount: 0 };
          groups[key].amount += Number(item.amount || 0);
        });
        const sorted = Object.values(groups).sort((a, b) => a.key.localeCompare(b.key));
        return mode === 'daily' ? sorted.slice(-14) : sorted;
      }

      function renderRevenueLineChart(mode) {
        const chartPoints = buildRevenueSeries(mode);
        const modeLabel = mode === 'weekly' ? 'Woche' : mode === 'monthly' ? 'Monat' : 'Tag';
        const compareLabel = mode === 'weekly' ? 'zur Vorwoche' : mode === 'monthly' ? 'zum Vormonat' : 'zum Vortag';
        const maxAmount = Math.max(...chartPoints.map(item => item.amount), 1);
        const linePoints = chartPoints.length === 1
          ? [{ ...chartPoints[0], x: 50, y: 50 }]
          : chartPoints.map((item, i) => ({
              ...item,
              x: 10 + (i / (chartPoints.length - 1)) * 80,
              y: 82 - (item.amount / maxAmount) * 66
            }));
        const areaPath = linePoints.length
          ? `M ${linePoints[0].x.toFixed(2)} 86 L ${linePoints.map(point => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')} L ${linePoints[linePoints.length - 1].x.toFixed(2)} 86 Z`
          : '';
        const linePath = linePoints.length
          ? `M ${linePoints.map(point => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')}`
          : '';
        const labelStep = Math.max(1, Math.ceil(linePoints.length / 7));
        const pointHtml = linePoints.map((point, i) => {
          const previous = i > 0 ? linePoints[i - 1].amount : null;
          const diff = previous === null ? 0 : point.amount - previous;
          const diffLabel = previous === null
            ? `erster ${modeLabel}`
            : `${diff >= 0 ? '+' : '-'}${bkmpFormatCurrency(Math.abs(diff))} ${compareLabel}`;
          return `
            <button class="line-point" style="left:${point.x}%; top:${point.y}%;" type="button" aria-label="${point.name}: ${bkmpFormatCurrency(point.amount)}, ${diffLabel}">
              <span>${point.name}: ${bkmpFormatCurrency(point.amount)}<small>${diffLabel}</small></span>
            </button>`;
        }).join('');
        const labelHtml = linePoints.map((point, i) => {
          const show = i === 0 || i === linePoints.length - 1 || i % labelStep === 0;
          return show ? `<span class="line-date-label" style="left:${point.x}%">${point.shortDate}</span>` : '';
        }).join('');
        const active = value => value === mode ? 'active' : '';

        return `
          <div class="line-card" id="revenueLineCard">
            <div class="line-head">
              <div>
                <h3>Umsatz pro ${modeLabel}</h3>
                <p>Vergleich ${compareLabel}</p>
              </div>
              <div class="line-head-right">
                <span>Gesamt ${bkmpFormatCurrency(totalIncome)}</span>
                <div class="line-mode-tabs" aria-label="Zeitraum auswählen">
                  <button class="${active('daily')}" type="button" data-chart-mode="daily">Täglich</button>
                  <button class="${active('weekly')}" type="button" data-chart-mode="weekly">Wöchentlich</button>
                  <button class="${active('monthly')}" type="button" data-chart-mode="monthly">Monatlich</button>
                </div>
              </div>
            </div>
            <div class="mini-line-chart" aria-label="Umsatz-Verlauf">
              <div class="line-axis max">${bkmpFormatCurrency(maxAmount)}</div>
              <div class="line-axis zero">0 €</div>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path class="line-area" d="${areaPath}"></path>
                <path class="line-stroke" d="${linePath}"></path>
              </svg>
              ${pointHtml}
              <div class="line-date-row">${labelHtml}</div>
            </div>
          </div>`;
      }

      function bindRevenueModeButtons() {
        chartArea.querySelectorAll('[data-chart-mode]').forEach(btn => {
          btn.addEventListener('click', () => {
            const lineCard = document.getElementById('revenueLineCard');
            if (!lineCard) return;
            lineCard.outerHTML = renderRevenueLineChart(btn.dataset.chartMode);
            bindRevenueModeButtons();
          });
        });
      }

      chartArea.innerHTML = `
        <div class="chart-block">
          <div class="chart-summary">
            <div class="donut" style="background: conic-gradient(${gradientParts.join(',')})">
              <div class="donut-center">
                <span>Gesamt</span>
                <strong>${bkmpFormatCurrency(totalIncome)}</strong>
              </div>
            </div>
            <div class="legend">${legendHtml}</div>
          </div>
          ${renderRevenueLineChart('daily')}
        </div>`;
      bindRevenueModeButtons();
    }

    /* Investoren */
    const investorGrid = document.getElementById('investorGrid');
    function isInInvestorPeriod(item, inv) {
      if (!item.date) return false;
      if (inv.startDate && item.date < inv.startDate) return false;
      if (inv.endDate && item.date > inv.endDate) return false;
      return true;
    }
    function sumForInvestorPeriod(list, inv) {
      return bkmpSum(list.filter(item => isInInvestorPeriod(item, inv)));
    }
    function formatInvestorPeriod(inv) {
      if (inv.startDate && inv.endDate) return `${formatDate(inv.startDate)} - ${formatDate(inv.endDate)}`;
      if (inv.startDate) return `seit ${formatDate(inv.startDate)}`;
      if (inv.endDate) return `bis ${formatDate(inv.endDate)}`;
      return 'Gesamter Zeitraum';
    }

    if (data.investors.length === 0) {
      investorGrid.innerHTML = '<p class="empty-hint">Noch keine Investoren eingetragen.</p>';
    } else {
      investorGrid.innerHTML = data.investors.map(inv => {
        const periodIncome = sumForInvestorPeriod(data.income, inv);
        const periodExpenses = sumForInvestorPeriod(data.expenses, inv);
        const periodNet = periodIncome - periodExpenses;
        const payout = periodNet > 0 ? (periodNet * Number(inv.sharePercent || 0)) / 100 : 0;
        const isAnonymous = Boolean(inv.anonymous);
        const mcName = isAnonymous ? '' : (inv.minecraftName || '').trim();
        const avatar = mcName ? `https://minotar.net/helm/${encodeURIComponent(mcName)}/96.png` : '';
        const invName = isAnonymous ? 'Anonym' : (inv.name || '');
        return `
          <div class="investor-card investor-card-rich">
            <div class="investor-head">
              ${avatar ? `<img class="investor-avatar" src="${avatar}" alt="Minecraft-Kopf von ${escapeHtml(mcName)}" loading="lazy" decoding="async">` : `<div class="investor-avatar investor-avatar-fallback">${isAnonymous ? '?' : escapeHtml(invName.slice(0, 1).toUpperCase())}</div>`}
              <div class="investor-title-block">
                <div class="investor-name">${escapeHtml(invName)}</div>
                ${mcName ? `<div class="investor-mc">${escapeHtml(mcName)}</div>` : ''}
              </div>
            </div>
            <div class="investor-period">${formatInvestorPeriod(inv)}</div>
            <div class="investor-highlight">
              <span>Aktueller Anteil</span>
              <strong>${bkmpFormatCurrency(payout)}</strong>
            </div>
            <div class="investor-metrics">
              <div><span>Investiert</span><strong>${bkmpFormatCurrency(inv.invested)}</strong></div>
              <div><span>Beteiligung</span><strong>${Number(inv.sharePercent || 0)}%</strong></div>
              <div><span>Zeitraum-Gewinn</span><strong class="${periodNet >= 0 ? 'pos' : 'neg'}">${bkmpFormatCurrency(periodNet)}</strong></div>
            </div>
          </div>`;
      }).join('');
    }

    /* Alle Einträge (Ledger-Liste) — begrenzt auf die letzten 15 */
    const ledgerList = document.getElementById('ledgerList');
    const ledgerEntries = [
      ...data.income.map((item, index) => ({ ...item, type: 'in', order: item.createdAt || index })),
      ...data.expenses.map((item, index) => ({ ...item, type: 'out', order: item.createdAt || index }))
    ]
      .sort((a, b) => {
        const dateCompare = (b.date || '').localeCompare(a.date || '');
        if (dateCompare !== 0) return dateCompare;
        return (b.order || 0) - (a.order || 0);
      })
      .slice(0, 15);

    if (ledgerEntries.length === 0) {
      ledgerList.innerHTML = '<p class="empty-hint">Noch keine Einträge vorhanden.</p>';
    } else {
      ledgerList.innerHTML = ledgerEntries.map(item => `
        <div class="ledger-row">
          <div class="l-left">
            <span class="ledger-tag ${item.type}">${item.type === 'in' ? 'Einnahmen' : 'Ausgaben'}</span>
            <span>${escapeHtml(item.name)}</span>
            <span class="ledger-date">${item.date ? escapeHtml(formatDate(item.date)) : ''}</span>
          </div>
          <span class="amount ${item.type}">${item.type === 'in' ? '+' : '−'} ${bkmpFormatCurrency(item.amount)}</span>
        </div>
      `).join('');
    }
    }
    renderFinancialSections();

    /* Easter Egg: Donut-Chart oft klicken -> dreht sich immer schneller, Farben
       mischen sich zu Regenbogen, am Ende Feuerwerk + Erfolg.
       FEHLER-FIX (Perf-Audit 15.07.): diese Verkabelung lag vorher INNERHALB
       von renderFinancialSections() - #chartArea selbst wird bei jedem
       Re-Render nur mit neuem innerHTML befuellt, nie neu erstellt, also
       sammelten sich bei jedem Live-Update (Realtime-Aenderung an
       incomes/expenses/investors, siehe oben, oder der 10-Minuten-Poll)
       weitere mousedown/click-Listener auf demselben Knoten an - ein Klick
       loeste dadurch mehrere unabhaengige Zaehler gleichzeitig aus (Donut
       drehte sich zu weit, Feuerwerk/Sound mehrfach). Jetzt einmalig hier,
       ausserhalb der Render-Funktion, verkabelt. */
    const chartArea = document.getElementById('chartArea');
    const BKMP_DONUT_MAX_CLICKS = 18;
    let bkmpDonutClickCount = 0;
    let bkmpDonutSpinDeg = 0;
    let bkmpDonutClickResetTimer = null;

    function bkmpPlayFireworkChime() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = freq;
          osc.type = 'triangle';
          gain.gain.setValueAtTime(0.22, ctx.currentTime + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.5);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.08);
          osc.stop(ctx.currentTime + i * 0.08 + 0.55);
        });
        setTimeout(() => ctx.close(), 900);
      } catch (e) {}
    }

    function bkmpSpawnFirework(centerX, centerY) {
      const overlay = document.createElement('div');
      overlay.className = 'bkmp-firework';
      overlay.style.left = centerX + 'px';
      overlay.style.top = centerY + 'px';
      const colors = ['#ff5e5e', '#ffd166', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6'];
      overlay.innerHTML = Array.from({ length: 30 }, (_, i) => {
        const angle = Math.round((i / 30) * 360 + Math.random() * 8);
        const distance = Math.round(80 + Math.random() * 80);
        const color = colors[i % colors.length];
        return `<span style="--angle:${angle}deg; --distance:${distance}px; background:${color};"></span>`;
      }).join('');
      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 1400);
    }

    function bkmpResetDonutSpin(donut) {
      bkmpDonutClickCount = 0;
      bkmpDonutSpinDeg = 0;
      donut.classList.remove('bkmp-donut-mixing');
      donut.style.setProperty('--bkmp-rainbow-mix', '0');
      donut.style.transition = 'transform 0.7s ease-out';
      donut.style.transform = 'rotate(0deg)';
    }

    function triggerBkmpRainbowDonut(donut) {
      const rect = donut.getBoundingClientRect();
      bkmpSpawnFirework(rect.left + rect.width / 2, rect.top + rect.height / 2);
      bkmpPlayFireworkChime();
      donut.classList.add('bkmp-donut-firework');
      setTimeout(() => donut.classList.remove('bkmp-donut-firework'), 700);
      if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('rainbow');
      bkmpResetDonutSpin(donut);
    }

    if (chartArea) {
      chartArea.addEventListener('mousedown', e => {
        if (e.target.closest('.donut')) e.preventDefault();
      });
      chartArea.addEventListener('click', e => {
        const donut = e.target.closest('.donut');
        if (!donut) return;
        bkmpDonutClickCount++;
        clearTimeout(bkmpDonutClickResetTimer);
        bkmpDonutClickResetTimer = setTimeout(() => bkmpResetDonutSpin(donut), 2200);

        if (bkmpDonutClickCount >= BKMP_DONUT_MAX_CLICKS) {
          triggerBkmpRainbowDonut(donut);
          return;
        }

        const spinAmount = 55 + bkmpDonutClickCount * 35;
        bkmpDonutSpinDeg += spinAmount;
        const duration = Math.max(0.12, 1.1 - bkmpDonutClickCount * 0.055);
        donut.classList.add('bkmp-donut-mixing');
        donut.style.setProperty('--bkmp-rainbow-mix', Math.min(1, bkmpDonutClickCount / BKMP_DONUT_MAX_CLICKS).toFixed(2));
        donut.style.transition = `transform ${duration}s cubic-bezier(0.22, 0.7, 0.3, 1)`;
        donut.style.transform = `rotate(${bkmpDonutSpinDeg}deg)`;
      });
    }

    let streamerLiveCache = { checkedAt: 0, live: {} };
    let liveToastTimer = null;
    let liveToastHideTimer = null;
    let liveToastIndex = 0;

    function getTwitchUsername(url) {
      const raw = String(url || '').trim();
      if (!raw) return '';
      try {
        const parsed = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
        if (!parsed.hostname.includes('twitch.tv')) return '';
        return (parsed.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
      } catch (e) {
        return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/').filter(Boolean).pop()?.toLowerCase() || '';
      }
    }

    function applyStreamerLiveState(liveMap) {
      document.querySelectorAll('[data-twitch-user]').forEach(item => {
        const user = item.dataset.twitchUser;
        const live = Boolean(liveMap && liveMap[user]);
        item.classList.toggle('is-live', live);
        const label = item.querySelector('.streamer-live-label');
        if (label) label.textContent = live ? 'Live' : 'Offline';
        item.title = live ? `${item.textContent.trim()} ist gerade live` : `${item.textContent.trim()} ist gerade offline`;
      });
      updateLiveToastCycle(liveMap);
    }

    function hideLiveToast() {
      const toast = document.getElementById('liveToast');
      if (!toast) return;
      toast.classList.remove('visible');
      toast.setAttribute('aria-hidden', 'true');
    }

    function showLiveToast(streamer) {
      const toast = document.getElementById('liveToast');
      if (!toast || !streamer) return;
      const url = String(streamer.url || '').startsWith('http') ? streamer.url : 'https://' + streamer.url;
      toast.innerHTML = `
        <span class="live-toast-kicker"><span></span> Gerade live auf Twitch</span>
        <strong>${escapeHtml(streamer.name)}</strong>
        <a href="${url}" target="_blank" rel="noopener" data-streamer-id="${escapeHtml(streamer.id)}">Stream öffnen</a>
      `;
      toast.classList.add('visible');
      toast.setAttribute('aria-hidden', 'false');
      clearTimeout(liveToastHideTimer);
      liveToastHideTimer = setTimeout(hideLiveToast, 9000);
    }

    function updateLiveToastCycle(liveMap) {
      const streamers = Array.isArray(data.streamers) ? data.streamers.filter(item => liveMap && liveMap[getTwitchUsername(item.url)]) : [];
      clearInterval(liveToastTimer);
      clearTimeout(liveToastHideTimer);
      if (!streamers.length || document.hidden) {
        hideLiveToast();
        return;
      }
      liveToastIndex = liveToastIndex % streamers.length;
      showLiveToast(streamers[liveToastIndex]);
      liveToastIndex = (liveToastIndex + 1) % streamers.length;
      liveToastTimer = setInterval(() => {
        if (document.hidden) {
          hideLiveToast();
          return;
        }
        showLiveToast(streamers[liveToastIndex]);
        liveToastIndex = (liveToastIndex + 1) % streamers.length;
      }, 60000);
    }

    function refreshStreamerLiveStatus(streamers) {
      const users = [...new Set(streamers.map(item => getTwitchUsername(item.url)).filter(Boolean))];
      if (!users.length) return;
      const now = Date.now();
      if (now - streamerLiveCache.checkedAt < 60000) {
        applyStreamerLiveState(streamerLiveCache.live);
        return;
      }
      const run = () => {
        fetch('/api/twitch-live?users=' + encodeURIComponent(users.join(',')), { cache: 'no-store' })
          .then(response => response.ok ? response.json() : null)
          .then(payload => {
            if (!payload || !payload.live) return;
            streamerLiveCache = { checkedAt: Date.now(), live: payload.live };
            applyStreamerLiveState(payload.live);
          })
          .catch(() => {
            applyStreamerLiveState(streamerLiveCache.live);
          });
      };
      if ('requestIdleCallback' in window) {
        requestIdleCallback(run, { timeout: 2200 });
      } else {
        setTimeout(run, 900);
      }
    }

    function renderStreamers() {
      const marquee = document.getElementById('streamerMarquee');
      const track = document.getElementById('streamerMarqueeTrack');
      if (!marquee || !track) return;
      const streamers = Array.isArray(data.streamers) ? data.streamers.filter(item => item.name && item.url) : [];
      const signature = JSON.stringify(streamers.map(item => [item.id, item.name, item.url, item.color || 'purple', item.countsForAchievement !== false]));
      if (streamers.length === 0) {
        const strip = document.getElementById('streamerStrip');
        if (strip) strip.style.display = 'none';
        track.innerHTML = '';
        track.dataset.signature = '';
        return;
      }
      const strip = document.getElementById('streamerStrip');
      if (strip) strip.style.display = 'flex';
      if (track.dataset.signature === signature) {
        refreshStreamerLiveStatus(streamers);
        return;
      }
      const itemsHtml = streamers.map(item => {
        const url = String(item.url || '').startsWith('http') ? item.url : 'https://' + item.url;
        const twitchUser = getTwitchUsername(url);
        return `<a class="streamer-pill streamer-${item.color || 'purple'}" href="${url}" target="_blank" rel="noopener" data-twitch-user="${escapeHtml(twitchUser)}" data-streamer-id="${escapeHtml(item.id)}"><span class="streamer-live-dot" aria-hidden="true"></span><span class="streamer-name">${escapeHtml(item.name)}</span><span class="streamer-live-label">Offline</span></a>`;
      }).join('');
      const repeatCount = Math.max(2, Math.ceil(18 / streamers.length));
      const loopHtml = Array(repeatCount).fill(itemsHtml).join('');
      track.dataset.signature = signature;
      track.innerHTML = `<div class="streamer-marquee-group">${loopHtml}</div><div class="streamer-marquee-group" aria-hidden="true">${loopHtml}</div>`;
      refreshStreamerLiveStatus(streamers);
      // bkmpAchievementSystemReady ist erst true, NACHDEM BKMP_ACHIEVEMENTS/
      // BKMP_TITLES weiter unten im Skript initialisiert wurden. Der ALLERERSTE
      // renderStreamers()-Aufruf passiert schon vorher (beim initialen Laden) -
      // ohne diese Absicherung wuerde der Rebuild-Versuch dort abstuerzen
      // (Zugriff auf "let"-Variablen vor ihrer Deklaration).
      if (bkmpAchievementSystemReady) {
        BKMP_ACHIEVEMENTS = bkmpBuildAchievementsList();
        BKMP_TITLES = bkmpBuildTitlesList();
        renderAchievementBadge();
      }
    }
    document.addEventListener('click', e => {
      const streamerLink = e.target.closest('[data-streamer-id]');
      if (!streamerLink) return;
      // Zaehlt nur, wenn der Creator zum Klick-Zeitpunkt WIRKLICH live war.
      // Die Twitch-Leisten-Pille bekommt die Klasse "is-live" nur bei
      // echtem Live-Status (siehe applyStreamerLiveState); der Link im
      // "Gerade live"-Popup unten existiert sowieso nur, waehrend jemand
      // live ist.
      const isLive = streamerLink.classList.contains('is-live') || Boolean(streamerLink.closest('#liveToast'));
      if (isLive) bkmpMarkStreamerClicked(streamerLink.dataset.streamerId);
    });
    renderStreamers();

    function renderAboutBlocks() {
      const aboutPage = document.getElementById('aboutPage');
      if (!aboutPage) return;
      const blocks = Array.isArray(data.aboutBlocks)
        ? [...data.aboutBlocks].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
        : [];
      if (blocks.length === 0) {
        aboutPage.innerHTML = '<p class="empty-hint">Hier entsteht bald mehr &uuml;ber BKMP.</p>';
        return;
      }
      aboutPage.innerHTML = blocks.map(block => {
        const title = block.title ? `<h3>${escapeHtml(block.title)}</h3>` : '';
        const text = block.content ? `<p>${escapeHtml(block.content).replace(/\n/g, '<br>')}</p>` : '';
        const image = block.image ? `<img data-bkmp-img src="${escapeHtml(block.image)}" alt="${escapeHtml(block.title || 'BKMP Bild')}" loading="lazy" decoding="async">` : '';
        const widthCls = block.width === 'half' ? ' about-block-half' : '';
        if (block.type === 'heading') return `<section class="about-block about-heading${widthCls}">${title}${text}</section>`;
        if (block.type === 'image') return `<section class="about-block about-image${widthCls}">${image}${title}</section>`;
        if (block.type === 'image_text') return `<section class="about-block about-split${widthCls}">${image}<div>${title}${text}</div></section>`;
        if (block.type === 'team') return `<section class="about-block about-team-card${widthCls}">${image}<div>${title}${text}</div></section>`;
        if (block.type === 'gallery') {
          const images = (block.images && block.images.length ? block.images : (block.image ? [block.image] : []));
          return `<section class="about-block about-gallery${widthCls}">${title}<div>${images.map(src => `<img data-bkmp-img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">`).join('')}</div>${text}</section>`;
        }
        return `<section class="about-block about-text${widthCls}">${title}${text}</section>`;
      }).join('');
      if (window.bkmpEnhanceImages) window.bkmpEnhanceImages(aboutPage);
    }
    renderAboutBlocks();

    const partnerFilter = document.getElementById('partnerFilter');
    const partnerGrid = document.getElementById('partnerGrid');
    let activePartnerCategory = 'Alle';

    function renderPartnerShops() {
      if (!partnerFilter || !partnerGrid) return;
      const shops = (Array.isArray(data.partnerShops) ? data.partnerShops : []).filter(shop => !shop.status || shop.status === 'approved');
      if (shops.length === 0) {
        partnerFilter.innerHTML = '';
        partnerGrid.innerHTML = '<p class="empty-hint">Noch keine PartnerShops eingetragen.</p>';
        return;
      }

      const categories = ['Alle', ...new Set(shops.map(shop => shop.category || 'Sonstige'))];
      if (!categories.includes(activePartnerCategory)) activePartnerCategory = 'Alle';
      partnerFilter.innerHTML = categories.map(category => `
        <button class="${category === activePartnerCategory ? 'active' : ''}" type="button" data-partner-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
      `).join('');

      const visible = activePartnerCategory === 'Alle'
        ? shops
        : shops.filter(shop => (shop.category || 'Sonstige') === activePartnerCategory);

      const newShopBadge = bkmpNewBadgeChecker('partnershops');
      partnerGrid.innerHTML = visible.map(shop => {
        const href = shop.link ? (String(shop.link).startsWith('http') ? shop.link : 'https://' + shop.link) : '';
        return `
          <article class="partner-card">
            ${newShopBadge(shop.id)}
            <div class="partner-image-frame" data-bkmp-image-wrap data-empty-label="Kein Bild">
              ${shop.image ? `<img data-bkmp-img src="${shop.image}" alt="${escapeHtml(shop.name)}" loading="eager" fetchpriority="low" decoding="async">` : '<div class="partner-image-empty">Kein Bild</div>'}
            </div>
            <div class="partner-body">
              <span class="partner-category">${escapeHtml(shop.category || 'Partner')}</span>
              <h3>${escapeHtml(shop.name)}</h3>
              ${shop.location ? `<div class="partner-location">${escapeHtml(shop.location)}</div>` : ''}
              ${shop.description ? `<p>${escapeHtml(shop.description)}</p>` : ''}
              <div class="partner-actions">
                ${href ? `<a href="${href}" target="_blank" rel="noopener">Link öffnen</a>` : ''}
                ${shop.contact ? `<span>${escapeHtml(shop.contact)}</span>` : ''}
              </div>
            </div>
          </article>`;
      }).join('');
      if (window.bkmpEnhanceImages) window.bkmpEnhanceImages(partnerGrid);
      window.requestAnimationFrame(() => {
        partnerGrid.querySelectorAll('img[data-bkmp-img]').forEach(img => {
          if (!img.complete && img.dataset.originalSrc) img.src = img.dataset.originalSrc;
        });
      });
      bkmpMarkAllSeen('partnershops', shops.map(s => s.id));
    }
    renderPartnerShops();
    if (partnerFilter) {
      partnerFilter.addEventListener('click', e => {
        const btn = e.target.closest('[data-partner-category]');
        if (!btn) return;
        activePartnerCategory = btn.dataset.partnerCategory;
        renderPartnerShops();
      });
    }

    const cardsaleGrid = document.getElementById('cardsaleGrid');
    function renderCardSales() {
      if (!cardsaleGrid) return;
      const items = Array.isArray(data.cardSales) ? data.cardSales : [];
      if (items.length === 0) {
        cardsaleGrid.innerHTML = '<p class="empty-hint">Noch keine Karten im Verkauf.</p>';
        return;
      }
      cardsaleGrid.innerHTML = items.map(item => {
        const earned = Number(item.soldCount || 0) * BKMP_CARD_SALE_SELLER_SHARE;
        return `
          <article class="cardsale-card">
            <div class="cardsale-image-frame" data-bkmp-image-wrap data-empty-label="Kein Bild">
              ${item.image ? `<img data-bkmp-img src="${item.image}" alt="Karte von ${escapeHtml(item.playerName)}" loading="lazy" decoding="async">` : '<div class="cardsale-image-empty">Kein Bild</div>'}
            </div>
            <div class="cardsale-body">
              <h3>${escapeHtml(item.playerName)}</h3>
              <div class="cardsale-stats">
                <div><span>Verkauft</span><strong>${Number(item.soldCount || 0)}x</strong></div>
                <div><span>Bereits verdient</span><strong class="gold">${bkmpFormatCurrency(earned)}</strong></div>
              </div>
            </div>
          </article>`;
      }).join('');
      if (window.bkmpEnhanceImages) window.bkmpEnhanceImages(cardsaleGrid);
    }
    renderCardSales();

    /* ---------------- Kartendatenbank ---------------- */
    const cardCatalogGrid = document.getElementById('cardCatalogGrid');
    const cardCatalogCategoryFilterEl = document.getElementById('cardCatalogCategoryFilter');
    const cardCatalogShopFilterEl = document.getElementById('cardCatalogShopFilter');
    const cardCatalogSearchEl = document.getElementById('cardCatalogSearch');
    let activeCardCatalogCategory = 'Alle';
    let activeCardCatalogShop = 'Alle';

    function renderCardCatalog() {
      if (!cardCatalogGrid) return;
      /* Admins sehen per RLS auch "pending"/"rejected" Eintraege (fuer die
         Moderation im Admin-Panel), aber auf der oeffentlichen Seite duerfen
         nur freigegebene Karten sichtbar sein - auch wenn ein Admin gerade
         in diesem Browser eingeloggt ist und die Seite besucht. */
      const items = (Array.isArray(data.cardCatalog) ? data.cardCatalog : []).filter(item => !item.status || item.status === 'approved');
      if (items.length === 0) {
        if (cardCatalogCategoryFilterEl) cardCatalogCategoryFilterEl.innerHTML = '';
        if (cardCatalogShopFilterEl) cardCatalogShopFilterEl.innerHTML = '';
        cardCatalogGrid.innerHTML = '<p class="empty-hint">Noch keine Karten eingetragen — sei der/die Erste!</p>';
        return;
      }

      const categories = ['Alle', ...new Set(items.map(item => item.category || 'Sonstige'))];
      if (!categories.includes(activeCardCatalogCategory)) activeCardCatalogCategory = 'Alle';
      const shops = ['Alle', ...new Set(items.map(item => (item.shopName || 'Unbekannt').toUpperCase()))];
      if (!shops.includes(activeCardCatalogShop)) activeCardCatalogShop = 'Alle';

      if (cardCatalogCategoryFilterEl) {
        cardCatalogCategoryFilterEl.innerHTML = categories.map(cat => `
          <button class="${cat === activeCardCatalogCategory ? 'active' : ''}" type="button" data-cardcatalog-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
        `).join('');
      }
      if (cardCatalogShopFilterEl) {
        cardCatalogShopFilterEl.innerHTML = shops.map(shop => `
          <button class="${shop === activeCardCatalogShop ? 'active' : ''}" type="button" data-cardcatalog-shop="${escapeHtml(shop)}">${escapeHtml(shop)}</button>
        `).join('');
      }

      const searchQuery = cardCatalogSearchEl ? cardCatalogSearchEl.value.trim().toLowerCase() : '';
      const visible = items.filter(item => {
        const matchesCategory = activeCardCatalogCategory === 'Alle' || (item.category || 'Sonstige') === activeCardCatalogCategory;
        const matchesShop = activeCardCatalogShop === 'Alle' || (item.shopName || 'Unbekannt').toUpperCase() === activeCardCatalogShop;
        const matchesSearch = !searchQuery || (item.name || '').toLowerCase().includes(searchQuery);
        return matchesCategory && matchesShop && matchesSearch;
      });

      if (visible.length === 0) {
        cardCatalogGrid.innerHTML = '<p class="empty-hint">Keine Karten für diese Auswahl gefunden.</p>';
        return;
      }

      cardCatalogGrid.innerHTML = visible.map(item => `
        <article class="cardcatalog-card">
          <div class="cardcatalog-image-frame" data-bkmp-image-wrap data-empty-label="Kein Bild">
            ${item.image ? `<img data-bkmp-img src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">` : '<div class="cardcatalog-image-empty">Kein Bild</div>'}
          </div>
          <div class="cardcatalog-body">
            ${item.category ? `<span class="cardcatalog-category">${escapeHtml(item.category)}</span>` : ''}
            <h3>${escapeHtml(item.name)}</h3>
            ${(() => {
              const parts = [item.shopName ? item.shopName.toUpperCase() : '', item.cb || '', item.size || ''].filter(Boolean);
              return parts.length ? `<div class="cardcatalog-shop">${parts.map(escapeHtml).join(' · ')}</div>` : '';
            })()}
            ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
            ${item.submittedBy ? `<div class="cardcatalog-submitter">Eingetragen von ${escapeHtml(item.submittedBy)}</div>` : ''}
          </div>
        </article>
      `).join('');
      if (window.bkmpEnhanceImages) window.bkmpEnhanceImages(cardCatalogGrid);
    }
    renderCardCatalog();

    if (cardCatalogCategoryFilterEl) {
      cardCatalogCategoryFilterEl.addEventListener('click', e => {
        const btn = e.target.closest('[data-cardcatalog-category]');
        if (!btn) return;
        activeCardCatalogCategory = btn.dataset.cardcatalogCategory;
        renderCardCatalog();
      });
    }
    if (cardCatalogShopFilterEl) {
      cardCatalogShopFilterEl.addEventListener('click', e => {
        const btn = e.target.closest('[data-cardcatalog-shop]');
        if (!btn) return;
        activeCardCatalogShop = btn.dataset.cardcatalogShop;
        renderCardCatalog();
      });
    }
    if (cardCatalogSearchEl) {
      cardCatalogSearchEl.addEventListener('input', renderCardCatalog);
    }

    const cardCatalogOverlay = document.getElementById('cardCatalogOverlay');
    const openCardCatalogForm = document.getElementById('openCardCatalogForm');
    const cardCatalogCancel = document.getElementById('cardCatalogCancel');
    const cardCatalogSubmit = document.getElementById('cardCatalogSubmit');
    const cardCatalogNameInput = document.getElementById('cardCatalogName');
    const cardCatalogCategoryInput = document.getElementById('cardCatalogCategory');
    const cardCatalogShopInput = document.getElementById('cardCatalogShop');
    const cardCatalogCbInput = document.getElementById('cardCatalogCb');
    const cardCatalogSizeInput = document.getElementById('cardCatalogSize');
    const cardCatalogWhoInput = document.getElementById('cardCatalogWho');
    const cardCatalogDescriptionInput = document.getElementById('cardCatalogDescription');
    const cardCatalogImageFileInput = document.getElementById('cardCatalogImageFile');
    const cardCatalogFormView = document.getElementById('cardCatalogFormView');
    const cardCatalogConfirmView = document.getElementById('cardCatalogConfirmView');
    const cardCatalogConfirmSummary = document.getElementById('cardCatalogConfirmSummary');
    const cardCatalogConfirmBack = document.getElementById('cardCatalogConfirmBack');
    const cardCatalogConfirmYes = document.getElementById('cardCatalogConfirmYes');
    const cardCatalogSuccessView = document.getElementById('cardCatalogSuccessView');
    const cardCatalogSuccessClose = document.getElementById('cardCatalogSuccessClose');
    let cardCatalogConfirmPreviewUrl = null;
    let cardCatalogPendingEntry = null;

    function showCardCatalogView(view) {
      [cardCatalogFormView, cardCatalogConfirmView, cardCatalogSuccessView].forEach(el => {
        if (el) el.style.display = el === view ? '' : 'none';
      });
    }

    function clearCardCatalogForm() {
      cardCatalogNameInput.value = '';
      cardCatalogCategoryInput.value = '';
      cardCatalogShopInput.value = '';
      cardCatalogCbInput.value = '';
      cardCatalogSizeInput.value = '';
      /* Vorausgefuellt mit dem eingeloggten Namen (siehe gleicher Kommentar
         bei resetWishForm) - sonst zaehlten "Kartensammler"-Erfolge nie mit,
         wenn hier ein anderer Name als beim Login eingetippt wurde. */
      cardCatalogWhoInput.value = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
      cardCatalogDescriptionInput.value = '';
      cardCatalogImageFileInput.value = '';
      if (cardCatalogConfirmPreviewUrl) {
        URL.revokeObjectURL(cardCatalogConfirmPreviewUrl);
        cardCatalogConfirmPreviewUrl = null;
      }
      cardCatalogPendingEntry = null;
      showCardCatalogView(cardCatalogFormView);
    }

    if (openCardCatalogForm) {
      openCardCatalogForm.addEventListener('click', () => {
        clearCardCatalogForm();
        cardCatalogOverlay.classList.add('visible');
      });
    }
    if (cardCatalogCancel) cardCatalogCancel.addEventListener('click', () => cardCatalogOverlay.classList.remove('visible'));

    if (cardCatalogSubmit) {
      cardCatalogSubmit.addEventListener('click', () => {
        const name = cardCatalogNameInput.value.trim();
        if (!name) { cardCatalogNameInput.reportValidity(); return; }
        const file = cardCatalogImageFileInput.files && cardCatalogImageFileInput.files[0];
        if (!file) { cardCatalogImageFileInput.reportValidity(); return; }

        const category = cardCatalogCategoryInput.value.trim();
        const shopName = cardCatalogShopInput.value.trim().toUpperCase();
        const cb = cardCatalogCbInput.value.trim();
        const size = cardCatalogSizeInput.value.trim();
        const submittedBy = cardCatalogWhoInput.value.trim();
        const description = cardCatalogDescriptionInput.value.trim();
        cardCatalogPendingEntry = { name, category, shopName, cb, size, submittedBy, description, file };

        if (cardCatalogConfirmPreviewUrl) URL.revokeObjectURL(cardCatalogConfirmPreviewUrl);
        cardCatalogConfirmPreviewUrl = URL.createObjectURL(file);
        const rows = [
          ['Name', name],
          ['Kategorie', category],
          ['Shop', shopName],
          ['CB', cb],
          ['Größe', size],
          ['Wer trägt ein', submittedBy],
          ['Beschreibung', description]
        ].filter(([, value]) => value);
        cardCatalogConfirmSummary.innerHTML = `
          <img src="${cardCatalogConfirmPreviewUrl}" alt="" class="cardcatalog-confirm-image">
          <dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
        `;
        showCardCatalogView(cardCatalogConfirmView);
      });
    }

    if (cardCatalogConfirmBack) {
      cardCatalogConfirmBack.addEventListener('click', () => showCardCatalogView(cardCatalogFormView));
    }

    if (cardCatalogConfirmYes) {
      cardCatalogConfirmYes.addEventListener('click', () => {
        if (!cardCatalogPendingEntry) return;
        const cooldown = bkmpSubmitCooldownSecondsLeft('cardcatalog');
        if (cooldown > 0) { alert(`Bitte warte noch ${cooldown} Sekunde(n), bevor du erneut einreichst.`); return; }
        const { name, category, shopName, cb, size, submittedBy, description, file } = cardCatalogPendingEntry;

        cardCatalogConfirmYes.disabled = true;
        cardCatalogConfirmYes.textContent = 'Wird gespeichert...';

        function resetBtn() {
          cardCatalogConfirmYes.disabled = false;
          cardCatalogConfirmYes.textContent = 'Ja, einreichen';
        }

        bkmpCompressImageFile(file).then(image => {
          bkmpSubmitViaApi('card_catalog', { name, category, shop_name: shopName, cb, size, submitted_by: submittedBy, description }, image).then(() => {
            bkmpStartSubmitCooldown('cardcatalog');
            resetBtn();
            clearCardCatalogForm();
            showCardCatalogView(cardCatalogSuccessView);
          }).catch(e => {
            console.error('Karte konnte nicht gespeichert werden.', e);
            resetBtn();
            alert('Die Karte konnte nicht gespeichert werden: ' + (e && e.message || e) + '\n\nBitte versuche es erneut oder mit einem anderen Bild.');
          });
        }).catch(() => {
          resetBtn();
          alert('Das Bild konnte nicht gelesen werden. Bitte versuche es mit einer anderen Datei erneut.');
        });
      });
    }

    if (cardCatalogSuccessClose) {
      cardCatalogSuccessClose.addEventListener('click', () => cardCatalogOverlay.classList.remove('visible'));
    }

    /* ---------------- Kartenverkaufs-Anfrage ---------------- */
    const cardSaleRequestOverlay = document.getElementById('cardSaleRequestOverlay');
    const openCardSaleRequestForm = document.getElementById('openCardSaleRequestForm');
    const cardSaleRequestCancel = document.getElementById('cardSaleRequestCancel');
    const cardSaleRequestSubmit = document.getElementById('cardSaleRequestSubmit');
    const cardSaleRequestNameInput = document.getElementById('cardSaleRequestName');
    const cardSaleRequestDiscordInput = document.getElementById('cardSaleRequestDiscord');
    const cardSaleRequestImageFileInput = document.getElementById('cardSaleRequestImageFile');
    const cardSaleRequestInfoRead = document.getElementById('cardSaleRequestInfoRead');
    const cardSaleRequestFormView = document.getElementById('cardSaleRequestFormView');
    const cardSaleRequestSuccessView = document.getElementById('cardSaleRequestSuccessView');
    const cardSaleRequestSuccessClose = document.getElementById('cardSaleRequestSuccessClose');

    function clearCardSaleRequestForm() {
      cardSaleRequestNameInput.value = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
      cardSaleRequestDiscordInput.value = '';
      cardSaleRequestImageFileInput.value = '';
      cardSaleRequestInfoRead.checked = false;
      if (cardSaleRequestFormView) cardSaleRequestFormView.style.display = '';
      if (cardSaleRequestSuccessView) cardSaleRequestSuccessView.style.display = 'none';
    }

    if (openCardSaleRequestForm) {
      openCardSaleRequestForm.addEventListener('click', () => {
        clearCardSaleRequestForm();
        cardSaleRequestOverlay.classList.add('visible');
      });
    }
    if (cardSaleRequestCancel) cardSaleRequestCancel.addEventListener('click', () => cardSaleRequestOverlay.classList.remove('visible'));
    if (cardSaleRequestSuccessClose) cardSaleRequestSuccessClose.addEventListener('click', () => cardSaleRequestOverlay.classList.remove('visible'));

    if (cardSaleRequestSubmit) {
      cardSaleRequestSubmit.addEventListener('click', () => {
        const name = cardSaleRequestNameInput.value.trim();
        if (!name) { cardSaleRequestNameInput.reportValidity(); return; }
        const file = cardSaleRequestImageFileInput.files && cardSaleRequestImageFileInput.files[0];
        if (!file) { cardSaleRequestImageFileInput.reportValidity(); return; }
        if (!cardSaleRequestInfoRead.checked) { cardSaleRequestInfoRead.reportValidity(); return; }
        const cooldown = bkmpSubmitCooldownSecondsLeft('cardsalerequest');
        if (cooldown > 0) { alert(`Bitte warte noch ${cooldown} Sekunde(n), bevor du erneut einreichst.`); return; }
        const discord = cardSaleRequestDiscordInput.value.trim();

        cardSaleRequestSubmit.disabled = true;
        cardSaleRequestSubmit.textContent = 'Wird gesendet...';
        function resetBtn() {
          cardSaleRequestSubmit.disabled = false;
          cardSaleRequestSubmit.textContent = 'Anfrage senden';
        }

        bkmpCompressImageFile(file).then(image => {
          bkmpSubmitViaApi('card_sale_requests', { minecraft_name: name, discord }, image).then(row => {
            bkmpStartSubmitCooldown('cardsalerequest');
            resetBtn();
            if (row && row.id && typeof bkmpAddPendingRequestId === 'function') bkmpAddPendingRequestId(BKMP_PENDING_CARD_SALE_KEY, row.id);
            if (cardSaleRequestFormView) cardSaleRequestFormView.style.display = 'none';
            if (cardSaleRequestSuccessView) cardSaleRequestSuccessView.style.display = '';
          }).catch(e => {
            console.error('Verkaufsanfrage konnte nicht gespeichert werden.', e);
            resetBtn();
            alert('Die Anfrage konnte nicht gesendet werden: ' + (e && e.message || e) + '\n\nBitte versuche es erneut oder mit einem anderen Bild.');
          });
        }).catch(() => {
          resetBtn();
          alert('Das Bild konnte nicht gelesen werden. Bitte versuche es mit einer anderen Datei erneut.');
        });
      });
    }

    /* ---------------- PartnerShop-Einreichung ---------------- */
    const partnerShopOverlay = document.getElementById('partnerShopOverlay');
    const openPartnerShopForm = document.getElementById('openPartnerShopForm');
    const partnerShopCancel = document.getElementById('partnerShopCancel');
    const partnerShopSubmit = document.getElementById('partnerShopSubmit');
    const partnerShopNameInput = document.getElementById('partnerShopName');
    const partnerShopLocationInput = document.getElementById('partnerShopLocation');
    const partnerShopCategoryInput = document.getElementById('partnerShopCategory');
    const partnerShopDescriptionInput = document.getElementById('partnerShopDescription');
    const partnerShopLinkInput = document.getElementById('partnerShopLink');
    const partnerShopContactInput = document.getElementById('partnerShopContact');
    const partnerShopImageFileInput = document.getElementById('partnerShopImageFile');
    const partnerShopFormView = document.getElementById('partnerShopFormView');
    const partnerShopConfirmView = document.getElementById('partnerShopConfirmView');
    const partnerShopConfirmSummary = document.getElementById('partnerShopConfirmSummary');
    const partnerShopConfirmBack = document.getElementById('partnerShopConfirmBack');
    const partnerShopConfirmYes = document.getElementById('partnerShopConfirmYes');
    const partnerShopSuccessView = document.getElementById('partnerShopSuccessView');
    const partnerShopSuccessClose = document.getElementById('partnerShopSuccessClose');
    let partnerShopConfirmPreviewUrl = null;
    let partnerShopPendingEntry = null;

    function showPartnerShopView(view) {
      [partnerShopFormView, partnerShopConfirmView, partnerShopSuccessView].forEach(el => {
        if (el) el.style.display = el === view ? '' : 'none';
      });
    }

    function clearPartnerShopForm() {
      partnerShopNameInput.value = '';
      partnerShopLocationInput.value = '';
      partnerShopCategoryInput.value = '';
      partnerShopDescriptionInput.value = '';
      partnerShopLinkInput.value = '';
      partnerShopContactInput.value = '';
      partnerShopImageFileInput.value = '';
      if (partnerShopConfirmPreviewUrl) {
        URL.revokeObjectURL(partnerShopConfirmPreviewUrl);
        partnerShopConfirmPreviewUrl = null;
      }
      partnerShopPendingEntry = null;
      showPartnerShopView(partnerShopFormView);
    }

    if (openPartnerShopForm) {
      openPartnerShopForm.addEventListener('click', () => {
        clearPartnerShopForm();
        partnerShopOverlay.classList.add('visible');
      });
    }
    if (partnerShopCancel) partnerShopCancel.addEventListener('click', () => partnerShopOverlay.classList.remove('visible'));

    if (partnerShopSubmit) {
      partnerShopSubmit.addEventListener('click', () => {
        const name = partnerShopNameInput.value.trim();
        if (!name) { partnerShopNameInput.reportValidity(); return; }

        const location = partnerShopLocationInput.value.trim();
        const category = partnerShopCategoryInput.value.trim();
        const description = partnerShopDescriptionInput.value.trim();
        const link = partnerShopLinkInput.value.trim();
        const contact = partnerShopContactInput.value.trim();
        const file = partnerShopImageFileInput.files && partnerShopImageFileInput.files[0];
        partnerShopPendingEntry = { name, location, category, description, link, contact, file };

        if (partnerShopConfirmPreviewUrl) URL.revokeObjectURL(partnerShopConfirmPreviewUrl);
        const rows = [
          ['Shopname', name],
          ['Server / Warp', location],
          ['Kategorie', category],
          ['Beschreibung', description],
          ['Link', link],
          ['Kontakt', contact]
        ].filter(([, value]) => value);
        const imageHtml = file
          ? (() => { partnerShopConfirmPreviewUrl = URL.createObjectURL(file); return `<img src="${partnerShopConfirmPreviewUrl}" alt="" class="cardcatalog-confirm-image">`; })()
          : '';
        partnerShopConfirmSummary.innerHTML = `
          ${imageHtml}
          <dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
        `;
        showPartnerShopView(partnerShopConfirmView);
      });
    }

    if (partnerShopConfirmBack) {
      partnerShopConfirmBack.addEventListener('click', () => showPartnerShopView(partnerShopFormView));
    }

    if (partnerShopConfirmYes) {
      partnerShopConfirmYes.addEventListener('click', () => {
        if (!partnerShopPendingEntry) return;
        const cooldown = bkmpSubmitCooldownSecondsLeft('partnershop');
        if (cooldown > 0) { alert(`Bitte warte noch ${cooldown} Sekunde(n), bevor du erneut einreichst.`); return; }
        const { name, location, category, description, link, contact, file } = partnerShopPendingEntry;

        partnerShopConfirmYes.disabled = true;
        partnerShopConfirmYes.textContent = 'Wird gespeichert...';

        function resetBtn() {
          partnerShopConfirmYes.disabled = false;
          partnerShopConfirmYes.textContent = 'Ja, einreichen';
        }

        const readImage = file ? bkmpCompressImageFile(file) : Promise.resolve('');
        readImage.then(image => {
          bkmpSubmitViaApi('partner_shops', { name, location, category, description, link, contact }, image || null).then(() => {
            bkmpStartSubmitCooldown('partnershop');
            resetBtn();
            clearPartnerShopForm();
            showPartnerShopView(partnerShopSuccessView);
          }).catch(e => {
            console.error('PartnerShop konnte nicht gespeichert werden.', e);
            resetBtn();
            alert('Der Shop konnte nicht gespeichert werden: ' + (e && e.message || e) + '\n\nBitte versuche es erneut.');
          });
        }).catch(() => {
          resetBtn();
          alert('Das Bild konnte nicht gelesen werden. Bitte versuche es mit einer anderen Datei erneut.');
        });
      });
    }

    if (partnerShopSuccessClose) {
      partnerShopSuccessClose.addEventListener('click', () => partnerShopOverlay.classList.remove('visible'));
    }

    function renderFormattedNewsText(value) {
      let html = escapeHtml(value);
      html = html.replace(new RegExp('\\[b\\]([\\s\\S]*?)\\[/b\\]', 'gi'), '<strong>$1</strong>');
      html = html.replace(new RegExp('\\[i\\]([\\s\\S]*?)\\[/i\\]', 'gi'), '<em>$1</em>');
      html = html.replace(new RegExp('\\[color=(#[0-9a-fA-F]{3,6})\\]([\\s\\S]*?)\\[/color\\]', 'gi'), '<span style="color:$1">$2</span>');
      return html;
    }

    /* News */
    const newsFeed = document.getElementById('newsFeed');
    function renderNews() {
      if (data.news.length === 0) {
        newsFeed.innerHTML = '<p class="empty-hint">Noch keine Updates gepostet.</p>';
        if (typeof bkmpSyncNewsTabDot === 'function') bkmpSyncNewsTabDot();
        return;
      }
      const visibleNews = typeof bkmpDedupeUpdates === 'function' ? bkmpDedupeUpdates(data.news) : data.news;
      const sorted = [...visibleNews].sort((a, b) => (a.date < b.date ? 1 : -1));
      newsFeed.innerHTML = sorted.map(post => {
        const images = post.images && post.images.length ? post.images : (post.image ? [post.image] : []);
        const imageHtml = images.length ? `
          <div class="news-images count-${images.length}">
            ${images.map(img => `<img data-bkmp-img src="${img}" alt="" loading="lazy" decoding="async">`).join('')}
          </div>` : '';
        return `
          <article class="news-card">
            ${imageHtml}
            <div class="news-body">
              <div class="news-date">${escapeHtml(post.date)}</div>
              <div class="news-title">${escapeHtml(post.title)}</div>
              <div class="news-text">${renderFormattedNewsText(post.text)}</div>
            </div>
          </article>`;
      }).join('');
      if (window.bkmpEnhanceImages) window.bkmpEnhanceImages(newsFeed);
      if (typeof bkmpSyncNewsTabDot === 'function') bkmpSyncNewsTabDot();
    }
    renderNews();

    /* Kartenideen */
    const wishGrid = document.getElementById('wishGrid');
    /* Merkt sich die eigene Stimme (wishId -> 'like'/'dislike') des
       eingeloggten Accounts, geladen ueber loadMyWishVotes(). Bestimmt, ob
       die Like/Dislike-Buttons pro Kartenidee gesperrt gerendert werden -
       die eigentliche Durchsetzung des 1x-Limits passiert serverseitig
       (Unique-Constraint), das hier ist nur die passende Anzeige dazu. */
    let bkmpMyWishVotes = {};
    async function bkmpRefreshMyWishVotes() {
      bkmpMyWishVotes = typeof loadMyWishVotes === 'function' ? await loadMyWishVotes().catch(() => ({})) : {};
      renderWishes();
    }
    function renderWishes() {
      const approvedWishes = (Array.isArray(data.wishes) ? data.wishes : []).filter(w => !w.status || w.status === 'approved');
      if (approvedWishes.length === 0) {
        wishGrid.innerHTML = '<p class="empty-hint">Noch keine Kartenideen eingereicht — sei der/die Erste!</p>';
        return;
      }
      wishGrid.innerHTML = [...approvedWishes].reverse().map(w => {
        const myVote = bkmpMyWishVotes[w.id] || '';
        const voted = Boolean(myVote);
        return `
        <article class="wish-card" data-wish-id="${w.id}">
          <button class="wish-image-btn" type="button" data-action="open" data-bkmp-image-wrap data-empty-label="Kein Bild" aria-label="Kartenidee von ${escapeHtml(w.name)} gross ansehen">
            ${w.image ? `<img data-bkmp-img src="${w.image}" alt="Kartenidee von ${escapeHtml(w.name)}" loading="lazy" decoding="async">` : '<span class="wish-image-empty">Kein Bild</span>'}
          </button>
          <div class="wish-card-body">
            <div class="wish-name">${escapeHtml(w.name)}</div>
            <div class="wish-card-actions">
              <button type="button" class="wish-vote wish-like ${myVote === 'like' ? 'is-voted' : ''}" data-action="like" ${voted ? 'disabled' : ''}>Like <span>${Number(w.likes || 0)}</span></button>
              <button type="button" class="wish-vote wish-dislike ${myVote === 'dislike' ? 'is-voted' : ''}" data-action="dislike" ${voted ? 'disabled' : ''}>Dislike <span>${Number(w.dislikes || 0)}</span></button>
            </div>
          </div>
        </article>
      `;
      }).join('');
      if (window.bkmpEnhanceImages) window.bkmpEnhanceImages(wishGrid);
    }
    renderWishes();

    const wishOverlay = document.getElementById('wishOverlay');
    const wishDetailOverlay = document.getElementById('wishDetailOverlay');
    const wishDetailClose = document.getElementById('wishDetailClose');
    const wishDetailImage = document.getElementById('wishDetailImage');
    const wishDetailName = document.getElementById('wishDetailName');
    const openWishForm = document.getElementById('openWishForm');
    const wishCancel = document.getElementById('wishCancel');
    const wishSubmit = document.getElementById('wishSubmit');
    const wishName = document.getElementById('wishName');
    const wishImageFile = document.getElementById('wishImageFile');
    const wishFormView = document.getElementById('wishFormView');
    const wishSuccessView = document.getElementById('wishSuccessView');
    const wishSuccessClose = document.getElementById('wishSuccessClose');

    function resetWishForm() {
      /* Vorausgefuellt mit dem eingeloggten Namen statt leer - vorher war
         dieses Feld reiner Freitext ohne Bezug zum Account, wodurch ein
         Tippfehler/anderer Name als beim Login die "Wunschfan"-Erfolge
         (die per exaktem Namensvergleich zaehlen) stillschweigend nie
         mitgezaehlt hat, selbst nach Admin-Bestaetigung. */
      wishName.value = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
      wishImageFile.value = '';
      wishFormView.style.display = '';
      wishSuccessView.style.display = 'none';
    }

    openWishForm.addEventListener('click', () => {
      resetWishForm();
      wishOverlay.classList.add('visible');
    });
    wishCancel.addEventListener('click', () => wishOverlay.classList.remove('visible'));
    if (wishSuccessClose) wishSuccessClose.addEventListener('click', () => wishOverlay.classList.remove('visible'));
    wishDetailClose.addEventListener('click', () => wishDetailOverlay.classList.remove('visible'));
    wishDetailOverlay.addEventListener('click', e => {
      if (e.target === wishDetailOverlay) wishDetailOverlay.classList.remove('visible');
    });

    function openWishDetail(wish) {
      wishDetailImage.src = wish.image;
      wishDetailImage.alt = 'Kartenidee von ' + wish.name;
      wishDetailName.textContent = wish.name;
      wishDetailOverlay.classList.add('visible');
    }

    function updateWishLocal(updatedWish) {
      data.wishes = data.wishes.map(item => item.id === updatedWish.id ? updatedWish : item);
      bkmpSaveData(data);
      renderWishes();
    }

    wishGrid.addEventListener('click', e => {
      const actionElement = e.target.closest('[data-action]');
      if (!actionElement) return;
      const card = e.target.closest('.wish-card');
      if (!card) return;
      const wish = data.wishes.find(item => String(item.id) === String(card.dataset.wishId));
      if (!wish) return;
      const action = actionElement.dataset.action;

      if (action === 'open') {
        openWishDetail(wish);
        return;
      }

      if (action === 'like' || action === 'dislike') {
        /* Abstimmen braucht einen echten Account (wish_votes ist per
           auth_user_id begrenzt, siehe supabase-wish-votes-schema.sql) -
           ohne Login gibt's nichts zum Verknuepfen, stattdessen oeffnet
           sich das Login/Registrieren-Fenster. */
        if (!bkmpGetMcName()) {
          mcAuthResetForm();
          mcNameOverlay.classList.add('visible');
          return;
        }
        if (bkmpMyWishVotes[wish.id] || String(wish.id).startsWith('wish-')) return;

        const column = action === 'dislike' ? 'dislikes' : 'likes';
        const localWish = { ...wish, [column]: Number(wish[column] || 0) + 1 };
        bkmpMyWishVotes = { ...bkmpMyWishVotes, [wish.id]: action };
        updateWishLocal(localWish);

        if (typeof voteWish === 'function') {
          voteWish(wish.id, action).then(updated => {
            if (updated) updateWishLocal(updated);
          }).catch(err => {
            if (err && err.message === 'already_voted') {
              bkmpRefreshMyWishVotes();
              return;
            }
            console.warn('Supabase konnte Bewertung nicht speichern.', err);
            const revertedVotes = { ...bkmpMyWishVotes };
            delete revertedVotes[wish.id];
            bkmpMyWishVotes = revertedVotes;
            updateWishLocal(wish);
          });
        }
      }
    });

    wishSubmit.addEventListener('click', () => {
      const name = wishName.value.trim();
      const file = wishImageFile.files && wishImageFile.files[0];
      if (!name || !file) {
        alert('Bitte gib deinen Namen an und wähle ein PNG-Bild aus.');
        return;
      }
      const cooldown = bkmpSubmitCooldownSecondsLeft('wish');
      if (cooldown > 0) { alert(`Bitte warte noch ${cooldown} Sekunde(n), bevor du erneut einreichst.`); return; }

      wishSubmit.disabled = true;
      wishSubmit.textContent = 'Wird gespeichert...';

      function resetSubmitBtn() {
        wishSubmit.disabled = false;
        wishSubmit.textContent = 'Wunsch einreichen';
      }

      bkmpCompressImageFile(file).then(image => {
        bkmpSubmitViaApi('wishes', { name }, image).then(() => {
          bkmpStartSubmitCooldown('wish');
          resetSubmitBtn();
          wishFormView.style.display = 'none';
          wishSuccessView.style.display = '';
        }).catch(e => {
          console.error('Kartenidee konnte nicht gespeichert werden.', e);
          resetSubmitBtn();
          alert('Deine Kartenidee konnte nicht gespeichert werden: ' + (e && e.message || e) + '\n\nBitte versuche es erneut oder mit einem anderen Bild.');
        });
      }).catch(() => {
        resetSubmitBtn();
        alert('Das Bild konnte nicht gelesen werden. Bitte versuche es mit einer anderen PNG-Datei erneut.');
      });
    });

    /* ---------------- Feedback ---------------- */
    /* Eigene Zaehler pro Kategorie, fuer die Feedback-Erfolge/-Titel unten -
       gleiches Muster wie bkmpGetBonkCount: rein lokal auf diesem Geraet,
       NICHT aus der feedback-Tabelle gelesen (die ist per RLS admin-only,
       ein Spieler kann seine eigenen Eintraege dort gar nicht abfragen).
       Wird direkt beim erfolgreichen Absenden hochgezaehlt, unabhaengig
       davon, ob "anonym" gesendet wurde - die Anonymitaet betrifft nur den
       in der Nachricht gespeicherten Namen, nicht die eigene Erfolgs-
       Zaehlung auf diesem Geraet. */
    const BKMP_FEEDBACK_COUNT_PREFIX = 'bkmp-feedback-count-';
    function bkmpGetFeedbackCount(category) {
      try { return Number(localStorage.getItem(BKMP_FEEDBACK_COUNT_PREFIX + category) || 0); } catch (e) { return 0; }
    }
    function bkmpIncrementFeedbackCount(category) {
      const next = bkmpGetFeedbackCount(category) + 1;
      try { localStorage.setItem(BKMP_FEEDBACK_COUNT_PREFIX + category, String(next)); } catch (e) {}
      if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
      return next;
    }

    const feedbackButton = document.getElementById('feedbackButton');
    const feedbackOverlay = document.getElementById('feedbackOverlay');
    const feedbackFormView = document.getElementById('feedbackFormView');
    const feedbackSuccessView = document.getElementById('feedbackSuccessView');
    const feedbackNameToggle = document.getElementById('feedbackNameToggle');
    const feedbackNameModeName = document.getElementById('feedbackNameModeName');
    const feedbackNameModeAnon = document.getElementById('feedbackNameModeAnon');
    const feedbackCategory = document.getElementById('feedbackCategory');
    const feedbackMessage = document.getElementById('feedbackMessage');
    const feedbackImageFile = document.getElementById('feedbackImageFile');
    const feedbackCancel = document.getElementById('feedbackCancel');
    const feedbackSubmit = document.getElementById('feedbackSubmit');
    const feedbackSuccessClose = document.getElementById('feedbackSuccessClose');

    function resetFeedbackForm() {
      const accountName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
      /* Ohne Account ergibt "Eigenen Ingame-Namen verwenden" keinen Sinn -
         dann bleibt nur Anonym, die Auswahl wird ausgeblendet statt einen
         leeren Namen zu erlauben. */
      if (feedbackNameToggle) feedbackNameToggle.style.display = accountName ? '' : 'none';
      if (feedbackNameModeName) feedbackNameModeName.checked = Boolean(accountName);
      if (feedbackNameModeAnon) feedbackNameModeAnon.checked = !accountName;
      if (feedbackCategory) feedbackCategory.value = 'idee';
      if (feedbackMessage) feedbackMessage.value = '';
      if (feedbackImageFile) feedbackImageFile.value = '';
      feedbackFormView.style.display = '';
      feedbackSuccessView.style.display = 'none';
    }

    if (feedbackButton) feedbackButton.addEventListener('click', () => {
      resetFeedbackForm();
      feedbackOverlay.classList.add('visible');
    });
    /* Bug-Fix 18.07.: zweiter Zugang direkt im Idle-Dorf-Fenster (siehe
       ausfuehrlichen Kommentar bei #idleDorfFeedbackBtn in index.html) -
       oeffnet denselben #feedbackOverlay ueber dieselbe resetFeedbackForm(),
       keine eigene Logik. */
    const idleDorfFeedbackBtn = document.getElementById('idleDorfFeedbackBtn');
    if (idleDorfFeedbackBtn) idleDorfFeedbackBtn.addEventListener('click', () => {
      resetFeedbackForm();
      feedbackOverlay.classList.add('visible');
    });
    if (feedbackCancel) feedbackCancel.addEventListener('click', () => feedbackOverlay.classList.remove('visible'));
    if (feedbackSuccessClose) feedbackSuccessClose.addEventListener('click', () => feedbackOverlay.classList.remove('visible'));

    if (feedbackSubmit) feedbackSubmit.addEventListener('click', () => {
      const message = feedbackMessage.value.trim();
      if (!message) {
        alert('Bitte schreib uns eine Nachricht.');
        return;
      }
      const cooldown = bkmpSubmitCooldownSecondsLeft('feedback');
      if (cooldown > 0) { alert(`Bitte warte noch ${cooldown} Sekunde(n), bevor du erneut sendest.`); return; }

      const accountName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
      const useOwnName = Boolean(feedbackNameModeName && feedbackNameModeName.checked && accountName);
      const name = useOwnName ? accountName : '';
      const category = feedbackCategory.value || 'sonstiges';
      const file = feedbackImageFile.files && feedbackImageFile.files[0];

      feedbackSubmit.disabled = true;
      feedbackSubmit.textContent = 'Wird gesendet...';

      function resetSubmitBtn() {
        feedbackSubmit.disabled = false;
        feedbackSubmit.textContent = 'Absenden';
      }

      function doSubmit(imageDataUrl) {
        bkmpSubmitViaApi('feedback', { name, category, message }, imageDataUrl || null).then(() => {
          bkmpStartSubmitCooldown('feedback');
          bkmpIncrementFeedbackCount(category);
          resetSubmitBtn();
          feedbackFormView.style.display = 'none';
          feedbackSuccessView.style.display = '';
        }).catch(e => {
          console.error('Feedback konnte nicht gesendet werden.', e);
          resetSubmitBtn();
          alert('Dein Feedback konnte nicht gesendet werden: ' + (e && e.message || e) + '\n\nBitte versuche es erneut.');
        });
      }

      if (file) {
        bkmpCompressImageFile(file).then(doSubmit).catch(() => {
          resetSubmitBtn();
          alert('Das Bild konnte nicht gelesen werden. Bitte versuche es mit einer anderen Datei erneut.');
        });
      } else {
        doSubmit(null);
      }
    });

    /* ---------------- Investoren-Anfrage ---------------- */
    const investorRequestOverlay = document.getElementById('investorRequestOverlay');
    const investorRequestFormView = document.getElementById('investorRequestFormView');
    const investorRequestSuccessView = document.getElementById('investorRequestSuccessView');
    const openInvestorRequestForm = document.getElementById('openInvestorRequestForm');
    const investorRequestCancel = document.getElementById('investorRequestCancel');
    const investorRequestClose = document.getElementById('investorRequestClose');
    const investorRequestSubmit = document.getElementById('investorRequestSubmit');
    const investorRequestName = document.getElementById('investorRequestName');
    const investorRequestMinecraftName = document.getElementById('investorRequestMinecraftName');
    const investorRequestAmount = document.getElementById('investorRequestAmount');
    const investorRequestPeriod = document.getElementById('investorRequestPeriod');
    const investorRequestAnonymous = document.getElementById('investorRequestAnonymous');
    const investorRequestSharePreview = document.getElementById('investorRequestSharePreview');

    function resetInvestorRequestForm() {
      investorRequestName.value = '';
      investorRequestMinecraftName.value = '';
      investorRequestAmount.value = '';
      investorRequestPeriod.value = '1';
      investorRequestAnonymous.checked = false;
      investorRequestSharePreview.textContent = '–';
      investorRequestFormView.style.display = '';
      investorRequestSuccessView.style.display = 'none';
    }

    function updateInvestorRequestSharePreview() {
      const amount = Number(investorRequestAmount.value);
      if (!investorRequestAmount.value || Number.isNaN(amount)) {
        investorRequestSharePreview.textContent = '–';
        return;
      }
      const clamped = Math.min(BKMP_INVESTOR_REQUEST_MAX, Math.max(BKMP_INVESTOR_REQUEST_MIN, amount));
      const share = bkmpCalcInvestorSharePercent(clamped);
      investorRequestSharePreview.textContent = share.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' %';
    }

    if (investorRequestAmount) {
      investorRequestAmount.addEventListener('input', updateInvestorRequestSharePreview);
    }

    if (openInvestorRequestForm) {
      openInvestorRequestForm.addEventListener('click', () => {
        resetInvestorRequestForm();
        investorRequestOverlay.classList.add('visible');
      });
    }
    if (investorRequestCancel) investorRequestCancel.addEventListener('click', () => investorRequestOverlay.classList.remove('visible'));
    if (investorRequestClose) investorRequestClose.addEventListener('click', () => investorRequestOverlay.classList.remove('visible'));

    if (investorRequestSubmit) {
      investorRequestSubmit.addEventListener('click', () => {
        const name = investorRequestName.value.trim();
        if (!name) { investorRequestName.reportValidity(); return; }
        const amount = Number(investorRequestAmount.value);
        if (!investorRequestAmount.value || Number.isNaN(amount) || amount < BKMP_INVESTOR_REQUEST_MIN || amount > BKMP_INVESTOR_REQUEST_MAX) {
          investorRequestAmount.reportValidity();
          return;
        }
        const periodMonths = Number(investorRequestPeriod.value);
        const sharePercent = bkmpCalcInvestorSharePercent(amount);
        const minecraftName = investorRequestMinecraftName.value.trim();
        const anonymous = investorRequestAnonymous.checked;
        const request = { name, minecraftName, anonymous, amount, sharePercent, periodMonths };

        const cooldown = bkmpSubmitCooldownSecondsLeft('investorrequest');
        if (cooldown > 0) { alert(`Bitte warte noch ${cooldown} Sekunde(n), bevor du erneut einreichst.`); return; }

        investorRequestSubmit.disabled = true;
        investorRequestSubmit.textContent = 'Wird gesendet...';

        function resetSubmitBtn() {
          investorRequestSubmit.disabled = false;
          investorRequestSubmit.textContent = 'Anfrage senden';
        }

        if (typeof saveInvestorRequest === 'function' && bkmpGetSupabaseClient()) {
          saveInvestorRequest(request).then(id => {
            bkmpStartSubmitCooldown('investorrequest');
            resetSubmitBtn();
            if (id && typeof bkmpAddPendingRequestId === 'function') bkmpAddPendingRequestId(BKMP_PENDING_INVESTOR_KEY, id);
            investorRequestFormView.style.display = 'none';
            investorRequestSuccessView.style.display = '';
          }).catch(e => {
            console.error('Investoren-Anfrage konnte nicht gesendet werden.', e);
            resetSubmitBtn();
            alert('Deine Anfrage konnte nicht gesendet werden. Bitte versuche es später erneut.');
          });
        } else {
          resetSubmitBtn();
          alert('Deine Anfrage konnte gerade nicht gesendet werden, da keine Verbindung zur Datenbank besteht.');
        }
      });
    }

    /* ---------------- Anfrage-Entscheidung: 1x-Popup-Benachrichtigung (23.07.) ----------------
       Nutzerwunsch: Absender einer Kartenverkaufs-/Investoren-Anfrage sollen
       erfahren, ob bestätigt/abgelehnt wurde, sobald sie wieder auf der
       Seite sind - als einmaliges Popup. Beide Anfrage-Tabellen sind per
       RLS bewusst NICHT oeffentlich lesbar (nur is_active_admin(), siehe
       jeweilige *-schema.sql) und die Einreichung selbst ist komplett
       anonym (nur Minecraft-Name/Discord, kein Account) - es gibt also
       keinen Server-seitigen Weg, "wer bin ich" zu wissen. Stattdessen:
       die ID der eigenen Anfrage wird beim Einreichen lokal gemerkt (siehe
       bkmpAddPendingRequestId-Aufrufe an den beiden Einreichungs-Stellen
       oben), und bei jedem Seitenaufruf ueber eine enge, nur genau diese
       eine ID beantwortende RPC (get_card_sale_request_status/
       get_investor_request_status, siehe supabase.js + sql/20260723-
       request-decision-notify.sql) nachgefragt, ob inzwischen entschieden
       wurde. Rein client-seitig (localStorage) - ein anderes Geraet/ein
       geleerter Browser-Speicher kann die Benachrichtigung nicht mehr
       zustellen, dieselbe Einschraenkung wie bei jeder anonymen Anfrage
       ohne Account-Bindung. */
    const BKMP_PENDING_CARD_SALE_KEY = 'bkmp-pending-card-sale-requests';
    const BKMP_PENDING_INVESTOR_KEY = 'bkmp-pending-investor-requests';

    function bkmpGetPendingRequestIds(key) {
      try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
    }
    function bkmpAddPendingRequestId(key, id) {
      if (!id) return;
      const ids = bkmpGetPendingRequestIds(key);
      if (ids.includes(id)) return;
      ids.push(id);
      try { localStorage.setItem(key, JSON.stringify(ids)); } catch (e) {}
    }
    function bkmpRemovePendingRequestId(key, id) {
      const ids = bkmpGetPendingRequestIds(key).filter(x => x !== id);
      try { localStorage.setItem(key, JSON.stringify(ids)); } catch (e) {}
    }

    /* Nacheinander statt gleichzeitig, falls ein Besucher mehrere offene
       Anfragen hatte, die alle in derselben Sitzung entschieden wurden. */
    let bkmpRequestDecisionQueue = [];
    function bkmpQueueRequestDecisionPopup(titleText, bodyText, kind) {
      bkmpRequestDecisionQueue.push({ titleText, bodyText, kind });
      if (bkmpRequestDecisionQueue.length === 1) bkmpShowNextRequestDecisionPopup();
    }
    function bkmpShowNextRequestDecisionPopup() {
      const next = bkmpRequestDecisionQueue[0];
      if (!next) return;
      bkmpShowRequestDecisionPopup(next.titleText, next.bodyText, next.kind);
    }
    function bkmpShowRequestDecisionPopup(titleText, bodyText, kind) {
      const domId = 'bkmpRequestDecision';
      const stale = document.getElementById(domId + 'Overlay');
      if (stale) stale.remove();
      const html = typeof bkmpUiModalHtml === 'function' ? bkmpUiModalHtml({
        id: domId,
        titleHtml: escapeHtml(titleText),
        bodyHtml: `<p style="white-space:pre-line; line-height:1.5;">${escapeHtml(bodyText)}</p>`,
        buttonsHtml: `<button type="button" class="btn-ja" id="${domId}CloseBtn">Verstanden</button>`,
        extraClass: kind === 'success' ? 'bkmp-request-decision-success' : 'bkmp-request-decision-rejected'
      }) : '';
      if (!html) return;
      document.body.insertAdjacentHTML('beforeend', html);
      const overlay = document.getElementById(domId + 'Overlay');
      if (!overlay) return;
      if (typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));
      function close() {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 300);
        bkmpRequestDecisionQueue.shift();
        bkmpShowNextRequestDecisionPopup();
      }
      const closeBtn = document.getElementById(domId + 'CloseBtn');
      if (closeBtn) closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    }

    const BKMP_CARD_SALE_ACCEPT_TEXT = 'Deine Verkaufsanfrage wurde angenommen!\n\nPacke 10 Bundles zusammen und kontaktiere ChronoKora/ChronoYaksha Ingame.';
    const BKMP_CARD_SALE_REJECT_TEXT = 'Deine Verkaufsanfrage wurde leider abgelehnt.';
    const BKMP_INVESTOR_ACCEPT_TEXT = 'Deine Investoren-Anfrage wurde angenommen!\n\nZahle das Geld an ChronoKora/ChronoYaksha (CB1).';
    const BKMP_INVESTOR_REJECT_TEXT = 'Deine Investoren-Anfrage wurde leider abgelehnt.';

    async function bkmpCheckPendingRequestDecisions() {
      if (!bkmpGetSupabaseClient()) return;
      const cardIds = bkmpGetPendingRequestIds(BKMP_PENDING_CARD_SALE_KEY);
      for (const id of cardIds) {
        try {
          const status = typeof getCardSaleRequestStatus === 'function' ? await getCardSaleRequestStatus(id) : null;
          if (status === 'confirmed') {
            bkmpQueueRequestDecisionPopup('🎉 Verkaufsanfrage angenommen', BKMP_CARD_SALE_ACCEPT_TEXT, 'success');
            bkmpRemovePendingRequestId(BKMP_PENDING_CARD_SALE_KEY, id);
          } else if (status === 'rejected') {
            bkmpQueueRequestDecisionPopup('Verkaufsanfrage abgelehnt', BKMP_CARD_SALE_REJECT_TEXT, 'rejected');
            bkmpRemovePendingRequestId(BKMP_PENDING_CARD_SALE_KEY, id);
          }
        } catch (e) { console.warn('Status der Verkaufsanfrage konnte nicht geprüft werden.', e); }
      }
      const investorIds = bkmpGetPendingRequestIds(BKMP_PENDING_INVESTOR_KEY);
      for (const id of investorIds) {
        try {
          const result = typeof getInvestorRequestStatus === 'function' ? await getInvestorRequestStatus(id) : null;
          if (result && result.status === 'confirmed') {
            bkmpQueueRequestDecisionPopup('🎉 Investoren-Anfrage angenommen', BKMP_INVESTOR_ACCEPT_TEXT, 'success');
            bkmpRemovePendingRequestId(BKMP_PENDING_INVESTOR_KEY, id);
          } else if (result && result.status === 'rejected') {
            const text = result.rejectReason ? (BKMP_INVESTOR_REJECT_TEXT + '\n\nBegründung: ' + result.rejectReason) : BKMP_INVESTOR_REJECT_TEXT;
            bkmpQueueRequestDecisionPopup('Investoren-Anfrage abgelehnt', text, 'rejected');
            bkmpRemovePendingRequestId(BKMP_PENDING_INVESTOR_KEY, id);
          }
        } catch (e) { console.warn('Status der Investoren-Anfrage konnte nicht geprüft werden.', e); }
      }
    }

    /* ---------------- MC-Name Identity + Erfolge ---------------- */
    const BKMP_MC_NAME_KEY = 'bkmp-mc-name';
    const BKMP_TIME_SPENT_KEY = 'bkmp-time-spent-ms';
    const BKMP_EGGS_FOUND_KEY = 'bkmp-eggs-found';
    const BKMP_DAYS_VISITED_KEY = 'bkmp-days-visited';
    const BKMP_FLAGS_KEY = 'bkmp-flags';
    const BKMP_PANEL_OPENS_KEY = 'bkmp-panel-opens';

    function bkmpGetMcName() {
      try { return (localStorage.getItem(BKMP_MC_NAME_KEY) || '').trim(); } catch (e) { return ''; }
    }
    function bkmpSetMcName(name) {
      try { localStorage.setItem(BKMP_MC_NAME_KEY, name); } catch (e) {}
    }
    function bkmpGetEggsFound() {
      try { return JSON.parse(localStorage.getItem(BKMP_EGGS_FOUND_KEY) || '[]'); } catch (e) { return []; }
    }
    function bkmpMarkEggFound(id) {
      const found = bkmpGetEggsFound();
      if (found.includes(id)) return;
      found.push(id);
      try { localStorage.setItem(BKMP_EGGS_FOUND_KEY, JSON.stringify(found)); } catch (e) {}
      renderAchievementBadge();
    }
    function bkmpGetTimeSpentMinutes() {
      let ms = 0;
      try { ms = Number(localStorage.getItem(BKMP_TIME_SPENT_KEY) || 0); } catch (e) {}
      return Math.floor(ms / 60000);
    }
    function bkmpGetDaysVisited() {
      try { return JSON.parse(localStorage.getItem(BKMP_DAYS_VISITED_KEY) || '[]'); } catch (e) { return []; }
    }
    function bkmpTrackDayVisited() {
      const today = new Date().toISOString().slice(0, 10);
      const days = bkmpGetDaysVisited();
      if (days.includes(today)) return;
      days.push(today);
      try { localStorage.setItem(BKMP_DAYS_VISITED_KEY, JSON.stringify(days)); } catch (e) {}
    }
    function bkmpGetFlags() {
      try { return JSON.parse(localStorage.getItem(BKMP_FLAGS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function bkmpSetFlag(name) {
      const flags = bkmpGetFlags();
      if (flags[name]) return;
      flags[name] = true;
      try { localStorage.setItem(BKMP_FLAGS_KEY, JSON.stringify(flags)); } catch (e) {}
    }
    /* Wie bkmpSetFlag, aber fuer beliebige Werte (Zahlen usw.) statt nur
       true/false - genutzt fuer den Schaf-Zitat-Streak (sheepStreakBest).
       flags wird schon komplett remote gesynct (siehe bkmpSyncPlayerStats/
       bkmpMergeRemoteStatsIntoLocal), also bekommt der Streak dadurch ohne
       eigene DB-Spalte/Sync-Code kostenlos Geraete-Uebergreifenheit. */
    function bkmpSetFlagValue(name, value) {
      const flags = bkmpGetFlags();
      flags[name] = value;
      try { localStorage.setItem(BKMP_FLAGS_KEY, JSON.stringify(flags)); } catch (e) {}
    }
    function bkmpLocalDateStr(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function bkmpGetSheepStreakBest() {
      return Number(bkmpGetFlags().sheepStreakBest || 0);
    }
    /* Zaehlt einen Schaf-Klick fuer den taeglichen "Zitat des Tages"-Streak -
       nur wenn es lokal schon nach 12 Uhr ist UND heute noch nicht gezaehlt
       wurde (ein Klick pro Tag reicht/zaehlt). Ein ausgelassener Tag setzt
       den AKTUELLEN Streak auf 1 zurueck, der fuer Erfolge genutzte
       sheepStreakBest sinkt aber NIE - alle Erfolge auf dieser Seite werden
       live aus dem aktuellen Wert neu berechnet (siehe renderAchievementsPanel:
       a.check(ctx)), ein sinkender Wert wuerde also bereits freigeschaltete
       Erfolge optisch wieder sperren. */
    function bkmpTrackSheepQuoteClick() {
      const now = new Date();
      if (now.getHours() < 12) return;
      const today = bkmpLocalDateStr(now);
      const flags = bkmpGetFlags();
      if (flags.sheepLastQuoteDate === today) return;
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const current = flags.sheepLastQuoteDate === bkmpLocalDateStr(yesterday) ? Number(flags.sheepStreakCurrent || 0) + 1 : 1;
      bkmpSetFlagValue('sheepStreakCurrent', current);
      bkmpSetFlagValue('sheepLastQuoteDate', today);
      if (current > Number(flags.sheepStreakBest || 0)) bkmpSetFlagValue('sheepStreakBest', current);
      if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
    }
    function bkmpTrackTimeBasedFlags() {
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay();
      if (hour >= 0 && hour < 5) bkmpSetFlag('nightOwl');
      if (hour >= 5 && hour < 7) bkmpSetFlag('earlyBird');
      if (day === 6) bkmpSetFlag('visitedSaturday');
      if (day === 0) bkmpSetFlag('visitedSunday');
    }
    function bkmpTrackPanelOpen() {
      let count = 0;
      try { count = Number(localStorage.getItem(BKMP_PANEL_OPENS_KEY) || 0); } catch (e) {}
      count += 1;
      try { localStorage.setItem(BKMP_PANEL_OPENS_KEY, String(count)); } catch (e) {}
      return count;
    }
    function bkmpGetPanelOpens() {
      try { return Number(localStorage.getItem(BKMP_PANEL_OPENS_KEY) || 0); } catch (e) { return 0; }
    }

    let bkmpLastStatsSyncAt = 0;
    /* Architektur-Entscheidung (nach mehreren Einzelfall-Fixes, die immer
       wieder an NEUEN Aufrufstellen erneut auftraten): der 45s-Throttle
       gilt ab sofort NUR NOCH fuer "nichts Neues zu berichten"-Aufrufe
       (kleine Nebenfelder wie minutesSpent/panelOpens/bonkCount auffrischen).
       Sobald der frisch beim Server abgefragte Erfolge-Stand NIEDRIGER ist
       als das, was dieses Geraet gerade berechnet hat, wird SOFORT
       hochgeladen, egal wie lange der letzte Sync her ist - eine echte
       Korrektur/Verbesserung darf nie durch Throttling verzoegert werden.
       Vorher musste jede der drei Hintergrund-Ladequellen (Pluschies,
       Idle-Dorf, Raid-Statistiken) einzeln daran denken, ihren
       renderAchievementBadge()-Aufruf mit force=true zu markieren - das ist
       dreimal unabhaengig voneinander vergessen worden. Jetzt entscheidet
       die Funktion selbst anhand der Zahlen, nicht die Aufrufer. */
    async function bkmpSyncPlayerStats(unlockedCount, force) {
      const name = bkmpGetMcName();
      if (!name || typeof upsertPlayerStats !== 'function' || !bkmpGetSupabaseClient()) return null;
      let safeUnlockedCount = unlockedCount;
      let isRealImprovement = false;
      try {
        if (typeof loadPlayerAchievementsUnlockedByName === 'function') {
          const currentRemote = await loadPlayerAchievementsUnlockedByName(name);
          safeUnlockedCount = Math.max(unlockedCount, currentRemote);
          isRealImprovement = unlockedCount > currentRemote;
        }
      } catch (e) { /* Frisch-Check fehlgeschlagen - mit dem lokalen Wert weitermachen, normalem Throttle unterwerfen */ }
      const now = Date.now();
      if (!force && !isRealImprovement && now - bkmpLastStatsSyncAt < 45000) return null;
      bkmpLastStatsSyncAt = now;
      return upsertPlayerStats(name, {
        minutesSpent: bkmpGetTimeSpentMinutes(),
        achievementsUnlocked: safeUnlockedCount,
        eggsFound: bkmpGetEggsFound(),
        daysVisited: bkmpGetDaysVisited(),
        flags: bkmpGetFlags(),
        panelOpens: bkmpGetPanelOpens(),
        activeTitle: typeof bkmpGetActiveTitleName === 'function' ? bkmpGetActiveTitleName() : '',
        activeCosmetic: bkmpGetActiveCosmetic(),
        bonkCount: bkmpGetBonkCount(),
        activePlushie: typeof bkmpGetActivePlushie === 'function' ? bkmpGetActivePlushie() : '',
        achievementUnlocks: bkmpGetAchievementUnlockedAtMap()
      }).catch(e => console.warn('Konnte Erfolge/Zeit nicht mit dem Leaderboard synchronisieren.', e));
    }
    /* Erzwingt eine sofortige Synchronisierung ohne den 45s-Throttle -
       gebraucht vom Single-Session-Rauswurf, damit z.B. ein gerade erst
       gewaehlter Titel/Kosmetik nicht verloren geht, nur weil der letzte
       normale Sync noch keine 45s her ist. */
    async function bkmpSyncPlayerStatsNow() {
      const ctx = typeof bkmpAchievementContextWithMeta === 'function' ? bkmpAchievementContextWithMeta() : null;
      const unlockedCount = ctx ? BKMP_ACHIEVEMENTS.filter(a => bkmpAchievementUnlocked(a, ctx)).length : 0;
      return (await bkmpSyncPlayerStats(unlockedCount, true)) || Promise.resolve();
    }

    /* Beim Namen-Eintragen: bestehenden Fortschritt fuer diesen Namen von
       Supabase holen und mit dem lokalen Fortschritt zusammenfuehren, damit
       PC und Handy denselben Stand zeigen (nimmt jeweils das Bessere/mehr). */
    async function bkmpMergeRemoteStatsIntoLocal(name) {
      if (typeof loadPlayerStatsByName !== 'function' || !bkmpGetSupabaseClient()) return name;
      try {
        const remote = await loadPlayerStatsByName(name);
        if (!remote) return name;

        const localMinutes = bkmpGetTimeSpentMinutes();
        const mergedMinutes = Math.max(localMinutes, remote.minutesSpent || 0);
        try { localStorage.setItem(BKMP_TIME_SPENT_KEY, String(mergedMinutes * 60000)); } catch (e) {}

        const localEggs = bkmpGetEggsFound();
        const mergedEggs = [...new Set([...localEggs, ...(remote.eggsFound || [])])];
        try { localStorage.setItem(BKMP_EGGS_FOUND_KEY, JSON.stringify(mergedEggs)); } catch (e) {}

        const localDays = bkmpGetDaysVisited();
        const mergedDays = [...new Set([...localDays, ...(remote.daysVisited || [])])];
        try { localStorage.setItem(BKMP_DAYS_VISITED_KEY, JSON.stringify(mergedDays)); } catch (e) {}

        const localFlags = bkmpGetFlags();
        const mergedFlags = { ...localFlags, ...(remote.flags || {}) };
        /* sheepStreakBest ist ein monoton wachsender Zaehler wie bonkCount/
           panelOpens unten - "remote gewinnt" (siehe Zeile drueber) waere
           hier falsch, ein aelterer/niedrigerer Remote-Stand duerfte den
           lokal schon erreichten Bestwert nie herabsetzen. */
        mergedFlags.sheepStreakBest = Math.max(Number(localFlags.sheepStreakBest || 0), Number((remote.flags || {}).sheepStreakBest || 0));
        try { localStorage.setItem(BKMP_FLAGS_KEY, JSON.stringify(mergedFlags)); } catch (e) {}

        const mergedPanelOpens = Math.max(bkmpGetPanelOpens(), remote.panelOpens || 0);
        try { localStorage.setItem(BKMP_PANEL_OPENS_KEY, String(mergedPanelOpens)); } catch (e) {}

        const mergedBonkCount = Math.max(bkmpGetBonkCount(), remote.bonkCount || 0);
        bkmpSetBonkCount(mergedBonkCount);
        if (typeof bkmpUpdateBonkBadge === 'function') bkmpUpdateBonkBadge(mergedBonkCount);

        /* Zeitstempel zusammenfuehren: pro Erfolg gewinnt der FRUEHERE
           Zeitpunkt (das ist der echte Freischalt-Moment, egal auf welchem
           Geraet er zuerst erkannt wurde). */
        const localUnlockedAt = bkmpGetAchievementUnlockedAtMap();
        const remoteUnlockedAt = remote.achievementUnlocks || {};
        const mergedUnlockedAt = { ...localUnlockedAt };
        Object.keys(remoteUnlockedAt).forEach(id => {
          if (!mergedUnlockedAt[id] || new Date(remoteUnlockedAt[id]) < new Date(mergedUnlockedAt[id])) {
            mergedUnlockedAt[id] = remoteUnlockedAt[id];
          }
        });
        try { localStorage.setItem(BKMP_ACHIEVEMENTS_UNLOCKED_AT_KEY, JSON.stringify(mergedUnlockedAt)); } catch (e) {}

        /* Immer den Server-Stand uebernehmen (nicht nur wenn lokal noch
           nichts gewaehlt war) - vorher blieb ein Geraet, das schon MAL
           einen Titel/Kosmetik/Plushie gewaehlt hatte, fuer immer auf
           diesem alten Stand haengen, selbst wenn auf einem anderen Geraet
           laengst etwas Neues aktiviert wurde (siehe Screenshot-Report:
           PC zeigte "Der Geduldige", Handy weiterhin "Nachtschwärmer").
           Jetzt, wo per Single-Session (siehe bkmpClaimAndWatchSession)
           ohnehin immer nur ein Geraet gleichzeitig aktiv ist und dessen
           Stand beim Rauswurf zuverlaessig weggeschrieben wird (siehe
           bkmpSyncPlayerStatsNow), ist der Server-Stand hier vertrauenswuerdig
           genug, um bedenkenlos zu gewinnen. */
        if (remote.activeTitle) {
          const remoteTitle = BKMP_TITLES.find(t => t.name === remote.activeTitle);
          if (remoteTitle) { try { localStorage.setItem(BKMP_ACTIVE_TITLE_KEY, remoteTitle.id); } catch (e) {} }
        }

        if (remote.activeCosmetic) {
          const remoteCosmetic = BKMP_COSMETICS.find(c => c.id === remote.activeCosmetic);
          if (remoteCosmetic) { try { localStorage.setItem(BKMP_ACTIVE_COSMETIC_KEY, remoteCosmetic.id); } catch (e) {} }
        }

        if (remote.activePlushie) {
          const remotePlushie = BKMP_PLUSHIES.find(p => p.id === remote.activePlushie);
          if (remotePlushie) { try { localStorage.setItem(BKMP_ACTIVE_PLUSHIE_KEY, remotePlushie.id); } catch (e) {} }
        }

        return remote.name || name;
      } catch (e) {
        console.warn('Konnte bestehenden Fortschritt nicht laden.', e);
        return name;
      }
    }

    /* ---------------- Nur ein aktives Geraet gleichzeitig (siehe
       supabase-single-session.sql) ----------------
       Bei jedem Login/Session-Wiederherstellen beansprucht dieses Geraet
       eine frische, zufaellige Kennung (player_stats.active_session_token).
       Alle 20s wird geprueft, ob diese Kennung noch die aktuelle ist - falls
       inzwischen anderswo eingeloggt wurde, hat der Server eine NEUE
       Kennung, dieses Geraet erkennt den Unterschied und loggt sich selbst
       aus ("neuestes Login gewinnt", kein Blockieren des neuen Geraets). */
    /* Bug-Fix (Spieler-Meldung FlinkerBoy7289, 16.07.: "Ich werde die ganze
       Zeit ausgeloggt ohne dass ich Cookies loesche"): bkmpClaimAndWatchSession
       wurde bisher bei JEDEM Seiten-Laden aufgerufen, das eine bestehende
       Session wiederherstellt (nicht nur bei einem echten Neu-Login) - jeder
       Aufruf hat die geteilte player_stats.active_session_token-Spalte
       unbedingt ueberschrieben. Da die Player-Auth-Session in einem einzigen,
       browserweit geteilten localStorage-Schluessel liegt (siehe
       bkmpGetPlayerAuthClient), fuehrte JEDES zweite Tab/ein vom Betriebs-
       system neu geladenes Hintergrund-Tab desselben Geraets zu einem
       Wettlauf: beide beanspruchten abwechselnd dieselbe Kennung neu, das
       jeweils "verlierende" Tab erkannte die eigene (gerade ueberschriebene)
       Kennung als veraltet und warf sich selbst per GLOBALEM signOut() raus -
       das loescht die Session serverseitig UND im geteilten localStorage,
       reisst also auch andere, eigentlich noch gueltige Tabs mit. Jetzt: nur
       ein ECHTER Neu-Login (isNewLogin=true) beansprucht die Kennung serverseitig
       neu; eine reine Session-Wiederherstellung uebernimmt stattdessen die
       bereits lokal gemerkte eigene Kennung (bkmp-my-session-token, derselbe
       geteilte localStorage wie die Auth-Session selbst) - alle Tabs/Reloads
       desselben Geraets landen so auf derselben Kennung und stossen sich nie
       gegenseitig aus. Ein WIRKLICH anderes Geraet ueberschreibt die Server-
       Kennung weiterhin korrekt und loest den Rauswurf wie gewollt aus. */
    const BKMP_MY_SESSION_TOKEN_KEY = 'bkmp-my-session-token';
    function bkmpGetStoredSessionToken() {
      try { return localStorage.getItem(BKMP_MY_SESSION_TOKEN_KEY) || null; } catch (e) { return null; }
    }
    function bkmpSetStoredSessionToken(token) {
      try {
        if (token) localStorage.setItem(BKMP_MY_SESSION_TOKEN_KEY, token);
        else localStorage.removeItem(BKMP_MY_SESSION_TOKEN_KEY);
      } catch (e) {}
    }
    let bkmpMySessionToken = null;
    let bkmpSessionWatchInterval = null;
    function bkmpStopSessionWatch() {
      if (bkmpSessionWatchInterval) { window.clearInterval(bkmpSessionWatchInterval); bkmpSessionWatchInterval = null; }
      bkmpMySessionToken = null;
      bkmpSetStoredSessionToken(null);
    }
    async function bkmpClaimAndWatchSession(name, isNewLogin) {
      if (!name) return;
      try {
        if (isNewLogin || !bkmpGetStoredSessionToken()) {
          if (typeof claimActiveSession !== 'function') return;
          bkmpMySessionToken = await claimActiveSession(name);
          bkmpSetStoredSessionToken(bkmpMySessionToken);
        } else {
          bkmpMySessionToken = bkmpGetStoredSessionToken();
        }
      } catch (e) {
        console.warn('Sitzungs-Kennung konnte nicht gesetzt werden (Migration evtl. noch nicht ausgefuehrt).', e);
        return;
      }
      if (!bkmpMySessionToken) return;
      if (bkmpSessionWatchInterval) window.clearInterval(bkmpSessionWatchInterval);
      bkmpSessionWatchInterval = window.setInterval(async () => {
        if (!bkmpMySessionToken || typeof checkActiveSessionToken !== 'function') return;
        try {
          const currentToken = await checkActiveSessionToken(name);
          if (currentToken && currentToken !== bkmpMySessionToken) {
            bkmpStopSessionWatch();
            /* Vor dem Rauswurf noch offene Idle-Dorf-/Prestige-Speicherungen
               erzwingen - sonst koennten die letzten paar Sekunden Fortschritt
               (Debounce-Timer von 4s bzw. 1,5s) verloren gehen, weil die Seite
               gleich neu laedt. */
            try { if (typeof bkmpIdleFlushSyncNow === 'function') await bkmpIdleFlushSyncNow(); } catch (e2) {}
            try { if (typeof bkmpPrestigeFlushSyncNow === 'function') await bkmpPrestigeFlushSyncNow(); } catch (e2) {}
            try { await bkmpSyncPlayerStatsNow(); } catch (e2) {}
            alert('Du wurdest auf einem anderen Gerät angemeldet. Diese Sitzung wird jetzt beendet.');
            try { await bkmpPlayerLogout(); } catch (e2) {}
            bkmpSetMcName('');
            window.location.reload();
          }
        } catch (e) { /* Netzwerkfehler beim Pruefen - naechster Versuch in 20s */ }
      }, 20000);
    }

    bkmpTrackDayVisited();
    bkmpTrackTimeBasedFlags();
    bkmpCheckPendingRequestDecisions();

    let bkmpTimeTrackStart = document.visibilityState === 'visible' ? Date.now() : null;
    function bkmpFlushTimeSpent() {
      if (bkmpTimeTrackStart === null) return;
      const elapsed = Date.now() - bkmpTimeTrackStart;
      let total = 0;
      try { total = Number(localStorage.getItem(BKMP_TIME_SPENT_KEY) || 0); } catch (e) {}
      total += elapsed;
      try { localStorage.setItem(BKMP_TIME_SPENT_KEY, String(total)); } catch (e) {}
      bkmpTimeTrackStart = Date.now();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        bkmpFlushTimeSpent();
        bkmpTimeTrackStart = null;
      } else {
        bkmpTimeTrackStart = Date.now();
        bkmpTrackDayVisited();
        bkmpTrackTimeBasedFlags();
      }
    });
    window.addEventListener('beforeunload', bkmpFlushTimeSpent);
    window.setInterval(() => { bkmpFlushTimeSpent(); bkmpTrackTimeBasedFlags(); renderAchievementBadge(); }, 30000);

    function bkmpBuildAchievementContext() {
      const name = bkmpGetMcName().toLowerCase();
      const myCards = name ? (data.cardCatalog || []).filter(item => (item.submittedBy || '').trim().toLowerCase() === name) : [];
      const cardCount = myCards.length;
      const wishCount = name ? (data.wishes || []).filter(item => (item.name || '').trim().toLowerCase() === name).length : 0;
      const categoryDiversity = new Set(myCards.map(item => (item.category || '').trim().toLowerCase()).filter(Boolean)).size;
      const isInvestor = name ? (data.investors || []).some(inv => (inv.name || '').trim().toLowerCase() === name || (inv.minecraftName || '').trim().toLowerCase() === name) : false;
      const flags = bkmpGetFlags();
      return {
        hasName: Boolean(name),
        cardCount,
        wishCount,
        categoryDiversity,
        minutesSpent: bkmpGetTimeSpentMinutes(),
        daysVisited: bkmpGetDaysVisited().length,
        eggsFound: bkmpGetEggsFound(),
        isInvestor,
        nightOwl: Boolean(flags.nightOwl),
        earlyBird: Boolean(flags.earlyBird),
        weekendBoth: Boolean(flags.visitedSaturday && flags.visitedSunday),
        panelOpens: bkmpGetPanelOpens(),
        derLiberFound: bkmpGetDerLiberFound().length,
        bonkCount: bkmpGetBonkCount(),
        ownedPlushies: bkmpOwnedPlushies,
        dailyEventWins: bkmpGetDailyEventWins(),
        wonGoldenHour: bkmpGetWonGoldenHour(),
        streamersClicked: bkmpGetStreamersClicked(),
        sheepStreak: bkmpGetSheepStreakBest(),
        feedbackLobCount: bkmpGetFeedbackCount('lob'),
        feedbackKritikCount: bkmpGetFeedbackCount('kritik'),
        feedbackIdeeCount: bkmpGetFeedbackCount('idee'),
        feedbackSonstigesCount: bkmpGetFeedbackCount('sonstiges'),
        ...(typeof bkmpIdleGetAchievementContextFields === 'function' ? bkmpIdleGetAchievementContextFields() : {}),
        ...(typeof bkmpRaidGetAchievementContextFields === 'function' ? bkmpRaidGetAchievementContextFields() : {}),
        ...(typeof bkmpArenaGetAchievementContextFields === 'function' ? bkmpArenaGetAchievementContextFields() : {}),
        ...(typeof bkmpGuildGetAchievementContextFields === 'function' ? bkmpGuildGetAchievementContextFields() : {})
      };
    }
    /* Daily-Code-Event-Gewinne: lokal gecacht (wird bei Sieg gesetzt, siehe
       Daily-Event-Abschnitt weiter unten), fuer Titel/Erfolge nutzbar. */
    function bkmpGetDailyEventWins() {
      try { return Number(localStorage.getItem('bkmp-daily-event-wins') || 0); } catch (e) { return 0; }
    }
    function bkmpGetWonGoldenHour() {
      try { return localStorage.getItem('bkmp-won-golden-hour') === '1'; } catch (e) { return false; }
    }
    /* Welche Creator-Streams wurden schon mindestens einmal angeklickt
       (Twitch-Leiste oben ODER "Stream öffnen" im Live-Popup unten) - fuer
       den Erfolg "Stream von X angeschaut" pro Creator. */
    const BKMP_STREAMERS_CLICKED_KEY = 'bkmp-streamers-clicked';
    function bkmpGetStreamersClicked() {
      try { return JSON.parse(localStorage.getItem(BKMP_STREAMERS_CLICKED_KEY) || '[]'); } catch (e) { return []; }
    }
    function bkmpMarkStreamerClicked(id) {
      if (!id) return;
      const found = bkmpGetStreamersClicked();
      if (found.includes(id)) return;
      found.push(id);
      try { localStorage.setItem(BKMP_STREAMERS_CLICKED_KEY, JSON.stringify(found)); } catch (e) {}
      if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
    }

    function bkmpTieredAchievements(idPrefix, category, metricKey, tiers, descFn) {
      return tiers.map(([n, title]) => ({
        id: `${idPrefix}_${n}`,
        category,
        title,
        desc: descFn(n),
        progress: ctx => [ctx[metricKey], n],
        check: ctx => ctx[metricKey] >= n
      }));
    }

    const BKMP_CARD_TIERS = [
      [1, 'Erste Karte'], [2, 'Zweite Karte'], [3, 'Dreifach'], [5, 'Kartenfan'], [10, 'Kartensammler'],
      [15, 'Kartenkenner'], [20, 'Kartenprofi'], [25, 'Viertelhundert'], [30, 'Kartenmeister'], [40, 'Fleißarbeit'],
      [50, 'Halbes Hundert'], [60, 'Unaufhaltsam'], [75, 'Dreiviertelhundert'], [100, 'Kartenlegende'],
      [125, 'Kartenwahnsinn'], [150, 'Anderthalbhundert'], [175, 'Fast am Ziel'], [200, 'Zweihundert'],
      [250, 'Viertel-Tausend'], [300, 'Dreihundert'], [350, '350er-Klub'], [400, 'Vierhundert'],
      [450, 'Fast 500'], [500, 'Kartengott']
    ];
    const BKMP_BONK_TIERS = [
      [1, 'Erster Bonk'], [2, 'Zweiter Bonk'], [5, 'Bonk-Fan'], [10, 'Bonk-Sammler'], [25, 'Bonk-Profi'],
      [50, 'Bonk-Meister'], [100, 'Bonk-Legende'], [250, 'Viertel-Tausend Bonks'], [500, 'Bonk-Gott'], [1000, 'Tausend Bonks'],
      [2500, 'Zweieinhalbtausend Bonks'], [5000, 'Fünftausend Bonks'], [10000, 'Zehntausend Bonks'], [25000, 'Fünfundzwanzigtausend Bonks'], [50000, 'Fünfzigtausend Bonks'],
      [75000, 'Fünfundsiebzigtausend Bonks'], [100000, 'Hunderttausend Bonks'], [150000, 'Anderthalbhunderttausend Bonks'], [200000, 'Zweihunderttausend Bonks'], [250000, 'Viertelmillion Bonks'],
      [300000, 'Dreihunderttausend Bonks'], [400000, 'Vierhunderttausend Bonks'], [500000, 'Halbe Million Bonks'], [600000, 'Sechshunderttausend Bonks'], [700000, 'Siebenhunderttausend Bonks'],
      [800000, 'Achthunderttausend Bonks'], [900000, 'Neunhunderttausend Bonks'], [950000, 'Fast geschafft'], [990000, 'Ganz knapp'], [1000000, 'Der ewige Bonker']
    ];
    const BKMP_WISH_TIERS = [
      [1, 'Erster Wunsch'], [2, 'Zweiter Wunsch'], [3, 'Dreifachwunsch'], [5, 'Wunschfan'], [10, 'Wunschsammler'],
      [15, 'Wunschkenner'], [20, 'Wunschprofi'], [25, 'Viertelhundert Wünsche'], [30, 'Wunschmeister'], [40, 'Fleißiger Wünscher'],
      [50, 'Halbes Hundert Wünsche'], [60, 'Unaufhaltsam'], [75, 'Dreiviertelhundert Wünsche'], [100, 'Wunschlegende'],
      [125, 'Wunschwahnsinn'], [150, 'Anderthalbhundert Wünsche'], [175, 'Fast am Ziel'], [200, 'Zweihundert Wünsche'],
      [250, 'Viertel-Tausend Wünsche'], [300, 'Dreihundert Wünsche'], [350, '350er-Klub'], [400, 'Vierhundert Wünsche'],
      [450, 'Fast 500 Wünsche'], [500, 'Wunschgott']
    ];
    const BKMP_TIME_TIERS = [
      [1, 'Erster Besuch'], [2, 'Zwei Minuten'], [5, 'Kurz reingeschaut'], [10, 'Stammgast'], [15, 'Viertelstunde'],
      [20, 'Zwanzig Minuten'], [30, 'Halbe Stunde'], [45, 'Fast eine Stunde'], [60, 'Wohnt hier jetzt'], [90, 'Anderthalb Stunden'],
      [120, 'Zwei Stunden'], [150, 'Zweieinhalb Stunden'], [180, 'Drei Stunden'], [240, 'Vier Stunden'], [300, 'Fünf Stunden'],
      [360, 'Sechs Stunden'], [480, 'Ein Arbeitstag'], [600, 'Zehn Stunden'], [720, 'Zwölf Stunden'],
      [900, 'Fünfzehn Stunden'], [1200, 'Zwanzig Stunden'], [1440, 'Ein voller Tag'], [1800, 'Dreißig Stunden'],
      [2400, 'Vierzig Stunden'], [3000, 'Fünfzig Stunden']
    ];
    const BKMP_DAYS_TIERS = [
      [1, 'Erster Tag'], [2, 'Zweiter Tag'], [3, 'Drei Tage'], [5, 'Fünf Tage'], [7, 'Eine Woche'], [10, 'Zehn Tage'],
      [14, 'Zwei Wochen'], [21, 'Drei Wochen'], [30, 'Ein Monat'], [45, 'Sechs Wochen'], [60, 'Zwei Monate'],
      [90, 'Ein Quartal'], [120, 'Vier Monate'], [180, 'Ein halbes Jahr'], [270, 'Neun Monate'], [365, 'Ein ganzes Jahr']
    ];
    /* Schaf-Zitat-Streak: 1x taeglich ab 12 Uhr aufs Schaf klicken (siehe
       bkmpTrackSheepQuoteClick). Titel bewusst suess/verspielt statt
       trocken "Tag N" - auf Nutzerwunsch ("Erstelle süße Titel"). */
    const BKMP_SHEEP_STREAK_TIERS = [
      [1, 'Erstes Määh'], [2, 'Zwei Määhs'], [3, 'Woll-Neuling'], [4, 'Schaf-Stammgast'],
      [5, 'Fünf-Tage-Fellfreund'], [6, 'Halbdutzend-Määher'], [7, 'Wochen-Schäfchen'],
      [8, 'Wolliger Wiederholungstäter'], [9, 'Fast-Zehn-Zottel'], [10, 'Zehn-Tage-Treue'],
      [15, 'Anderthalb Wochen wollig'], [30, 'Monats-Määhster'], [60, 'Zwei-Monats-Zottel'],
      [120, 'Vier-Monats-Fellnase'], [240, 'Achtmonatiger Wollversteher'], [365, 'Schafsweisheit des Jahres']
    ];
    const BKMP_DIVERSITY_TIERS = [
      [1, 'Erste Kategorie'], [2, 'Zwei Kategorien'], [3, 'Drei Kategorien'], [4, 'Vier Kategorien'],
      [5, 'Fünf Kategorien'], [6, 'Sechs Kategorien'], [7, 'Sieben Kategorien'], [8, 'Alleskönner']
    ];
    const BKMP_META_TIERS = [
      [5, 'Erste Schritte'], [10, 'Zehn Erfolge'], [20, 'Zwanzig Erfolge'], [30, 'Dreißig Erfolge'], [40, 'Vierzig Erfolge'],
      [50, 'Fünfzig Erfolge'], [60, 'Sechzig Erfolge'], [70, 'Siebzig Erfolge'], [80, 'Achtzig Erfolge'], [90, 'Neunzig Erfolge'],
      [100, 'Hundert Erfolge'], [110, 'Hundertzehn Erfolge'], [120, 'Hundertzwanzig Erfolge'], [125, 'Fast alles']
    ];
    /* Feedback-Erfolge (5 pro Kategorie) - Schwellenwerte bewusst niedriger
       als bei Karten/Wuenschen, da Feedback per Cooldown (siehe
       bkmpSubmitCooldownSecondsLeft('feedback')) nur begrenzt oft am Stueck
       abgeschickt werden kann. */
    const BKMP_FEEDBACK_LOB_TIERS = [
      [1, 'Erstes Lob'], [3, 'Lob-Fan'], [5, 'Lobredner'], [10, 'Lob-Champion'], [20, 'Legende des Lobes']
    ];
    const BKMP_FEEDBACK_KRITIK_TIERS = [
      [1, 'Erste Kritik'], [3, 'Kritik-Fan'], [5, 'Kritiker'], [10, 'Kritik-Profi'], [20, 'Meister der Kritik']
    ];
    const BKMP_FEEDBACK_IDEE_TIERS = [
      [1, 'Erste Idee'], [3, 'Ideenreich'], [5, 'Ideengeber'], [10, 'Ideenmaschine'], [20, 'Erfinder-Legende']
    ];
    const BKMP_FEEDBACK_SONSTIGES_TIERS = [
      [1, 'Erste Nachricht'], [3, 'Vielschreiber'], [5, 'Kommunikativ'], [10, 'Vielredner'], [20, 'Feedback-Legende']
    ];

    function bkmpBuildAchievementsList() {
    return [
      { id: 'name_set', category: 'Sonstiges', title: 'Angekommen', desc: 'Trag deinen Minecraft-Namen ein.', check: ctx => ctx.hasName },
      ...bkmpTieredAchievements('card', 'Karten', 'cardCount', BKMP_CARD_TIERS, n => `Reiche ${n} Karte${n === 1 ? '' : 'n'} in der Kartendatenbank ein.`),
      ...bkmpTieredAchievements('wish', 'Kartenideen', 'wishCount', BKMP_WISH_TIERS, n => `Reiche ${n} Kartenidee${n === 1 ? '' : 'n'} ein.`),
      ...bkmpTieredAchievements('time', 'Zeit & Treue', 'minutesSpent', BKMP_TIME_TIERS, n => `Verbringe insgesamt ${n} Minute${n === 1 ? '' : 'n'} auf der Seite.`),
      ...bkmpTieredAchievements('days', 'Zeit & Treue', 'daysVisited', BKMP_DAYS_TIERS, n => `Besuche die Seite an ${n} verschiedenen Tagen.`),
      ...bkmpTieredAchievements('diversity', 'Vielfalt', 'categoryDiversity', BKMP_DIVERSITY_TIERS, n => `Reiche Karten in ${n} verschiedenen Kategorien ein.`),
      ...bkmpTieredAchievements('meta', 'Meilensteine', 'baseUnlockedCount', BKMP_META_TIERS, n => `Schalte ${n} andere Erfolge frei.`),
      ...bkmpTieredAchievements('bonk', 'Bonk', 'bonkCount', BKMP_BONK_TIERS, n => `Klicke ${n}x auf den Bonk-Button.`),
      ...bkmpTieredAchievements('feedback_lob', 'Feedback', 'feedbackLobCount', BKMP_FEEDBACK_LOB_TIERS, n => `Sende ${n} Feedback${n === 1 ? '' : 's'} der Kategorie "Lob".`),
      ...bkmpTieredAchievements('feedback_kritik', 'Feedback', 'feedbackKritikCount', BKMP_FEEDBACK_KRITIK_TIERS, n => `Sende ${n} Feedback${n === 1 ? '' : 's'} der Kategorie "Kritik".`),
      ...bkmpTieredAchievements('feedback_idee', 'Feedback', 'feedbackIdeeCount', BKMP_FEEDBACK_IDEE_TIERS, n => `Sende ${n} Feedback${n === 1 ? '' : 's'} der Kategorie "Idee".`),
      ...bkmpTieredAchievements('feedback_sonstiges', 'Feedback', 'feedbackSonstigesCount', BKMP_FEEDBACK_SONSTIGES_TIERS, n => `Sende ${n} Feedback${n === 1 ? '' : 's'} der Kategorie "Sonstiges".`),
      { id: 'egg_bkmp', category: 'Easter Eggs', title: '???', revealName: 'BKMP-Flüsterer', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Manche Namen tippt man öfter, als man denkt.', check: ctx => ctx.eggsFound.includes('bkmp') },
      { id: 'egg_konami', category: 'Easter Eggs', title: '???', revealName: 'Konami-Veteran', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Hoch, hoch, runter, runter... eine uralte Cheat-Tradition.', check: ctx => ctx.eggsFound.includes('konami') },
      { id: 'egg_fire', category: 'Easter Eggs', title: '???', revealName: 'Drachenbändiger', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Was fürchten Dörfer und Ritter gleichermaßen? Tipp es einfach.', check: ctx => ctx.eggsFound.includes('drache') },
      { id: 'egg_phil', category: 'Easter Eggs', title: '???', revealName: 'Phil-Fan', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Es gibt da diesen einen Bodybuilder in der Kartendatenbank...', check: ctx => ctx.eggsFound.includes('phil') },
      { id: 'egg_creeper', category: 'Easter Eggs', title: '???', revealName: 'Creeper-Entschärfer', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Sssss... ein sehr grünes, sehr explosives Minecraft-Wesen.', check: ctx => ctx.eggsFound.includes('creeper') },
      { id: 'egg_diamond', category: 'Easter Eggs', title: '???', revealName: 'Diamantenregen-Macher', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Klick oft und schnell auf das Banner ganz oben auf der Seite.', check: ctx => ctx.eggsFound.includes('diamond') },
      { id: 'egg_matrix', category: 'Easter Eggs', title: '???', revealName: 'Der Auserwählte', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Rot oder blau? Tipp den Namen eines berühmten Filmuniversums.', check: ctx => ctx.eggsFound.includes('matrix') },
      { id: 'egg_idle', category: 'Easter Eggs', title: '???', revealName: 'Schlummer-Entdecker', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Lass die Seite einfach mal ein paar Minuten in Ruhe.', check: ctx => ctx.eggsFound.includes('idle') },
      { id: 'egg_rainbow', category: 'Easter Eggs', title: '???', revealName: 'Regenbogen-Dreher', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Du wirst suchen müssen... oder drücken? Irgendwas Rundes auf der Seite dreht sich vielleicht gerne.', check: ctx => ctx.eggsFound.includes('rainbow') },
      { id: 'egg_derliber', category: 'Easter Eggs', title: '???', revealName: 'Liber-Jäger', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Suche 10 kleine Liber-Strichmännchen, versteckt auf der ganzen Website.', progress: ctx => [ctx.derLiberFound, 10], check: ctx => ctx.eggsFound.includes('derliber') },
      { id: 'egg_jannik', category: 'Easter Eggs', title: '???', revealName: 'Jannik der Hase', desc: 'Finde ein verstecktes Easter Egg.', revealDesc: 'Man sagt, irgendwo auf dieser Website hoppelt ein kleiner Hase herum. Herzlichen Glückwunsch – du hast ihn gefunden! 🥕', hint: 'Es heißt, irgendwo hoppelt ein kleiner Jannik Hase herum... Aber niemand weiß genau, wo.', check: ctx => ctx.eggsFound.includes('jannik') },
      { id: 'egg_adfree', category: 'Easter Eggs', title: '???', revealName: 'Hab kein Geld', desc: 'Finde ein verstecktes Easter Egg.', revealDesc: '99 Dollar gespart. Bester Deal überhaupt.', hint: 'Werbung nervt echt manchmal, oder?', check: ctx => ctx.eggsFound.includes('adfree') },
      { id: 'egg_sheep', category: 'Easter Eggs', title: '???', revealName: 'Schaf Zitate Flüsterer', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Jeden Tag werden wir bereichert damit!', check: ctx => ctx.eggsFound.includes('sheep') },
      { id: 'egg_penguin', category: 'Easter Eggs', title: '???', revealName: 'Pinguin-Fischer', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Nur bei Tageslicht versteckt sich im Schnee ein kleiner Freund mit Fisch-Appetit.', check: ctx => ctx.eggsFound.includes('penguin') },
      { id: 'egg_zerathor', category: 'Easter Eggs', title: '???', revealName: 'Boss-Wecker', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Tipp den Namen des Drachen, vor dem sich ganze Dörfer fürchten.', check: ctx => ctx.eggsFound.includes('zerathor') },
      { id: 'egg_mouseshake', category: 'Easter Eggs', title: '???', revealName: 'Maus-Schüttler', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Manchmal verliert man seinen Mauszeiger auf dem Bildschirm aus den Augen... wackle mal ganz wild hin und her.', check: ctx => ctx.eggsFound.includes('mouseshake') },
      { id: 'egg_rightclick', category: 'Easter Eggs', title: '???', revealName: 'Rechtsklick-Entdecker', desc: 'Finde ein verstecktes Easter Egg.', hint: 'Was passiert wohl, wenn man dreimal schnell hintereinander die rechte Maustaste drückt?', check: ctx => ctx.eggsFound.includes('rightclick') },
      ...bkmpTieredAchievements('sheepstreak', 'Zeit & Treue', 'sheepStreak', BKMP_SHEEP_STREAK_TIERS, n => `Klicke ${n} Tag${n === 1 ? '' : 'e'} in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages.`),
      { id: 'egg_all', category: 'Easter Eggs', title: 'Osterhase', desc: 'Finde alle 17 versteckten Easter Eggs.', progress: ctx => [ctx.eggsFound.length, 17], check: ctx => ctx.eggsFound.length >= 17 },
      { id: 'combo_card_wish', category: 'Sonstiges', title: 'Vielseitig', desc: 'Reiche mindestens 1 Karte und 1 Kartenidee ein.', check: ctx => ctx.cardCount >= 1 && ctx.wishCount >= 1 },
      { id: 'night_owl', category: 'Sonstiges', title: 'Nachteule', desc: 'Besuche die Seite zwischen 0 und 5 Uhr nachts.', check: ctx => ctx.nightOwl },
      { id: 'early_bird', category: 'Sonstiges', title: 'Frühaufsteher', desc: 'Besuche die Seite zwischen 5 und 7 Uhr morgens.', check: ctx => ctx.earlyBird },
      { id: 'weekend_warrior', category: 'Sonstiges', title: 'Wochenend-Grinder', desc: 'Besuche die Seite an einem Samstag und einem Sonntag.', check: ctx => ctx.weekendBoth },
      { id: 'investor_match', category: 'Sonstiges', title: 'Investor', desc: 'Dein Name taucht als echter Investor auf der Seite auf.', check: ctx => ctx.isInvestor },
      { id: 'panel_opener', category: 'Sonstiges', title: 'Erfolgs-Jäger', desc: 'Öffne dieses Erfolge-Fenster 10 Mal.', progress: ctx => [ctx.panelOpens, 10], check: ctx => ctx.panelOpens >= 10 },
      ...(Array.isArray(data.streamers) ? data.streamers : []).filter(s => s.countsForAchievement !== false).map(s => ({
        id: `streamer_watch_${s.id}`,
        category: 'Sonstiges',
        title: '???',
        revealName: `${s.name}-Fan`,
        desc: `Schau dir den Stream von ${s.name} an.`,
        check: ctx => ctx.streamersClicked.includes(s.id)
      })),
      { id: 'streamer_watch_all', category: 'Sonstiges', title: 'Streaming-Marathon', desc: 'Schau dir alle Creator-Streams mindestens einmal an.',
        progress: ctx => { const eligible = (Array.isArray(data.streamers) ? data.streamers : []).filter(s => s.countsForAchievement !== false); return [eligible.filter(s => ctx.streamersClicked.includes(s.id)).length, eligible.length]; },
        check: ctx => { const eligible = (Array.isArray(data.streamers) ? data.streamers : []).filter(s => s.countsForAchievement !== false); return eligible.length > 0 && eligible.every(s => ctx.streamersClicked.includes(s.id)); } },
      ...BKMP_PLUSHIES.map(p => ({
        id: `plushie_${p.id}`,
        category: 'Plüshies',
        title: '???? Plüshie',
        revealName: p.name,
        desc: 'Schalte diesen Plüshie per Code frei.',
        check: ctx => ctx.ownedPlushies.includes(p.id)
      })),
      { id: 'plushie_all', category: 'Plüshies', title: 'Besitze sie alle', desc: 'Schalte alle Plüshies frei.', progress: ctx => [ctx.ownedPlushies.length, BKMP_PLUSHIES.length], check: ctx => BKMP_PLUSHIES.length > 0 && BKMP_PLUSHIES.every(p => ctx.ownedPlushies.includes(p.id)) },
      /* Easter Egg: der Platzhalter-Text im Code-Einloese-Feld
         (#plushieCodeInput) ist kein Beispiel mehr, sondern ein echter,
         gueltiger Code - wer genau hinschaut und ihn einloest, bekommt
         diesen Erfolg extra (zusaetzlich zum normalen "plushie_kora"). */
      { id: 'kora_finder', category: 'Easter Eggs', title: 'Du kannst mich austricksen..', desc: 'Wo man überall Plüshi-Codes findet, verrückt oder?', check: ctx => ctx.ownedPlushies.includes('kora') },
      { id: 'daily_event_1', category: 'Plüshies', title: '???', revealName: 'Glücklicher Gewinner', desc: 'Gewinne ein Daily-Code-Event.', check: ctx => ctx.dailyEventWins >= 1 },
      { id: 'daily_event_5', category: 'Plüshies', title: '???', revealName: 'Serien-Gewinner', desc: 'Gewinne 5 Daily-Code-Events.', progress: ctx => [ctx.dailyEventWins, 5], check: ctx => ctx.dailyEventWins >= 5 },
      { id: 'daily_event_15', category: 'Plüshies', title: '???', revealName: 'Event-Champion', desc: 'Gewinne 15 Daily-Code-Events.', progress: ctx => [ctx.dailyEventWins, 15], check: ctx => ctx.dailyEventWins >= 15 },
      { id: 'golden_hour_win', category: 'Plüshies', title: '???', revealName: 'Der Auserwählte', desc: 'Gewinne den Code der Golden Hour als Erster.', check: ctx => ctx.wonGoldenHour },
      ...(Array.isArray(window.BKMP_IDLE_ACHIEVEMENTS_EXTRA) ? window.BKMP_IDLE_ACHIEVEMENTS_EXTRA : []),
      ...(Array.isArray(window.BKMP_IDLE_DRAGON_KILL_TIERS) ? bkmpTieredAchievements('idledragon', 'Idle Dorf', 'idleDragonKills', window.BKMP_IDLE_DRAGON_KILL_TIERS, n => `Besiege ${n} Drache${n === 1 ? '' : 'n'} im Idle Dorf.`) : []),
      ...(Array.isArray(window.BKMP_IDLE_LEVEL_TIERS) ? bkmpTieredAchievements('idlelevel', 'Idle Dorf', 'idleLevel', window.BKMP_IDLE_LEVEL_TIERS, n => `Erreiche Dorf-Level ${n} im Idle Dorf.`) : []),
      ...(Array.isArray(window.BKMP_IDLE_GOLD_TIERS) ? bkmpTieredAchievements('idlegold', 'Idle Dorf', 'idleGoldEarned', window.BKMP_IDLE_GOLD_TIERS, n => `Sammle insgesamt ${n} Gold im Idle Dorf.`) : []),
      ...(Array.isArray(window.BKMP_IDLE_SKILLPOINTS_TIERS) ? bkmpTieredAchievements('idleskill', 'Idle Dorf', 'idleSkillPointsSpent', window.BKMP_IDLE_SKILLPOINTS_TIERS, n => `Investiere ${n} Skillpunkte im Idle Dorf.`) : []),
      ...(Array.isArray(window.BKMP_IDLE_PRESTIGE_TIERS) ? bkmpTieredAchievements('idleprestige', 'Idle Dorf', 'idlePrestigeLevel', window.BKMP_IDLE_PRESTIGE_TIERS, n => `Steige ${n}x im Idle Dorf auf (Prestige).`) : []),
      ...(Array.isArray(window.BKMP_IDLE_TOWER_TIERS) ? bkmpTieredAchievements('idletower', 'Idle Dorf', 'idleTowerHighestWave', window.BKMP_IDLE_TOWER_TIERS, n => `Erreiche Stufe ${n} im Endlosen Turm.`) : []),
      { id: 'idle_dungeon_cleared', category: 'Idle Dorf', title: '???', revealName: 'Dungeon-Meister', desc: 'Meistere die Dungeon-Herausforderung auf der Schwierigkeit "Albtraum".', check: ctx => ctx.idleDungeonCleared },
      ...(Array.isArray(window.BKMP_RUNE_FUSE_SUCCESS_TIERS) ? bkmpTieredAchievements('runefuse', 'Runen', 'idleRuneFuseSuccesses', window.BKMP_RUNE_FUSE_SUCCESS_TIERS, n => `Verschmelze ${n} Rune${n === 1 ? '' : 'n'} erfolgreich.`) : []),
      ...(Array.isArray(window.BKMP_RUNE_FUSE_FAIL_TIERS) ? bkmpTieredAchievements('runefusefail', 'Runen', 'idleRuneFuseFailures', window.BKMP_RUNE_FUSE_FAIL_TIERS, n => `Erlebe ${n} fehlgeschlagene Runen-Verschmelzung${n === 1 ? '' : 'en'}.`) : []),
      ...(Array.isArray(window.BKMP_RUNE_UPGRADE_SUCCESS_TIERS) ? bkmpTieredAchievements('runeupgrade', 'Runen', 'idleRuneUpgradeSuccesses', window.BKMP_RUNE_UPGRADE_SUCCESS_TIERS, n => `Werte Runen ${n}x erfolgreich auf.`) : []),
      ...(Array.isArray(window.BKMP_RUNE_UPGRADE_FAIL_TIERS) ? bkmpTieredAchievements('runeupgradefail', 'Runen', 'idleRuneUpgradeFailures', window.BKMP_RUNE_UPGRADE_FAIL_TIERS, n => `Erlebe ${n} fehlgeschlagene Runen-Aufwertung${n === 1 ? '' : 'en'}.`) : []),
      ...(Array.isArray(window.BKMP_RAID_ACHIEVEMENTS_EXTRA) ? window.BKMP_RAID_ACHIEVEMENTS_EXTRA : []),
      ...(Array.isArray(window.BKMP_ARENA_ACHIEVEMENTS_EXTRA) ? window.BKMP_ARENA_ACHIEVEMENTS_EXTRA : []),
      ...(Array.isArray(window.BKMP_GUILD_ACHIEVEMENTS_EXTRA) ? window.BKMP_GUILD_ACHIEVEMENTS_EXTRA : [])
    ];
    }
    let BKMP_ACHIEVEMENTS = bkmpBuildAchievementsList();

    function bkmpAchievementContextWithMeta() {
      const ctx = bkmpBuildAchievementContext();
      ctx.baseUnlockedCount = BKMP_ACHIEVEMENTS.filter(a => a.category !== 'Meilensteine' && bkmpAchievementUnlocked(a, { ...ctx, baseUnlockedCount: 0 })).length;
      return ctx;
    }

    /* ---------------- Kosmetik: Namens-Effekte ---------------- */
    const BKMP_ACTIVE_COSMETIC_KEY = 'bkmp-active-cosmetic';
    const BKMP_COSMETICS = [
      { id: 'default', name: 'Automatisch', desc: 'Wird automatisch stärker, je mehr Erfolge du hast.', unlockAt: 0 },
      { id: 'shadow', name: 'Schatten', desc: 'Dezent und dunkel.', unlockAt: 5 },
      { id: 'gold', name: 'Gold-Glanz', desc: 'Klassisches Gold.', unlockAt: 8 },
      { id: 'ice', name: 'Eis-Blau', desc: 'Kühles Blau.', unlockAt: 15 },
      { id: 'glow', name: 'Gold-Glühen', desc: 'Gold mit Leuchten.', unlockAt: 25 },
      { id: 'matrix', name: 'Matrix-Grün', desc: 'Digitales Grün.', unlockAt: 40 },
      { id: 'fire', name: 'Feuer-Rahmen', desc: 'Nur für Drachenjäger.', unlockEgg: 'drache' },
      { id: 'dollar_prefix', name: 'Geld-Rahmen', desc: '💵 Für alle, die kein Geld haben.', unlockEgg: 'adfree' },
      { id: 'aurora', name: 'Aurora', desc: 'Wandernder Farbverlauf.', unlockAt: 60 },
      { id: 'royal', name: 'Königlich', desc: 'Violett & edel.', unlockAt: 100 },
      { id: 'rainbow', name: 'Regenbogen', desc: 'Nur für Drehscheiben-Entdecker.', unlockEgg: 'rainbow' },
      { id: 'bonk_bronze', name: 'Bonk-Bronze', desc: 'Für treue Boxer.', unlockAchievement: 'bonk_25' },
      { id: 'bonk_silver', name: 'Bonk-Silber', desc: 'Schon ordentlich geboxt.', unlockAchievement: 'bonk_500' },
      { id: 'bonk_gold', name: 'Bonk-Gold', desc: 'Ein wahrer Boxchampion.', unlockAchievement: 'bonk_10000' },
      { id: 'bonk_inferno', name: 'Bonk-Inferno', desc: 'Nur für die Unaufhaltsamen.', unlockAchievement: 'bonk_100000' },
      { id: 'bonk_legend', name: 'Bonk-Legende', desc: 'Der ultimative Bonker.', unlockAchievement: 'bonk_1000000' },
      { id: 'herzschlag', name: 'Herzschlag', desc: 'Pulsiert im Herzschlag-Rhythmus.', unlockAt: 12 },
      { id: 'gruenrot', name: 'Grün-Rot-Verlauf', desc: 'Wandelt sich von Grün zu Rot.', unlockAt: 20 },
      { id: 'toxic', name: 'Toxic-Grün', desc: 'Grelles, leuchtendes Grün.', unlockAt: 35 },
      { id: 'sonnenuntergang', name: 'Sonnenuntergang', desc: 'Orange, Pink und Violett.', unlockAt: 50 },
      { id: 'neonpink', name: 'Neon-Pink', desc: 'Leuchtendes Pink.', unlockAt: 70 },
      { id: 'galaxy', name: 'Galaxy', desc: 'Schimmernder Sternenverlauf.', unlockAt: 80 },
      { id: 'mitternacht', name: 'Mitternacht', desc: 'Tiefes Nachtblau.', unlockAt: 90 },
      ...(Array.isArray(window.BKMP_IDLE_COSMETICS) ? window.BKMP_IDLE_COSMETICS : [])
    ];
    function bkmpGetActiveCosmetic() {
      try { return localStorage.getItem(BKMP_ACTIVE_COSMETIC_KEY) || ''; } catch (e) { return ''; }
    }
    function bkmpSetActiveCosmetic(id) {
      try { localStorage.setItem(BKMP_ACTIVE_COSMETIC_KEY, id); } catch (e) {}
      renderAchievementBadge();
    }
    function bkmpCosmeticUnlocked(cosmetic, unlockedCount, ctx) {
      /* Bug-Fix 18.07. (siehe bkmpIdleCosmeticUnlockedSticky in idledorf.js
         fuer den vollen Kommentar): nicht-monotone unlockCustom-Bedingungen
         (z.B. "alle Skilltree-Zweige maximiert") fielen bisher wieder auf
         "gesperrt" zurueck, sobald sich der Zustand seither aenderte. */
      if (cosmetic.unlockCustom) {
        return typeof bkmpIdleCosmeticUnlockedSticky === 'function' ? bkmpIdleCosmeticUnlockedSticky(cosmetic, ctx) : Boolean(cosmetic.unlockCustom(ctx));
      }
      if (cosmetic.unlockEgg) return ctx.eggsFound.includes(cosmetic.unlockEgg);
      if (cosmetic.unlockAchievement) {
        const ach = BKMP_ACHIEVEMENTS.find(a => a.id === cosmetic.unlockAchievement);
        return ach ? bkmpAchievementUnlocked(ach, ctx) : false;
      }
      return unlockedCount >= (cosmetic.unlockAt || 0);
    }
    function bkmpApplyActiveCosmetic(badge, unlockedCount, ctx) {
      BKMP_COSMETICS.forEach(c => badge.classList.remove('mc-cosmetic-' + c.id));
      const active = bkmpGetActiveCosmetic();
      if (!active || active === 'default') return;
      const cosmetic = BKMP_COSMETICS.find(c => c.id === active);
      if (cosmetic && bkmpCosmeticUnlocked(cosmetic, unlockedCount, ctx)) {
        badge.classList.add('mc-cosmetic-' + cosmetic.id);
      }
    }
    function renderCosmeticsPanel() {
      const ctx = bkmpAchievementContextWithMeta();
      const unlockedCount = BKMP_ACHIEVEMENTS.filter(a => bkmpAchievementUnlocked(a, ctx)).length;
      const active = bkmpGetActiveCosmetic() || 'default';
      const el = document.getElementById('cosmeticsList');
      el.innerHTML = BKMP_COSMETICS.map(c => {
        const unlocked = bkmpCosmeticUnlocked(c, unlockedCount, ctx);
        const isActive = active === c.id;
        const lockedHint = c.unlockEgg ? 'Finde das passende Easter Egg.' : (c.unlockAchievement ? 'Erst diesen Erfolg freischalten.' : (c.unlockCustom ? 'Noch nicht freigeschaltet.' : `Ab ${c.unlockAt} Erfolgen`));
        /* Redesign Phase 3 (17.07.): c.rarity wird seit BKMP_IDLE_COSMETICS
           (idledorf.js) berechnet, war aber bisher NIRGENDS gerendert (siehe
           Audit-Fund) - bkmpUiRarityBadge() macht sie hier erstmals sichtbar.
           Reine Ergaenzung: Kosmetiken ohne rarity-Feld (die aelteren
           BKMP_COSMETICS-Eintraege) rendern weiterhin exakt wie vorher, die
           Funktion gibt fuer sie nur '' zurueck. */
        const rarityBadge = unlocked && typeof bkmpUiRarityBadge === 'function' ? bkmpUiRarityBadge(c.rarity) : '';
        return `
          <button type="button" class="cosmetic-swatch mc-cosmetic-${c.id} ${unlocked ? '' : 'locked'} ${isActive ? 'active' : ''}" data-cosmetic-id="${escapeHtml(c.id)}" ${unlocked ? '' : 'disabled'}>
            <span class="cosmetic-swatch-name">${unlocked ? escapeHtml(c.name) : '🔒'}${rarityBadge}</span>
            <span class="cosmetic-swatch-desc">${unlocked ? escapeHtml(c.desc) : lockedHint}</span>
          </button>`;
      }).join('');
      el.querySelectorAll('.cosmetic-swatch:not(.locked)').forEach(btn => {
        btn.addEventListener('click', () => {
          bkmpSetActiveCosmetic(btn.dataset.cosmeticId);
          renderCosmeticsPanel();
        });
      });
    }

    /* ---------------- Titel ---------------- */
    const BKMP_ACTIVE_TITLE_KEY = 'bkmp-active-title';
    function bkmpBuildTitlesList() {
    return [
      { id: 'none', name: 'Kein Titel', desc: 'Nur dein Name.', unlockAlways: true },
      { id: 'neuling', name: 'Neuling', desc: 'Erste Schritte gemacht.', unlockAt: 5 },
      { id: 'kartensammler', name: 'Kartensammler', desc: 'Für echte Kartenfans.', unlockAchievement: 'card_50' },
      { id: 'wunschdenker', name: 'Wunschdenker', desc: 'Für fleißige Wünscher.', unlockAchievement: 'wish_50' },
      { id: 'nachtschwaermer', name: 'Nachtschwärmer', desc: 'Für die, die nachts nicht schlafen.', unlockAchievement: 'night_owl' },
      { id: 'ostereier', name: 'Der EasterEggHunter', desc: 'Alle Easter Eggs gefunden.', unlockAchievement: 'egg_all' },
      { id: 'habkeingeld', name: 'Hab kein Geld', desc: '99 Dollar gespart. Bester Deal überhaupt.', unlockAchievement: 'egg_adfree' },
      { id: 'liberjaeger', name: 'Liber-Jäger', desc: 'Alle Strichmännchen gefunden.', unlockAchievement: 'egg_derliber' },
      { id: 'legende', name: 'BKMP-Legende', desc: 'Weit über dem Durchschnitt.', unlockAt: 60 },
      { id: 'unaufhaltsam', name: 'Unaufhaltsam', desc: 'Kaum zu stoppen.', unlockAt: 100 },
      { id: 'allmaechtig', name: 'Der/Die Allmächtige', desc: 'Fast alles erreicht.', unlockAt: 120 },
      { id: 'bonker', name: 'Der Bonker', desc: 'Hat öfter zugeschlagen.', unlockAchievement: 'bonk_50' },
      { id: 'boxchamp', name: 'Boxchampion', desc: 'Kaum zu bremsen.', unlockAchievement: 'bonk_2500' },
      { id: 'faustkoenig', name: 'Faustkönig', desc: 'Herrscher der Fäuste.', unlockAchievement: 'bonk_50000' },
      { id: 'bonkgott', name: 'Bonk-Gott', desc: 'Legendärer Status erreicht.', unlockAchievement: 'bonk_500000' },
      { id: 'ewigerbonker', name: 'Der ewige Bonker', desc: 'Wird wohl nie aufhören.', unlockAchievement: 'bonk_1000000' },
      { id: 'stammgast', name: 'Stammgast', desc: 'Schaut regelmäßig vorbei.', unlockAchievement: 'time_10' },
      { id: 'veteran', name: 'Veteran', desc: 'Schon einen Monat dabei.', unlockAchievement: 'days_30' },
      { id: 'bkmp_veteran', name: 'BKMP Veteran', desc: 'Ein ganzes Quartal treu.', unlockAchievement: 'days_90' },
      { id: 'chrono_legende', name: 'Chrono-Legende', desc: 'Legendärer Fortschritt.', unlockAt: 90 },
      { id: 'titeljaeger', name: 'Titeljäger', desc: 'Sammelt Erfolge wie kein Zweiter.', unlockAchievement: 'meta_40' },
      { id: 'achievement_hunter', name: 'Achievement Hunter', desc: 'Auf der Jagd nach Erfolgen.', unlockAchievement: 'meta_60' },
      { id: 'achievement_meister', name: 'Achievement Meister', desc: 'Fast alle Erfolge im Griff.', unlockAchievement: 'meta_100' },
      { id: 'sammler', name: 'Sammler', desc: 'Ordentliche Kartensammlung.', unlockAchievement: 'card_25' },
      { id: 'supersammler', name: 'Supersammler', desc: 'Eine riesige Kartensammlung.', unlockAchievement: 'card_100' },
      { id: 'plushie_sammler', name: 'Plüshie Sammler', desc: 'Hat schon einige Plüshies.', unlockCustom: ctx => ctx.ownedPlushies.length >= 3 },
      { id: 'plushie_koenig', name: 'Plüshie König', desc: 'Fast die komplette Plüshie-Sammlung.', unlockCustom: ctx => BKMP_PLUSHIES.length > 1 && ctx.ownedPlushies.length >= BKMP_PLUSHIES.length - 1 },
      { id: 'plushie_gott', name: 'Plüshie Gott', desc: 'Besitzt jedes einzelne Plüshie.', unlockAchievement: 'plushie_all' },
      { id: 'schlauer_finder', name: 'SchlauerFinder', desc: 'Für alle, die genau hinschauen.', unlockAchievement: 'kora_finder' },
      { id: 'fanboy', name: 'Fanboy', desc: 'Hat sein erstes Plüshie ergattert.', unlockCustom: ctx => ctx.ownedPlushies.length >= 1 },
      { id: 'superfan', name: 'Superfan', desc: 'Gleich mehrere Plüshies gesammelt.', unlockCustom: ctx => ctx.ownedPlushies.length >= 2 },
      { id: 'maximaler_fanboy', name: 'Maximaler Fanboy', desc: 'Absoluter Plüshie-Enthusiast.', unlockCustom: ctx => ctx.ownedPlushies.length >= 4 },
      { id: 'creator_supporter', name: 'Creator Supporter', desc: 'Unterstützt die Creator aktiv.', unlockCustom: ctx => ctx.ownedPlushies.length >= 1 },
      { id: 'creator_freund', name: 'Creator Freund', desc: 'Den Creators eng verbunden.', unlockCustom: ctx => ctx.ownedPlushies.length >= 3 },
      { id: 'codejaeger', name: 'Codejäger', desc: 'Hat erfolgreich einen Code eingelöst.', unlockCustom: ctx => ctx.ownedPlushies.length >= 1 },
      { id: 'code_ninja', name: 'Code Ninja', desc: 'Flink beim Code-Einlösen.', unlockCustom: ctx => ctx.ownedPlushies.length >= 3 },
      { id: 'code_meister', name: 'Code Meister', desc: 'Kennt sich mit Codes bestens aus.', unlockCustom: ctx => ctx.ownedPlushies.length >= 5 },
      { id: 'code_suechtig', name: 'Code Süchtig', desc: 'Kann nicht genug von Codes bekommen.', unlockCustom: ctx => ctx.ownedPlushies.length >= 2 },
      { id: 'lucky_one', name: 'Lucky One', desc: 'Hat ein Daily-Code-Event gewonnen.', unlockCustom: ctx => ctx.dailyEventWins >= 1 },
      { id: 'gluecksritter', name: 'Glücksritter', desc: 'Das Glück ist auf seiner Seite.', unlockCustom: ctx => ctx.dailyEventWins >= 3 },
      { id: 'der_erste', name: 'Der Erste', desc: 'War als Erster am Code dran.', unlockCustom: ctx => ctx.dailyEventWins >= 1 },
      { id: 'der_schnellste', name: 'Der Schnellste', desc: 'Schneller als alle anderen.', unlockCustom: ctx => ctx.dailyEventWins >= 5 },
      { id: 'pixelmeister', name: 'Pixelmeister', desc: 'Ein Auge für schöne Karten.', unlockAchievement: 'card_10' },
      { id: 'pixelmagier', name: 'Pixelmagier', desc: 'Zaubert Karten herbei.', unlockAchievement: 'card_60' },
      { id: 'kartenfreund', name: 'Kartenfreund', desc: 'Mag Karten sehr.', unlockAchievement: 'card_3' },
      { id: 'kartenjaeger', name: 'Kartenjäger', desc: 'Immer auf der Suche nach neuen Karten.', unlockAchievement: 'card_40' },
      { id: 'mapart_genie', name: 'MapArt Genie', desc: 'Kreative Kartenideen am laufenden Band.', unlockAchievement: 'wish_25' },
      { id: 'plot_koenig', name: 'Plot König', desc: 'Herrscher über die Kartenideen.', unlockAchievement: 'wish_100' },
      { id: 'glow_traeger', name: 'Glow Träger', desc: 'Trägt ein leuchtendes Gold.', unlockAt: 25 },
      { id: 'leuchtende_legende', name: 'Leuchtende Legende', desc: 'Strahlt heller als der Rest.', unlockAt: 60 },
      { id: 'der_geduldige', name: 'Der Geduldige', desc: 'Wartet einfach mal ab.', unlockAchievement: 'egg_idle' },
      { id: 'der_verlorene', name: 'Der Verlorene', desc: 'Hat sich fast verirrt.', unlockAchievement: 'egg_jannik' },
      { id: 'der_zufaellige', name: 'Der Zufällige', desc: 'Verlässt sich gern auf den Zufall.', unlockAchievement: 'egg_rainbow' },
      { id: 'schnee_fluesterer', name: 'Schnee-Flüsterer', desc: 'Nur bei Tageslicht im Schnee zu finden.', unlockAchievement: 'egg_penguin' },
      { id: 'boss_wecker', name: 'Boss-Wecker', desc: 'Weckt lieber keine schlafenden Drachen.', unlockAchievement: 'egg_zerathor' },
      { id: 'maus_schuettler', name: 'Maus-Schüttler', desc: 'Findet seinen Mauszeiger notfalls auch durch wildes Wackeln.', unlockAchievement: 'egg_mouseshake' },
      { id: 'rechtsklick_entdecker', name: 'Rechtsklick-Entdecker', desc: 'Schaut auch mal, was hinter der rechten Maustaste steckt.', unlockAchievement: 'egg_rightclick' },
      { id: 'dungeon_meister', name: 'Dungeon-Meister', desc: 'Hat die Dungeon-Herausforderung auf "Albtraum" gemeistert.', unlockAchievement: 'idle_dungeon_cleared' },
      { id: 'wahnsinniger_sammler', name: 'Der Wahnsinnige Sammler', desc: 'Sammelt einfach alles.', unlockAt: 100 },
      { id: 'collector_plus', name: 'Collector++', desc: 'Eine beachtliche Sammlung.', unlockAchievement: 'card_200' },
      { id: 'collector_ultra', name: 'Collector Ultra', desc: 'Eine gewaltige Sammlung.', unlockAchievement: 'card_300' },
      { id: 'collector_supreme', name: 'Collector Supreme', desc: 'Die ultimative Kartensammlung.', unlockAchievement: 'card_500' },
      { id: 'bkmp_ultra', name: 'BKMP Ultra', desc: 'Fast am absoluten Limit.', unlockAt: 110 },
      { id: 'bkmp_elite', name: 'BKMP Elite', desc: 'Gehört zur absoluten Elite.', unlockAt: 125 },
      { id: 'geheimcode_finder', name: 'Geheimcode Finder', desc: 'Hat einen geheimen Code gefunden.', unlockCustom: ctx => ctx.ownedPlushies.length >= 1 },
      { id: 'kuschelkoenig', name: 'Kuschelkönig', desc: 'Herrscher über alle Plüshies.', unlockAchievement: 'plushie_all' },
      { id: 'kuschelmeister', name: 'Kuschelmeister', desc: 'Meister im Plüshie-Sammeln.', unlockCustom: ctx => ctx.ownedPlushies.length >= 4 },
      { id: 'goldjaeger', name: 'Goldjäger', desc: 'Exklusiv für Golden-Hour-Gewinner.', unlockCustom: ctx => ctx.wonGoldenHour },
      /* Feedback-Titel (5 pro Kategorie) - je einer pro Feedback-Erfolg
         derselben Kategorie, siehe BKMP_FEEDBACK_*_TIERS weiter oben. */
      { id: 'lobender', name: 'Der Lobende', desc: 'Findet gerne lobende Worte.', unlockAchievement: 'feedback_lob_1' },
      { id: 'anerkennend', name: 'Anerkennend', desc: 'Weiß gute Arbeit zu schätzen.', unlockAchievement: 'feedback_lob_3' },
      { id: 'wertschaetzer', name: 'Wertschätzer', desc: 'Ein echter Wertschätzer.', unlockAchievement: 'feedback_lob_5' },
      { id: 'lob_ikone', name: 'Lob-Ikone', desc: 'Bekannt für sein positives Feedback.', unlockAchievement: 'feedback_lob_10' },
      { id: 'legende_lob', name: 'Legende des Lobes', desc: 'Niemand lobt öfter.', unlockAchievement: 'feedback_lob_20' },
      { id: 'kritischer', name: 'Der Kritische', desc: 'Schaut immer ganz genau hin.', unlockAchievement: 'feedback_kritik_1' },
      { id: 'scharfzuengig', name: 'Scharfzüngig', desc: 'Nennt die Dinge beim Namen.', unlockAchievement: 'feedback_kritik_3' },
      { id: 'qualitaetspruefer', name: 'Qualitätsprüfer', desc: 'Lässt nichts durchgehen.', unlockAchievement: 'feedback_kritik_5' },
      { id: 'kritik_experte', name: 'Kritik-Experte', desc: 'Ein Profi im konstruktiven Feedback.', unlockAchievement: 'feedback_kritik_10' },
      { id: 'meister_kritik', name: 'Meister der Kritik', desc: 'Niemand kritisiert präziser.', unlockAchievement: 'feedback_kritik_20' },
      { id: 'ideenreicher', name: 'Der Ideenreiche', desc: 'Sprudelt nur so vor Ideen.', unlockAchievement: 'feedback_idee_1' },
      { id: 'vordenker', name: 'Vordenker', desc: 'Denkt immer einen Schritt voraus.', unlockAchievement: 'feedback_idee_3' },
      { id: 'konzeptkuenstler', name: 'Konzeptkünstler', desc: 'Entwirft ständig neue Konzepte.', unlockAchievement: 'feedback_idee_5' },
      { id: 'ideenschmied', name: 'Ideenschmied', desc: 'Schmiedet Ideen am laufenden Band.', unlockAchievement: 'feedback_idee_10' },
      { id: 'visionaer', name: 'Visionär', desc: 'Hat die Zukunft schon im Blick.', unlockAchievement: 'feedback_idee_20' },
      { id: 'mitteilsamer', name: 'Der Mitteilsame', desc: 'Hat immer etwas zu sagen.', unlockAchievement: 'feedback_sonstiges_1' },
      { id: 'vielschreiber', name: 'Vielschreiber', desc: 'Schreibt öfter mal eine Nachricht.', unlockAchievement: 'feedback_sonstiges_3' },
      { id: 'stammkommentator', name: 'Stammkommentator', desc: 'Meldet sich regelmäßig zu Wort.', unlockAchievement: 'feedback_sonstiges_5' },
      { id: 'wortgewaltig', name: 'Wortgewaltig', desc: 'Findet für alles die richtigen Worte.', unlockAchievement: 'feedback_sonstiges_10' },
      { id: 'feedback_legende', name: 'Feedback-Legende', desc: 'Der treueste Feedback-Geber überhaupt.', unlockAchievement: 'feedback_sonstiges_20' },
      ...BKMP_PLUSHIES.map(p => ({
        id: `plushie_fanboy_${p.id}`,
        name: `Maximaler ${p.name.replace(/\s*Plüshie$/i, '')} Fan`,
        desc: `Besitzt das ${p.name}.`,
        unlockAchievement: `plushie_${p.id}`
      })),
      ...(Array.isArray(window.BKMP_IDLE_TITLES) ? window.BKMP_IDLE_TITLES : [])
    ];
    }
    let BKMP_TITLES = bkmpBuildTitlesList();
    var bkmpAchievementSystemReady = true;
    function bkmpGetActiveTitle() {
      try { return localStorage.getItem(BKMP_ACTIVE_TITLE_KEY) || ''; } catch (e) { return ''; }
    }
    function bkmpSetActiveTitle(id) {
      try { localStorage.setItem(BKMP_ACTIVE_TITLE_KEY, id); } catch (e) {}
      renderAchievementBadge();
    }
    function bkmpTitleUnlocked(title, unlockedCount, ctx) {
      if (title.unlockAlways) return true;
      /* Bug-Fix 18.07. (Spieler-Meldung Kaledoss - siehe bkmpIdleTitleUnlockedSticky
         in idledorf.js fuer den vollen Kommentar): nicht-monotone unlockCustom-
         Bedingungen (z.B. "alle 6 Runen-Plaetze gleiche Raritaet ausgeruestet")
         fielen bisher wieder auf "gesperrt" zurueck, sobald sich der Zustand
         seither aenderte, obwohl der Titel dauerhaft bleiben sollte. */
      if (title.unlockCustom) {
        return typeof bkmpIdleTitleUnlockedSticky === 'function' ? bkmpIdleTitleUnlockedSticky(title, ctx) : Boolean(title.unlockCustom(ctx));
      }
      if (title.unlockAchievement) {
        const ach = BKMP_ACHIEVEMENTS.find(a => a.id === title.unlockAchievement);
        return ach ? bkmpAchievementUnlocked(ach, ctx) : false;
      }
      return unlockedCount >= (title.unlockAt || 0);
    }
    function bkmpGetActiveTitleName() {
      const activeId = bkmpGetActiveTitle();
      if (!activeId || activeId === 'none') return '';
      const title = BKMP_TITLES.find(t => t.id === activeId);
      return title ? title.name : '';
    }
    function renderTitlesPanel() {
      const ctx = bkmpAchievementContextWithMeta();
      const unlockedCount = BKMP_ACHIEVEMENTS.filter(a => bkmpAchievementUnlocked(a, ctx)).length;
      const active = bkmpGetActiveTitle() || 'none';
      const el = document.getElementById('titlesList');
      const newBadge = bkmpNewBadgeChecker('titles');
      el.innerHTML = BKMP_TITLES.map(t => {
        const unlocked = bkmpTitleUnlocked(t, unlockedCount, ctx);
        const isActive = active === t.id;
        const lockedHint = t.unlockAchievement ? 'Erst diesen Erfolg freischalten.' : (t.unlockCustom ? 'Noch nicht freigeschaltet.' : `Ab ${t.unlockAt} Erfolgen`);
        return `
          <button type="button" class="cosmetic-swatch ${unlocked ? '' : 'locked'} ${isActive ? 'active' : ''}" data-title-id="${escapeHtml(t.id)}" ${unlocked ? '' : 'disabled'}>
            ${newBadge(t.id)}
            <span class="cosmetic-swatch-name">${unlocked ? escapeHtml(t.name) : '🔒'}</span>
            <span class="cosmetic-swatch-desc">${unlocked ? escapeHtml(t.desc) : lockedHint}</span>
          </button>`;
      }).join('');
      el.querySelectorAll('.cosmetic-swatch:not(.locked)').forEach(btn => {
        btn.addEventListener('click', () => {
          bkmpSetActiveTitle(btn.dataset.titleId);
          renderTitlesPanel();
        });
      });
      bkmpMarkAllSeen('titles', BKMP_TITLES.map(t => t.id));
    }

    /* ---------------- Pluschies ---------------- */
    const BKMP_ACTIVE_PLUSHIE_KEY = 'bkmp-active-plushie';
    const BKMP_OWNED_PLUSHIES_CACHE_KEY = 'bkmp-owned-plushies-cache';
    /* Startet NICHT mehr leer, sondern mit dem zuletzt bekannten Besitz-
       Stand: bkmpRefreshOwnedPlushies() laedt den echten Stand erst async
       nach - bis dahin zaehlten alle Pluschie-Erfolge faelschlich als nicht
       freigeschaltet, wodurch die Erfolge-Zahl bei jedem Seitenaufruf kurz
       niedriger war und dann sprunghaft nachzog. */
    let bkmpOwnedPlushies = (() => {
      try { const cached = JSON.parse(localStorage.getItem(BKMP_OWNED_PLUSHIES_CACHE_KEY) || 'null'); return Array.isArray(cached) ? cached : []; } catch (e) { return []; }
    })();
    function bkmpGetActivePlushie() {
      try { return localStorage.getItem(BKMP_ACTIVE_PLUSHIE_KEY) || ''; } catch (e) { return ''; }
    }
    function bkmpSetActivePlushie(id) {
      try { localStorage.setItem(BKMP_ACTIVE_PLUSHIE_KEY, id); } catch (e) {}
      renderAchievementBadge();
    }
    /* Laedt die Pluschie-DEFINITIONEN (Name/Bild/Beschreibung) aus der
       Datenbank statt der festen JS-Liste, damit neue, per Admin-Panel
       gescannte Pluschies ohne Code-Aenderung auf der Seite auftauchen.
       Erfolge und Titel werden danach neu gebaut, weil sie pro Pluschie
       einen eigenen Eintrag erzeugen (siehe bkmpBuildAchievementsList /
       bkmpBuildTitlesList weiter oben). */
    async function bkmpRefreshPlushieDefinitions() {
      if (typeof loadPlushies !== 'function' || !bkmpGetSupabaseClient()) return;
      try {
        const rows = await loadPlushies();
        if (rows && rows.length > 0) {
          BKMP_PLUSHIES = rows;
          try { localStorage.setItem('bkmp-plushies-cache', JSON.stringify(rows)); } catch (e) {}
          BKMP_ACHIEVEMENTS = bkmpBuildAchievementsList();
          BKMP_TITLES = bkmpBuildTitlesList();
          renderAchievementBadge();
          const panel = document.getElementById('plushiesPanel');
          if (panel && panel.style.display !== 'none') renderPlushiesPanel();
        }
      } catch (e) {
        console.warn('Pluschie-Liste konnte nicht geladen werden.', e);
      }
    }
    async function bkmpRefreshOwnedPlushies() {
      const name = bkmpGetMcName();
      if (!name || typeof loadOwnedPlushies !== 'function' || !bkmpGetSupabaseClient()) return;
      try {
        const previousIds = bkmpOwnedPlushies.slice();
        let hadPreviousCache = false;
        try { hadPreviousCache = localStorage.getItem(BKMP_OWNED_PLUSHIES_CACHE_KEY) !== null; } catch (e) {}
        bkmpOwnedPlushies = await loadOwnedPlushies(name);
        try { localStorage.setItem(BKMP_OWNED_PLUSHIES_CACHE_KEY, JSON.stringify(bkmpOwnedPlushies)); } catch (e) {}
        renderAchievementBadge(true);
        const panel = document.getElementById('plushiesPanel');
        if (panel && panel.style.display !== 'none') renderPlushiesPanel();
        /* Phase 5.5 (19.07.), Abschnitt 13 "Titel/Skins/Prefixe/Plushies": bisher
           gab es fuer neu freigeschaltete Pluschies UEBERHAUPT keine aktive
           Meldung, nur den passiven "NEU"-Badge (bkmpNewBadgeChecker) beim
           spaeteren Oeffnen des Sammlung-Tabs. Nur feiern, wenn VORHER schon
           ein lokaler Cache-Stand existierte (sonst wuerde ein Erstbesuch auf
           einem neuen Geraet mit bereits 5 besessenen Pluschies faelschlich
           5 "NEU!"-Karten ausloesen - identisches Mass-Backfill-Problem wie
           bei Erfolgen, siehe bkmpCheckForNewAchievementUnlocks). Bestehende
           Besitz-Logik/Einloese-Codes bleiben unveraendert, hier wird nur die
           bereits berechnete Differenz anzeigt. */
        if (hadPreviousCache && typeof bkmpRewardPresent === 'function') {
          const newIds = bkmpOwnedPlushies.filter(id => !previousIds.includes(id));
          newIds.forEach(id => {
            const p = BKMP_PLUSHIES.find(pl => pl.id === id);
            if (!p) return;
            bkmpRewardPresent({
              tier: 'card',
              rarity: 'episch',
              icon: p.image ? `<img src="${escapeHtml(p.image)}" alt="" style="width:64px;height:64px;object-fit:contain;">` : '🧸',
              title: `Plüschie freigeschaltet: ${p.name}`,
              description: p.desc || '',
              source: 'Sammlung',
              dedupeKey: `plushie-${id}`
            });
          });
        }
      } catch (e) {
        console.warn('Konnte Pluschies nicht laden.', e);
      }
    }
    function renderPlushiesPanel() {
      const el = document.getElementById('plushiesList');
      if (!el) return;
      const active = bkmpGetActivePlushie();
      const newBadge = bkmpNewBadgeChecker('plushies');
      el.innerHTML = BKMP_PLUSHIES.map(p => {
        const unlocked = bkmpOwnedPlushies.includes(p.id);
        const isActive = active === p.id;
        return `
          <button type="button" class="cosmetic-swatch plushie-swatch ${unlocked ? '' : 'locked'} ${isActive ? 'active' : ''}" data-plushie-id="${escapeHtml(p.id)}" ${unlocked ? '' : 'disabled'}>
            ${newBadge(p.id)}
            ${unlocked ? `<img class="plushie-swatch-img" src="${escapeHtml(p.image)}" alt="" loading="lazy">` : '<span class="plushie-swatch-lock">🔒</span>'}
            <span class="cosmetic-swatch-name">${unlocked ? escapeHtml(p.name) : '???'}</span>
            <span class="cosmetic-swatch-desc">${unlocked ? escapeHtml(p.desc) : 'Nur per Code freischaltbar.'}</span>
          </button>`;
      }).join('');
      el.querySelectorAll('.plushie-swatch:not(.locked)').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.plushieId;
          bkmpSetActivePlushie(active === id ? '' : id);
          renderPlushiesPanel();
        });
      });
      bkmpMarkAllSeen('plushies', BKMP_PLUSHIES.map(p => p.id));
    }
    const plushieRedeemBtn = document.getElementById('plushieRedeemBtn');
    const plushieCodeInput = document.getElementById('plushieCodeInput');
    const plushieRedeemMsg = document.getElementById('plushieRedeemMsg');
    function bkmpShowPlushieMsg(text, isError) {
      if (!plushieRedeemMsg) return;
      plushieRedeemMsg.textContent = text;
      plushieRedeemMsg.classList.toggle('error', Boolean(isError));
      plushieRedeemMsg.classList.toggle('success', !isError);
    }
    if (plushieRedeemBtn && plushieCodeInput) {
      plushieRedeemBtn.addEventListener('click', async () => {
        const code = plushieCodeInput.value.trim();
        if (!code) { plushieCodeInput.focus(); return; }
        const name = bkmpGetMcName();
        if (!name) {
          bkmpShowPlushieMsg('Bitte trag zuerst deinen Minecraft-Namen ein.', true);
          return;
        }
        plushieRedeemBtn.disabled = true;
        plushieRedeemBtn.textContent = 'Wird geprüft...';
        bkmpShowPlushieMsg('', false);
        try {
          const { ok, body } = await redeemPlushieCode(code, name);
          if (ok && body.ok) {
            const plushie = BKMP_PLUSHIES.find(p => p.id === body.plushieId);
            bkmpShowPlushieMsg(`Du hast ${plushie ? plushie.name : 'einen neuen Plüshie'} freigeschaltet!`, false);
            plushieCodeInput.value = '';
            await bkmpRefreshOwnedPlushies();
            renderPlushiesPanel();
          } else {
            const errorMap = {
              invalid_code: 'Dieser Code ist ungültig.',
              already_redeemed: 'Dieser Code wurde bereits eingelöst.',
              already_owned: 'Du hast diesen Plüshie schon freigeschaltet.',
              missing_name: 'Bitte trag zuerst deinen Minecraft-Namen ein.',
              missing_code: 'Bitte gib einen Code ein.',
              missing_token: 'Bitte melde dich zuerst mit deinem Account an.',
              invalid_session: 'Deine Anmeldung ist abgelaufen - bitte melde dich erneut an.',
              not_registered: 'Bitte melde dich zuerst mit deinem Account an.'
            };
            bkmpShowPlushieMsg(errorMap[body.error] || 'Der Code konnte nicht eingelöst werden. Versuch es später erneut.', true);
          }
        } catch (e) {
          bkmpShowPlushieMsg('Verbindungsfehler. Versuch es später erneut.', true);
        }
        plushieRedeemBtn.disabled = false;
        plushieRedeemBtn.textContent = 'Einlösen';
      });
      plushieCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') plushieRedeemBtn.click(); });
    }

    /* ---------------- Daily Code Events + Golden Hour ---------------- */
    let bkmpDailyEventPollTimer = null;
    let bkmpDailyEventCountdownTimer = null;
    let bkmpCurrentDailyEvent = null;
    let bkmpDismissedDailyEventId = null;

    function bkmpStartDailyEventPolling() {
      bkmpPollDailyEvent();
      clearInterval(bkmpDailyEventPollTimer);
      /* Spieler-Meldung 20.07. ("Der ist erst 30 Sekunden spaeter aufgetaucht,
         obwohl Fenster offen war"): dieses Event ist ein "wer zuerst"-Rennen
         mit nur 3 Minuten Laufzeit (siehe api/active-daily-event.js) - im
         30s-Takt (Egress-Fix vom 17.07., davor 15s) verliert man das Rennen
         im schlimmsten Fall rein durch Polling-Timing, nicht durch
         tatsaechliche Reaktionsgeschwindigkeit. Echtzeit-Push (Supabase
         Realtime) geht hier bewusst NICHT - daily_code_events hat absichtlich
         KEINE anonyme Lese-Policy, damit niemand kuenftige Codes/Zeiten vorab
         sieht (siehe Kommentar dort); ein Realtime-Abo wuerde genau diesen
         Schutz aushebeln. Einzige verbleibende Stellschraube ist das
         Intervall selbst - Nutzer-Entscheidung 20.07.: 10s als Mittelweg
         (verdreifacht die Lesezugriffe ggue. 30s, bleibt aber unter dem
         alten 15s-Stand). */
      bkmpDailyEventPollTimer = setInterval(bkmpPollDailyEvent, 10000);
    }

    async function bkmpPollDailyEvent() {
      try {
        const res = await fetch('/api/active-daily-event');
        if (!res.ok) return;
        const body = await res.json();
        if (body.active) {
          bkmpHandleActiveDailyEvent(body.event);
        } else {
          bkmpCloseDailyEventPopup();
        }
      } catch (e) { /* still offline/unreachable - einfach beim naechsten Poll erneut versuchen */ }
    }

    function bkmpHandleActiveDailyEvent(event) {
      const already = document.getElementById('bkmpDailyPopup');
      if (already && bkmpCurrentDailyEvent && bkmpCurrentDailyEvent.id === event.id) {
        bkmpCurrentDailyEvent = event;
        bkmpUpdateDailyEventWinState(event);
        return;
      }
      if (event.id === bkmpDismissedDailyEventId) return;
      bkmpCurrentDailyEvent = event;
      bkmpShowDailyEventPopup(event);
    }

    function bkmpCloseDailyEventPopup() {
      const popup = document.getElementById('bkmpDailyPopup');
      if (popup) popup.remove();
      clearInterval(bkmpDailyEventCountdownTimer);
      bkmpCurrentDailyEvent = null;
    }

    function bkmpDismissDailyEventPopup() {
      if (bkmpCurrentDailyEvent) bkmpDismissedDailyEventId = bkmpCurrentDailyEvent.id;
      bkmpCloseDailyEventPopup();
    }

    function bkmpShowDailyEventPopup(event) {
      bkmpCloseDailyEventPopup();
      bkmpCurrentDailyEvent = event;
      const plushie = BKMP_PLUSHIES.find(p => p.id === event.plushieId);
      const popup = document.createElement('div');
      popup.id = 'bkmpDailyPopup';
      popup.className = 'bkmp-daily-popup-backdrop';
      popup.innerHTML = `
        <div class="bkmp-daily-popup-card${event.isGoldenHour ? ' golden-hour' : ''}">
          <div class="bkmp-daily-popup-particles"></div>
          ${event.isGoldenHour ? '<div class="bkmp-daily-popup-ribbon">⭐ GOLDEN HOUR ⭐</div>' : ''}
          <button type="button" class="bkmp-daily-popup-close" id="bkmpDailyPopupClose" aria-label="Schließen">&times;</button>
          <div class="bkmp-daily-popup-icon">${event.isGoldenHour ? '👑' : '✨'}</div>
          <h3>Ein geheimer Creator-Code wurde entdeckt!</h3>
          <p class="bkmp-daily-popup-sub">Nur der ALLERERSTE Spieler erhält dieses Plüshie!</p>
          ${plushie ? `<div class="bkmp-daily-popup-plushie"><img src="${escapeHtml(plushie.image)}" alt=""><span>${escapeHtml(plushie.name)}</span></div>` : ''}
          <div class="bkmp-daily-popup-code">${escapeHtml(event.code)}</div>
          <div class="bkmp-daily-popup-countdown">⏳ Noch <span id="bkmpDailyCountdown">03:00</span> verfügbar!</div>
          <button type="button" class="bkmp-daily-popup-claim" id="bkmpDailyClaimBtn">Jetzt sichern!</button>
          <p class="bkmp-daily-popup-msg" id="bkmpDailyPopupMsg"></p>
        </div>
      `;
      document.body.appendChild(popup);
      requestAnimationFrame(() => popup.classList.add('visible'));

      const particles = popup.querySelector('.bkmp-daily-popup-particles');
      if (particles) {
        particles.innerHTML = Array.from({ length: 18 }, () => {
          const left = Math.round(Math.random() * 100);
          const delay = (Math.random() * 3).toFixed(2);
          const duration = (2.4 + Math.random() * 2).toFixed(2);
          return `<span style="left:${left}%; animation-delay:${delay}s; animation-duration:${duration}s;"></span>`;
        }).join('');
      }

      document.getElementById('bkmpDailyPopupClose').addEventListener('click', bkmpDismissDailyEventPopup);
      document.getElementById('bkmpDailyClaimBtn').addEventListener('click', bkmpClaimDailyEvent);

      bkmpUpdateDailyEventWinState(event);
      bkmpTickDailyEventCountdown();
      clearInterval(bkmpDailyEventCountdownTimer);
      bkmpDailyEventCountdownTimer = setInterval(bkmpTickDailyEventCountdown, 1000);
    }

    function bkmpTickDailyEventCountdown() {
      if (!bkmpCurrentDailyEvent) return;
      const remainingMs = new Date(bkmpCurrentDailyEvent.expiresAt).getTime() - Date.now();
      const label = document.getElementById('bkmpDailyCountdown');
      if (remainingMs <= 0) {
        bkmpCloseDailyEventPopup();
        return;
      }
      const totalSeconds = Math.ceil(remainingMs / 1000);
      const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const ss = String(totalSeconds % 60).padStart(2, '0');
      if (label) label.textContent = `${mm}:${ss}`;
    }

    function bkmpUpdateDailyEventWinState(event) {
      const claimBtn = document.getElementById('bkmpDailyClaimBtn');
      const msg = document.getElementById('bkmpDailyPopupMsg');
      if (!claimBtn || !msg) return;
      if (event.won) {
        claimBtn.style.display = 'none';
        const isMe = bkmpGetMcName() && event.winnerDisplayName && bkmpGetMcName().trim().toLowerCase() === event.winnerDisplayName.trim().toLowerCase();
        msg.textContent = isMe
          ? 'Glückwunsch! Du warst der Erste und hast das Plüshie erhalten! 🎉'
          : `Leider war jemand schneller. (${event.winnerDisplayName} hat gewonnen)`;
        msg.classList.toggle('success', Boolean(isMe));
        msg.classList.toggle('error', !isMe);
      } else {
        claimBtn.style.display = '';
        msg.textContent = '';
        msg.classList.remove('success', 'error');
      }
    }

    async function bkmpClaimDailyEvent() {
      if (!bkmpCurrentDailyEvent) return;
      const name = bkmpGetMcName();
      const msg = document.getElementById('bkmpDailyPopupMsg');
      if (!name) {
        if (msg) { msg.textContent = 'Bitte trag zuerst deinen Minecraft-Namen ein.'; msg.classList.add('error'); }
        return;
      }
      const btn = document.getElementById('bkmpDailyClaimBtn');
      btn.disabled = true;
      btn.textContent = 'Wird gesichert...';
      try {
        /* Sicherheits-Nachtrag (Audit 15.07.): api/redeem-daily-event.js
           prueft den Aufrufer jetzt serverseitig ueber dieses Access-
           Token - verhindert, dass jemand einen fremden Sieg unter dem
           Namen eines anderen Spielers eintraegt. */
        const session = typeof bkmpGetPlayerSession === 'function' ? await bkmpGetPlayerSession() : null;
        const accessToken = session ? session.access_token : null;
        if (!accessToken) {
          if (msg) { msg.textContent = 'Bitte melde dich zuerst mit deinem Account an.'; msg.classList.add('error'); }
          btn.disabled = false;
          btn.textContent = 'Jetzt sichern!';
          return;
        }
        const res = await fetch('/api/redeem-daily-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ eventId: bkmpCurrentDailyEvent.id, playerName: name })
        });
        const body = await res.json();
        if (res.ok && body.ok) {
          const wins = bkmpGetDailyEventWins() + 1;
          try { localStorage.setItem('bkmp-daily-event-wins', String(wins)); } catch (e) {}
          if (body.isGoldenHour) { try { localStorage.setItem('bkmp-won-golden-hour', '1'); } catch (e) {} }
          await bkmpRefreshOwnedPlushies();
          renderAchievementBadge();
          bkmpCurrentDailyEvent.won = true;
          bkmpCurrentDailyEvent.winnerDisplayName = name;
          bkmpUpdateDailyEventWinState(bkmpCurrentDailyEvent);
        } else if (body.error === 'already_won') {
          bkmpCurrentDailyEvent.won = true;
          bkmpCurrentDailyEvent.winnerDisplayName = body.winnerDisplayName || '???';
          bkmpUpdateDailyEventWinState(bkmpCurrentDailyEvent);
        } else if (body.error === 'expired') {
          if (msg) { msg.textContent = 'Das Event ist leider schon abgelaufen.'; msg.classList.add('error'); }
        } else {
          if (msg) { msg.textContent = 'Etwas ist schiefgelaufen. Versuch es erneut.'; msg.classList.add('error'); }
        }
      } catch (e) {
        if (msg) { msg.textContent = 'Verbindungsfehler. Versuch es erneut.'; msg.classList.add('error'); }
      }
      btn.disabled = false;
      btn.textContent = 'Jetzt sichern!';
    }

    bkmpStartDailyEventPolling();

    /* Test-Vorschau fuers Admin-Panel: /?testDailyPopup=1 oeffnet das Popup
       mit Beispieldaten, ganz ohne echtes Event/DB-Zugriff. */
    if (new URLSearchParams(window.location.search).get('testDailyPopup') === '1') {
      const testPlushie = BKMP_PLUSHIES[0];
      bkmpShowDailyEventPopup({
        id: 'test-preview',
        code: 'BKMP-TEST-DEMO',
        plushieId: testPlushie ? testPlushie.id : '',
        isGoldenHour: new URLSearchParams(window.location.search).get('golden') === '1',
        expiresAt: new Date(Date.now() + 3 * 60000).toISOString(),
        won: false
      });
      const claimBtn = document.getElementById('bkmpDailyClaimBtn');
      if (claimBtn) claimBtn.addEventListener('click', e => {
        e.stopImmediatePropagation();
        const msg = document.getElementById('bkmpDailyPopupMsg');
        if (msg) { msg.textContent = 'Das ist nur eine Vorschau – hier passiert nichts Echtes.'; }
      }, true);
    }

    /* ---------------- Bestenliste ---------------- */
    let bkmpLeaderboardStats = [];
    let bkmpActiveLeaderboardTab = 'achievements';

    function bkmpAggregateSubmissions(items, nameKey) {
      const counts = new Map();
      (items || []).forEach(item => {
        const name = (item[nameKey] || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!counts.has(key)) counts.set(key, { name, value: 0 });
        counts.get(key).value += 1;
      });
      return [...counts.values()].sort((a, b) => b.value - a.value);
    }

    function renderLeaderboard() {
      const list = document.getElementById('leaderboardList');
      if (!list) return;
      const myName = bkmpGetMcName().trim().toLowerCase();

      let rows;
      let valueLabel;
      if (bkmpActiveLeaderboardTab === 'achievements') {
        rows = bkmpLeaderboardStats.map(s => ({ name: s.name, value: s.achievementsUnlocked })).sort((a, b) => b.value - a.value);
        valueLabel = v => `${v} Erfolge`;
      } else if (bkmpActiveLeaderboardTab === 'time') {
        rows = bkmpLeaderboardStats.map(s => ({ name: s.name, value: s.minutesSpent })).sort((a, b) => b.value - a.value);
        valueLabel = v => `${v} Min.`;
      } else if (bkmpActiveLeaderboardTab === 'bonks') {
        rows = bkmpLeaderboardStats.map(s => ({ name: s.name, value: s.bonkCount || 0 })).sort((a, b) => b.value - a.value);
        valueLabel = v => `${bkmpFormatBonkCount(v)} Bonk${v === 1 ? '' : 's'}`;
      } else if (bkmpActiveLeaderboardTab === 'cards') {
        rows = bkmpAggregateSubmissions(data.cardCatalog, 'submittedBy');
        valueLabel = v => `${v} Karte${v === 1 ? '' : 'n'}`;
      } else {
        rows = bkmpAggregateSubmissions(data.wishes, 'name');
        valueLabel = v => `${v} Kartenidee${v === 1 ? '' : 'n'}`;
      }

      rows = rows.filter(r => r.value > 0).slice(0, 100);

      if (rows.length === 0) {
        list.innerHTML = '<p class="empty-hint">Noch keine Daten für diese Bestenliste.</p>';
        return;
      }

      list.innerHTML = rows.map((row, i) => {
        const isMe = Boolean(myName) && row.name.trim().toLowerCase() === myName;
        const stat = bkmpLeaderboardStats.find(s => s.name.trim().toLowerCase() === row.name.trim().toLowerCase());
        const title = stat && stat.activeTitle ? stat.activeTitle : '';
        /* Nicht direkt aus stat.activeCosmetic in die Klasse interpolieren -
           das kommt aus player_stats und ist damit ueber die Supabase-API
           theoretisch von jedem eingeloggten Nutzer auf einen beliebigen
           String setzbar (die UI beschraenkt nur die eigene Auswahl, nicht
           was serverseitig ankommt). Erst gegen die bekannte Kosmetik-Liste
           pruefen (wie schon in bkmpApplyActiveCosmetic) - alles andere
           landet sonst ungeescaped in einem class-Attribut und koennte bei
           einem passend gewaehlten String daraus ausbrechen. */
        const knownCosmetic = stat && stat.activeCosmetic && stat.activeCosmetic !== 'default'
          ? BKMP_COSMETICS.find(c => c.id === stat.activeCosmetic)
          : null;
        const cosmeticCls = knownCosmetic ? ` mc-cosmetic-${knownCosmetic.id}` : '';
        const plushie = stat && stat.activePlushie ? BKMP_PLUSHIES.find(p => p.id === stat.activePlushie) : null;
        const plushieImg = plushie ? `<img src="${escapeHtml(plushie.image)}" alt="" class="leaderboard-plushie" title="${escapeHtml(plushie.name)}">` : '';
        const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
        const medal = bkmpUiMedal(i);
        return `
          <div class="leaderboard-row ${rankClass} ${isMe ? 'is-me' : ''}">
            <span class="leaderboard-rank">${medal}</span>
            <span class="leaderboard-name leaderboard-name-clickable" data-profile-name="${escapeHtml(row.name)}">
              ${plushieImg}<span class="leaderboard-name-wrap${cosmeticCls}"><span class="leaderboard-name-text">${escapeHtml(row.name)}</span></span>${title ? `<span class="leaderboard-title">${escapeHtml(title)}</span>` : ''}
            </span>
            <span class="leaderboard-value">${valueLabel(row.value)}</span>
          </div>`;
      }).join('');
      list.querySelectorAll('.leaderboard-name-clickable').forEach(el => {
        el.addEventListener('click', () => bkmpShowPlayerProfile(el.dataset.profileName));
      });
    }

    /* Baut das Profil-Popup rein aus bereits geladenen bkmpLeaderboardStats -
       kein zusaetzlicher Request pro Klick. Faellt ein Spieler nicht in
       bkmpLeaderboardStats (z. B. noch nie eingeloggt, nur ueber Karten/
       Kartenideen aufgetaucht), wird ein Hinweis statt leerer Werte gezeigt. */
    function bkmpShowPlayerProfile(name) {
      const overlay = document.getElementById('playerProfileOverlay');
      if (!overlay || !name) return;
      const stat = bkmpLeaderboardStats.find(s => (s.name || '').trim().toLowerCase() === name.trim().toLowerCase());

      const nameWrap = document.getElementById('playerProfileNameWrap');
      const knownCosmetic = stat && stat.activeCosmetic && stat.activeCosmetic !== 'default'
        ? BKMP_COSMETICS.find(c => c.id === stat.activeCosmetic)
        : null;
      nameWrap.className = 'leaderboard-name-wrap' + (knownCosmetic ? ` mc-cosmetic-${knownCosmetic.id}` : '');
      nameWrap.textContent = name;

      const titleEl = document.getElementById('playerProfileTitle');
      titleEl.textContent = stat && stat.activeTitle ? stat.activeTitle : '';
      titleEl.style.display = stat && stat.activeTitle ? '' : 'none';

      const plushieEl = document.getElementById('playerProfilePlushie');
      const plushie = stat && stat.activePlushie ? BKMP_PLUSHIES.find(p => p.id === stat.activePlushie) : null;
      plushieEl.innerHTML = plushie ? `<img src="${escapeHtml(plushie.image)}" alt="" title="${escapeHtml(plushie.name)}">` : '🙂';

      const statsEl = document.getElementById('playerProfileStats');
      if (!stat) {
        statsEl.innerHTML = '<p class="empty-hint">Für diesen Spieler liegen noch keine Erfolge-Daten vor.</p>';
      } else {
        statsEl.innerHTML = `
          <div class="player-profile-stat"><span>🥊 Bonks</span><strong>${bkmpFormatBonkCount(stat.bonkCount || 0)}</strong></div>
          <div class="player-profile-stat"><span>⏱️ Zeit verbracht</span><strong>${stat.minutesSpent || 0} Min.</strong></div>
          <div class="player-profile-stat"><span>🏆 Erfolge</span><strong>${stat.achievementsUnlocked || 0}</strong></div>
          <div class="player-profile-stat"><span>📅 Besuchte Tage</span><strong>${(stat.daysVisited || []).length}</strong></div>
          <div class="player-profile-stat"><span>🥚 Ostereier</span><strong>${(stat.eggsFound || []).length}</strong></div>
        `;
      }
      overlay.classList.add('visible');
    }
    const playerProfileCloseBtn = document.getElementById('playerProfileClose');
    if (playerProfileCloseBtn) playerProfileCloseBtn.addEventListener('click', () => {
      document.getElementById('playerProfileOverlay').classList.remove('visible');
    });

    async function refreshLeaderboardData() {
      if (typeof loadLeaderboardStats !== 'function' || !bkmpGetSupabaseClient()) { renderLeaderboard(); return; }
      try {
        const stats = await loadLeaderboardStats();
        if (stats) bkmpLeaderboardStats = stats.filter(s => !bkmpIsHiddenTestAccount(s.name));
      } catch (e) {
        console.warn('Bestenliste konnte nicht geladen werden.', e);
      }
      renderLeaderboard();
      /* Bug-Report (15.07.): laedt die Seite direkt auf dem Bestenliste-Tab
         (sessionStorage-Wiederherstellung nach Reload), laeuft goTo() beim
         initialen Laden VOR dieser echten Netzwerkantwort - .panels-viewport
         bleibt dann auf der Hoehe der (fast leeren) Platzhalter-Liste
         eingefroren, obwohl jetzt viel mehr Zeilen drin stehen ("klappt nach
         unten nicht mehr auf"). Hoehe hier nochmal frisch nachziehen, sobald
         die echten Daten wirklich da sind. */
      if (typeof bkmpSyncPanelHeight === 'function') bkmpSyncPanelHeight();
    }

    document.querySelectorAll('.leaderboard-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.leaderboard-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        bkmpActiveLeaderboardTab = btn.dataset.board;
        renderLeaderboard();
      });
    });

    function bkmpNameTier(unlockedCount) {
      if (unlockedCount >= 60) return 3;
      if (unlockedCount >= 25) return 2;
      if (unlockedCount >= 8) return 1;
      return 0;
    }

    function renderAchievementBadge(force) {
      const badge = document.getElementById('mcNameBadge');
      const badgeText = document.getElementById('mcNameBadgeText');
      const badgeIcon = document.getElementById('mcNameBadgeIcon');
      if (!badge || !badgeText) return;
      const name = bkmpGetMcName();
      badge.classList.remove('tier-1', 'tier-2', 'tier-3');
      /* Ohne eingeloggten Account werden Erfolge bewusst NICHT berechnet,
         benachrichtigt oder als Kosmetik angewendet - Fortschritt (Zeit,
         Bonks, Ostereier etc.) sammelt sich zwar weiter lokal, "freigeschaltet"
         wird aber erst sichtbar, sobald ein echter Account existiert. Sobald
         eingeloggt wird, zaehlt der bisher gesammelte lokale Fortschritt
         sofort mit (nichts geht verloren) - nur die Anzeige/Benachrichtigung
         war vorher gesperrt. */
      if (!name) {
        badgeText.textContent = 'Wer bist du?';
        badge.title = '';
        if (badgeIcon) badgeIcon.innerHTML = '⛏️';
        /* Kosmetik-Klasse von einer vorherigen (eingeloggten) Session
           entfernen - sonst bliebe z. B. ein Erfolgs-Glow nach dem
           Ausloggen sichtbar, obwohl gerade kein Account aktiv ist. */
        [...badge.classList].filter(c => c.startsWith('mc-cosmetic-')).forEach(c => badge.classList.remove(c));
        return;
      }
      const ctx = bkmpAchievementContextWithMeta();
      const unlockedCount = BKMP_ACHIEVEMENTS.filter(a => bkmpAchievementUnlocked(a, ctx)).length;
      if (bkmpAchievementNotifyReady && typeof bkmpCheckForNewAchievementUnlocks === 'function') bkmpCheckForNewAchievementUnlocks(ctx);
      bkmpApplyActiveCosmetic(badge, unlockedCount, ctx);
      const activePlushieId = typeof bkmpGetActivePlushie === 'function' ? bkmpGetActivePlushie() : '';
      const activePlushie = activePlushieId && ctx.ownedPlushies.includes(activePlushieId) ? BKMP_PLUSHIES.find(p => p.id === activePlushieId) : null;
      if (badgeIcon) {
        badgeIcon.innerHTML = activePlushie
          ? `<img src="${escapeHtml(activePlushie.image)}" alt="" class="mc-name-badge-plushie">`
          : '⛏️';
      }
      const activeTitleName = typeof bkmpGetActiveTitleName === 'function' ? bkmpGetActiveTitleName() : '';
      badgeText.textContent = `${name}${activeTitleName ? ' — ' + activeTitleName : ''} · ${unlockedCount}/${BKMP_ACHIEVEMENTS.length}`;
      badge.title = 'Deine Erfolge ansehen';
      const activeCosmetic = bkmpGetActiveCosmetic();
      if (!activeCosmetic || activeCosmetic === 'default') {
        const tier = bkmpNameTier(unlockedCount);
        if (tier > 0) badge.classList.add('tier-' + tier);
      }
      /* force=true fuer die Selbstkorrektur-Aufrufe, NACHDEM Pluschies/
         Idle-Dorf-Felder im Hintergrund fertig nachgeladen sind (siehe
         bkmpRefreshOwnedPlushies/bkmpIdlePreloadStateIfNamed) - sonst wuerde
         der davor schon (mit dem noch unvollstaendigen, zu niedrigen
         Zaehler) erfolgte Login-Sync den 45s-Throttle auf den naechsten
         Sync legen und genau den korrigierten, richtigen Wert verschlucken.
         Live beobachtet: frischer/inkognito Login zeigte kurz einen viel zu
         niedrigen Erfolge-Zaehler an, der ohne dieses Erzwingen dauerhaft in
         der Datenbank haengen geblieben waere. */
      if (typeof bkmpSyncPlayerStats === 'function') bkmpSyncPlayerStats(unlockedCount, force);
    }

    const BKMP_ACHIEVEMENT_CATEGORY_ORDER = ['Karten', 'Kartenideen', 'Zeit & Treue', 'Vielfalt', 'Bonk', 'Idle Dorf', 'Runen', 'Weltboss', 'Arena', 'Plüshies', 'Meilensteine', 'Easter Eggs', 'Sonstiges'];
    const bkmpAchievementCategoryOpen = {};

    function bkmpFormatRelativeTime(iso) {
      const then = new Date(iso).getTime();
      if (isNaN(then)) return null;
      const diffMs = Date.now() - then;
      const minutes = Math.floor(diffMs / 60000);
      if (minutes < 1) return 'gerade eben';
      if (minutes < 60) return `vor ${minutes} Minute${minutes === 1 ? '' : 'n'}`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `vor ${hours} Stunde${hours === 1 ? '' : 'n'}`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `vor ${days} Tag${days === 1 ? '' : 'en'}`;
      return new Date(iso).toLocaleDateString('de-DE');
    }

    function renderAchievementsPanel() {
      const ctx = bkmpAchievementContextWithMeta();
      const list = document.getElementById('achievementsList');
      const unlockedCount = BKMP_ACHIEVEMENTS.filter(a => bkmpAchievementUnlocked(a, ctx)).length;
      const unlockedAtMap = bkmpGetAchievementUnlockedAtMap();
      const latestUnlockIso = Object.values(unlockedAtMap).sort().pop();
      const latestSuffix = latestUnlockIso ? ` Zuletzt freigeschaltet: ${bkmpFormatRelativeTime(latestUnlockIso)}.` : '';
      document.getElementById('achievementsSummary').textContent = `${unlockedCount} von ${BKMP_ACHIEVEMENTS.length} Erfolgen freigeschaltet.${latestSuffix}`;

      const newAchievementBadge = bkmpNewBadgeChecker('achievements');
      list.innerHTML = BKMP_ACHIEVEMENT_CATEGORY_ORDER.map(category => {
        const items = BKMP_ACHIEVEMENTS.filter(a => a.category === category);
        if (items.length === 0) return '';
        const unlockedInCategory = items.filter(a => bkmpAchievementUnlocked(a, ctx)).length;
        const isOpen = bkmpAchievementCategoryOpen[category] || false;
        const rows = items.map(a => {
          const unlocked = bkmpAchievementUnlocked(a, ctx);
          const progress = a.progress ? a.progress(ctx) : null;
          const progressHtml = progress ? `
            <div class="achievement-progress"><div class="achievement-progress-bar" style="width:${Math.min(100, (progress[0] / progress[1]) * 100)}%"></div></div>
            <span class="achievement-progress-label">${Math.min(progress[0], progress[1])}/${progress[1]}</span>` : '';
          const displayTitle = unlocked && a.revealName ? a.revealName : a.title;
          const unlockedAtLabel = unlocked ? (bkmpFormatAchievementUnlockedAt(a.id) || 'Datum unbekannt') : '';
          return `
            <div class="achievement-row ${unlocked ? 'unlocked' : 'locked'}">
              ${newAchievementBadge(a.id)}
              <span class="achievement-icon">${unlocked ? '✅' : '🔒'}</span>
              <div class="achievement-body">
                <div class="achievement-title">${escapeHtml(displayTitle)}</div>
                <div class="achievement-desc">${a.hint ? escapeHtml(a.hint) : escapeHtml(a.desc)}</div>
                ${unlocked ? `<div class="achievement-unlocked-at">Freigeschaltet am ${escapeHtml(unlockedAtLabel)}</div>` : ''}
                ${progressHtml}
              </div>
            </div>`;
        }).join('');
        return `
          <div class="achievement-category">
            <button type="button" class="achievement-category-head" data-category="${escapeHtml(category)}">
              <span class="achievement-category-toggle">${isOpen ? '▾' : '▸'}</span>
              <span class="achievement-category-title">${escapeHtml(category)}</span>
              <span class="achievement-category-count">${unlockedInCategory}/${items.length}</span>
            </button>
            <div class="achievement-category-body" ${isOpen ? '' : 'style="display:none;"'}>${rows}</div>
          </div>`;
      }).join('');

      list.querySelectorAll('.achievement-category-head').forEach(btn => {
        btn.addEventListener('click', () => {
          const category = btn.dataset.category;
          bkmpAchievementCategoryOpen[category] = !bkmpAchievementCategoryOpen[category];
          renderAchievementsPanel();
        });
      });
      bkmpMarkAllSeen('achievements', BKMP_ACHIEVEMENTS.map(a => a.id));
    }

    const mcNameOverlay = document.getElementById('mcNameOverlay');
    const mcNameBadge = document.getElementById('mcNameBadge');
    const achievementsOverlay = document.getElementById('achievementsOverlay');

    /* ---------------- Login/Registrieren ("Wer bist du?") ---------------- */
    const mcAuthTitle = document.getElementById('mcAuthTitle');
    const mcAuthSubtitle = document.getElementById('mcAuthSubtitle');
    const mcAuthName = document.getElementById('mcAuthName');
    const mcAuthPassword = document.getElementById('mcAuthPassword');
    const mcAuthPasswordLabel = document.getElementById('mcAuthPasswordLabel');
    const mcAuthPasswordRepeatField = document.getElementById('mcAuthPasswordRepeatField');
    const mcAuthPasswordRepeat = document.getElementById('mcAuthPasswordRepeat');
    const mcAuthError = document.getElementById('mcAuthError');
    const mcAuthSubmit = document.getElementById('mcAuthSubmit');
    const mcAuthSwitchBtn = document.getElementById('mcAuthSwitchBtn');
    let mcAuthMode = 'login';

    function mcAuthShowError(message) {
      mcAuthError.textContent = message || '';
      mcAuthError.style.display = message ? '' : 'none';
    }

    function mcAuthApplyMode() {
      mcAuthShowError('');
      if (mcAuthMode === 'register') {
        mcAuthTitle.textContent = 'Wer bist du?';
        mcAuthSubtitle.textContent = 'Erstelle einen Account, damit dein Fortschritt (Erfolge, Idle-Dorf, Plüschies) auf Handy, Laptop und PC gleich bleibt.';
        mcAuthPasswordLabel.textContent = 'Passwort erstellen';
        mcAuthPasswordRepeatField.style.display = '';
        mcAuthSubmit.textContent = 'Account erstellen';
        mcAuthSwitchBtn.textContent = 'Du hast dich schon registriert? Hier anmelden';
      } else {
        mcAuthTitle.textContent = 'Anmelden';
        mcAuthSubtitle.textContent = 'Melde dich mit deinem Ingame-Namen und Passwort an.';
        mcAuthPasswordLabel.textContent = 'Passwort';
        mcAuthPasswordRepeatField.style.display = 'none';
        mcAuthSubmit.textContent = 'Anmelden';
        mcAuthSwitchBtn.textContent = 'Noch keinen Account? Registrieren';
      }
    }

    function mcAuthResetForm() {
      mcAuthMode = 'login';
      mcAuthName.value = '';
      mcAuthPassword.value = '';
      mcAuthPasswordRepeat.value = '';
      mcAuthApplyMode();
    }

    if (mcAuthSwitchBtn) {
      mcAuthSwitchBtn.addEventListener('click', () => {
        mcAuthMode = mcAuthMode === 'register' ? 'login' : 'register';
        mcAuthApplyMode();
      });
    }

    function mcAuthSetupPasswordToggle(inputId, btnId) {
      const input = document.getElementById(inputId);
      const btn = document.getElementById(btnId);
      if (!input || !btn) return;
      btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.innerHTML = show ? '&#128584;' : '&#128065;';
        btn.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
      });
    }
    mcAuthSetupPasswordToggle('mcAuthPassword', 'mcAuthPasswordToggle');
    mcAuthSetupPasswordToggle('mcAuthPasswordRepeat', 'mcAuthPasswordRepeatToggle');

    async function mcAuthSubmitHandler() {
      const name = mcAuthName.value.trim();
      const password = mcAuthPassword.value;
      if (!name) { mcAuthShowError('Bitte deinen Ingame-Namen eintragen.'); mcAuthName.focus(); return; }
      if (!password) { mcAuthShowError('Bitte ein Passwort eintragen.'); mcAuthPassword.focus(); return; }
      if (mcAuthMode === 'register' && password !== mcAuthPasswordRepeat.value) {
        mcAuthShowError('Die Passwörter stimmen nicht überein.');
        mcAuthPasswordRepeat.focus();
        return;
      }
      mcAuthShowError('');
      mcAuthSubmit.disabled = true;
      const originalLabel = mcAuthSubmit.textContent;
      mcAuthSubmit.textContent = 'Wird geladen...';
      /* Bug-Report 17.07. (ByAlex0/ChronoKora): Account auf dem Handy
         gewechselt (zweiten Account angelegt, dann zurueck auf den
         Hauptaccount eingeloggt) - danach war der Hauptaccount auf einen
         quasi frischen Spielstand zurueckgesetzt (Level 13 statt hoch
         entwickelt, Prestige/Runen/Erfolge in ihren EIGENEN Tabellen aber
         unangetastet - per Live-DB-Check bestaetigt). Ursache: der Idle-Dorf-
         Kampf-Loop laeuft bewusst im Hintergrund weiter, auch bei
         geschlossenem Fenster (siehe bkmpIdleCloseModal) - signInWithPassword/
         signUp tauschen die Supabase-Session sofort aus, OHNE dass
         bkmpIdleState/bkmpPrestigeState (noch vom VORHERIGEN Account im
         Speicher) je zurueckgesetzt werden. Der naechste Autosave speichert
         dann den alten In-Memory-Spielstand unter der NEUEN Session, also im
         Datensatz des gerade aktiven Accounts. Fix: vor dem eigentlichen
         Login/Registrieren den Spielstand des BISHERIGEN Accounts (falls
         einer aktiv war) noch unter dessen eigener, noch gueltiger Session
         final speichern und den Kampf-Loop stoppen; wechselt der Name danach
         wirklich, per vollem Reload neu starten statt in-place
         weiterzumachen - garantiert einen sauberen Zustand fuer JEDES
         Account-gebundene Feature (Raid, Gilde, Arena, ...), nicht nur fuers
         Idle-Dorf. */
      const previousName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
      if (previousName) {
        if (typeof bkmpIdleStopLoop === 'function') bkmpIdleStopLoop();
        if (typeof bkmpIdleFlushSync === 'function') { try { await bkmpIdleFlushSync(); } catch (e) {} }
        if (typeof bkmpPrestigeFlushSyncNow === 'function') { try { await bkmpPrestigeFlushSyncNow(); } catch (e) {} }
      }
      try {
        const result = mcAuthMode === 'register'
          ? await bkmpPlayerRegister(name, password)
          : await bkmpPlayerLogin(name, password);
        const canonicalName = await bkmpMergeRemoteStatsIntoLocal(result.displayName);
        if (previousName && previousName.trim().toLowerCase() !== canonicalName.trim().toLowerCase()) {
          bkmpSetMcName(canonicalName);
          location.reload();
          return;
        }
        bkmpAchievementNotifyReady = false;
        bkmpSetMcName(canonicalName);
        bkmpClaimAndWatchSession(canonicalName, true);
        mcNameOverlay.classList.remove('visible');
        renderAchievementBadge();
        bkmpRefreshOwnedPlushies();
        bkmpRefreshMyWishVotes();
        if (typeof bkmpSpawnDerLiberFigures === 'function') bkmpSpawnDerLiberFigures();
        window.setTimeout(() => {
          bkmpAchievementNotifyReady = true;
          renderAchievementBadge(true);
        }, 3000);
      } catch (e) {
        mcAuthShowError(e && e.message ? e.message : 'Das hat leider nicht geklappt. Bitte versuche es erneut.');
      } finally {
        mcAuthSubmit.disabled = false;
        mcAuthSubmit.textContent = originalLabel;
      }
    }

    if (mcAuthSubmit) mcAuthSubmit.addEventListener('click', mcAuthSubmitHandler);
    [mcAuthName, mcAuthPassword, mcAuthPasswordRepeat].forEach(input => {
      if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') mcAuthSubmitHandler(); });
    });

    if (mcNameBadge) {
      mcNameBadge.addEventListener('click', () => {
        if (bkmpGetMcName()) {
          bkmpTrackPanelOpen();
          document.getElementById('achievementsSubtabAchievements').classList.add('active');
          document.getElementById('achievementsSubtabCosmetics').classList.remove('active');
          document.getElementById('achievementsSubtabTitles').classList.remove('active');
          document.getElementById('achievementsSubtabPlushies').classList.remove('active');
          document.getElementById('achievementsList').style.display = '';
          document.getElementById('cosmeticsList').style.display = 'none';
          document.getElementById('titlesList').style.display = 'none';
          document.getElementById('plushiesPanel').style.display = 'none';
          renderAchievementsPanel();
          achievementsOverlay.classList.add('visible');
        } else {
          mcAuthResetForm();
          mcNameOverlay.classList.add('visible');
          mcAuthName.focus();
        }
      });
    }
    const mcNameSkipBtn = document.getElementById('mcNameSkip');
    if (mcNameSkipBtn) mcNameSkipBtn.addEventListener('click', () => mcNameOverlay.classList.remove('visible'));

    /* ---------------- Easter Egg: "AD-Free" (Idle-Dorf) ----------------
       Sieht aus wie ein typischer Werbung-entfernen-Button, ist aber reiner
       Spass - die Seite hat nie Werbung. Egal welchen der beiden Wege der
       Spieler waehlt (direkt "Auto wollen" ODER erst "Danke!" -> "Wirklich
       sicher?" -> "Hast Recht"), landet er am Ende immer beim selben
       Auto-Pluschie-Popup. BKMP_ADFREE_CODE wird NIE angezeigt, sondern nur
       im Hintergrund automatisch eingeloest (siehe redeemPlushieCode) -
       reuse desselben faelschungssicheren Codes-Systems wie Koras
       Easter-Egg-Pluschie, is_reusable=true erlaubt jedem Account genau
       eine Einloesung (siehe supabase-adfree-easter-egg.sql). */
    const BKMP_ADFREE_CODE = 'ADFREE-RANDOMAUTO-EGG';
    const idleAdFreeBtn = document.getElementById('idleAdFreeBtn');
    const adFreePopup1 = document.getElementById('adFreePopup1');
    const adFreePopupSure = document.getElementById('adFreePopupSure');
    const adFreePopupCar = document.getElementById('adFreePopupCar');
    function bkmpAdFreeSyncButton() {
      if (!idleAdFreeBtn) return;
      idleAdFreeBtn.style.display = bkmpGetEggsFound().includes('adfree') ? 'none' : '';
    }
    async function bkmpAdFreeGrantReward() {
      if (typeof bkmpMarkEggFound === 'function') bkmpMarkEggFound('adfree');
      bkmpAdFreeSyncButton();
      const name = bkmpGetMcName();
      if (name && typeof redeemPlushieCode === 'function') {
        try { await redeemPlushieCode(BKMP_ADFREE_CODE, name); } catch (e) {}
      }
      if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
    }
    if (idleAdFreeBtn) idleAdFreeBtn.addEventListener('click', () => adFreePopup1.classList.add('visible'));
    const adFreeThanksBtn = document.getElementById('adFreeThanksBtn');
    if (adFreeThanksBtn) adFreeThanksBtn.addEventListener('click', () => {
      adFreePopup1.classList.remove('visible');
      adFreePopupSure.classList.add('visible');
    });
    const adFreeWantCarBtn = document.getElementById('adFreeWantCarBtn');
    if (adFreeWantCarBtn) adFreeWantCarBtn.addEventListener('click', () => {
      adFreePopup1.classList.remove('visible');
      adFreePopupCar.classList.add('visible');
    });
    const adFreeSureBtn = document.getElementById('adFreeSureBtn');
    if (adFreeSureBtn) adFreeSureBtn.addEventListener('click', () => {
      adFreePopupSure.classList.remove('visible');
      adFreePopupCar.classList.add('visible');
    });
    const adFreeCarConfirmBtn = document.getElementById('adFreeCarConfirmBtn');
    if (adFreeCarConfirmBtn) adFreeCarConfirmBtn.addEventListener('click', () => {
      adFreePopupCar.classList.remove('visible');
      bkmpAdFreeGrantReward();
    });
    bkmpAdFreeSyncButton();

    /* ---------------- Umfrage-Banner (oben mittig) ----------------
       Stimme ist ueber poll_votes (siehe supabase-polls-schema.sql) auf 1x
       pro Account und Umfrage begrenzt - serverseitig per
       Unique-Constraint (poll_id, auth_user_id), nicht nur hier im Client.
       "Schliessen" merkt sich das nur fuer diese Browser-Session
       (sessionStorage) - beim naechsten Seitenaufruf erscheint eine noch
       nicht beantwortete Umfrage wieder, genau wie gefordert. */
    const BKMP_POLL_DISMISSED_PREFIX = 'bkmp-poll-dismissed-';
    function bkmpPollDismissedThisSession(pollId) {
      try { return sessionStorage.getItem(BKMP_POLL_DISMISSED_PREFIX + pollId) === '1'; } catch (e) { return false; }
    }
    function bkmpMarkPollDismissed(pollId) {
      try { sessionStorage.setItem(BKMP_POLL_DISMISSED_PREFIX + pollId, '1'); } catch (e) {}
    }
    const pollBanner = document.getElementById('pollBanner');
    const pollBannerQuestion = document.getElementById('pollBannerQuestion');
    const pollBannerActions = document.getElementById('pollBannerActions');
    const pollBannerResults = document.getElementById('pollBannerResults');
    const pollBannerYesBtn = document.getElementById('pollBannerYesBtn');
    const pollBannerNoBtn = document.getElementById('pollBannerNoBtn');
    const pollBannerCloseBtn = document.getElementById('pollBannerCloseBtn');
    let bkmpCurrentPoll = null;

    function bkmpRenderPollResults(poll) {
      const total = Number(poll.yes_votes || 0) + Number(poll.no_votes || 0);
      const yesPct = total > 0 ? Math.round((poll.yes_votes / total) * 100) : 0;
      const noPct = total > 0 ? 100 - yesPct : 0;
      pollBannerResults.innerHTML = `
        <div class="poll-banner-result-row"><span>👍</span><div class="poll-banner-result-bar"><div class="poll-banner-result-fill poll-banner-result-fill-yes" style="width:${yesPct}%"></div></div><span>${yesPct}%</span></div>
        <div class="poll-banner-result-row"><span>👎</span><div class="poll-banner-result-bar"><div class="poll-banner-result-fill poll-banner-result-fill-no" style="width:${noPct}%"></div></div><span>${noPct}%</span></div>
      `;
      pollBannerResults.style.display = '';
      pollBannerActions.style.display = 'none';
    }
    function bkmpShowPollVoted(poll, myAnswer) {
      pollBanner.classList.add('poll-banner-voted');
      bkmpRenderPollResults(poll);
      pollBannerYesBtn.classList.toggle('poll-banner-btn-selected', myAnswer === 'yes');
      pollBannerNoBtn.classList.toggle('poll-banner-btn-selected', myAnswer === 'no');
    }
    async function bkmpInitPollBanner() {
      if (typeof loadActivePoll !== 'function') return;
      const poll = await loadActivePoll().catch(() => null);
      if (!poll) { pollBanner.style.display = 'none'; bkmpCurrentPoll = null; return; }
      bkmpCurrentPoll = poll;
      pollBannerQuestion.textContent = poll.question;
      pollBannerYesBtn.disabled = false;
      pollBannerNoBtn.disabled = false;
      pollBannerYesBtn.classList.remove('poll-banner-btn-selected');
      pollBannerNoBtn.classList.remove('poll-banner-btn-selected');
      pollBanner.classList.remove('poll-banner-voted');
      pollBannerResults.style.display = 'none';
      pollBannerActions.style.display = '';

      const myVote = typeof loadMyPollVote === 'function' ? await loadMyPollVote(poll.id).catch(() => null) : null;
      if (myVote) {
        pollBannerYesBtn.disabled = true;
        pollBannerNoBtn.disabled = true;
        bkmpShowPollVoted(poll, myVote);
        pollBanner.style.display = '';
        return;
      }
      pollBanner.style.display = bkmpPollDismissedThisSession(poll.id) ? 'none' : '';
    }
    async function bkmpHandlePollVote(answer) {
      if (!bkmpCurrentPoll) return;
      pollBannerYesBtn.disabled = true;
      pollBannerNoBtn.disabled = true;
      try {
        const updated = await submitPollVote(bkmpCurrentPoll.id, answer);
        if (updated) bkmpCurrentPoll = updated;
        bkmpShowPollVoted(bkmpCurrentPoll, answer);
        window.setTimeout(() => { pollBanner.style.display = 'none'; }, 2400);
      } catch (e) {
        if (e && e.message === 'already_voted') {
          const myVote = await loadMyPollVote(bkmpCurrentPoll.id).catch(() => answer);
          bkmpShowPollVoted(bkmpCurrentPoll, myVote || answer);
        } else if (e && e.message === 'not_authenticated') {
          pollBannerYesBtn.disabled = false;
          pollBannerNoBtn.disabled = false;
          mcAuthResetForm();
          mcNameOverlay.classList.add('visible');
          mcAuthName.focus();
        } else {
          pollBannerYesBtn.disabled = false;
          pollBannerNoBtn.disabled = false;
        }
      }
    }
    if (pollBannerYesBtn) pollBannerYesBtn.addEventListener('click', () => bkmpHandlePollVote('yes'));
    if (pollBannerNoBtn) pollBannerNoBtn.addEventListener('click', () => bkmpHandlePollVote('no'));
    if (pollBannerCloseBtn) pollBannerCloseBtn.addEventListener('click', () => {
      if (bkmpCurrentPoll) bkmpMarkPollDismissed(bkmpCurrentPoll.id);
      pollBanner.style.display = 'none';
    });
    bkmpInitPollBanner();

    const achievementsSubtabAchievements = document.getElementById('achievementsSubtabAchievements');
    const achievementsSubtabCosmetics = document.getElementById('achievementsSubtabCosmetics');
    const achievementsSubtabTitles = document.getElementById('achievementsSubtabTitles');
    const achievementsSubtabPlushies = document.getElementById('achievementsSubtabPlushies');
    const achievementsListEl = document.getElementById('achievementsList');
    const cosmeticsListEl = document.getElementById('cosmeticsList');
    const titlesListEl = document.getElementById('titlesList');
    const plushiesPanelEl = document.getElementById('plushiesPanel');
    const bkmpAchievementSubtabs = [
      { btn: achievementsSubtabAchievements, panel: achievementsListEl, render: null },
      { btn: achievementsSubtabCosmetics, panel: cosmeticsListEl, render: renderCosmeticsPanel },
      { btn: achievementsSubtabTitles, panel: titlesListEl, render: renderTitlesPanel },
      { btn: achievementsSubtabPlushies, panel: plushiesPanelEl, render: renderPlushiesPanel }
    ];
    bkmpAchievementSubtabs.forEach(({ btn, panel, render }) => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        bkmpAchievementSubtabs.forEach(other => {
          other.btn.classList.toggle('active', other.btn === btn);
          other.panel.style.display = other.btn === btn ? '' : 'none';
        });
        if (typeof render === 'function') render();
      });
    });

    const achievementsCloseBtn = document.getElementById('achievementsClose');
    if (achievementsCloseBtn) achievementsCloseBtn.addEventListener('click', () => achievementsOverlay.classList.remove('visible'));
    const achievementsChangeNameBtn = document.getElementById('achievementsChangeName');
    if (achievementsChangeNameBtn) {
      achievementsChangeNameBtn.addEventListener('click', async () => {
        achievementsChangeNameBtn.disabled = true;
        if (typeof bkmpStopSessionWatch === 'function') bkmpStopSessionWatch();
        try { await bkmpPlayerLogout(); } catch (e) { console.warn('Ausloggen fehlgeschlagen.', e); }
        bkmpSetMcName('');
        /* Spieler-Wunsch (14.07., nach mehreren Umgehungsversuchen ueber
           immer neue Accounts): der Bonk-Zaehler ist rein lokal im
           localStorage gespeichert (geraetegebunden, nicht account-
           gebunden) - beim Account-Wechsel "erbte" ein neuer Account sonst
           den vollen lokalen Stand des vorherigen (siehe
           bkmpMergeRemoteStatsIntoLocal: nimmt das Maximum aus lokal/remote).
           Beim Ausloggen jetzt auf 0 zuruecksetzen, damit ein danach neu
           registrierter/eingeloggter Account wirklich bei seinem EIGENEN
           Server-Stand startet. Fuer denselben Account erneut einzuloggen
           bleibt verlustfrei, weil der echte Stand ja schon serverseitig
           synchronisiert ist und beim naechsten Login von dort geladen wird. */
        bkmpSetBonkCount(0);
        if (typeof bkmpUpdateBonkBadge === 'function') bkmpUpdateBonkBadge(0);
        bkmpOwnedPlushies = [];
        try { localStorage.removeItem(BKMP_OWNED_PLUSHIES_CACHE_KEY); } catch (e) {}
        try { localStorage.removeItem('bkmp-idle-achievement-fields-cache'); } catch (e) {}
        bkmpMyWishVotes = {};
        renderWishes();
        achievementsChangeNameBtn.disabled = false;
        achievementsOverlay.classList.remove('visible');
        renderAchievementBadge();
      });
    }

    /* ---------------- Namen aendern (30-Tage-Cooldown) ---------------- */
    const renameOverlay = document.getElementById('renameOverlay');
    const renameInfo = document.getElementById('renameInfo');
    const renameFormFields = document.getElementById('renameFormFields');
    const renameNewName = document.getElementById('renameNewName');
    const renameError = document.getElementById('renameError');
    const renameSubmitBtn = document.getElementById('renameSubmit');
    const renameCancelBtn = document.getElementById('renameCancel');

    function renameShowError(message) {
      renameError.textContent = message || '';
      renameError.style.display = message ? '' : 'none';
    }

    const achievementsRenameBtn = document.getElementById('achievementsRenameBtn');
    if (achievementsRenameBtn) {
      achievementsRenameBtn.addEventListener('click', async () => {
        renameShowError('');
        renameNewName.value = '';
        let cooldownUntil = null;
        try {
          const remote = typeof loadPlayerStatsByName === 'function' ? await loadPlayerStatsByName(bkmpGetMcName()) : null;
          if (remote && remote.lastNameChangeAt) {
            const nextAllowed = remote.lastNameChangeAt + 30 * 24 * 60 * 60 * 1000;
            if (nextAllowed > Date.now()) cooldownUntil = nextAllowed;
          }
        } catch (e) { console.warn('Cooldown-Status konnte nicht geladen werden.', e); }

        if (cooldownUntil) {
          renameInfo.textContent = `Nächste Namensänderung möglich am ${new Date(cooldownUntil).toLocaleDateString('de-DE')}.`;
          renameFormFields.style.display = 'none';
          renameSubmitBtn.style.display = 'none';
        } else {
          renameInfo.textContent = 'Dein Ingame-Name kann alle 30 Tage einmal geändert werden.';
          renameFormFields.style.display = '';
          renameSubmitBtn.style.display = '';
        }
        achievementsOverlay.classList.remove('visible');
        renameOverlay.classList.add('visible');
      });
    }
    if (renameCancelBtn) renameCancelBtn.addEventListener('click', () => renameOverlay.classList.remove('visible'));
    if (renameSubmitBtn) {
      renameSubmitBtn.addEventListener('click', async () => {
        const newName = renameNewName.value.trim();
        if (!newName) { renameShowError('Bitte einen Namen eintragen.'); renameNewName.focus(); return; }
        renameShowError('');
        renameSubmitBtn.disabled = true;
        const originalLabel = renameSubmitBtn.textContent;
        renameSubmitBtn.textContent = 'Wird gespeichert...';
        try {
          const canonicalName = await bkmpPlayerRename(newName);
          bkmpSetMcName(canonicalName);
          renameOverlay.classList.remove('visible');
          renderAchievementBadge();
        } catch (e) {
          renameShowError(e && e.message ? e.message : 'Der Name konnte nicht geändert werden.');
        } finally {
          renameSubmitBtn.disabled = false;
          renameSubmitBtn.textContent = originalLabel;
        }
      });
    }
    if (renameNewName) renameNewName.addEventListener('keydown', e => { if (e.key === 'Enter') renameSubmitBtn.click(); });

    /* ---------------- Passwort aendern (waehrend eingeloggt) ---------------- */
    const passwordChangeOverlay = document.getElementById('passwordChangeOverlay');
    const passwordChangeNew = document.getElementById('passwordChangeNew');
    const passwordChangeRepeat = document.getElementById('passwordChangeRepeat');
    const passwordChangeError = document.getElementById('passwordChangeError');
    const passwordChangeSubmitBtn = document.getElementById('passwordChangeSubmit');
    const passwordChangeCancelBtn = document.getElementById('passwordChangeCancel');
    mcAuthSetupPasswordToggle('passwordChangeNew', 'passwordChangeNewToggle');
    mcAuthSetupPasswordToggle('passwordChangeRepeat', 'passwordChangeRepeatToggle');

    function passwordChangeShowError(message) {
      passwordChangeError.textContent = message || '';
      passwordChangeError.style.display = message ? '' : 'none';
    }

    const achievementsChangePasswordBtn = document.getElementById('achievementsChangePasswordBtn');
    if (achievementsChangePasswordBtn) {
      achievementsChangePasswordBtn.addEventListener('click', () => {
        passwordChangeShowError('');
        passwordChangeNew.value = '';
        passwordChangeRepeat.value = '';
        achievementsOverlay.classList.remove('visible');
        passwordChangeOverlay.classList.add('visible');
      });
    }
    if (passwordChangeCancelBtn) passwordChangeCancelBtn.addEventListener('click', () => passwordChangeOverlay.classList.remove('visible'));
    if (passwordChangeSubmitBtn) {
      passwordChangeSubmitBtn.addEventListener('click', async () => {
        const newPassword = passwordChangeNew.value;
        const repeatPassword = passwordChangeRepeat.value;
        if (!newPassword || newPassword.length < 6) { passwordChangeShowError('Das Passwort braucht mindestens 6 Zeichen.'); passwordChangeNew.focus(); return; }
        if (newPassword !== repeatPassword) { passwordChangeShowError('Die Passwörter stimmen nicht überein.'); passwordChangeRepeat.focus(); return; }
        passwordChangeShowError('');
        passwordChangeSubmitBtn.disabled = true;
        const originalLabel = passwordChangeSubmitBtn.textContent;
        passwordChangeSubmitBtn.textContent = 'Wird gespeichert...';
        try {
          await bkmpPlayerChangePassword(newPassword);
          passwordChangeOverlay.classList.remove('visible');
          alert('Dein Passwort wurde geändert.');
        } catch (e) {
          passwordChangeShowError(e && e.message ? e.message : 'Das Passwort konnte nicht geändert werden.');
        } finally {
          passwordChangeSubmitBtn.disabled = false;
          passwordChangeSubmitBtn.textContent = originalLabel;
        }
      });
    }
    if (passwordChangeRepeat) passwordChangeRepeat.addEventListener('keydown', e => { if (e.key === 'Enter') passwordChangeSubmitBtn.click(); });

    /* ---------------- Account loeschen (10s-Bedenkzeit) ---------------- */
    const deleteAccountOverlay = document.getElementById('deleteAccountOverlay');
    const deleteAccountError = document.getElementById('deleteAccountError');
    const deleteAccountConfirmBtn = document.getElementById('deleteAccountConfirm');
    const deleteAccountCancelBtn = document.getElementById('deleteAccountCancel');
    const achievementsDeleteAccountBtn = document.getElementById('achievementsDeleteAccountBtn');
    let deleteAccountCountdownTimer = null;

    function deleteAccountShowError(message) {
      deleteAccountError.textContent = message || '';
      deleteAccountError.style.display = message ? '' : 'none';
    }
    function deleteAccountStopCountdown() {
      if (deleteAccountCountdownTimer) { clearInterval(deleteAccountCountdownTimer); deleteAccountCountdownTimer = null; }
    }
    function deleteAccountStartCountdown() {
      deleteAccountStopCountdown();
      let secondsLeft = 10;
      deleteAccountConfirmBtn.disabled = true;
      deleteAccountConfirmBtn.textContent = `Endgültig löschen (${secondsLeft})`;
      deleteAccountCountdownTimer = window.setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          deleteAccountStopCountdown();
          deleteAccountConfirmBtn.disabled = false;
          deleteAccountConfirmBtn.textContent = 'Endgültig löschen';
        } else {
          deleteAccountConfirmBtn.textContent = `Endgültig löschen (${secondsLeft})`;
        }
      }, 1000);
    }

    if (achievementsDeleteAccountBtn) {
      achievementsDeleteAccountBtn.addEventListener('click', () => {
        deleteAccountShowError('');
        achievementsOverlay.classList.remove('visible');
        deleteAccountOverlay.classList.add('visible');
        deleteAccountStartCountdown();
      });
    }
    if (deleteAccountCancelBtn) {
      deleteAccountCancelBtn.addEventListener('click', () => {
        deleteAccountStopCountdown();
        deleteAccountOverlay.classList.remove('visible');
      });
    }
    if (deleteAccountConfirmBtn) {
      deleteAccountConfirmBtn.addEventListener('click', async () => {
        if (deleteAccountConfirmBtn.disabled) return;
        deleteAccountShowError('');
        deleteAccountConfirmBtn.disabled = true;
        const originalLabel = deleteAccountConfirmBtn.textContent;
        deleteAccountConfirmBtn.textContent = 'Wird gelöscht...';
        try {
          if (typeof bkmpStopSessionWatch === 'function') bkmpStopSessionWatch();
          await bkmpPlayerDeleteOwnAccount();
          try { localStorage.removeItem(BKMP_OWNED_PLUSHIES_CACHE_KEY); } catch (e) {}
          try { localStorage.removeItem('bkmp-idle-achievement-fields-cache'); } catch (e) {}
          bkmpSetMcName('');
          deleteAccountOverlay.classList.remove('visible');
          alert('Dein Account und dein kompletter Spielstand wurden gelöscht.');
          window.location.reload();
        } catch (e) {
          deleteAccountShowError(e && e.message ? e.message : 'Der Account konnte nicht gelöscht werden.');
          deleteAccountConfirmBtn.disabled = false;
          deleteAccountConfirmBtn.textContent = originalLabel;
        }
      });
    }

    renderAchievementBadge();
    bkmpRefreshPlushieDefinitions().then(() => bkmpRefreshOwnedPlushies());

    /* Beim Laden eine bestehende Spieler-Session wiederherstellen (Supabase
       persistiert sie automatisch). Kein Treffer -> alten, nur optimistisch
       zwischengespeicherten Namen verwerfen und das Login/Registrieren-
       Fenster automatisch oeffnen (ausser der Nutzer ist eingeloggt). */
    (async function bkmpInitPlayerAuth() {
      try {
        const restoredName = typeof bkmpRestorePlayerSession === 'function' ? await bkmpRestorePlayerSession() : '';
        if (restoredName) {
          const canonicalName = await bkmpMergeRemoteStatsIntoLocal(restoredName);
          bkmpSetMcName(canonicalName);
          bkmpClaimAndWatchSession(canonicalName);
        } else if (bkmpGetMcName()) {
          bkmpSetMcName('');
        }
      } catch (e) {
        console.warn('Spieler-Session konnte nicht wiederhergestellt werden.', e);
      } finally {
        bkmpAchievementNotifyReady = false;
        renderAchievementBadge();
        bkmpRefreshOwnedPlushies();
        bkmpRefreshMyWishVotes();
        if (typeof bkmpSpawnDerLiberFigures === 'function') bkmpSpawnDerLiberFigures();
        if (!bkmpGetMcName()) {
          mcAuthResetForm();
          mcNameOverlay.classList.add('visible');
        } else {
          /* Den bekannten Hintergrund-Ladevorgaengen (Pluschies/Idle-Dorf/
             Raid, siehe bkmpRefreshOwnedPlushies/bkmpIdlePreloadStateIfNamed)
             Zeit zum Fertigwerden geben, BEVOR die Popup-Benachrichtigung
             zum ersten Mal scharf geschaltet wird - siehe Kommentar bei
             bkmpAchievementNotifyReady oben. */
          window.setTimeout(() => {
            bkmpAchievementNotifyReady = true;
            renderAchievementBadge(true);
          }, 3000);
        }
      }
    })();

    /* Zeigt Admins, die zufaellig gerade auf der Hauptseite statt im Admin-
       Panel unterwegs sind, dieselbe "Neue Anfragen"-Meldung wie admin.html
       (siehe showPendingSummaryPopup dort). Nutzt absichtlich denselben
       Supabase-Auth-Client wie das Spieler-Login (beide laufen auf
       demselben Origin ueber dieselbe persistierte Session) - ein Admin, der
       sich hier gerade eingeloggt hat, hat also automatisch eine aktive
       Session, ganz ohne separates Login auf dieser Seite. is_active_admin()
       ist eine reine JWT-Pruefung (kein Tabellenzugriff) und fuer anon UND
       authenticated freigegeben - fuer normale Besucher ohne Session wird
       hier ueberhaupt kein Netzwerkaufruf ausgeloest (Sitzungspruefung ist
       rein lokal), fuer eingeloggte Spieler nur der eine leichte RPC-Call.
       Erst wenn der wirklich admin ist, werden die zusaetzlichen Anfragen-
       Tabellen geladen - schont das ohnehin knappe Egress-Kontingent. */
    async function bkmpCheckAdminPendingRequestsOnMainSite() {
      const client = bkmpGetSupabaseClient();
      if (!client) return;
      try {
        const { data: sessionData } = await client.auth.getSession();
        if (!sessionData || !sessionData.session) return;
        const { data: isAdmin } = await client.rpc('is_active_admin');
        if (!isAdmin) return;

        const [investorRequests, cardSaleRequests, wishes, partnerShops, cardCatalog, feedback] = await Promise.all([
          typeof loadInvestorRequests === 'function' ? loadInvestorRequests().catch(() => []) : [],
          typeof loadCardSaleRequests === 'function' ? loadCardSaleRequests().catch(() => []) : [],
          typeof loadWishes === 'function' ? loadWishes().catch(() => []) : [],
          typeof loadPartnerShops === 'function' ? loadPartnerShops().catch(() => []) : [],
          typeof loadCardCatalog === 'function' ? loadCardCatalog().catch(() => []) : [],
          typeof loadFeedback === 'function' ? loadFeedback().catch(() => []) : []
        ]);

        const isNewPending = item => item && item.status === 'pending' && !item.isRead;
        const pendingCardCatalog = (cardCatalog || []).filter(isNewPending).length;
        const pendingWishes = (wishes || []).filter(isNewPending).length;
        const pendingInvestorRequests = (investorRequests || []).filter(isNewPending).length;
        const pendingCardSaleRequests = (cardSaleRequests || []).filter(isNewPending).length;
        const pendingPartnerShops = (partnerShops || []).filter(isNewPending).length;
        const unreadFeedback = (feedback || []).filter(f => f && !f.isRead && !f.isArchived).length;
        const total = pendingCardCatalog + pendingWishes + pendingInvestorRequests + pendingCardSaleRequests + pendingPartnerShops + unreadFeedback;
        if (total === 0) return;

        const parts = [];
        if (pendingCardCatalog) parts.push(`${pendingCardCatalog} Karte${pendingCardCatalog === 1 ? '' : 'n'}`);
        if (pendingWishes) parts.push(`${pendingWishes} Kartenidee${pendingWishes === 1 ? '' : 'n'}`);
        if (pendingInvestorRequests) parts.push(`${pendingInvestorRequests} Investoren-Anfrage${pendingInvestorRequests === 1 ? '' : 'n'}`);
        if (pendingCardSaleRequests) parts.push(`${pendingCardSaleRequests} Verkaufsanfrage${pendingCardSaleRequests === 1 ? '' : 'n'}`);
        if (pendingPartnerShops) parts.push(`${pendingPartnerShops} PartnerShop-Anfrage${pendingPartnerShops === 1 ? '' : 'n'}`);
        if (unreadFeedback) parts.push(`${unreadFeedback} Feedback-Eintrag${unreadFeedback === 1 ? '' : 'e'}`);

        const popup = document.getElementById('bkmpAdminPendingPopup');
        if (!popup) return;
        document.getElementById('bkmpAdminPendingPopupTitle').textContent = `Du hast ${total} neue Anfrage${total === 1 ? '' : 'n'}`;
        document.getElementById('bkmpAdminPendingPopupBody').textContent = `Wartet auf Prüfung: ${parts.join(', ')}.`;
        popup.classList.add('visible');
      } catch (e) {
        console.warn('Admin-Anfragen-Hinweis auf der Hauptseite konnte nicht geladen werden.', e);
      }
    }
    const bkmpAdminPendingPopupCloseBtn = document.getElementById('bkmpAdminPendingPopupClose');
    if (bkmpAdminPendingPopupCloseBtn) bkmpAdminPendingPopupCloseBtn.addEventListener('click', () => {
      document.getElementById('bkmpAdminPendingPopup').classList.remove('visible');
    });
    bkmpCheckAdminPendingRequestsOnMainSite();

    /* ---------------- ESC schliesst alle offenen Popups ---------------- */
    /* Alle Dialoge dieser Seite sind einheitlich .joke-overlay (Login,
       Achievements, Idle-Dorf, MapArt-Workspace, Codes, ...) - ein einziger
       Listener deckt automatisch auch kuenftige Dialoge ab. Fuer Overlays
       mit echtem Zusatz-Cleanup (Idle-Dorf-Kampf-Loop stoppen, MapArt-Chat-
       Realtime abbestellen) wird die jeweils richtige Close-Funktion
       aufgerufen statt nur die "visible"-Klasse zu entfernen - sonst
       liefen z. B. Idle-Dorf-Tick oder Chat-Subscription im Hintergrund
       weiter, obwohl der Dialog optisch weg ist. */
    /* Auf window statt const, damit der App-Modus-Bootstrap (eigenes
       Skript weiter unten, fuer Android-Zurueck) dieselbe Zuordnung
       mitbenutzen kann statt sie zu duplizieren. */
    window.BKMP_OVERLAY_CLOSERS = {
      idleDorfOverlay: () => { if (typeof bkmpIdleCloseModal === 'function') bkmpIdleCloseModal(); },
      idleStagePickerOverlay: () => { if (typeof bkmpIdleCloseStagePicker === 'function') bkmpIdleCloseStagePicker(); },
      /* Bug-Report 17.07. (ChronoKora): "Streamer-Ticker bewegt sich nicht
         mehr", ueberlebte sogar einen Reload. Ursache: idleSkillHelpOverlay/
         idleRunenHelpOverlay setzen beim Oeffnen zusaetzlich body.modal-open
         (pausiert u.a. den Ticker per CSS), hatten hier aber KEINEN Eintrag -
         der generische Fallback unten entfernte nur die "visible"-Klasse des
         jeweiligen Popups, nie modal-open selbst. idleDorfOverlay ist
         waehrenddessen ebenfalls sichtbar und raeumt ueber seinen eigenen
         Closer oben modal-open korrekt mit auf, faellt also i. d. R. nicht
         auf - trotzdem hier explizit abgesichert. */
      idleSkillHelpOverlay: () => {
        const overlay = document.getElementById('idleSkillHelpOverlay');
        if (overlay) overlay.classList.remove('visible');
        document.body.classList.remove('modal-open');
      },
      idleRunenHelpOverlay: () => {
        const overlay = document.getElementById('idleRunenHelpOverlay');
        if (overlay) overlay.classList.remove('visible');
        document.body.classList.remove('modal-open');
      },
      /* Bewusst ein No-op: das Event-Drachen-Vorbereitungs-Popup darf NUR
         ueber den "Ich bin bereit"-Button verlassen werden, nicht per ESC -
         siehe Auftrag Abschnitt 3 ("Das Popup darf erst geschlossen werden,
         wenn der vorgesehene Button gedrueckt wurde"). Ohne diesen Eintrag
         wuerde der generische Sweep unten die "visible"-Klasse einfach
         entfernen. */
      idleEventDragonOverlay: () => {},
      /* Grimbold-Dialogszene: gleicher Grund wie beim Event-Drachen-Popup
         oben - nur ueber den Weiter/Willkommen-Button verlassbar. */
      idleMeisterDialogOverlay: () => {},
      /* Ohne diesen Eintrag wuerde der ESC-Sweep nur die "visible"-Klasse
         entfernen, der laufende 10s-Bedenkzeit-Countdown-Timer aber
         unbemerkt im Hintergrund weiterlaufen. */
      deleteAccountOverlay: () => {
        if (typeof deleteAccountStopCountdown === 'function') deleteAccountStopCountdown();
        document.getElementById('deleteAccountOverlay').classList.remove('visible');
      },
      /* Sorgt dafuer, dass ESC bei bkmpConfirmDialog() genauso wie der
         Abbrechen-Button behandelt wird (Promise loest mit false auf,
         Klick-Listener werden sauber entfernt) statt die "visible"-Klasse
         einfach kommentarlos zu entfernen und das Promise ewig haengen zu
         lassen. */
      bkmpConfirmOverlay: () => {
        const btn = document.getElementById('bkmpConfirmCancelBtn');
        if (btn) btn.click();
      },
      /* Section C (18.07.): waehrend der finale Bestaetigungs-Klick gerade
         verarbeitet wird (bkmpPrestigeConfirmSubmitting), darf ESC den
         Dialog NICHT wegreissen - gleiches Prinzip wie beim Event-Drachen-
         Popup oben, hier aber nur zeitweise (vor/nach der Verarbeitung
         funktioniert ESC ganz normal wie Abbrechen). */
      idlePrestigeConfirmOverlay: () => {
        if (typeof bkmpPrestigeConfirmSubmitting !== 'undefined' && bkmpPrestigeConfirmSubmitting) return;
        if (typeof bkmpPrestigeConfirmCancel === 'function') bkmpPrestigeConfirmCancel();
      },
      /* Waehrend der animierten Sammel-/Aufloese-Phase blockiert ESC
         (die kurze Sequenz soll nicht mitten drin abbrechen) - sobald die
         Ergebnis-Phase sichtbar ist, wirkt ESC wie der "Weiter"-Button. */
      idlePrestigeCeremonyOverlay: () => {
        const overlay = document.getElementById('idlePrestigeCeremonyOverlay');
        if (!overlay || !overlay.classList.contains('phase-result')) return;
        if (typeof bkmpPrestigeCloseCeremony === 'function') bkmpPrestigeCloseCeremony();
      }
    };
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.joke-overlay.visible').forEach(el => {
        const closer = BKMP_OVERLAY_CLOSERS[el.id];
        if (closer) closer(); else el.classList.remove('visible');
      });
    });

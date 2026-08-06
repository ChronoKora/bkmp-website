/* Performance-Audit-Instrumentierung (06.08.2026, siehe CLAUDE.md-Auftrag
   "Idle-Dorf Performance-Audit") - TEMPORAERES Diagnosewerkzeug, exakt nach
   dem vom Nutzer selbst vorgegebenen Muster ("Nutze zur Diagnose
   ausschliesslich im QA-/Debugmodus bei Bedarf temporaer eine
   Instrumentierung fuer EventTarget.prototype.addEventListener/
   removeEventListener... Sie darf niemals in der normalen
   Produktionsausfuehrung aktiv bleiben").

   Tut auf der echten Website (window.BKMP_QA_MODE immer false, siehe
   index.html) komplett NICHTS - identisches No-Op-Prinzip wie
   js/dev/bkmp-qa-panel.js. Muss so frueh wie moeglich laden (direkt nach
   der window.BKMP_QA_MODE-Ermittlung im <head>, VOR jedem anderen
   Script), damit auch frueh registrierte Listener/Timer erfasst werden -
   deshalb bewusst kein "defer".

   Misst NUR, veraendert kein Spielverhalten:
   - addEventListener/removeEventListener: Netto-Zaehler nach Eventtyp +
     Ziel-Beschreibung + Funktionsname, kurzer Stack-Ausschnitt.
   - setInterval/setTimeout: aktive Timer-IDs mit Delay + Stack-Ausschnitt,
     Gesamt-Aufrufzaehler.
   - requestAnimationFrame: Aufrufe pro Messfenster (Rate statt "aktiv",
     da RAF sich typischerweise selbst pro Frame neu plant).
   - MutationObserver/ResizeObserver/IntersectionObserver: aktive Instanzen
     (erzeugt minus disconnected) + Gesamt-Erzeugungszaehler.
   - PerformanceObserver(longtask): Summe/Anzahl main-thread-blockierender
     Aufgaben - echter, ueber die Performance-API standardisierter
     CPU-Lastindikator (kein Ersatz fuer Chromes interne "Layouts/Style
     Recalcs pro Sekunde"-Zaehler, die es fuer Seiten-JS ueberhaupt nicht
     gibt - wird im Abschlussbericht so benannt, nicht als Chrome-Wert
     ausgegeben).
   - Optionale, ausdruecklich SEPARAT einschaltbare Layout-Lese-Zaehlung
     (getBoundingClientRect/offsetWidth/... - klassisches Layout-
     Thrashing-Signal) - bewusst NICHT permanent aktiv, da das Patchen
     dieser sehr heiss aufgerufenen Getter selbst schon Overhead erzeugt
     und die eigentliche Messung verfaelschen wuerde. Nur ueber
     window.__bkmpPerfEnableLayoutReadTracking() gezielt fuer eine kurze
     Sondermessung aktivierbar.

   window.__bkmpPerfSnapshot() liefert eine Momentaufnahme aller Zaehler. */

(function () {
  if (!window.BKMP_QA_MODE) return;

  var state = {
    startedAt: Date.now(),
    listeners: {
      totalAdds: 0,
      totalRemoves: 0,
      byType: {},        // eventType -> {adds, removes, net}
      byTarget: {},       // "type|targetDesc" -> count (net)
      byFunctionName: {}  // eventType|fnName -> count (net)
    },
    timers: {
      intervalsCreated: 0,
      intervalsCleared: 0,
      activeIntervals: new Map(), // id -> {delay, stack, createdAt}
      timeoutsCreated: 0,
      timeoutsCleared: 0,
      timeoutsFired: 0,
      activeTimeouts: new Map()   // id -> {delay, stack, createdAt}
    },
    raf: {
      totalCalls: 0,
      totalCancels: 0,
      windowStart: Date.now(),
      windowCalls: 0
    },
    observers: {
      mutation: { created: 0, disconnected: 0, observeCalls: 0 },
      resize: { created: 0, disconnected: 0, observeCalls: 0 },
      intersection: { created: 0, disconnected: 0, observeCalls: 0 }
    },
    longTasks: {
      count: 0,
      totalDurationMs: 0,
      windowStart: Date.now(),
      windowCount: 0,
      windowDurationMs: 0
    },
    layoutReads: {
      enabled: false,
      count: 0,
      byProp: {}
    }
  };

  function shortStack() {
    try {
      var s = new Error().stack || '';
      var lines = s.split('\n').slice(2, 5).map(function (l) { return l.trim(); });
      return lines.join(' | ').slice(0, 220);
    } catch (e) { return ''; }
  }

  function targetDesc(t) {
    if (t === window) return 'window';
    if (t === document) return 'document';
    if (!t) return '(null)';
    if (t.id) return '#' + t.id;
    if (t.className && typeof t.className === 'string') return '.' + t.className.split(' ')[0];
    return (t.nodeName || t.constructor && t.constructor.name || 'unknown');
  }

  function bump(map, key, field) {
    if (!map[key]) map[key] = { adds: 0, removes: 0, net: 0 };
    map[key][field]++;
    map[key].net = map[key].adds - map[key].removes;
  }

  // ---- addEventListener / removeEventListener ----
  var origAdd = EventTarget.prototype.addEventListener;
  var origRemove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    state.listeners.totalAdds++;
    bump(state.listeners.byType, type, 'adds');
    var td = targetDesc(this);
    bump(state.listeners.byTarget, type + ' @ ' + td, 'adds');
    var fnName = (listener && listener.name) || '(anonymous)';
    bump(state.listeners.byFunctionName, type + ' :: ' + fnName, 'adds');
    return origAdd.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    state.listeners.totalRemoves++;
    bump(state.listeners.byType, type, 'removes');
    var td = targetDesc(this);
    bump(state.listeners.byTarget, type + ' @ ' + td, 'removes');
    var fnName = (listener && listener.name) || '(anonymous)';
    bump(state.listeners.byFunctionName, type + ' :: ' + fnName, 'removes');
    return origRemove.call(this, type, listener, options);
  };

  // ---- setInterval / clearInterval ----
  var origSetInterval = window.setInterval;
  var origClearInterval = window.clearInterval;

  window.setInterval = function (fn, delay) {
    var id = origSetInterval.apply(window, arguments);
    state.timers.intervalsCreated++;
    state.timers.activeIntervals.set(id, { delay: delay, stack: shortStack(), createdAt: Date.now() });
    return id;
  };
  window.clearInterval = function (id) {
    if (state.timers.activeIntervals.has(id)) {
      state.timers.intervalsCleared++;
      state.timers.activeIntervals.delete(id);
    }
    return origClearInterval.apply(window, arguments);
  };

  // ---- setTimeout / clearTimeout ----
  var origSetTimeout = window.setTimeout;
  var origClearTimeout = window.clearTimeout;

  window.setTimeout = function (fn, delay) {
    var stack = shortStack();
    var wrapped = function () {
      state.timers.timeoutsFired++;
      state.timers.activeTimeouts.delete(id);
      if (typeof fn === 'function') return fn.apply(this, arguments);
    };
    var args = Array.prototype.slice.call(arguments, 2);
    var id = origSetTimeout.apply(window, [wrapped, delay].concat(args));
    state.timers.timeoutsCreated++;
    state.timers.activeTimeouts.set(id, { delay: delay, stack: stack, createdAt: Date.now() });
    return id;
  };
  window.clearTimeout = function (id) {
    if (state.timers.activeTimeouts.has(id)) {
      state.timers.timeoutsCleared++;
      state.timers.activeTimeouts.delete(id);
    }
    return origClearTimeout.apply(window, arguments);
  };

  // ---- requestAnimationFrame / cancelAnimationFrame ----
  var origRaf = window.requestAnimationFrame;
  var origCancelRaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    state.raf.totalCalls++;
    state.raf.windowCalls++;
    return origRaf.call(window, cb);
  };
  window.cancelAnimationFrame = function (id) {
    state.raf.totalCancels++;
    return origCancelRaf.call(window, id);
  };

  // ---- MutationObserver / ResizeObserver / IntersectionObserver ----
  function wrapObserverClass(Cls, bucket) {
    if (typeof Cls !== 'function') return Cls;
    var Wrapped = function (cb) {
      bucket.created++;
      var inst = new Cls(cb);
      var origObserve = inst.observe.bind(inst);
      var origDisconnect = inst.disconnect.bind(inst);
      inst.observe = function () { bucket.observeCalls++; return origObserve.apply(inst, arguments); };
      inst.disconnect = function () { bucket.disconnected++; return origDisconnect.apply(inst, arguments); };
      return inst;
    };
    Wrapped.prototype = Cls.prototype;
    return Wrapped;
  }
  if (window.MutationObserver) window.MutationObserver = wrapObserverClass(window.MutationObserver, state.observers.mutation);
  if (window.ResizeObserver) window.ResizeObserver = wrapObserverClass(window.ResizeObserver, state.observers.resize);
  if (window.IntersectionObserver) window.IntersectionObserver = wrapObserverClass(window.IntersectionObserver, state.observers.intersection);

  // ---- Long Tasks (echter, standardisierter Main-Thread-Lastindikator) ----
  try {
    var lto = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) {
        state.longTasks.count++;
        state.longTasks.totalDurationMs += entry.duration;
        state.longTasks.windowCount++;
        state.longTasks.windowDurationMs += entry.duration;
      });
    });
    lto.observe({ entryTypes: ['longtask'] });
  } catch (e) { /* Browser ohne longtask-Unterstuetzung - kein Fehler, nur keine Daten */ }

  // ---- Optionale Layout-Lese-Instrumentierung (bewusst opt-in) ----
  var LAYOUT_PROPS = ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'];
  window.__bkmpPerfEnableLayoutReadTracking = function () {
    if (state.layoutReads.enabled) return;
    state.layoutReads.enabled = true;
    LAYOUT_PROPS.forEach(function (prop) {
      var desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop) || Object.getOwnPropertyDescriptor(Element.prototype, prop);
      if (!desc || !desc.get) return;
      var origGet = desc.get;
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get: function () {
          state.layoutReads.count++;
          state.layoutReads.byProp[prop] = (state.layoutReads.byProp[prop] || 0) + 1;
          return origGet.call(this);
        }
      });
    });
    var origGbcr = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      state.layoutReads.count++;
      state.layoutReads.byProp.getBoundingClientRect = (state.layoutReads.byProp.getBoundingClientRect || 0) + 1;
      return origGbcr.apply(this, arguments);
    };
    var origGcs = window.getComputedStyle;
    window.getComputedStyle = function () {
      state.layoutReads.count++;
      state.layoutReads.byProp.getComputedStyle = (state.layoutReads.byProp.getComputedStyle || 0) + 1;
      return origGcs.apply(window, arguments);
    };
  };

  // ---- Snapshot-API ----
  function topN(obj, n) {
    return Object.keys(obj).map(function (k) {
      var v = obj[k];
      return { key: k, net: typeof v === 'object' ? v.net : v, raw: v };
    }).sort(function (a, b) { return b.net - a.net; }).slice(0, n);
  }

  window.__bkmpPerfSnapshot = function () {
    var now = Date.now();
    var rafWindowSec = Math.max(0.001, (now - state.raf.windowStart) / 1000);
    var ltWindowSec = Math.max(0.001, (now - state.longTasks.windowStart) / 1000);
    return {
      elapsedSec: Math.round((now - state.startedAt) / 100) / 10,
      dom: {
        totalNodes: document.querySelectorAll('*').length,
        documents: (function () { try { return window.frames.length + 1; } catch (e) { return 1; } })()
      },
      listeners: {
        netActive: state.listeners.totalAdds - state.listeners.totalRemoves,
        totalAdds: state.listeners.totalAdds,
        totalRemoves: state.listeners.totalRemoves,
        topByType: topN(state.listeners.byType, 15),
        topByTarget: topN(state.listeners.byTarget, 15),
        topByFunctionName: topN(state.listeners.byFunctionName, 20)
      },
      timers: {
        activeIntervalCount: state.timers.activeIntervals.size,
        activeIntervals: Array.from(state.timers.activeIntervals.entries()).map(function (e) {
          return { id: e[0], delay: e[1].delay, ageSec: Math.round((now - e[1].createdAt) / 100) / 10, stack: e[1].stack };
        }),
        intervalsCreated: state.timers.intervalsCreated,
        intervalsCleared: state.timers.intervalsCleared,
        activeTimeoutCount: state.timers.activeTimeouts.size,
        timeoutsCreated: state.timers.timeoutsCreated,
        timeoutsCleared: state.timers.timeoutsCleared,
        timeoutsFired: state.timers.timeoutsFired
      },
      raf: {
        totalCalls: state.raf.totalCalls,
        totalCancels: state.raf.totalCancels,
        ratePerSecInWindow: Math.round((state.raf.windowCalls / rafWindowSec) * 10) / 10,
        windowSec: Math.round(rafWindowSec * 10) / 10
      },
      observers: state.observers,
      longTasks: {
        totalCount: state.longTasks.count,
        totalDurationMs: Math.round(state.longTasks.totalDurationMs),
        windowCount: state.longTasks.windowCount,
        windowDurationMs: Math.round(state.longTasks.windowDurationMs),
        windowSec: Math.round(ltWindowSec * 10) / 10,
        windowBusyPct: Math.round((state.longTasks.windowDurationMs / (ltWindowSec * 1000)) * 1000) / 10
      },
      layoutReads: state.layoutReads.enabled ? {
        count: state.layoutReads.count,
        byProp: state.layoutReads.byProp
      } : { enabled: false },
      memory: (performance.memory ? {
        usedJSHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10,
        totalJSHeapMB: Math.round(performance.memory.totalJSHeapSize / 1048576 * 10) / 10
      } : null)
    };
  };

  window.__bkmpPerfResetWindow = function () {
    state.raf.windowStart = Date.now();
    state.raf.windowCalls = 0;
    state.longTasks.windowStart = Date.now();
    state.longTasks.windowCount = 0;
    state.longTasks.windowDurationMs = 0;
    state.layoutReads.count = 0;
    state.layoutReads.byProp = {};
  };

  console.log('[PerfInstrument] aktiv (nur QA-Modus) - window.__bkmpPerfSnapshot() / window.__bkmpPerfResetWindow() / window.__bkmpPerfEnableLayoutReadTracking()');
})();

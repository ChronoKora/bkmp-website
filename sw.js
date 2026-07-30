/* Minimaler Service Worker, nur fuer die "Als App installieren"-Funktion
   des Idle-Dorfs (siehe /app, idledorf.webmanifest) - Chrome verlangt fuer
   den Installations-Dialog (beforeinstallprompt) einen registrierten
   Service Worker mit fetch-Handler. Bewusst OHNE jegliches Caching: leitet
   jede Anfrage einfach unveraendert weiter, damit sich am Verhalten der
   restlichen (Investment-)Seite nichts aendert - nur registriert (siehe
   App-Modus-Bootstrap in index.html), wenn jemand tatsaechlich /app
   besucht hat.

   Ein reiner `fetch(event.request)` ohne Fehlerbehandlung macht einen
   ganz normalen, voruebergehenden Netzwerk-Haenger/Abbruch (z.B. Reload
   waehrend eine Anfrage noch laeuft) schlimmer als ohne Service Worker:
   der Browser haette das intern still behandelt, hier landet stattdessen
   ein "Uncaught (in promise) TypeError: Failed to fetch" + ein fehlge-
   schlagenes FetchEvent in der Konsole (live beobachtet 30.07.2026, exakt
   dasselbe Fehlermuster wie beim Runenverlust-Fund vom 25.07., siehe
   CLAUDE.md). `.catch()` faengt das ab und liefert stattdessen eine
   normale Netzwerkfehler-Response - fuer den Browser ununterscheidbar
   davon, als haette gar kein Service Worker dazwischengehangen. */
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => Response.error())
  );
});

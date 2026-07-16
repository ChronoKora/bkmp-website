/* Minimaler Service Worker, nur fuer die "Als App installieren"-Funktion
   des Idle-Dorfs (siehe /app, idledorf.webmanifest) - Chrome verlangt fuer
   den Installations-Dialog (beforeinstallprompt) einen registrierten
   Service Worker mit fetch-Handler. Bewusst OHNE jegliches Caching: leitet
   jede Anfrage einfach unveraendert weiter, damit sich am Verhalten der
   restlichen (Investment-)Seite nichts aendert - nur registriert (siehe
   App-Modus-Bootstrap in index.html), wenn jemand tatsaechlich /app
   besucht hat. */
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

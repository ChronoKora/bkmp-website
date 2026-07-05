# Bkmp Website

Dieses Projekt enthält den aktuellen Stand deiner Website als sauber benannte Dateien für Visual Studio Code.

## Dateien

- `index.html` - öffentliche Website
- `admin.html` - Admin-Panel
- `style.css` - Design und Layout
- `app.js` - gemeinsame Datenlogik (u. a. `escapeHtml`, Formatierung, localStorage-Fallback)
- `supabase.js` - Supabase-Anbindung (Auth, Datenbank, Storage)
- `api/twitch-live.js` - Vercel-Serverless-Funktion für den Live-Status der Twitch-Creator
- `supabase-schema.sql` - Grundschema (Tabellen, Indizes, Storage-Bucket)
- `supabase-security-hardening.sql` - Sicherheits-Update für die Datenbank-Policies (siehe unten)

## Öffnen

Öffne diesen Ordner in Visual Studio Code und starte `index.html` im Browser.

## Datenbank (Supabase)

Die Website nutzt Supabase als Backend. Zahlen, Investoren, News, Kartenideen, Creator, "Wer sind wir"-Blöcke und PartnerShops liegen in Supabase; `localStorage` dient nur noch als Fallback, falls Supabase gerade nicht erreichbar ist.

**Wichtig:** Führe `supabase-security-hardening.sql` einmalig im Supabase SQL-Editor aus (Dashboard > SQL Editor > New query). Das Skript sorgt dafür, dass Schreibzugriffe (Einträge anlegen/ändern/löschen) nur noch mit einem aktiven Admin-Zugang möglich sind, statt wie vorher für jeden Besucher offen zu sein. Lesen bleibt weiterhin öffentlich, und das öffentliche Einreichen/Voten von Kartenideen funktioniert unverändert.

Lege direkt nach dem ersten Ausführen deinen eigenen Admin-Zugang an (über die Login-Seite in `admin.html`, siehe Kommentar im Skript), **bevor** du den Link zur Seite weitergibst.

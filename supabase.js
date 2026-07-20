/* ============================================================
   Bkmp - Supabase Konfiguration

   Wichtig: Hier wird ausschliesslich der Publishable Key genutzt.
   Der Secret Key gehoert niemals in diese Datei oder in den Browser.
   Wenn Supabase nicht erreichbar ist, nutzt die Website automatisch
   localStorage als Fallback.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

let bkmpSupabaseClient = null;

function bkmpIsSupabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('/rest/v1')
  );
}

function bkmpGetSupabaseClient() {
  if (!bkmpIsSupabaseConfigured()) return null;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.warn('Supabase Client wurde nicht geladen. localStorage-Fallback wird verwendet.');
    return null;
  }
  if (!bkmpSupabaseClient) {
    bkmpSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return bkmpSupabaseClient;
}

async function bkmpStoreImageIfNeeded(value, folder) {
  if (!value || typeof value !== 'string' || !value.startsWith('data:image/')) return value || '';
  const client = bkmpGetSupabaseClient();
  if (!client) return value;
  const response = await fetch(value);
  const blob = await response.blob();
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'jpg' : 'webp';
  const safeFolder = String(folder || 'content').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const fileName = `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await client.storage
    .from('update-images')
    .upload(fileName, blob, {
      contentType: blob.type || 'image/webp',
      upsert: false
    });
  if (error) throw error;
  const { data } = client.storage.from('update-images').getPublicUrl(fileName);
  return data && data.publicUrl ? data.publicUrl : value;
}

/* ============================================================
   Nachtraegliche Komprimierung bereits hochgeladener Bilder
   Betrifft nur Bilder, die VOR der Kompressions-Funktion
   hochgeladen wurden (about_blocks, partner_shops, wishes).
   Bilder unter 150 KB werden uebersprungen, da sich eine erneute
   Komprimierung dort kaum noch lohnt.
   ============================================================ */
async function bkmpCompressRemoteImageUrl(url, folder) {
  if (!url || typeof url !== 'string') return null;
  const isFetchable = /^https?:\/\//i.test(url) || url.startsWith('data:image/');
  if (!isFetchable) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type || !blob.type.startsWith('image/')) return null;
    if (blob.size < 150000) return null;
    const file = new File([blob], 'image', { type: blob.type });
    const compressedDataUrl = await bkmpCompressImageFile(file, { maxWidth: 1000, quality: 0.74 });
    if (typeof compressedDataUrl !== 'string' || !compressedDataUrl.startsWith('data:image/')) return null;
    const uploadedUrl = await bkmpStoreImageIfNeeded(compressedDataUrl, folder);
    if (!uploadedUrl || uploadedUrl === compressedDataUrl) return null;
    return { newUrl: uploadedUrl, beforeBytes: blob.size };
  } catch (e) {
    console.warn('Bild konnte nicht nachkomprimiert werden:', url.slice(0, 60), e);
    return null;
  }
}

async function compressAboutBlockImages(onProgress) {
  const client = bkmpGetSupabaseClient();
  if (!client) return { processed: 0, compressed: 0 };
  const { data: rows, error } = await client.from('about_blocks').select('id, image_url, image_urls');
  if (error) throw error;
  let processed = 0;
  let compressed = 0;
  for (const row of rows || []) {
    const urls = Array.isArray(row.image_urls) && row.image_urls.length ? row.image_urls : (row.image_url ? [row.image_url] : []);
    if (!urls.length) continue;
    const nextUrls = [];
    let changed = false;
    for (const url of urls) {
      processed++;
      if (typeof onProgress === 'function') onProgress({ table: 'about_blocks', processed, compressed });
      const result = await bkmpCompressRemoteImageUrl(url, 'about');
      if (result) {
        nextUrls.push(result.newUrl);
        changed = true;
        compressed++;
      } else {
        nextUrls.push(url);
      }
    }
    if (changed) {
      const { error: updateError } = await client
        .from('about_blocks')
        .update({ image_url: nextUrls[0] || '', image_urls: nextUrls })
        .eq('id', row.id);
      if (updateError) console.warn('about_blocks Update fehlgeschlagen:', row.id, updateError);
    }
  }
  return { processed, compressed };
}

async function compressPartnerShopImages(onProgress) {
  const client = bkmpGetSupabaseClient();
  if (!client) return { processed: 0, compressed: 0 };
  const { data: rows, error } = await client.from('partner_shops').select('id, image_url');
  if (error) throw error;
  let processed = 0;
  let compressed = 0;
  for (const row of rows || []) {
    if (!row.image_url) continue;
    processed++;
    if (typeof onProgress === 'function') onProgress({ table: 'partner_shops', processed, compressed });
    const result = await bkmpCompressRemoteImageUrl(row.image_url, 'partner-shops');
    if (result) {
      const { error: updateError } = await client.from('partner_shops').update({ image_url: result.newUrl }).eq('id', row.id);
      if (updateError) console.warn('partner_shops Update fehlgeschlagen:', row.id, updateError);
      else compressed++;
    }
  }
  return { processed, compressed };
}

async function compressWishImages(onProgress) {
  const client = bkmpGetSupabaseClient();
  if (!client) return { processed: 0, compressed: 0 };
  const { data: rows, error } = await client.from('wishes').select('id, image_url');
  if (error) throw error;
  let processed = 0;
  let compressed = 0;
  for (const row of rows || []) {
    if (!row.image_url) continue;
    processed++;
    if (typeof onProgress === 'function') onProgress({ table: 'wishes', processed, compressed });
    const result = await bkmpCompressRemoteImageUrl(row.image_url, 'wishes');
    if (result) {
      const { error: updateError } = await client.from('wishes').update({ image_url: result.newUrl }).eq('id', row.id);
      if (updateError) console.warn('wishes Update fehlgeschlagen:', row.id, updateError);
      else compressed++;
    }
  }
  return { processed, compressed };
}

async function compressAllExistingImages(onProgress) {
  const about = await compressAboutBlockImages(onProgress);
  const shops = await compressPartnerShopImages(onProgress);
  const wishes = await compressWishImages(onProgress);
  return {
    processed: about.processed + shops.processed + wishes.processed,
    compressed: about.compressed + shops.compressed + wishes.compressed,
    about,
    shops,
    wishes
  };
}

window.compressAllExistingImages = compressAllExistingImages;

function bkmpIsPersistentImageUrl(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.startsWith('data:image/')) return false;
  return /^(https?:\/\/|assets\/|\/)/i.test(value);
}

function bkmpUseLocalImageIfPersistent(target, local) {
  if (!target || !local || target.image || !bkmpIsPersistentImageUrl(local.image)) return;
  target.image = local.image;
  if (Array.isArray(local.images)) {
    target.images = local.images.filter(bkmpIsPersistentImageUrl);
  }
}

function bkmpAdminEmailFromName(name) {
  const clean = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  /* Supabase lehnt die Domain-Endung ".local" mittlerweile als "invalid
     email" ab (unabhaengig von Projekteinstellungen - kein Toggle dafuer
     im Dashboard, vermutlich eine Sperrliste "reservierter" Endungen wie
     .local/.test/.invalid/.example). ".com" ist garantiert eine echte,
     nirgends blockierte Endung - es wird trotzdem nie eine echte E-Mail
     verschickt (Confirm-Email ist fuer dieses Projekt aus, siehe Zugaenge). */
  return clean ? clean + '@bkmp-admin-accounts.com' : '';
}

/* Bestehende, vor diesem Fix angelegte Admin-Zugaenge haben ihre echte
   Supabase-Auth-E-Mail noch auf ".local" - dieser Login-Versuch bleibt als
   Rueckfalloption erhalten, damit niemand ausgesperrt wird. Neue Zugaenge
   werden ausschliesslich ueber bkmpAdminEmailFromName() (".com") angelegt. */
function bkmpAdminEmailFromNameLegacy(name) {
  const clean = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return clean ? clean + '@bkmp-admin.local' : '';
}

async function bkmpLoginAdmin(name, password) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  let email = bkmpAdminEmailFromName(name);
  if (!email || !password) throw new Error('Name und Passwort fehlen.');
  let { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    const legacyEmail = bkmpAdminEmailFromNameLegacy(name);
    const legacyResult = await client.auth.signInWithPassword({ email: legacyEmail, password });
    if (legacyResult.error) throw error;
    data = legacyResult.data;
    email = legacyEmail;
  }
  const userId = data && data.user ? data.user.id : '';
  /* Nur die EIGENE Zeile abfragen (RLS erlaubt seit supabase-admin-profiles-
     select-fix.sql ohnehin nur noch das) statt frueher ALLE admin_profiles
     ungefiltert zu holen und client-seitig zu durchsuchen. Die Frage "ist
     die Tabelle wirklich komplett leer?" (Bootstrap-Fall: allererster Admin
     ueberhaupt) laesst sich unter RLS nicht mehr aus dieser gefilterten
     Liste beantworten - dafuer die separate RLS-unabhaengige Zaehlfunktion. */
  const { data: ownRows, error: ownError } = await client
    .from('admin_profiles')
    .select('id, login_name, role, company_id, can_edit_profile, active')
    .eq('auth_user_id', userId)
    .limit(1);
  if (ownError) throw ownError;
  const ownProfile = Array.isArray(ownRows) ? ownRows[0] : null;
  if (!ownProfile) {
    const { data: totalCount, error: countError } = await client.rpc('admin_profiles_count');
    if (countError) throw countError;
    if (Number(totalCount) > 0) {
      await client.auth.signOut();
      throw new Error('Dieser Admin-Zugang ist nicht aktiv.');
    }
    const { error: insertError } = await client.from('admin_profiles').insert({
      auth_user_id: userId,
      display_name: String(name || '').trim(),
      login_name: email,
      role: 'admin',
      active: true
    });
    if (insertError) throw insertError;
    return { session: data, profile: { role: 'admin', active: true } };
  }
  if (!ownProfile.active) {
    await client.auth.signOut();
    throw new Error('Dieser Admin-Zugang ist nicht aktiv.');
  }
  return { session: data, profile: ownProfile };
}

async function bkmpLogoutAdmin() {
  const client = bkmpGetSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}

async function bkmpGetAdminSession() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data && data.session ? data.session : null;
}

async function bkmpGetValidAdminSession() {
  const result = await bkmpGetValidAdminProfile();
  return result ? result.session : null;
}

async function bkmpGetValidAdminProfile() {
  const session = await bkmpGetAdminSession();
  if (!session || !session.user || !session.user.email) return null;
  const client = bkmpGetSupabaseClient();
  try {
    const { data, error } = await client
      .from('admin_profiles')
      .select('role, company_id, can_edit_profile, active')
      .eq('login_name', session.user.email)
      .limit(1);
    if (error) throw error;
    const profile = Array.isArray(data) ? data[0] : null;
    if (profile && profile.active) return { session, profile };
  } catch (e) {
    console.warn('Admin-Session konnte nicht geprueft werden.', e);
  }
  await client.auth.signOut();
  return null;
}

/* ---------------- Spieler-Konto (Name + Passwort, "Wer bist du?") ----------------
   Echtes Login fuer Achievements/Idle-Dorf/Bestenliste/Bonk/Pluschies -
   ersetzt den alten reinen Freitext-Namen. Gleiche Fake-E-Mail-Technik wie
   bkmpAdminEmailFromName/bkmpCustomerEmailFromCode, aber mit einem
   selbstgewaehlten Passwort statt eines generierten Codes. Laeuft ueber
   einen EIGENEN, isolierten Client (eigener storageKey) - so kollidiert die
   Spieler-Session auf index.html nicht mit einer gleichzeitig aktiven
   MapArt-Kunden-Session (die den default-Client mit storageKey
   'bkmp-customer-auth' nutzt, siehe bkmpGetSupabaseClient). Siehe
   supabase-player-accounts.sql fuer die zugehoerige RLS: jede
   player_stats/idle_player_state-Zeile ist fest an auth.uid() UND den in
   der JWT hinterlegten display_name gebunden. */
let bkmpPlayerAuthClient = null;
function bkmpGetPlayerAuthClient() {
  if (!bkmpIsSupabaseConfigured() || !window.supabase) return null;
  if (!bkmpPlayerAuthClient) {
    bkmpPlayerAuthClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storageKey: 'bkmp-player-auth' },
      /* Bug-Report 17.07.: "Gold wird immer zurueckgesetzt beim Reload."
         Ursache: der beforeunload/visibilitychange-Speicherversuch (siehe
         idledorf.js bkmpIdleFlushSync) ist ein ASYNCHRONER fetch() - Browser
         brechen laufende asynchrone Requests beim Seitenwechsel so gut wie
         immer ab, bevor die Antwort ankommt, ausser man markiert sie
         explizit als keepalive (dann darf der Request die Seite ueberleben,
         siehe MDN fetch keepalive). Alle Spielstand-Schreibvorgaenge sind
         kleine JSON-Payloads, bleiben also sicher unter dem 64kB-Limit von
         keepalive-Requests. */
      global: { fetch: (url, options) => fetch(url, { ...options, keepalive: true }) }
    });
  }
  return bkmpPlayerAuthClient;
}

function bkmpPlayerEmailFromName(name) {
  const clean = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return clean ? clean + '@bkmp-player-accounts.com' : '';
}

/* Bestehende, vor diesem Umbau angelegte player_stats/idle_player_state-
   Zeilen haben auth_user_id = null ("verwaist"). Beim ersten echten
   Login/Registrieren mit demselben Namen wird die Zeile hier "geclaimt" -
   bestehender Fortschritt geht nicht verloren. Laeuft bewusst mehrfach
   idempotent (bei Register UND bei jedem Login), falls eine verwaiste Zeile
   erst nach der Registrierung entstanden ist (z. B. durch aeltere,
   zwischengespeicherte Anfragen). Kein Fehler, wenn keine Zeile existiert
   oder schon geclaimt ist (0 betroffene Zeilen). */
/* Laeuft ueber die SECURITY DEFINER-Funktion claim_player_row()
   (supabase-player-accounts-v2.sql) statt ueber direkte Table-Updates -
   robuster als der urspruengliche RLS-Ansatz (kein Abgleich gegen ein evtl.
   noch nicht aktualisiertes JWT noetig, siehe Kommentar dort). */
async function bkmpClaimPlayerNameKeyRows(client, nameKey) {
  try {
    await client.rpc('claim_player_row', { p_name_key: nameKey });
  } catch (e) {
    console.warn('Bestehender Fortschritt konnte nicht automatisch uebernommen werden.', e);
  }
}

async function bkmpPlayerRename(newName) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const cleanName = String(newName || '').trim();
  if (!cleanName) throw new Error('Bitte einen gueltigen Ingame-Namen eintragen.');
  const { error } = await client.rpc('rename_player_account', { p_new_name: cleanName });
  if (error) {
    const code = String(error.message || '');
    if (code.includes('cooldown_active')) throw new Error('Du kannst deinen Namen erst wieder 30 Tage nach der letzten Aenderung anpassen.');
    if (code.includes('name_taken')) throw new Error('Dieser Ingame-Name ist bereits vergeben.');
    if (code.includes('same_name')) throw new Error('Das ist bereits dein aktueller Name.');
    if (code.includes('name_blocked')) throw new Error('Dieser Name ist nicht erlaubt.');
    if (code.includes('invalid_name')) throw new Error('Bitte einen gueltigen Ingame-Namen eintragen (max. 32 Zeichen).');
    if (code.includes('no_account')) throw new Error('Es wurde kein Spieler-Konto gefunden. Bitte melde dich erneut an.');
    throw new Error('Der Name konnte nicht geaendert werden. Bitte versuche es spaeter erneut.');
  }
  return cleanName;
}

async function bkmpPlayerChangePassword(newPassword) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  if (!newPassword || newPassword.length < 6) throw new Error('Das Passwort braucht mindestens 6 Zeichen.');
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw new Error('Das Passwort konnte nicht geaendert werden. Bitte versuche es spaeter erneut.');
}

async function bkmpPlayerRegister(name, password) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const displayName = String(name || '').trim();
  const email = bkmpPlayerEmailFromName(displayName);
  if (!email) throw new Error('Bitte einen gueltigen Ingame-Namen eintragen.');
  if (!password || password.length < 6) throw new Error('Das Passwort braucht mindestens 6 Zeichen.');

  /* Vorab-Check gegen die Namens-Sperrliste (supabase-player-name-
     blocklist.sql) - blockiert rassistische/NS-verherrlichende Namen schon
     vor dem eigentlichen signUp, damit eine saubere deutsche Fehlermeldung
     erscheint statt eines rohen Datenbankfehlers aus dem gleichnamigen
     auth.users-Trigger (der als zweite, nicht umgehbare Sperre bestehen
     bleibt). Schlaegt der RPC-Aufruf selbst fehl (z. B. Migration noch nicht
     ausgefuehrt), wird die Registrierung nicht blockiert - der Trigger faengt
     es dann ohnehin serverseitig ab. */
  try {
    const { data: blocked } = await client.rpc('is_name_blocked', { p_name: displayName });
    if (blocked) throw new Error('Dieser Name ist nicht erlaubt.');
  } catch (e) {
    if (e instanceof Error && e.message === 'Dieser Name ist nicht erlaubt.') throw e;
  }

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) {
    if (/already registered|already exists|user_already_exists/i.test(error.message || '')) {
      throw new Error('Dieser Ingame-Name ist bereits registriert. Bitte melde dich an.');
    }
    if (/name_blocked/i.test(error.message || '')) {
      throw new Error('Dieser Name ist nicht erlaubt.');
    }
    throw error;
  }
  /* Supabase gibt bei bereits existierender, aber unbestaetigter Adresse
     manchmal keinen Fehler, sondern ein "leeres" Identities-Array zurueck -
     das ist bei diesem Projekt (Confirm-Email aus) nicht der Fall, aber zur
     Sicherheit trotzdem geprueft. */
  if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('Dieser Ingame-Name ist bereits registriert. Bitte melde dich an.');
  }

  await bkmpClaimPlayerNameKeyRows(client, displayName.toLowerCase());
  return { session: data.session, displayName };
}

async function bkmpPlayerLogin(name, password) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const displayName = String(name || '').trim();
  const email = bkmpPlayerEmailFromName(displayName);
  if (!email || !password) throw new Error('Ingame-Name oder Passwort ist falsch.');

  let { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    /* Der eingegebene Name koennte ein FRUEHERER Name sein (nach einer
       Namensaenderung bleibt die Login-Adresse bewusst am urspruenglich
       registrierten Namen haengen, siehe supabase-player-accounts-v2.sql).
       resolve_login_name() laeuft die Umbenennungs-Historie rueckwaerts bis
       zum allerersten Namen durch - damit funktioniert Login mit JEDEM
       Namen, den der Account je hatte, nicht nur dem aktuellsten. */
    try {
      const { data: resolvedName } = await client.rpc('resolve_login_name', { p_name: displayName });
      if (resolvedName && resolvedName.toLowerCase() !== displayName.toLowerCase()) {
        const resolvedEmail = bkmpPlayerEmailFromName(resolvedName);
        const retry = await client.auth.signInWithPassword({ email: resolvedEmail, password });
        if (!retry.error) { data = retry.data; error = null; }
      }
    } catch (e) { /* Aufloesung fehlgeschlagen - urspruenglicher Fehler bleibt bestehen */ }
  }
  if (error) throw new Error('Ingame-Name oder Passwort ist falsch.');

  /* Aktuellen Anzeigenamen aus player_stats lesen statt aus dem Login-
     Token: nach einer Namensaenderung ist das zuverlaessiger als
     user_metadata.display_name (das aeltere, vor v3 umbenannte Accounts
     evtl. noch nicht aktualisiert haben). */
  let canonicalName = (data.user && data.user.user_metadata && data.user.user_metadata.display_name) || displayName;
  try {
    const { data: rows } = await client.from('player_stats').select('display_name').eq('auth_user_id', data.user.id).limit(1);
    if (Array.isArray(rows) && rows[0] && rows[0].display_name) canonicalName = rows[0].display_name;
  } catch (e) { /* Fallback bleibt der Token-Name */ }

  await bkmpClaimPlayerNameKeyRows(client, canonicalName.toLowerCase());
  return { session: data.session, displayName: canonicalName };
}

async function bkmpPlayerLogout() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return;
  await client.auth.signOut();
  bkmpIdlePlayerStateUserIdCache = null;
}

/* Loescht den kompletten Spielstand + Login-Account unwiderruflich, siehe
   supabase-player-account-delete.sql (delete_own_player_account, security
   definer - prueft server-seitig auth.uid(), ein Nutzer kann also nur
   seinen EIGENEN Account loeschen). Meldet sich am Ende selbst ab, da der
   Auth-Account nach dem Aufruf nicht mehr existiert. */
async function bkmpPlayerDeleteOwnAccount() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('delete_own_player_account');
  if (error) {
    if (String(error.message || '').includes('not_authenticated')) throw new Error('Du bist nicht mehr eingeloggt. Bitte melde dich erneut an.');
    throw new Error('Der Account konnte nicht gelöscht werden. Bitte versuche es später erneut.');
  }
  try { await client.auth.signOut(); } catch (e) { /* Account existiert eh nicht mehr */ }
}

async function bkmpGetPlayerSession() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data && data.session ? data.session : null;
}

/* Beim Seitenload aufgerufen: stellt eine bestehende Spieler-Session wieder
   her (Supabase persistiert sie automatisch in localStorage) und liefert
   den kanonischen Anzeigenamen zurueck, oder '' wenn niemand eingeloggt
   ist. */
async function bkmpRestorePlayerSession() {
  const session = await bkmpGetPlayerSession();
  if (!session || !session.user) return '';
  /* NICHT user_metadata.display_name vertrauen: das steckt im JWT und wird
     nach einer Namensaenderung (rename_player_account) erst beim naechsten
     ECHTEN Token-Refresh aktuell - bis dahin wuerde hier wieder der alte
     Name zurueckgegeben, obwohl player_stats laengst den neuen Namen hat.
     Stattdessen player_stats direkt per auth_user_id abfragen (die
     zuverlaessige, immer aktuelle Quelle). Faellt nur zurueck auf
     user_metadata, falls player_stats aus irgendeinem Grund noch keine
     Zeile fuer dieses Konto hat. */
  const client = bkmpGetPlayerAuthClient();
  try {
    const { data, error } = await client.from('player_stats').select('display_name').eq('auth_user_id', session.user.id).limit(1);
    if (!error && Array.isArray(data) && data[0] && data[0].display_name) return data[0].display_name;
  } catch (e) { /* Fallback unten */ }

  /* Keine player_stats-Zeile mit dieser auth_user_id gefunden - das kann
     eine VERWAISTE Zeile bedeuten: name_key existiert bereits (aeltere
     Zeile von vor dem Account-System oder ein claim_player_row()-Aufruf,
     der frueher aus irgendeinem Grund fehlschlug), aber auth_user_id ist
     dort noch null. bkmpClaimPlayerNameKeyRows() (die claim_player_row()
     RPC) lief bisher NUR beim expliziten Login (bkmpPlayerLogin) - ein
     Nutzer, der eingeloggt bleibt und die Seite einfach nur neu laedt
     (bkmpRestorePlayerSession, kein neuer Login), hat die Verknuepfung nie
     nachgeholt bekommen. Ergebnis: upsertPlayerStats/upsertIdlePlayerState
     fanden per auth_user_id nie eine Zeile, das anschliessende Insert
     schlug wegen des bereits vergebenen name_key dauerhaft fehl (still im
     catch verschluckt) - die Bestenliste blieb fuer genau diese Konten
     für immer auf dem alten Stand haengen, auch nach einem harten Reload.
     Claim hier nachholen und die Abfrage einmal wiederholen. */
  const fallbackName = (session.user.user_metadata && session.user.user_metadata.display_name) || '';
  if (fallbackName) {
    await bkmpClaimPlayerNameKeyRows(client, fallbackName.toLowerCase());
    try {
      const { data, error } = await client.from('player_stats').select('display_name').eq('auth_user_id', session.user.id).limit(1);
      if (!error && Array.isArray(data) && data[0] && data[0].display_name) return data[0].display_name;
    } catch (e) { /* Fallback unten */ }
  }
  return fallbackName;
}

function bkmpGetAuthCreateClient() {
  if (!bkmpIsSupabaseConfigured() || !window.supabase) return null;
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'bkmp-admin-create-temp'
    }
  });
}

async function loadAdminProfiles() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('admin_profiles')
    .select('id, auth_user_id, display_name, login_name, role, company_id, can_edit_profile, active, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createAdminAccess(name, password, role, companyId, canEditProfile) {
  const currentClient = bkmpGetSupabaseClient();
  const createClient = bkmpGetAuthCreateClient();
  if (!currentClient || !createClient) throw new Error('Supabase ist nicht verbunden.');
  const displayName = String(name || '').trim();
  const email = bkmpAdminEmailFromName(displayName);
  if (!email) throw new Error('Bitte einen gueltigen Namen eintragen.');
  if (!password || password.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
  if (role === 'company' && !companyId) throw new Error('Bitte eine Firma auswaehlen.');

  const { data: signUpData, error: signUpError } = await createClient.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, role: role || 'admin' } }
  });
  if (signUpError) throw signUpError;

  const authUserId = signUpData && signUpData.user ? signUpData.user.id : null;
  const { data, error } = await currentClient
    .from('admin_profiles')
    .upsert({
      auth_user_id: authUserId,
      display_name: displayName,
      login_name: email,
      role: role || 'admin',
      company_id: role === 'company' ? companyId : null,
      can_edit_profile: role === 'company' ? Boolean(canEditProfile) : false,
      active: true
    }, { onConflict: 'login_name' })
    .select('id, auth_user_id, display_name, login_name, role, company_id, can_edit_profile, active, created_at')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function setAdminAccessActive(id, active) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('admin_profiles').update({ active: Boolean(active) }).eq('id', id);
  if (error) throw error;
  return true;
}

function bkmpMapIncomeFromSupabase(row) {
  return {
    id: row.id,
    name: typeof bkmpNormalizeCategoryName === 'function' ? bkmpNormalizeCategoryName(row.category) : row.category,
    category: typeof bkmpNormalizeCategoryName === 'function' ? bkmpNormalizeCategoryName(row.category) : row.category,
    amount: Number(row.amount || 0),
    date: row.date,
    note: row.note || '',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpNormalizeIncomeDate(income) {
  if (income.date && /^\d{4}-\d{2}-\d{2}$/.test(income.date)) return income.date;
  if (income.date) {
    const parsedDate = new Date(income.date);
    if (!Number.isNaN(parsedDate.getTime())) return parsedDate.toISOString().slice(0, 10);
  }
  if (income.createdAt) {
    const createdDate = new Date(income.createdAt);
    if (!Number.isNaN(createdDate.getTime())) return createdDate.toISOString().slice(0, 10);
  }
  return null;
}

function bkmpMapIncomeToSupabase(income, options = {}) {
  const payload = {
    category: income.category || income.name,
    amount: Number(income.amount || 0),
    date: bkmpNormalizeIncomeDate(income),
    note: income.note || null
  };

  if (options.keepCreatedAt && income.createdAt) {
    const createdDate = new Date(income.createdAt);
    if (!Number.isNaN(createdDate.getTime())) {
      payload.created_at = createdDate.toISOString();
    }
  }

  return payload;
}

function bkmpIncomeSignature(income) {
  return [
    income.category || income.name || '',
    Number(income.amount || 0).toFixed(2),
    income.date || '',
    income.note || '',
    income.createdAt ? new Date(income.createdAt).toISOString() : ''
  ].join('|');
}

async function loadIncomes() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('incomes')
    .select('id, category, amount, date, note, created_at')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(bkmpMapIncomeFromSupabase);
}

async function saveIncome(income) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('incomes')
    .insert(bkmpMapIncomeToSupabase(income))
    .select('id, category, amount, date, note, created_at')
    .single();

  if (error) throw error;
  return bkmpMapIncomeFromSupabase(data);
}

async function deleteIncome(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;

  const { error } = await client
    .from('incomes')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

async function syncIncomesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadIncomes !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const incomes = await loadIncomes();
    if (!incomes) return false;

    const localIncomeCount = Array.isArray(targetData.income) ? targetData.income.length : 0;
    if (localIncomeCount > 0 && incomes.length === 0) {
      console.warn('Supabase enthaelt keine Einnahmen. Lokale Daten bleiben erhalten.');
      return false;
    }

    targetData.income = incomes;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Einnahmen nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalIncomesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) {
    console.warn('Supabase ist nicht verbunden. Import wurde abgebrochen.');
    return { imported: 0, skipped: 0, skippedInvalid: 0, total: 0 };
  }

  const localData = bkmpLoadData();
  const localIncomes = Array.isArray(localData.income) ? localData.income : [];
  if (localIncomes.length === 0) {
    return { imported: 0, skipped: 0, skippedInvalid: 0, total: 0 };
  }

  const remoteIncomes = await loadIncomes() || [];
  const existing = new Set(remoteIncomes.map(bkmpIncomeSignature));
  const rowsToInsert = [];
  let skipped = 0;
  let skippedInvalid = 0;

  localIncomes.forEach(income => {
    const payload = bkmpMapIncomeToSupabase(income, { keepCreatedAt: true });
    if (!payload.category || !payload.date || Number.isNaN(payload.amount)) {
      skippedInvalid += 1;
      console.warn('Einnahme ohne gueltige Kategorie, Betrag oder Datum wurde beim Import uebersprungen:', income);
      return;
    }

    const signature = bkmpIncomeSignature({
      name: payload.category,
      category: payload.category,
      amount: payload.amount,
      date: payload.date,
      note: payload.note || '',
      createdAt: payload.created_at ? Date.parse(payload.created_at) : 0
    });

    if (existing.has(signature)) {
      skipped += 1;
      return;
    }
    existing.add(signature);
    rowsToInsert.push(payload);
  });

  if (rowsToInsert.length > 0) {
    const { error } = await client.from('incomes').insert(rowsToInsert);
    if (error) throw error;
  }

  const refreshed = await loadIncomes() || [];
  localData.income = refreshed;
  bkmpSaveData(localData);

  return {
    imported: rowsToInsert.length,
    skipped,
    skippedInvalid,
    total: refreshed.length
  };
}

function bkmpMapInvestorFromSupabase(row) {
  return {
    id: row.id,
    name: row.name,
    minecraftName: row.note || '',
    invested: Number(row.investment || 0),
    sharePercent: Number(row.profit_percent || 0),
    startDate: row.start_date || '',
    endDate: row.end_date || '',
    anonymous: Boolean(row.anonymous),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapInvestorToSupabase(investor) {
  return {
    name: investor.name,
    investment: Number(investor.invested || investor.investment || 0),
    profit_percent: Number(investor.sharePercent || investor.profit_percent || 0),
    start_date: investor.startDate || investor.start_date || null,
    end_date: investor.endDate || investor.end_date || null,
    note: investor.minecraftName || investor.note || null,
    anonymous: Boolean(investor.anonymous)
  };
}

async function loadInvestors() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('investors')
    .select('id, name, investment, profit_percent, start_date, end_date, note, anonymous, created_at')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(bkmpMapInvestorFromSupabase);
}

async function saveInvestor(investor) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const payload = bkmpMapInvestorToSupabase(investor);
  let query;
  if (investor.id && !String(investor.id).startsWith('inv-')) {
    query = client
      .from('investors')
      .update(payload)
      .eq('id', investor.id)
      .select('id, name, investment, profit_percent, start_date, end_date, note, anonymous, created_at')
      .single();
  } else {
    query = client
      .from('investors')
      .insert(payload)
      .select('id, name, investment, profit_percent, start_date, end_date, note, anonymous, created_at')
      .single();
  }

  const { data, error } = await query;
  if (error) throw error;
  return bkmpMapInvestorFromSupabase(data);
}

async function deleteInvestor(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;

  const { error } = await client
    .from('investors')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

async function syncInvestorsFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadInvestors !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const investors = await loadInvestors();
    if (!investors) return false;

    const localInvestorCount = Array.isArray(targetData.investors) ? targetData.investors.length : 0;
    if (localInvestorCount > 0 && investors.length === 0) {
      console.warn('Supabase enthaelt keine Investoren. Lokale Daten bleiben erhalten.');
      return false;
    }

    targetData.investors = investors;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Investoren nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalInvestorsToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) {
    console.warn('Supabase ist nicht verbunden. Import wurde abgebrochen.');
    return { imported: 0, skipped: 0, total: 0 };
  }

  const localData = bkmpLoadData();
  const localInvestors = Array.isArray(localData.investors) ? localData.investors : [];
  const remoteInvestors = await loadInvestors() || [];
  const existing = new Set(remoteInvestors.map(item => [item.name, item.invested, item.sharePercent, item.startDate, item.endDate, item.minecraftName].join('|')));
  const rowsToInsert = [];
  let skipped = 0;

  localInvestors.forEach(investor => {
    const mapped = bkmpMapInvestorFromSupabase({
      id: investor.id,
      name: investor.name,
      investment: investor.invested,
      profit_percent: investor.sharePercent,
      start_date: investor.startDate || null,
      end_date: investor.endDate || null,
      note: investor.minecraftName || null,
      created_at: investor.createdAt ? new Date(investor.createdAt).toISOString() : null
    });
    const sig = [mapped.name, mapped.invested, mapped.sharePercent, mapped.startDate, mapped.endDate, mapped.minecraftName].join('|');
    if (existing.has(sig)) {
      skipped += 1;
      return;
    }
    existing.add(sig);
    rowsToInsert.push(bkmpMapInvestorToSupabase(mapped));
  });

  if (rowsToInsert.length > 0) {
    const { error } = await client.from('investors').insert(rowsToInsert);
    if (error) throw error;
  }

  const refreshed = await loadInvestors() || [];
  localData.investors = refreshed;
  bkmpSaveData(localData);
  return { imported: rowsToInsert.length, skipped, total: refreshed.length };
}

window.importLocalInvestorsToSupabase = importLocalInvestorsToSupabase;

function bkmpMapExpenseFromSupabase(row) {
  return {
    id: row.id,
    name: typeof bkmpNormalizeCategoryName === 'function' ? bkmpNormalizeCategoryName(row.category) : row.category,
    category: typeof bkmpNormalizeCategoryName === 'function' ? bkmpNormalizeCategoryName(row.category) : row.category,
    amount: Number(row.amount || 0),
    date: row.date,
    note: row.note || '',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapExpenseToSupabase(expense) {
  return {
    category: expense.category || expense.name,
    amount: Number(expense.amount || 0),
    date: expense.date,
    note: expense.note || null
  };
}

async function loadExpenses() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('expenses')
    .select('id, category, amount, date, note, created_at')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(bkmpMapExpenseFromSupabase);
}

async function saveExpense(expense) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('expenses')
    .insert(bkmpMapExpenseToSupabase(expense))
    .select('id, category, amount, date, note, created_at')
    .single();
  if (error) throw error;
  return bkmpMapExpenseFromSupabase(data);
}

async function deleteExpense(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('expenses').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncExpensesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadExpenses !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const expenses = await loadExpenses();
    if (!expenses) return false;
    const localCount = Array.isArray(targetData.expenses) ? targetData.expenses.length : 0;
    if (localCount > 0 && expenses.length === 0) {
      console.warn('Supabase enthaelt keine Ausgaben. Lokale Daten bleiben erhalten.');
      return false;
    }
    targetData.expenses = expenses;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Ausgaben nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

function bkmpMapUpdateFromSupabase(row) {
  const images = Array.isArray(row.image_urls) ? row.image_urls : [];
  const createdAt = row.created_at ? Date.parse(row.created_at) : 0;
  return {
    id: row.id,
    title: row.title,
    text: row.content || '',
    image: images[0] || '',
    images,
    date: row.created_at ? row.created_at.slice(0, 10) : '',
    createdAt,
    source: 'supabase'
  };
}

function bkmpMapUpdateToSupabase(update) {
  const images = update.images && update.images.length ? update.images : (update.image ? [update.image] : []);
  const payload = {
    title: update.title,
    content: update.text || update.content || '',
    image_urls: images
  };
  if (update.date) payload.created_at = update.date + 'T12:00:00.000Z';
  return payload;
}

function bkmpDedupeSupabaseUpdates(list) {
  if (typeof bkmpDedupeUpdates === 'function') return bkmpDedupeUpdates(list);
  return list || [];
}

async function loadUpdates() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('updates')
    .select('id, title, content, image_urls, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return bkmpDedupeSupabaseUpdates((data || []).map(bkmpMapUpdateFromSupabase));
}

async function saveUpdate(update) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapUpdateToSupabase(update);
  if (update.id && !String(update.id).startsWith('news-')) {
    if (!payload.image_urls.length) {
      const { data: existingRows, error: existingError } = await client
        .from('updates')
        .select('image_urls')
        .eq('id', update.id)
        .limit(1);
      if (existingError) throw existingError;
      const existingImages = Array.isArray(existingRows) && existingRows[0] && Array.isArray(existingRows[0].image_urls)
        ? existingRows[0].image_urls
        : [];
      if (existingImages.length) payload.image_urls = existingImages;
    }

    const { data, error } = await client
      .from('updates')
      .update(payload)
      .eq('id', update.id)
      .select('id, title, content, image_urls, created_at')
      .limit(1);

    if (error) throw error;
    const updated = Array.isArray(data) ? data[0] : null;
    if (updated) return bkmpMapUpdateFromSupabase(updated);

    const matchDate = update.date || (update.createdAt ? new Date(update.createdAt).toISOString().slice(0, 10) : '');
    let finder = client
      .from('updates')
      .select('id')
      .eq('title', update.title)
      .limit(1);

    if (matchDate) {
      finder = finder
        .gte('created_at', matchDate + 'T00:00:00.000Z')
        .lt('created_at', matchDate + 'T23:59:59.999Z');
    }

    let { data: matches, error: findError } = await finder;
    if (findError) throw findError;
    let match = Array.isArray(matches) ? matches[0] : null;

    if (!match && matchDate) {
      const { data: titleMatches, error: titleFindError } = await client
        .from('updates')
        .select('id')
        .eq('title', update.title)
        .limit(1);
      if (titleFindError) throw titleFindError;
      match = Array.isArray(titleMatches) ? titleMatches[0] : null;
    }

    if (match && match.id) {
      const { data: matchedData, error: matchedError } = await client
        .from('updates')
        .update(payload)
        .eq('id', match.id)
        .select('id, title, content, image_urls, created_at')
        .limit(1);
      if (matchedError) throw matchedError;
      const matchedUpdate = Array.isArray(matchedData) ? matchedData[0] : null;
      if (matchedUpdate) return bkmpMapUpdateFromSupabase(matchedUpdate);
    }
  }

  let existingQuery = client
    .from('updates')
    .select('id, title, content, image_urls, created_at')
    .eq('title', update.title)
    .eq('content', payload.content)
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: existingMatches, error: existingMatchError } = await existingQuery;
  if (existingMatchError) throw existingMatchError;
  const existingMatch = Array.isArray(existingMatches) ? existingMatches[0] : null;
  if (existingMatch && existingMatch.id) {
    if (!payload.image_urls.length && Array.isArray(existingMatch.image_urls)) payload.image_urls = existingMatch.image_urls;
    const { data: updatedData, error: updatedError } = await client
      .from('updates')
      .update(payload)
      .eq('id', existingMatch.id)
      .select('id, title, content, image_urls, created_at')
      .limit(1);
    if (updatedError) throw updatedError;
    const updatedMatch = Array.isArray(updatedData) ? updatedData[0] : null;
    if (updatedMatch) return bkmpMapUpdateFromSupabase(updatedMatch);
  }

  const { data, error } = await client
    .from('updates')
    .insert(payload)
    .select('id, title, content, image_urls, created_at')
    .limit(1);

  if (error) throw error;
  const inserted = Array.isArray(data) ? data[0] : null;
  if (!inserted) throw new Error('Supabase hat keinen gespeicherten Update-Eintrag zurueckgegeben.');
  return bkmpMapUpdateFromSupabase(inserted);
}

async function deleteUpdate(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('updates').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncUpdatesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadUpdates !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const updates = await loadUpdates();
    if (!updates) return false;
    const localCount = Array.isArray(targetData.news) ? targetData.news.length : 0;
    if (localCount > 0 && updates.length === 0) {
      console.warn('Supabase enthaelt keine Updates. Lokale Updates bleiben erhalten.');
      return false;
    }
    targetData.news = updates;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Updates nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function cleanupDuplicateUpdatesInSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { cleaned: 0, kept: 0 };
  const { data, error } = await client
    .from('updates')
    .select('id, title, content, image_urls, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const groups = new Map();
  (data || []).forEach(row => {
    const key = [row.title || '', row.content || ''].join('|').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  let cleaned = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const keeper = rows[0];
    const duplicates = rows.slice(1);
    const mergedImages = [...new Set(rows.flatMap(row => Array.isArray(row.image_urls) ? row.image_urls : []).filter(Boolean))];
    if (mergedImages.length) {
      const { error: updateError } = await client
        .from('updates')
        .update({ image_urls: mergedImages })
        .eq('id', keeper.id);
      if (updateError) throw updateError;
    }
    const { error: deleteError } = await client
      .from('updates')
      .delete()
      .in('id', duplicates.map(row => row.id));
    if (deleteError) throw deleteError;
    cleaned += duplicates.length;
  }

  return { cleaned, kept: groups.size };
}

window.cleanupDuplicateUpdatesInSupabase = cleanupDuplicateUpdatesInSupabase;

function bkmpMapWishFromSupabase(row) {
  return {
    id: row.id,
    name: row.name,
    image: row.image_url || '',
    likes: Number(row.likes || 0),
    dislikes: Number(row.dislikes || 0),
    status: row.status || 'approved',
    isRead: Boolean(row.is_read),
    date: row.created_at ? row.created_at.slice(0, 10) : '',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapWishToSupabase(wish) {
  const payload = {
    name: wish.name,
    image_url: wish.image || wish.image_url || ''
  };
  if (wish.status) payload.status = wish.status;
  return payload;
}

async function loadWishes() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  let { data, error } = await client
    .from('wishes')
    .select('id, name, image_url, likes, dislikes, status, is_read, created_at')
    .order('created_at', { ascending: false });

  if (error && (String(error.message || '').includes('likes') || String(error.message || '').includes('dislikes'))) {
    const fallback = await client
      .from('wishes')
      .select('id, name, image_url, created_at')
      .order('created_at', { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return (data || []).map(bkmpMapWishFromSupabase);
}

async function updateWishStatus(id, status) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('wishes')
    .update({ status })
    .eq('id', id)
    .select('id, name, image_url, likes, dislikes, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapWishFromSupabase(row) : null;
}

async function updateWishRead(id, isRead) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('wishes')
    .update({ is_read: isRead })
    .eq('id', id)
    .select('id, name, image_url, likes, dislikes, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapWishFromSupabase(row) : null;
}

/* Stimme ist ueber wish_votes (siehe supabase-wish-votes-schema.sql) auf
   1x pro Account und Kartenidee begrenzt - ein zweiter Insert-Versuch
   schlaegt am Unique-Constraint (wish_id, auth_user_id) fehl, unabhaengig
   vom Client. Direktes Hochzaehlen von likes/dislikes ist serverseitig
   gesperrt; die Spalten werden nur noch per Trigger nachgefuehrt. */
async function voteWish(wishId, type) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) throw new Error('not_authenticated');

  const { error: insertError } = await client
    .from('wish_votes')
    .insert({ wish_id: wishId, auth_user_id: userId, vote_type: type === 'dislike' ? 'dislike' : 'like' });
  if (insertError) {
    if (insertError.code === '23505') throw new Error('already_voted');
    throw insertError;
  }

  const { data, error } = await client
    .from('wishes')
    .select('id, name, image_url, likes, dislikes, status, created_at')
    .eq('id', wishId)
    .limit(1);
  if (error) throw error;
  const updated = Array.isArray(data) ? data[0] : null;
  return updated ? bkmpMapWishFromSupabase(updated) : null;
}

async function loadMyWishVotes() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return {};
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return {};
  const { data, error } = await client.from('wish_votes').select('wish_id, vote_type').eq('auth_user_id', userId);
  if (error) return {};
  const map = {};
  (data || []).forEach(row => { map[row.wish_id] = row.vote_type; });
  return map;
}

/* ---------------- Umfragen (siehe supabase-polls-schema.sql) ----------------
   Gleiches Muster wie wish_votes: die serverseitige 1x-Sperre kommt vom
   Unique-Constraint (poll_id, auth_user_id), nicht von einer reinen
   Frontend-Pruefung. */
async function loadActivePoll() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data, error } = await client
    .from('polls')
    .select('id, question, status, yes_votes, no_votes')
    .eq('status', 'active')
    .limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function loadMyPollVote(pollId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return null;
  const { data, error } = await client
    .from('poll_votes')
    .select('answer')
    .eq('poll_id', pollId)
    .limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length ? data[0].answer : null;
}

async function submitPollVote(pollId, answer) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) throw new Error('not_authenticated');

  const { error: insertError } = await client
    .from('poll_votes')
    .insert({ poll_id: pollId, auth_user_id: userId, answer: answer === 'no' ? 'no' : 'yes' });
  if (insertError) {
    if (insertError.code === '23505') throw new Error('already_voted');
    throw insertError;
  }

  const { data, error } = await client
    .from('polls')
    .select('id, question, status, yes_votes, no_votes')
    .eq('id', pollId)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

/* Admin-only ab hier: Anlegen/Aktivieren/Deaktivieren/Archivieren laufen
   ueber den admin.html-Client, per RLS auf is_active_admin() begrenzt. */
async function loadAllPolls() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('polls')
    .select('id, question, status, created_at, activated_at, deactivated_at, yes_votes, no_votes')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createPoll(question) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client
    .from('polls')
    .insert({ question: String(question || '').trim() })
    .select('id, question, status, created_at, activated_at, deactivated_at, yes_votes, no_votes')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function activatePoll(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('activate_poll', { p_poll_id: id });
  if (error) throw error;
}

async function deactivatePoll(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client
    .from('polls')
    .update({ status: 'ended', deactivated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'active');
  if (error) throw error;
}

async function archivePoll(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client
    .from('polls')
    .update({ status: 'archived' })
    .eq('id', id);
  if (error) throw error;
}

async function deleteWish(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('wishes').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncWishesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadWishes !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const wishes = await loadWishes();
    if (!wishes) return false;
    const localWishes = Array.isArray(targetData.wishes) ? targetData.wishes : [];
    wishes.forEach(wish => {
      if (wish.image) return;
      const local = localWishes.find(item =>
        String(item.id || '') === String(wish.id || '') ||
        (item.name && item.name === wish.name)
      );
      bkmpUseLocalImageIfPersistent(wish, local);
    });
    const localCount = Array.isArray(targetData.wishes) ? targetData.wishes.length : 0;
    if (localCount > 0 && wishes.length === 0) {
      console.warn('Supabase enthaelt keine Kartenideen. Lokale Kartenideen bleiben erhalten.');
      return false;
    }
    targetData.wishes = wishes;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Kartenideen nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

function bkmpMapStreamerFromSupabase(row) {
  return {
    id: row.id,
    name: row.display_name || row.name || '',
    url: row.url || '',
    color: row.color || 'purple',
    countsForAchievement: row.counts_for_achievement !== false,
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapStreamerToSupabase(streamer) {
  return {
    display_name: streamer.name || streamer.display_name || '',
    url: streamer.url || '',
    color: streamer.color || 'purple',
    counts_for_achievement: streamer.countsForAchievement !== false
  };
}

async function loadStreamers() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('streamer_links')
    .select('id, display_name, url, color, counts_for_achievement, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(bkmpMapStreamerFromSupabase);
}

async function saveStreamer(streamer) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapStreamerToSupabase(streamer);
  let query;
  if (streamer.id && !String(streamer.id).startsWith('str-')) {
    query = client
      .from('streamer_links')
      .update(payload)
      .eq('id', streamer.id)
      .select('id, display_name, url, color, counts_for_achievement, created_at')
      .limit(1);
  } else {
    query = client
      .from('streamer_links')
      .insert(payload)
      .select('id, display_name, url, color, counts_for_achievement, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapStreamerFromSupabase(row) : null;
}

async function deleteStreamer(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('streamer_links').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncStreamersFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadStreamers !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const streamers = await loadStreamers();
    if (!streamers) return false;
    const localCount = Array.isArray(targetData.streamers) ? targetData.streamers.length : 0;
    if (localCount > 0 && streamers.length === 0) {
      console.warn('Supabase enthaelt keine Twitch-Accounts. Lokale Twitch-Accounts bleiben erhalten.');
      return false;
    }
    targetData.streamers = streamers;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Twitch-Accounts nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

function bkmpMapAboutBlockFromSupabase(row) {
  return {
    id: row.id,
    type: row.block_type || 'text',
    title: row.title || '',
    content: row.content || '',
    image: row.image_url || '',
    images: Array.isArray(row.image_urls) ? row.image_urls : [],
    sortOrder: Number(row.sort_order || 0),
    width: row.width || 'full',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapAboutBlockToSupabase(block) {
  const images = block.images && block.images.length ? block.images : (block.image ? [block.image] : []);
  return {
    block_type: block.type || 'text',
    title: block.title || '',
    content: block.content || '',
    image_url: images[0] || block.image || '',
    image_urls: images,
    sort_order: Number(block.sortOrder || block.sort_order || 0),
    width: block.width === 'half' ? 'half' : 'full'
  };
}

async function loadAboutBlocks() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('about_blocks')
    .select('id, block_type, title, content, image_url, image_urls, sort_order, width, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(bkmpMapAboutBlockFromSupabase);
}

async function saveAboutBlock(block) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapAboutBlockToSupabase(block);
  payload.image_url = await bkmpStoreImageIfNeeded(payload.image_url, 'about');
  if (Array.isArray(payload.image_urls)) {
    payload.image_urls = (await Promise.all(
      payload.image_urls.map(src => bkmpStoreImageIfNeeded(src, 'about'))
    )).filter(Boolean);
  }
  if (!payload.image_url && payload.image_urls && payload.image_urls.length) {
    payload.image_url = payload.image_urls[0];
  }
  let query;
  if (block.id && !String(block.id).startsWith('about-')) {
    query = client
      .from('about_blocks')
      .update(payload)
      .eq('id', block.id)
      .select('id, block_type, title, content, image_url, image_urls, sort_order, width, created_at')
      .limit(1);
  } else {
    query = client
      .from('about_blocks')
      .insert(payload)
      .select('id, block_type, title, content, image_url, image_urls, sort_order, width, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapAboutBlockFromSupabase(row) : null;
}

async function deleteAboutBlock(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('about_blocks').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncAboutBlocksFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadAboutBlocks !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const blocks = await loadAboutBlocks();
    if (!blocks) return false;
    const localBlocks = Array.isArray(targetData.aboutBlocks) ? targetData.aboutBlocks : [];
    blocks.forEach(block => {
      const local = localBlocks.find(item =>
        String(item.id || '') === String(block.id || '') ||
        (item.title && item.title === block.title && item.content === block.content)
      );
      if (!local) return;
      bkmpUseLocalImageIfPersistent(block, local);
      if ((!Array.isArray(block.images) || block.images.length === 0) && Array.isArray(local.images)) {
        block.images = local.images.filter(bkmpIsPersistentImageUrl);
      }
    });
    const localCount = Array.isArray(targetData.aboutBlocks) ? targetData.aboutBlocks.length : 0;
    if (localCount > 0 && blocks.length === 0) {
      console.warn('Supabase enthaelt keine About-Bloecke. Lokale About-Bloecke bleiben erhalten.');
      return false;
    }
    targetData.aboutBlocks = blocks;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte About-Bloecke nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

function bkmpMapPartnerShopFromSupabase(row) {
  return {
    id: row.id,
    name: row.shop_name || '',
    image: row.image_url || '',
    location: row.location || '',
    category: row.category || '',
    description: row.description || '',
    link: row.link || '',
    contact: row.contact || '',
    status: row.status || 'approved',
    isRead: Boolean(row.is_read),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapPartnerShopToSupabase(shop) {
  const payload = {
    shop_name: shop.name || shop.shop_name || '',
    image_url: shop.image || shop.image_url || '',
    location: shop.location || '',
    category: shop.category || '',
    description: shop.description || '',
    link: shop.link || '',
    contact: shop.contact || ''
  };
  if (shop.status) payload.status = shop.status;
  return payload;
}

async function loadPartnerShops() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('partner_shops')
    .select('id, shop_name, image_url, location, category, description, link, contact, status, is_read, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapPartnerShopFromSupabase);
}

async function savePartnerShop(shop) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapPartnerShopToSupabase(shop);
  payload.image_url = await bkmpStoreImageIfNeeded(payload.image_url, 'partner-shops');
  let query;
  if (shop.id && !String(shop.id).startsWith('shop-')) {
    query = client
      .from('partner_shops')
      .update(payload)
      .eq('id', shop.id)
      .select('id, shop_name, image_url, location, category, description, link, contact, status, created_at')
      .limit(1);
  } else {
    query = client
      .from('partner_shops')
      .insert(payload)
      .select('id, shop_name, image_url, location, category, description, link, contact, status, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapPartnerShopFromSupabase(row) : null;
}

async function updatePartnerShopStatus(id, status) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('partner_shops')
    .update({ status })
    .eq('id', id)
    .select('id, shop_name, image_url, location, category, description, link, contact, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapPartnerShopFromSupabase(row) : null;
}

async function updatePartnerShopRead(id, isRead) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('partner_shops')
    .update({ is_read: isRead })
    .eq('id', id)
    .select('id, shop_name, image_url, location, category, description, link, contact, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapPartnerShopFromSupabase(row) : null;
}

async function deletePartnerShop(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  if (!id || String(id).trim() === '') throw new Error('PartnerShop-ID fehlt. Loeschen wurde abgebrochen.');
  const { error } = await client.from('partner_shops').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncPartnerShopsFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadPartnerShops !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const shops = await loadPartnerShops();
    if (!shops) return false;
    const localShops = Array.isArray(targetData.partnerShops) ? targetData.partnerShops : [];
    shops.forEach(shop => {
      if (shop.image) return;
      const local = localShops.find(item =>
        String(item.id || '') === String(shop.id || '') ||
        (item.name && item.name === shop.name && item.location === shop.location)
      );
      bkmpUseLocalImageIfPersistent(shop, local);
    });
    const localCount = Array.isArray(targetData.partnerShops) ? targetData.partnerShops.length : 0;
    if (localCount > 0 && shops.length === 0) {
      console.warn('Supabase enthaelt keine PartnerShops. Lokale PartnerShops bleiben erhalten.');
      return false;
    }
    targetData.partnerShops = shops;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte PartnerShops nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalExpensesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.expenses) ? localData.expenses : [];
  const remoteItems = await loadExpenses() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.amount, item.date, item.note || ''].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const mapped = { ...item, category: item.category || item.name };
    const sig = [mapped.category || mapped.name, Number(mapped.amount || 0), mapped.date || '', mapped.note || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!mapped.category && !mapped.name) { skipped += 1; return; }
    if (!mapped.date) mapped.date = new Date().toISOString().slice(0, 10);
    existing.add(sig);
    rows.push(bkmpMapExpenseToSupabase(mapped));
  });
  if (rows.length) {
    const { error } = await client.from('expenses').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadExpenses() || [];
  localData.expenses = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalUpdatesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.news) ? localData.news : [];
  const remoteItems = await loadUpdates() || [];
  const existing = new Set(remoteItems.map(item => [item.title, item.text, item.date].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.title, item.text || item.content || '', item.date || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.title || !(item.text || item.content)) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapUpdateToSupabase(item));
  });
  if (rows.length) {
    const { error } = await client.from('updates').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadUpdates() || [];
  localData.news = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalWishesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.wishes) ? localData.wishes : [];
  const remoteItems = await loadWishes() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.image].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name, item.image || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name || !item.image) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapWishToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'wishes');
    }
    const { error } = await client.from('wishes').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadWishes() || [];
  localData.wishes = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalStreamersToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.streamers) ? localData.streamers : [];
  const remoteItems = await loadStreamers() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.url].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name || '', item.url || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name || !item.url) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapStreamerToSupabase(item));
  });
  if (rows.length) {
    const { error } = await client.from('streamer_links').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadStreamers() || [];
  localData.streamers = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalAboutBlocksToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.aboutBlocks) ? localData.aboutBlocks : [];
  const remoteItems = await loadAboutBlocks() || [];
  const existing = new Set(remoteItems.map(item => [item.type, item.title, item.content].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.type || '', item.title || '', item.content || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.title && !item.content && !item.image && !(item.images && item.images.length)) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapAboutBlockToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'about');
      if (Array.isArray(row.image_urls)) {
        row.image_urls = await Promise.all(row.image_urls.map(src => bkmpStoreImageIfNeeded(src, 'about')));
      }
    }
    const { error } = await client.from('about_blocks').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadAboutBlocks() || [];
  localData.aboutBlocks = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalPartnerShopsToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.partnerShops) ? localData.partnerShops : [];
  const remoteItems = await loadPartnerShops() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.location, item.category].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name || '', item.location || '', item.category || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapPartnerShopToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'partner-shops');
    }
    const { error } = await client.from('partner_shops').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadPartnerShops() || [];
  localData.partnerShops = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

function bkmpMapCardSaleFromSupabase(row) {
  return {
    id: row.id,
    playerName: row.player_name || '',
    image: row.image_url || '',
    soldCount: Number(row.sold_count || 0),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapCardSaleToSupabase(item) {
  return {
    player_name: item.playerName || item.player_name || '',
    image_url: item.image || item.image_url || '',
    sold_count: Number(item.soldCount || item.sold_count || 0)
  };
}

async function loadCardSales() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_sales')
    .select('id, player_name, image_url, sold_count, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapCardSaleFromSupabase);
}

async function saveCardSale(item) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapCardSaleToSupabase(item);
  payload.image_url = await bkmpStoreImageIfNeeded(payload.image_url, 'card-sales');
  let query;
  if (item.id && !String(item.id).startsWith('cardsale-')) {
    query = client
      .from('card_sales')
      .update(payload)
      .eq('id', item.id)
      .select('id, player_name, image_url, sold_count, created_at')
      .limit(1);
  } else {
    query = client
      .from('card_sales')
      .insert(payload)
      .select('id, player_name, image_url, sold_count, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapCardSaleFromSupabase(row) : null;
}

async function deleteCardSale(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('card_sales').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncCardSalesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadCardSales !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const items = await loadCardSales();
    if (!items) return false;
    const localCount = Array.isArray(targetData.cardSales) ? targetData.cardSales.length : 0;
    if (localCount > 0 && items.length === 0) {
      console.warn('Supabase enthaelt keine Karten-Verkaeufe. Lokale Daten bleiben erhalten.');
      return false;
    }
    targetData.cardSales = items;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Karten-Verkaeufe nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalCardSalesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.cardSales) ? localData.cardSales : [];
  const remoteItems = await loadCardSales() || [];
  const existing = new Set(remoteItems.map(item => [item.playerName, item.soldCount].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.playerName || '', item.soldCount || 0].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.playerName) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapCardSaleToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'card-sales');
    }
    const { error } = await client.from('card_sales').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadCardSales() || [];
  localData.cardSales = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

function bkmpMapInvestorRequestFromSupabase(row) {
  return {
    id: row.id,
    name: row.name || '',
    minecraftName: row.minecraft_name || '',
    anonymous: Boolean(row.anonymous),
    amount: Number(row.amount || 0),
    sharePercent: Number(row.share_percent || 0),
    periodMonths: Number(row.period_months || 0),
    status: row.status || 'pending',
    isRead: Boolean(row.is_read),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    createdAtIso: row.created_at || '',
    source: 'supabase'
  };
}

function bkmpMapInvestorRequestToSupabase(item) {
  return {
    name: item.name || '',
    minecraft_name: item.minecraftName || '',
    anonymous: Boolean(item.anonymous),
    amount: Number(item.amount || 0),
    share_percent: Number(item.sharePercent || 0),
    period_months: Number(item.periodMonths || 0)
  };
}

async function saveInvestorRequest(item) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const payload = { ...bkmpMapInvestorRequestToSupabase(item), status: 'pending' };
  const { error } = await client.from('investor_requests').insert(payload);
  if (error) throw error;
  return true;
}

async function loadInvestorRequests() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('investor_requests')
    .select('id, name, minecraft_name, anonymous, amount, share_percent, period_months, status, is_read, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapInvestorRequestFromSupabase);
}

async function updateInvestorRequestStatus(id, status) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('investor_requests')
    .update({ status })
    .eq('id', id)
    .select('id, name, minecraft_name, anonymous, amount, share_percent, period_months, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapInvestorRequestFromSupabase(row) : null;
}

async function updateInvestorRequestRead(id, isRead) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('investor_requests')
    .update({ is_read: isRead })
    .eq('id', id)
    .select('id, name, minecraft_name, anonymous, amount, share_percent, period_months, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapInvestorRequestFromSupabase(row) : null;
}

async function deleteInvestorRequest(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('investor_requests').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncInvestorRequestsFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadInvestorRequests !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const items = await loadInvestorRequests();
    if (!items) return false;
    const localCount = Array.isArray(targetData.investorRequests) ? targetData.investorRequests.length : 0;
    if (localCount > 0 && items.length === 0) {
      console.warn('Supabase enthaelt keine Investoren-Anfragen. Lokale Daten bleiben erhalten.');
      return false;
    }
    targetData.investorRequests = items;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Investoren-Anfragen nicht laden.', e);
    return false;
  }
}

/* ---------------- Kartenverkaufs-Anfragen (analog zu Investoren-Anfragen) ---------------- */

function bkmpMapCardSaleRequestFromSupabase(row) {
  return {
    id: row.id,
    minecraftName: row.minecraft_name || '',
    discord: row.discord || '',
    image: row.image_url || '',
    status: row.status || 'pending',
    isRead: Boolean(row.is_read),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

async function loadCardSaleRequests() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_sale_requests')
    .select('id, minecraft_name, discord, image_url, status, is_read, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapCardSaleRequestFromSupabase);
}

async function updateCardSaleRequestStatus(id, status) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_sale_requests')
    .update({ status })
    .eq('id', id)
    .select('id, minecraft_name, discord, image_url, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapCardSaleRequestFromSupabase(row) : null;
}

async function updateCardSaleRequestRead(id, isRead) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_sale_requests')
    .update({ is_read: isRead })
    .eq('id', id)
    .select('id, minecraft_name, discord, image_url, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapCardSaleRequestFromSupabase(row) : null;
}

async function deleteCardSaleRequest(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('card_sale_requests').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/* ---------------- Feedback (Admin-only, siehe supabase-feedback-schema.sql) ---------------- */
function bkmpMapFeedbackFromSupabase(row) {
  return {
    id: row.id,
    name: row.name || '',
    category: row.category || 'sonstiges',
    message: row.message || '',
    image: row.image_url || '',
    isRead: Boolean(row.is_read),
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0
  };
}

async function loadFeedback() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('feedback')
    .select('id, name, category, message, image_url, is_read, is_archived, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapFeedbackFromSupabase);
}

async function updateFeedbackFlags(id, patch) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('feedback')
    .update(patch)
    .eq('id', id)
    .select('id, name, category, message, image_url, is_read, is_archived, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapFeedbackFromSupabase(row) : null;
}

async function deleteFeedback(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('feedback').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/* ---------------- Oeffentliches Feedback-Board (Stufe 3, 21.07.2026) ----
   Zwei GETRENNTE Tabellen von der privaten feedback-Tabelle oben (siehe
   sql/20260721-feedback-public-board.sql fuer die volle Begruendung -
   RLS filtert nur Zeilen, keine Spalten, daher enthaelt feedback_public
   ausschliesslich admin-verfasste, absichtlich oeffentliche Felder).
   Gleicher bkmpGetSupabaseClient()-Ansatz wie ueberall sonst: RLS
   entscheidet selbststaendig, ob der/die Aufrufer:in nur veroeffentlichte
   Zeilen sieht (anonym, normale Website) oder auch Entwuerfe (eingeloggter
   Admin) - kein eigener "public vs. admin"-Codepfad noetig. */
function bkmpMapFeedbackPublicFromSupabase(row) {
  return {
    id: row.id,
    sourceFeedbackId: row.source_feedback_id,
    kind: row.kind || 'bug',
    title: row.title,
    category: row.category,
    status: row.status,
    description: row.description,
    response: row.response,
    authorMode: row.author_mode,
    authorDisplay: row.author_display,
    duplicateOf: row.duplicate_of,
    plannedRelease: row.planned_release,
    isPublished: Boolean(row.is_published),
    publishedAt: row.published_at,
    resolvedAt: row.resolved_at,
    lastPublicUpdate: row.last_public_update,
    affectsCount: Number(row.affects_count || 0),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at
  };
}

async function loadFeedbackPublicList() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('feedback_public')
    .select('id, source_feedback_id, kind, title, category, status, description, response, author_mode, author_display, duplicate_of, planned_release, is_published, published_at, resolved_at, last_public_update, affects_count, sort_order, created_at')
    .order('last_public_update', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapFeedbackPublicFromSupabase);
}

/* entry.id gesetzt = Update, sonst Insert. published_at/resolved_at werden
   nur beim UEBERGANG in den jeweiligen Zustand gesetzt (nicht bei jedem
   Speichern neu), damit das echte erste Veroeffentlichungsdatum erhalten
   bleibt. */
async function upsertFeedbackPublicEntry(entry) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const nowIso = new Date().toISOString();
  const payload = {
    source_feedback_id: entry.sourceFeedbackId || null,
    kind: entry.kind === 'idea' ? 'idea' : 'bug',
    title: entry.title,
    category: entry.category,
    status: entry.status,
    description: entry.description || null,
    response: entry.response || null,
    author_mode: entry.authorMode || 'anonymous',
    author_display: entry.authorMode && entry.authorMode !== 'anonymous' ? (entry.authorDisplay || null) : null,
    duplicate_of: entry.duplicateOf || null,
    planned_release: entry.plannedRelease || null,
    is_published: Boolean(entry.isPublished),
    last_public_update: nowIso
  };
  if (entry.isPublished && !entry.publishedAt) payload.published_at = nowIso;
  if (['behoben', 'veroeffentlicht'].includes(entry.status) && !entry.resolvedAt) payload.resolved_at = nowIso;

  const select = 'id, source_feedback_id, kind, title, category, status, description, response, author_mode, author_display, duplicate_of, planned_release, is_published, published_at, resolved_at, last_public_update, affects_count, sort_order, created_at';
  if (entry.id) {
    const { data, error } = await client.from('feedback_public').update(payload).eq('id', entry.id).select(select).limit(1);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    return row ? bkmpMapFeedbackPublicFromSupabase(row) : null;
  }
  const { data, error } = await client.from('feedback_public').insert(payload).select(select).limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapFeedbackPublicFromSupabase(row) : null;
}

async function deleteFeedbackPublicEntry(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('feedback_public').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function loadFeedbackPublicProgress(feedbackPublicId) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('feedback_public_progress')
    .select('id, feedback_public_id, text, created_at, sort_order')
    .eq('feedback_public_id', feedbackPublicId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function addFeedbackPublicProgress(feedbackPublicId, text, sortOrder) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('feedback_public_progress')
    .insert({ feedback_public_id: feedbackPublicId, text, sort_order: sortOrder || 0 })
    .select('id, feedback_public_id, text, created_at, sort_order')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function deleteFeedbackPublicProgress(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('feedback_public_progress').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncCardSaleRequestsFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadCardSaleRequests !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const items = await loadCardSaleRequests();
    if (!items) return false;
    const localCount = Array.isArray(targetData.cardSaleRequests) ? targetData.cardSaleRequests.length : 0;
    if (localCount > 0 && items.length === 0) {
      console.warn('Supabase enthaelt keine Kartenverkaufs-Anfragen. Lokale Daten bleiben erhalten.');
      return false;
    }
    targetData.cardSaleRequests = items;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Kartenverkaufs-Anfragen nicht laden.', e);
    return false;
  }
}

async function importLocalInvestorRequestsToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.investorRequests) ? localData.investorRequests : [];
  const remoteItems = await loadInvestorRequests() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.amount, item.periodMonths].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name || '', item.amount || 0, item.periodMonths || 0].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name) { skipped += 1; return; }
    existing.add(sig);
    rows.push({ ...bkmpMapInvestorRequestToSupabase(item), status: item.status || 'pending' });
  });
  if (rows.length) {
    const { error } = await client.from('investor_requests').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadInvestorRequests() || [];
  localData.investorRequests = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

function bkmpMapCardCatalogFromSupabase(row) {
  return {
    id: row.id,
    name: row.name || '',
    category: row.category || '',
    shopName: row.shop_name || '',
    cb: row.cb || '',
    size: row.size || '',
    submittedBy: row.submitted_by || '',
    description: row.description || '',
    image: row.image_url || '',
    status: row.status || 'approved',
    isRead: Boolean(row.is_read),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapCardCatalogToSupabase(item) {
  const payload = {
    name: item.name || '',
    category: item.category || '',
    shop_name: item.shopName || '',
    cb: item.cb || '',
    size: item.size || '',
    submitted_by: item.submittedBy || '',
    description: item.description || '',
    image_url: item.image || ''
  };
  if (item.status) payload.status = item.status;
  return payload;
}

async function loadCardCatalog() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_catalog')
    .select('id, name, category, shop_name, cb, size, submitted_by, description, image_url, status, is_read, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapCardCatalogFromSupabase);
}

async function updateCardCatalogStatus(id, status) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_catalog')
    .update({ status })
    .eq('id', id)
    .select('id, name, category, shop_name, cb, size, submitted_by, description, image_url, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapCardCatalogFromSupabase(row) : null;
}

async function updateCardCatalogRead(id, isRead) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_catalog')
    .update({ is_read: isRead })
    .eq('id', id)
    .select('id, name, category, shop_name, cb, size, submitted_by, description, image_url, status, is_read, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapCardCatalogFromSupabase(row) : null;
}

async function saveCardCatalogEntry(item) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const payload = bkmpMapCardCatalogToSupabase(item);
  payload.image_url = await bkmpStoreImageIfNeeded(payload.image_url, 'card-catalog');
  let query;
  if (item.id && !String(item.id).startsWith('cardcat-')) {
    query = client
      .from('card_catalog')
      .update(payload)
      .eq('id', item.id)
      .select('id, name, category, shop_name, cb, size, submitted_by, description, image_url, status, created_at')
      .limit(1);
  } else {
    query = client
      .from('card_catalog')
      .insert(payload)
      .select('id, name, category, shop_name, cb, size, submitted_by, description, image_url, status, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapCardCatalogFromSupabase(row) : null;
}

async function deleteCardCatalogEntry(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('card_catalog').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncCardCatalogFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadCardCatalog !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const items = await loadCardCatalog();
    if (!items) return false;
    const localCount = Array.isArray(targetData.cardCatalog) ? targetData.cardCatalog.length : 0;
    if (localCount > 0 && items.length === 0) {
      console.warn('Supabase enthaelt keine Kartendatenbank-Eintraege. Lokale Daten bleiben erhalten.');
      return false;
    }
    targetData.cardCatalog = items;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Kartendatenbank nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalCardCatalogToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.cardCatalog) ? localData.cardCatalog : [];
  const remoteItems = await loadCardCatalog() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.shopName, item.cb].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name || '', item.shopName || '', item.cb || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapCardCatalogToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'card-catalog');
    }
    const { error } = await client.from('card_catalog').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadCardCatalog() || [];
  localData.cardCatalog = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importAllLocalDataToSupabase() {
  return {
    incomes: await importLocalIncomesToSupabase(),
    expenses: await importLocalExpensesToSupabase(),
    investors: await importLocalInvestorsToSupabase(),
    updates: await importLocalUpdatesToSupabase(),
    wishes: await importLocalWishesToSupabase(),
    streamers: await importLocalStreamersToSupabase(),
    aboutBlocks: await importLocalAboutBlocksToSupabase(),
    partnerShops: await importLocalPartnerShopsToSupabase(),
    cardSales: await importLocalCardSalesToSupabase(),
    investorRequests: await importLocalInvestorRequestsToSupabase(),
    cardCatalog: await importLocalCardCatalogToSupabase()
  };
}

/* Interne Test-Accounts (Entwickler-Wunsch 14.07.: "unsichtbarer Account
   zum Testen, soll aber in keine Ranglisten fliessen") - werden NICHT
   an der Quelle (loadLeaderboardStats/loadIdleLeaderboardStats/
   loadRaidLeaderboard) rausgefiltert, sondern erst an den jeweiligen
   OEFFENTLICHEN Ranglisten-Render-Stellen (index.html/idledorf.js) - im
   Admin-Panel (admin.html, z.B. Besucher-Uebersicht) soll der Account
   weiterhin normal sichtbar/verwaltbar bleiben. */
const BKMP_HIDDEN_TEST_ACCOUNTS = ['test123'];
function bkmpIsHiddenTestAccount(nameOrKey) {
  return BKMP_HIDDEN_TEST_ACCOUNTS.includes(String(nameOrKey || '').trim().toLowerCase());
}

function bkmpMapPlayerStatsFromSupabase(row) {
  return {
    name: row.display_name,
    minutesSpent: Number(row.minutes_spent || 0),
    achievementsUnlocked: Number(row.achievements_unlocked || 0),
    eggsFound: Array.isArray(row.eggs_found) ? row.eggs_found : [],
    daysVisited: Array.isArray(row.days_visited) ? row.days_visited : [],
    flags: row.flags && typeof row.flags === 'object' ? row.flags : {},
    panelOpens: Number(row.panel_opens || 0),
    activeTitle: row.active_title || '',
    activeCosmetic: row.active_cosmetic || '',
    bonkCount: Number(row.bonk_count || 0),
    activePlushie: row.active_plushie || '',
    achievementUnlocks: row.achievement_unlocks && typeof row.achievement_unlocks === 'object' ? row.achievement_unlocks : {},
    lastNameChangeAt: row.last_name_change_at ? Date.parse(row.last_name_change_at) : 0,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : 0
  };
}

const BKMP_PLAYER_STATS_COLUMNS = 'display_name, minutes_spent, achievements_unlocked, eggs_found, days_visited, flags, panel_opens, active_title, active_cosmetic, bonk_count, active_plushie, achievement_unlocks, last_name_change_at, updated_at';

async function loadLeaderboardStats() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('player_stats')
    .select(BKMP_PLAYER_STATS_COLUMNS);
  if (error) throw error;
  return (data || []).map(bkmpMapPlayerStatsFromSupabase);
}

async function loadPlayerStatsByName(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return null;
  const { data, error } = await client
    .from('player_stats')
    .select(BKMP_PLAYER_STATS_COLUMNS)
    .eq('name_key', String(name).trim().toLowerCase())
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapPlayerStatsFromSupabase(row) : null;
}

/* Schlanke Einzelfeld-Abfrage fuer den Erfolge-Zaehler - genutzt von
   bkmpSyncPlayerStats (index.html) als Frisch-Check direkt vor dem
   Hochladen, damit ein Geraet mit noch unvollstaendig geladenem lokalem
   Kontext niemals einen bereits erreichten, hoeheren Server-Stand nach
   unten ueberschreibt. Bewusst eine eigene, schlanke Abfrage statt
   loadPlayerStatsByName (laedt sonst die komplette Zeile fuer ein einzelnes
   Feld). */
async function loadPlayerAchievementsUnlockedByName(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return 0;
  const { data, error } = await client
    .from('player_stats')
    .select('achievements_unlocked')
    .eq('name_key', String(name).trim().toLowerCase())
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? Number(row.achievements_unlocked || 0) : 0;
}

async function upsertPlayerStats(displayName, stats) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !displayName) return false;
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) {
    /* Bisher schlug das hier komplett lautlos fehl (nur "return false") -
       ein Spieler blieb dadurch unbemerkt fuer Tage auf einem veralteten
       Erfolge-/Bonk-Stand haengen, obwohl er sichtbar aktiv eingeloggt war
       (siehe Bug-Report RandomAuto: Badge zeigte live 148/299, DB blieb
       seit Tagen bei 65). Jetzt wenigstens sichtbar im Log, damit sowas
       kuenftig auffaellt statt sich lautlos zu wiederholen. */
    console.warn('Konnte Erfolge/Zeit nicht synchronisieren: keine gueltige Spieler-Session (Login evtl. abgelaufen).', sessionError || '');
    return false;
  }
  const statsPayload = {
    minutes_spent: Math.max(0, Math.round(stats.minutesSpent || 0)),
    achievements_unlocked: Math.max(0, Math.round(stats.achievementsUnlocked || 0)),
    eggs_found: Array.isArray(stats.eggsFound) ? stats.eggsFound : [],
    days_visited: Array.isArray(stats.daysVisited) ? stats.daysVisited : [],
    flags: stats.flags && typeof stats.flags === 'object' ? stats.flags : {},
    panel_opens: Math.max(0, Math.round(stats.panelOpens || 0)),
    active_title: stats.activeTitle || '',
    active_cosmetic: stats.activeCosmetic || '',
    bonk_count: Math.max(0, Math.round(stats.bonkCount || 0)),
    active_plushie: stats.activePlushie || '',
    achievement_unlocks: stats.achievementUnlocks && typeof stats.achievementUnlocks === 'object' ? stats.achievementUnlocks : {},
    updated_at: new Date().toISOString()
  };
  /* WICHTIG: nicht per upsert(onConflict:'name_key') schreiben, UND
     name_key/display_name hier bewusst NICHT mit-updaten. Die eigentliche,
     stabile Identitaet der Zeile ist auth_user_id (eindeutig erzwungen
     ueber player_stats_auth_user_id_idx) - name_key aendert sich nur ueber
     rename_player_account() (eigene RPC), nicht ueber diesen periodischen
     Stats-Sync. Wuerde man hier trotzdem per upsert(onConflict:'name_key')
     schreiben und der lokal zwischengespeicherte Name waere (z. B. kurz
     nach einer Umbenennung auf einem anderen Geraet) veraltet, wuerde
     Postgres faelschlich eine ZWEITE Zeile mit dem GLEICHEN auth_user_id
     einfuegen wollen -> Verstoss gegen den unique index, der komplette
     Schreibzugriff schlug dadurch fehl (nur still im console.warn
     verschluckt) - die Bestenliste blieb dauerhaft auf dem letzten
     erfolgreichen Stand haengen. Stattdessen zuerst per auth_user_id
     updaten (trifft immer die richtige Zeile, unabhaengig vom Namen) und
     nur wenn dabei wirklich noch keine Zeile existierte (brandneues Konto),
     neu einfuegen - dort MUSS name_key/display_name dabei sein. */
  const { data: updated, error: updateError } = await client
    .from('player_stats')
    .update(statsPayload)
    .eq('auth_user_id', userId)
    .select('auth_user_id');
  if (updateError) throw updateError;
  if (!Array.isArray(updated) || updated.length === 0) {
    const { error: insertError } = await client.from('player_stats').insert({
      ...statsPayload,
      name_key: String(displayName).trim().toLowerCase(),
      display_name: displayName,
      auth_user_id: userId
    });
    if (insertError) throw insertError;
  }
  return true;
}

/* ---------------- Ein-Geraet-gleichzeitig (siehe supabase-single-session.sql) ----------------
   claimActiveSession schreibt eine frische, zufaellige Kennung fuer DIESES
   Geraet/diesen Tab; checkActiveSessionToken liest den aktuellen Stand zum
   Vergleich (siehe bkmpClaimAndWatchSession in index.html). "Neuestes
   Login gewinnt": schreibt einfach das juengste beanspruchte Geraet. */
async function claimActiveSession(displayName) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !displayName) return null;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return null;
  const token = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { error } = await client
    .from('player_stats')
    .update({ active_session_token: token, active_session_started_at: new Date().toISOString() })
    .eq('auth_user_id', userId);
  if (error) throw error;
  return token;
}

async function checkActiveSessionToken(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return null;
  const { data, error } = await client
    .from('player_stats')
    .select('active_session_token')
    .eq('name_key', String(name).trim().toLowerCase())
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0].active_session_token : null;
}

/* ---------------- Pluschies ---------------- */
async function loadPlushies() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('plushies')
    .select('id, name, image_url, description, rarity')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => ({ id: row.id, name: row.name, image: row.image_url, desc: row.description || '', rarity: row.rarity || 'Episch' }));
}

async function createPlushies(rows) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client
    .from('plushies')
    .insert(rows)
    .select('id, name, image_url, description, rarity');
  if (error) throw error;
  return data || [];
}

/* ---------------- Daily Code Events (Admin) ---------------- */
async function loadDailyEvents(eventDate) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  let query = client
    .from('daily_code_events')
    .select('id, event_date, scheduled_at, plushie_id, code, is_golden_hour, winner_name_key, winner_display_name, redeemed_at, created_at')
    .order('scheduled_at', { ascending: true });
  if (eventDate) query = query.eq('event_date', eventDate);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function updateDailyEvent(id, patch) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client
    .from('daily_code_events')
    .update(patch)
    .eq('id', id)
    .select('id, scheduled_at, plushie_id, code, is_golden_hour, winner_display_name')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function loadOwnedPlushies(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return [];
  const { data, error } = await client
    .from('user_plushies')
    .select('plushie_id')
    .eq('name_key', String(name).trim().toLowerCase());
  if (error) throw error;
  return (data || []).map(row => row.plushie_id);
}

async function redeemPlushieCode(code, playerName) {
  /* Sicherheits-Nachtrag (Audit 15.07.): api/redeem-plushie-code.js prueft
     den Aufrufer jetzt serverseitig ueber dieses Access-Token (verhindert
     Einloesen unter fremdem Namen) - playerName wird nur noch als Hinweis
     mitgeschickt, massgeblich ist die Session. */
  const session = typeof bkmpGetPlayerSession === 'function' ? await bkmpGetPlayerSession() : null;
  const accessToken = session ? session.access_token : null;
  if (!accessToken) return { ok: false, status: 401, body: { error: 'missing_token' } };
  const response = await fetch('/api/redeem-plushie-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ code, playerName })
  });
  let body = null;
  try { body = await response.json(); } catch (e) {}
  return { ok: response.ok, status: response.status, body: body || {} };
}

/* Admin-only: Codes anlegen/auflisten (RLS erlaubt das nur eingeloggten Admins). */
async function loadPlushieCodes() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('plushie_codes')
    .select('id, code, plushie_id, note, is_redeemed, redeemed_by_display_name, redeemed_at, created_at, created_by_admin')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createPlushieCodes(rows) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client
    .from('plushie_codes')
    .insert(rows)
    .select('id, code, plushie_id, note');
  if (error) throw error;
  return data || [];
}

/* ---------------- Idle Drachen Dorf ---------------- */

/* 2026-07-10: prestige_stage_offset wieder aktiv - supabase-idle-prestige-
   lifetime-stage.sql wurde inzwischen ausgefuehrt und live per REST-Abfrage
   bestaetigt (Spalte existiert und ist ueber mehrere Spielerzeilen lesbar).
   Der Notfall-Strip in upsertIdlePlayerState wurde parallel entfernt. */
const BKMP_IDLE_PLAYER_STATE_COLUMNS = `name_key, display_name, level, xp, gold, wood, stone, crystals, essence,
  total_gold_earned, attack, defense, hp, crit_chance, crit_damage, gold_bonus, xp_bonus, loot_bonus,
  skill_points_available, skill_points_spent, skill_allocations, upgrade_purchases, dragon_kills, boss_kills,
  current_dragon_index, highest_dragon_index, prestige_stage_offset, auto_advance, playtime_seconds, last_seen_at, last_offline_claim, last_skilltree_reset_at, updated_at,
  rune_fuse_successes, rune_fuse_failures, rune_upgrade_successes, rune_upgrade_failures, village_defeats, yaksha_boss_kills, active_village_skin,
  fruit, meat, obstgarten_level, jagdhuette_level, fruit_collected_at, meat_collected_at,
  boost_gold_until, boost_exp_until, mana,
  holzfaeller_level, holzfaeller_collected_at, steinbruch_level, steinbruch_collected_at,
  goldmine_level, goldmine_collected_at, kristallmine_level, kristallmine_collected_at,
  manaquelle_level, manaquelle_collected_at, magierakademie_level, magierakademie_collected_at,
  titles_unlocked_at, cosmetics_unlocked_at, turm_highest_wave, turm_last_attempt_at, dragon_species_discovered_at`;

async function loadIdleDragons() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('idle_dragons')
    .select('*')
    .eq('active', true)
    .order('tier_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadIdleSkillNodes() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('idle_skill_nodes')
    .select('*')
    .eq('active', true)
    .order('branch', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadIdleGameConfig() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.from('idle_game_config').select('key, value');
  if (error) throw error;
  const config = {};
  (data || []).forEach(row => { config[row.key] = row.value; });
  return config;
}

/* Bewusst eine EIGENE Tabelle + eigene Lade-/Speicherfunktion statt Spalten
   auf idle_player_state: eine noch nicht ausgefuehrte Migration kann so
   niemals den normalen Spielstand (Gold/Level/Skills) blockieren, siehe
   Kommentar in supabase-idle-prestige.sql. */
async function loadIdlePrestigeState(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return null;
  const { data, error } = await client
    .from('idle_prestige_state')
    .select('name_key, display_name, prestige_level, prestige_points, prestige_points_spent, prestige_allocations, updated_at')
    .eq('name_key', String(name).trim().toLowerCase())
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function saveIdlePrestigeState(state) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !state || !state.name_key) return false;
  const payload = {
    name_key: state.name_key,
    display_name: state.display_name,
    prestige_level: Math.max(0, Math.round(state.prestige_level || 0)),
    prestige_points: Math.max(0, Math.round(state.prestige_points || 0)),
    prestige_points_spent: Math.max(0, Math.round(state.prestige_points_spent || 0)),
    prestige_allocations: state.prestige_allocations && typeof state.prestige_allocations === 'object' ? state.prestige_allocations : {},
    updated_at: new Date().toISOString()
  };
  const { error } = await client.from('idle_prestige_state').upsert(payload, { onConflict: 'name_key' });
  if (error) throw error;
  return true;
}

/* ---------------- Seltene Event-Drachen (Shenloss / Ganz Liber Drache) ----------------
   Sieg-Status liegt in einer eigenen, fuer anon/authenticated NUR lesbaren
   Tabelle (siehe supabase-idle-event-dragons.sql) - Schreiben geht
   ausschliesslich ueber die SECURITY DEFINER-Funktion
   idle_claim_event_dragon_victory(), damit ein einmaliger Sieg (und der
   daraus folgende Titel) nicht per direktem Table-Update faelschbar ist. */
async function loadIdleEventDragonState(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return null;
  const { data, error } = await client
    .from('idle_event_dragon_state')
    .select('name_key, shenloss_defeated, shenloss_defeated_at, liber_defeated, liber_defeated_at')
    .eq('name_key', String(name).trim().toLowerCase())
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function idleClaimEventDragonVictory(name, dragonKey) {
  const client = bkmpGetPlayerAuthClient() || bkmpGetSupabaseClient();
  if (!client || !name) return null;
  const { data, error } = await client.rpc('idle_claim_event_dragon_victory', {
    p_name_key: String(name).trim().toLowerCase(),
    p_display_name: name,
    p_dragon_key: dragonKey
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || { already_defeated: false, newly_defeated: false };
}

/* Persoenlicher Zerator-Belohnungscode nach einem gewonnenen Raid (siehe
   raid_finish() in supabase-idle-event-dragons.sql) - reine Abfrage, der
   Code wird ausschliesslich serverseitig erzeugt. Gibt null zurueck, wenn
   dieser Spieler bei diesem Raid keinen Code bekommen hat (kein Treffer
   bei der 5%-Chance bzw. Pluschie schon im Besitz). */
async function loadRaidRewardCode(raidId, name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !raidId || !name) return null;
  const { data, error } = await client
    .from('raid_reward_codes')
    .select('code, plushie_id, created_at')
    .eq('raid_id', raidId)
    .eq('name_key', String(name).trim().toLowerCase())
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function loadIdlePlayerState(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return null;
  const { data, error } = await client
    .from('idle_player_state')
    .select(BKMP_IDLE_PLAYER_STATE_COLUMNS)
    .eq('name_key', String(name).trim().toLowerCase())
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

/* Alle integer/bigint-Spalten von idle_player_state (siehe
   supabase-idle-dorf-schema.sql + Folge-Migrationen) - numeric-Spalten wie
   attack/defense/hp/crit_chance/gold_bonus duerfen Nachkommastellen haben
   und stehen bewusst NICHT in dieser Liste. */
const BKMP_IDLE_STATE_INTEGER_COLUMNS = [
  'level', 'xp', 'gold', 'wood', 'stone', 'crystals', 'essence', 'total_gold_earned',
  'skill_points_available', 'skill_points_spent', 'dragon_kills', 'boss_kills',
  'current_dragon_index', 'highest_dragon_index', 'playtime_seconds',
  'rune_fuse_successes', 'rune_fuse_failures', 'rune_upgrade_successes', 'rune_upgrade_failures',
  'village_defeats', 'yaksha_boss_kills', 'prestige_stage_offset',
  'fruit', 'meat', 'obstgarten_level', 'jagdhuette_level',
  'mana', 'holzfaeller_level', 'steinbruch_level', 'goldmine_level',
  'kristallmine_level', 'manaquelle_level', 'magierakademie_level'
];

/* Cache fuer upsertIdlePlayerState (siehe dort) - NICHT global fuer alle
   Schreibfunktionen gedacht, nur fuer diesen einen Hot-Path relevant. */
let bkmpIdlePlayerStateUserIdCache = null;

async function upsertIdlePlayerState(state, _isRetry) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !state || !state.name_key) return false;
  /* Bug-Report 17.07.: "Skillpunkte resetten nach Reload" - trat trotz des
     keepalive-Fixes (siehe bkmpGetPlayerAuthClient) noch auf. Grund: JEDES
     await VOR dem eigentlichen Speicher-fetch() ist ein Zeitfenster, in dem
     der Browser die Seite beim Reload/Schliessen schon abbauen kann, bevor
     der (zwar keepalive-markierte, aber noch gar nicht losgeschickte)
     Request ueberhaupt abgeht - keepalive rettet nur bereits GESENDETE
     Requests, keine, die den Sprung zum fetch() nie geschafft haben.
     client.auth.getSession() war genau so ein Zwischenschritt. Loesung:
     die zuletzt aufgeloeste auth_user_id zwischenspeichern und bei einem
     bereits vorhandenen Cache-Wert SOFORT synchron weiterspeichern (keine
     Wartezeit vor dem fetch), die Session dabei nur im Hintergrund
     auffrischen. Beim allerersten Aufruf einer Sitzung (Cache noch leer)
     bleibt der normale await-Weg bestehen.

     NACHBESSERUNG (Live-DB-Check 17.07. bei ChronoKora: updated_at ueber 1h
     alt trotz aktivem Spielen - Speichern schlug also KOMPLETT fehl, nicht
     nur beim Reload): der reine Cache-Wert kann veralten (Session lief ab/
     wurde woanders invalidiert, Geraetewechsel) und wurde vorher NIE erneut
     geprueft, wenn er einmal gesetzt war - jeder weitere Speicherversuch
     haette dann fuer den Rest der Sitzung stillschweigend mit einer
     veralteten ID gegen die RLS gelaufen (0 betroffene Zeilen -> Insert
     scheitert am UNIQUE-Index auf name_key -> Fehler wird nur console.warn'd).
     Deshalb jetzt selbstheilend: schlaegt ein Versuch MIT Cache-Wert fehl
     (Fehler oder 0 betroffene Zeilen), wird der Cache verworfen und GENAU
     EINMAL mit frisch aufgeloester Session erneut versucht. */
  const usedCache = Boolean(bkmpIdlePlayerStateUserIdCache) && !_isRetry;
  let userId = usedCache ? bkmpIdlePlayerStateUserIdCache : null;
  if (!userId) {
    const { data: sessionData } = await client.auth.getSession();
    userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
    if (userId) bkmpIdlePlayerStateUserIdCache = userId;
  }
  if (!userId) return false;
  /* Gleicher Grund/gleiches Muster wie in upsertPlayerStats: name_key im
     mitgegebenen state-Objekt kann ein Snapshot von VOR einer Umbenennung
     sein (bkmpIdleState wird nicht bei jeder Namensaenderung sofort neu
     geladen) - ein upsert(onConflict:'name_key') damit wuerde bei
     Namensabweichung eine zweite Zeile mit dem gleichen auth_user_id
     einfuegen wollen und am idle_player_state_auth_user_id_idx scheitern.
     Erst per auth_user_id updaten (name_key/display_name bewusst NICHT mit
     im Update-Payload - die aendert nur rename_player_account()), nur bei
     wirklich neuem Konto einfuegen. */
  const { name_key, display_name, ...stateWithoutIdentity } = state;
  const statsPayload = { ...stateWithoutIdentity, updated_at: new Date().toISOString() };
  /* Absicherung gegen die Bug-Klasse von bkmpIdleAccrueBuildingResources
     (siehe idledorf.js, Bug-Report 17.07. bei ChronoKora - fruit/meat waren
     nie gerundet und haben dadurch JEDEN Speicherversuch mit "invalid input
     syntax for type bigint" blockiert): alle bigint-Spalten hier nochmal
     hart runden, direkt vor dem Request, statt darauf zu vertrauen, dass
     jede einzelne Stelle im Client sie schon korrekt gerundet hat - ein
     Kampf-Tick zwischen einer fruehen Rundung (z. B. playtime_seconds in
     bkmpIdleFlushSync) und diesem Punkt reicht sonst schon wieder aus, um
     den Wert erneut krumm zu machen. */
  BKMP_IDLE_STATE_INTEGER_COLUMNS.forEach(col => {
    if (typeof statsPayload[col] === 'number') statsPayload[col] = Math.round(statsPayload[col]);
  });
  const { data: updated, error: updateError } = await client
    .from('idle_player_state')
    .update(statsPayload)
    .eq('auth_user_id', userId)
    .select('auth_user_id');
  if (updateError) {
    if (usedCache) { bkmpIdlePlayerStateUserIdCache = null; return upsertIdlePlayerState(state, true); }
    throw updateError;
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    if (usedCache) { bkmpIdlePlayerStateUserIdCache = null; return upsertIdlePlayerState(state, true); }
    const { error: insertError } = await client.from('idle_player_state').insert({
      ...statsPayload,
      name_key,
      display_name,
      auth_user_id: userId
    });
    if (insertError) throw insertError;
  }
  if (usedCache) {
    client.auth.getSession().then(({ data }) => {
      const freshId = data && data.session && data.session.user ? data.session.user.id : null;
      if (freshId) bkmpIdlePlayerStateUserIdCache = freshId;
    }).catch(() => {});
  }
  return true;
}

/* ---------------- Idle-Dorf: Runen ----------------
   Ownership-Muster identisch zu upsertIdlePlayerState oben (auth_user_id
   aus der aktiven Session, siehe supabase-idle-runes.sql) - jede Rune ist
   eine eigene Zeile statt eines JSON-Blobs, deshalb hier echte
   insert/update/delete-Helfer statt eines einzelnen Upserts. */
async function loadPlayerRunes(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return [];
  const { data, error } = await client
    .from('idle_player_runes')
    .select('id, rune_type, rarity, rolled_value, equipped, upgrade_level, substats, created_at')
    .eq('name_key', String(name).trim().toLowerCase());
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function insertPlayerRunes(nameKey, runes) {
  if (!Array.isArray(runes) || !runes.length) return [];
  const client = bkmpGetPlayerAuthClient();
  if (!client) return [];
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return [];
  const payload = runes.map(r => ({
    name_key: String(nameKey).trim().toLowerCase(),
    auth_user_id: userId,
    rune_type: r.rune_type,
    rarity: r.rarity,
    rolled_value: r.rolled_value,
    equipped: !!r.equipped,
    upgrade_level: r.upgrade_level || 0,
    substats: Array.isArray(r.substats) ? r.substats : []
  }));
  const { data, error } = await client
    .from('idle_player_runes')
    .insert(payload)
    .select('id, rune_type, rarity, rolled_value, equipped, upgrade_level, substats, created_at');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function updatePlayerRuneEquipped(runeId, equipped) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !runeId) return false;
  const { error } = await client.from('idle_player_runes').update({ equipped: !!equipped }).eq('id', runeId);
  if (error) throw error;
  return true;
}

/* Generischer Patch fuer das +0..+15-Aufwertungssystem - schreibt
   upgrade_level und/oder substats in einem Aufruf statt eigener Helfer je
   Feld (identisches Muster zu updatePlayerRuneEquipped oben). */
async function updatePlayerRuneUpgrade(runeId, upgradeLevel, substats) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !runeId) return false;
  const { error } = await client.from('idle_player_runes').update({
    upgrade_level: upgradeLevel,
    substats: Array.isArray(substats) ? substats : []
  }).eq('id', runeId);
  if (error) throw error;
  return true;
}

async function deletePlayerRunes(runeIds) {
  if (!Array.isArray(runeIds) || !runeIds.length) return false;
  const client = bkmpGetPlayerAuthClient();
  if (!client) return false;
  const { error } = await client.from('idle_player_runes').delete().in('id', runeIds);
  if (error) throw error;
  return true;
}

/* ---------------- Idle-Dorf: Dorf-Skins ----------------
   Katalog oeffentlich lesbar (jeder Client kennt alle Skins, auch
   noch nicht besessene, fuer die Auswahl-Vorschau). Besitz-Zeilen laufen
   1:1 wie idle_player_runes - Client fuegt nach lokalem Gold-Abzug selbst
   eine Zeile ein, kein serverseitiger Kauf-RPC (gleicher Vertrauens-
   Rahmen wie der Rest des Idle-Spiels). */
async function loadVillageSkinsCatalog() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('idle_village_skins')
    .select('id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, price_eur_cents, apply_scope, unlock_hint, sort_order, frame_count, frame_aspect_w, frame_aspect_h')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadPlayerVillageSkins(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return [];
  const { data, error } = await client
    .from('idle_player_village_skins')
    .select('skin_id, unlocked_at')
    .eq('name_key', String(name).trim().toLowerCase());
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function unlockPlayerVillageSkin(nameKey, skinId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return null;
  const { data, error } = await client
    .from('idle_player_village_skins')
    .insert({ name_key: String(nameKey).trim().toLowerCase(), auth_user_id: userId, skin_id: skinId })
    .select('skin_id, unlocked_at')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

/* ---------------- Drachenzucht (siehe supabase-dragon-breeding.sql) ----------------
   Gleiches Vertrauensmodell wie Runen: Client rollt Werte/Chancen und
   schreibt sie direkt (RLS erzwingt nur "eigene Zeile"), keine
   serverseitige Anti-Cheat-Pruefung - siehe Datei-Kommentar in der
   SQL-Migration fuer die Begruendung. Nur legendaere Ei-Wuerfe (raid_finish)
   und der Epic-Ei-Meilenstein-Claim laufen serverseitig. */

async function loadDragonSpeciesCatalog() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('dragon_species')
    .select('id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadPlayerDragonEggs(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return [];
  const { data, error } = await client
    .from('player_dragon_eggs')
    .select('id, species_id, created_at')
    .eq('name_key', String(name).trim().toLowerCase());
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function insertPlayerDragonEgg(nameKey, speciesId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return null;
  const { data, error } = await client
    .from('player_dragon_eggs')
    .insert({ name_key: String(nameKey).trim().toLowerCase(), auth_user_id: userId, species_id: speciesId })
    .select('id, species_id, created_at')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function loadPlayerDragonNests(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return [];
  const { data, error } = await client
    .from('player_dragon_nests')
    .select('id, slot_index, egg_id, started_at')
    .eq('name_key', String(name).trim().toLowerCase())
    .order('slot_index', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/* Slot 1 existiert lazy - beim ersten Laden anlegen, falls noch nicht
   vorhanden ("on conflict do nothing", gleiches Prinzip wie
   idle_claim_event_dragon_victory). */
async function ensureFirstDragonNest(nameKey) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return;
  await client
    .from('player_dragon_nests')
    .upsert({ name_key: String(nameKey).trim().toLowerCase(), auth_user_id: userId, slot_index: 1 }, { onConflict: 'auth_user_id,slot_index', ignoreDuplicates: true });
}

async function purchaseDragonNestSlot(nameKey, slotIndex) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return null;
  const { data, error } = await client
    .from('player_dragon_nests')
    .insert({ name_key: String(nameKey).trim().toLowerCase(), auth_user_id: userId, slot_index: slotIndex })
    .select('id, slot_index, egg_id, started_at')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

/* Guard: nur erfolgreich, wenn das Nest zum Zeitpunkt des Aufrufs noch
   wirklich leer war (egg_id is null) - verhindert, dass zwei schnelle
   Klicks dasselbe Nest doppelt belegen. */
async function assignEggToDragonNest(nestId, eggId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return false;
  const { data, error } = await client
    .from('player_dragon_nests')
    .update({ egg_id: eggId, started_at: new Date().toISOString() })
    .eq('id', nestId)
    .is('egg_id', null)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function loadPlayerDragons(name) {
  const client = bkmpGetSupabaseClient();
  if (!client || !name) return [];
  const { data, error } = await client
    .from('player_dragons')
    .select('id, species_id, nickname, stage, food_preference, growth_points, battle_xp, is_companion, is_favorite, main_stat_key, stat_attack, stat_defense, stat_hp, substats, ascension_level, hatched_at, adult_at')
    .eq('name_key', String(name).trim().toLowerCase());
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/* Ei oeffnen: Guard-Update ZUERST (leert das Nest nur, wenn dort noch
   genau dieses Ei liegt) - gewinnt der Aufruf das Rennen, wird danach der
   Baby-Drache angelegt und das Ei-Item geloescht. Verliert er (0 Zeilen
   betroffen, z.B. zweiter Tab war schneller), bricht die Funktion ab, OHNE
   einen zweiten Drachen anzulegen. */
async function hatchDragonEgg(nestId, eggId, nameKey, speciesId, foodPreference) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return null;

  const { data: guardRows, error: guardError } = await client
    .from('player_dragon_nests')
    .update({ egg_id: null, started_at: null })
    .eq('id', nestId)
    .eq('egg_id', eggId)
    .select('id');
  if (guardError) throw guardError;
  if (!Array.isArray(guardRows) || !guardRows.length) return null;

  const { data, error } = await client
    .from('player_dragons')
    .insert({
      name_key: String(nameKey).trim().toLowerCase(),
      auth_user_id: userId,
      species_id: speciesId,
      food_preference: foodPreference,
      stage: 'baby'
    })
    .select('id, species_id, nickname, stage, food_preference, growth_points, battle_xp, is_companion, is_favorite, main_stat_key, stat_attack, stat_defense, stat_hp, substats, ascension_level, hatched_at, adult_at')
    .limit(1);
  if (error) throw error;

  await client.from('player_dragon_eggs').delete().eq('id', eggId);

  return Array.isArray(data) ? data[0] : null;
}

async function updatePlayerDragon(dragonId, patch) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !dragonId || !patch) return false;
  const { error } = await client.from('player_dragons').update(patch).eq('id', dragonId);
  if (error) throw error;
  return true;
}

async function releasePlayerDragon(dragonId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !dragonId) return false;
  const { error } = await client.from('player_dragons').delete().eq('id', dragonId);
  if (error) throw error;
  return true;
}

async function claimEpicDragonEgg(name, milestone, speciesId) {
  const client = bkmpGetPlayerAuthClient() || bkmpGetSupabaseClient();
  if (!client || !name) return null;
  const { data, error } = await client.rpc('claim_epic_dragon_egg', {
    p_name_key: String(name).trim().toLowerCase(),
    p_display_name: name,
    p_milestone: milestone,
    p_species_id: speciesId
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || { already_claimed: false, newly_claimed: false };
}

/* ---------------- Echtgeld-Kaeufe (Stripe, siehe supabase-real-money-
   purchases.sql + api/create-checkout-session.js) ----------------
   Der eigentliche Kauf-Nachweis kommt NIE vom Client - diese Funktion
   startet nur eine Stripe-Checkout-Sitzung und leitet dorthin weiter, die
   Freischaltung passiert serverseitig im Webhook nach echter Zahlung. */
async function bkmpCreateStripeCheckoutSession(nameKey, skinId) {
  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nameKey, skinId })
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { /* keine JSON-Antwort */ }
  if (!res.ok || !payload || !payload.url) {
    const code = payload && payload.error;
    const messages = {
      already_owned: 'Du besitzt diesen Artikel bereits.',
      not_registered: 'Du brauchst einen echten Spieler-Account (registrieren/einloggen), um etwas zu kaufen.',
      unknown_skin: 'Dieser Artikel ist nicht (mehr) kaeuflich.',
      server_not_configured: 'Zahlungen sind aktuell nicht verfuegbar. Bitte spaeter erneut versuchen.'
    };
    throw new Error((code && messages[code]) || 'Kauf konnte nicht gestartet werden. Bitte versuche es erneut.');
  }
  return payload.url;
}

/* ---------------- Idle-Dorf: Twitch-Overlay-Herzschlag ----------------
   Nutzerwunsch (15.07.): die Twitch-Seite (idle-stream.html/idle-stream-
   mini.html) meldet sich hier alle paar Sekunden ("ich bin noch offen"),
   die Hauptseite fragt das ab, um zu erkennen, ob gerade live gespielt
   wird (siehe bkmpIdleStreamStartHeartbeat/-PresencePoll in idledorf.js).
   Bewusst eine eigene, winzige Tabelle statt eines Feldes in
   idle_player_state - reiner Praesenz-Signal, keine Spieldaten. */
async function loadIdleLeaderboardStats() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('idle_player_state')
    .select('name_key, display_name, level, total_gold_earned, dragon_kills, playtime_seconds, highest_dragon_index, prestige_stage_offset, turm_highest_wave');
  if (error) throw error;
  const rows = data || [];
  /* prestige_level lebt in einer eigenen Tabelle (idle_prestige_state) -
     separat laden und per name_key zusammenfuehren, statt einen Join zu
     brauchen (gleiches Muster wie schon an anderen Stellen im Idle-Dorf-
     Code). "Top Insgesamte Stufen" ist kein eigenes DB-Feld, sondern die
     gleiche Summe wie in bkmpIdleLifetimeStageCount() (idledorf.js):
     prestige_stage_offset + highest_dragon_index. */
  let prestigeByName = {};
  try {
    const { data: prestigeRows, error: prestigeError } = await client
      .from('idle_prestige_state')
      .select('name_key, prestige_level');
    if (prestigeError) throw prestigeError;
    (prestigeRows || []).forEach(p => { prestigeByName[p.name_key] = Number(p.prestige_level || 0); });
  } catch (e) { /* Migration evtl. noch nicht ausgefuehrt - Bestenliste bleibt ohne Prestige-Werte nutzbar */ }
  rows.forEach(row => {
    row.prestige_level = prestigeByName[row.name_key] || 0;
    row.lifetime_stages = Number(row.prestige_stage_offset || 0) + Number(row.highest_dragon_index || 0);
  });
  return rows;
}

/* Admin-only: Balance bearbeiten (RLS erlaubt Schreibzugriff nur eingeloggten Admins). */
async function saveIdleDragon(dragon) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.from('idle_dragons').upsert(dragon, { onConflict: 'id' }).select('*');
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function deleteIdleDragon(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.from('idle_dragons').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function loadIdleDragonsAdmin() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.from('idle_dragons').select('*').order('tier_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function saveIdleSkillNode(node) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.from('idle_skill_nodes').upsert(node, { onConflict: 'id' }).select('*');
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function deleteIdleSkillNode(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.from('idle_skill_nodes').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function loadIdleSkillNodesAdmin() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.from('idle_skill_nodes').select('*').order('branch', { ascending: true }).order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function saveIdleGameConfig(key, value) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client
    .from('idle_game_config')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  return true;
}

async function resetIdlePlayerState(nameKey) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.from('idle_player_state').delete().eq('name_key', String(nameKey).trim().toLowerCase());
  if (error) throw error;
  return true;
}

/* ---------------- Kartenfirmen (siehe supabase-mapart-marketplace-schema.sql
   + supabase-company-applications.sql) ----------------
   Reine Firmenpraesentation nach dem PartnerShop-Vorbild: oeffentliche
   Bewerbung -> Admin-Freigabe -> Verzeichnis. Das fruehere Auftrags-/Chat-/
   Kunden-Konto-System ("Kartenauftraege") wurde komplett entfernt (siehe
   supabase-mapart-orders-teardown.sql) - kein separates Kunden-Login mehr
   noetig, deshalb faellt auch bkmpGetCustomerSession() etc. weg. */

async function loadCompanies() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('companies')
    .select('id, name, slug, logo_url, banner_url, description, discord_url, website_url, contact_person, specialties, price_range_min, price_range_max, showcase_image_urls, active, created_at')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadCompaniesAdmin() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('companies')
    .select('id, name, slug, logo_url, banner_url, description, discord_url, website_url, contact_person, specialties, price_range_min, price_range_max, showcase_image_urls, active, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saveCompany(company) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.from('companies').upsert(company, { onConflict: 'id' }).select('*').limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function deleteCompany(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.from('companies').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/* ---------------- Firmenbewerbungen ("Bist du eine Kartenbaufirma?
   Bewirb dich hier") ----------------
   Gleiches Muster wie Investoren-/Kartenverkaufs-Anfragen: oeffentlich
   nur einreichbar (per api/submit-entry.js, umgeht RLS ohnehin per
   Service-Role), nur Admins duerfen die Liste sehen/bestaetigen/ablehnen. */
const BKMP_COMPANY_APPLICATION_COLUMNS = 'id, name, contact_person, discord_url, website_url, description, specialties, price_range_min, price_range_max, logo_url, banner_url, status, created_at';

async function loadCompanyApplications() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('company_applications')
    .select(BKMP_COMPANY_APPLICATION_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function updateCompanyApplicationStatus(id, status) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('company_applications')
    .update({ status })
    .eq('id', id)
    .select(BKMP_COMPANY_APPLICATION_COLUMNS)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function deleteCompanyApplication(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('company_applications').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/* ---------------- Weltboss/Raid-Event (siehe supabase-raid-boss-schema.sql) ----------------
   Alle Schreibzugriffe laufen ausschliesslich ueber die dort definierten
   RPCs (raid_join/raid_deal_damage/raid_boss_attack_tick) - die Tabellen
   selbst sind fuer Clients nur lesbar, das verhindert gefaelschten Schaden
   oder manipulierte Stadt-HP per direktem REST-Call. */

function bkmpRaidCurrentId(date) {
  const d = date || new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
}

async function loadRaidState(raidId) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('raid_instances')
    .select('id, boss_id, boss_max_hp, boss_hp, city_max_hp, city_hp, city_attack, city_defense, status, next_boss_attack_at, fight_starts_at, fight_ends_at, participant_count, total_damage, raid_bosses(name, sprite_key, gold_reward, gem_reward, xp_reward, wood_reward, stone_reward, essence_reward)')
    .eq('id', raidId)
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return {
    id: row.id,
    bossId: row.boss_id,
    bossName: row.raid_bosses ? row.raid_bosses.name : '',
    spriteKey: row.raid_bosses ? row.raid_bosses.sprite_key : '',
    goldReward: Number(row.raid_bosses ? row.raid_bosses.gold_reward : 0) || 0,
    gemReward: Number(row.raid_bosses ? row.raid_bosses.gem_reward : 0) || 0,
    xpReward: Number(row.raid_bosses ? row.raid_bosses.xp_reward : 0) || 0,
    woodReward: Number(row.raid_bosses ? row.raid_bosses.wood_reward : 0) || 0,
    stoneReward: Number(row.raid_bosses ? row.raid_bosses.stone_reward : 0) || 0,
    essenceReward: Number(row.raid_bosses ? row.raid_bosses.essence_reward : 0) || 0,
    bossMaxHp: Number(row.boss_max_hp || 0),
    bossHp: Number(row.boss_hp || 0),
    cityMaxHp: Number(row.city_max_hp || 0),
    cityHp: Number(row.city_hp || 0),
    cityAttack: Number(row.city_attack || 0),
    cityDefense: Number(row.city_defense || 0),
    status: row.status,
    nextBossAttackAt: row.next_boss_attack_at ? Date.parse(row.next_boss_attack_at) : 0,
    fightStartsAt: row.fight_starts_at ? Date.parse(row.fight_starts_at) : 0,
    fightEndsAt: row.fight_ends_at ? Date.parse(row.fight_ends_at) : 0,
    participantCount: Number(row.participant_count || 0),
    totalDamage: Number(row.total_damage || 0)
  };
}

async function loadRaidParticipants(raidId) {
  const client = bkmpGetSupabaseClient();
  if (!client || !raidId) return [];
  const { data, error } = await client
    .from('raid_participants')
    .select('auth_user_id, display_name, damage_dealt, crits_landed, clicks_landed, joined_at')
    .eq('raid_id', raidId)
    .order('damage_dealt', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    damageDealt: Number(row.damage_dealt || 0),
    critsLanded: Number(row.crits_landed || 0),
    clicksLanded: Number(row.clicks_landed || 0),
    joinedAt: row.joined_at ? Date.parse(row.joined_at) : 0
  }));
}

async function joinRaid(raidId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Bitte melde dich an, um am Raid teilzunehmen.');
  const { data, error } = await client.rpc('raid_join', { p_raid_id: raidId });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('not_in_prep_window')) throw new Error('Der Raid hat schon begonnen oder es ist gerade keine Vorbereitungsphase.');
    if (msg.includes('no_idle_state')) throw new Error('Starte zuerst einmal einen normalen Kampf im Idle-Dorf, bevor du an einem Raid teilnimmst.');
    if (msg.includes('not_authenticated')) throw new Error('Bitte melde dich an, um am Raid teilzunehmen.');
    if (msg.includes('raid_paused_guild_boss_hour')) throw new Error('Der Weltboss pausiert diese Stunde - Fokus liegt auf dem Gildenboss um 20 Uhr.');
    if (msg.includes('no_active_boss')) throw new Error('Es ist aktuell kein Weltboss konfiguriert. Bitte melde das im Discord.');
    /* Konsistenz mit bkmpGuildBossJoin() (siehe dort, gleicher Fix 15.07.):
       rohen Server-Fehlertext mit anzeigen statt einer nichtssagenden
       Standardmeldung, damit ein unbekannter Fehlerfall beim naechsten
       Auftreten direkt sichtbar ist statt blind geraten werden zu muessen. */
    throw new Error('Beitritt zum Raid fehlgeschlagen: ' + (msg || 'unbekannter Fehler') + '. Bitte versuche es erneut oder melde das im Discord.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    cityHp: Number(row.city_hp || 0),
    cityMaxHp: Number(row.city_max_hp || 0),
    bossHp: Number(row.boss_hp || 0),
    bossMaxHp: Number(row.boss_max_hp || 0),
    bossName: row.boss_name || '',
    spriteKey: row.sprite_key || ''
  };
}

async function submitRaidDamage(raidId, amount, isCrit, isClick) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data, error } = await client.rpc('raid_deal_damage', {
    p_raid_id: raidId,
    p_amount: Math.round(amount),
    p_is_crit: Boolean(isCrit),
    p_is_click: Boolean(isClick)
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? {
    bossHp: Number(row.boss_hp || 0),
    status: row.status,
    ownDamageDealt: Number(row.own_damage_dealt || 0),
    ownCritsLanded: Number(row.own_crits_landed || 0),
    ownClicksLanded: Number(row.own_clicks_landed || 0)
  } : null;
}

async function tickRaidBossAttack(raidId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data, error } = await client.rpc('raid_boss_attack_tick', { p_raid_id: raidId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { cityHp: Number(row.city_hp || 0), bossHp: Number(row.boss_hp || 0), status: row.status } : null;
}

async function loadRaidLeaderboard() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('raid_player_stats')
    .select('auth_user_id, display_name, total_raids_joined, total_bosses_defeated, total_damage_dealt, total_mvp_count, total_flawless_wins, best_single_raid_damage');
  if (error) throw error;
  return (data || []).map(row => ({
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    totalRaidsJoined: Number(row.total_raids_joined || 0),
    totalBossesDefeated: Number(row.total_bosses_defeated || 0),
    totalDamageDealt: Number(row.total_damage_dealt || 0),
    totalMvpCount: Number(row.total_mvp_count || 0),
    totalFlawlessWins: Number(row.total_flawless_wins || 0),
    bestSingleRaidDamage: Number(row.best_single_raid_damage || 0)
  }));
}

/* Dungeon-Bestenliste (siehe supabase-idle-dungeon-leaderboard.sql,
   erweitert um dungeon_type in supabase-dungeon-system-v2.sql - alte
   Zeilen ohne dungeon_type zaehlen automatisch als 'gold') - ein
   Aufruf pro Spieler+Typ+Schwierigkeit, nur wenn bkmpDungeonFinish()
   (idledorf.js) tatsaechlich einen NEUEN persoenlichen Bestwert erkannt
   hat (kein Aufruf bei jedem Versuch), daher reicht ein simples upsert
   ohne serverseitigen "nur wenn besser"-Check. */
async function submitDungeonResult(nameKey, displayName, dungeonType, difficultyId, wavesCleared, timeMs) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { error } = await client
    .from('idle_dungeon_results')
    .upsert({
      name_key: nameKey,
      display_name: displayName,
      dungeon_type: dungeonType,
      difficulty_id: difficultyId,
      waves_cleared: wavesCleared,
      time_ms: timeMs,
      achieved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'name_key,dungeon_type,difficulty_id' });
  if (error) throw error;
}

async function loadDungeonLeaderboard(dungeonType, difficultyId) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('idle_dungeon_results')
    .select('name_key, display_name, waves_cleared, time_ms, achieved_at')
    .eq('dungeon_type', dungeonType)
    .eq('difficulty_id', difficultyId)
    .order('waves_cleared', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

/* ---------------- Dungeon-System 2.0: Schluessel/Tagesbonus/Fortschritt
   (siehe supabase-dungeon-system-v2.sql) - alle vier RPCs sind security
   definer + now()-basiert, damit Schluessel-Regeneration und Tagesbonus
   nicht per Client-Uhr manipuliert oder per Reload dupliziert werden
   koennen (gleiches Muster wie bkmpArenaAttack). */
async function bkmpDungeonGetAllStatus() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return [];
  const { data, error } = await client.rpc('dungeon_get_all_status');
  if (error) throw error;
  return (data || []).map(row => ({
    dungeonType: row.dungeon_type,
    keys: Number(row.keys || 0),
    secondsToNext: Number(row.seconds_to_next || 0),
    dailyBonusAvailable: !!row.daily_bonus_available,
    highestDifficulty: row.highest_difficulty || 'leicht',
    totalCompletions: Number(row.total_completions || 0),
    totalDefeats: Number(row.total_defeats || 0),
    totalKeysSpent: Number(row.total_keys_spent || 0)
  }));
}

async function bkmpDungeonConsumeKey(dungeonType) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('dungeon_consume_key', { p_dungeon_type: dungeonType });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('no_keys_available')) throw new Error('no_keys_available');
    throw new Error('Der Dungeon konnte nicht gestartet werden. Bitte versuche es erneut.');
  }
  return Number(data || 0);
}

async function bkmpDungeonClaimDailyBonus(dungeonType) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return false;
  const { data, error } = await client.rpc('dungeon_claim_daily_bonus', { p_dungeon_type: dungeonType });
  if (error) throw error;
  return !!data;
}

async function bkmpDungeonMarkProgress(dungeonType, success, difficultyId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data, error } = await client.rpc('dungeon_mark_progress', {
    p_dungeon_type: dungeonType,
    p_success: success,
    p_difficulty_id: difficultyId
  });
  if (error) throw error;
  return data || null;
}

/* ---------------- PvP-Arena (siehe supabase-idle-arena.sql) ----------------
   Asynchroner Kampf gegen die zuletzt synchronisierten Kampfwerte eines
   anderen Spielers - arena_attack() selbst laeuft komplett serverseitig
   (security definer), damit niemand sich per direktem Client-Upsert selbst
   Rating/Gold gutschreiben kann (gleiche Vorsicht wie bei rename_player_account
   - siehe supabase-player-name-blocklist.sql). */
async function bkmpArenaGetMyRating() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return null;
  const { data, error } = await client
    .from('arena_ratings')
    .select('auth_user_id, name_key, display_name, rating, wins, losses')
    .eq('auth_user_id', userId)
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? {
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    rating: Number(row.rating || 1000),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0)
  } : null;
}

/* Gegnerauswahl: alle Ratings ausser dem eigenen laden, clientseitig auf
   eine Zufallsauswahl in Rating-Naehe eingrenzen - bei bisher kleiner
   Spielerzahl reicht das voellig, ohne eine eigene RPC nur fuers Mischen zu
   brauchen.

   BOOTSTRAP-PROBLEM (Spieler-Report 14.07.: "Und wann habe ich Gegner?"):
   arena_ratings bekommt eine Zeile fuer einen Spieler erst, wenn er (als
   Angreifer ODER Verteidiger) am ERSTEN Kampf ueberhaupt beteiligt war
   (siehe arena_attack() - Upsert passiert dort, nicht beim blossen
   Betreten des Tabs). Ganz am Anfang, bevor je jemand gekaempft hat, ist
   die Tabelle also fuer ALLE komplett leer - ohne Ergaenzung koennte
   niemand jemals den allerersten Kampf ueberhaupt starten. Deshalb
   zusaetzlich aus idle_player_state ergaenzen (jeder, der schon mal im
   Kampf-Tab gespielt hat, ist ein gueltiger Gegner) - virtuelles
   Rating 1000/0S/0N, bis die echte Zeile beim ersten Kampf entsteht. */
async function bkmpArenaGetOpponents(myAuthUserId, myRating, limit) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const selfId = myAuthUserId || '00000000-0000-0000-0000-000000000000';
  /* idle_player_state ist die primaere Quelle (liefert auch die aktive
     Dorf-Skin fuer die Kampfanimation, siehe supabase-idle-village-skin-
     sync.sql) - arena_ratings wird nur noch zum ANREICHERN um echtes
     Rating/Sieg-Niederlage-Verhaeltnis danebengelegt, wo schon vorhanden. */
  const { data: stateRows, error: stateError } = await client
    .from('idle_player_state')
    .select('auth_user_id, display_name, active_village_skin')
    .not('auth_user_id', 'is', null)
    .neq('auth_user_id', selfId)
    .limit(200);
  if (stateError) throw stateError;
  const { data: ratingRows, error: ratingError } = await client
    .from('arena_ratings')
    .select('auth_user_id, rating, wins, losses')
    .neq('auth_user_id', selfId)
    .limit(200);
  if (ratingError) throw ratingError;
  const ratingById = new Map((ratingRows || []).map(r => [r.auth_user_id, r]));
  const rows = (stateRows || []).filter(r => r.auth_user_id).map(row => {
    const rating = ratingById.get(row.auth_user_id);
    return {
      authUserId: row.auth_user_id,
      displayName: row.display_name,
      activeVillageSkin: row.active_village_skin || 'standard',
      rating: Number(rating ? rating.rating : 1000),
      wins: Number(rating ? rating.wins : 0),
      losses: Number(rating ? rating.losses : 0)
    };
  });
  const baseline = Number.isFinite(myRating) ? myRating : 1000;
  rows.sort((a, b) => Math.abs(a.rating - baseline) - Math.abs(b.rating - baseline));
  const nearPool = rows.slice(0, Math.max(20, (limit || 8) * 3));
  for (let i = nearPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nearPool[i], nearPool[j]] = [nearPool[j], nearPool[i]];
  }
  return nearPool.slice(0, limit || 8);
}

async function bkmpArenaAttack(targetAuthUserId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('arena_attack', { p_target_auth_user_id: targetAuthUserId });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('cooldown_active')) throw new Error('Du hast dieses Ziel schon vor Kurzem angegriffen. Bitte warte ein paar Minuten.');
    if (msg.includes('daily_limit_reached')) throw new Error('Du hast dein Tageslimit von 10 Arena-Angriffen erreicht. Morgen um 0 Uhr geht es weiter.');
    if (msg.includes('no_attacker_state')) throw new Error('Spiele zuerst im Kampf-Tab, bevor du in die Arena gehst.');
    if (msg.includes('no_defender_state')) throw new Error('Dieser Gegner hat noch keinen Kampf-Fortschritt.');
    if (msg.includes('invalid_target') || msg.includes('not_authenticated')) throw new Error('Angriff nicht möglich.');
    throw new Error('Der Angriff ist fehlgeschlagen. Bitte versuche es erneut.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    won: !!row.attacker_won,
    ratingChange: Number(row.rating_change || 0),
    newRating: Number(row.new_rating || 1000),
    goldReward: Number(row.gold_reward || 0),
    defenderName: row.defender_display_name || ''
  };
}

async function bkmpArenaGetLeaderboard(limit) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('arena_ratings')
    .select('auth_user_id, name_key, display_name, rating, wins, losses')
    .order('rating', { ascending: false })
    .limit(limit || 100);
  if (error) throw error;
  return (data || []).map(row => ({
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    rating: Number(row.rating || 1000),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0)
  }));
}

async function bkmpArenaGetRecentBattles(authUserId, limit) {
  const client = bkmpGetSupabaseClient();
  if (!client || !authUserId) return [];
  const { data, error } = await client
    .from('arena_battle_log')
    .select('attacker_name, defender_name, attacker_won, rating_change, gold_reward, occurred_at, attacker_auth_user_id')
    .or(`attacker_auth_user_id.eq.${authUserId},defender_auth_user_id.eq.${authUserId}`)
    .order('occurred_at', { ascending: false })
    .limit(limit || 20);
  if (error) throw error;
  return (data || []).map(row => ({
    attackerName: row.attacker_name,
    defenderName: row.defender_name,
    attackerWon: !!row.attacker_won,
    ratingChange: Number(row.rating_change || 0),
    goldReward: Number(row.gold_reward || 0),
    occurredAt: row.occurred_at,
    wasAttacker: row.attacker_auth_user_id === authUserId
  }));
}

/* ---------------- Admin: Spieler-Verwaltung (siehe supabase-admin-player-
   management.sql) - direkte Folge des 14.07.-Troll-Vorfalls (Adolf/
   KillTheJews88/Heinrich_H/Sakuyumi), die bisher jedes Mal ein manuell in den
   Chat gepostetes Loesch-Skript brauchten. Beide RPCs sind admin-gated
   (is_active_admin()), laufen also nur mit einer echten Admin-Session
   (bkmpGetSupabaseClient(), gleicher Client wie der Rest von admin.html). */
async function bkmpAdminListRecentPlayers(limit) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.rpc('admin_list_recent_players', { p_limit: limit || 30 });
  if (error) throw error;
  return (data || []).map(row => ({
    authUserId: row.auth_user_id,
    displayName: row.display_name || '',
    nameKey: row.name_key || '',
    createdAt: row.created_at,
    bonkCount: Number(row.bonk_count || 0),
    achievementsUnlocked: Number(row.achievements_unlocked || 0),
    minutesSpent: Number(row.minutes_spent || 0)
  }));
}

async function bkmpAdminDeletePlayerAccount(authUserId) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('admin_delete_player_account', { p_auth_user_id: authUserId });
  if (error) throw error;
  return data || '';
}

/* ---------------- Gilden (siehe supabase-idle-guilds.sql) ----------------
   Alle Schreibzugriffe (Gruenden/Beitreten/Verlassen/Beitragen/Kicken/
   Befoerdern) laufen ausschliesslich ueber die dort definierten
   security-definer-RPCs, gleiche Vorsicht wie beim Weltboss-Raid - die
   Tabellen selbst sind fuer Clients nur lesbar. */
const BKMP_GUILD_COLUMNS = 'id, name, name_key, tag, description, leader_auth_user_id, treasury_gold, member_count, created_at, is_public, guild_xp, current_goal, banner, bosses_defeated, boss_attempts, bonus_member_slots';

/* maxMembers = 20 (fester Basis-Deckel, siehe join_guild() in
   supabase-idle-guilds.sql) + bonusMemberSlots (siehe buy_guild_slot() in
   supabase-guild-extra-slots.sql, Spieler-Wunsch 16.07.: "Funktion fuer
   Gilden mehr Platz dazu zukaufen") - hier einmal zentral berechnet statt
   an jeder Anzeigestelle in idledorf.js erneut. */
function bkmpGuildMapRow(row) {
  return {
    id: row.id,
    name: row.name,
    nameKey: row.name_key,
    tag: row.tag,
    description: row.description || '',
    leaderAuthUserId: row.leader_auth_user_id,
    treasuryGold: Number(row.treasury_gold || 0),
    memberCount: Number(row.member_count || 0),
    createdAt: row.created_at,
    isPublic: row.is_public !== false,
    guildXp: Number(row.guild_xp || 0),
    currentGoal: row.current_goal || '',
    banner: row.banner && typeof row.banner === 'object' ? row.banner : {},
    bossesDefeated: Number(row.bosses_defeated || 0),
    bossAttempts: Number(row.boss_attempts || 0),
    bonusMemberSlots: Number(row.bonus_member_slots || 0),
    maxMembers: 20 + Number(row.bonus_member_slots || 0)
  };
}

/* ---------------- Gilden-Level (siehe guild_level_thresholds in
   supabase-guild-extension-foundation.sql) ----------------
   Die Kurve lebt ausschliesslich in der DB-Tabelle (Spieler-Wunsch:
   "soll spaeter einfach anpassbar sein") - hier nur ein einmaliger,
   gecachter Abruf, damit nicht bei jedem Panel-Render erneut
   nachgefragt werden muss (die Kurve aendert sich praktisch nie
   waehrend einer Sitzung). */
let bkmpGuildLevelThresholdsCache = null;
async function bkmpGuildGetLevelThresholds() {
  if (bkmpGuildLevelThresholdsCache) return bkmpGuildLevelThresholdsCache;
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('guild_level_thresholds')
    .select('level, xp_required')
    .order('level', { ascending: true });
  if (error) return [];
  bkmpGuildLevelThresholdsCache = (data || []).map(r => ({ level: Number(r.level), xpRequired: Number(r.xp_required) }));
  return bkmpGuildLevelThresholdsCache;
}

async function bkmpGuildGetActivityLog(guildId, limit) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !guildId) return [];
  const { data, error } = await client
    .from('guild_activity_log')
    .select('id, kind, actor_name, value, extra, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit || 30);
  if (error) return [];
  return (data || []).map(row => ({
    id: row.id,
    kind: row.kind,
    actorName: row.actor_name,
    value: row.value == null ? null : Number(row.value),
    extra: row.extra,
    createdAt: row.created_at
  }));
}

/* ---------------- Online-Status (siehe player_presence in
   supabase-guild-extension-foundation.sql) ---------------- */
async function bkmpPlayerHeartbeat() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return;
  try { await client.rpc('player_heartbeat'); } catch (e) { /* offline - naechster Versuch beim naechsten Intervall */ }
}

async function bkmpLoadPresence(authUserIds) {
  const client = bkmpGetSupabaseClient();
  if (!client || !Array.isArray(authUserIds) || !authUserIds.length) return {};
  const { data, error } = await client
    .from('player_presence')
    .select('auth_user_id, last_seen_at')
    .in('auth_user_id', authUserIds);
  if (error) return {};
  const map = {};
  (data || []).forEach(row => { map[row.auth_user_id] = row.last_seen_at; });
  return map;
}

async function bkmpGuildGetMine() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return null;
  const { data: memberRows, error: memberError } = await client
    .from('guild_members')
    .select('auth_user_id, guild_id, name_key, display_name, role, contributed_gold, joined_at')
    .eq('auth_user_id', userId)
    .limit(1);
  if (memberError) throw memberError;
  const membership = Array.isArray(memberRows) ? memberRows[0] : null;
  if (!membership) return null;
  const { data: guildRows, error: guildError } = await client
    .from('guilds')
    .select(BKMP_GUILD_COLUMNS)
    .eq('id', membership.guild_id)
    .limit(1);
  if (guildError) throw guildError;
  const guildRow = Array.isArray(guildRows) ? guildRows[0] : null;
  if (!guildRow) return null;
  const { data: memberList, error: listError } = await client
    .from('guild_members')
    .select('auth_user_id, display_name, role, contributed_gold, joined_at')
    .eq('guild_id', membership.guild_id)
    .order('contributed_gold', { ascending: false });
  if (listError) throw listError;
  return {
    guild: bkmpGuildMapRow(guildRow),
    myRole: membership.role,
    myContributedGold: Number(membership.contributed_gold || 0),
    members: (memberList || []).map(m => ({
      authUserId: m.auth_user_id,
      displayName: m.display_name,
      role: m.role,
      contributedGold: Number(m.contributed_gold || 0),
      joinedAt: m.joined_at
    }))
  };
}

/* Spieler-Wunsch (16.07., Feedback-Eintrag: "wäre es Möglich das man
   sieht wer in welcher Gilde drin ist... auch in der Gilden Liste die
   anzeigen die Privat sind"): der is_public-Filter hier war der EINZIGE
   Grund, warum private Gilden in der Uebersicht nie auftauchten - die
   guilds-Tabelle selbst ist serverseitig laengst vollstaendig oeffentlich
   lesbar (RLS "using (true)"), das war also reine Client-Filterung ohne
   echten Datenschutz-Zweck. Jetzt liefert die Uebersicht alle Gilden,
   bkmpIdleRenderGildePanel() in idledorf.js entscheidet anhand isPublic
   nur noch ueber Sofort-Beitritt (oeffentlich) vs. Beitrittsanfrage
   (privat), nicht mehr ueber Sichtbarkeit. */
async function bkmpGuildBrowse(limit) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('guilds')
    .select(BKMP_GUILD_COLUMNS)
    .order('treasury_gold', { ascending: false })
    .limit(limit || 50);
  if (error) throw error;
  return (data || []).map(bkmpGuildMapRow);
}

/* Fuer die aufklappbare Mitgliederliste in der Gilden-Uebersicht - bewusst
   ohne contributed_gold/joined_at (nicht relevant fuer Nicht-Mitglieder,
   guild_members ist zwar ohnehin oeffentlich lesbar, aber weniger
   uebertragene Daten sind trotzdem besser). */
async function bkmpGuildLoadMembersPublic(guildId) {
  const client = bkmpGetSupabaseClient();
  if (!client || !guildId) return [];
  const { data, error } = await client
    .from('guild_members')
    .select('auth_user_id, display_name, role')
    .eq('guild_id', guildId)
    .order('role', { ascending: true });
  if (error) return [];
  return (data || []).map(row => ({ authUserId: row.auth_user_id, displayName: row.display_name, role: row.role }));
}

/* ---------------- Beitrittsanfragen (siehe supabase-guild-join-requests.sql) ----------------
   Alternative zum Sofort-Beitritt/Code - vor allem fuer private Gilden
   gedacht, funktioniert aber fuer beliebige Gilden. */
function bkmpGuildMapJoinRequestRow(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    message: row.message || '',
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedByName: row.decided_by_name
  };
}

async function bkmpGuildRequestJoin(guildId, message) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('request_guild_join', { p_guild_id: guildId, p_message: message || null });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('already_in_guild')) throw new Error('Du bist schon in einer Gilde. Verlasse sie zuerst.');
    if (msg.includes('no_idle_state')) throw new Error('Spiele zuerst im Kampf-Tab, bevor du eine Beitrittsanfrage stellst.');
    if (msg.includes('already_requested')) throw new Error('Du hast bei dieser Gilde bereits eine offene Anfrage.');
    if (msg.includes('guild_not_found')) throw new Error('Diese Gilde gibt es nicht mehr.');
    throw new Error('Anfrage konnte nicht gesendet werden. Bitte versuche es erneut.');
  }
}

async function bkmpGuildCancelJoinRequest(requestId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('cancel_guild_join_request', { p_request_id: requestId });
  if (error) throw new Error('Anfrage konnte nicht zurückgezogen werden.');
}

async function bkmpGuildRespondJoinRequest(requestId, accept) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('respond_guild_join_request', { p_request_id: requestId, p_accept: accept });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('not_authorized')) throw new Error('Dafür brauchst du mindestens die Rolle Veteran.');
    if (msg.includes('guild_full')) throw new Error('Die Gilde ist bereits voll.');
    if (msg.includes('requester_already_in_guild')) throw new Error('Der Spieler ist inzwischen schon in einer anderen Gilde.');
    if (msg.includes('request_already_decided')) throw new Error('Über diese Anfrage wurde schon entschieden.');
    throw new Error('Konnte nicht bearbeitet werden. Bitte versuche es erneut.');
  }
}

/* Eigene offene Anfragen (koennen an mehrere Gilden gleichzeitig laufen) -
   fuer die Browse-Liste, um pro Karte "Anfrage ausstehend" statt des
   Buttons anzuzeigen. */
async function bkmpGuildLoadMyJoinRequests() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return [];
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return [];
  const { data, error } = await client
    .from('guild_join_requests')
    .select('id, guild_id, auth_user_id, display_name, message, status, created_at, decided_at, decided_by_name')
    .eq('auth_user_id', userId)
    .eq('status', 'pending');
  if (error) return [];
  return (data || []).map(bkmpGuildMapJoinRequestRow);
}

/* Offene Anfragen AN die eigene Gilde - fuer den Anfuehrer/Stellvertreter/
   Veteran-Posteingang. */
async function bkmpGuildLoadJoinRequestsForMyGuild(guildId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !guildId) return [];
  const { data, error } = await client
    .from('guild_join_requests')
    .select('id, guild_id, auth_user_id, display_name, message, status, created_at, decided_at, decided_by_name')
    .eq('guild_id', guildId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data || []).map(bkmpGuildMapJoinRequestRow);
}

async function bkmpGuildUpdateSettings(description, isPublic) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('update_guild_settings', { p_description: description, p_is_public: isPublic });
  if (error) throw new Error('Einstellungen konnten nicht gespeichert werden. Nur der Anführer darf das.');
  return data || null;
}

async function bkmpGuildUpdateBanner(banner) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('update_guild_banner', { p_banner: banner });
  if (error) throw new Error('Banner konnte nicht gespeichert werden. Nur der Anführer darf das.');
}

async function bkmpGuildUpdateGoal(goal) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('update_guild_goal', { p_goal: goal });
  if (error) throw new Error('Gildenziel konnte nicht gespeichert werden. Nur der Anführer darf das.');
}

async function bkmpGuildRegenerateInviteCode() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('regenerate_guild_invite_code');
  if (error) throw new Error('Einladungscode konnte nicht erneuert werden. Nur der Anführer darf das.');
  return data || null;
}

async function bkmpGuildGetMyInviteCode() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return null;
  const { data, error } = await client.rpc('get_my_guild_invite_code');
  if (error) return null;
  return data || null;
}

async function bkmpGuildJoinByCode(code) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('join_guild_by_code', { p_code: code });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('invalid_code')) throw new Error('Dieser Einladungscode ist ungültig.');
    if (msg.includes('already_in_guild')) throw new Error('Du bist schon in einer Gilde. Verlasse sie zuerst.');
    if (msg.includes('guild_full')) throw new Error('Diese Gilde ist bereits voll.');
    if (msg.includes('no_idle_state')) throw new Error('Spiele zuerst im Kampf-Tab, bevor du einer Gilde beitrittst.');
    throw new Error('Beitritt fehlgeschlagen. Bitte versuche es erneut.');
  }
}

async function bkmpGuildSendChatMessage(message) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('send_guild_chat_message', { p_message: message });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('invalid_message')) throw new Error('Nachricht ist leer oder zu lang (max. 300 Zeichen).');
    if (msg.includes('not_in_guild')) throw new Error('Du bist in keiner Gilde.');
    throw new Error('Nachricht konnte nicht gesendet werden.');
  }
}

async function bkmpGuildGetChatMessages(guildId, limit) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !guildId) return [];
  const { data, error } = await client
    .from('guild_chat_messages')
    .select('id, auth_user_id, display_name, message, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit || 50);
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    message: row.message,
    createdAt: row.created_at
  })).reverse();
}

async function bkmpGuildCreate(name, tag) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('create_guild', { p_name: name, p_tag: tag });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('name_blocked')) throw new Error('Dieser Gildenname oder Tag ist nicht erlaubt.');
    if (msg.includes('name_taken')) throw new Error('Dieser Gildenname ist bereits vergeben.');
    if (msg.includes('already_in_guild')) throw new Error('Du bist schon in einer Gilde. Verlasse sie zuerst.');
    if (msg.includes('invalid_name')) throw new Error('Bitte einen gültigen Gildennamen eintragen (max. 32 Zeichen).');
    if (msg.includes('invalid_tag')) throw new Error('Bitte ein gültiges Kürzel eintragen (max. 5 Zeichen).');
    if (msg.includes('no_idle_state')) throw new Error('Spiele zuerst im Kampf-Tab, bevor du eine Gilde gründest.');
    if (msg.includes('insufficient_gold')) throw new Error('Eine Gilde zu gründen kostet 500.000 Gold - du hast noch nicht genug.');
    throw new Error('Die Gilde konnte nicht gegründet werden. Bitte versuche es erneut.');
  }
  return data;
}

async function bkmpGuildJoin(guildId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('join_guild', { p_guild_id: guildId });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('already_in_guild')) throw new Error('Du bist schon in einer Gilde. Verlasse sie zuerst.');
    if (msg.includes('guild_full')) throw new Error('Diese Gilde ist bereits voll.');
    if (msg.includes('no_idle_state')) throw new Error('Spiele zuerst im Kampf-Tab, bevor du einer Gilde beitrittst.');
    throw new Error('Beitritt fehlgeschlagen. Bitte versuche es erneut.');
  }
}

async function bkmpGuildLeave() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('leave_guild');
  if (error) throw new Error('Konnte die Gilde nicht verlassen. Bitte versuche es erneut.');
}

async function bkmpGuildContribute(amount) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('contribute_gold', { p_amount: amount });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('insufficient_gold')) throw new Error('Nicht genug Gold.');
    if (msg.includes('not_in_guild')) throw new Error('Du bist in keiner Gilde.');
    throw new Error('Beitrag fehlgeschlagen. Bitte versuche es erneut.');
  }
}

async function bkmpGuildKickMember(targetAuthUserId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('kick_guild_member', { p_target_auth_user_id: targetAuthUserId });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('cannot_kick_leader')) throw new Error('Der Anführer kann nicht entfernt werden.');
    if (msg.includes('not_authorized')) throw new Error('Dafür fehlt dir die Berechtigung.');
    throw new Error('Entfernen fehlgeschlagen. Bitte versuche es erneut.');
  }
}

async function bkmpGuildSetMemberRole(targetAuthUserId, newRole) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('set_guild_member_role', { p_target_auth_user_id: targetAuthUserId, p_new_role: newRole });
  if (error) throw new Error('Rollenänderung fehlgeschlagen. Nur der Anführer darf Rollen vergeben.');
}

async function bkmpGuildDeleteChatMessage(messageId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('delete_guild_chat_message', { p_message_id: messageId });
  if (error) throw new Error('Nachricht konnte nicht gelöscht werden. Dafür fehlt dir die Berechtigung.');
}

/* ---------------- Gildenplätze dazukaufen (siehe buy_guild_slot() in
   supabase-guild-extra-slots.sql - Spieler-Wunsch 16.07.: "Die Gilde ist
   voll wir brauchen mehr Platz... So eine Funktion für Gilden mehr Platz
   dazu zukaufen"). Gleiches Rechte-/Kosten-Prinzip wie guild_tech_upgrade
   unten (nur Anführer/Stellvertreter, kostet die ausgebbare Kasse). */
async function bkmpGuildBuySlot() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('buy_guild_slot');
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('insufficient_treasury')) throw new Error('Nicht genug Gold in der Gildenkasse.');
    if (msg.includes('max_slots')) throw new Error('Diese Gilde hat die maximale Erweiterung bereits erreicht.');
    if (msg.includes('not_authorized')) throw new Error('Nur Anführer oder Stellvertreter dürfen Gildenplätze dazukaufen.');
    if (msg.includes('not_authenticated')) throw new Error('Du bist nicht eingeloggt (Sitzung abgelaufen?). Bitte neu einloggen.');
    throw new Error('Erweiterung fehlgeschlagen: ' + (msg || 'unbekannter Fehler') + '. Bitte versuche es erneut.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { newBonusSlots: Number(row.new_bonus_slots), treasuryGold: Number(row.treasury_gold) } : null;
}

/* ---------------- Gilden-Technologie (siehe guild_tech_levels in
   supabase-guild-tech-tree.sql) ---------------- */
async function bkmpGuildGetTechLevels(guildId) {
  const client = bkmpGetSupabaseClient();
  if (!client || !guildId) return {};
  const { data, error } = await client
    .from('guild_tech_levels')
    .select('tech_id, level')
    .eq('guild_id', guildId);
  if (error) return {};
  const map = {};
  (data || []).forEach(row => { map[row.tech_id] = Number(row.level || 0); });
  return map;
}

async function bkmpGuildTechUpgrade(techId) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('guild_tech_upgrade', { p_tech_id: techId });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('insufficient_treasury')) throw new Error('Nicht genug Gold in der Gildenkasse.');
    if (msg.includes('max_level')) throw new Error('Diese Technologie ist bereits auf Maximalstufe.');
    if (msg.includes('not_authorized')) throw new Error('Nur Anführer oder Stellvertreter dürfen Technologie verbessern.');
    if (msg.includes('not_authenticated')) throw new Error('Du bist nicht eingeloggt (Sitzung abgelaufen?). Bitte neu einloggen.');
    if (msg.includes('invalid_tech')) throw new Error('Unbekannte Technologie-ID.');
    /* Nachbesserung: die generische Meldung ("Verbesserung fehlgeschlagen")
       verschleierte bisher die echte Postgres-Fehlermeldung komplett - jetzt
       wird sie zumindest mit angehaengt, damit ein Spieler-Report wie
       "geht nicht" den tatsaechlichen Fehlercode enthaelt statt nur die
       Wrapper-Nachricht. */
    throw new Error('Verbesserung fehlgeschlagen: ' + (msg || 'unbekannter Fehler') + '. Bitte versuche es erneut.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { newLevel: Number(row.new_level), treasuryGold: Number(row.treasury_gold) } : null;
}

/* ---------------- Gildenquests (siehe supabase-guild-quests.sql) ---------------- */
async function bkmpGuildQuestEnsureToday() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) return [];
  const { data, error } = await client.rpc('guild_quest_ensure_today');
  if (error) { console.warn('guild_quest_ensure_today fehlgeschlagen:', error); return []; }
  return (data || []).map(row => ({
    id: row.id,
    questType: row.quest_type,
    target: Number(row.target),
    progress: Number(row.progress),
    tier: Number(row.tier),
    completed: !!row.completed
  }));
}

async function bkmpGuildQuestContribute(deltas) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !deltas || !Object.keys(deltas).length) return;
  try { await client.rpc('guild_quest_contribute', { p_deltas: deltas }); } catch (e) { /* naechster Autosave versucht es erneut */ }
}

/* ---------------- Gildenboss (siehe supabase-guild-boss.sql) ---------------- */
async function bkmpGuildBossJoin() {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('guild_boss_join');
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('not_in_window')) throw new Error('Der Gildenboss ist gerade nicht aktiv (täglich 20:00-21:00 Uhr, Vorbereitung ab 19:55 Uhr).');
    if (msg.includes('not_in_guild')) throw new Error('Du bist in keiner Gilde.');
    if (msg.includes('no_idle_state')) throw new Error('Spiele zuerst im Kampf-Tab, bevor du am Gildenboss teilnimmst.');
    if (msg.includes('no_boss_configured')) throw new Error('Es ist aktuell kein Gildenboss konfiguriert. Bitte melde das im Discord.');
    /* Fehler-Diagnose (Spieler-Report 15.07.: "Beitritt fehlgeschlagen" ohne
       erkennbaren Grund - keiner der obigen bekannten Faelle passte): statt
       weiterhin einer nichtssagenden Standardmeldung jetzt den rohen
       Server-Fehlertext mit anzeigen, damit der tatsaechliche Grund beim
       naechsten Versuch direkt sichtbar wird, statt blind raten zu muessen. */
    throw new Error('Beitritt zum Gildenboss fehlgeschlagen: ' + (msg || 'unbekannter Fehler') + '. Bitte versuche es erneut oder melde das im Discord.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    instanceId: row.instance_id,
    bossHp: Number(row.boss_hp),
    bossMaxHp: Number(row.boss_max_hp),
    status: row.status,
    bossName: row.boss_name,
    spriteKey: row.sprite_key,
    fightStartsAt: row.fight_starts_at,
    fightEndsAt: row.fight_ends_at
  };
}

/* Fehler-Sichtbarkeit (Spieler-Report 15.07.: "Kein Damage" - Gildenboss-
   HP blieb bei 2M/2M trotz aktivem Kampf, "0 Schaden" fuer alle
   Teilnehmer server-weit): dieser Aufruf feuert alle ~2,5s (Auto-Tick)
   plus bei jedem Klick - ein Fehler wurde bisher komplett stillschweigend
   verschluckt (return null, kein console.warn, kein Toast), der Spieler
   sah also nie einen Hinweis, WARUM nichts passiert. Jetzt: console.warn
   bei JEDEM Fehlschlag (Diagnose), zusaetzlich ein auf 15s gedrosselter
   Toast (kein Spam bei jedem einzelnen Tick, aber der Spieler bekommt
   den tatsaechlichen Grund zu sehen statt nur "es tut sich nichts"). */
let bkmpGuildBossDamageErrorToastAt = 0;
async function bkmpGuildBossDealDamage(instanceId, amount, isCrit, isClick) {
  const client = bkmpGetPlayerAuthClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client.rpc('guild_boss_deal_damage', { p_instance_id: instanceId, p_amount: amount, p_is_crit: !!isCrit, p_is_click: !!isClick });
  if (error) {
    console.warn('Gildenboss: Schaden konnte nicht verbucht werden.', error);
    const msg = String(error.message || '');
    /* Live-Vorfall 15.07. ("das war heute echt eine Pleite, es haben
       soviele es mitbekommen"): "boss_not_active"/"boss_not_found"
       bedeuten, der Kampf ist serverseitig bereits vorbei (jemand anders
       hat den Boss besiegt, oder die Zeit ist abgelaufen) - kein
       voruebergehender Fehler, der beim naechsten Tick einfach nochmal
       klappen koennte. Ohne die Realtime-Publication (siehe
       supabase-realtime-enable.sql) erfuhren andere, noch aktiv
       tickende Mitspieler das bisher NIE automatisch: ihr Auto-Tick
       (alle 2.5s) hämmerte endlos gegen denselben Fehler und zeigte
       alle 15s einen rohen "boss_not_active"-Fehler-Toast, bis die Seite
       manuell neu geladen wurde - vermutlich genau das, was heute beim
       Sieg fuer alle anderen noch kaempfenden Gildenmitglieder sichtbar
       war. isFinal markiert diese Faelle fuer die Aufrufer (siehe
       bkmpGuildBossOwnTick/bkmpGuildBossHandleClick), die den eigenen
       Kampf-Loop dann sofort selbst beenden statt endlos weiterzuticken -
       kein Toast dafuer, das ist kein Fehler des Spielers. */
    const isFinal = msg.includes('boss_not_active') || msg.includes('boss_not_found');
    if (!isFinal) {
      const now = Date.now();
      if (now - bkmpGuildBossDamageErrorToastAt > 15000) {
        bkmpGuildBossDamageErrorToastAt = now;
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Gildenboss-Schaden konnte nicht verbucht werden: ' + (msg || 'unbekannter Fehler'), 4200);
      }
    }
    return isFinal ? { final: true } : null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? {
    bossHp: Number(row.boss_hp),
    status: row.status,
    ownDamageDealt: Number(row.own_damage_dealt || 0),
    ownCritsLanded: Number(row.own_crits_landed || 0),
    ownClicksLanded: Number(row.own_clicks_landed || 0)
  } : null;
}

async function loadGuildBossInstance(instanceId) {
  const client = bkmpGetSupabaseClient();
  if (!client || !instanceId) return null;
  const { data, error } = await client
    .from('guild_boss_instances')
    .select('id, guild_id, boss_id, boss_max_hp, boss_hp, status, fight_starts_at, fight_ends_at, participant_count, total_damage, guild_bosses(name, sprite_key, gold_reward, gem_reward)')
    .eq('id', instanceId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    instanceId: data.id,
    guildId: data.guild_id,
    bossMaxHp: Number(data.boss_max_hp),
    bossHp: Number(data.boss_hp),
    status: data.status,
    fightStartsAt: data.fight_starts_at,
    fightEndsAt: data.fight_ends_at,
    participantCount: Number(data.participant_count || 0),
    totalDamage: Number(data.total_damage || 0),
    bossName: data.guild_bosses ? data.guild_bosses.name : '',
    spriteKey: data.guild_bosses ? data.guild_bosses.sprite_key : '',
    goldReward: Number(data.guild_bosses ? data.guild_bosses.gold_reward : 0) || 0,
    gemReward: Number(data.guild_bosses ? data.guild_bosses.gem_reward : 0) || 0
  };
}

async function loadGuildBossParticipants(instanceId) {
  const client = bkmpGetSupabaseClient();
  if (!client || !instanceId) return [];
  const { data, error } = await client
    .from('guild_boss_participants')
    .select('auth_user_id, display_name, damage_dealt, crits_landed, clicks_landed')
    .eq('instance_id', instanceId)
    .order('damage_dealt', { ascending: false });
  if (error) return [];
  return (data || []).map(row => ({
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    damageDealt: Number(row.damage_dealt || 0),
    critsLanded: Number(row.crits_landed || 0),
    clicksLanded: Number(row.clicks_landed || 0)
  }));
}

async function loadGuildBossLeaderboard() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('guild_boss_player_stats')
    .select('auth_user_id, display_name, total_fights_joined, total_bosses_defeated, total_damage_dealt, best_single_fight_damage')
    .order('total_damage_dealt', { ascending: false })
    .limit(100);
  if (error) return [];
  return (data || []).map(row => ({
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    totalFightsJoined: Number(row.total_fights_joined || 0),
    totalBossesDefeated: Number(row.total_bosses_defeated || 0),
    totalDamageDealt: Number(row.total_damage_dealt || 0),
    bestSingleFightDamage: Number(row.best_single_fight_damage || 0)
  }));
}

let bkmpGuildBossChannel = null;
function bkmpSubscribeToGuildBossInstance(instanceId, onChange) {
  bkmpUnsubscribeFromGuildBossInstance();
  const client = bkmpGetSupabaseClient();
  if (!client || !instanceId) return;
  bkmpGuildBossChannel = client.channel('guildboss-' + instanceId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guild_boss_instances', filter: `id=eq.${instanceId}` }, payload => {
      onChange({ type: 'instance', row: payload.new });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guild_boss_participants', filter: `instance_id=eq.${instanceId}` }, payload => {
      onChange({ type: 'participants', row: payload.new, eventType: payload.eventType });
    })
    .subscribe();
}
function bkmpUnsubscribeFromGuildBossInstance() {
  if (bkmpGuildBossChannel) { bkmpGuildBossChannel.unsubscribe(); bkmpGuildBossChannel = null; }
}

async function loadRaidBossesAdmin() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('raid_bosses')
    .select('id, name, sprite_key, base_hp, base_attack, attack_interval_seconds, gold_reward, gem_reward, xp_reward, wood_reward, stone_reward, essence_reward, active, hp_scale_per_attack')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function updateRaidBoss(id, patch) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client
    .from('raid_bosses')
    .update(patch)
    .eq('id', id)
    .select('id, name, sprite_key, base_hp, base_attack, attack_interval_seconds, gold_reward, gem_reward, xp_reward, wood_reward, stone_reward, essence_reward, active, hp_scale_per_attack')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

/* ---------------- Wartungsmodus (site_flags, Singleton-Zeile) ----------------
   Oeffentlich lesbar (fuer den Polling-Check in idledorf.js auf jeder
   Seite), nur per is_active_admin() beschreibbar (siehe
   supabase-site-maintenance-flag.sql). */
async function loadSiteFlags() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('site_flags')
    .select('idle_maintenance, idle_maintenance_message')
    .eq('id', true)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

/* Bewusst NICHT Teil von loadSiteFlags(): die Wartungsmodus-Pruefung in
   idledorf.js (bkmpIdleRefreshMaintenanceFlag) ist "fail closed" - schlaegt
   die Abfrage fehl, gilt das Idle-Dorf als gesperrt. Wuerde sheep_speech_text
   in derselben select()-Zeile mitlaufen, wuerde ein fehlendes/noch nicht per
   SQL angelegtes Feld das gesamte Idle-Dorf lahmlegen, obwohl nur die
   Schaf-Sprechblase betroffen waere. Eigene, unabhaengige Abfrage haelt
   beide Faelle sauber getrennt. */
async function loadSheepSpeechText() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('site_flags')
    .select('sheep_speech_text')
    .eq('id', true)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0].sheep_speech_text : null;
}

async function setSheepSpeechText(text) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const patch = { sheep_speech_text: (text || '').trim().slice(0, 180), updated_at: new Date().toISOString() };
  const { data, error } = await client
    .from('site_flags')
    .update(patch)
    .eq('id', true)
    .select('sheep_speech_text')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function setIdleMaintenanceFlag(enabled, message) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const patch = { idle_maintenance: !!enabled, updated_at: new Date().toISOString() };
  if (typeof message === 'string' && message.trim()) patch.idle_maintenance_message = message.trim();
  const { data, error } = await client
    .from('site_flags')
    .update(patch)
    .eq('id', true)
    .select('idle_maintenance, idle_maintenance_message')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

let bkmpRaidChannel = null;
function bkmpSubscribeToRaidInstance(raidId, onChange) {
  bkmpUnsubscribeFromRaidInstance();
  const client = bkmpGetSupabaseClient();
  if (!client || !raidId) return;
  bkmpRaidChannel = client.channel('raid-' + raidId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'raid_instances', filter: `id=eq.${raidId}` }, payload => {
      onChange({ type: 'instance', row: payload.new });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'raid_participants', filter: `raid_id=eq.${raidId}` }, payload => {
      /* payload.new (der geaenderte/neue Teilnehmer-Datensatz) direkt
         durchreichen statt nur ein Signal zu senden - der Aufrufer kann
         damit die eigene Teilnehmerliste im Speicher aktualisieren statt
         bei JEDEM Tick JEDES Mitspielers die komplette Liste neu von der
         DB zu laden (bei 7-10 aktiven Spielern, die alle 1.5-2.5s ticken,
         kamen so mehrere volle Refetches pro Sekunde zusammen, die sich
         gegenseitig ueberholen konnten - sichtbare kurze "Ruckler"/
         veraltete Zwischenstaende in der Schaden-Anzeige). */
      onChange({ type: 'participants', row: payload.new, eventType: payload.eventType });
    })
    .subscribe();
}
function bkmpUnsubscribeFromRaidInstance() {
  if (bkmpRaidChannel) { bkmpRaidChannel.unsubscribe(); bkmpRaidChannel = null; }
}

/* ---------------- OBS-Mini-Overlay: reiner Kampf-Zustands-Broadcast
   (Umbau 17.07.: "das Große entfernen, das Kleine soll nur noch visuell
   sein - Klicken/Interagieren nur noch Hauptseite"). Ersetzt das alte
   Herzschlag+Poll+Lock-System (beide Seiten konnten vorher unabhaengig
   voneinander kaempfen) komplett: die Hauptseite ist jetzt die EINZIGE
   Quelle der Wahrheit fuer den laufenden Kampf und sendet ihren aktuellen
   Zustand ueber einen reinen Realtime-BROADCAST-Kanal (kein postgres_changes,
   keine Tabelle noetig - Drachen-HP war noch nie persistiert und muss es
   dafuer auch nicht werden). Das Mini-Overlay abonniert nur und zeichnet
   rein visuell nach, schickt selbst nie etwas. */
/* Bug-Report 15.07. (Supabase-Logs: "UnknownErrorOnWebSocketMessage:
   invalid byte 0xE4..." - viele tausend Fehler/Stunde): der Kanal-Name
   wurde bisher direkt aus dem rohen Anzeigenamen gebaut. Bei Umlauten
   (ä/ö/ü, z.B. Spieler "Bärli") schickt das die Realtime-WebSocket-
   Verbindung als ungueltig kodierte Bytes - der Server lehnt die
   Nachricht ab. encodeURIComponent() macht daraus eine garantiert
   ASCII-sichere, aber weiterhin eindeutige/stabile Kanal-Kennung -
   Sender (hier) und Empfaenger (bkmpSubscribeToCombatState) nutzen
   beide dieselbe Umwandlung, landen also weiterhin im selben Kanal. */
let bkmpCombatSendChannel = null;
let bkmpCombatSendChannelName = null;
function bkmpBroadcastCombatState(nameKey, payload) {
  const client = bkmpGetSupabaseClient();
  if (!client || !nameKey) return;
  if (!bkmpCombatSendChannel || bkmpCombatSendChannelName !== nameKey) {
    if (bkmpCombatSendChannel) bkmpCombatSendChannel.unsubscribe();
    bkmpCombatSendChannelName = nameKey;
    bkmpCombatSendChannel = client.channel('combat-' + encodeURIComponent(nameKey));
    bkmpCombatSendChannel.subscribe();
  }
  bkmpCombatSendChannel.send({ type: 'broadcast', event: 'state', payload }).catch(() => {});
}

let bkmpCombatReceiveChannel = null;
function bkmpSubscribeToCombatState(nameKey, onState) {
  bkmpUnsubscribeFromCombatState();
  const client = bkmpGetSupabaseClient();
  if (!client || !nameKey) return;
  bkmpCombatReceiveChannel = client.channel('combat-' + encodeURIComponent(nameKey))
    .on('broadcast', { event: 'state' }, ({ payload }) => onState(payload))
    .subscribe();
}
function bkmpUnsubscribeFromCombatState() {
  if (bkmpCombatReceiveChannel) { bkmpCombatReceiveChannel.unsubscribe(); bkmpCombatReceiveChannel = null; }
}

/* ---------------- Gildenchat-Realtime (Spieler-Wunsch: "Gildenchat
   verbessern... moderner wirken") - vorher lud der Chat neue Nachrichten
   nur beim Oeffnen/eigenen Senden neu (siehe bkmpGuildGetChatMessages),
   jetzt ein echter Kanal wie beim Raid-HP-Sync, damit Nachrichten anderer
   Mitglieder sofort erscheinen. */
let bkmpGuildChatChannel = null;
function bkmpSubscribeToGuildChat(guildId, onInsert) {
  bkmpUnsubscribeFromGuildChat();
  const client = bkmpGetSupabaseClient();
  if (!client || !guildId) return;
  bkmpGuildChatChannel = client.channel('guildchat-' + guildId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guild_chat_messages', filter: `guild_id=eq.${guildId}` }, payload => {
      onInsert(payload.new);
    })
    .subscribe();
}
function bkmpUnsubscribeFromGuildChat() {
  if (bkmpGuildChatChannel) { bkmpGuildChatChannel.unsubscribe(); bkmpGuildChatChannel = null; }
}

/* ---------------- Gilden-Status-Realtime (Spieler-Wunsch 16.07.: "wenn
   Gold eingezahlt wird das es gleich für alle angezeigt wird, ohne
   reloaden zu müssen") ----------------
   Bisher aktualisierte ein Beitrag/Levelaufstieg/Technologie-Kauf/
   Platzkauf nur die Ansicht des HANDELNDEN Spielers selbst (lokaler
   State-Patch + bkmpGuildLoaded = false), alle anderen Mitglieder mit
   offenem Gilde-Tab sahen den neuen Kassenstand erst nach eigenem
   Neuladen. Gleiches Kanal-Prinzip wie beim Gildenchat/Raid-HP-Sync oben
   (beide Tabellen muessen in supabase-realtime-enable.sql stehen, sonst
   feuert Postgres fuer NIEMANDEN ein Event, siehe Kommentar dort):
   - guilds (id=eq.guildId, Primärschlüssel-Filter): Kasse/XP/Mitglieder-
     zahl/Bonus-Plaetze/Banner/Ziel usw. bei jeder Aenderung komplett neu.
   - guild_members (guild_id=eq.guildId): NUR INSERT/UPDATE (neuer
     Beitritt bzw. veraenderter contributed_gold-/role-Wert) - DELETE
     (Austritt/Kick) wird bewusst NICHT mitgehoert: ohne REPLICA IDENTITY
     FULL auf dieser Tabelle liefert Postgres bei DELETE nur die
     Primärschlüssel-Spalte (auth_user_id) im alten Datensatz, der
     Realtime-Server kann den Spalten-Filter "guild_id=eq...." fuer
     DELETE-Events dann gar nicht auswerten - ein trotzdem registrierter
     Handler wuerde also nie feuern (irrefuehrender toter Code) statt nur
     "nice to have, aber noch nicht live" zu bleiben wie bisher. */
let bkmpGuildStateChannel = null;
function bkmpSubscribeToGuildState(guildId, onGuildRow, onMemberChange) {
  bkmpUnsubscribeFromGuildState();
  const client = bkmpGetSupabaseClient();
  if (!client || !guildId) return;
  bkmpGuildStateChannel = client.channel('guildstate-' + guildId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guilds', filter: `id=eq.${guildId}` }, payload => {
      onGuildRow(payload.new);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guild_members', filter: `guild_id=eq.${guildId}` }, payload => {
      onMemberChange(payload.new);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guild_members', filter: `guild_id=eq.${guildId}` }, payload => {
      onMemberChange(payload.new);
    })
    .subscribe();
}
function bkmpUnsubscribeFromGuildState() {
  if (bkmpGuildStateChannel) { bkmpGuildStateChannel.unsubscribe(); bkmpGuildStateChannel = null; }
}

window.importLocalExpensesToSupabase = importLocalExpensesToSupabase;
window.importLocalUpdatesToSupabase = importLocalUpdatesToSupabase;
window.importLocalWishesToSupabase = importLocalWishesToSupabase;
window.importLocalStreamersToSupabase = importLocalStreamersToSupabase;
window.importLocalAboutBlocksToSupabase = importLocalAboutBlocksToSupabase;
window.importLocalPartnerShopsToSupabase = importLocalPartnerShopsToSupabase;
window.importLocalCardSalesToSupabase = importLocalCardSalesToSupabase;
window.importLocalInvestorRequestsToSupabase = importLocalInvestorRequestsToSupabase;
window.importLocalCardCatalogToSupabase = importLocalCardCatalogToSupabase;
window.importAllLocalDataToSupabase = importAllLocalDataToSupabase;

window.importLocalIncomesToSupabase = importLocalIncomesToSupabase;

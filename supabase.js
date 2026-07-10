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
    /* index.html setzt vor dem Laden dieses Scripts window.BKMP_CLIENT_STORAGE_KEY
       = 'bkmp-customer-auth', damit eine Kunden-Session dort NICHT dieselbe
       localStorage-Session wie ein gleichzeitig in admin.html eingeloggter
       Admin/Firmen-Account teilt (beide Seiten sind dieselbe Origin, teilen sich
       also standardmaessig denselben Supabase-Auth-Storage-Key). admin.html
       setzt die Variable bewusst NICHT, damit bestehende Admin-Sessions durch
       dieses Update nicht ungueltig werden. */
    const options = window.BKMP_CLIENT_STORAGE_KEY
      ? { auth: { storageKey: window.BKMP_CLIENT_STORAGE_KEY } }
      : undefined;
    bkmpSupabaseClient = options
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options)
      : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

/* ---------------- Kunden-Konto fuer den MapArt Marketplace ----------------
   Unsichtbares Supabase-Auth-Konto: der Nutzer sieht nie ein Passwortfeld,
   nur einen einmalig angezeigten Wiederherstellungs-Code (gleiche Optik wie
   die bestehenden Pluschie-Codes). Der Code IST das Passwort - so reicht ein
   einziger Wert zum Wiederherstellen auf einem neuen Geraet, ganz ohne
   E-Mail-Adresse. Siehe supabase-mapart-marketplace-schema.sql fuer die
   zugehoerige customer_profiles-Tabelle/RLS. */
const BKMP_CUSTOMER_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I/L

function bkmpGenerateCustomerCode() {
  const seg = len => {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => BKMP_CUSTOMER_CODE_CHARS[b % BKMP_CUSTOMER_CODE_CHARS.length]).join('');
  };
  return `${seg(4)}-${seg(4)}-${seg(4)}`;
}

function bkmpCustomerEmailFromCode(code) {
  /* Siehe Kommentar in bkmpAdminEmailFromName - ".local" wird von Supabase
     als "invalid email" abgelehnt, ".com" nicht. */
  return String(code || '').trim().toLowerCase() + '@bkmp-customer-accounts.com';
}

async function bkmpCustomerSignUp(displayName, discord) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const code = bkmpGenerateCustomerCode();
  const email = bkmpCustomerEmailFromCode(code);
  const { data, error } = await client.auth.signUp({ email, password: code });
  if (error) throw error;
  const userId = data && data.user ? data.user.id : null;
  if (!userId) throw new Error('Konto konnte nicht erstellt werden.');
  const { error: profileError } = await client
    .from('customer_profiles')
    .insert({ id: userId, display_name: String(displayName || '').trim(), discord: discord ? String(discord).trim() : null });
  if (profileError) throw profileError;
  return { code, userId };
}

async function bkmpCustomerRestoreByCode(code) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const cleanCode = String(code || '').trim();
  const email = bkmpCustomerEmailFromCode(cleanCode);
  const { data, error } = await client.auth.signInWithPassword({ email, password: cleanCode });
  if (error) throw error;
  return data;
}

async function bkmpGetCustomerSession() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data && data.session ? data.session : null;
}

async function bkmpGetCustomerProfile() {
  const client = bkmpGetSupabaseClient();
  const session = await bkmpGetCustomerSession();
  if (!client || !session) return null;
  const { data, error } = await client
    .from('customer_profiles')
    .select('id, display_name, discord')
    .eq('id', session.user.id)
    .limit(1);
  if (error) return null;
  return Array.isArray(data) && data[0] ? data[0] : null;
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
      auth: { storageKey: 'bkmp-player-auth' }
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

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) {
    if (/already registered|already exists|user_already_exists/i.test(error.message || '')) {
      throw new Error('Dieser Ingame-Name ist bereits registriert. Bitte melde dich an.');
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
    .select('id, name, image_url, likes, dislikes, status, created_at')
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
    .select('id, name, image_url, likes, dislikes, status, created_at')
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
    .select('id, shop_name, image_url, location, category, description, link, contact, status, created_at')
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
    .select('id, shop_name, image_url, location, category, description, link, contact, status, created_at')
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
    .select('id, name, minecraft_name, anonymous, amount, share_percent, period_months, status, created_at')
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
    .select('id, name, minecraft_name, anonymous, amount, share_percent, period_months, status, created_at')
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
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

async function loadCardSaleRequests() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_sale_requests')
    .select('id, minecraft_name, discord, image_url, status, created_at')
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
    .select('id, minecraft_name, discord, image_url, status, created_at')
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
    .select('id, name, category, shop_name, cb, size, submitted_by, description, image_url, status, created_at')
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
    .select('id, name, category, shop_name, cb, size, submitted_by, description, image_url, status, created_at')
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

async function upsertPlayerStats(displayName, stats) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !displayName) return false;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  if (!userId) return false;
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
  const response = await fetch('/api/redeem-plushie-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  current_dragon_index, highest_dragon_index, prestige_stage_offset, auto_advance, playtime_seconds, last_seen_at, last_offline_claim, last_skilltree_reset_at, updated_at`;

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

async function upsertIdlePlayerState(state) {
  const client = bkmpGetPlayerAuthClient();
  if (!client || !state || !state.name_key) return false;
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
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
  const { data: updated, error: updateError } = await client
    .from('idle_player_state')
    .update(statsPayload)
    .eq('auth_user_id', userId)
    .select('auth_user_id');
  if (updateError) throw updateError;
  if (!Array.isArray(updated) || updated.length === 0) {
    const { error: insertError } = await client.from('idle_player_state').insert({
      ...statsPayload,
      name_key,
      display_name,
      auth_user_id: userId
    });
    if (insertError) throw insertError;
  }
  return true;
}

async function loadIdleLeaderboardStats() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('idle_player_state')
    .select('display_name, level, total_gold_earned, dragon_kills, playtime_seconds');
  if (error) throw error;
  return data || [];
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

/* ---------------- MapArt Marketplace ---------------- */

const BKMP_MAP_ORDER_COLUMNS = `id, order_number, customer_auth_id, customer_display_name, customer_discord,
  title, description, category, size_known, size_width, size_height, size_parts, size_notes,
  budget_per_part, budget_is_custom, budget_total, desired_completion_date, priority,
  reference_image_urls, additional_notes, status, assigned_company_id, assigned_at, completed_at, created_at`;

async function loadOpenMapOrders() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('map_orders')
    .select(BKMP_MAP_ORDER_COLUMNS)
    .eq('status', 'offen')
    .is('assigned_company_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadMyMapOrders() {
  const client = bkmpGetSupabaseClient();
  const session = await bkmpGetCustomerSession();
  if (!client || !session) return [];
  const { data, error } = await client
    .from('map_orders')
    .select(BKMP_MAP_ORDER_COLUMNS)
    .eq('customer_auth_id', session.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadMapOrderById(orderId) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('map_orders')
    .select(BKMP_MAP_ORDER_COLUMNS)
    .eq('id', orderId)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function createMapOrder(order) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client
    .from('map_orders')
    .insert(order)
    .select(BKMP_MAP_ORDER_COLUMNS)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function updateMapOrderStatus(orderId, status, completedAt) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const patch = { status };
  if (completedAt !== undefined) patch.completed_at = completedAt;
  const { error } = await client.from('map_orders').update(patch).eq('id', orderId);
  if (error) throw error;
  return true;
}

async function withdrawMapOrder(orderId) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client
    .from('map_orders')
    .update({ status: 'abgebrochen' })
    .eq('id', orderId)
    .eq('status', 'offen');
  if (error) throw error;
  return true;
}

async function uploadOrderFile(orderId, file, uploaderType, uploaderDisplayName) {
  const client = bkmpGetSupabaseClient();
  const session = await bkmpGetCustomerSession();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const path = `${orderId}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await client.storage.from('order-files').upload(path, file);
  if (uploadError) throw uploadError;
  const { data, error } = await client
    .from('order_files')
    .insert({
      order_id: orderId,
      uploaded_by_auth_id: session ? session.user.id : null,
      uploaded_by_display_name: uploaderDisplayName || '',
      uploaded_by_type: uploaderType || 'customer',
      file_name: file.name,
      storage_path: path,
      file_type: file.type || '',
      file_size: file.size || 0
    })
    .select('id, order_id, uploaded_by_display_name, uploaded_by_type, file_name, storage_path, file_type, file_size, created_at')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function getOrderFileSignedUrl(storagePath) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.storage.from('order-files').createSignedUrl(storagePath, 3600);
  if (error) return null;
  return data ? data.signedUrl : null;
}

async function loadOrderMessages(orderId) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('order_messages')
    .select('id, order_id, sender_type, sender_auth_id, sender_display_name, body, attachment_file_id, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function sendOrderMessage(message) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { data, error } = await client
    .from('order_messages')
    .insert(message)
    .select('id, order_id, sender_type, sender_auth_id, sender_display_name, body, attachment_file_id, created_at')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function loadOrderFiles(orderId) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('order_files')
    .select('id, order_id, uploaded_by_display_name, uploaded_by_type, file_name, storage_path, file_type, file_size, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadOrderEvents(orderId) {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('order_events')
    .select('id, order_id, event_type, actor_type, actor_display_name, from_status, to_status, detail, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function logOrderEvent(event) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { error } = await client.from('order_events').insert(event);
  if (error) console.warn('Auftrags-Verlauf konnte nicht gespeichert werden.', error);
  return true;
}

async function markOrderRead(orderId) {
  const client = bkmpGetSupabaseClient();
  const session = await bkmpGetCustomerSession();
  if (!client || !session) return false;
  const { error } = await client
    .from('order_read_state')
    .upsert({ order_id: orderId, reader_auth_id: session.user.id, last_read_at: new Date().toISOString() }, { onConflict: 'order_id,reader_auth_id' });
  if (error) console.warn('Lesestatus konnte nicht gespeichert werden.', error);
  return true;
}

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

async function loadCompanyOrders(companyId) {
  const client = bkmpGetSupabaseClient();
  if (!client || !companyId) return [];
  const { data, error } = await client
    .from('map_orders')
    .select(BKMP_MAP_ORDER_COLUMNS)
    .eq('assigned_company_id', companyId)
    .order('assigned_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadAllMapOrdersAdmin() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('map_orders')
    .select(BKMP_MAP_ORDER_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function adminReassignOrder(orderId, companyId) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const { error } = await client.rpc('admin_reassign_order', { p_order_id: orderId, p_company_id: companyId });
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
    .select('id, boss_id, boss_max_hp, boss_hp, city_max_hp, city_hp, city_attack, city_defense, status, next_boss_attack_at, fight_starts_at, fight_ends_at, participant_count, total_damage, raid_bosses(name, sprite_key)')
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
    throw new Error('Beitritt zum Raid fehlgeschlagen. Bitte versuche es erneut.');
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
  return row ? { bossHp: Number(row.boss_hp || 0), status: row.status } : null;
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

async function loadRaidBossesAdmin() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('raid_bosses')
    .select('id, name, sprite_key, base_hp, base_attack, attack_interval_seconds, gold_reward, gem_reward, xp_reward, active, hp_scale_per_attack')
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
    .select('id, name, sprite_key, base_hp, base_attack, attack_interval_seconds, gold_reward, gem_reward, xp_reward, active, hp_scale_per_attack')
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

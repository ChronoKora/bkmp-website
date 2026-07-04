const tokenCache = {
  value: '',
  expiresAt: 0
};

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
  res.end(JSON.stringify(payload));
}

async function getTwitchToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  });

  if (!response.ok) throw new Error('Twitch token request failed');
  const data = await response.json();
  tokenCache.value = data.access_token;
  tokenCache.expiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000;
  return tokenCache.value;
}

module.exports = async function handler(req, res) {
  try {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const users = String(req.query.users || '')
      .split(',')
      .map(user => user.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50);

    if (!users.length) return send(res, 200, { live: {} });

    const token = await getTwitchToken();
    if (!clientId || !token) {
      return send(res, 200, { live: {}, configured: false });
    }

    const params = new URLSearchParams();
    users.forEach(user => params.append('user_login', user));
    const response = await fetch('https://api.twitch.tv/helix/streams?' + params.toString(), {
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Twitch stream request failed');
    const data = await response.json();
    const live = {};
    users.forEach(user => { live[user] = false; });
    (data.data || []).forEach(stream => {
      live[String(stream.user_login || '').toLowerCase()] = true;
    });

    return send(res, 200, { live, configured: true, checkedAt: new Date().toISOString() });
  } catch (error) {
    return send(res, 200, { live: {}, configured: false, error: 'twitch_live_unavailable' });
  }
};

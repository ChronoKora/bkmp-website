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
  if (!clientId || !clientSecret) {
    return { token: null, reason: 'missing_env' };
  }
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) {
    return { token: tokenCache.value, reason: 'cached' };
  }

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error('Twitch token request failed');
    error.reason = 'token_failed';
    error.detail = detail.slice(0, 180);
    throw error;
  }
  const data = await response.json();
  tokenCache.value = data.access_token;
  tokenCache.expiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000;
  return { token: tokenCache.value, reason: 'ok' };
}

module.exports = async function handler(req, res) {
  try {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    const env = {
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret)
    };
    const users = String(req.query.users || '')
      .split(',')
      .map(user => user.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50);

    if (!users.length) return send(res, 200, { live: {}, configured: env.hasClientId && env.hasClientSecret, env });

    const tokenResult = await getTwitchToken();
    if (!clientId || !tokenResult.token) {
      return send(res, 200, { live: {}, configured: false, reason: tokenResult.reason, env });
    }

    const params = new URLSearchParams();
    users.forEach(user => params.append('user_login', user));
    const response = await fetch('https://api.twitch.tv/helix/streams?' + params.toString(), {
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${tokenResult.token}`
      }
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return send(res, 200, { live: {}, configured: false, reason: 'stream_failed', status: response.status, detail: detail.slice(0, 180), env });
    }
    const data = await response.json();
    const live = {};
    users.forEach(user => { live[user] = false; });
    (data.data || []).forEach(stream => {
      live[String(stream.user_login || '').toLowerCase()] = true;
    });

    return send(res, 200, { live, configured: true, env, checkedAt: new Date().toISOString() });
  } catch (error) {
    return send(res, 200, {
      live: {},
      configured: false,
      error: 'twitch_live_unavailable',
      reason: error.reason || 'unknown',
      detail: error.detail || ''
    });
  }
};

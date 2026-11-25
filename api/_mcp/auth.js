/* =====================================================================
   Sky Team Ife MCP - sign-in (OAuth 2.1 with PKCE), with no database.

   Claude (web and phone) connects to a remote MCP server by sending the
   owner through an OAuth sign-in. Here that sign-in is one password,
   MCP_OWNER_PASSWORD, which only the owner knows. Everything Claude is
   given afterwards (client id, authorisation code, access token, refresh
   token) is a small signed blob, so nothing has to be stored:
       base64url(json) + "." + HMAC-SHA256(json, MCP_SIGNING_SECRET)

   To lock everything out at once, change MCP_SIGNING_SECRET in Vercel:
   every token ever issued stops verifying.
   ===================================================================== */
const crypto = require('crypto');

const ACCESS_TTL = 8 * 3600;           // seconds; Claude refreshes on its own
const REFRESH_TTL = 60 * 86400;
const CODE_TTL = 300;

const b64u = (x) => Buffer.from(x).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

function sign(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + mac;
}

/* Returns the payload if the signature is good, the kind matches and it has
   not expired; otherwise null. */
function verify(token, secret, kind) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i), mac = token.slice(i + 1);
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p || p.k !== kind) return null;
  if (p.exp && p.exp < now()) return null;
  return p;
}

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Only https (or http on this machine) redirect targets are accepted. */
function okRedirect(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1');
  } catch (e) { return false; }
}

function configProblem(env) {
  if (!env.MCP_SIGNING_SECRET || env.MCP_SIGNING_SECRET.length < 32) return 'MCP_SIGNING_SECRET is missing or shorter than 32 characters.';
  if (!env.MCP_OWNER_PASSWORD || env.MCP_OWNER_PASSWORD.length < 12) return 'MCP_OWNER_PASSWORD is missing or shorter than 12 characters.';
  return '';
}

/* ---------------------------------------------------------- metadata */
const protectedResource = (base) => ({
  resource: base + '/mcp',
  authorization_servers: [base],
  bearer_methods_supported: ['header'],
  scopes_supported: ['mcp']
});

const authorizationServer = (base) => ({
  issuer: base,
  authorization_endpoint: base + '/authorize',
  token_endpoint: base + '/token',
  registration_endpoint: base + '/register',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['mcp']
});

/* ------------------------------------------------ dynamic registration */
function register(body, env) {
  const uris = Array.isArray(body && body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) {
    return { status: 400, json: { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https URLs.' } };
  }
  const name = String((body && body.client_name) || 'MCP client').slice(0, 80);
  const client_id = sign({ k: 'client', ru: uris, name }, env.MCP_SIGNING_SECRET);
  return {
    status: 201,
    json: {
      client_id, client_name: name, redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  };
}

/* -------------------------------------------------------- authorise */
function authorizePage(p, error) {
  const hidden = ['client_id', 'redirect_uri', 'code_challenge', 'state', 'scope']
    .map((k) => '<input type="hidden" name="' + k + '" value="' + esc(p[k] || '') + '">').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Sign in</title><style>'
    + 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;color:#e8eaf0;font:16px/1.5 system-ui,sans-serif}'
    + 'main{width:min(92vw,380px);background:#171a23;border:1px solid #2a2f3d;border-radius:16px;padding:28px}'
    + 'h1{font-size:20px;margin:0 0 6px}p{margin:0 0 18px;color:#9aa3b5;font-size:14px}'
    + 'input[type=password]{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a2f3d;background:#0f1117;color:#fff;font-size:16px}'
    + 'button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:10px;background:#4f83ff;color:#fff;font-size:16px;font-weight:600}'
    + '.e{background:#3a1d22;color:#ffb4bd;border-radius:8px;padding:8px 10px;margin-bottom:12px;font-size:14px}'
    + '</style></head><body><main><h1>Sky Team Ife</h1>'
    + '<p>Claude is asking to edit this app: its code and its database. Only the owner should say yes.</p>'
    + (error ? '<div class="e">' + esc(error) + '</div>' : '')
    + '<form method="post" action="/authorize">' + hidden
    + '<input type="password" name="password" placeholder="Owner password" autocomplete="current-password" autofocus required>'
    + '<button type="submit">Allow</button></form></main></body></html>';
}

/* Checks the request is one we issued a client for. Returns an error string or ''. */
function checkAuthorizeParams(p, env) {
  if (p.response_type && p.response_type !== 'code') return 'Unsupported response type.';
  const client = verify(p.client_id, env.MCP_SIGNING_SECRET, 'client');
  if (!client) return 'Unknown client. Remove the connector in Claude and add it again.';
  if (!p.redirect_uri || client.ru.indexOf(p.redirect_uri) < 0) return 'That redirect address was not registered.';
  if (!p.code_challenge || (p.code_challenge_method && p.code_challenge_method !== 'S256')) return 'PKCE (S256) is required.';
  return '';
}

async function authorizePost(p, env, wait) {
  const bad = checkAuthorizeParams(p, env);
  if (bad) return { status: 400, html: authorizePage(p, bad) };
  if (!sameSecret(p.password || '', env.MCP_OWNER_PASSWORD)) {
    await wait(1200);                                   // slows down guessing
    return { status: 401, html: authorizePage(p, 'That password is not right.') };
  }
  const code = sign({ k: 'code', cid: p.client_id, ru: p.redirect_uri, cc: p.code_challenge, exp: now() + CODE_TTL }, env.MCP_SIGNING_SECRET);
  const u = new URL(p.redirect_uri);
  u.searchParams.set('code', code);
  if (p.state) u.searchParams.set('state', p.state);
  return { status: 302, location: u.toString() };
}

/* ------------------------------------------------------------ token */
function issue(cid, env) {
  const access = sign({ k: 'access', exp: now() + ACCESS_TTL }, env.MCP_SIGNING_SECRET);
  const refresh = sign({ k: 'refresh', cid, exp: now() + REFRESH_TTL }, env.MCP_SIGNING_SECRET);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: 'mcp' };
}

function token(p, env) {
  const err = (error, d) => ({ status: 400, json: { error, error_description: d || '' } });
  if (p.grant_type === 'authorization_code') {
    const c = verify(p.code, env.MCP_SIGNING_SECRET, 'code');
    if (!c) return err('invalid_grant', 'The code is not valid or has expired.');
    if (p.client_id && p.client_id !== c.cid) return err('invalid_grant', 'Wrong client.');
    if (p.redirect_uri && p.redirect_uri !== c.ru) return err('invalid_grant', 'Wrong redirect address.');
    const want = crypto.createHash('sha256').update(String(p.code_verifier || '')).digest('base64url');
    if (!p.code_verifier || want !== c.cc) return err('invalid_grant', 'PKCE check failed.');
    return { status: 200, json: issue(c.cid, env) };
  }
  if (p.grant_type === 'refresh_token') {
    const r = verify(p.refresh_token, env.MCP_SIGNING_SECRET, 'refresh');
    if (!r) return err('invalid_grant', 'The refresh token is not valid or has expired.');
    return { status: 200, json: issue(r.cid, env) };
  }
  return err('unsupported_grant_type');
}

/* Is this request signed in? */
function bearerOk(header, env) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  return !!(m && verify(m[1].trim(), env.MCP_SIGNING_SECRET, 'access'));
}

module.exports = {
  sign, verify, protectedResource, authorizationServer, register, authorizePage,
  checkAuthorizeParams, authorizePost, token, bearerOk, configProblem, okRedirect, ACCESS_TTL
};

/* =====================================================================
   Sky Team Ife - an MCP server, so Claude (web or phone) can work on
   this app: read and change the code, look at and change the database,
   and check the deploy. See MCP-SETUP.md.

   One Vercel function; vercel.json rewrites these addresses to it:
     /mcp                                       the MCP endpoint (JSON-RPC over HTTPS)
     /.well-known/oauth-protected-resource      sign-in discovery
     /.well-known/oauth-authorization-server    sign-in discovery
     /register  /authorize  /token              the sign-in itself (OAuth 2.1 + PKCE)

   Settings (Vercel -> Settings -> Environment Variables):
     MCP_OWNER_PASSWORD      the password you type once when connecting (12+ characters)
     MCP_SIGNING_SECRET      long random text (32+ characters); change it to lock everyone out
     GITHUB_TOKEN            fine-grained token: this repo, Contents read and write
     SUPABASE_ACCESS_TOKEN   personal access token from the Supabase dashboard
     MCP_COMMIT_NAME, MCP_COMMIT_EMAIL   who the commits are by (optional)
     CRON_SECRET             already set; db_run_file fills it into SQL files
   ===================================================================== */
const auth = require('./_mcp/auth');
const githubMod = require('./_mcp/github');
const supabaseMod = require('./_mcp/supabase');
const toolsMod = require('./_mcp/tools');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function createHandler(deps) {
  deps = deps || {};
  const getEnv = () => deps.env || process.env;
  const fetchFn = deps.fetch || ((...a) => fetch(...a));
  const sleep = deps.wait || wait;

  const baseUrl = (req, env) => {
    if (env.MCP_PUBLIC_URL) return env.MCP_PUBLIC_URL.replace(/\/+$/, '');
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'sky-team-ife.vercel.app';
    const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
    return proto + '://' + host;
  };

  async function readBody(req) {
    if (req.body !== undefined && req.body !== null && req.body !== '') {
      if (typeof req.body === 'string') return parseBody(req.body, req.headers['content-type']);
      if (Buffer.isBuffer(req.body)) return parseBody(req.body.toString('utf8'), req.headers['content-type']);
      return req.body;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return parseBody(Buffer.concat(chunks).toString('utf8'), req.headers['content-type']);
  }
  function parseBody(text, type) {
    if (!text) return {};
    if (/json/i.test(type || '') || /^\s*[{[]/.test(text)) { try { return JSON.parse(text); } catch (e) { return {}; } }
    return Object.fromEntries(new URLSearchParams(text));
  }

  const json = (res, status, obj, extra) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    Object.keys(extra || {}).forEach((k) => res.setHeader(k, extra[k]));
    res.end(JSON.stringify(obj));
  };
  const html = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.end(body);
  };

  function routeOf(req) {
    const u = new URL(req.url, 'http://x');
    const q = u.searchParams.get('route');
    if (q) return { route: q, query: Object.fromEntries(u.searchParams) };
    const p = u.pathname.replace(/\/+$/, '');
    const r = /oauth-protected-resource/.test(p) ? 'prm' : /oauth-authorization-server/.test(p) ? 'asm'
      : p.endsWith('/register') ? 'register' : p.endsWith('/authorize') ? 'authorize' : p.endsWith('/token') ? 'token' : 'mcp';
    return { route: r, query: Object.fromEntries(u.searchParams) };
  }

  /* ----------------------------------------------------- JSON-RPC (MCP) */
  async function rpc(msg, env) {
    const id = msg.id;
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (id === undefined) return null;                                   // a notification: no answer
    switch (msg.method) {
      case 'initialize': {
        const want = msg.params && msg.params.protocolVersion;
        return reply({
          protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'sky-team-ife', version: '1.0.0' },
          instructions: toolsMod.INSTRUCTIONS
        });
      }
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: toolsMod.DEFS });
      case 'tools/call': {
        const github = githubMod.make(env, fetchFn);
        const supabase = supabaseMod.make(env, fetchFn);
        const t = toolsMod.build(env, github, supabase, fetchFn);
        return reply(await t.call(msg.params && msg.params.name, msg.params && msg.params.arguments));
      }
      case 'resources/list': return reply({ resources: [] });
      case 'prompts/list': return reply({ prompts: [] });
      default: return fail(-32601, 'Method not found: ' + msg.method);
    }
  }

  return async function handler(req, res) {
    const env = getEnv();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, mcp-protocol-version, mcp-session-id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

    const { route, query } = routeOf(req);
    const base = baseUrl(req, env);
    const problem = auth.configProblem(env);
    if (problem) return json(res, 503, { error: 'not_configured', error_description: problem + ' Set it in Vercel (Settings, Environment Variables) and redeploy.' });

    try {
      if (route === 'prm') return json(res, 200, auth.protectedResource(base));
      if (route === 'asm') return json(res, 200, auth.authorizationServer(base));

      if (route === 'register') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        const r = auth.register(await readBody(req), env);
        return json(res, r.status, r.json);
      }

      if (route === 'authorize') {
        if (req.method === 'GET') {
          const bad = auth.checkAuthorizeParams(query, env);
          return html(res, bad ? 400 : 200, auth.authorizePage(query, bad));
        }
        if (req.method === 'POST') {
          const r = await auth.authorizePost(await readBody(req), env, sleep);
          if (r.status === 302) { res.statusCode = 302; res.setHeader('Location', r.location); res.setHeader('Cache-Control', 'no-store'); return res.end(); }
          return html(res, r.status, r.html);
        }
        return json(res, 405, { error: 'GET or POST only' });
      }

      if (route === 'token') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        const r = auth.token(await readBody(req), env);
        return json(res, r.status, r.json);
      }

      /* the MCP endpoint */
      if (!auth.bearerOk(req.headers.authorization, env)) {
        return json(res, 401, { error: 'unauthorized', error_description: 'Sign in first.' },
          { 'WWW-Authenticate': 'Bearer resource_metadata="' + base + '/.well-known/oauth-protected-resource"' });
      }
      if (req.method === 'GET' || req.method === 'DELETE') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end(); }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

      const body = await readBody(req);
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map((m) => rpc(m, env)))).filter(Boolean);
        if (!out.length) { res.statusCode = 202; return res.end(); }
        return json(res, 200, out);
      }
      const out = await rpc(body || {}, env);
      if (!out) { res.statusCode = 202; return res.end(); }
      return json(res, 200, out);
    } catch (e) {
      return json(res, 500, { error: 'server_error', error_description: e.message });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;

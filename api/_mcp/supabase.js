/* =====================================================================
   Sky Team Ife MCP - the database, through Supabase's Management API.

   One endpoint runs SQL against the project as an admin:
     POST https://api.supabase.com/v1/projects/<ref>/database/query
   It needs a personal access token (SUPABASE_ACCESS_TOKEN), which is not
   the anon key and not the service_role key.
   ===================================================================== */
const DEFAULT_REF = 'xuxukwrvyduilmxyswik';           // the project in config.js

/* Strips comments and string contents so keyword checks cannot be fooled
   or tripped by text inside a quote. */
function bare(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '$$$$')
    .toLowerCase();
}

/* Read-only means: one statement, starting with a reading word, with no
   writing word anywhere in it. Anything else goes through db_execute. */
function readOnlyProblem(sql) {
  const s = bare(sql).trim().replace(/;\s*$/, '');
  if (!s) return 'Empty query.';
  if (s.includes(';')) return 'Only one statement at a time here.';
  if (!/^(select|with|explain|show|table|values)\b/.test(s)) return 'db_query only reads. Use db_execute to change anything.';
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|merge|vacuum|reindex|lock|set|reset|comment|security|refresh)\b/.test(s)) {
    return 'That looks like it changes something. Use db_execute.';
  }
  return '';
}

/* Things that cannot be undone get a second, explicit yes. */
function destructive(sql) {
  const s = bare(sql);
  const hits = [];
  if (/\bdrop\s+(table|schema|database|column|function|type|policy|trigger|index|extension)\b/.test(s)) hits.push('DROP');
  if (/\btruncate\b/.test(s)) hits.push('TRUNCATE');
  if (/\bdelete\s+from\s+[\w."]+\s*(;|$)/.test(s)) hits.push('DELETE with no WHERE');
  if (/\bupdate\s+[\w."]+\s+set\b(?![\s\S]*\bwhere\b)/.test(s)) hits.push('UPDATE with no WHERE');
  return hits;
}

function make(env, fetchFn) {
  const ref = env.SUPABASE_PROJECT_REF || DEFAULT_REF;

  async function run(sql) {
    if (!env.SUPABASE_ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN is not set in Vercel yet.');
    const r = await fetchFn('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql })
    });
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
    if (!r.ok) throw new Error('Supabase said: ' + ((j && (j.message || j.error)) || text.slice(0, 300) || ('HTTP ' + r.status)));
    return j;
  }
  return { ref, run };
}

module.exports = { make, readOnlyProblem, destructive, bare };

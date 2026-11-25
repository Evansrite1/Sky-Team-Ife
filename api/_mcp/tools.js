/* =====================================================================
   Sky Team Ife MCP - the tools Claude is given.

   The code (GitHub), the database (Supabase) and the deploy status.
   Everything that writes is checked first: JavaScript and JSON must
   parse, secrets must not be in the text, and anything that cannot be
   undone in the database needs an explicit yes.
   ===================================================================== */
const vm = require('vm');
const sbq = require('./supabase');

const LIVE_URL = 'https://sky-team-ife.vercel.app';
const MAX_OUT = 60000;

const INSTRUCTIONS = [
  'You are editing Sky Team Ife, a live attendance, weekly-report and ranking app for NeoLife offices in Nigeria. Real people use it every day, so every commit to main goes live in about a minute. Work carefully.',
  '',
  'HOW THE APP IS BUILT',
  '- A static site on Vercel (no build step) with Supabase behind it for the database, accounts and row level security.',
  '- index.html is the staff app, scan.html the public scan page. js/api.js (data), js/ui.js (shared UI and charts), js/views.js (pages), js/app.js (boot, routing, every click action), js/look.js, js/scan.js. css/styles.css. sw.js is the service worker: its CACHE name (sti-shell-vN) must go up when js, css or html change, or phones keep the old files. repo_commit does that for you.',
  '- api/*.js are Vercel serverless functions (push notifications, the Wednesday code push, report reminders, and this MCP server). Files starting with _ are helpers.',
  '- supabase/schema.sql is the base. supabase/RUN-THIS-ONCE.sql is the ONE file that holds every later change; keep it that way. Write SQL so it is safe to run twice (create or replace, if not exists, on conflict).',
  '- Roles: super_admin (the owner), platform_admin (a Director), office (an office login), member (a Senior Manager working inside an office), pending (no office yet). Offices and Directors are let in on sign-up with no approval. A Senior Manager who picks an office on sign-up is accepted by that office.',
  '- Weeks run Thursday to Wednesday. The Wednesday Senior Manager Training is at 2:45pm Lagos time; everyone checks in with the zone code.',
  '',
  'RULES',
  '- Read a file (repo_read, repo_search) before changing it. Prefer small repo_edit changes over rewriting a whole file.',
  '- No em dashes (the long dash) anywhere in the app text. Escape apostrophes inside single-quoted JavaScript strings.',
  '- A database check written as  not (is_admin() or my_office() = x)  is NULL for people with no office and lets them through. Always wrap comparisons in coalesce(..., false).',
  '- New tables need row level security and policies. Never put a secret, key or token in the repo.',
  '- For a risky change, pass branch (for example "phone-edit"): Vercel builds a preview of the branch and main is untouched. Otherwise a commit lands on main and is live.',
  '- A code change is live about a minute after the commit: check deploy_status. A database change is live the moment db_execute or db_run_file returns, so say what you are about to run before running it.',
  '- To change the database: put the SQL into supabase/RUN-THIS-ONCE.sql with repo_edit, then run it with db_run_file. For a one-off fix use db_execute. Use db_query to look at data first.',
  '- You cannot run the app or see the screen from here. Say plainly what you have and have not verified.'
].join('\n');

/* ------------------------------------------------------------- checks */
function syntaxProblem(path, text) {
  if (/\.(js|mjs)$/i.test(path)) {
    try { new vm.Script(text, { filename: path }); } catch (e) { return 'JavaScript does not parse: ' + e.message; }
  }
  if (/\.(json|webmanifest)$/i.test(path)) {
    try { JSON.parse(text); } catch (e) { return 'JSON does not parse: ' + e.message; }
  }
  return '';
}

function secretProblem(text) {
  if (/(sb_secret_[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|sbp_[a-f0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)) {
    return 'That text contains what looks like a secret key. Secrets belong in Vercel settings, never in the repo.';
  }
  const jwt = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
  let m;
  while ((m = jwt.exec(text))) {
    try { if (JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role === 'service_role') return 'That text contains a Supabase service_role key. Never commit it.'; } catch (e) { /* not a jwt */ }
  }
  return '';
}

function lintWarnings(path, text) {
  const w = [];
  if (/\.(js|css|html)$/i.test(path) && !/^api\//.test(path) && text.includes('—')) w.push(path + ': contains an em dash, which the app avoids.');
  return w;
}

function badPath(p) {
  const x = String(p || '');
  if (!x.trim()) return 'A path is needed.';
  if (x.includes('..') || /^\.git(\/|$)/.test(x) || x.includes('\\')) return 'That path is not allowed: ' + x;
  if (/^node_modules\//.test(x)) return 'Not touching node_modules.';
  return '';
}

/* Replace text in a file. Each old_string must be found exactly once unless replace_all. */
function applyEdits(text, edits, path) {
  let out = text;
  edits.forEach((e, i) => {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string' || e.old_string === '') {
      throw new Error(path + ': edit ' + (i + 1) + ' needs old_string and new_string.');
    }
    const n = out.split(e.old_string).length - 1;
    if (n === 0) throw new Error(path + ': edit ' + (i + 1) + ' did not match anything. Read the file again and copy the text exactly, including spaces.');
    if (n > 1 && !e.replace_all) throw new Error(path + ': edit ' + (i + 1) + ' matches ' + n + ' places. Add more surrounding text so it is unique, or set replace_all.');
    out = e.replace_all ? out.split(e.old_string).join(e.new_string) : out.replace(e.old_string, () => e.new_string);
  });
  return out;
}

const SHELL = /^(js\/|css\/|index\.html$|scan\.html$|manifest\.webmanifest$)/;
function bumpShell(swText) {
  const m = /const CACHE = 'sti-shell-v(\d+)'/.exec(swText);
  if (!m) return null;
  return swText.replace(m[0], "const CACHE = 'sti-shell-v" + (Number(m[1]) + 1) + "'");
}

const clip = (s) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + '\n... (cut; ask for a smaller piece)' : s);
const ok = (text) => ({ content: [{ type: 'text', text: clip(text) }] });
const bad = (text) => ({ content: [{ type: 'text', text: clip(text) }], isError: true });

/* ---------------------------------------------------------- definitions */
const str = (d) => ({ type: 'string', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const int = (d) => ({ type: 'integer', description: d });

const DEFS = [
  { name: 'app_overview', description: 'How the app is built and the rules for changing it. Read this first in a new conversation.', inputSchema: { type: 'object', properties: {} } },
  { name: 'repo_list', description: 'List the files and folders in one folder of the repo (empty path = the top).', inputSchema: { type: 'object', properties: { path: str('Folder, for example "js" or "supabase". Empty for the top.'), ref: str('Branch or commit. Default main.') } } },
  { name: 'repo_read', description: 'Read a file with line numbers. Big files: pass start_line and end_line.', inputSchema: { type: 'object', required: ['path'], properties: { path: str('File path, for example js/views.js'), start_line: int('First line to show (1-based).'), end_line: int('Last line to show.'), ref: str('Branch or commit. Default main.') } } },
  { name: 'repo_search', description: 'Find text across all the code (js, css, html, sql, md, json). Returns path:line matches.', inputSchema: { type: 'object', required: ['query'], properties: { query: str('Text to find (or a regex if regex is true).'), regex: bool('Treat query as a regular expression.'), case_sensitive: bool('Default false.'), path_prefix: str('Only search under this folder, for example "js/".'), ref: str('Branch. Default main.') } } },
  { name: 'repo_edit', description: 'Change one file by replacing exact text, and commit it. old_string must match exactly once (or set replace_all). JavaScript is syntax-checked first and the service-worker cache is bumped when needed. On main it is live in about a minute.', inputSchema: { type: 'object', required: ['path', 'old_string', 'new_string'], properties: { path: str('File path.'), old_string: str('Exact text to replace.'), new_string: str('Replacement text.'), replace_all: bool('Replace every match.'), message: str('Commit message.'), branch: str('Commit to this branch instead of main (created from main if new).') } } },
  { name: 'repo_write', description: 'Create a file or replace it entirely, and commit it. For changing part of a file use repo_edit.', inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: str('File path.'), content: str('The whole new text.'), message: str('Commit message.'), branch: str('Branch instead of main.') } } },
  { name: 'repo_commit', description: 'Several changes as ONE commit (a feature that touches js, css and sql). Each change is {path, content} to write a file, {path, edits:[{old_string,new_string,replace_all}]} to edit, or {path, delete:true}. Nothing is committed unless every change is valid.', inputSchema: { type: 'object', required: ['message', 'changes'], properties: { message: str('Commit message.'), changes: { type: 'array', description: 'The changes.', items: { type: 'object', required: ['path'], properties: { path: str('File path.'), content: str('Whole new text.'), edits: { type: 'array', items: { type: 'object', properties: { old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } } } }, delete: { type: 'boolean' } } } }, branch: str('Branch instead of main.'), bump_cache: bool('Bump the service-worker cache when js/css/html change. Default true.') } } },
  { name: 'repo_history', description: 'Recent commits (newest first), optionally for one file.', inputSchema: { type: 'object', properties: { limit: int('How many, up to 50. Default 10.'), path: str('Only commits touching this file.'), ref: str('Branch. Default main.') } } },
  { name: 'repo_revert', description: 'Undo a commit by restoring its files to how they were just before it. Later changes to those same files are lost, so use it on recent commits. Made as a new commit.', inputSchema: { type: 'object', required: ['sha'], properties: { sha: str('The commit to undo (from repo_history).'), message: str('Commit message.'), branch: str('Branch instead of main.') } } },
  { name: 'deploy_status', description: 'Is the latest commit live? Shows Vercel status for the newest commit on main (or a branch, whose preview link is in the status) and the service-worker version the live site is serving.', inputSchema: { type: 'object', properties: { branch: str('Default main.') } } },
  { name: 'db_schema', description: 'Look at the live database structure: all tables and columns, or one table with its policies.', inputSchema: { type: 'object', properties: { table: str('A table name, for example profiles. Empty for an overview.') } } },
  { name: 'db_query', description: 'Run ONE read-only SQL query (select, with, explain, show) against the live database and get the rows. Cannot change anything.', inputSchema: { type: 'object', required: ['sql'], properties: { sql: str('A single select statement.') } } },
  { name: 'db_execute', description: 'Run SQL that CHANGES the live database right now (create table, policies, functions, updates). Tell the owner what it will do first. Needs confirm: true. DROP, TRUNCATE and DELETE/UPDATE without a WHERE also need allow_destructive: true.', inputSchema: { type: 'object', required: ['sql', 'confirm'], properties: { sql: str('The SQL to run.'), confirm: bool('Must be true: you have said what this does and the owner agreed.'), allow_destructive: bool('Also needed for DROP, TRUNCATE, or DELETE/UPDATE with no WHERE.') } } },
  { name: 'db_run_file', description: 'Run a SQL file from the repo against the live database, for example supabase/RUN-THIS-ONCE.sql. This replaces pasting into the Supabase editor. The cron secret placeholder in it is filled in automatically. Needs confirm: true.', inputSchema: { type: 'object', required: ['path', 'confirm'], properties: { path: str('For example supabase/RUN-THIS-ONCE.sql'), ref: str('Branch. Default main.'), confirm: bool('Must be true.'), allow_destructive: bool('Needed if the file contains DROP, TRUNCATE or an unguarded DELETE/UPDATE.') } } }
];

/* -------------------------------------------------------------- handlers */
function build(env, github, supabase, fetchFn) {
  const rows = (j) => {
    if (j == null) return 'Done. (No rows returned.)';
    if (!Array.isArray(j)) return JSON.stringify(j, null, 2);
    const shown = j.slice(0, 200);
    return j.length + ' row' + (j.length === 1 ? '' : 's') + (j.length > shown.length ? ' (first ' + shown.length + ')' : '') + ':\n' + JSON.stringify(shown, null, 1);
  };

  async function commitChanges(message, changes, branch, bump) {
    if (!message || !String(message).trim()) throw new Error('A commit message is needed.');
    if (!Array.isArray(changes) || !changes.length) throw new Error('Nothing to change.');
    if (changes.length > 30) throw new Error('At most 30 files in one commit.');
    const ref = branch || github.main;
    const out = [], warnings = [];
    for (const c of changes) {
      const bp = badPath(c.path);
      if (bp) throw new Error(bp);
      if (c.delete) { out.push({ path: c.path, delete: true }); continue; }
      let content;
      if (Array.isArray(c.edits)) {
        let cur = await github.read(c.path, ref);
        if (!cur && ref !== github.main) cur = await github.read(c.path, github.main);
        if (!cur) throw new Error(c.path + ' does not exist. Use content to create it.');
        content = applyEdits(cur.text, c.edits, c.path);
      } else if (typeof c.content === 'string') {
        content = c.content;
      } else {
        throw new Error(c.path + ': give content, edits, or delete.');
      }
      const sp = syntaxProblem(c.path, content) || secretProblem(content);
      if (sp) throw new Error(c.path + ': ' + sp);
      warnings.push.apply(warnings, lintWarnings(c.path, content));
      out.push({ path: c.path, content });
    }
    if (bump !== false && out.some((c) => SHELL.test(c.path)) && !out.some((c) => c.path === 'sw.js')) {
      let sw = await github.read('sw.js', ref);
      if (!sw && ref !== github.main) sw = await github.read('sw.js', github.main);
      const next = sw && bumpShell(sw.text);
      if (next) { out.push({ path: 'sw.js', content: next }); warnings.push('sw.js: cache version bumped so phones pick up the change.'); }
    }
    const r = await github.commit(branch, String(message).trim(), out);
    const live = (branch && branch !== github.main)
      ? 'On branch "' + branch + '" only. Vercel builds a preview of it; main is untouched.'
      : 'On main. Live in about a minute; check deploy_status.';
    return 'Committed ' + r.sha.slice(0, 7) + ' (' + out.length + ' file' + (out.length === 1 ? '' : 's') + '): ' + out.map((c) => (c.delete ? '-' : '') + c.path).join(', ')
      + '\n' + r.url + '\n' + live + (warnings.length ? '\n\nNotes:\n- ' + warnings.join('\n- ') : '');
  }

  const handlers = {
    async app_overview() { return ok(INSTRUCTIONS); },

    async repo_list(a) {
      const items = await github.list(a.path || '', a.ref);
      return ok((a.path || '/') + '\n' + items.map((i) => (i.type === 'dir' ? i.name + '/' : i.name + '  (' + i.size + ' bytes)')).join('\n'));
    },

    async repo_read(a) {
      const bp = badPath(a.path);
      if (bp) return bad(bp);
      const f = await github.read(a.path, a.ref);
      if (!f) return bad(a.path + ' does not exist.');
      const lines = f.text.split('\n');
      const s = Math.max(1, a.start_line || 1), e = Math.min(lines.length, a.end_line || lines.length);
      const body = lines.slice(s - 1, e).map((l, i) => (s + i) + '\t' + l).join('\n');
      if (body.length > MAX_OUT && !a.end_line) return bad(a.path + ' has ' + lines.length + ' lines, too many to show at once. Pass start_line and end_line (about 400 lines at a time).');
      return ok(a.path + '  (' + lines.length + ' lines, showing ' + s + '-' + e + ')\n' + body);
    },

    async repo_search(a) {
      if (!a.query) return bad('Say what to search for.');
      let r;
      try { r = await github.search(a.query, { regex: a.regex, caseSensitive: a.case_sensitive, prefix: a.path_prefix, ref: a.ref }); }
      catch (e) { return bad(e instanceof SyntaxError ? 'That is not a valid regular expression.' : e.message); }
      if (!r.hits.length) return ok('No matches in ' + r.files + ' files.');
      return ok(r.hits.length + ' match' + (r.hits.length === 1 ? '' : 'es') + ' in ' + r.files + ' files' + (r.hits.length >= 200 ? ' (first 200)' : '') + ':\n'
        + r.hits.map((h) => h.path + ':' + h.line + ': ' + h.text).join('\n'));
    },

    async repo_edit(a) {
      return ok(await commitChanges(a.message || ('Edit ' + a.path), [{ path: a.path, edits: [{ old_string: a.old_string, new_string: a.new_string, replace_all: a.replace_all }] }], a.branch));
    },

    async repo_write(a) {
      return ok(await commitChanges(a.message || ('Write ' + a.path), [{ path: a.path, content: a.content }], a.branch));
    },

    async repo_commit(a) { return ok(await commitChanges(a.message, a.changes, a.branch, a.bump_cache)); },

    async repo_history(a) {
      const h = await github.history(a.limit, a.path, a.ref);
      return ok(h.map((c) => c.short + '  ' + c.date.slice(0, 10) + '  ' + c.message).join('\n'));
    },

    async repo_revert(a) {
      if (!/^[0-9a-f]{7,40}$/i.test(a.sha || '')) return bad('Give the commit sha from repo_history.');
      const c = await github.commitFiles(a.sha);
      if (!c.parent) return bad('That is the first commit; there is nothing before it to go back to.');
      const changes = [];
      for (const f of c.files) {
        if (f.status === 'added') changes.push({ path: f.filename, delete: true });
        else if (f.status === 'renamed') {
          changes.push({ path: f.filename, delete: true });
          const old = await github.read(f.previous_filename, c.parent);
          if (old) changes.push({ path: f.previous_filename, content: old.text });
        } else {
          const old = await github.read(f.filename, c.parent);
          if (old) changes.push({ path: f.filename, content: old.text });
        }
      }
      if (!changes.length) return bad('That commit changed nothing that can be restored.');
      return ok(await commitChanges(a.message || ('Revert "' + c.message + '"'), changes, a.branch));
    },

    async deploy_status(a) {
      const branch = a.branch || github.main;
      const s = await github.status(branch);
      const lines = ['Latest commit on ' + branch + ': ' + (s.sha || '').slice(0, 7), 'Overall: ' + s.state];
      (s.statuses || []).forEach((x) => lines.push('- ' + x.context + ': ' + x.state + (x.description ? ' (' + x.description + ')' : '') + (x.target_url ? ' ' + x.target_url : '')));
      if (!(s.statuses || []).length) lines.push('(No deployment status reported yet. It can take a few seconds after a commit.)');
      try {
        const live = await (await fetchFn(LIVE_URL + '/sw.js?x=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } })).text();
        const lv = (/sti-shell-v(\d+)/.exec(live) || [])[1];
        const repoSw = await github.read('sw.js', github.main);
        const rv = repoSw && (/sti-shell-v(\d+)/.exec(repoSw.text) || [])[1];
        lines.push('Live site is serving shell version v' + (lv || '?') + '; main has v' + (rv || '?') + (lv && rv ? (lv === rv ? ' (the latest app files are live).' : ' (not live yet).') : '.'));
      } catch (e) { lines.push('Could not read the live site: ' + e.message); }
      return ok(lines.join('\n'));
    },

    async db_schema(a) {
      if (a.table) {
        if (!/^[a-z_][a-z0-9_]*$/i.test(a.table)) return bad('That is not a table name.');
        const cols = await supabase.run("select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = '" + a.table + "' order by ordinal_position");
        const pol = await supabase.run("select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = '" + a.table + "'");
        return ok('Columns of ' + a.table + ':\n' + rows(cols) + '\n\nPolicies:\n' + rows(pol));
      }
      const r = await supabase.run("select table_name, string_agg(column_name, ', ' order by ordinal_position) as columns from information_schema.columns where table_schema = 'public' group by table_name order by table_name");
      return ok(rows(r));
    },

    async db_query(a) {
      const p = sbq.readOnlyProblem(a.sql);
      if (p) return bad(p);
      return ok(rows(await supabase.run(a.sql)));
    },

    async db_execute(a) {
      if (a.confirm !== true) return bad('Not run. Tell the owner what this SQL does, then call again with confirm: true.');
      if (!a.sql || !String(a.sql).trim()) return bad('No SQL given.');
      const d = sbq.destructive(a.sql);
      if (d.length && a.allow_destructive !== true) return bad('Not run. This contains ' + d.join(', ') + ', which cannot be undone. If the owner really wants it, call again with allow_destructive: true.');
      return ok('Ran against the live database.\n' + rows(await supabase.run(a.sql)));
    },

    async db_run_file(a) {
      if (a.confirm !== true) return bad('Not run. Tell the owner which file you are about to run, then call again with confirm: true.');
      const bp = badPath(a.path);
      if (bp) return bad(bp);
      if (!/\.sql$/i.test(a.path)) return bad('Only .sql files.');
      const f = await github.read(a.path, a.ref);
      if (!f) return bad(a.path + ' does not exist.');
      let sql = f.text;
      const placeholder = 'PUT-YOUR-CRON-SECRET-HERE';
      if (sql.includes(placeholder) && env.CRON_SECRET) sql = sql.split(placeholder).join(env.CRON_SECRET);
      const d = sbq.destructive(sql);
      if (d.length && a.allow_destructive !== true) return bad('Not run. ' + a.path + ' contains ' + d.join(', ') + '. If that is intended, call again with allow_destructive: true.');
      const r = await supabase.run(sql);
      return ok('Ran ' + a.path + ' (' + f.text.split('\n').length + ' lines) against the live database.\n' + rows(r));
    }
  };

  async function call(name, args) {
    const h = handlers[name];
    if (!h) return bad('No such tool: ' + name);
    try { return await h(args || {}); }
    catch (e) { return bad(e.message || String(e)); }
  }
  return { call };
}

module.exports = { DEFS, INSTRUCTIONS, build, syntaxProblem, secretProblem, applyEdits, bumpShell, badPath };

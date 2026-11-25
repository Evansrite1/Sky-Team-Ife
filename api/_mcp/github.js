/* =====================================================================
   Sky Team Ife MCP - the code, through the GitHub API.

   Every edit is a real commit on the repo. Vercel deploys any commit to
   main by itself, so a change is live about a minute after it is made.
   Several files can go in as ONE commit.

   Who the commits are by comes from two Vercel settings the owner sets:
   MCP_COMMIT_NAME and MCP_COMMIT_EMAIL. If they are not set, GitHub
   uses the identity of the token's owner.
   ===================================================================== */
const TEXT_EXT = /\.(js|mjs|css|html|sql|md|json|webmanifest|txt|svg)$/i;
const SKIP = /^(node_modules|media|icons|js\/vendor)\//;

function make(env, fetchFn) {
  const repo = env.GITHUB_REPO || 'Evansrite1/Sky-Team-Ife';
  const main = env.GITHUB_BRANCH || 'main';
  const author = env.MCP_COMMIT_NAME && env.MCP_COMMIT_EMAIL ? { name: env.MCP_COMMIT_NAME, email: env.MCP_COMMIT_EMAIL } : null;
  const blobCache = new Map();               // sha -> text; blobs never change

  async function api(method, path, body) {
    if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set in Vercel yet.');
    const r = await fetchFn('https://api.github.com' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sky-team-ife-mcp', 'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
    if (!r.ok) {
      const msg = (j && j.message) || text.slice(0, 200) || ('HTTP ' + r.status);
      throw new Error('GitHub said: ' + msg + ' (' + r.status + ')');
    }
    return j;
  }

  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const clean = (p) => String(p || '').replace(/^\/+/, '').replace(/\/+$/, '');

  async function headOf(branch) {
    const r = await api('GET', '/repos/' + repo + '/git/ref/heads/' + enc(branch));
    return r.object.sha;
  }

  /* One level of a folder. */
  async function list(path, ref) {
    const p = clean(path);
    const j = await api('GET', '/repos/' + repo + '/contents/' + (p ? enc(p) : '') + '?ref=' + encodeURIComponent(ref || main));
    if (!Array.isArray(j)) throw new Error(p + ' is a file, not a folder.');
    return j.map((x) => ({ name: x.name, path: x.path, type: x.type === 'dir' ? 'dir' : 'file', size: x.size }));
  }

  async function blob(sha) {
    if (blobCache.has(sha)) return blobCache.get(sha);
    const j = await api('GET', '/repos/' + repo + '/git/blobs/' + sha);
    const text = Buffer.from(j.content || '', j.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
    if (blobCache.size > 400) blobCache.clear();
    blobCache.set(sha, text);
    return text;
  }

  /* A file's text and sha, or null when it does not exist. */
  async function read(path, ref) {
    try {
      const j = await api('GET', '/repos/' + repo + '/contents/' + enc(clean(path)) + '?ref=' + encodeURIComponent(ref || main));
      if (Array.isArray(j)) throw new Error(clean(path) + ' is a folder. Use repo_list.');
      const text = j.content && j.encoding === 'base64'
        ? Buffer.from(j.content, 'base64').toString('utf8') : await blob(j.sha);
      return { path: j.path, sha: j.sha, text, size: j.size };
    } catch (e) {
      if (/\(404\)/.test(e.message)) return null;
      throw e;
    }
  }

  /* Every file path in the repo (recursive). */
  async function tree(ref) {
    const head = await headOf(ref || main);
    const c = await api('GET', '/repos/' + repo + '/git/commits/' + head);
    const t = await api('GET', '/repos/' + repo + '/git/trees/' + c.tree.sha + '?recursive=1');
    return t.tree.filter((x) => x.type === 'blob').map((x) => ({ path: x.path, sha: x.sha, size: x.size }));
  }

  /* Plain-text search across the code. */
  async function search(query, opts) {
    opts = opts || {};
    const files = (await tree(opts.ref)).filter((f) => TEXT_EXT.test(f.path) && !SKIP.test(f.path)
      && f.size < 400000 && (!opts.prefix || f.path.startsWith(clean(opts.prefix))));
    let test;
    if (opts.regex) {
      const re = new RegExp(query, opts.caseSensitive ? '' : 'i');
      test = (line) => re.test(line);
    } else {
      const q = opts.caseSensitive ? query : query.toLowerCase();
      test = (line) => (opts.caseSensitive ? line : line.toLowerCase()).includes(q);
    }
    const hits = [];
    let i = 0;
    const worker = async () => {
      while (i < files.length && hits.length < 200) {
        const f = files[i++];
        let text;
        try { text = await blob(f.sha); } catch (e) { continue; }
        text.split('\n').forEach((line, n) => { if (test(line) && hits.length < 200) hits.push({ path: f.path, line: n + 1, text: line.trim().slice(0, 200) }); });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    hits.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
    return { files: files.length, hits };
  }

  /* One commit for any number of files. changes: [{path, content} | {path, delete:true}] */
  async function commit(branch, message, changes) {
    branch = branch || main;
    let head;
    try { head = await headOf(branch); }
    catch (e) {
      if (branch === main) throw e;
      const base = await headOf(main);                  // a new branch starts from main
      await api('POST', '/repos/' + repo + '/git/refs', { ref: 'refs/heads/' + branch, sha: base });
      head = base;
    }
    const parent = await api('GET', '/repos/' + repo + '/git/commits/' + head);
    const entries = changes.map((c) => (c.delete
      ? { path: clean(c.path), mode: '100644', type: 'blob', sha: null }
      : { path: clean(c.path), mode: '100644', type: 'blob', content: c.content }));
    const tr = await api('POST', '/repos/' + repo + '/git/trees', { base_tree: parent.tree.sha, tree: entries });
    const body = { message, tree: tr.sha, parents: [head] };
    if (author) { body.author = author; body.committer = author; }
    const cm = await api('POST', '/repos/' + repo + '/git/commits', body);
    await api('PATCH', '/repos/' + repo + '/git/refs/heads/' + enc(branch), { sha: cm.sha });
    return { sha: cm.sha, url: 'https://github.com/' + repo + '/commit/' + cm.sha, branch };
  }

  async function history(limit, path, ref) {
    const q = '?sha=' + encodeURIComponent(ref || main) + '&per_page=' + Math.min(Math.max(limit || 10, 1), 50)
      + (path ? '&path=' + encodeURIComponent(clean(path)) : '');
    const j = await api('GET', '/repos/' + repo + '/commits' + q);
    return j.map((c) => ({ sha: c.sha, short: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0], author: c.commit.author.name, date: c.commit.author.date }));
  }

  /* The files a commit touched, and its parent (for a revert). */
  async function commitFiles(sha) {
    const c = await api('GET', '/repos/' + repo + '/commits/' + sha);
    return { parent: c.parents[0] && c.parents[0].sha, message: c.commit.message.split('\n')[0], files: c.files || [] };
  }

  async function status(branch) {
    return api('GET', '/repos/' + repo + '/commits/' + encodeURIComponent(branch || main) + '/status');
  }

  return { repo, main, author, list, read, tree, search, commit, history, commitFiles, status, blob };
}

module.exports = { make };

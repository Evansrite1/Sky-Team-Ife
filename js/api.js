/* =====================================================================
   Sky Team Ife - everything that talks to Supabase.
   No view file touches the client directly; it all comes through here.
   ===================================================================== */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  let sb = null;

  if (CFG.ready && window.supabase) {
    sb = window.supabase.createClient(CFG.supabaseUrl.replace(/\/$/, ''), CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  /* A failed query should say what went wrong, not disappear. */
  const guard = (res) => {
    if (res && res.error) {
      const m = res.error.message || 'Something went wrong talking to the database.';
      const e = new Error(m);
      e.code = res.error.code;
      throw e;
    }
    return res ? res.data : null;
  };
  const rows = res => guard(res) || [];

  /* --------------------------------------------------------- the cache */
  const store = {
    session: null,
    me: null,          // profile row + office + zone
    centers: [],       // zones, as the UI calls them; the table is centers
    offices: [],
    niches: [],
    settings: {},
    waiting: 0,        // accounts asking to be approved (super admin only)
    leaders: 0         // super admins + directors, for the sidebar count
  };

  /* ------------------------------------------------------------- auth */
  const auth = {
    async session() {
      if (!sb) return null;
      const { data } = await sb.auth.getSession();
      store.session = data ? data.session : null;
      return store.session;
    },
    async signIn(email, password) {
      return guard(await sb.auth.signInWithPassword({ email: email.trim(), password }));
    },
    async signUp(email, password, fullName) {
      return guard(await sb.auth.signUp({
        email: email.trim(), password,
        options: { data: { full_name: fullName || '' }, emailRedirectTo: CFG.appUrl }
      }));
    },
    async signOut() {
      store.me = null; store.session = null;
      if (sb) await sb.auth.signOut();
    },
    async resetPassword(email) {
      /* No hash in the redirect. Supabase delivers the recovery token by
         appending its own #access_token=...&type=recovery to whatever
         URL is given, and this app's router also lives in the hash - a
         redirect of ".../#/reset" would end up as two hashes stacked in
         one URL (".../#/reset#access_token=..."), which the browser
         treats as a single fragment starting at the first '#'. Supabase
         reads that fragment as a query string, so its own "access_token"
         key comes out mangled as "/reset#access_token" and the token is
         silently lost - password reset stops working with no error
         anywhere. A query marker instead of a hash leaves Supabase's
         hash alone; app.js recognises the recovery sign-in itself, via
         the PASSWORD_RECOVERY auth event, and takes it from there. */
      return guard(await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: CFG.appUrl + '/?reset=1'
      }));
    },
    async updatePassword(password) {
      return guard(await sb.auth.updateUser({ password }));
    },
    onChange(fn) { if (sb) sb.auth.onAuthStateChange(fn); }
  };

  /* ---------------------------------------------------------- profile */
  async function loadMe() {
    const s = await auth.session();
    if (!s) { store.me = null; return null; }
    const p = guard(await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle());
    if (!p) { store.me = null; return null; }
    store.me = p;
    /* Stamps last_seen, at most once every five minutes. Fire and
       forget: a failure here must never block signing in. */
    sb.rpc('touch_last_seen').then(() => {}, () => {});
    /* Side by side, not one after the other: every round trip here is
       time the first page spends as a spinner. */
    const [off, cen] = await Promise.all([
      (p.office_id || p.member_office_id) ? sb.from('offices').select('*').eq('id', p.office_id || p.member_office_id).maybeSingle() : null,
      p.center_id ? sb.from('centers').select('*').eq('id', p.center_id).maybeSingle() : null
    ]);
    if (off) store.me.office = guard(off);
    if (cen) store.me.center = guard(cen);
    return store.me;
  }

  const isAdmin = () => !!store.me && (store.me.role === 'super_admin' || store.me.role === 'platform_admin');
  const isSuper = () => !!store.me && store.me.role === 'super_admin';
  const isOffice = () => !!store.me && store.me.role === 'office';
  const isMember = () => !!store.me && store.me.role === 'member';

  /* ------------------------------------------------------- lookup sets */
  async function loadLookups() {
    /* Everything this boot needs goes out in one wave. */
    const [c, o, n, s, w, l] = await Promise.all([
      sb.from('centers').select('*').order('name'),
      sb.from('offices').select('*').order('name'),
      sb.from('niches').select('*').order('name'),
      sb.from('app_settings').select('*'),
      isSuper()
        ? sb.from('profiles').select('id', { count: 'exact', head: true }).eq('req_status', 'pending')
        : { count: 0 },
      isAdmin()
        ? sb.from('profiles').select('id', { count: 'exact', head: true }).in('role', ['super_admin', 'platform_admin'])
        : { count: 0 }
    ]);
    store.centers = rows(c);
    store.offices = rows(o);
    store.niches = rows(n).map(r => r.name);
    store.settings = {};
    rows(s).forEach(r => { store.settings[r.key] = r.value; });

    /* Counts the sidebar carries, so an admin can see the totals and the
       approval queue without opening anything. */
    store.waiting = w.count || 0;
    store.leaders = l.count || 0;
    return store;
  }

  const centerById = id => store.centers.find(c => c.id === id) || null;
  const officeById = id => store.offices.find(o => o.id === id) || null;
  const officesOf = cid => store.offices.filter(o => o.center_id === cid);

  /* ------------------------------------------------------------ zones */
  /* Called centers throughout the code, because that is the table name.
     The word the user sees is Zone. */
  const centers = {
    async create(row) {
      const d = guard(await sb.from('centers').insert(row).select().single());
      store.centers.push(d); store.centers.sort((a, b) => a.name.localeCompare(b.name));
      return d;
    },
    async update(id, patch) {
      const d = guard(await sb.from('centers').update(patch).eq('id', id).select().single());
      const i = store.centers.findIndex(c => c.id === id);
      if (i > -1) store.centers[i] = d;
      return d;
    },
    async remove(id) {
      guard(await sb.from('centers').delete().eq('id', id));
      store.centers = store.centers.filter(c => c.id !== id);
    }
  };

  /* ---------------------------------------------------------- offices */
  const offices = {
    async create(row) {
      const d = guard(await sb.from('offices').insert(row).select().single());
      store.offices.push(d); store.offices.sort((a, b) => a.name.localeCompare(b.name));
      return d;
    },
    async update(id, patch) {
      const d = guard(await sb.from('offices').update(patch).eq('id', id).select().single());
      const i = store.offices.findIndex(o => o.id === id);
      if (i > -1) store.offices[i] = d;
      if (store.me && store.me.office_id === id) store.me.office = d;
      return d;
    },
    /* Goes through the function so the account that signed up is put back
       to waiting rather than left holding a role with no office. */
    async remove(id) {
      const { error } = await sb.rpc('delete_office', { p_office: id });
      if (error) throw new Error(error.message);
      store.offices = store.offices.filter(o => o.id !== id);
    },
    /* Moves the office and everything stamped with its zone. */
    async move(id, centerId) {
      const { error } = await sb.rpc('move_office', { p_office: id, p_center: centerId });
      if (error) throw new Error(error.message);
      const i = store.offices.findIndex(o => o.id === id);
      if (i > -1) store.offices[i] = Object.assign({}, store.offices[i], { center_id: centerId });
    }
  };

  /* ----------------------------------------------------- distributors */
  const distributors = {
    async list(filter) {
      let q = sb.from('distributors').select('*').eq('active', true).order('full_name');
      if (filter && filter.office) q = q.eq('office_id', filter.office);
      if (filter && filter.center) q = q.eq('center_id', filter.center);
      return rows(await q);
    },
    async create(row) { return guard(await sb.from('distributors').insert(row).select().single()); },
    async update(id, patch) { return guard(await sb.from('distributors').update(patch).eq('id', id).select().single()); },
    async remove(id) { guard(await sb.from('distributors').update({ active: false }).eq('id', id)); },
    /* One insert, not one per row - a sheet of eighty names used to mean
       eighty round trips before this. */
    async bulkCreate(rowsIn) {
      if (!rowsIn.length) return [];
      return rows(await sb.from('distributors').insert(rowsIn).select());
    }
  };

  /* ---------------------------------------------------------- reports */
  const reports = {
    async list(filter) {
      filter = filter || {};
      let q = sb.from('reports').select('*');
      if (filter.week) q = q.eq('week_start', filter.week);
      if (filter.weeks) q = q.in('week_start', filter.weeks);
      if (filter.office) q = q.eq('office_id', filter.office);
      if (filter.center) q = q.eq('center_id', filter.center);
      if (filter.from) q = q.gte('week_start', filter.from);
      return rows(await q.order('week_start', { ascending: false }));
    },
    async get(officeId, week) {
      return guard(await sb.from('reports').select('*')
        .eq('office_id', officeId).eq('week_start', week).maybeSingle());
    },
    async save(row) {
      return guard(await sb.from('reports')
        .upsert(row, { onConflict: 'office_id,week_start' }).select().single());
    },
    async remove(id) { guard(await sb.from('reports').delete().eq('id', id)); }
  };

  /* ----------------------------------------------------------- issues */
  /* An office lists what slowed it down one issue at a time; they are
     kept in reports.issues one per line, so an old free-text report
     still reads as a single issue. A Director or Super Admin answers
     each one, and that answer lives in issue_solutions, matched to its
     issue by the report and the issue's own words. */
  const NO_ISSUE = /^(none|nil|no( major)? (blockers?|issues?|problems?)|n\/a)\.?$/i;
  const issues = {
    split(text) {
      const t = String(text || '');
      if (t.indexOf('Estimated by admin') === 0) return [];
      return t.split(/\r?\n/).map(s => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim())
        .filter(s => s && !NO_ISSUE.test(s));
    },
    join(list) { return (list || []).map(s => String(s).trim()).filter(Boolean).join('\n'); },
    /* Throws a plain "run the SQL" error when the table is not there yet,
       so a page can say exactly that instead of a database message. */
    async solutions(filter) {
      filter = filter || {};
      let q = sb.from('issue_solutions').select('*');
      if (filter.office) q = q.eq('office_id', filter.office);
      if (filter.weeks) q = q.in('week_start', filter.weeks);
      if (filter.reports) q = q.in('report_id', filter.reports);
      const res = await q;
      if (res.error && /issue_solutions|does not exist|schema cache/i.test(res.error.message || '')) {
        const e = new Error('Solutions are not switched on yet - run supabase/2026-10-issue-solutions.sql in Supabase.');
        e.missingTable = true;
        throw e;
      }
      return rows(res);
    },
    async solve(report, issue, solution) {
      const text = String(solution || '').trim();
      if (!text) {
        guard(await sb.from('issue_solutions').delete().eq('report_id', report.id).eq('issue', issue));
        return null;
      }
      return guard(await sb.from('issue_solutions').upsert({
        report_id: report.id, issue: issue,
        office_id: report.office_id, center_id: report.center_id, week_start: report.week_start,
        solution: text,
        solved_by: store.me ? store.me.id : null,
        solved_by_name: store.me ? (store.me.full_name || store.me.email || '') : '',
        updated_at: new Date().toISOString()
      }, { onConflict: 'report_id,issue' }).select().single());
    }
  };

  /* ------------------------------------------------------------- push */
  /* Notifications on this device: turning them on asks the browser for
     permission, subscribes through the service worker, and keeps the
     subscription in push_subscriptions so api/push.js knows where to
     deliver. */
  const b64key = (s) => {
    const p = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(p), out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const push = {
    supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
    /* On an iPhone push only works once the app is on the home screen. */
    needsInstall() { return isIOS() && !standalone(); },
    permission() { return this.supported() ? Notification.permission : 'unsupported'; },
    async registration() {
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) reg = await navigator.serviceWorker.register('sw.js');
      return reg;
    },
    async current() {
      if (!this.supported()) return null;
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? reg.pushManager.getSubscription() : null;
    },
    async enable() {
      if (this.needsInstall()) throw new Error('On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), open it from there, then turn notifications on.');
      if (!this.supported()) throw new Error('This browser cannot show notifications. Try Chrome.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
      const reg = await this.registration();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(CFG.vapidPublicKey) });
      const j = sub.toJSON();
      const me = store.me || {};
      const res = await sb.from('push_subscriptions').upsert({
        user_id: me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
        role: me.role || '', office_id: me.office_id || null, center_id: me.center_id || null,
        user_agent: navigator.userAgent.slice(0, 200), last_used: new Date().toISOString()
      }, { onConflict: 'endpoint' });
      if (res.error && /push_subscriptions|does not exist|schema cache/i.test(res.error.message || '')) {
        throw new Error('Notifications are not switched on yet - run supabase/2026-10-push.sql in Supabase.');
      }
      guard(res);
      return true;
    },
    async disable() {
      const sub = await this.current();
      if (!sub) return;
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    },
    /* Asks api/push.js to deliver; it checks who is asking itself. */
    async send(body) {
      const s = await auth.session();
      if (!s) throw new Error('Sign in first.');
      const r = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token },
        body: JSON.stringify(body)
      });
      let j = {};
      try { j = await r.json(); } catch (e) { /* not json */ }
      if (!r.ok) throw new Error(j.error || 'The notification server did not answer (' + r.status + ').');
      return j;
    }
  };

  /* --------------------------------------------------------- feedback */
  /* Answers to the question in the "What's new" popup. Anyone sends
     their own; only the Super Admin reads them. */
  const feedback = {
    async send(row) {
      const me = store.me || {};
      const res = await sb.from('feedback').insert(Object.assign({
        user_id: me.id, name: me.full_name || me.email || '', role: me.role || '',
        office_id: me.office_id || null, center_id: me.center_id || null
      }, row));
      if (res.error && /feedback|does not exist|schema cache/i.test(res.error.message || '')) {
        throw new Error('Could not send just now - please try again later.');
      }
      guard(res);
    },
    async list() {
      const res = await sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(200);
      if (res.error && /feedback|does not exist|schema cache/i.test(res.error.message || '')) {
        const e = new Error('Run supabase/2026-10-feedback.sql in Supabase to start collecting answers.');
        e.missingTable = true;
        throw e;
      }
      return rows(res);
    }
  };

  /* ----------------------------------------------------------- events */
  const events = {
    async ensureWeek(week) {
      const { error } = await sb.rpc('ensure_week_events', { p_week: week });
      if (error) console.warn('ensure_week_events:', error.message);
    },
    async list(filter) {
      filter = filter || {};
      /* The Wednesday Senior Manager Training is the only training. */
      let q = sb.from('events').select('*').eq('type', 'SM');
      if (filter.week) q = q.eq('week_start', filter.week);
      if (filter.weeks) q = q.in('week_start', filter.weeks);
      if (filter.center) q = q.eq('center_id', filter.center);
      if (filter.kind) q = q.eq('kind', filter.kind);
      return rows(await q.order('event_date', { ascending: false }));
    },
    async get(id) { return guard(await sb.from('events').select('*').eq('id', id).maybeSingle()); },
    async create(row) { return guard(await sb.from('events').insert(row).select().single()); },
    async update(id, patch) { return guard(await sb.from('events').update(patch).eq('id', id).select().single()); },
    async remove(id) { guard(await sb.from('events').delete().eq('id', id)); }
  };

  /* ------------------------------------------------------------ scans */
  const scans = {
    async forEvents(ids) {
      if (!ids.length) return [];
      return rows(await sb.from('scans').select('*').in('event_id', ids).order('scanned_at'));
    },
    async forEvent(id) {
      return rows(await sb.from('scans').select('*').eq('event_id', id).order('scanned_at'));
    },
    async add(row) { return guard(await sb.from('scans').insert(row).select().single()); },
    async remove(id) { guard(await sb.from('scans').delete().eq('id', id)); }
  };

  /* ----------------------------------------------------------- niches */
  const niches = {
    async add(name) {
      name = String(name).trim();
      if (!name) return null;
      if (store.niches.some(n => n.toLowerCase() === name.toLowerCase())) return name;
      const { error } = await sb.from('niches').insert({ name, created_by: store.me ? store.me.id : null });
      if (error && error.code !== '23505') throw new Error(error.message);
      store.niches.push(name);
      store.niches.sort((a, b) => a.localeCompare(b));
      return name;
    }
  };

  /* ---------------------------------------------------------- people */
  const people = {
    async admins() {
      return rows(await sb.from('profiles').select('*')
        .in('role', ['super_admin', 'platform_admin']).order('created_at'));
    },
    /* Everyone who has signed up and is still waiting - whether they have
       filled in what they are joining as or not. */
    async pending() {
      return rows(await sb.from('profiles').select('*').eq('role', 'pending').order('req_at'));
    },
    /* Everyone with a role, newest sign-in first. Super admin only in
       practice, since the profiles policy hides other rows otherwise. */
    async everyone() {
      return rows(await sb.from('profiles').select('*')
        .neq('role', 'pending').order('last_seen', { ascending: false, nullsFirst: false }));
    },
    /* Every account, whatever its role, for the sign-ins page. */
    async all() {
      return rows(await sb.from('profiles').select('*').order('last_seen', { ascending: false, nullsFirst: false }));
    },
    async approve(id) {
      const { error } = await sb.rpc('approve_access_request', { p_user: id });
      if (error) throw new Error(error.message);
    },
    async decline(id, reason) {
      const { error } = await sb.rpc('decline_access_request', { p_user: id, p_reason: reason || '' });
      if (error) throw new Error(error.message);
    },
    async setRole(id, role) {
      return guard(await sb.from('profiles').update({ role }).eq('id', id).select().single());
    }
  };

  /* --------------------------------------------------------- settings */
  const settings = {
    async set(key, value) {
      guard(await sb.from('app_settings').upsert({ key, value }, { onConflict: 'key' }));
      store.settings[key] = value;
    }
  };

  /* Every new feature ships behind one of these, default off. Reading
     straight from store.settings rather than a separate flags object -
     one source of truth, and a flag flipped elsewhere in the app shows
     up here on the next lookup rather than needing its own refresh. */
  const feature = (key) => (store.settings || {})['feature_' + key] === 'true';

  /* ------------------------------------------------------------ audit */
  const activity = {
    /* Best-effort: a mistake logging the log must never block the
       action it was written to explain. */
    async log(action, target) {
      if (!feature('activity_log')) return;
      try {
        await sb.from('activity_log').insert({
          actor_id: store.me ? store.me.id : null,
          actor_name: store.me ? (store.me.full_name || store.me.email) : '',
          action,
          target_kind: (target && target.kind) || '',
          target_id: (target && target.id) || null,
          target_name: (target && target.name) || '',
          detail: (target && target.detail) || ''
        });
      } catch (e) { /* ignore */ }
    },
    async list(limit) {
      return rows(await sb.from('activity_log').select('*')
        .order('created_at', { ascending: false }).limit(limit || 100));
    }
  };

  /* ------------------------------------------------------------ goals */
  const goals = {
    async get(officeId, monthNo) {
      return guard(await sb.from('goals').select('*')
        .eq('office_id', officeId).eq('month_no', monthNo).maybeSingle());
    },
    async set(officeId, monthNo, targetOrders, targetAmount) {
      return guard(await sb.from('goals').upsert({
        office_id: officeId, month_no: monthNo,
        target_orders: targetOrders, target_amount: targetAmount,
        updated_at: new Date().toISOString()
      }, { onConflict: 'office_id,month_no' }));
    }
  };

  /* -------------------------------------------------------- announce */
  const announce = {
    /* audience: 'all' | 'office' | 'platform_admin' | 'super_admin'.
       The Edge Function is the one that actually checks the caller is
       a Super Admin - this just carries the session token along so it
       can. */
    async send(subject, message, audience) {
      const { data: s } = await sb.auth.getSession();
      const token = s && s.session ? s.session.access_token : null;
      if (!token) throw new Error('Sign in again, then try once more.');
      const res = await fetch(CFG.supabaseUrl.replace('.supabase.co', '.functions.supabase.co') + '/notify', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'broadcast', subject, message, audience })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not send that.');
      return out;
    }
  };

  /* Puts a distributor on the list without a scan, for anyone who has no
     phone. Admin only, enforced in the function. */
  scans.markPresent = async (eventId, distributorId) => {
    const { data, error } = await sb.rpc('mark_present', {
      p_event: eventId, p_distributor: distributorId
    });
    if (error) throw new Error(error.message);
    if (data && data.ok === false) throw new Error(data.error);
    return data;
  };

  /* --------------------------------------------------------- realtime */
  /* One channel for the whole app. Postgres tells us a row moved, we tell
     the router, and it repaints whatever page is open. Row level security
     applies to the stream too, so nobody is told about a row they could
     not have read in the first place. */
  let live = null;
  function watch(onChange) {
    if (!sb || live) return;
    const tables = ['reports', 'offices', 'centers', 'distributors',
      'events', 'scans', 'profiles'];
    live = sb.channel('sti-live');
    tables.forEach(t => {
      live.on('postgres_changes', { event: '*', schema: 'public', table: t },
        (p) => onChange(t, p));
    });
    live.subscribe();
  }
  function unwatch() {
    if (!sb || !live) return;
    sb.removeChannel(live);
    live = null;
  }

  /* ------------------------------------------------------------- join */
  const join = {
    /* What a new account asks for. Nothing is created here - the row just
       goes on their own profile and waits for the Super Admin. */
    async request(kind, payload) {
      const office = kind === 'office';
      const { error } = await sb.rpc('submit_access_request', {
        p_kind: kind,
        p_full_name: payload.fullName,
        p_phone: payload.phone,
        p_center_id: office ? payload.centerId : null,
        p_office_name: office ? payload.officeName : null,
        p_address: office ? payload.address : null
      });
      if (error) throw new Error(error.message);
    },
    /* The sign-up screen needs the zones before the user has a role. */
    async publicCenters() {
      return rows(await sb.from('centers').select('id,name').order('name'));
    }
  };

  /* ---------------------------------------------------------- members */
  /* Senior and Executive Managers: their own login, a Wednesday check-in
     with the zone code, and a private list of people they follow up. */
  const lagosNow = () => new Date(Date.now() + 3600000);        // read with the UTC getters
  const rpc = async (name, args) => {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message);
    return data;
  };
  const member = {
    joinInfo: (code) => rpc('join_office_info', { p_code: code }),
    join: (d) => rpc('member_join', { p_code: d.code, p_rank: d.rank, p_name: d.name, p_phone: d.phone || '', p_dist: d.dist || null, p_sponsor: d.sponsor || '' }),
    checkIn: (code) => rpc('member_check_in', { p_code: code }),
    /* When check-in closes on a given date: 18:00, unless the Super Admin
       extended that one day (settings checkin_extra_date / _until). */
    endFor(dateIso) {
      const s = store.settings || {};
      return s.checkin_extra_date === dateIso && /^\d\d:\d\d/.test(s.checkin_extra_until || '')
        ? s.checkin_extra_until.slice(0, 5) : '18:00';
    },
    ensureWeek: (center, week) => sb.rpc('ensure_week_events_for', { p_center: center, p_week: week }).then(() => {}, () => {}),
    /* The last twelve Wednesday trainings in a zone and who checked in.
       A member with no scan for a training that is over is absent: there
       is no row for that, it is worked out here. */
    async attendance(centerId, distIds) {
      const evs = rows(await sb.from('events').select('id,week_start,event_date')
        .eq('center_id', centerId).eq('type', 'SM').order('event_date', { ascending: false }).limit(12));
      const ids = evs.map(e => e.id);
      const scans = (ids.length && distIds.length)
        ? rows(await sb.from('scans').select('event_id,distributor_id,late,scanned_at')
          .eq('status', 'accepted').in('event_id', ids).in('distributor_id', distIds))
        : [];
      const ln = lagosNow();
      return { events: evs, scans, today: ln.toISOString().slice(0, 10), hhmm: ln.toISOString().slice(11, 16) };
    },
    /* present | late | absent | pending | none (before they joined) */
    classify(att, ev, distId, joined) {
      const sc = att.scans.find(s => s.event_id === ev.id && s.distributor_id === distId);
      if (sc) return sc.late ? 'late' : 'present';
      if (joined && ev.event_date < String(joined).slice(0, 10)) return 'none';
      const over = ev.event_date < att.today || (ev.event_date === att.today && att.hhmm >= member.endFor(att.today));
      return over ? 'absent' : 'pending';
    },
    async codes(thu) {
      await sb.rpc('ensure_week_events', { p_week: thu }).then(() => {}, () => {});
      const r = rows(await sb.from('event_codes').select('code,events!inner(center_id,week_start,type)')
        .eq('events.week_start', thu).eq('events.type', 'SM'));
      return r.map(x => ({ center_id: x.events.center_id, code: x.code }));
    },
    async joinCode(officeId) {
      const r = guard(await sb.from('office_join_codes').select('code').eq('office_id', officeId).maybeSingle());
      return r ? r.code : '';
    },
    regenCode: (officeId) => rpc('regenerate_join_code', { p_office: officeId }),
    roster: (officeId) => rpc('office_members', { p_office: officeId || null }),
    names: (officeId) => rpc('office_people_names', { p_office: officeId || null }),
    remove: (id) => rpc('remove_member', { p_member: id }),
    zoneMembers: (centerId) => rpc('zone_members_summary', { p_center: centerId || null }),
    directorCheckIn: () => rpc('director_check_in'),
    applyDirector: () => rpc('apply_director'),
    reviewApplication: (id, approve) => rpc('review_director_application', { p_user: id, p_approve: !!approve }),
    async applications() {
      return rows(await sb.from('profiles')
        .select('id,full_name,email,phone,rank,sponsor_name,center_id,member_office_id,upgrade_at')
        .eq('role', 'member').eq('upgrade_status', 'pending').order('upgrade_at'));
    },
    async directorCheckins(thu) {
      return rows(await sb.from('director_checkins').select('user_id,scanned_at,late,profiles(full_name,email)').eq('week_start', thu));
    },
    async zoneCheckins(thu) {
      return rows(await sb.from('scans')
        .select('scanned_at,late,distributors(full_name,status),events!inner(center_id,week_start,type)')
        .eq('status', 'accepted').eq('events.week_start', thu).eq('events.type', 'SM').order('scanned_at'));
    },
    people: {
      async list() { return rows(await sb.from('member_people').select('*').order('created_at', { ascending: false })); },
      async add(p) {
        return guard(await sb.from('member_people').insert({
          owner_id: store.me.id, name: p.name, phone: p.phone || '', stage: p.stage || 'New number', note: p.note || ''
        }).select().single());
      },
      async stage(id, stage) {
        return guard(await sb.from('member_people').update({ stage, updated_at: new Date().toISOString() })
          .eq('id', id).select().single());
      },
      async remove(id) { guard(await sb.from('member_people').delete().eq('id', id)); }
    }
  };

  window.API = {
    sb, ready: !!sb, store, auth, loadMe, loadLookups,
    isAdmin, isSuper, isOffice, isMember, member, centerById, officeById, officesOf,
    centers, offices, distributors, reports, events, scans, niches,
    people, settings, join, watch, unwatch,
    feature, activity, goals, announce, issues, feedback, push
  };
})();

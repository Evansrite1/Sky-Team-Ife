/* =====================================================================
   Sky Team Ife — everything that talks to Supabase.
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
    sub: null,         // this office's subscription row
    locked: false,     // trial is over and nothing has been paid
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
      return guard(await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: CFG.appUrl + '/#/reset'
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
    if (p.office_id) {
      store.me.office = guard(await sb.from('offices').select('*').eq('id', p.office_id).maybeSingle());
    }
    if (p.center_id) {
      store.me.center = guard(await sb.from('centers').select('*').eq('id', p.center_id).maybeSingle());
    }
    return store.me;
  }

  const isAdmin = () => !!store.me && (store.me.role === 'super_admin' || store.me.role === 'platform_admin');
  const isSuper = () => !!store.me && store.me.role === 'super_admin';
  const isOffice = () => !!store.me && store.me.role === 'office';

  /* ------------------------------------------------------- lookup sets */
  async function loadLookups() {
    const [c, o, n, s] = await Promise.all([
      sb.from('centers').select('*').order('name'),
      sb.from('offices').select('*').order('name'),
      sb.from('niches').select('*').order('name'),
      sb.from('app_settings').select('*')
    ]);
    store.centers = rows(c);
    store.offices = rows(o);
    store.niches = rows(n).map(r => r.name);
    store.settings = {};
    rows(s).forEach(r => { store.settings[r.key] = r.value; });

    /* Is this office locked out? Worked out once per boot so the router
       does not have to ask on every page change. */
    store.sub = null;
    store.locked = false;
    if (isOffice()) {
      store.sub = await billing.mine().catch(() => null);
      store.locked = billing.locked(store.sub);
    }

    /* Counts the sidebar carries, so an admin can see the totals and the
       approval queue without opening anything. */
    store.waiting = 0;
    store.leaders = 0;
    if (isAdmin()) {
      const [w, l] = await Promise.all([
        isSuper()
          ? sb.from('profiles').select('id', { count: 'exact', head: true }).eq('req_status', 'pending')
          : Promise.resolve({ count: 0 }),
        sb.from('profiles').select('id', { count: 'exact', head: true })
          .in('role', ['super_admin', 'platform_admin'])
      ]);
      store.waiting = w.count || 0;
      store.leaders = l.count || 0;
    }
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
    async remove(id) { guard(await sb.from('distributors').update({ active: false }).eq('id', id)); }
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

  /* ----------------------------------------------------------- events */
  const events = {
    async ensureWeek(week) {
      const { error } = await sb.rpc('ensure_week_events', { p_week: week });
      if (error) console.warn('ensure_week_events:', error.message);
    },
    async list(filter) {
      filter = filter || {};
      let q = sb.from('events').select('*');
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
    /* Everyone who has signed up and is still waiting — whether they have
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

  /* ---------------------------------------------------------- billing */
  const billing = {
    async subscriptions() { return rows(await sb.from('subscriptions').select('*')); },
    async mine() {
      if (!store.me || !store.me.office_id) return null;
      return guard(await sb.from('subscriptions').select('*')
        .eq('office_id', store.me.office_id).maybeSingle());
    },
    /* Days left before the office is locked out. Negative once it is. */
    daysLeft(sub) {
      if (!sub) return null;
      const end = sub.status === 'trial' ? sub.trial_ends : sub.next_charge;
      if (!end) return null;
      return Math.ceil((new Date(end + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 86400000);
    },
    locked(sub) {
      if (!CFG.billingEnabled) return false;
      const d = billing.daysLeft(sub);
      return d === null || d < 0 || ['past_due', 'cancelled'].indexOf(sub.status) > -1 && d < 0;
    },
    /* Asks the Edge Function to start a Paystack checkout. The amount is
       decided server side; nothing here can influence what is charged. */
    async startCheckout() {
      const { data: s } = await sb.auth.getSession();
      const token = s && s.session ? s.session.access_token : null;
      if (!token) throw new Error('Sign in again, then try once more.');
      const res = await fetch(CFG.supabaseUrl.replace('.supabase.co', '.functions.supabase.co') + '/paystack-init', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: '{}'
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.url) throw new Error(out.error || 'Could not reach Paystack.');
      return out.url;
    },
    async payments(officeId) {
      let q = sb.from('payments').select('*').order('paid_at', { ascending: false });
      if (officeId) q = q.eq('office_id', officeId);
      return rows(await q);
    }
  };

  /* ------------------------------------------------------------- join */
  const join = {
    /* What a new account asks for. Nothing is created here — the row just
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

  window.API = {
    sb, ready: !!sb, store, auth, loadMe, loadLookups,
    isAdmin, isSuper, isOffice, centerById, officeById, officesOf,
    centers, offices, distributors, reports, events, scans, niches,
    people, settings, billing, join
  };
})();

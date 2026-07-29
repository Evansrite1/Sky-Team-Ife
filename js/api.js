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
    me: null,          // profile row + office + center
    centers: [],
    offices: [],
    niches: [],
    settings: {}
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
    return store;
  }

  const centerById = id => store.centers.find(c => c.id === id) || null;
  const officeById = id => store.offices.find(o => o.id === id) || null;
  const officesOf = cid => store.offices.filter(o => o.center_id === cid);

  /* ---------------------------------------------------------- centers */
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
    async remove(id) {
      guard(await sb.from('offices').delete().eq('id', id));
      store.offices = store.offices.filter(o => o.id !== id);
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
    async pending() {
      return rows(await sb.from('profiles').select('*').eq('role', 'pending').order('created_at'));
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
    async payments(officeId) {
      let q = sb.from('payments').select('*').order('paid_at', { ascending: false });
      if (officeId) q = q.eq('office_id', officeId);
      return rows(await q);
    }
  };

  /* ------------------------------------------------------------- join */
  const join = {
    async office(code, payload) {
      const { data, error } = await sb.rpc('claim_office', {
        p_code: code,
        p_office_name: payload.name,
        p_office_code: payload.officeCode,
        p_center_id: payload.centerId,
        p_manager: payload.manager,
        p_area: payload.area,
        p_address: payload.address
      });
      if (error) throw new Error(error.message);
      return data;
    },
    async admin(code, fullName) {
      const { error } = await sb.rpc('claim_admin', { p_code: code, p_full_name: fullName });
      if (error) throw new Error(error.message);
    },
    /* The sign-up screen needs the centers before the user has a role. */
    async publicCenters() {
      return rows(await sb.from('centers').select('id,name,area').order('name'));
    }
  };

  window.API = {
    sb, ready: !!sb, store, auth, loadMe, loadLookups,
    isAdmin, isSuper, isOffice, centerById, officeById, officesOf,
    centers, offices, distributors, reports, events, scans, niches,
    people, settings, billing, join
  };
})();

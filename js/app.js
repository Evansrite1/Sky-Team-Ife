/* =====================================================================
   Sky Team Ife — boot, auth, router and every action the app responds to.
   ===================================================================== */
(function () {
  'use strict';

  const U = window.UI, A = window.API, V = window.VIEWS;
  const { $, esc, ico, toast, modal, closeModal, busy, val } = U;

  const state = {
    page: 'dashboard',
    week: U.weekStart(),
    month: U.monthKey(U.weekStart()),
    center: null,
    chartType: 'bar',
    q: '',
    form: {},
    booted: false
  };
  window.APP = { state, go, refresh };

  /* ------------------------------------------------------------- nav */
  const NAV = {
    super_admin: [
      { grp: 'Overview' },
      { p: 'dashboard', l: 'Dashboard', i: 'grid' },
      { p: 'evaluation', l: 'Evaluation list', i: 'clipboard' },
      { p: 'monthly', l: 'Monthly summary', i: 'calendar' },
      { grp: 'Performance' },
      { p: 'centers', l: 'Centers', i: 'layers', c: () => A.store.centers.length },
      { p: 'offices', l: 'Offices', i: 'building', c: () => A.store.offices.length },
      { p: 'rankings', l: 'Office rankings', i: 'crown' },
      { p: 'reports', l: 'Weekly reports', i: 'file' },
      { grp: 'Attendance' },
      { p: 'trainings', l: 'Trainings', i: 'qr' },
      { p: 'events', l: 'Center events', i: 'star' },
      { grp: 'People & admin' },
      { p: 'distributors', l: 'Distributors', i: 'users' },
      { p: 'subscriptions', l: 'Subscriptions', i: 'card' },
      { p: 'admin', l: 'Centers & admins', i: 'shield' },
      { p: 'account', l: 'Account', i: 'lock' }
    ],
    platform_admin: [
      { grp: 'Overview' },
      { p: 'dashboard', l: 'Dashboard', i: 'grid' },
      { p: 'evaluation', l: 'Evaluation list', i: 'clipboard' },
      { p: 'monthly', l: 'Monthly summary', i: 'calendar' },
      { grp: 'Performance' },
      { p: 'centers', l: 'Centers', i: 'layers', c: () => A.store.centers.length },
      { p: 'offices', l: 'Offices', i: 'building', c: () => A.store.offices.length },
      { p: 'rankings', l: 'Office rankings', i: 'crown' },
      { p: 'reports', l: 'Weekly reports', i: 'file' },
      { grp: 'Attendance' },
      { p: 'trainings', l: 'Trainings', i: 'qr' },
      { p: 'events', l: 'Center events', i: 'star' },
      { grp: 'People' },
      { p: 'distributors', l: 'Distributors', i: 'users' },
      { p: 'account', l: 'Account', i: 'lock' }
    ],
    office: [
      { grp: 'This week' },
      { p: 'dashboard', l: 'Dashboard', i: 'grid' },
      { p: 'reports', l: 'Weekly report', i: 'clipboard' },
      { grp: 'Attendance' },
      { p: 'trainings', l: 'Trainings', i: 'qr' },
      { p: 'events', l: 'Center events', i: 'star' },
      { grp: 'Your office' },
      { p: 'distributors', l: 'Distributors', i: 'users' },
      { p: 'center', l: 'Center performance', i: 'layers' },
      { p: 'monthly', l: 'Monthly summary', i: 'calendar' },
      { p: 'subscriptions', l: 'Subscription', i: 'card' },
      { p: 'account', l: 'Account', i: 'lock' }
    ]
  };
  const ALLOWED = {
    super_admin: null,   // everything
    platform_admin: ['dashboard', 'evaluation', 'monthly', 'centers', 'offices', 'rankings', 'reports', 'trainings', 'events', 'distributors', 'account'],
    office: ['dashboard', 'reports', 'trainings', 'events', 'distributors', 'center', 'monthly', 'subscriptions', 'account']
  };

  function go(hash) { location.hash = hash; }
  const brand = () => (A.store.settings.organisation || window.CONFIG.organisation || 'Sky Team Ife');

  /* ============================== CHROME ============================= */
  function sidebar(active) {
    const me = A.store.me;
    const nav = NAV[me.role] || [];
    return '<aside class="sb"><div class="sb-top"><div class="brand">'
      + '<span class="brand-mk">' + esc(brand()[0]) + '</span>' + esc(brand()) + '</div></div>'
      + '<nav class="sb-nav">' + nav.map(n => n.grp
        ? '<div class="sb-grp">' + esc(n.grp) + '</div>'
        : '<a class="sb-a ' + (active === n.p ? 'on' : '') + '" href="#/' + n.p + '">' + ico(n.i, 17)
        + '<span>' + esc(n.l) + '</span>'
        + (n.c ? '<span class="cnt">' + n.c() + '</span>' : '') + '</a>').join('') + '</nav>'
      + '<div class="sb-btm"><div class="sb-user"><div class="av">' + esc(U.initials(me.full_name || me.email)) + '</div>'
      + '<div><div class="sb-user-nm">' + esc(me.full_name || 'Signed in') + '</div>'
      + '<div class="sb-user-em">' + esc(me.email) + '</div></div></div>'
      + '<button class="sb-out" data-act="signout">' + ico('out', 16) + 'Sign out</button></div></aside>';
  }

  function topbar(v) {
    const picker = v.picker === 'month'
      ? '<div class="wk"><span class="wk-l">Month</span><select data-act="month">' + monthOptions() + '</select></div>'
      : v.picker === 'week'
        ? '<div class="wk"><span class="wk-l">Week</span><select data-act="week">' + weekOptions() + '</select></div>' : '';
    return '<header class="tb"><button class="burger" data-act="nav" aria-label="Menu">' + ico('menu', 18) + '</button>'
      + '<div>' + (v.crumbs ? '<div class="crumb">' + v.crumbs + '</div>' : '')
      + '<div class="tb-t">' + esc(v.title) + '</div></div>'
      + '<div class="tb-r">' + picker + '</div></header>';
  }
  const weekOptions = () => U.recentWeeks(window.CONFIG.weeksShown || 12)
    .map(w => '<option value="' + w + '" ' + (w === state.week ? 'selected' : '') + '>'
      + esc(U.weekLabel(w)) + (U.weekClosed(w) ? '' : ' (open)') + '</option>').join('');
  const monthOptions = () => U.recentMonths(12)
    .map(m => '<option value="' + m + '" ' + (m === state.month ? 'selected' : '') + '>'
      + esc(U.monthLabel(m)) + '</option>').join('');

  /* ============================== ROUTER ============================ */
  let routing = false;
  async function route() {
    if (!state.booted) return;
    closeModal();
    document.body.classList.remove('nav-open');
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const me = A.store.me;

    if (!me) return renderAuth(parts[0] || 'login');
    if (me.role === 'pending') return renderOnboard();

    let page = parts[0] || 'dashboard';
    const id = parts[1];
    const allowed = ALLOWED[me.role];
    if (!V[page] || (allowed && allowed.indexOf(page) === -1)) { go('#/dashboard'); return; }
    state.page = page;

    if (routing) return;
    routing = true;
    $('#root').innerHTML = '<div class="shell">' + sidebar(page) + '<div class="scrim" data-act="nav"></div>'
      + '<main class="main"><div class="loading"><div class="spinner"></div>'
      + '<div class="card-s">Loading…</div></div></main></div>';
    try {
      const v = await V[page](id);
      $('#root').innerHTML = '<div class="shell">' + sidebar(page) + '<div class="scrim" data-act="nav"></div>'
        + '<main class="main">' + topbar(v) + '<div class="page enter">' + v.html + '</div></main></div>';
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      $('#root').innerHTML = '<div class="shell">' + sidebar(page) + '<main class="main">'
        + topbar({ title: 'Something went wrong' }) + '<div class="page">'
        + U.note('err', 'alert', '<b>' + esc(e.message || 'The database refused that request.') + '</b>'
          + '<div style="margin-top:8px">If this is the first run, check that supabase/schema.sql has been run in your Supabase project.</div>')
        + '<div class="row" style="margin-top:16px"><button class="btn btn-p" data-act="reload">'
        + ico('refresh', 15) + 'Try again</button></div></div></main></div>';
    }
    routing = false;
  }
  async function refresh() { await route(); }

  /* =============================== AUTH ============================= */
  const art = (h, p, steps) => '<div class="auth-r"><div class="blob blob-1"></div><div class="blob blob-2"></div>'
    + '<div class="auth-art auth-art-inner"><h2>' + h + '</h2><p>' + p + '</p>'
    + '<div class="auth-steps">' + steps.map((s, i) => '<div class="auth-step"><i>' + (i + 1) + '</i><div>' + s + '</div></div>').join('')
    + '</div></div></div>';

  const authShell = (inner, right) => '<div class="auth"><div class="auth-l"><div class="auth-card">'
    + '<div class="auth-brand"><span class="brand-mk">' + esc(brand()[0]) + '</span>' + esc(brand()) + '</div>'
    + inner + '</div></div>' + right + '</div>';

  const RIGHT = art(
    'Every office, every week, <span class="hl">on one line</span>.',
    'Trainings scan themselves in. Reports land before Tuesday closes. The center evaluates on Wednesday at 2:45pm, and month after month it builds the history the forecast will run on.',
    ['The Super Admin creates a center and adds Platform Admins.',
      'An office signs up with the in-house code and picks its center.',
      'Distributors scan in at the Wednesday and Friday trainings.',
      'One report a week, read at the Wednesday evaluation.']);

  function renderAuth(which) {
    const r = $('#root');
    if (which === 'signup') {
      r.innerHTML = authShell(
        '<h1 class="auth-h">Create your account</h1>'
        + '<p class="auth-s">Offices and admins both start here. You pick what you are joining as on the next step.</p>'
        + '<form id="signup-form">'
        + '<div class="field"><label for="su-name">Full name</label>'
        + '<input class="input" id="su-name" required autocomplete="name" placeholder="Your name"></div>'
        + '<div class="field"><label for="su-email">Email</label>'
        + '<input class="input" id="su-email" type="email" required autocomplete="email" placeholder="you@example.com"></div>'
        + '<div class="field"><label for="su-pass">Password</label>'
        + '<input class="input" id="su-pass" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></div>'
        + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-signup">Create account</button>'
        + '</form>'
        + '<div class="auth-alt">Already have one? <a href="#/login">Sign in</a></div>', RIGHT);
      return;
    }
    if (which === 'forgot') {
      r.innerHTML = authShell(
        '<h1 class="auth-h">Reset your password</h1>'
        + '<p class="auth-s">We send a link to your email. Open it on this device and you can set a new password.</p>'
        + '<form id="forgot-form">'
        + '<div class="field"><label for="fg-email">Email</label>'
        + '<input class="input" id="fg-email" type="email" required autocomplete="email" placeholder="you@example.com"></div>'
        + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-forgot">Send the link</button>'
        + '</form><div class="auth-alt"><a href="#/login">Back to sign in</a></div>', RIGHT);
      return;
    }
    if (which === 'reset') {
      r.innerHTML = authShell(
        '<h1 class="auth-h">Set a new password</h1>'
        + '<p class="auth-s">Choose something at least eight characters long.</p>'
        + '<form id="reset-form">'
        + '<div class="field"><label for="rs-pass">New password</label>'
        + '<input class="input" id="rs-pass" type="password" required minlength="8" autocomplete="new-password"></div>'
        + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-reset">Save password</button>'
        + '</form>', RIGHT);
      return;
    }
    r.innerHTML = authShell(
      '<h1 class="auth-h">Sign in</h1>'
      + '<p class="auth-s">Offices, Platform Admins and the Super Admin all sign in here.</p>'
      + '<form id="login-form">'
      + '<div class="field"><label for="li-email">Email</label>'
      + '<input class="input" id="li-email" type="email" required autocomplete="email" placeholder="you@example.com"></div>'
      + '<div class="field"><label for="li-pass">Password</label>'
      + '<input class="input" id="li-pass" type="password" required autocomplete="current-password" placeholder="Your password"></div>'
      + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-login">Sign in</button>'
      + '</form>'
      + '<div class="auth-alt"><a href="#/forgot">Forgot your password?</a></div>'
      + '<div class="divider">New here</div>'
      + '<a class="btn btn-lg btn-block" href="#/signup">Create an account</a>', RIGHT);
  }

  /* --------------------------------------------------- onboarding */
  async function renderOnboard() {
    const centers = await A.join.publicCenters();
    $('#root').innerHTML = authShell(
      '<h1 class="auth-h">One more step</h1>'
      + '<p class="auth-s">Tell us what you are joining as. Your center leader has the codes.</p>'
      + '<div class="seg" style="width:100%;margin-bottom:18px">'
      + '<button style="flex:1" class="on" data-act="ob-tab" data-v="office">An office</button>'
      + '<button style="flex:1" data-act="ob-tab" data-v="admin">A platform admin</button></div>'

      + '<form id="ob-office">'
      + '<div class="field"><label for="ob-code">Office join code</label>'
      + '<input class="input mono" id="ob-code" required placeholder="SKY-OFFICE-0000"></div>'
      + '<div class="field"><label for="ob-center">Which center?</label>'
      + '<select class="select" id="ob-center" required>'
      + (centers.length ? centers.map(c => '<option value="' + c.id + '">' + esc(c.name) + ' · ' + esc(c.area) + '</option>').join('')
        : '<option value="">No centers exist yet</option>') + '</select></div>'
      + '<div class="two"><div class="field"><label for="ob-name">Office name</label>'
      + '<input class="input" id="ob-name" required placeholder="Lagere Office"></div>'
      + '<div class="field"><label for="ob-ocode">Office code</label>'
      + '<input class="input mono" id="ob-ocode" required placeholder="LG-01"></div></div>'
      + '<div class="field"><label for="ob-manager">Manager</label>'
      + '<input class="input" id="ob-manager" required placeholder="Who runs this office"></div>'
      + '<div class="two"><div class="field"><label for="ob-area">Area</label>'
      + '<input class="input" id="ob-area" placeholder="Lagere"></div>'
      + '<div class="field"><label for="ob-address">Address</label>'
      + '<input class="input" id="ob-address" placeholder="14 Ondo Road"></div></div>'
      + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-join-office">Join as an office</button>'
      + '</form>'

      + '<form id="ob-admin" class="hide">'
      + '<div class="field"><label for="ob-acode">Admin join code</label>'
      + '<input class="input mono" id="ob-acode" required placeholder="SKY-ADMIN-0000"></div>'
      + '<div class="field"><label for="ob-aname">Full name</label>'
      + '<input class="input" id="ob-aname" placeholder="Your name"></div>'
      + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-join-admin">Join as a platform admin</button>'
      + '</form>'

      + '<div class="auth-alt"><a href="#" data-act="signout">Sign out</a></div>', RIGHT);
  }

  /* ============================= SETUP GATE ========================= */
  function renderSetup() {
    $('#root').innerHTML = '<div class="scan-wrap"><div class="card scan-card">'
      + '<div class="card-h"><div><div class="card-t">Almost there</div>'
      + '<div class="card-s">' + esc(brand()) + ' is deployed, but it has not been pointed at a database yet.</div></div></div>'
      + U.note('gold', 'key', 'Open <span class="mono">config.js</span> and paste your Supabase <b>Project URL</b> and '
        + '<b>anon public key</b> from Project Settings → API. Then run <span class="mono">supabase/schema.sql</span> '
        + 'in the Supabase SQL editor.')
      + '<p class="card-s" style="margin-top:14px">Neither value is a secret — the anon key is meant to be public, and row level '
      + 'security is what protects the data. Never paste the service_role key here.</p></div>'
      + '<div class="scan-foot">' + esc(brand()) + '</div></div>';
  }

  /* ============================== ACTIONS =========================== */
  const ACT = {};

  /* --- auth ------------------------------------------------------- */
  ACT['do-login'] = async (el, e) => {
    e.preventDefault();
    const btn = $('[data-act="do-login"]');
    busy(btn, true, 'Signing in…');
    try {
      await A.auth.signIn(val('#li-email'), $('#li-pass').value);
      await boot(true);
      go('#/dashboard');
    } catch (err) {
      busy(btn, false);
      toast(err.message === 'Invalid login credentials'
        ? 'That email and password do not match an account.' : err.message, 'no');
    }
  };

  ACT['do-signup'] = async (el, e) => {
    e.preventDefault();
    const btn = $('[data-act="do-signup"]');
    busy(btn, true, 'Creating…');
    try {
      const out = await A.auth.signUp(val('#su-email'), $('#su-pass').value, val('#su-name'));
      if (out && out.session) { await boot(true); go('#/dashboard'); return; }
      busy(btn, false);
      modal('Check your email', '',
        '<p style="font-size:14px;line-height:1.6;color:var(--muted)">We sent a confirmation link to <b>'
        + esc(val('#su-email')) + '</b>. Open it, then come back and sign in.</p>',
        '<a class="btn btn-a" href="#/login" data-act="modal-close">Back to sign in</a>');
    } catch (err) { busy(btn, false); toast(err.message, 'no'); }
  };

  ACT['do-forgot'] = async (el, e) => {
    e.preventDefault();
    const btn = $('[data-act="do-forgot"]');
    busy(btn, true, 'Sending…');
    try {
      await A.auth.resetPassword(val('#fg-email'));
      busy(btn, false);
      toast('If that address has an account, the link is on its way.');
    } catch (err) { busy(btn, false); toast(err.message, 'no'); }
  };

  ACT['do-reset'] = async (el, e) => {
    e.preventDefault();
    const btn = $('[data-act="do-reset"]');
    busy(btn, true, 'Saving…');
    try {
      await A.auth.updatePassword($('#rs-pass').value);
      await boot(true);
      toast('Password changed.');
      go('#/dashboard');
    } catch (err) { busy(btn, false); toast(err.message, 'no'); }
  };

  ACT['signout'] = async () => { await A.auth.signOut(); state.booted = true; go('#/login'); await route(); };

  ACT['ob-tab'] = (el) => {
    const v = el.dataset.v;
    U.$$('[data-act="ob-tab"]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    $('#ob-office').classList.toggle('hide', v !== 'office');
    $('#ob-admin').classList.toggle('hide', v !== 'admin');
  };

  ACT['do-join-office'] = async (el, e) => {
    e.preventDefault();
    const btn = $('[data-act="do-join-office"]');
    busy(btn, true, 'Joining…');
    try {
      await A.join.office(val('#ob-code'), {
        name: val('#ob-name'), officeCode: val('#ob-ocode'), centerId: val('#ob-center'),
        manager: val('#ob-manager'), area: val('#ob-area'), address: val('#ob-address')
      });
      await boot(true);
      toast('Welcome. Your office is set up.');
      go('#/dashboard');
    } catch (err) { busy(btn, false); toast(err.message, 'no'); }
  };

  ACT['do-join-admin'] = async (el, e) => {
    e.preventDefault();
    const btn = $('[data-act="do-join-admin"]');
    busy(btn, true, 'Joining…');
    try {
      await A.join.admin(val('#ob-acode'), val('#ob-aname'));
      await boot(true);
      toast('You are in.');
      go('#/dashboard');
    } catch (err) { busy(btn, false); toast(err.message, 'no'); }
  };

  /* --- chrome ------------------------------------------------------ */
  ACT['nav'] = () => document.body.classList.toggle('nav-open');
  ACT['modal-close'] = () => closeModal();
  ACT['modal-bg'] = (el, e) => { if (e.target === el) closeModal(); };
  ACT['reload'] = () => route();
  ACT['chart-type'] = (el) => { state.chartType = el.dataset.v; route(); };
  ACT['copy'] = (el) => {
    navigator.clipboard.writeText(el.dataset.v)
      .then(() => toast('Link copied.'))
      .catch(() => toast('Could not copy — select the link instead.', 'no'));
  };

  /* --- centers ----------------------------------------------------- */
  const centerForm = (c) => '<div class="field"><label for="c-name">Center name</label>'
    + '<input class="input" id="c-name" value="' + esc(c.name || '') + '" placeholder="Lagere Center"></div>'
    + '<div class="two"><div class="field"><label for="c-area">Area</label>'
    + '<input class="input" id="c-area" value="' + esc(c.area || '') + '" placeholder="Lagere"></div>'
    + '<div class="field"><label for="c-address">Address</label>'
    + '<input class="input" id="c-address" value="' + esc(c.address || '') + '" placeholder="14 Ondo Road, Ile-Ife"></div></div>'
    + '<div class="two"><div class="field"><label for="c-leader">Leader</label>'
    + '<input class="input" id="c-leader" value="' + esc(c.leader_name || '') + '"></div>'
    + '<div class="field"><label for="c-assistant">Assistant</label>'
    + '<input class="input" id="c-assistant" value="' + esc(c.assistant_name || '') + '"></div></div>';

  ACT['center-new'] = () => modal('New center', 'Offices join a center, and the center evaluates them every Wednesday.',
    centerForm({}), '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
    + '<button class="btn btn-a btn-pop" data-act="center-save">Create center</button>');

  ACT['center-edit'] = (el) => {
    const c = A.centerById(el.dataset.id) || {};
    modal('Edit center', esc(c.name || ''), centerForm(c),
      '<button class="btn btn-d left" data-act="center-del" data-id="' + c.id + '">Delete</button>'
      + '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
      + '<button class="btn btn-a btn-pop" data-act="center-save" data-id="' + c.id + '">Save</button>');
  };

  ACT['center-save'] = async (el) => {
    const row = {
      name: val('#c-name'), area: val('#c-area'), address: val('#c-address'),
      leader_name: val('#c-leader'), assistant_name: val('#c-assistant')
    };
    if (!row.name || !row.area) return toast('A center needs a name and an area.', 'no');
    busy(el, true, 'Saving…');
    try {
      if (el.dataset.id) await A.centers.update(el.dataset.id, row);
      else await A.centers.create(row);
      closeModal(); toast('Center saved.'); route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['center-del'] = (el) => {
    state.pendingDelete = el.dataset.id;
    U.confirmDialog('Delete this center?',
      'You cannot delete a center that still has offices in it. This cannot be undone.',
      'Delete center', 'center-del-yes', true);
  };

  ACT['center-del-yes'] = async (el) => {
    busy(el, true, 'Deleting…');
    try { await A.centers.remove(state.pendingDelete); closeModal(); toast('Center deleted.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- distributors ------------------------------------------------ */
  const distForm = (d) => '<div class="field"><label for="d-name">Full name</label>'
    + '<input class="input" id="d-name" value="' + esc(d.full_name || '') + '" placeholder="Their name"></div>'
    + '<div class="two"><div class="field"><label for="d-status">Status</label>'
    + '<select class="select" id="d-status">' + V.helpers.STATUSES.map(s =>
      '<option ' + (d.status === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></div>'
    + '<div class="field"><label for="d-phone">Phone</label>'
    + '<input class="input" id="d-phone" value="' + esc(d.phone || '') + '" placeholder="080..."></div></div>'
    + U.note('info', 'info', 'Senior Manager and above may scan into the Wednesday training.');

  ACT['dist-new'] = () => modal('Add a distributor', '', distForm({}),
    '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
    + '<button class="btn btn-a btn-pop" data-act="dist-save">Add</button>');

  ACT['dist-edit'] = async (el) => {
    const list = await A.distributors.list({ office: A.store.me.office_id });
    const d = list.find(x => x.id === el.dataset.id) || {};
    modal('Edit distributor', esc(d.full_name || ''), distForm(d),
      '<button class="btn btn-d left" data-act="dist-del" data-id="' + d.id + '">Remove</button>'
      + '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
      + '<button class="btn btn-a btn-pop" data-act="dist-save" data-id="' + d.id + '">Save</button>');
  };

  ACT['dist-save'] = async (el) => {
    const row = { full_name: val('#d-name'), status: val('#d-status'), phone: val('#d-phone') };
    if (!row.full_name) return toast('A distributor needs a name.', 'no');
    busy(el, true, 'Saving…');
    try {
      if (el.dataset.id) await A.distributors.update(el.dataset.id, row);
      else await A.distributors.create(Object.assign(row, {
        office_id: A.store.me.office_id, center_id: A.store.me.center_id
      }));
      closeModal(); toast('Saved.'); route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['dist-del'] = async (el) => {
    busy(el, true, 'Removing…');
    try { await A.distributors.remove(el.dataset.id); closeModal(); toast('Removed.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- reports ----------------------------------------------------- */
  ACT['niche-del'] = (el) => {
    state.form.niches = (state.form.niches || []).filter(n => n !== el.dataset.v);
    $('#niche-chips').innerHTML = V.helpers.nicheChips(state.form.niches);
  };
  ACT['new-niche-del'] = (el) => {
    state.form.newNiches = (state.form.newNiches || []).filter(n => n !== el.dataset.v);
    paintNew();
  };
  const paintNew = () => {
    const list = state.form.newNiches || [];
    $('#new-chips').innerHTML = list.length ? list.map(n => '<span class="chip new">' + esc(n)
      + '<button type="button" data-act="new-niche-del" data-v="' + esc(n) + '">' + ico('x', 12) + '</button></span>').join('')
      : '<span class="sub">None marked.</span>';
  };
  ACT['new-niche-add'] = async () => {
    const v = val('#new-niche-input');
    if (!v) return;
    state.form.newNiches = state.form.newNiches || [];
    if (!state.form.newNiches.includes(v)) state.form.newNiches.push(v);
    state.form.niches = state.form.niches || [];
    if (!state.form.niches.includes(v)) state.form.niches.push(v);
    $('#new-niche-input').value = '';
    $('#niche-chips').innerHTML = V.helpers.nicheChips(state.form.niches);
    paintNew();
  };
  ACT['niche-pick'] = (el) => {
    const v = el.dataset.v;
    state.form.niches = state.form.niches || [];
    if (!state.form.niches.includes(v)) state.form.niches.push(v);
    $('#niche-input').value = '';
    $('#niche-menu').innerHTML = '';
    $('#niche-chips').innerHTML = V.helpers.nicheChips(state.form.niches);
  };

  ACT['report-save'] = async (el, e) => {
    e.preventDefault();
    const orders = Number(val('#f-orders')), amount = Number(val('#f-amount'));
    if (!isFinite(orders) || orders < 0 || val('#f-orders') === '') return toast('How many orders were written?', 'no');
    if (!isFinite(amount) || amount < 0 || val('#f-amount') === '') return toast('What did those orders come to?', 'no');
    const niches = state.form.niches || [];
    if (!niches.length) return toast('Pick at least one niche the orders came from.', 'no');

    busy(el, true, 'Filing…');
    try {
      for (const n of niches) await A.niches.add(n);
      await A.reports.save({
        office_id: A.store.me.office_id,
        center_id: A.store.me.center_id,
        week_start: state.week,
        orders: Math.round(orders),
        amount: amount,
        niches: niches,
        new_niches: state.form.newNiches || [],
        office_size: Number(val('#f-size')) || 0,
        total_office: Number(val('#f-total')) || 0,
        issues: val('#f-issues'),
        submitted_by: A.store.me.id,
        submitted_at: new Date().toISOString()
      });
      state.form = {};
      toast('Report filed. It will be read at the evaluation.');
      route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- events ------------------------------------------------------ */
  ACT['event-new'] = () => {
    const centers = A.isOffice() ? A.store.centers.filter(c => c.id === A.store.me.center_id) : A.store.centers;
    modal('New center event', 'Anything outside the two weekly trainings.',
      '<div class="field"><label for="e-name">What is it called?</label>'
      + '<input class="input" id="e-name" placeholder="Cheque Rally"></div>'
      + '<div class="field"><label for="e-center">Center</label><select class="select" id="e-center">'
      + centers.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select></div>'
      + '<div class="two"><div class="field"><label for="e-date">Date</label>'
      + '<input class="input" id="e-date" type="date" value="' + U.iso(new Date()) + '"></div>'
      + '<div class="field"><label for="e-time">Time</label>'
      + '<input class="input" id="e-time" value="2:45pm"></div></div>'
      + '<div class="field"><label for="e-elig">Who may scan in?</label><select class="select" id="e-elig">'
      + '<option value="all">All distributors</option>'
      + '<option value="sm">Senior Managers and above</option></select></div>',
      '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
      + '<button class="btn btn-a btn-pop" data-act="event-save">Create event</button>');
  };

  ACT['event-save'] = async (el) => {
    const name = val('#e-name'), cid = val('#e-center'), date = val('#e-date');
    if (!name) return toast('Give the event a name.', 'no');
    if (!cid) return toast('Pick a center.', 'no');
    busy(el, true, 'Creating…');
    try {
      const code = 'EV-' + String(name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
        + '-' + date.replace(/-/g, '').slice(4) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      await A.events.create({
        center_id: cid, kind: 'event', type: 'CUSTOM', name: name, elig: val('#e-elig'),
        week_start: U.weekStart(date), event_date: date, event_time: val('#e-time') || '2:45pm',
        code: code, status: 'scheduled', created_by: A.store.me.id
      });
      closeModal(); toast('Event created.'); route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['event-open'] = async (el) => {
    busy(el, true, 'Opening…');
    try { await A.events.update(el.dataset.id, { status: 'open' }); toast('Scanning is open.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };
  ACT['event-close'] = async (el) => {
    busy(el, true, 'Closing…');
    try { await A.events.update(el.dataset.id, { status: 'closed' }); toast('Scanning closed.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- admin ------------------------------------------------------- */
  ACT['make-admin'] = async (el) => {
    busy(el, true, 'Promoting…');
    try { await A.people.setRole(el.dataset.id, 'platform_admin'); toast('They are a Platform Admin now.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };
  ACT['drop-admin'] = async (el) => {
    busy(el, true, 'Removing…');
    try { await A.people.setRole(el.dataset.id, 'pending'); toast('Admin access removed.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };
  ACT['codes-save'] = async (el) => {
    busy(el, true, 'Saving…');
    try {
      await A.settings.set('office_join_code', val('#s-office-code'));
      await A.settings.set('admin_join_code', val('#s-admin-code'));
      busy(el, false); toast('Codes saved.');
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- account ----------------------------------------------------- */
  ACT['name-save'] = async (el) => {
    busy(el, true, 'Saving…');
    try {
      await A.sb.from('profiles').update({ full_name: val('#a-name') }).eq('id', A.store.me.id);
      await A.loadMe(); busy(el, false); toast('Saved.'); route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };
  ACT['office-save'] = async (el) => {
    busy(el, true, 'Saving…');
    try {
      await A.offices.update(A.store.me.office_id, {
        name: val('#o-name'), manager_name: val('#o-manager'),
        area: val('#o-area'), address: val('#o-address')
      });
      busy(el, false); toast('Office saved.'); route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };
  ACT['pw-save'] = async (el) => {
    const a = $('#p-new').value, b = $('#p-again').value;
    if (a.length < 8) return toast('Use at least eight characters.', 'no');
    if (a !== b) return toast('The two passwords do not match.', 'no');
    busy(el, true, 'Saving…');
    try { await A.auth.updatePassword(a); busy(el, false); toast('Password changed.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* ========================= EVENT DELEGATION ======================= */
  document.addEventListener('click', (e) => {
    const row = e.target.closest('tr.click');
    const el = e.target.closest('[data-act]');
    if (el) {
      /* A submit button is handled by the submit listener, once. */
      if (el.tagName === 'BUTTON' && el.type === 'submit' && el.form) return;
      const act = el.dataset.act;
      if (ACT[act]) {
        if (el.tagName === 'A' && (!el.getAttribute('href') || el.getAttribute('href') === '#')) e.preventDefault();
        ACT[act](el, e);
        return;
      }
    }
    if (row && row.dataset.href) go(row.dataset.href);
  });

  document.addEventListener('submit', (e) => {
    const btn = e.target.querySelector('button[type="submit"][data-act]');
    if (btn && ACT[btn.dataset.act]) ACT[btn.dataset.act](btn, e);
    else e.preventDefault();
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'week') { state.week = el.value; route(); }
    if (el.dataset.act === 'month') { state.month = el.value; route(); }
    if (el.dataset.act === 'center') { state.center = el.value; route(); }
  });

  let searchTimer = null;
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && el.dataset.act === 'search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.q = el.value; route(); }, 260);
      return;
    }
    if (e.target.id === 'niche-input') paintNicheMenu(e.target.value);
  });

  function paintNicheMenu(q) {
    const menu = $('#niche-menu');
    if (!menu) return;
    q = String(q || '').trim().toLowerCase();
    if (!q) { menu.innerHTML = ''; return; }
    const picked = state.form.niches || [];
    const hits = A.store.niches.filter(n => n.toLowerCase().includes(q) && !picked.includes(n)).slice(0, 8);
    const exact = A.store.niches.some(n => n.toLowerCase() === q);
    menu.innerHTML = '<div class="menu">'
      + hits.map(n => '<button type="button" data-act="niche-pick" data-v="' + esc(n) + '">' + esc(n) + '</button>').join('')
      + (!exact ? '<button type="button" data-act="niche-pick" data-v="' + esc($('#niche-input').value.trim()) + '">'
        + ico('plus', 14) + 'Add “' + esc($('#niche-input').value.trim()) + '” as a new product</button>' : '')
      + (!hits.length && exact ? '<div class="empty-row">Already picked.</div>' : '')
      + '</div>';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  window.addEventListener('hashchange', route);

  /* =============================== BOOT ============================= */
  async function boot(silent) {
    if (!window.CONFIG.ready || !A.ready) { state.booted = true; renderSetup(); return; }
    try {
      const me = await A.loadMe();
      if (me && me.role !== 'pending') await A.loadLookups();
      state.booted = true;
      if (!silent) await route();
    } catch (err) {
      state.booted = true;
      console.error(err);
      $('#root').innerHTML = '<div class="scan-wrap"><div class="card scan-card">'
        + '<div class="card-h"><div><div class="card-t">The database said no</div></div></div>'
        + U.note('err', 'alert', '<b>' + esc(err.message) + '</b><div style="margin-top:8px">'
          + 'This usually means <span class="mono">supabase/schema.sql</span> has not been run yet, or the anon key in '
          + '<span class="mono">config.js</span> belongs to a different project.</div>')
        + '</div></div>';
    }
  }

  A.auth && A.auth.onChange && A.auth.onChange((evt) => {
    if (evt === 'PASSWORD_RECOVERY') go('#/reset');
  });

  boot();
})();

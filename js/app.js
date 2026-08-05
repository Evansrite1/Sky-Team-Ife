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
    booted: false,
    editRequest: false   // a waiting account asked to change what it sent
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
      { p: 'admin', l: 'Centers & leaders', i: 'shield',
        c: () => A.store.leaders || '', alertC: () => A.store.waiting || '' },
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
      + '<span class="brand-mk">' + U.logo(22) + '</span>' + esc(brand()) + '</div></div>'
      + '<nav class="sb-nav">' + nav.map(n => {
        if (n.grp) return '<div class="sb-grp">' + esc(n.grp) + '</div>';
        const cnt = n.c ? n.c() : '';
        const alert = n.alertC ? n.alertC() : '';
        return '<a class="sb-a ' + (active === n.p ? 'on' : '') + '" href="#/' + n.p + '">' + ico(n.i, 17)
          + '<span>' + esc(n.l) + '</span>'
          + (cnt ? '<span class="cnt">' + cnt + '</span>' : '')
          + (alert ? '<span class="cnt cnt-a">' + alert + '</span>' : '') + '</a>';
      }).join('') + '</nav>'
      + '<div class="sb-btm"><div class="sb-user"><div class="av">' + esc(U.initials(me.full_name || me.email)) + '</div>'
      + '<div><div class="sb-user-nm">' + esc(me.full_name || (me.role === 'office' && me.office ? me.office.name : 'Signed in')) + '</div>'
      + '<div class="sb-user-em">' + esc({ super_admin: 'Super Admin', platform_admin: 'Leader', office: 'Office' }[me.role] || '') + '</div></div></div>'
      + '<button class="sb-out" data-act="signout">' + ico('out', 16) + 'Sign out</button></div></aside>';
  }

  /* On a phone the sidebar is the wrong shape entirely. These are the
     four places each role actually goes, plus More for the rest. */
  const TABS = {
    super_admin: [
      { p: 'dashboard', l: 'Home', i: 'grid' },
      { p: 'offices', l: 'Offices', i: 'building' },
      { p: 'rankings', l: 'Ranks', i: 'crown' },
      { p: 'admin', l: 'Approve', i: 'shield', badge: () => A.store.waiting }
    ],
    platform_admin: [
      { p: 'dashboard', l: 'Home', i: 'grid' },
      { p: 'offices', l: 'Offices', i: 'building' },
      { p: 'rankings', l: 'Ranks', i: 'crown' },
      { p: 'trainings', l: 'Sessions', i: 'qr' }
    ],
    office: [
      { p: 'dashboard', l: 'Home', i: 'grid' },
      { p: 'reports', l: 'Report', i: 'clipboard' },
      { p: 'trainings', l: 'Sessions', i: 'qr' },
      { p: 'distributors', l: 'Team', i: 'users' }
    ]
  };

  function tabbar(active) {
    const tabs = TABS[A.store.me.role] || [];
    return '<nav class="tabs">'
      + tabs.map(n => {
        const b = n.badge ? n.badge() : 0;
        return '<a class="tab' + (active === n.p ? ' on' : '') + '" href="#/' + n.p + '">'
          + '<span class="tab-i">' + ico(n.i, 21) + (b ? '<i class="tab-b">' + b + '</i>' : '') + '</span>'
          + '<span class="tab-l">' + esc(n.l) + '</span></a>';
      }).join('')
      + '<button class="tab" data-act="nav"><span class="tab-i">' + ico('menu', 21) + '</span>'
      + '<span class="tab-l">More</span></button></nav>';
  }

  /* Shown once, on a phone, when the browser says the app can be
     installed — and never again after it is dismissed. */
  function installBar() {
    let hidden = false;
    try { hidden = !!localStorage.getItem('sti-install-off'); } catch (e) { /* ignore */ }
    if (hidden || !window.__installPrompt) return '';
    return '<div class="inst"><span class="inst-ic">' + U.logo(20) + '</span>'
      + '<div class="inst-t"><b>Add to your home screen</b>'
      + '<span>Opens full screen, like an app.</span></div>'
      + '<button class="btn btn-sm btn-a" data-act="install">Install</button>'
      + '<button class="inst-x" data-act="install-no" aria-label="Not now">' + ico('x', 16) + '</button></div>';
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
    if (me.role === 'pending') {
      return (me.req_status === 'pending' && !state.editRequest)
        ? renderWaiting() : renderOnboard();
    }

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
        + '<main class="main">' + topbar(v) + '<div class="page enter">' + v.html + '</div></main>'
        + installBar() + tabbar(page) + '</div>';
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
    + '<div class="scene"><div class="cube"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>'
    + '<div class="auth-art auth-art-inner"><h2>' + h + '</h2><p>' + p + '</p>'
    + '<div class="auth-steps">' + steps.map((s, i) => '<div class="auth-step"><i>' + (i + 1) + '</i><div>' + s + '</div></div>').join('')
    + '</div></div></div>';

  const authShell = (inner, right) => '<div class="auth"><div class="auth-l"><div class="auth-card">'
    + '<div class="auth-brand"><span class="brand-mk">' + U.logo(26) + '</span>' + esc(brand()) + '</div>'
    + inner + '</div></div>' + right + '</div>';

  const RIGHT = art(
    'Every office, every week, <span class="hl">on one line</span>.',
    'One place for the week\'s numbers, who turned up, and how each office is doing.',
    ['Say whether you are an office or a leader.',
      'Create your account and fill in your details.',
      'You are approved, and you are in.']);

  /* Which of the two they picked on #/join. Kept for the hop through
     account creation so the details form knows what to ask for. */
  const pick = {
    read() { try { return sessionStorage.getItem('sti-join') || ''; } catch (e) { return ''; } },
    save(k) { try { sessionStorage.setItem('sti-join', k); } catch (e) { /* ignore */ } },
    clear() { try { sessionStorage.removeItem('sti-join'); } catch (e) { /* ignore */ } }
  };
  const KIND_LABEL = { office: 'an office', leader: 'a leader' };

  function renderAuth(which) {
    const r = $('#root');
    /* The fork. Nothing is asked for here but the choice itself — what
       an office has to fill in and what a leader does barely overlap. */
    if (which === 'join') {
      const k = pick.read();
      r.innerHTML = authShell(
        '<h1 class="auth-h">How are you joining?</h1>'
        + '<p class="auth-s">The two ask for different things, so pick first and we will only ask you for yours.</p>'
        + '<div class="pick">'
        + '<button type="button" class="pick-o ' + (k === 'office' ? 'on' : '') + '" data-act="pick" data-v="office">'
        + '<span class="pick-ic">' + ico('building', 19) + '</span><span class="pick-t">An office</span>'
        + '<span class="pick-d">You run an office. You file the weekly report and manage your own distributors.</span></button>'
        + '<button type="button" class="pick-o ' + (k === 'leader' ? 'on' : '') + '" data-act="pick" data-v="leader">'
        + '<span class="pick-ic">' + ico('crown', 19) + '</span><span class="pick-t">A leader or director</span>'
        + '<span class="pick-d">You oversee centers. You see every office and run the Wednesday evaluation.</span></button>'
        + '</div>'
        + '<div class="auth-alt">Already have an account? <a href="#/login">Sign in</a></div>', RIGHT);
      return;
    }
    if (which === 'signup') {
      const k = pick.read();
      if (!k) { go('#/join'); return; }
      r.innerHTML = authShell(
        '<h1 class="auth-h">Create your account</h1>'
        + '<p class="auth-s">Joining as ' + KIND_LABEL[k] + '. '
        + '<a href="#/join" style="text-decoration:underline">Not right?</a><br>'
        + 'An email and a password to start — your details come next.</p>'
        + (k === 'office'
          ? U.note('info', 'info', 'Use your <b>office email address</b> if you have one. This account belongs '
            + 'to the office rather than to you, so it should stay with the office if the team leader changes.')
          + '<div style="height:18px"></div>' : '')
        + '<form id="signup-form">'
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
      + '<p class="auth-s">Welcome back. Your dashboard is waiting.</p>'
      + '<form id="login-form">'
      + '<div class="field"><label for="li-email">Email</label>'
      + '<input class="input" id="li-email" type="email" required autocomplete="email" placeholder="you@example.com"></div>'
      + '<div class="field"><label for="li-pass">Password</label>'
      + '<input class="input" id="li-pass" type="password" required autocomplete="current-password" placeholder="Your password"></div>'
      + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-login">Sign in</button>'
      + '</form>'
      + '<div class="auth-alt"><a href="#/forgot">Forgot your password?</a></div>'
      + '<div class="divider">New here</div>'
      + '<a class="btn btn-lg btn-block" href="#/join">Create an account</a>', RIGHT);
  }

  /* --------------------------------------------------- onboarding */
  /* A new account picks what it is joining as. Nothing is created yet —
     it goes to the Super Admin, who approves it. */
  async function renderOnboard() {
    const me = A.store.me;
    /* The choice made on #/join wins; a returning account falls back to
       whatever it asked for last time. */
    const kind = pick.read() || (me.req_kind === 'leader' ? 'leader' : 'office');
    const turned = me.req_status === 'declined';
    const centers = kind === 'office' ? await A.join.publicCenters() : [];

    const mine = '<div class="field"><label for="ob-you">Your full name</label>'
      + '<input class="input" id="ob-you" required autocomplete="name" placeholder="Femi Ademilua" value="'
      + esc(me.full_name || '') + '"></div>'
      + '<div class="field"><label for="ob-phone">Phone number</label>'
      + '<input class="input" id="ob-phone" type="tel" required autocomplete="tel" placeholder="0803 000 0000" value="'
      + esc(me.phone || '') + '"></div>';

    const officeFields = '<div class="field"><label for="ob-center">Which center do you report to?</label>'
      + '<select class="select" id="ob-center" required>'
      + (centers.length
        ? centers.map(c => '<option value="' + c.id + '"' + (c.id === me.req_center_id ? ' selected' : '') + '>'
          + esc(c.name) + '</option>').join('')
        : '<option value="">No centers exist yet</option>') + '</select></div>'
      + '<div class="field"><label for="ob-name">Office name</label>'
      + '<input class="input" id="ob-name" required placeholder="Lagere Office" value="' + esc(me.req_office_name || '') + '"></div>'
      + '<div class="field"><label for="ob-address">Office address</label>'
      + '<input class="input" id="ob-address" required placeholder="12 Ede Road, opposite the filling station" value="'
      + esc(me.req_address || '') + '"></div>';

    $('#root').innerHTML = authShell(
      '<h1 class="auth-h">' + (turned ? 'Have another go' : kind === 'office' ? 'About your office' : 'About you') + '</h1>'
      + '<p class="auth-s">' + (turned
        ? 'Your last request came back. Fix what is below and send it again.'
        : 'Joining as ' + KIND_LABEL[kind] + '. <a href="#" data-act="ob-switch" style="text-decoration:underline">Not right?</a>'
        + ' Your leader approves this, and then your dashboard opens up.') + '</p>'
      + (turned ? U.note('gold', 'alert', esc(me.req_note || 'No reason was given.')) : '')

      + '<form id="ob-form" data-kind="' + kind + '">'
      + mine
      + (kind === 'office' ? officeFields : '')
      + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-request">'
      + (turned ? 'Send it again' : 'Ask to join') + '</button>'
      + '</form>'

      + '<div class="auth-alt"><a href="#" data-act="signout">Sign out</a></div>', RIGHT);
  }

  /* The account is in, the request is filed, and it is the Super Admin's
     turn. Nothing else in the app is reachable from here. */
  async function renderWaiting() {
    const me = A.store.me;
    let what = 'a leader';
    if (me.req_kind !== 'leader') {
      /* A pending account has no lookups loaded, so name the center here. */
      const c = (await A.join.publicCenters()).find(x => x.id === me.req_center_id);
      what = 'the office <b>' + esc(me.req_office_name || '') + '</b>' + (c ? ' at ' + esc(c.name) : '');
    }
    $('#root').innerHTML = authShell(
      '<h1 class="auth-h">You are on the list</h1>'
      + '<p class="auth-s">You asked to join as ' + what + '. Your leader will approve it, '
      + 'and the moment they do, this page opens onto your dashboard.</p>'
      + U.note('ok', 'check', 'Nothing else to do. You can close this and come back later — '
        + 'sign in with <b>' + esc(me.email) + '</b>.')
      + '<div class="row" style="margin-top:18px">'
      + '<button class="btn btn-a btn-block" data-act="check-approval">' + ico('refresh', 15) + 'Check again</button></div>'
      + '<div class="auth-alt"><a href="#" data-act="ob-edit">Change what I asked for</a> · '
      + '<a href="#" data-act="signout">Sign out</a></div>', RIGHT);
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
      const out = await A.auth.signUp(val('#su-email'), $('#su-pass').value, '');
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

  ACT['pick'] = (el) => { pick.save(el.dataset.v); go('#/signup'); };

  /* Changing your mind after the account exists — back to the fork, but
     the account stays, so #/join has to send them on to the details. */
  ACT['ob-switch'] = (el, e) => {
    e.preventDefault();
    pick.clear();
    modal('Joining as what?', '',
      '<div class="pick pick-sm">'
      + '<button type="button" class="pick-o" data-act="ob-switch-to" data-v="office">'
      + '<span class="pick-ic">' + ico('building', 19) + '</span><span class="pick-t">An office</span>'
      + '<span class="pick-d">Files the weekly report, runs its own distributors.</span></button>'
      + '<button type="button" class="pick-o" data-act="ob-switch-to" data-v="leader">'
      + '<span class="pick-ic">' + ico('crown', 19) + '</span><span class="pick-t">A leader or director</span>'
      + '<span class="pick-d">Sees every office, runs the Wednesday evaluation.</span></button>'
      + '</div>',
      '<button class="btn btn-g" data-act="modal-close">Cancel</button>');
  };

  ACT['ob-switch-to'] = (el) => { pick.save(el.dataset.v); closeModal(); route(); };

  ACT['do-request'] = async (el, e) => {
    e.preventDefault();
    const kind = $('#ob-form').dataset.kind || 'office';
    const btn = $('[data-act="do-request"]');
    if (kind === 'office' && !val('#ob-center')) {
      return toast('There are no centers yet. Your leader has to create one first.', 'no');
    }
    busy(btn, true, 'Sending…');
    try {
      await A.join.request(kind, {
        fullName: val('#ob-you'),
        phone: val('#ob-phone'),
        centerId: val('#ob-center'),
        officeName: val('#ob-name'),
        address: val('#ob-address')
      });
      pick.clear();
      state.editRequest = false;
      await boot(true);
      await route();
      toast('Sent. Your leader takes it from here.');
    } catch (err) { busy(btn, false); toast(err.message, 'no'); }
  };

  ACT['ob-edit'] = (el, e) => { e.preventDefault(); state.editRequest = true; route(); };

  ACT['check-approval'] = async (el) => {
    busy(el, true, 'Checking…');
    const was = A.store.me.role;
    await boot(true);
    if (A.store.me && A.store.me.role !== was) {
      toast('You are in. Welcome.');
      go('#/dashboard');
      await route();
    } else {
      busy(el, false);
      toast('Not yet — your leader has not approved it.');
    }
  };

  /* --- chrome ------------------------------------------------------ */
  ACT['nav'] = () => document.body.classList.toggle('nav-open');

  ACT['install'] = async () => {
    const p = window.__installPrompt;
    if (!p) return toast('Use your browser menu and pick “Add to Home screen”.');
    window.__installPrompt = null;
    p.prompt();
    const out = await p.userChoice.catch(() => null);
    if (out && out.outcome === 'accepted') toast('Installing…');
    const bar = $('.inst'); if (bar) bar.remove();
  };
  ACT['install-no'] = () => {
    try { localStorage.setItem('sti-install-off', '1'); } catch (e) { /* ignore */ }
    const bar = $('.inst'); if (bar) bar.remove();
  };
  ACT['modal-close'] = () => closeModal();
  ACT['modal-bg'] = (el, e) => { if (e.target === el) closeModal(); };
  ACT['reload'] = () => route();
  ACT['chart-type'] = (el) => { state.chartType = el.dataset.v; route(); };
  ACT['copy'] = (el) => {
    navigator.clipboard.writeText(el.dataset.v)
      .then(() => toast('Link copied.'))
      .catch(() => toast('Could not copy — select the link instead.', 'no'));
  };
  ACT['qr-download'] = (el) => {
    const d = el.dataset;
    U.downloadQrPoster({
      brand: brand(),
      url: d.url,
      title: d.title || '',
      sub: d.sub || '',
      code: d.code || '',
      lines: (d.lines || '').split('|').filter(Boolean),
      foot: d.foot || '',
      file: d.file || 'qr-poster'
    });
    toast('Poster downloaded. Print it and put it at the door.');
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
  function addNiche(v) {
    if (!v) return;
    state.form.niches = state.form.niches || [];
    if (!state.form.niches.includes(v)) state.form.niches.push(v);
    const inp = $('#niche-input'); if (inp) inp.value = '';
    const menu = $('#niche-menu'); if (menu) menu.innerHTML = '';
    $('#niche-chips').innerHTML = V.helpers.nicheChips(state.form.niches);
  }
  ACT['niche-pick'] = (el) => addNiche(el.dataset.v);

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
  ACT['approve-req'] = async (el) => {
    busy(el, true, 'Approving…');
    try {
      await A.people.approve(el.dataset.id);
      await A.loadLookups();          // the office it just created
      toast(el.dataset.name + ' is in.');
      route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['decline-req'] = (el) => {
    state.pendingReq = el.dataset.id;
    modal('Turn this request down?', esc(el.dataset.name || ''),
      '<p class="card-s" style="margin-bottom:14px">They stay signed up and can send a new request. '
      + 'Tell them what to change.</p>'
      + '<div class="field"><label for="dq-why">Reason</label>'
      + '<input class="input" id="dq-why" placeholder="That office already exists — pick another code."></div>',
      '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
      + '<button class="btn btn-d" data-act="decline-req-yes">Turn it down</button>');
  };

  ACT['decline-req-yes'] = async (el) => {
    busy(el, true, 'Sending…');
    try { await A.people.decline(state.pendingReq, val('#dq-why')); closeModal(); toast('They have been told.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['drop-admin'] = async (el) => {
    busy(el, true, 'Removing…');
    try { await A.people.setRole(el.dataset.id, 'pending'); toast('Leader access removed.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- account ----------------------------------------------------- */
  ACT['name-save'] = async (el) => {
    busy(el, true, 'Saving…');
    try {
      await A.sb.from('profiles')
        .update({ full_name: val('#a-name'), phone: val('#a-phone') }).eq('id', A.store.me.id);
      await A.loadMe(); busy(el, false); toast('Saved.'); route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };
  ACT['office-save'] = async (el) => {
    busy(el, true, 'Saving…');
    try {
      await A.offices.update(A.store.me.office_id, {
        name: val('#o-name'), manager_name: val('#o-manager'), phone: val('#o-phone'),
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
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;

    /* Enter adds the product you typed — the closest match if there is
       one, otherwise the words themselves as a brand new niche. */
    if (t.id === 'niche-input') {
      e.preventDefault();
      const v = t.value.trim();
      if (!v) return;
      const q = v.toLowerCase();
      const picked = state.form.niches || [];
      const hit = A.store.niches.find(n => n.toLowerCase() === q)
        || A.store.niches.find(n => n.toLowerCase().includes(q) && !picked.includes(n));
      addNiche(hit || v);
      return;
    }
    if (t.id === 'new-niche-input') { e.preventDefault(); ACT['new-niche-add'](); return; }

    /* The weekly report is long and easy to send by accident. Enter never
       files it — the button is the only way. */
    if (t.form && t.form.id === 'report-form' && t.tagName !== 'TEXTAREA') e.preventDefault();
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

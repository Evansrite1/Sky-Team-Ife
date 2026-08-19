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
    /* The week ends on the Wednesday the evaluation is held, so the
       evaluation reads the week it is standing in. */
    evalWeek: U.weekStart(),
    month: U.monthKey(U.weekStart()),
    center: null,
    chartType: 'bar',
    q: '',
    form: {},
    booted: false,
    editRequest: false,  // a waiting account asked to change what it sent
    moreOpen: false,     // the folded half of the sidebar
    tour: -1,            // walkthrough step, -1 when it is not running
    ranks: null          // the Director's rail standing, cached per week
  };
  window.APP = { state, go, refresh };

  /* ------------------------------------------------------------- nav */
  /* Five places you go every week, and everything else folded away.
     A sidebar of fourteen links is a list to read; five is a place to
     go. `more` opens on click and stays open while you are inside it. */
  const NAV = {
    super_admin: {
      main: [
        { p: 'dashboard', l: 'Dashboard', i: 'grid' },
        { p: 'offices', l: 'Offices', i: 'building', c: () => A.store.offices.length },
        { p: 'reports', l: 'Weekly reports', i: 'file' },
        { p: 'trainings', l: 'Attendance', i: 'qr' },
        { p: 'admin', l: 'Approvals & zones', i: 'shield', alertC: () => A.store.waiting || '' }
      ],
      more: [
        { p: 'evaluation', l: 'Evaluation list', i: 'clipboard' },
        { p: 'rankings', l: 'Office rankings', i: 'crown' },
        { p: 'niches', l: 'Niches', i: 'layers' },
        { p: 'monthly', l: 'Monthly summary', i: 'calendar' },
        { p: 'centers', l: 'Zones', i: 'layers', c: () => A.store.centers.length },
        { p: 'events', l: 'Zone events', i: 'star' },
        { p: 'distributors', l: 'Distributors', i: 'users' },
        { p: 'subscriptions', l: 'Subscriptions', i: 'card' },
        { p: 'weekfix', l: 'Fix a week', i: 'refresh' },
        { p: 'account', l: 'Account', i: 'lock' },
        { p: 'guide', l: 'Guide', i: 'info' }
      ]
    },
    /* A Director works through zones, not through a list of every page.
       Zones is the way in: a zone opens its report, the report carries
       the evaluation and the offices, and an office opens from there.
       Five links, no fold. */
    platform_admin: {
      main: [
        { p: 'dashboard', l: 'Dashboard', i: 'grid' },
        { p: 'centers', l: 'Zones', i: 'layers', c: () => A.store.centers.length },
        { p: 'evaluation', l: 'Evaluation list', i: 'clipboard' },
        { p: 'rankings', l: 'Office rankings', i: 'crown' },
        { p: 'niches', l: 'Niches', i: 'star' },
        { p: 'trainings', l: 'Attendance', i: 'qr' }
      ],
      more: [
        { p: 'monthly', l: 'Monthly summary', i: 'calendar' },
        { p: 'offices', l: 'Offices', i: 'building' },
        { p: 'weekfix', l: 'Fix a week', i: 'refresh' },
        { p: 'account', l: 'Account', i: 'lock' }
      ]
    },
    office: {
      main: [
        { p: 'dashboard', l: 'Dashboard', i: 'grid' },
        { p: 'reports', l: 'Weekly reports', i: 'clipboard' },
        { p: 'trainings', l: 'Attendance', i: 'qr' },
        { p: 'distributors', l: 'Distributors', i: 'users' },
        { p: 'center', l: 'Your zone', i: 'layers' },
        { p: 'subscriptions', l: 'Subscription', i: 'card' },
        { p: 'account', l: 'Account', i: 'lock' }
      ],
      more: []
    }
  };
  const ALLOWED = {
    super_admin: null,   // everything
    /* Reachable, but not in the sidebar: a Director gets to offices,
       evaluation and rankings by drilling into a zone, and the pages
       still have to answer when they do. */
    platform_admin: ['dashboard', 'centers', 'monthly', 'trainings', 'account',
      'offices', 'evaluation', 'rankings', 'reports', 'niches', 'weekfix'],
    office: ['dashboard', 'reports', 'trainings', 'distributors', 'center',
      'subscriptions', 'account', 'offices', 'monthly', 'niches']
  };

  function go(hash) { location.hash = hash; }
  const brand = () => (A.store.settings.organisation || window.CONFIG.organisation || 'Sky Team Ife');

  /* ============================== CHROME ============================= */
  /* Not a light switch — a dice roll on the whole look. The app rolls one
     for itself on every open; this is for rolling again on the spot. */
  const hueBtn = () => '<button class="sb-hue" data-act="hue" title="Roll a new look'
    + ' (now ' + esc(U.describeLook()) + ')" aria-label="Roll a new look">'
    + ico('drop', 16) + '</button>';

  const navLink = (n, active) => {
    const cnt = n.c ? n.c() : '';
    const alert = n.alertC ? n.alertC() : '';
    return '<a class="sb-a ' + (active === n.p ? 'on' : '') + '" href="#/' + n.p + '">' + ico(n.i, 17)
      + '<span>' + esc(n.l) + '</span>'
      + (cnt ? '<span class="cnt">' + cnt + '</span>' : '')
      + (alert ? '<span class="cnt cnt-a">' + alert + '</span>' : '') + '</a>';
  };

  function sidebar(active) {
    const me = A.store.me;
    const nav = NAV[me.role] || { main: [], more: [] };
    /* Open if they asked for it, or if the page they are on lives in there. */
    const openMore = state.moreOpen || nav.more.some(n => n.p === active);
    return '<aside class="sb"><div class="sb-top"><div class="brand">'
      + '<span class="brand-mk">' + U.logo(22) + '</span>' + esc(brand()) + '</div></div>'
      + '<nav class="sb-nav">'
      + nav.main.map(n => navLink(n, active)).join('')
      /* No fold when there is nothing folded into it. */
      + (nav.more.length
        ? '<button class="sb-more' + (openMore ? ' on' : '') + '" data-act="more">'
        + ico('down', 16) + '<span>More</span></button>'
        + '<div class="sb-sub' + (openMore ? ' open' : '') + '"><div>'
        + nav.more.map(n => navLink(n, active)).join('')
        + '</div></div>'
        : '')
      + (me.role === 'platform_admin' ? sbRanksHtml() : '')
      + '</nav>'
      + '<div class="sb-btm"><div class="sb-user"><div class="av">' + esc(U.initials(me.full_name || me.email)) + '</div>'
      + '<div><div class="sb-user-nm">' + esc(me.full_name || (me.role === 'office' && me.office ? me.office.name : 'Signed in')) + '</div>'
      + '<div class="sb-user-em">' + esc({ super_admin: 'Super Admin', platform_admin: 'Director', office: 'Office' }[me.role] || '') + '</div></div></div>'
      + '<div class="sb-row">'
      + '<button class="sb-out" data-act="signout">' + ico('out', 16) + 'Sign out</button>'
      + hueBtn()
      + '</div>'
      + '<div class="sb-credit">Site developed by <b>Large Technologies</b></div></div></aside>';
  }

  /* ------------------------------------------------- ranks in the rail */
  /* A Director's whole job is which office is ahead, so the standing for
     the week on screen sits in the sidebar rather than a page they have
     to go to. It is painted from a cache and filled in behind the render:
     the rail must never wait on a query to appear. */
  function sbRanksHtml() {
    const r = state.ranks;
    if (!r || !r.rows) return '<div class="sb-ranks" id="sb-ranks"></div>';
    return '<div class="sb-ranks" id="sb-ranks">'
      + '<div class="sb-grp">Offices · ' + esc(U.weekName(r.week)) + '</div>'
      + (r.rows.length
        ? r.rows.map(o => '<a class="sb-rk" href="#/offices/' + o.id + '">'
          + '<span class="rk rk-' + o.rank + '">' + o.rank + '</span>'
          + '<span class="sb-rk-n">' + esc(o.name) + '</span>'
          + '<span class="sb-rk-s">' + o.score + '</span></a>').join('')
        : '<div class="sb-rk-none">Nothing filed yet.</div>')
      + '</div>';
  }

  /* Fetches once per week and remembers it, so flipping between pages
     does not re-query what has not changed. */
  async function loadSbRanks() {
    const me = A.store.me;
    if (!me || me.role !== 'platform_admin') return;
    const wk = state.week;
    if (state.ranks && state.ranks.week === wk) return paintSbRanks();
    try {
      const filter = { week: wk };
      if (me.center_id) filter.center = me.center_id;
      const reps = await A.reports.list(filter);
      const offs = A.store.offices.filter(o => o.active
        && (!me.center_id || o.center_id === me.center_id));
      const ranked = V.helpers.rankOffices(reps, offs).filter(r => !r.missing);
      state.ranks = {
        week: wk,
        rows: ranked.slice(0, 8).map(r => ({ id: r.office_id, name: r.office.name, rank: r.rank, score: r.score }))
      };
    } catch (e) {
      state.ranks = { week: wk, rows: [] };
    }
    paintSbRanks();
  }

  function paintSbRanks() {
    const host = $('#sb-ranks');
    if (host) host.outerHTML = sbRanksHtml();
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
      { p: 'centers', l: 'Zones', i: 'layers' },
      { p: 'monthly', l: 'Monthly', i: 'calendar' },
      { p: 'trainings', l: 'Attendance', i: 'qr' }
    ],
    office: [
      { p: 'dashboard', l: 'Home', i: 'grid' },
      { p: 'reports', l: 'Report', i: 'clipboard' },
      { p: 'trainings', l: 'Attendance', i: 'qr' },
      { p: 'center', l: 'Zone', i: 'layers' }
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

  /* The nudge to install. It keeps coming back: dismissing it snoozes
     for a day rather than silencing it, because an app on the home
     screen is the whole point on a phone. Once actually installed the
     page runs in standalone mode and this never renders again. */
  const SNOOZE = 24 * 60 * 60 * 1000;
  function installBar() {
    /* A phone or a tablet, and nothing else. A laptop cannot add a home
       screen shortcut in any sense the words mean there, so a Mac, a PC
       and a Chromebook are never asked. Three things have to agree: no
       hover, a coarse pointer, and a narrow screen. Touchscreen laptops
       have hover and a fine pointer, which is what keeps them out. */
    if (!U.isHandheld()) return '';
    if (U.isStandalone()) return '';
    let until = 0;
    try { until = Number(localStorage.getItem('sti-install-snooze') || 0); } catch (e) { /* ignore */ }
    if (Date.now() < until) return '';

    /* Safari never fires beforeinstallprompt, so iOS gets told how to do
       it by hand instead of being offered a button that cannot work. */
    const ios = U.isIOS();
    if (!window.__installPrompt && !ios) return '';

    return '<div class="inst"><span class="inst-ic">' + U.logo(22) + '</span>'
      + '<div class="inst-t"><b>Add ' + esc(brand()) + ' to your home screen</b>'
      + '<span>' + (ios
        ? 'Tap Share, then “Add to Home Screen”.'
        : 'Opens full screen, and works with a weak signal.') + '</span></div>'
      + (ios ? '' : '<button class="btn btn-sm btn-a" data-act="install">Install</button>')
      + '<button class="inst-x" data-act="install-no" aria-label="Not now">'
      + ico('x', 18) + '</button></div>';
  }

  /* ============================ WALKTHROUGH ==========================
     Seven cards on first sign-in, next/next/next, each one pointing at
     the thing in the sidebar it is talking about. Written per role,
     because a Director and an office use almost none of the same pages.
     Shown once, then reachable again from Account. */
  const TOUR = {
    platform_admin: [
      { t: 'Welcome to ' , d: 'This is where the week is written down: who turned up, what each office sold, and how the zones compare. Five things in the sidebar, and that is the whole app.' },
      { p: 'dashboard', t: 'Dashboard', d: 'Everything at a glance — the week\'s orders and amount across every zone, who is leading, and which offices have not filed yet.' },
      { p: 'centers', t: 'Zones', d: 'Your way into everything. Open a zone to see its offices ranked, its evaluation list, its sessions and its QR poster.' },
      { p: 'centers', t: 'Inside a zone', d: 'The evaluation list is right there, with orders, amount and headcount for every office. Download it as a PDF to read from on the Wednesday.' },
      { p: 'centers', t: 'Then into an office', d: 'Tap any office in the ranking to see its own history — every report it has filed, week by week.' },
      { p: 'trainings', t: 'Attendance', d: 'Open scanning when a session starts and close it at the end. Anyone without a phone, you can mark present by hand from the session page.' },
      { p: 'monthly', t: 'Monthly summary', d: 'The same numbers over a month instead of a week, for when you want the shape of things rather than the detail.' }
    ],
    office: [
      { t: 'Welcome to ', d: 'This is where your office reports its week and signs its people in. Seven things in the sidebar, and nothing else to learn.' },
      { p: 'dashboard', t: 'Dashboard', d: 'Your week at a glance, and a reminder at the top whenever a report is still missing.' },
      { p: 'reports', t: 'Weekly reports', d: 'The one thing you do every week. Orders, amount, who was in the office, which niches the orders came from, and anything that slowed you down.' },
      { p: 'reports', t: 'You get two weeks', d: 'The week running now and the one behind it. Once a week is two weeks old it locks, because its evaluation has already been read.' },
      { p: 'trainings', t: 'Attendance', d: 'Every session has a QR code. Open scanning when it starts, and your distributors sign themselves in with a phone camera.' },
      { p: 'distributors', t: 'Distributors', d: 'Your people. Keep their phone numbers here — the last four digits are what proves it is really them at the door.' },
      { p: 'center', t: 'Your zone', d: 'How your office is doing against the others in your zone. Same numbers your Director sees.' }
    ]
  };
  TOUR.super_admin = TOUR.platform_admin;

  function tourStep(role, i) {
    const steps = TOUR[role] || [];
    const s = steps[i];
    if (!s) return '';
    const last = i === steps.length - 1;
    return '<div class="tour" data-act="tour-bg">'
      + '<div class="tour-c" role="dialog" aria-modal="true">'
      + '<div class="tour-top">'
      + '<span class="tour-mk">' + U.logo(22) + '</span>'
      + '<button class="tour-x" data-act="tour-end" aria-label="Skip">' + ico('x', 17) + '</button>'
      + '</div>'
      + '<div class="tour-n">Step ' + (i + 1) + ' of ' + steps.length + '</div>'
      + '<h2 class="tour-t">' + esc(s.t) + (i === 0 ? esc(brand()) : '') + '</h2>'
      + '<p class="tour-d">' + esc(s.d) + '</p>'
      + '<div class="tour-dots">'
      + steps.map((_, n) => '<i class="' + (n === i ? 'on' : '') + '"></i>').join('')
      + '</div>'
      + '<div class="tour-btm">'
      + (i > 0 ? '<button class="btn btn-g" data-act="tour-back">Back</button>' : '<span></span>')
      + '<button class="btn btn-a btn-pop" data-act="' + (last ? 'tour-end' : 'tour-next') + '">'
      + (last ? 'Start using it' : 'Next') + '</button>'
      + '</div></div></div>';
  }

  function paintTour() {
    const host = $('#modal');
    if (!host) return;
    if (state.tour < 0) { host.innerHTML = ''; return; }
    const me = A.store.me;
    host.innerHTML = tourStep(me.role, state.tour);
    /* Light up the sidebar item the current step is about. */
    U.$$('.sb-a.tour-lit').forEach(a => a.classList.remove('tour-lit'));
    const s = (TOUR[me.role] || [])[state.tour];
    if (s && s.p) {
      const a = $('.sb-a[href="#/' + s.p + '"]');
      if (a) a.classList.add('tour-lit');
    }
  }

  function maybeStartTour() {
    const me = A.store.me;
    if (!me || !TOUR[me.role]) return;
    let seen = false;
    try { seen = localStorage.getItem('sti-tour-' + me.id) === '1'; } catch (e) { /* ignore */ }
    if (seen) return;
    state.tour = 0;
    paintTour();
  }

  function topbar(v) {
    const picker = v.picker === 'month'
      ? '<div class="wk"><span class="wk-l">Month</span><select data-act="month">' + monthOptions() + '</select></div>'
      : v.picker === 'evalweek'
        ? '<div class="wk"><span class="wk-l">Evaluating</span><select data-act="evalweek">'
        + weekOptions(state.evalWeek) + '</select></div>'
        : v.picker === 'week'
          ? '<div class="wk"><span class="wk-l">Week</span><select data-act="week">'
          + weekOptions(state.week) + '</select></div>' : '';
    return '<header class="tb"><button class="burger" data-act="nav" aria-label="Menu">' + ico('menu', 18) + '</button>'
      + '<div>' + (v.crumbs ? '<div class="crumb">' + v.crumbs + '</div>' : '')
      + '<div class="tb-t">' + esc(v.title) + '</div></div>'
      + '<div class="tb-r">' + picker + '</div></header>';
  }
  const weekOptions = (sel) => U.recentWeeks(window.CONFIG.weeksShown || 12)
    .map(w => '<option value="' + w + '" ' + (w === sel ? 'selected' : '') + '>'
      + esc(U.weekRange(w)) + (U.weekClosed(w) ? '' : ' (open)') + '</option>').join('');
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

    /* An office whose trial ran out with nothing paid can reach its
       subscription, its account and the guide. Nothing else, until it
       pays. The database refuses the writes regardless; this is so they
       are told why rather than hitting a wall. */
    if (me.role === 'office' && A.store.locked
      && ['subscriptions', 'account', 'guide'].indexOf(page) === -1) {
      go('#/subscriptions'); return;
    }
    state.page = page;

    if (routing) return;
    routing = true;
    const main = ensureShell(page);
    main.innerHTML = '<div class="loading"><div class="spinner"></div>'
      + '<div class="card-s">Loading…</div></div>';
    try {
      const v = await V[page](id);
      /* The rail carries the credit too, but the rail is behind a menu on
         a phone — which is where most of this is read. */
      main.innerHTML = topbar(v) + '<div class="page enter">' + v.html + PAGE_CREDIT + '</div>';
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      main.innerHTML = topbar({ title: 'Something went wrong' }) + '<div class="page">'
        + U.note('err', 'alert', '<b>' + esc(e.message || 'The database refused that request.') + '</b>'
          + '<div style="margin-top:8px">If this is the first run, check that supabase/schema.sql has been run in your Supabase project.</div>')
        + '<div class="row" style="margin-top:16px"><button class="btn btn-p" data-act="reload">'
        + ico('refresh', 15) + 'Try again</button></div></div>';
    }
    routing = false;
    /* After the page is up, never before it. */
    loadSbRanks();
    askForNames();
  }

  /* ------------------------------------------------- the names nudge */
  /* An office is asked for its distributors by name on the three days
     the week actually turns over — Thursday it opens, Friday is the
     Distributor Training, Saturday is the last chance before the week
     runs away — and on any day at all when the number of people it says
     are in the room is more than the number of names on file.

     Once a day, never twice: being nagged on every click is how a prompt
     gets dismissed without being read. */
  const NAMES_KEY = 'sti-names-asked';
  const NUDGE_DAYS = [4, 5, 6];          // Thursday, Friday, Saturday
  let namesChecked = false;              // the two queries run once a visit

  async function askForNames() {
    const me = A.store.me;
    if (!me || me.role !== 'office' || !me.office || A.store.locked) return;
    if (state.page === 'distributors') return;      // they are already there
    if (namesChecked) return;

    const today = U.iso(new Date());
    let asked = '';
    try { asked = localStorage.getItem(NAMES_KEY) || ''; } catch (e) { /* ignore */ }
    if (asked === today) { namesChecked = true; return; }
    namesChecked = true;

    let dists = [];
    try { dists = await A.distributors.list({ office: me.office.id }); }
    catch (e) { return; }
    const named = dists.filter(d => d.active !== false).length;

    /* What the office last said the room holds, against the names on it. */
    let claimed = 0;
    try {
      const last = (await A.reports.list({ office: me.office.id }))[0];
      if (last) claimed = (Number(last.num_distributors) || 0)
        + (Number(last.num_senior_managers) || 0) + (Number(last.num_newbies) || 0);
    } catch (e) { /* the day rule still applies */ }

    const short = claimed > named;
    const isNudgeDay = NUDGE_DAYS.indexOf(new Date().getDay()) !== -1;
    if (!short && !isNudgeDay) return;

    try { localStorage.setItem(NAMES_KEY, today); } catch (e) { /* ignore */ }

    modal('Who is in your office?',
      short
        ? 'Your last report counted <b>' + claimed + '</b> in the room, but only <b>' + named
        + '</b> ' + (named === 1 ? 'name is' : 'names are') + ' on file. The ones missing cannot scan in.'
        : 'Everyone who scans in at a training has to be on this list first.',
      U.note('info', 'users', named
        ? '<b>' + named + ' ' + (named === 1 ? 'name' : 'names') + ' on file.</b> '
        + 'Add anyone who has joined, and take off anyone who has left.'
        : '<b>No names on file yet.</b> Add your distributors and they can scan in at the next training.'),
      '<button class="btn btn-g" data-act="modal-close">Later</button>'
      + '<button class="btn btn-a" data-act="go-names">' + ico('users', 16) + 'Add the names</button>');
  }


  /* The shell — backdrop, rail, tab bar — is built once and then left in
     place. Only <main> is swapped from page to page.

     It used to rebuild the whole of #root twice for every navigation:
     once to show the spinner and again with the content, each time
     re-parsing the sidebar and re-creating the backdrop. That is what
     made moving around feel heavy on a phone. The rail and the tab bar
     are still refreshed, because the active link and the badges move,
     but the backdrop is now created exactly once per sign-in. */
  function ensureShell(page) {
    const root = $('#root');
    const shell = root.querySelector('.shell');
    if (!shell) {
      root.innerHTML = '<div class="shell">' + U.backdrop3d() + sidebar(page)
        + '<div class="scrim" data-act="nav"></div><main class="main"></main>'
        + installBar() + tabbar(page) + '</div>';
      return root.querySelector('main.main');
    }
    const sb = shell.querySelector('.sb');
    if (sb) sb.outerHTML = sidebar(page);
    /* Both live after <main> and both can come and go — the install bar
       when it is snoozed, the badges on the tab bar as counts change —
       so they are dropped and re-laid in that order rather than patched. */
    const old = shell.querySelector('.inst');
    if (old) old.remove();
    const tabs = shell.querySelector('.tabs');
    if (tabs) tabs.remove();
    shell.insertAdjacentHTML('beforeend', installBar() + tabbar(page));
    return shell.querySelector('main.main');
  }
  async function refresh() { await route(); }

  /* =============================== AUTH ============================= */
  const CREDIT = '<div class="credit">Site developed by <b>Large Technologies</b></div>';
  const PAGE_CREDIT = '<footer class="pg-credit">Developed by <b>Large Technologies</b></footer>';

  /* The mark on the card is deliberately still. Everything that moves is
     behind the glass, so the brand itself stays steady to read against. */
  const authShell = (inner) => '<div class="auth">' + U.backdrop3d()
    + '<div class="auth-mid">'
    + '<div class="auth-card">'
    + '<div class="auth-brand">' + U.logo(46) + '<span>' + esc(brand()) + '</span></div>'
    + inner + '</div>'
    + CREDIT + '</div></div>';

  /* Which of the two they picked on #/join. Kept for the hop through
     account creation so the details form knows what to ask for. */
  const pick = {
    read() { try { return sessionStorage.getItem('sti-join') || ''; } catch (e) { return ''; } },
    save(k) { try { sessionStorage.setItem('sti-join', k); } catch (e) { /* ignore */ } },
    clear() { try { sessionStorage.removeItem('sti-join'); } catch (e) { /* ignore */ } }
  };
  const KIND_LABEL = { office: 'an office', leader: 'a director' };

  function renderAuth(which) {
    const r = $('#root');
    /* The fork. Nothing is asked for here but the choice itself — what
       an office has to fill in and what a director does barely overlap. */
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
        + '<span class="pick-ic">' + ico('crown', 19) + '</span><span class="pick-t">A director</span>'
        + '<span class="pick-d">You oversee zones. You see every office and run the Wednesday evaluation.</span></button>'
        + '</div>'
        + '<div class="auth-alt">Already have an account? <a href="#/login">Sign in</a></div>');
      return;
    }
    if (which === 'signup') {
      const k = pick.read();
      if (!k) { go('#/join'); return; }
      r.innerHTML = authShell(
        '<h1 class="auth-h">Create your account</h1>'
        + '<p class="auth-s">Joining as ' + KIND_LABEL[k] + '. '
        + '<a href="#/join" style="text-decoration:underline">Not right?</a><br>'
        + 'An email and a password to start. Your details come next.</p>'
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
        + '<div class="auth-alt">Already have one? <a href="#/login">Sign in</a></div>');
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
        + '</form><div class="auth-alt"><a href="#/login">Back to sign in</a></div>');
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
        + '</form>');
      return;
    }
    /* Nothing but the form. Anyone reaching this screen already knows
       what the platform is; the pitch lives inside the guide. */
    r.innerHTML = authShell(
      '<h1 class="auth-h">Welcome back</h1>'
      + '<form id="login-form">'
      + '<div class="field"><label for="li-email">Email address</label>'
      + '<input class="input" id="li-email" type="email" required autocomplete="email" placeholder="you@example.com"></div>'
      + '<div class="field"><label for="li-pass">Password</label>'
      + '<input class="input" id="li-pass" type="password" required autocomplete="current-password" placeholder="Your password"></div>'
      + '<div class="auth-row"><a href="#/forgot">Forgot your password?</a></div>'
      + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-login">Sign in</button>'
      + '</form>'
      + '<div class="auth-alt">Are you a new member? <a href="#/join">Create an account</a></div>');
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
    const zones = kind === 'office' ? await A.join.publicCenters() : [];

    const mine = '<div class="field"><label for="ob-you">Your full name</label>'
      + '<input class="input" id="ob-you" required autocomplete="name" placeholder="Evans Large" value="'
      + esc(me.full_name || '') + '"></div>'
      + '<div class="field"><label for="ob-phone">Phone number</label>'
      + '<input class="input" id="ob-phone" type="tel" required autocomplete="tel" placeholder="0803 000 0000" value="'
      + esc(me.phone || '') + '"></div>';

    const officeFields = '<div class="field"><label for="ob-zone">Which zone do you report to?</label>'
      + '<select class="select" id="ob-zone" required>'
      + (zones.length
        ? zones.map(c => '<option value="' + c.id + '"' + (c.id === me.req_center_id ? ' selected' : '') + '>'
          + esc(c.name) + '</option>').join('')

        : '<option value="">No zones exist yet</option>') + '</select></div>'
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
        + ' A director approves this, and then your dashboard opens up.') + '</p>'
      + (turned ? U.note('gold', 'alert', esc(me.req_note || 'No reason was given.')) : '')

      + '<form id="ob-form" data-kind="' + kind + '">'
      + mine
      + (kind === 'office' ? officeFields : '')
      + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="do-request">'
      + (turned ? 'Send it again' : 'Ask to join') + '</button>'
      + '</form>'

      + '<div class="auth-alt"><a href="#" data-act="signout">Sign out</a></div>');
  }

  /* The account is in, the request is filed, and it is the Super Admin's
     turn. Nothing else in the app is reachable from here. */
  async function renderWaiting() {
    const me = A.store.me;
    let what = 'a director';
    if (me.req_kind !== 'leader') {
      /* A pending account has no lookups loaded, so name the zone here. */
      const c = (await A.join.publicCenters()).find(x => x.id === me.req_center_id);
      what = 'the office <b>' + esc(me.req_office_name || '') + '</b>' + (c ? ' at ' + esc(c.name) : '');
    }
    $('#root').innerHTML = authShell(
      '<h1 class="auth-h">You are on the list</h1>'
      + '<p class="auth-s">You asked to join as ' + what + '. A director will approve it, '
      + 'and the moment they do, this page opens onto your dashboard.</p>'
      + U.note('ok', 'check', 'Nothing else to do. You can close this and come back later. Just '
        + 'sign in with <b>' + esc(me.email) + '</b>.')
      + '<div class="row" style="margin-top:18px">'
      + '<button class="btn btn-a btn-block" data-act="check-approval">' + ico('refresh', 15) + 'Check again</button></div>'
      + '<div class="auth-alt"><a href="#" data-act="ob-edit">Change what I asked for</a> · '
      + '<a href="#" data-act="signout">Sign out</a></div>');
  }

  /* ============================= SETUP GATE ========================= */
  function renderSetup() {
    $('#root').innerHTML = '<div class="scan-wrap"><div class="card scan-card">'
      + '<div class="card-h"><div><div class="card-t">Almost there</div>'
      + '<div class="card-s">' + esc(brand()) + ' is deployed, but it has not been pointed at a database yet.</div></div></div>'
      + U.note('gold', 'key', 'Open <span class="mono">config.js</span> and paste your Supabase <b>Project URL</b> and '
        + '<b>anon public key</b> from Project Settings → API. Then run <span class="mono">supabase/schema.sql</span> '
        + 'in the Supabase SQL editor.')
      + '<p class="card-s" style="margin-top:14px">Neither value is a secret. The anon key is meant to be public, and row level '
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

  ACT['signout'] = async () => {
    A.unwatch();
    await A.auth.signOut();
    state.ranks = null;
    state.booted = true; go('#/login'); await route();
  };

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
      + '<span class="pick-ic">' + ico('crown', 19) + '</span><span class="pick-t">A director</span>'
      + '<span class="pick-d">Sees every office, runs the Wednesday evaluation.</span></button>'
      + '</div>',
      '<button class="btn btn-g" data-act="modal-close">Cancel</button>');
  };

  ACT['ob-switch-to'] = (el) => { pick.save(el.dataset.v); closeModal(); route(); };

  ACT['do-request'] = async (el, e) => {
    e.preventDefault();
    const kind = $('#ob-form').dataset.kind || 'office';
    const btn = $('[data-act="do-request"]');
    if (kind === 'office' && !val('#ob-zone')) {
      return toast('There are no zones yet. A director has to create one first.', 'no');
    }
    busy(btn, true, 'Sending…');
    try {
      await A.join.request(kind, {
        fullName: val('#ob-you'),
        phone: val('#ob-phone'),
        centerId: val('#ob-zone'),
        officeName: val('#ob-name'),
        address: val('#ob-address')
      });
      pick.clear();
      state.editRequest = false;
      await boot(true);
      await route();
      toast('Sent. A director takes it from here.');
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
      toast('Not yet. It has not been approved.');
    }
  };

  /* --- chrome ------------------------------------------------------ */
  ACT['nav'] = () => document.body.classList.toggle('nav-open');

  /* Repaint only the button, not the page: the accent is one variable, so
     everything else is already the new colour by the time this runs. The
     button is only redrawn to refresh its own tooltip. */
  ACT['go-names'] = () => { closeModal(); go('#/distributors'); };

  /* --- fix a week ---------------------------------------------------- */
  ACT['week-swap'] = () => {
    const wf = state.weekfix || {};
    const o = A.officeById(wf.office);
    if (!o || !wf.weekA || !wf.weekB) return;
    U.confirmDialog('Swap ' + U.weekName(wf.weekA) + ' and ' + U.weekName(wf.weekB) + '?',
      'For <b>' + esc(o.name) + '</b>, whatever ' + esc(U.weekName(wf.weekA)) + ' holds trades places with '
      + 'whatever ' + esc(U.weekName(wf.weekB)) + ' holds. Nothing is deleted, and swapping again puts it back.',
      'Swap the weeks', 'week-swap-yes');
  };

  ACT['week-swap-yes'] = async (el) => {
    const wf = state.weekfix || {};
    busy(el, true, 'Swapping…');
    try {
      await A.swapReportWeeks(wf.office, wf.weekA, wf.weekB);
      state.ranks = null;
      closeModal();
      toast('Swapped ' + U.weekName(wf.weekA) + ' and ' + U.weekName(wf.weekB) + '.');
      route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['hue'] = (el) => {
    const look = U.rollLook();
    const holder = el.parentElement;
    el.outerHTML = hueBtn();
    if (holder) void holder.offsetHeight;
    U.toast(U.describeLook(look) + '.');
  };
  ACT['more'] = (el) => {
    state.moreOpen = !state.moreOpen;
    el.classList.toggle('on', state.moreOpen);
    const sub = el.nextElementSibling;
    if (sub) sub.classList.toggle('open', state.moreOpen);
  };

  ACT['install'] = async () => {
    const p = window.__installPrompt;
    if (!p) return toast('Use your browser menu and pick “Add to Home screen”.');
    window.__installPrompt = null;
    p.prompt();
    const out = await p.userChoice.catch(() => null);
    if (out && out.outcome === 'accepted') toast('Installing…');
    const bar = $('.inst'); if (bar) bar.remove();
  };
  /* Snoozed for a day, not silenced. It will ask again tomorrow. */
  ACT['install-no'] = () => {
    try { localStorage.setItem('sti-install-snooze', String(Date.now() + SNOOZE)); } catch (e) { /* ignore */ }
    const bar = $('.inst'); if (bar) bar.remove();
  };
  ACT['modal-close'] = () => closeModal();
  ACT['modal-bg'] = (el, e) => { if (e.target === el) closeModal(); };
  ACT['reload'] = () => route();
  ACT['chart-type'] = (el) => { state.chartType = el.dataset.v; route(); };
  ACT['copy'] = (el) => {
    navigator.clipboard.writeText(el.dataset.v)
      .then(() => toast('Link copied.'))
      .catch(() => toast('Could not copy. Select the link instead.', 'no'));
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

  /* --- zones ----------------------------------------------------- */
  const centerForm = (c) => '<div class="field"><label for="c-name">Zone name</label>'
    + '<input class="input" id="c-name" value="' + esc(c.name || '') + '" placeholder="Lagere Zone"></div>'
    + '<div class="field"><label for="c-address">Address</label>'
    + '<input class="input" id="c-address" value="' + esc(c.address || '') + '" placeholder="14 Ondo Road, Ile-Ife"></div>'
    + '<div class="two"><div class="field"><label for="c-leader">Director</label>'
    + '<input class="input" id="c-leader" value="' + esc(c.leader_name || '') + '"></div>'
    + '<div class="field"><label for="c-assistant">Assistant</label>'
    + '<input class="input" id="c-assistant" value="' + esc(c.assistant_name || '') + '"></div></div>';

  ACT['center-new'] = () => modal('New zone', 'Offices join a zone, and the zone evaluates them every Wednesday.',
    centerForm({}), '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
    + '<button class="btn btn-a btn-pop" data-act="center-save">Create zone</button>');

  ACT['center-edit'] = (el) => {
    const c = A.centerById(el.dataset.id) || {};
    modal('Edit zone', esc(c.name || ''), centerForm(c),
      '<button class="btn btn-d left" data-act="center-del" data-id="' + c.id + '">Delete</button>'
      + '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
      + '<button class="btn btn-a btn-pop" data-act="center-save" data-id="' + c.id + '">Save</button>');
  };

  ACT['center-save'] = async (el) => {
    const row = {
      name: val('#c-name'), address: val('#c-address'),
      leader_name: val('#c-leader'), assistant_name: val('#c-assistant')
    };
    if (!row.name) return toast('A zone needs a name.', 'no');
    busy(el, true, 'Saving…');
    try {
      if (el.dataset.id) await A.centers.update(el.dataset.id, row);
      else await A.centers.create(row);
      closeModal(); toast('Zone saved.'); route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['center-del'] = (el) => {
    state.pendingDelete = el.dataset.id;
    U.confirmDialog('Delete this zone?',
      'You cannot delete a zone that still has offices in it. This cannot be undone.',
      'Delete zone', 'center-del-yes', true);
  };

  ACT['center-del-yes'] = async (el) => {
    busy(el, true, 'Deleting…');
    try { await A.centers.remove(state.pendingDelete); closeModal(); toast('Zone deleted.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- distributors ------------------------------------------------ */
  const distForm = (d) => '<div class="field"><label for="d-name">Full name</label>'
    + '<input class="input" id="d-name" value="' + esc(d.full_name || '') + '" placeholder="Evans Large"></div>'
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
      /* One round trip, not one per niche. Filing with eight products on
         the report used to mean eight sequential inserts before the
         report itself was even sent. */
      await Promise.all(niches.map(n => A.niches.add(n)));
      await A.reports.save({
        office_id: A.store.me.office_id,
        center_id: A.store.me.center_id,
        week_start: state.week,
        orders: Math.round(orders),
        amount: amount,
        niches: niches,
        new_niches: state.form.newNiches || [],
        num_distributors: Number(val('#f-dist')) || 0,
        num_senior_managers: Number(val('#f-sm')) || 0,
        num_newbies: Number(val('#f-new')) || 0,
        /* Kept in step so the rankings and the "reports in" counts, which
           were built on office_size, keep meaning the same thing. */
        office_size: Number(val('#f-dist')) || 0,
        total_office: (Number(val('#f-dist')) || 0) + (Number(val('#f-sm')) || 0),
        issues: val('#f-issues'),
        submitted_by: A.store.me.id,
        submitted_at: new Date().toISOString()
      });
      state.form = {};
      state.ranks = null;          /* the standing just moved */
      toast('Report filed. It will be read at the evaluation.');
      route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- events ------------------------------------------------------ */
  ACT['event-new'] = () => {
    const zones = A.isOffice() ? A.store.centers.filter(c => c.id === A.store.me.center_id) : A.store.centers;
    modal('New zone event', 'Anything outside the two weekly trainings.',
      '<div class="field"><label for="e-name">What is it called?</label>'
      + '<input class="input" id="e-name" placeholder="Cheque Rally"></div>'
      + '<div class="field"><label for="e-zone">Zone</label><select class="select" id="e-zone">'
      + zones.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select></div>'
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
    const name = val('#e-name'), cid = val('#e-zone'), date = val('#e-date');
    if (!name) return toast('Give the event a name.', 'no');
    if (!cid) return toast('Pick a zone.', 'no');
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
      + '<input class="input" id="dq-why" placeholder="That name is already taken in this zone."></div>',
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
    try { await A.people.setRole(el.dataset.id, 'pending'); toast('Director access removed.'); route(); }
    catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  /* --- billing ----------------------------------------------------- */
  /* The Edge Function decides the amount and returns a Paystack URL.
     Nothing about the price is settled in the browser. */
  ACT['pay-now'] = async (el) => {
    busy(el, true, 'Opening Paystack…');
    try {
      const url = await A.billing.startCheckout();
      window.location.href = url;
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
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
  /* --- the walkthrough --------------------------------------------- */
  ACT['tour-next'] = () => { state.tour += 1; paintTour(); };
  ACT['tour-back'] = () => { state.tour = Math.max(0, state.tour - 1); paintTour(); };
  ACT['tour-bg'] = (el, e) => { if (e.target === el) ACT['tour-end'](); };
  ACT['tour-end'] = () => {
    state.tour = -1;
    try { localStorage.setItem('sti-tour-' + A.store.me.id, '1'); } catch (e) { /* ignore */ }
    U.$$('.sb-a.tour-lit').forEach(a => a.classList.remove('tour-lit'));
    const host = $('#modal'); if (host) host.innerHTML = '';
  };
  ACT['tour-again'] = () => { state.tour = 0; paintTour(); };

  ACT['mark-present'] = async (el) => {
    busy(el, true, 'Marking…');
    try {
      await A.scans.markPresent(el.dataset.event, el.dataset.dist);
      toast(el.dataset.name + ' is marked present.');
      route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['eval-pdf'] = async (el) => {
    const cid = el.dataset.center, ws = el.dataset.week;
    busy(el, true, 'Building…');
    try {
      const zone = A.centerById(cid) || {};
      const offs = A.officesOf(cid).filter(o => o.active);
      const reps = await A.reports.list({ week: ws, center: cid });
      const rows = V.helpers.rankOffices(reps, offs).map(r => {
        const rep = reps.find(x => x.office_id === r.office_id);
        return {
          office: r.office.name,
          leader: r.office.manager_name || '',
          filed: !!rep,
          orders: rep ? rep.orders : null,
          amount: rep ? U.usdFull(rep.amount) : null,
          dists: rep ? rep.num_distributors : null,
          sms: rep ? rep.num_senior_managers : null,
          newbies: rep ? rep.num_newbies : null,
          issues: rep ? (rep.issues || '—') : '—'
        };
      });
      const t = V.helpers.totals(reps);
      const ok = U.printEvaluation({
        title: zone.name + ' — evaluation',
        sub: U.weekLabel(ws) + '   ·   read on ' + U.fullDate(U.evalDate(ws)) + ' at 2:45pm'
          + '   ·   ' + reps.length + ' of ' + offs.length + ' offices filed',
        brand: brand(),
        head: ['Office', 'Orders', 'Amount', 'Distributors', 'Senior managers', 'Newbies', 'What slowed them down'],
        rows: rows,
        foot: ['Zone total', String(t.orders), U.usdFull(t.amount),
          String(t.dists), String(t.sms), String(t.newbies), '']
      });
      busy(el, false);
      if (!ok) toast('Your browser blocked the print window. Allow pop-ups for this site and try again.', 'no');
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['office-move'] = async (el) => {
    const to = val('#mv-zone');
    if (!to) return toast('Pick the zone to move it to.', 'no');
    busy(el, true, 'Moving…');
    try {
      await A.offices.move(el.dataset.id, to);
      await A.loadLookups();
      toast('Moved to ' + ((A.centerById(to) || {}).name || 'the new zone') + '.');
      route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['office-del'] = (el) => {
    state.pendingOffice = el.dataset.id;
    U.confirmDialog('Delete ' + el.dataset.name + '?',
      'Its reports, its distributors and every scan they ever made go with it. '
      + 'The person who signed up keeps their account but is put back to waiting, '
      + 'so they can ask to join again. This cannot be undone.',
      'Delete the office', 'office-del-yes', true);
  };

  ACT['office-del-yes'] = async (el) => {
    busy(el, true, 'Deleting…');
    try {
      await A.offices.remove(state.pendingOffice);
      await A.loadLookups();
      closeModal(); toast('Office deleted.');
      go('#/offices'); await route();
    } catch (err) { busy(el, false); toast(err.message, 'no'); }
  };

  ACT['office-save'] = async (el) => {
    busy(el, true, 'Saving…');
    try {
      await A.offices.update(A.store.me.office_id, {
        name: val('#o-name'), manager_name: val('#o-manager'),
        phone: val('#o-phone'), address: val('#o-address')
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
    if (el.dataset.act === 'evalweek') { state.evalWeek = el.value; route(); }
    if (el.dataset.act === 'month') { state.month = el.value; route(); }
    if (el.dataset.act === 'center') { state.center = el.value; route(); }
    if (el.dataset.act === 'wf-office') { state.weekfix = state.weekfix || {}; state.weekfix.office = el.value; route(); }
    if (el.dataset.act === 'wf-week-a') { state.weekfix = state.weekfix || {}; state.weekfix.weekA = el.value; route(); }
    if (el.dataset.act === 'wf-week-b') { state.weekfix = state.weekfix || {}; state.weekfix.weekB = el.value; route(); }
  });

  /* Jump the week picker straight to a given week. */
  ACT['go-week'] = (el, e) => {
    e.preventDefault();
    state.week = el.dataset.v;
    state.form = {};
    go('#/reports');
    route();
  };

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
       one, otherwise the words themselves as a brand new niche.

       Commas separate products, so a whole list can be typed in one go
       and lands as separate niches rather than as one run-on entry.
       When several are given, only an exact name counts as a match: the
       loose "contains" match is a convenience for one word at a time,
       and applying it down a list is how you get the wrong product. */
    if (t.id === 'niche-input') {
      e.preventDefault();
      const parts = t.value.split(',').map(x => x.trim()).filter(Boolean);
      if (!parts.length) return;
      const many = parts.length > 1;
      parts.forEach(part => {
        const q = part.toLowerCase();
        const picked = state.form.niches || [];
        const hit = A.store.niches.find(n => n.toLowerCase() === q)
          || (many ? null : A.store.niches.find(n => n.toLowerCase().includes(q) && !picked.includes(n)));
        addNiche(hit || part);
      });
      return;
    }
    if (t.id === 'new-niche-input') { e.preventDefault(); ACT['new-niche-add'](); return; }

    /* The weekly report is long and easy to send by accident. Enter never
       files it — the button is the only way. */
    if (t.form && t.form.id === 'report-form' && t.tagName !== 'TEXTAREA') e.preventDefault();
  });

  window.addEventListener('hashchange', route);

  /* =============================== BOOT ============================= */
  /* Live updates. A change lands, and the page being looked at repaints
     itself. Coalesced on a short timer because one action often moves
     several rows — approving an office writes an office and a profile —
     and each of those would otherwise be a separate reload.

     Anything the lookups hold (offices, zones, counts) is refetched
     first; everything else the view will pull for itself on render. */
  let liveTimer = null, liveNeedsLookups = false, livePending = false;
  const LOOKUP_TABLES = ['offices', 'centers', 'profiles', 'subscriptions'];

  /* Short enough that a report filed in one office is on the Director's
     screen while they are still looking at it, long enough that one
     action moving several rows is still a single repaint. */
  const LIVE_DELAY = 140;

  function applyLive() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      /* Never yank the page out from under someone mid-edit — but hold
         the update rather than dropping it, and lay it down as soon as
         they are done. This used to lose the refresh entirely. */
      const el = document.activeElement;
      if ($('#modal').innerHTML || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
        livePending = true;
        return;
      }
      livePending = false;
      try {
        if (liveNeedsLookups) { await A.loadLookups(); liveNeedsLookups = false; }
        await route();
      } catch (e) { /* a failed refresh must not break the page */ }
    }, LIVE_DELAY);
  }

  function startLive() {
    A.watch((table) => {
      if (LOOKUP_TABLES.indexOf(table) > -1) liveNeedsLookups = true;
      /* A report moved, so the standing in the rail is out of date. */
      if (table === 'reports') state.ranks = null;
      applyLive();
    });

    /* A held update goes down the moment the field is left. */
    document.addEventListener('focusout', () => { if (livePending) applyLive(); });

    /* Coming back to the tab, or back onto the network, is the other way
       to be out of date: a phone that slept has missed every message the
       socket sent while it was away, so the page is rebuilt on return
       rather than trusted. */
    const catchUp = () => {
      if (document.visibilityState !== 'visible' || !A.store.me) return;
      liveNeedsLookups = true;
      state.ranks = null;
      applyLive();
    };
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('online', catchUp);
    window.addEventListener('focus', catchUp);
  }

  async function boot(silent) {
    if (!window.CONFIG.ready || !A.ready) { state.booted = true; renderSetup(); return; }
    try {
      const me = await A.loadMe();
      if (me && me.role !== 'pending') { await A.loadLookups(); startLive(); }
      else A.unwatch();
      state.booted = true;
      if (!silent) await route();
      /* After the first page is on screen, so the walkthrough has the
         sidebar behind it to point at. */
      if (me && me.role !== 'pending') maybeStartTour();
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

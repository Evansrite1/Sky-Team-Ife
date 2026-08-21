/* =====================================================================
   Sky Team Ife — views. Each one fetches what it needs and returns
   { title, crumbs, picker, html }. Nothing here is invented: an empty
   database renders empty states, not sample rows.
   ===================================================================== */
(function () {
  'use strict';

  const U = window.UI, A = window.API;
  const { esc, ico, usd, usdFull, kpi, tag, note, empty, bar, table, chart, chartToggle } = U;

  const S = () => window.APP.state;
  const LEADER = ['Director', 'Emerald Director'];
  const SM_PLUS = ['Senior Manager', 'Executive Manager', 'Director', 'Emerald Director'];
  const STATUSES = ['Distributor', 'Senior Manager', 'Executive Manager', 'Director', 'Emerald Director'];

  /* ------------------------------------------------------- aggregation */
  const sumBy = (arr, f) => arr.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  const totals = rs => ({
    orders: sumBy(rs, r => r.orders), amount: sumBy(rs, r => r.amount), count: rs.length,
    dists: sumBy(rs, r => r.num_distributors), sms: sumBy(rs, r => r.num_senior_managers),
    newbies: sumBy(rs, r => r.num_newbies)
  });

  /* The room, as reported. Shown wherever a set of reports is summed. */
  const roomRow = (t) => '<div class="room">'
    + [['Distributors', t.dists, 'users'], ['Senior managers', t.sms, 'crown'],
    ['Newbies', t.newbies, 'plus']]
      .map(c => '<div class="room-c">' + ico(c[2], 15)
        + '<div><div class="room-v">' + (c[1] || 0).toLocaleString() + '</div>'
        + '<div class="room-l">' + c[0] + '</div></div></div>').join('')
    + '</div>';

  /* ---------------------------------------------------------- ranking */
  /* What makes an office the best office. Three quests, and the ranking
     is the sum of how far an office is along each of them:

       money       what the orders came to
       productive  what each earner brought in — amount over the pros
       numbers     how many people the office has in the room

     "Pros" are the people who actually write orders: distributors and
     senior managers. Newbies count towards the room but not towards
     productivity, or an office would be punished for training people.

     Each is scored against the best office in the same group, so a score
     is "how close to the leader" rather than a raw figure. The weights
     below are the whole of the policy — change them here and every
     ranking in the app moves together. */
  const RANK_W = { amount: 0.35, perPro: 0.35, people: 0.30 };
  const RANK_BASIS = 'Money, output per pro, and size of the room.';

  const peopleIn = r => (Number(r.num_distributors) || 0)
    + (Number(r.num_senior_managers) || 0) + (Number(r.num_newbies) || 0);
  const prosIn = r => (Number(r.num_distributors) || 0) + (Number(r.num_senior_managers) || 0);

  function rankOffices(reps, offices) {
    const by = {};
    reps.forEach(r => {
      const b = by[r.office_id] = by[r.office_id]
        || { office_id: r.office_id, orders: 0, amount: 0, people: 0, pros: 0, weeks: 0 };
      b.orders += Number(r.orders) || 0;
      b.amount += Number(r.amount) || 0;
      /* Orders and money accumulate over the weeks in view. The room does
         not — the same people come back — so it is the largest week, not
         the sum of them. */
      b.people = Math.max(b.people, peopleIn(r));
      b.pros = Math.max(b.pros, prosIn(r));
      b.weeks += 1;
    });
    offices.forEach(o => {
      by[o.id] = by[o.id] || { office_id: o.id, orders: 0, amount: 0, people: 0, pros: 0, weeks: 0, missing: true };
    });
    const rows = Object.values(by)
      .map(r => Object.assign(r, { office: A.officeById(r.office_id) }))
      .filter(r => r.office);

    /* What each earner brought in. An office that has filed but put no
       pros in the room scores zero here rather than dividing by nothing. */
    rows.forEach(r => { r.perPro = r.pros ? r.amount / r.pros : 0; });

    /* Divide by the leader in each column. The || 1 is what stops a group
       where nobody sold anything from dividing by zero. */
    const top = k => rows.reduce((m, r) => Math.max(m, r[k]), 0) || 1;
    const bestAmount = top('amount'), bestPerPro = top('perPro'), bestPeople = top('people');
    rows.forEach(r => {
      r.score = Math.round(100 * (
        RANK_W.amount * (r.amount / bestAmount)
        + RANK_W.perPro * (r.perPro / bestPerPro)
        + RANK_W.people * (r.people / bestPeople)));
    });
    return rows
      .sort((a, b) => b.score - a.score || b.amount - a.amount || b.orders - a.orders)
      .map((r, i) => Object.assign(r, { rank: i + 1 }));
  }

  /* Grouped by lower-case, so "AI video" and "ai video" are one product
     rather than two, whatever mix of casing the database happens to
     hold. Displayed under whichever spelling was written most often —
     the label a count like this is read against should be the one
     people actually typed, not just the first one that happened to be
     seen. */
  function nicheTally(reps) {
    const counts = {}, labels = {};
    reps.forEach(r => (r.niches || []).forEach(n => {
      const key = String(n).trim().toLowerCase();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
      labels[key] = labels[key] || {};
      labels[key][n] = (labels[key][n] || 0) + 1;
    }));
    return Object.keys(counts)
      .map(key => {
        const spellings = Object.entries(labels[key]).sort((a, b) => b[1] - a[1]);
        return [spellings[0][0], counts[key]];
      })
      .sort((a, b) => b[1] - a[1]);
  }

  /* The score decides the order — it does not have to be read as a
     number to do that. Four bands turn it into a word instead, which is
     what the evaluation list shows: the grade an office earned, not the
     arithmetic behind it. */
  const GRADE_BANDS = [[80, 'Excellent', 't-ok'], [60, 'Good', 't-gold'],
    [40, 'Fair', 't-warn'], [0, 'Starting', 't-mute']];
  const grade = score => (GRADE_BANDS.find(b => score >= b[0]) || GRADE_BANDS[GRADE_BANDS.length - 1]);

  /* The standing, as a card. Used on the evaluation list and anywhere
     else a ranking has to be read rather than worked through — graded,
     not scored: the rank and the grade are shown, the number behind
     them is not. */
  function rankCard(ranked, title, sub) {
    const rows = ranked.filter(r => !r.missing);
    return '<div class="card"><div class="card-h"><div>'
      + '<div class="card-t">' + esc(title) + '</div>'
      + '<div class="card-s">' + esc(sub) + '</div></div></div>'
      + table([{ label: '#' }, { label: 'Office' }, { label: 'Amount', num: true },
      { label: 'Per pro', num: true }, { label: 'People', num: true },
      { label: 'Grade' }],
        rows.map(r => { const g = grade(r.score); return '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
          + '<td><span class="rk rk-' + r.rank + '">' + r.rank + '</span></td>'
          + '<td class="nm">' + esc(r.office.name) + '</td>'
          + '<td class="num nm">' + usdFull(r.amount) + '<div class="sub">' + r.orders + ' orders</div></td>'
          + '<td class="num">' + usdFull(r.perPro) + '<div class="sub">' + r.pros + ' pros</div></td>'
          + '<td class="num">' + r.people + '</td>'
          + '<td>' + tag(g[1], g[2]) + '</td></tr>'; }),
        { empty: empty('crown', 'Nothing to rank yet', 'Rankings appear as soon as offices file.') })
      + '</div>';
  }

  const link = (page, id) => '#/' + page + (id ? '/' + id : '');

  const centerPick = (sel, act) => '<select class="select" data-act="' + act + '" style="max-width:230px">'
    + A.store.centers.map(c => '<option value="' + c.id + '" ' + (c.id === sel ? 'selected' : '') + '>'
      + esc(c.name) + '</option>').join('') + '</select>';

  const statusTag = st => LEADER.includes(st) ? tag(st, 't-gold')
    : SM_PLUS.includes(st) ? tag(st, 't-ok') : tag(st, 't-mute');

  const evalLine = (ws) => 'Read at the zone evaluation on ' + esc(U.fullDate(U.evalDate(ws))) + ' at 2:45pm.';

  /* ===================================================================
     DASHBOARD
     =================================================================== */
  async function adminDash() {
    const ws = S().week, prev = U.iso(U.addDays(ws, -7));
    const hist = U.recentWeeks(8).reverse();
    const [reps, prevReps, histReps] = await Promise.all([
      A.reports.list({ week: ws }),
      A.reports.list({ week: prev }),
      A.reports.list({ weeks: hist })
    ]);
    const t = totals(reps), p = totals(prevReps);
    const offices = A.store.offices.filter(o => o.active);
    const ranked = rankOffices(reps, offices);
    const top = ranked.find(r => !r.missing);
    const missing = ranked.filter(r => r.missing);

    const series = hist.map(w => ({
      l: 'W' + U.weekNo(w),
      v: sumBy(histReps.filter(r => r.week_start === w), r => r.amount)
    }));

    const centerRows = A.store.centers.map(c => {
      const rs = reps.filter(r => r.center_id === c.id);
      const os = A.officesOf(c.id).filter(o => o.active);
      return { c, os, ...totals(rs) };
    }).sort((a, b) => b.amount - a.amount);
    const maxCenter = Math.max.apply(null, centerRows.map(r => r.amount).concat([1]));

    return {
      title: 'Dashboard', picker: 'week',
      crumbs: esc(U.weekLabel(ws)) + (U.weekClosed(ws) ? '' : ' · ' + U.weekClosesLabel(ws)),
      html:
        (!A.store.centers.length ? note('gold', 'info',
          A.isSuper()
            ? '<b>No zones yet.</b> Create your first zone under <a href="' + link('admin') + '" style="text-decoration:underline">Zones &amp; admins</a>, then send your offices the site address so they can ask to join.'
            : '<b>No zones yet.</b> Ask the Super Admin to create one, then send your offices the site address so they can ask to join.') + '<div style="height:18px"></div>' : '')
        + '<div class="grid g4">'
        + kpi('Orders this week', t.orders.toLocaleString(), U.change(t.orders, p.orders), 'trend')
        + kpi('Amount this week', usd(t.amount), U.change(t.amount, p.amount), 'cash', 'kpi-blue')
        + kpi('Reports in', t.count + ' of ' + offices.length,
          missing.length ? esc(missing.length + ' still missing') : 'Every office has filed', 'file')
        + kpi('Leading office', top ? esc(top.office.name) : '—',
          top ? usdFull(top.amount) + ' · ' + top.orders + ' orders' : 'No reports filed yet', 'crown', 'kpi-dark')
        + '</div>'
        + '<div class="card" style="margin-top:18px"><div class="card-h"><div>'
        + '<div class="card-t">The room this week</div>'
        + '<div class="card-s">Headcount across every office that filed.</div></div></div>'
        + roomRow(t) + '</div>'

        + '<div class="grid g-2-1" style="margin-top:18px">'
        + '<div class="card"><div class="card-h"><div><div class="card-t">Amount by week</div>'
        + '<div class="card-s">Every office, the last eight weeks.</div></div>'
        + '<div class="card-a">' + chartToggle(S().chartType) + '</div></div>'
        + chart(series, series.length - 1, S().chartType) + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Zones this week</div>'
        + '<div class="card-s">' + RANK_BASIS + '</div></div></div>'
        + (centerRows.length ? centerRows.map(r =>
          '<a href="' + link('centers', r.c.id) + '" style="display:block;padding:11px 0;border-bottom:1px solid #edf0f7">'
          + '<div class="spread"><div class="nm">' + esc(r.c.name) + '</div>'
          + '<div class="num nm">' + usd(r.amount) + '</div></div>'
          + '<div style="margin-top:7px">' + bar(r.amount, maxCenter, true) + '</div>'
          + '<div class="sub">' + r.count + ' of ' + r.os.length + ' offices filed · ' + r.orders + ' orders</div></a>').join('')
          : empty('layers', 'No zones yet', A.isSuper()
            ? 'Create a zone and its offices can start filing.'
            : 'Ask the Super Admin to create one.'))
        + '</div></div>'
    };
  }

  async function officeDash() {
    const me = A.store.me, off = me.office, ws = S().week;
    const prev = U.iso(U.addDays(ws, -7));
    const hist = U.recentWeeks(8).reverse();
    const [mine, prevMine, centerReps, histReps, dists, evs] = await Promise.all([
      A.reports.get(off.id, ws),
      A.reports.get(off.id, prev),
      A.reports.list({ week: ws, center: off.center_id }),
      A.reports.list({ weeks: hist, office: off.id }),
      A.distributors.list({ office: off.id }),
      A.events.list({ week: ws, center: off.center_id })
    ]);
    const ranked = rankOffices(centerReps, A.officesOf(off.center_id).filter(o => o.active));
    const meRank = ranked.find(r => r.office_id === off.id) || {};
    const series = hist.map(w => {
      const r = histReps.find(x => x.week_start === w);
      return { l: 'W' + U.weekNo(w), v: r ? Number(r.amount) : 0 };
    });
    const scanCounts = evs.length ? await A.scans.forEvents(evs.map(e => e.id)) : [];
    const mineScans = scanCounts.filter(s => s.office_id === off.id && s.status === 'accepted');

    return {
      title: 'Dashboard', picker: 'week',
      crumbs: esc(off.name + ' · ' + ((A.centerById(off.center_id) || {}).name || '')),
      html:
        /* Last week first: it is the one about to be locked, and a late
           joiner would otherwise never learn they could still file it. */
        ((() => {
          const lastWk = U.iso(U.addDays(U.weekStart(), -7));
          if (prevMine || ws !== U.weekStart()) return '';
          return note('warn', 'alert',
            '<b>Last week is missing.</b> ' + esc(U.weekRange(lastWk))
            + ' has no report, and once the week now running closes it can no longer be filed. '
            + '<a href="#" data-act="go-week" data-v="' + lastWk
            + '" style="text-decoration:underline;font-weight:600">Fill it now</a>.')
            + '<div style="height:18px"></div>';
        })())
        + (!mine && !U.weekClosed(ws) ? note('gold', 'alert',
          '<b>Your ' + esc(U.weekName(ws)) + ' report is not in.</b> ' + evalLine(ws)
          + ' <a href="' + link('reports') + '" style="text-decoration:underline;font-weight:600">Fill it now</a>.')
          + '<div style="height:18px"></div>' : '')
        /* The room, against the names on file. A distributor with no
           record cannot scan in, so a gap here is a gap in attendance. */
        + ((() => {
          const named = dists.filter(d => d.active !== false).length;
          const claimed = mine ? peopleIn(mine) : 0;
          if (claimed <= named) return '';
          return note('warn', 'users',
            '<b>' + (claimed - named) + ' of your ' + claimed + ' are not on the list by name.</b> '
            + 'Only the ' + named + ' on file can scan in at a training. '
            + '<a href="' + link('distributors') + '" style="text-decoration:underline;font-weight:600">Add them now</a>.')
            + '<div style="height:18px"></div>';
        })())
        + '<div class="grid g4">'
        + kpi('Your orders', mine ? Number(mine.orders).toLocaleString() : '—',
          mine ? U.change(mine.orders, prevMine ? prevMine.orders : 0) : 'No report for this week', 'trend')
        + kpi('Your amount', mine ? usd(mine.amount) : '—',
          mine ? U.change(mine.amount, prevMine ? prevMine.amount : 0) : 'Nothing filed yet', 'cash', 'kpi-blue')
        + kpi('Rank in zone', meRank.rank ? '#' + meRank.rank + ' of ' + ranked.length : '—',
          ranked.length ? esc((A.centerById(off.center_id) || {}).name || '') : '', 'crown', 'kpi-dark')
        + kpi('Distributors', dists.length.toLocaleString(),
          dists.filter(d => SM_PLUS.includes(d.status)).length + ' Senior Manager and above', 'users')
        + '</div>'

        + '<div class="grid g-2-1" style="margin-top:18px">'
        + '<div class="card"><div class="card-h"><div><div class="card-t">Your amount by week</div>'
        + '<div class="card-s">The last eight weeks you filed.</div></div>'
        + '<div class="card-a">' + chartToggle(S().chartType) + '</div></div>'
        + chart(series, series.length - 1, S().chartType) + '</div>'

        + '<div class="stack">'
        + '<div class="card"><div class="card-h"><div><div class="card-t">This week in your zone</div>'
        + '<div class="card-s">' + RANK_BASIS + '</div></div></div>'
        + (ranked.length ? ranked.slice(0, 6).map(r =>
          '<div class="spread" style="padding:9px 0;border-bottom:1px solid #edf0f7">'
          + '<div class="row" style="gap:9px"><span class="rk rk-' + r.rank + '">' + r.rank + '</span>'
          + '<span class="' + (r.office_id === off.id ? 'nm' : '') + '">' + esc(r.office.name)
          + (r.office_id === off.id ? ' <span class="tag t-ok">You</span>' : '') + '</span></div>'
          + '<div class="num nm">' + (r.missing ? '<span style="color:var(--faint)">—</span>' : usd(r.amount)) + '</div></div>').join('')
          : empty('crown', 'No reports yet', 'Once offices in your zone file, the ranking appears.'))
        + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Attendance this week</div>'
        + '<div class="card-s">Your distributors, across this week\'s sessions.</div></div></div>'
        + (evs.length ? evs.map(e => {
          const a = mineScans.filter(s => s.event_id === e.id).length;
          return '<div class="spread" style="padding:9px 0;border-bottom:1px solid #edf0f7">'
            + '<div><div class="nm">' + esc(e.name) + '</div><div class="sub">' + esc(U.fullDate(e.event_date))
            + ' · ' + esc(e.event_time) + '</div></div>'
            + '<div class="num nm">' + a + '</div></div>';
        }).join('') : empty('qr', 'No sessions this week', 'Trainings appear here once the week opens.'))
        + '</div></div></div>'
    };
  }

  /* ===================================================================
     EVALUATION LIST  (admin)
     =================================================================== */
  async function evaluation() {
    /* Its own week, defaulting to the one that closed rather than the one
       still running: an evaluation always reads the seven days behind it. */
    const ws = S().evalWeek, prev = U.iso(U.addDays(ws, -7));
    const cid = S().center || (A.store.centers[0] || {}).id;
    if (!cid) return { title: 'Evaluation list', html: empty('layers', 'No zones yet', 'Create a zone first.') };
    const [reps, prevReps] = await Promise.all([
      A.reports.list({ week: ws, center: cid }),
      A.reports.list({ week: prev, center: cid })
    ]);
    const offs = A.officesOf(cid).filter(o => o.active);
    const ranked = rankOffices(reps, offs);
    const t = totals(reps);
    const c = A.centerById(cid);

    return {
      title: 'Evaluation list', picker: 'evalweek',
      crumbs: esc(U.weekRange(ws)),
      html: '<div class="card"><div class="card-h">'
        + '<div><div class="card-t">' + esc(c.name) + '</div>'
        + '<div class="card-s">The seven days from <b>' + esc(U.weekRange(ws)) + '</b>, '
        + 'read at the evaluation on ' + esc(U.fullDate(U.evalDate(ws))) + '.</div></div>'
        + '<div class="card-a row" style="gap:8px">' + centerPick(cid, 'center')
        + '<button class="btn btn-sm btn-a" data-act="eval-pdf" data-center="' + cid + '" data-week="' + ws + '">'
        + ico('file', 14) + 'Download as PDF</button></div></div>'
        + '<div class="grid g4" style="margin-bottom:4px">'
        + kpi('Offices', offs.length, '', 'building')
        + kpi('Filed', t.count + ' of ' + offs.length, '', 'file', t.count === offs.length ? 'kpi-blue' : '')
        + kpi('Orders', t.orders.toLocaleString(), '', 'trend')
        + kpi('Amount', usd(t.amount), '', 'cash', 'kpi-dark')
        + '</div>' + roomRow(t) + '</div>'

        + rankCard(ranked, 'How the zone ranks', RANK_BASIS)

        /* Everything about an office's week, in one row: the two amounts
           either side of it, the room it filed with, and what it is
           working on. This is what gets read out on the Wednesday, so
           nothing that matters should be a click away from it. */
        + '<div class="card">' + table(
          [{ label: '#' }, { label: 'Office' }, { label: 'Last week', num: true }, { label: 'This week', num: true },
          { label: 'Move', num: true }, { label: 'Room' }, { label: 'Niches' }, { label: 'New' }, { label: 'Issues raised' }],
          ranked.map(r => {
            const rep = reps.find(x => x.office_id === r.office_id);
            const pr = prevReps.find(x => x.office_id === r.office_id);
            if (!rep) {
              return '<tr><td><span class="rk">—</span></td>'
                + '<td class="nm">' + esc(r.office.name)
                + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
                + '<td class="num">' + (pr ? usdFull(pr.amount) + '<div class="sub">' + pr.orders + ' orders</div>' : '—') + '</td>'
                + '<td class="num" colspan="7">' + tag('No report filed', 't-warn') + '</td></tr>';
            }
            return '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
              + '<td><span class="rk rk-' + r.rank + '">' + r.rank + '</span></td>'
              + '<td><div class="nm">' + esc(r.office.name) + '</div>'
              + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
              + '<td class="num">' + (pr ? usdFull(pr.amount) + '<div class="sub">' + pr.orders + ' orders</div>' : '—') + '</td>'
              + '<td class="num nm">' + usdFull(rep.amount) + '<div class="sub">' + rep.orders + ' orders</div></td>'
              + '<td class="num">' + (pr ? U.change(rep.amount, pr.amount) : '<span class="sub">first week</span>') + '</td>'
              + '<td class="sub">' + peopleIn(rep) + ' people<div class="sub">'
              + rep.num_distributors + ' dist · ' + rep.num_senior_managers + ' SM · ' + rep.num_newbies + ' new</div></td>'
              + '<td>' + ((rep.niches || []).map(n => tag(n)).join(' ') || '<span class="sub">—</span>') + '</td>'
              + '<td>' + ((rep.new_niches || []).map(n => tag(n, 't-dark')).join(' ') || '<span class="sub">—</span>') + '</td>'
              + '<td style="max-width:260px;white-space:normal">' + esc(rep.issues || '—') + '</td></tr>';
          }),
          { empty: empty('clipboard', 'No offices in this zone', 'Offices appear here once they sign up and you approve them.') })
        + '</div>'
    };
  }

  /* ===================================================================
     MONTHLY SUMMARY
     =================================================================== */
  async function monthly() {
    const key = S().month || U.currentMonthNo();
    const weeks = U.weeksOfMonth(key).filter(U.weekStarted);   // oldest first, already
    if (!weeks.length) return { title: 'Monthly summary', picker: 'month', html: empty('calendar', 'Nothing for this month', 'Pick another month.') };
    const mine = A.isOffice() ? A.store.me.office_id : null;
    const reps = await A.reports.list(mine ? { weeks, office: mine } : { weeks });
    const t = totals(reps);
    const offices = A.store.offices.filter(o => o.active);
    const ranked = rankOffices(reps, mine ? [] : offices).filter(r => !r.missing);
    const tally = nicheTally(reps);
    const series = weeks.map(w => ({
      l: 'W' + U.weekNo(w), v: sumBy(reps.filter(r => r.week_start === w), r => r.amount)
    }));

    return {
      title: 'Monthly summary', picker: 'month', crumbs: esc(U.monthLabel(key)),
      html: '<div class="grid g4">'
        + kpi('Orders', t.orders.toLocaleString(), esc(weeks.length + ' weeks'), 'trend')
        + kpi('Amount', usd(t.amount), '', 'cash', 'kpi-blue')
        + kpi('Reports filed', t.count, mine ? '' : esc('across ' + offices.length + ' offices'), 'file')
        + kpi(mine ? 'Best week' : 'Best office',
          mine ? (series.length ? series.reduce((a, b) => b.v > a.v ? b : a, series[0]).l : '—')
            : (ranked[0] ? esc(ranked[0].office.name) : '—'),
          mine ? '' : (ranked[0] ? usdFull(ranked[0].amount) : ''), 'crown', 'kpi-dark')
        + '</div>'

        + '<div class="grid g-2-1" style="margin-top:18px">'
        + '<div class="card"><div class="card-h"><div><div class="card-t">Week by week</div>'
        + '<div class="card-s">' + esc(U.monthLabel(key)) + ', amount per week.</div></div>'
        + '<div class="card-a">' + chartToggle(S().chartType) + '</div></div>'
        + chart(series, -1, S().chartType) + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Niches this month</div>'
        + '<div class="card-s">How often each product carried the orders.</div></div></div>'
        + (tally.length ? tally.slice(0, 10).map(([n, c]) =>
          '<div class="spread" style="padding:8px 0;border-bottom:1px solid #edf0f7">'
          + '<div>' + esc(n) + '</div><div class="row" style="width:120px">' + bar(c, tally[0][1], true)
          + '<span class="num nm" style="width:26px">' + c + '</span></div></div>').join('')
          : empty('star', 'No niches yet', 'They come from the weekly reports.'))
        + '</div></div>'

        + (mine ? '' : '<div class="card" style="margin-top:18px">'
          + '<div class="card-h"><div><div class="card-t">Offices this month</div>'
          + '<div class="card-s">' + RANK_BASIS.replace('.', ',') + ' across ' + weeks.length + ' weeks.</div></div></div>'
          + table([{ label: '#' }, { label: 'Office' }, { label: 'Zone' }, { label: 'Reports', num: true },
          { label: 'Orders', num: true }, { label: 'Amount', num: true }],
            ranked.map(r => '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
              + '<td><span class="rk rk-' + r.rank + '">' + r.rank + '</span></td>'
              + '<td class="nm">' + esc(r.office.name) + '</td>'
              + '<td>' + esc((A.centerById(r.office.center_id) || {}).name || '—') + '</td>'
              + '<td class="num">' + reps.filter(x => x.office_id === r.office_id).length + '</td>'
              + '<td class="num">' + r.orders + '</td>'
              + '<td class="num nm">' + usdFull(r.amount) + '</td></tr>'),
            { empty: empty('file', 'No reports this month', 'Nothing was filed in ' + U.monthLabel(key) + '.') })
          + '</div>')
    };
  }

  /* ===================================================================
     CENTERS
     =================================================================== */
  async function centers(id) {
    if (id) return centerDetail(id);
    const ws = S().week;
    const reps = await A.reports.list({ week: ws });
    const rowsHtml = A.store.centers.map(c => {
      const os = A.officesOf(c.id).filter(o => o.active);
      const rs = reps.filter(r => r.center_id === c.id);
      const t = totals(rs);
      return '<tr class="click" data-href="' + link('centers', c.id) + '">'
        + '<td class="nm">' + esc(c.name) + '</td>'
        + '<td>' + esc(c.leader_name || '—') + '<div class="sub">' + esc(c.assistant_name || '') + '</div></td>'
        + '<td class="num">' + os.length + '</td>'
        + '<td class="num">' + t.count + ' of ' + os.length + '</td>'
        + '<td class="num nm">' + usdFull(t.amount) + '</td></tr>';
    });
    return {
      title: 'Zones', picker: 'week',
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Every zone</div>'
        + '<div class="card-s">Numbers are for ' + esc(U.weekLabel(ws)) + '.</div></div>'
        + (A.isSuper() ? '<div class="card-a"><button class="btn btn-a btn-pop" data-act="center-new">'
          + ico('plus', 15) + 'New zone</button></div>' : '') + '</div>'
        + table([{ label: 'Zone' }, { label: 'Zone leader' }, { label: 'Offices', num: true },
        { label: 'Filed', num: true }, { label: 'Amount', num: true }], rowsHtml,
          { empty: empty('layers', 'No zones yet', 'A zone holds its own offices and runs its own Wednesday evaluation.',
            A.isSuper() ? '<button class="btn btn-a btn-pop" data-act="center-new">' + ico('plus', 15) + 'Create the first zone</button>' : '') })
        + '</div>'
    };
  }

  async function centerDetail(id) {
    const c = A.centerById(id);
    if (!c) return { title: 'Zone', html: empty('layers', 'Zone not found', 'It may have been removed.') };
    const offs = A.officesOf(id).filter(o => o.active);
    const mn = U.currentMonthNo();
    const weeks = U.weeksOfMonth(mn).filter(U.weekStarted);
    const reps = await A.reports.list({ weeks, center: id });
    const ranked = rankOffices(reps, offs);
    const t = totals(reps);

    const perWeek = weeks.map(w => {
      const rs = reps.filter(r => r.week_start === w);
      return { w, ...totals(rs) };
    });
    const maxWeek = Math.max.apply(null, perWeek.map(r => r.amount).concat([1]));

    return {
      title: c.name, crumbs: '<a href="' + link('centers') + '">Zones</a> · ' + esc(U.monthLabel(mn)),
      html: '<div class="grid g4">'
        + kpi('Offices', offs.length, '', 'building')
        + kpi('Zone leader', esc(c.leader_name || '—'), esc(c.assistant_name ? 'Assistant: ' + c.assistant_name : ''), 'crown', 'kpi-dark')
        + kpi('Orders this month', t.orders.toLocaleString(), '', 'trend')
        + kpi('Amount this month', usd(t.amount), t.count + ' of ' + offs.length + ' filed', 'cash', 'kpi-blue')
        + '</div>'

        + '<div class="card" style="margin-top:18px"><div class="card-h"><div>'
        + '<div class="card-t">The zone, week by week</div>'
        + '<div class="card-s">' + esc(U.monthLabel(mn)) + ' so far.</div></div></div>'
        + (perWeek.length ? table([{ label: 'Week' }, { label: 'Orders', num: true }, { label: 'Amount', num: true }, { label: '' }],
          perWeek.map(r => '<tr><td class="nm">Week ' + U.weekOfMonth(r.w)
            + '<div class="sub">' + esc(U.weekRange(r.w)) + '</div></td>'
            + '<td class="num">' + r.orders + '</td>'
            + '<td class="num nm">' + usdFull(r.amount) + '</td>'
            + '<td style="width:150px">' + bar(r.amount, maxWeek, r.amount === maxWeek) + '</td></tr>'))
          : empty('calendar', 'Nothing filed yet', 'The week-by-week view fills in as offices file.'))
        + '</div>'

        + '<div class="card" style="margin-top:18px"><div class="card-h"><div>'
        + '<div class="card-t">Offices ranked</div><div class="card-s">' + esc(U.monthLabel(mn)) + '.</div></div>'
        + (A.isSuper() ? '<div class="card-a"><button class="btn btn-sm" data-act="center-edit" data-id="' + c.id + '">'
          + ico('edit', 14) + 'Edit zone</button></div>' : '') + '</div>'
        + table([{ label: '#' }, { label: 'Office' }, { label: 'Orders', num: true }, { label: 'Amount', num: true }],
          ranked.map(r => '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
            + '<td><span class="rk rk-' + r.rank + '">' + (r.missing ? '—' : r.rank) + '</span></td>'
            + '<td class="nm">' + esc(r.office.name)
            + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
            + '<td class="num">' + (r.missing ? tag('Not filed', 't-warn') : r.orders) + '</td>'
            + '<td class="num nm">' + (r.missing ? '—' : usdFull(r.amount)) + '</td></tr>'),
          { empty: empty('building', 'No offices yet', 'Offices pick this zone when they sign up, and appear once approved.') })
        + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Attendance</div>'
        + '<div class="card-s">Trainings and scanning for this zone.</div></div></div>'
        + note('info', 'qr', '<b>Coming soon.</b>') + '</div>'
    };
  }

  const statusTagEvent = e => e.status === 'open' ? tag('Scanning open', 't-ok')
    : e.status === 'scheduled' ? tag('Scheduled', 't-b') : tag('Closed', 't-mute');

  /* ===================================================================
     OFFICES
     =================================================================== */
  async function offices(id) {
    if (id) return officeDetail(id);
    const ws = S().week;
    /* An office sees its own zone and no further. Row level security says
       the same thing, so this only keeps the page honest about it. */
    const own = A.isOffice() ? A.store.me.center_id : null;
    const [reps, dists] = await Promise.all([
      A.reports.list(own ? { week: ws, center: own } : { week: ws }),
      A.distributors.list(own ? { center: own } : {})
    ]);
    const list = A.store.offices.filter(o => o.active && (!own || o.center_id === own));
    const zoneName = own ? ((A.centerById(own) || {}).name || 'your zone') : null;
    return {
      title: own ? 'Offices in your zone' : 'Offices', picker: 'week',
      html: '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">' + (own ? esc(zoneName) : 'Every office') + '</div>'
        + '<div class="card-s">' + list.length + ' office' + (list.length === 1 ? '' : 's')
        + ' · numbers are for ' + esc(U.weekLabel(ws)) + '.</div></div></div>'
        + table([{ label: 'Office' }, { label: 'Zone' }, { label: 'Team leader' }, { label: 'Distributors', num: true },
        { label: 'Orders', num: true }, { label: 'Amount', num: true }],
          list.map(o => {
            const r = reps.find(x => x.office_id === o.id);
            return '<tr class="click" data-href="' + link('offices', o.id) + '">'
              + '<td class="nm">' + esc(o.name) + '</td>'
              + '<td>' + esc((A.centerById(o.center_id) || {}).name || '—') + '</td>'
              + '<td>' + esc(o.manager_name || '—') + '<div class="sub">' + esc(o.email || '') + '</div></td>'
              + '<td class="num">' + dists.filter(d => d.office_id === o.id).length + '</td>'
              + '<td class="num">' + (r ? r.orders : tag('Not filed', 't-warn')) + '</td>'
              + '<td class="num nm">' + (r ? usdFull(r.amount) : '—') + '</td></tr>';
          }),
          { empty: empty('building', 'No offices yet', 'An office signs up on this site, picks its zone, and appears once you approve it.') })
        + '</div>'
    };
  }

  async function officeDetail(id) {
    const o = A.officeById(id);
    if (!o) return { title: 'Office', html: empty('building', 'Office not found', 'It may have been removed.') };
    const mn = U.currentMonthNo();
    const monthWeeks = U.weeksOfMonth(mn).filter(U.weekStarted);
    /* All-time for the top three numbers; the zone's reports for the
       month, so each week below can be ranked against the offices it
       was actually filed alongside rather than read in isolation. */
    const [reps, dists, zoneReps] = await Promise.all([
      A.reports.list({ office: id }),
      A.distributors.list({ office: id }),
      A.reports.list({ weeks: monthWeeks, center: o.center_id })
    ]);
    const t = totals(reps);
    const zoneOffices = A.officesOf(o.center_id).filter(x => x.active);

    /* One row per week of the current month. Ranked week by week, not
       against the month as a whole, because "the office ranking for the
       week" means exactly that week's standing. */
    const perf = monthWeeks.map(w => {
      const rep = reps.find(r => r.week_start === w);
      const ranked = rankOffices(zoneReps.filter(r => r.week_start === w), zoneOffices);
      const mine = ranked.find(r => r.office_id === id);
      return {
        w, rep,
        rank: mine && !mine.missing ? mine.rank : null,
        rankOf: ranked.filter(r => !r.missing).length,
        people: rep ? peopleIn(rep) : 0,
        perDist: rep && rep.num_distributors ? rep.amount / rep.num_distributors : 0
      };
    }).reverse();          // most recent week first

    const perfRow = (p) => '<div class="perf-wk' + (p.rep ? ' click' : '') + '"'
      + (p.rep ? ' data-act="week-detail" data-office="' + id + '" data-week="' + p.w + '"' : '') + '>'
      + '<div class="perf-wk-t"><div class="nm">Week ' + U.weekOfMonth(p.w) + '</div>'
      + '<div class="sub">' + esc(U.weekRange(p.w)) + '</div></div>'
      + (p.rep
        ? '<div class="perf-wk-m">'
        + '<div><div class="perf-v">' + usdFull(p.perDist) + '</div><div class="perf-l">Per distributor</div></div>'
        + '<div><div class="perf-v">' + p.rep.orders + ' · ' + usdFull(p.rep.amount) + '</div><div class="perf-l">Orders · amount</div></div>'
        + '<div><div class="perf-v">' + p.people + '</div><div class="perf-l">People</div></div>'
        + '<div><div class="perf-v">' + (p.rank ? '#' + p.rank + ' of ' + p.rankOf : '—') + '</div><div class="perf-l">Zone rank</div></div>'
        + '</div>' + ico('right', 16)
        : '<div class="perf-wk-m"><span class="sub">Not filed</span></div>')
      + '</div>';

    return {
      title: o.name,
      crumbs: '<a href="' + link('offices') + '">Offices</a> · ' + esc((A.centerById(o.center_id) || {}).name || ''),
      html: (A.isSuper()
        ? '<div class="card"><div class="card-h"><div><div class="card-t">Zone</div>'
        + '<div class="card-s">Moving the office brings its reports, its distributors and its '
        + 'account with it. Nothing is left behind in the old zone.</div></div></div>'
        + '<div class="row" style="gap:10px;flex-wrap:wrap">'
        + '<select class="select" id="mv-zone" style="max-width:280px">'
        + A.store.centers.map(c => '<option value="' + c.id + '"'
          + (c.id === o.center_id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')
        + '</select>'
        + '<button class="btn btn-p" data-act="office-move" data-id="' + o.id + '">'
        + ico('layers', 15) + 'Move office</button>'
        + '<button class="btn btn-d" style="margin-left:auto" data-act="office-del"'
        + ' data-id="' + o.id + '" data-name="' + esc(o.name) + '">'
        + ico('trash', 15) + 'Delete office</button></div></div>'
        : '')
        + '<div class="grid g3">'
        + kpi('Reports filed', reps.length, 'all time', 'file')
        + kpi('Total orders', t.orders.toLocaleString(), 'all time', 'trend')
        + kpi('Total amount', usd(t.amount), 'all time', 'cash', 'kpi-blue')
        + '</div>'

        + '<div class="card" style="margin-top:18px"><div class="card-h"><div>'
        + '<div class="card-t">Performance</div>'
        + '<div class="card-s">' + esc(U.monthLabel(mn)) + '. Tap a week for the full report.</div></div></div>'
        + (perf.length ? perf.map(perfRow).join('')
          : empty('calendar', 'Nothing to show yet', 'The performance list fills in once this office files.'))
        + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Distributors · ' + dists.length + '</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Status' }, { label: 'Phone' }],
          dists.map(d => '<tr><td class="nm">' + esc(d.full_name) + '</td>'
            + '<td>' + statusTag(d.status) + '</td><td>' + esc(d.phone || '—') + '</td></tr>'),
          { empty: empty('users', 'No distributors', 'The office adds them from its own Distributors page.') })
        + '</div>'
    };
  }

  /* ===================================================================
     NICHES
     ---------------------------------------------------------------
     What is actually selling, across everything and then zone by zone.
     Counted by the number of reports a product appears on rather than
     by money, because a niche is a thing offices are working on — the
     question is how many of them are working on it.
     =================================================================== */
  async function niches() {
    const weeks = U.recentWeeks(window.CONFIG.weeksShown || 12);
    const reps = await A.reports.list({ weeks });
    const overall = nicheTally(reps);
    const maxAll = overall.length ? overall[0][1] : 1;

    /* Same tally, cut by zone. Zones with nothing filed are left out
       rather than shown as an empty table. */
    const zones = A.store.centers.map(c => {
      const rs = reps.filter(r => r.center_id === c.id);
      return { c, rs, tally: nicheTally(rs) };
    }).filter(z => z.tally.length);

    const brandNew = {};
    reps.forEach(r => (r.new_niches || []).forEach(n => {
      brandNew[n] = brandNew[n] || { n, weeks: new Set() };
      brandNew[n].weeks.add(r.week_start);
    }));
    const fresh = Object.values(brandNew).sort((a, b) => b.weeks.size - a.weeks.size).slice(0, 12);

    return {
      title: 'Niches',
      crumbs: 'The last ' + weeks.length + ' weeks',
      html: '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">Most popular across every zone</div>'
        + '<div class="card-s">' + overall.length + ' product'
        + (overall.length === 1 ? '' : 's') + ' on ' + reps.length + ' report'
        + (reps.length === 1 ? '' : 's') + ', counted by how many reports each appears on.</div></div></div>'
        + table([{ label: '#' }, { label: 'Niche' }, { label: 'Reports', num: true }, { label: '' }],
          overall.map((n, i) => '<tr>'
            + '<td><span class="rk rk-' + (i + 1) + '">' + (i + 1) + '</span></td>'
            + '<td class="nm">' + esc(n[0]) + '</td>'
            + '<td class="num nm">' + n[1] + '</td>'
            + '<td style="width:200px">' + bar(n[1], maxAll, i === 0) + '</td></tr>'),
          { empty: empty('layers', 'Nothing yet', 'Niches appear here as offices file their reports.') })
        + '</div>'

        + (fresh.length
          ? '<div class="card"><div class="card-h"><div><div class="card-t">Sold for the first time</div>'
          + '<div class="card-s">Products an office marked as brand new, newest interest first.</div></div></div>'
          + '<div class="chips">' + fresh.map(x => '<span class="chip on">' + esc(x.n)
            + '<b style="margin-left:7px;opacity:.7">' + x.weeks.size + '</b></span>').join('')
          + '</div></div>'
          : '')

        + zones.map(z => {
          const max = z.tally[0][1];
          return '<div class="card"><div class="card-h"><div>'
            + '<div class="card-t">' + esc(z.c.name) + '</div>'
            + '<div class="card-s">' + z.tally.length + ' product'
            + (z.tally.length === 1 ? '' : 's') + ' across ' + z.rs.length + ' report'
            + (z.rs.length === 1 ? '' : 's') + '.</div></div></div>'
            + table([{ label: '#' }, { label: 'Niche' }, { label: 'Reports', num: true }, { label: '' }],
              z.tally.slice(0, 10).map((n, i) => '<tr>'
                + '<td><span class="rk rk-' + (i + 1) + '">' + (i + 1) + '</span></td>'
                + '<td class="nm">' + esc(n[0]) + '</td>'
                + '<td class="num nm">' + n[1] + '</td>'
                + '<td style="width:180px">' + bar(n[1], max, i === 0) + '</td></tr>'))
            + '</div>';
        }).join('')
    };
  }

  /* ===================================================================
     RANKINGS
     =================================================================== */
  async function rankings() {
    const mn = S().month || U.currentMonthNo();
    const weeks = U.weeksOfMonth(mn).filter(U.weekStarted);
    const reps = await A.reports.list({ weeks });
    const ranked = rankOffices(reps, A.store.offices.filter(o => o.active));

    /* One column per week that has opened so far this month — Week 1
       through however far the month has got, growing to four on its
       own once Week 4 arrives. Ranked by the whole month together;
       what each column shows is just that week's orders. */
    const weekHead = weeks.map(w => ({ label: 'Wk ' + U.weekOfMonth(w), num: true }));
    const ordersFor = (officeId, w) => {
      const rep = reps.find(x => x.office_id === officeId && x.week_start === w);
      return rep ? rep.orders : '—';
    };

    return {
      title: 'Office rankings', picker: 'month', crumbs: esc(U.monthLabel(mn)),
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Office rankings</div>'
        + '<div class="card-s">Every office across every zone. ' + RANK_BASIS
        + ' Orders by week, ' + esc(U.monthLabel(mn)) + '.</div></div></div>'
        + table([{ label: '#' }, { label: 'Office' }, { label: 'Zone' }].concat(weekHead)
          .concat([{ label: 'Amount', num: true }, { label: 'Score', num: true }, { label: '' }]),
          ranked.map(r => '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
            + '<td><span class="rk rk-' + r.rank + '">' + (r.missing ? '—' : r.rank) + '</span></td>'
            + '<td class="nm">' + esc(r.office.name)
            + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
            + '<td>' + esc((A.centerById(r.office.center_id) || {}).name || '—') + '</td>'
            + weeks.map(w => '<td class="num">' + ordersFor(r.office_id, w) + '</td>').join('')
            + '<td class="num nm">' + (r.missing ? tag('Not filed', 't-warn') : usdFull(r.amount)) + '</td>'
            + '<td class="num nm">' + (r.missing ? '—' : r.score) + '</td>'
            + '<td style="width:110px">' + bar(r.score, 100, r.rank === 1) + '</td></tr>'),
          { empty: empty('crown', 'Nothing to rank yet', 'Rankings appear as soon as offices file this month.') })
        + '</div>'
    };
  }

  /* ===================================================================
     REPORTS
     =================================================================== */
  async function reportsView() {
    return A.isOffice() ? officeReports() : adminReports();
  }

  async function adminReports() {
    const ws = S().week;
    const reps = await A.reports.list({ week: ws });
    return {
      title: 'Weekly reports', picker: 'week', crumbs: esc(U.weekLabel(ws)),
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Everything filed this week</div>'
        + '<div class="card-s">' + reps.length + ' of ' + A.store.offices.filter(o => o.active).length
        + ' offices. ' + evalLine(ws) + '</div></div></div>'
        + table([{ label: 'Office' }, { label: 'Zone' }, { label: 'Orders', num: true }, { label: 'Amount', num: true },
        { label: 'Niches' }, { label: 'New niches' }, { label: 'Issues raised' }, { label: 'Filed' }],
          reps.map(r => {
            const o = A.officeById(r.office_id) || {};
            return '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
              + '<td class="nm">' + esc(o.name || '—') + '</td>'
              + '<td>' + esc((A.centerById(r.center_id) || {}).name || '—') + '</td>'
              + '<td class="num">' + r.orders + '</td>'
              + '<td class="num nm">' + usdFull(r.amount) + '</td>'
              + '<td>' + ((r.niches || []).map(n => tag(n)).join(' ') || '—') + '</td>'
              + '<td>' + ((r.new_niches || []).map(n => tag(n, 't-dark')).join(' ') || '—') + '</td>'
              + '<td style="max-width:280px;white-space:normal">' + esc(r.issues || '—') + '</td>'
              + '<td class="sub">' + esc(U.timeAgo(r.submitted_at)) + '</td></tr>';
          }),
          { empty: empty('file', 'Nothing filed for this week', 'Offices file one report a week, before the Wednesday evaluation.') })
        + '</div>'
    };
  }

  async function officeReports() {
    const off = A.store.me.office, ws = S().week;
    /* Three independent queries, so all three go at once. */
    const [mine, all, dists] = await Promise.all([
      A.reports.get(off.id, ws),
      A.reports.list({ office: off.id }),
      A.distributors.list({ office: off.id })
    ]);
    const f = S().form || {};
    const niches = f.niches || (mine ? (mine.niches || []).slice() : []);
    const newNiches = f.newNiches || (mine ? (mine.new_niches || []).slice() : []);
    S().form = { niches, newNiches };

    const closed = U.weekClosed(ws);
    /* This week and the one behind it. Anything older is read only: the
       evaluation has been held and the numbers have been reported on, so
       rewriting them after the fact would change a record people have
       already acted on. */
    const thisWk = U.weekStart();
    const lastWk = U.iso(U.addDays(thisWk, -7));
    const openToFile = ws === thisWk || ws === lastWk;
    const lastFiled = all.some(r => r.week_start === lastWk);

    return {
      title: 'Weekly report', picker: 'week', crumbs: esc(U.weekLabel(ws)),
      html:
        /* The nudge, wherever they are in the picker. */
        (!lastFiled && ws !== lastWk
          ? note('warn', 'alert', '<b>Last week is still not filed.</b> '
            + esc(U.weekRange(lastWk)) + ' is missing, and this is the last week you can '
            + 'still fill it in. <a href="' + link('reports') + '" data-act="go-week" data-v="' + lastWk
            + '" style="text-decoration:underline">Fill it now</a>.') + '<div style="height:16px"></div>'
          : '')

        + '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">' + esc(U.weekName(ws)) + ' · ' + esc(U.weekRange(ws)) + '</div>'
        + '<div class="card-s">' + evalLine(ws) + '</div></div>'
        + '<div class="card-a">' + (mine ? tag('Filed ' + U.timeAgo(mine.submitted_at), 't-ok') : tag('Not filed', 't-warn')) + '</div></div>'

        + (!openToFile
          ? note('info', 'lock', '<b>This week is closed for filing.</b> '
            + 'Its evaluation has been held. You can still fill in <a href="#" data-act="go-week" data-v="'
            + lastWk + '" style="text-decoration:underline">' + esc(U.weekRange(lastWk)) + '</a> '
            + 'and the week running now.')
          : (ws === lastWk && !mine
            ? note('warn', 'alert', '<b>This is last week, and it is your last chance to file it.</b> '
              + 'Once the week now running closes, this one is locked.') + '<div style="height:16px"></div>'
            : ''))

        + (openToFile ? '<form id="report-form">' : '<div class="ro-form" aria-disabled="true">')
        + '<div class="two">'
        + '<div class="field"><label for="f-orders">Number of orders gotten</label>'
        + '<input class="input" id="f-orders" type="number" min="0" step="1" required value="' + (mine ? mine.orders : '') + '" placeholder="0"></div>'
        + '<div class="field"><label for="f-amount">Amount in USD</label>'
        + '<input class="input" id="f-amount" type="number" min="0" step="0.01" required value="' + (mine ? mine.amount : '') + '" placeholder="0"></div>'
        + '</div>'

        + '<div class="g4 gsm">'
        + '<div class="field"><label for="f-dist">Distributors in the office</label>'
        + '<input class="input" id="f-dist" type="number" min="0" step="1" placeholder="0" value="'
        + (mine ? mine.num_distributors : (dists.filter(d => d.status === 'Distributor').length || '')) + '"></div>'
        + '<div class="field"><label for="f-sm">Senior managers</label>'
        + '<input class="input" id="f-sm" type="number" min="0" step="1" placeholder="0" value="'
        + (mine ? mine.num_senior_managers : (dists.filter(d => SM_PLUS.includes(d.status)).length || '')) + '"></div>'
        + '<div class="field"><label for="f-new">Newbies</label>'
        + '<input class="input" id="f-new" type="number" min="0" step="1" placeholder="0" value="'
        + (mine ? mine.num_newbies : '') + '"></div>'
        + '</div>'

        + '<div class="field"><label>Niches and keywords the orders came from</label>'
        + '<div class="chips" id="niche-chips">' + nicheChips(niches) + '</div>'
        + '<div class="combo" style="margin-top:9px"><input class="input" id="niche-input" placeholder="Type a product, or several separated by commas, then press Enter" autocomplete="off">'
        + '<div id="niche-menu"></div></div>'
        + '<div class="hint">Press Enter to add what you typed, and separate several with commas to add them one by one. Anything not already on the list '
        + 'joins the catalogue for every office.</div></div>'

        + '<div class="field"><label>Anything brand new this week?</label>'
        + '<div class="chips" id="new-chips">' + (newNiches.length ? newNiches.map(n =>
          '<span class="chip new">' + esc(n) + '<button type="button" data-act="new-niche-del" data-v="' + esc(n) + '">'
          + ico('x', 12) + '</button></span>').join('') : '<span class="sub">None marked.</span>') + '</div>'
        + '<div class="hint">Tick a niche above then press “Mark as new” to flag a product your office sold for the first time.</div>'
        + '<div class="row" style="margin-top:8px"><input class="input" id="new-niche-input" placeholder="A product sold for the first time" style="max-width:280px">'
        + '<button type="button" class="btn btn-sm" data-act="new-niche-add">' + ico('plus', 14) + 'Mark as new</button></div></div>'

        + '<div class="field"><label for="f-issues">What slowed you down this week?</label>'
        + '<textarea class="input" id="f-issues" placeholder="Anything the zone should hear at the evaluation. Write “No major blockers” if the week ran clean.">'
        + esc(mine ? mine.issues : '') + '</textarea></div>'

        + (openToFile
          ? '<div class="row" style="justify-content:flex-end">'
          /* The week is named on the button as well as at the top of the
             form. The picker opens on the week running now, so filing on
             a Thursday for the seven days that just ended goes to the
             wrong week unless it is changed first — and that is exactly
             how a report ends up one week out. */
          + '<button type="submit" class="btn btn-a btn-pop btn-lg" data-act="report-save">'
          + ico('check', 16) + (mine ? 'Update ' : 'File ') + esc(U.weekName(ws)) + '</button></div>'
          + '</form>'
          : '</div>')
        + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Everything you have filed</div>'
        + '<div class="card-s">' + all.length + ' report' + (all.length === 1 ? '' : 's') + ', newest first.</div></div></div>'
        + table([{ label: 'Week' }, { label: 'Orders', num: true }, { label: 'Amount', num: true }, { label: 'Niches' }, { label: 'Filed' }],
          all.map(r => '<tr><td class="nm">' + esc(U.weekName(r.week_start))
            + '<div class="sub">' + esc(U.weekRange(r.week_start)) + '</div></td>'
            + '<td class="num">' + r.orders + '</td>'
            + '<td class="num nm">' + usdFull(r.amount) + '</td>'
            + '<td>' + ((r.niches || []).map(n => tag(n)).join(' ') || '—') + '</td>'
            + '<td class="sub">' + esc(U.timeAgo(r.submitted_at)) + '</td></tr>'),
          { empty: empty('file', 'Nothing filed yet', 'Your first report is the one above.') })
        + '</div>'
    };
  }

  const nicheChips = list => list.length
    ? list.map(n => '<span class="chip on">' + esc(n)
      + '<button type="button" data-act="niche-del" data-v="' + esc(n) + '">' + ico('x', 12) + '</button></span>').join('')
    : '<span class="sub">Nothing picked yet.</span>';

  /* ===================================================================
     TRAININGS AND EVENTS
     =================================================================== */
  async function sessions(kind, id) {
    if (id) return sessionDetail(id);
    const ws = S().week;
    const filter = { week: ws, kind };
    if (A.isOffice()) filter.center = A.store.me.center_id;
    else if (S().center) filter.center = S().center;
    /* The distributors do not depend on the events, so they are fetched
       alongside rather than after — this page used to make four round
       trips one behind the other. */
    const distsP = A.distributors.list(A.isOffice() ? { center: A.store.me.center_id } : {});
    if (kind === 'training') await A.events.ensureWeek(ws);
    const evs = await A.events.list(filter);
    const [scans, dists] = await Promise.all([
      evs.length ? A.scans.forEvents(evs.map(e => e.id)) : Promise.resolve([]),
      distsP
    ]);

    const eligible = e => dists.filter(d => d.center_id === e.center_id
      && (e.elig === 'sm' ? SM_PLUS.includes(d.status) : true)).length;

    return {
      title: kind === 'training' ? 'Trainings' : 'Zone events', picker: 'week',
      crumbs: esc(U.weekLabel(ws)),
      html: (kind === 'training'
        ? note('info', 'info', '<b>Senior Manager Training runs every Wednesday, Distributor Training every Friday, both at 2:45pm.</b> '
          + 'The platform creates them for each zone. Open scanning when the session starts, and close it when it ends.')
        : '')
        + '<div class="card" style="margin-top:16px"><div class="card-h"><div>'
        + '<div class="card-t">' + (kind === 'training' ? 'This week\'s trainings' : 'Events this week') + '</div>'
        + '<div class="card-s">' + evs.length + ' session' + (evs.length === 1 ? '' : 's') + '.</div></div>'
        + '<div class="card-a">'
        + (A.isAdmin() && A.store.centers.length ? centerPick(S().center || A.store.centers[0].id, 'center') : '')
        + (kind === 'event' ? '<button class="btn btn-a btn-pop" data-act="event-new">' + ico('plus', 15) + 'New event</button>' : '')
        + '</div></div>'
        + table([{ label: 'Session' }, { label: 'Zone' }, { label: 'Date' }, { label: 'Who may scan' },
        { label: 'Scanned in', num: true }, { label: 'Status' }],
          evs.map(e => {
            const acc = scans.filter(s => s.event_id === e.id && s.status === 'accepted').length;
            const el = eligible(e);
            return '<tr class="click" data-href="' + link(kind === 'training' ? 'trainings' : 'events', e.id) + '">'
              + '<td><div class="nm">' + esc(e.name) + '</div><div class="sub mono">' + esc(e.code) + '</div></td>'
              + '<td>' + esc((A.centerById(e.center_id) || {}).name || '—') + '</td>'
              + '<td>' + esc(U.fullDate(e.event_date)) + '<div class="sub">' + esc(e.event_time) + '</div></td>'
              + '<td>' + (e.elig === 'sm' ? 'Senior Managers and above' : 'All distributors') + '</td>'
              + '<td class="num nm">' + acc + (el ? '<span class="sub">of ' + el + ' eligible</span>' : '') + '</td>'
              + '<td>' + statusTagEvent(e) + '</td></tr>';
          }),
          {
            empty: empty(kind === 'training' ? 'qr' : 'star',
              kind === 'training' ? 'No trainings for this week' : 'No events this week',
              kind === 'training'
                ? 'Trainings appear once at least one zone exists. Create a zone first.'
                : 'A zone event is anything outside the two weekly trainings: a rally, a launch, a leaders\' meeting.',
              kind === 'event' ? '<button class="btn btn-a btn-pop" data-act="event-new">' + ico('plus', 15) + 'Create an event</button>' : '')
          })
        + '</div>'
    };
  }

  async function sessionDetail(id) {
    const e = await A.events.get(id);
    if (!e) return { title: 'Session', html: empty('qr', 'Session not found', 'It may have been removed.') };
    const c = A.centerById(e.center_id) || {};
    const [scans, dists] = await Promise.all([
      A.scans.forEvent(id), A.distributors.list({ center: e.center_id })
    ]);
    const eligible = dists.filter(d => e.elig === 'sm' ? SM_PLUS.includes(d.status) : true);
    const acc = scans.filter(s => s.status === 'accepted');
    const rej = scans.filter(s => s.status === 'rejected');
    const inIds = acc.map(s => s.distributor_id);
    const missed = eligible.filter(d => !inIds.includes(d.id));
    const scanUrl = window.CONFIG.appUrl + '/scan.html?c=' + encodeURIComponent(e.code);

    return {
      title: e.name,
      crumbs: '<a href="' + link(e.kind === 'training' ? 'trainings' : 'events') + '">'
        + (e.kind === 'training' ? 'Trainings' : 'Zone events') + '</a> · ' + esc(c.name || ''),
      html: '<div class="grid g-1-2">'
        + '<div class="ticket tilt"><div class="ticket-h">'
        + '<div class="t-n">' + esc(e.name) + '</div>'
        + '<div class="t-m">' + esc(c.name || '') + ' · ' + esc(U.fullDate(e.event_date)) + ' · ' + esc(e.event_time) + '</div></div>'
        + '<div class="ticket-b"><div class="qr-box">' + U.qrSvg(scanUrl) + '</div>'
        + '<div><div class="card-s" style="margin:0 0 8px">Distributors scan this with a phone camera, or open the link and type the code.</div>'
        + '<div class="code">' + esc(e.code) + '</div>'
        + '<div class="row" style="margin-top:12px">'
        + '<button class="btn btn-a btn-pop btn-sm" data-act="qr-download"'
        + ' data-url="' + esc(scanUrl) + '"'
        + ' data-title="' + esc(e.name) + '"'
        + ' data-sub="' + esc((c.name || '') + ' · ' + U.fullDate(e.event_date) + ' · ' + e.event_time) + '"'
        + ' data-code="' + esc(e.code) + '"'
        + ' data-lines="' + esc(e.elig === 'sm' ? 'Senior Managers and above' : 'All distributors welcome') + '"'
        + ' data-file="' + esc('qr-' + e.code.toLowerCase()) + '">'
        + ico('qr', 14) + 'Download poster</button>'
        + '<button class="btn btn-sm" data-act="copy" data-v="' + esc(scanUrl) + '">' + ico('copy', 14) + 'Copy link</button>'
        + '<a class="btn btn-sm" href="' + esc(scanUrl) + '" target="_blank" rel="noopener">' + ico('scan', 14) + 'Open</a>'
        + '</div></div></div></div>'

        + '<div class="stack">'
        + '<div class="grid g3">'
        + kpi('Scanned in', acc.length, '', 'check', 'kpi-blue')
        + kpi('Eligible', eligible.length, e.elig === 'sm' ? 'SM and above' : 'all distributors', 'users')
        + kpi('Turnout', eligible.length ? U.pct((acc.length / eligible.length) * 100) : '—', '', 'trend', 'kpi-dark')
        + '</div>'
        + '<div class="card"><div class="card-h"><div><div class="card-t">Scanning</div>'
        + '<div class="card-s">' + (e.status === 'open'
          ? 'Open now. Anyone eligible can scan in.'
          : e.status === 'scheduled' ? 'Not open yet. Open it when the session starts.'
            : 'Closed. No further scans are accepted.') + '</div></div>'
        + '<div class="card-a">'
        + (e.status === 'open'
          ? '<button class="btn btn-p" data-act="event-close" data-id="' + e.id + '">' + ico('stop', 14) + 'Close scanning</button>'
          : '<button class="btn btn-a btn-pop" data-act="event-open" data-id="' + e.id + '">' + ico('play', 14) + 'Open scanning</button>')
        + '</div></div></div>'
        + '</div></div>'

        + '<div class="card" style="margin-top:18px"><div class="card-h"><div>'
        + '<div class="card-t">Scanned in · ' + acc.length + '</div>'
        + '<div class="card-s">With the device each scan came from.</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Office' }, { label: 'Status' }, { label: 'Time' }, { label: 'Device' }],
          acc.map(s => {
            const d = dists.find(x => x.id === s.distributor_id) || {};
            const o = A.officeById(s.office_id) || {};
            return '<tr><td class="nm">' + esc(d.full_name || '—') + '</td>'
              + '<td>' + esc(o.name || '—') + '</td>'
              + '<td>' + (d.status ? statusTag(d.status) : '—') + '</td>'
              + '<td>' + esc(U.clock(s.scanned_at)) + '</td>'
              + '<td class="' + (s.device_id ? 'mono sub' : 'sub') + '">'
              + esc(s.device_id || (s.reason || 'Marked by hand')) + '</td></tr>';
          }),
          { empty: empty('scan', 'Nobody has scanned in', 'Open scanning and show the QR code at the door.') })
        + '</div>'

        + (rej.length ? '<div class="card"><div class="card-h"><div><div class="card-t">Turned away · ' + rej.length + '</div>'
          + '<div class="card-s">One device records one person.</div></div></div>'
          + table([{ label: 'Name' }, { label: 'Reason' }, { label: 'Time' }, { label: 'Device' }],
            rej.map(s => {
              const d = dists.find(x => x.id === s.distributor_id) || {};
              return '<tr><td>' + esc(d.full_name || '—') + '</td><td>' + esc(s.reason) + '</td>'
                + '<td>' + esc(U.clock(s.scanned_at)) + '</td>'
                + '<td class="mono sub">' + esc(s.device_id || '—') + '</td></tr>';
            })) + '</div>' : '')

        + '<div class="card"><div class="card-h"><div><div class="card-t">Did not come · ' + missed.length + '</div>'
        + (A.isAdmin()
          ? '<div class="card-s">Somebody here without a phone? Mark them in by hand. '
          + 'It is recorded as marked by you, not as a scan.</div>'
          : '') + '</div></div>'
        + table([{ label: 'Name' }, { label: 'Office' }, { label: 'Status' }]
          .concat(A.isAdmin() ? [{ label: '' }] : []),
          missed.map(d => '<tr><td class="nm">' + esc(d.full_name) + '</td>'
            + '<td>' + esc((A.officeById(d.office_id) || {}).name || '—') + '</td>'
            + '<td>' + statusTag(d.status) + '</td>'
            + (A.isAdmin()
              ? '<td class="num"><button class="btn btn-sm btn-a" data-act="mark-present"'
              + ' data-event="' + e.id + '" data-dist="' + d.id + '"'
              + ' data-name="' + esc(d.full_name) + '">' + ico('check', 13) + 'Mark present</button></td>'
              : '') + '</tr>'),
          { empty: empty('check', 'Everyone eligible came', 'A full house.') })
        + '</div>'
    };
  }

  /* ===================================================================
     DISTRIBUTORS
     =================================================================== */
  async function distributors() {
    const own = A.isOffice();
    const list = await A.distributors.list(own ? { office: A.store.me.office_id } : {});
    const q = (S().q || '').toLowerCase();
    const shown = q ? list.filter(d => d.full_name.toLowerCase().includes(q)
      || (d.phone || '').includes(q)) : list;

    return {
      title: 'Distributors',
      crumbs: own ? esc(A.store.me.office.name) : list.length + ' across every office',
      html: '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">' + (own ? 'Your distributors' : 'Every distributor') + ' · ' + list.length + '</div>'
        + '<div class="card-s">Senior Manager and above unlocks the Wednesday training.</div></div>'
        + '<div class="card-a">'
        + '<input class="input" data-act="search" placeholder="Search by name or phone" value="' + esc(S().q || '')
        + '" style="max-width:220px">'
        + (own ? '<button class="btn btn-a btn-pop" data-act="dist-new">' + ico('plus', 15) + 'Add distributor</button>' : '')
        + '</div></div>'
        + table([{ label: 'Name' }, { label: own ? 'Status' : 'Office' }, { label: own ? 'Phone' : 'Status' },
        { label: own ? 'Added' : 'Zone' }, { label: '' }],
          shown.map(d => '<tr>'
            + '<td class="nm">' + esc(d.full_name) + '</td>'
            + '<td>' + (own ? statusTag(d.status) : esc((A.officeById(d.office_id) || {}).name || '—')) + '</td>'
            + '<td>' + (own ? esc(d.phone || '—') : statusTag(d.status)) + '</td>'
            + '<td class="sub">' + (own ? esc(U.fullDate(d.created_at)) : esc((A.centerById(d.center_id) || {}).name || '—')) + '</td>'
            + '<td class="num">' + (own
              ? '<button class="btn btn-sm" data-act="dist-edit" data-id="' + d.id + '">' + ico('edit', 13) + 'Edit</button>'
              : '') + '</td></tr>'),
          {
            empty: empty('users', q ? 'Nobody matches that' : 'No distributors yet',
              q ? 'Try a different name or number.' : 'Add your distributors so they can scan into trainings.',
              own && !q ? '<button class="btn btn-a btn-pop" data-act="dist-new">' + ico('plus', 15) + 'Add the first one</button>' : '')
          })
        + '</div>'
    };
  }

  /* ===================================================================
     MY CENTER  (office)
     =================================================================== */
  async function myCenter() {
    const cid = A.store.me.center_id;
    if (!cid) return { title: 'Zone', html: empty('layers', 'No zone', 'Your office is not attached to a zone yet.') };
    return centerDetail(cid);
  }

  /* ===================================================================
     SUBSCRIPTIONS
     =================================================================== */
  /* What the office itself sees at the top: how long is left, or that
     the time has run out, and the one button that fixes it. */
  function ownPanel(sub, plan) {
    const left = A.billing.daysLeft(sub);
    const locked = A.store.locked;
    const on = window.CONFIG.billingEnabled;
    const pay = on
      ? '<button class="btn btn-a btn-pop btn-lg" data-act="pay-now">' + ico('card', 16)
      + (sub && sub.status === 'active' ? 'Update your card' : 'Pay ' + U.ngn(plan.amountNgn) + ' now') + '</button>'
      : '';

    if (locked) {
      return '<div class="card card-dark"><div class="card-h"><div>'
        + '<div class="card-t" style="font-size:20px">Your free trial has ended</div>'
        + '<div class="card-s">Filing reports and opening scanning are paused until the office pays. '
        + 'Nothing has been deleted, and everything comes straight back.</div></div></div>'
        + '<div class="row" style="margin-top:16px">' + pay + '</div></div>'
        + '<div style="height:18px"></div>';
    }
    if (!sub) return '';

    const warn = left !== null && left <= 5;
    return '<div class="card' + (warn ? ' card-dark' : '') + '"><div class="card-h"><div>'
      + '<div class="card-t" style="font-size:20px">'
      + (sub.status === 'trial'
        ? (left === 0 ? 'Your trial ends today' : left + ' day' + (left === 1 ? '' : 's') + ' left on your trial')
        : 'Your subscription is live') + '</div>'
      + '<div class="card-s">'
      + (sub.status === 'trial'
        ? (plan.firstChargeOn
          ? 'Billing starts ' + U.fullDate(plan.firstChargeOn) + ' — ' + U.ngn(plan.amountNgn)
          + ' every ' + plan.days + ' days, the same for every office.'
          : 'After that it is ' + U.ngn(plan.amountNgn) + ' every ' + plan.days + ' days.')
        : 'Next charge ' + (sub.next_charge ? U.fullDate(sub.next_charge) : 'not set')
        + (sub.method_last4 ? ' · card ending ' + esc(sub.method_last4) : '')) + '</div></div>'
      + (warn || sub.status !== 'trial' ? '<div class="card-a">' + pay + '</div>' : '') + '</div>'
      + (!warn && sub.status === 'trial' && on
        ? '<div class="row" style="margin-top:14px">' + pay + '</div>' : '')
      + '</div><div style="height:18px"></div>';
  }

  async function subscriptions() {
    const own = A.isOffice();
    const [subs, pays] = await Promise.all([
      A.billing.subscriptions(), A.billing.payments(own ? A.store.me.office_id : null)
    ]);
    const plan = window.CONFIG.plan || {};
    const billTag = st => st === 'active' ? tag('Active', 't-ok')
      : st === 'trial' ? tag('Free trial', 't-b')
        : st === 'past_due' ? tag('Payment failed', 't-err') : tag(st, 't-mute');

    return {
      title: own ? 'Subscription' : 'Subscriptions',
      html: (own ? ownPanel(A.store.sub, plan) : '')
        + (!window.CONFIG.billingEnabled ? note('info', 'card',
          '<b>Card payments are not switched on yet.</b> Every office is on the free trial and nothing is charged. '
          + 'The plan is ' + U.ngn(plan.amountNgn) + ' every ' + plan.days + ' days after a ' + plan.trialDays
          + '-day trial. Turn on <span class="mono">billingEnabled</span> in config.js once Paystack is connected.')
          + '<div style="height:18px"></div>' : '')
        + '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">' + (own ? 'Your plan' : 'Every office') + '</div>'
        + '<div class="card-s">' + U.ngn(plan.amountNgn) + ' per office every ' + plan.days + ' days'
        + (plan.firstChargeOn ? ', from ' + U.fullDate(plan.firstChargeOn) : '') + '.</div></div></div>'
        + table([{ label: 'Office' }, { label: 'Status' }, { label: 'Trial ends' }, { label: 'Next charge' }, { label: 'Amount', num: true }],
          subs.filter(s => !own || s.office_id === A.store.me.office_id).map(s => {
            const o = A.officeById(s.office_id) || {};
            return '<tr><td class="nm">' + esc(o.name || '—') + '</td>'
              + '<td>' + billTag(s.status) + '</td>'
              + '<td>' + (s.trial_ends ? esc(U.fullDate(s.trial_ends)) : '—') + '</td>'
              + '<td>' + (s.next_charge ? esc(U.fullDate(s.next_charge)) : '—') + '</td>'
              + '<td class="num nm">' + U.ngn(s.amount_ngn) + '</td></tr>';
          }),
          { empty: empty('card', 'No offices on a plan yet', 'Every office starts a 30-day trial the moment it signs up.') })
        + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Payments</div>'
        + '<div class="card-s">Newest first.</div></div></div>'
        + table([{ label: 'Office' }, { label: 'Date' }, { label: 'Reference' }, { label: 'Method' },
        { label: 'Status' }, { label: 'Amount', num: true }],
          pays.map(p => '<tr><td>' + esc((A.officeById(p.office_id) || {}).name || '—') + '</td>'
            + '<td>' + esc(U.fullDate(p.paid_at)) + '</td>'
            + '<td class="mono sub">' + esc(p.reference) + '</td>'
            + '<td>' + esc(p.method || '—') + '</td>'
            + '<td>' + (p.status === 'paid' ? tag('Paid', 't-ok') : tag(p.status, 't-err')) + '</td>'
            + '<td class="num nm">' + U.ngn(p.amount_ngn) + '</td></tr>'),
          { empty: empty('cash', 'No payments yet', 'Nothing has been charged.') })
        + '</div>'
    };
  }

  /* ===================================================================
     CENTERS & ADMINS  (super admin)
     =================================================================== */
  async function adminPanel() {
    const [admins, pending, all] = await Promise.all([
      A.people.admins(), A.people.pending(), A.people.everyone()
    ]);
    const asked = pending.filter(p => p.req_status === 'pending');
    const quiet = pending.filter(p => p.req_status !== 'pending');
    const wants = p => p.req_kind === 'leader'
      ? tag('Director', 't-gold')
      : tag('An office', 't-ok')
      + '<div class="sub"><b>' + esc(p.req_office_name || '—') + '</b>'
      + ' · ' + esc((A.centerById(p.req_center_id) || {}).name || 'no zone') + '</div>'
      + '<div class="sub">' + esc(p.req_address || 'no address') + '</div>';
    return {
      title: 'Zones & directors',
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Zones</div>'
        + '<div class="card-s">A zone holds its own offices and runs its own Wednesday evaluation.</div></div>'
        + '<div class="card-a"><button class="btn btn-a btn-pop" data-act="center-new">' + ico('plus', 15) + 'New zone</button></div></div>'
        + table([{ label: 'Zone' }, { label: 'Zone leader' }, { label: 'Offices', num: true }, { label: '' }],
          A.store.centers.map(c => '<tr><td class="nm">' + esc(c.name) + '</td>'
            + '<td>' + esc(c.leader_name || '—') + '<div class="sub">' + esc(c.assistant_name || '') + '</div></td>'
            + '<td class="num">' + A.officesOf(c.id).length + '</td>'
            + '<td class="num"><button class="btn btn-sm" data-act="center-edit" data-id="' + c.id + '">'
            + ico('edit', 13) + 'Edit</button></td></tr>'),
          { empty: empty('layers', 'No zones yet', 'Everything else hangs off a zone, so start here.') })
        + '</div>'

        + (asked.length ? '<div class="card"><div class="card-h"><div>'
          + '<div class="card-t">Waiting on you · ' + asked.length + '</div>'
          + '<div class="card-s">They have signed up and said what they are joining as. '
          + 'Approving an office creates it; nothing exists until you do.</div></div></div>'
          + table([{ label: 'Name' }, { label: 'Email' }, { label: 'Asking to join as' }, { label: 'Asked' }, { label: '' }],
            asked.map(p => '<tr><td class="nm">' + esc(p.full_name || '—')
              + '<div class="sub">' + esc(p.phone || 'no phone') + '</div></td>'
              + '<td>' + esc(p.email) + '</td><td>' + wants(p) + '</td>'
              + '<td class="sub">' + esc(U.timeAgo(p.req_at || p.created_at)) + '</td>'
              + '<td class="num"><button class="btn btn-sm btn-d" data-act="decline-req" data-id="' + p.id + '"'
              + ' data-name="' + esc(p.full_name || p.email) + '">Decline</button> '
              + '<button class="btn btn-sm btn-a" data-act="approve-req" data-id="' + p.id + '"'
              + ' data-name="' + esc(p.full_name || p.email) + '">' + ico('check', 13) + 'Approve</button></td></tr>'))
          + '</div>' : '')

        + (quiet.length ? '<div class="card"><div class="card-h"><div>'
          + '<div class="card-t">Signed up, nothing asked · ' + quiet.length + '</div>'
          + '<div class="card-s">These accounts exist but have not said what they are joining as, '
          + 'or you turned their request down. They see nothing until they ask and you approve.</div></div></div>'
          + table([{ label: 'Name' }, { label: 'Email' }, { label: 'Signed up' }, { label: '' }],
            quiet.map(p => '<tr><td class="nm">' + esc(p.full_name || '—') + '</td>'
              + '<td>' + esc(p.email) + '</td><td class="sub">' + esc(U.timeAgo(p.created_at)) + '</td>'
              + '<td class="num">' + (p.req_status === 'declined'
                ? tag('Declined', 't-mute') + '<div class="sub">' + esc(p.req_note || '') + '</div>' : '')
              + '</td></tr>'))
          + '</div>' : '')

        + '<div class="card"><div class="card-h"><div><div class="card-t">Admins · ' + admins.length + '</div>'
        + '<div class="card-s">Directors see every zone and run the Wednesday evaluation. They cannot create zones.</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Email' }, { label: 'Role' }, { label: 'Added' }, { label: '' }],
          admins.map(p => '<tr><td class="nm">' + esc(p.full_name || '—') + '</td>'
            + '<td>' + esc(p.email) + '</td>'
            + '<td>' + (p.role === 'super_admin' ? tag('Super Admin', 't-gold') : tag('Director', 't-ok')) + '</td>'
            + '<td class="sub">' + esc(U.fullDate(p.created_at)) + '</td>'
            + '<td class="num">' + (p.role === 'platform_admin' && p.id !== A.store.me.id
              ? '<button class="btn btn-sm btn-d" data-act="drop-admin" data-id="' + p.id + '">Remove</button>' : '') + '</td></tr>'))
        + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Who has signed in</div>'
        + '<div class="card-s">Every account with a role, most recent first. Stamped each time '
        + 'the app is opened with a live session.</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Role' }, { label: 'Last seen' }, { label: 'Sign-ins', num: true }],
          all.map(p => {
            const days = p.last_seen
              ? Math.floor((Date.now() - new Date(p.last_seen).getTime()) / 86400000) : null;
            const state = days === null ? tag('Never', 't-warn')
              : days >= 14 ? tag(U.timeAgo(p.last_seen), 't-warn')
                : tag(U.timeAgo(p.last_seen), 't-ok');
            return '<tr><td class="nm">' + esc(p.full_name || '—')
              + '<div class="sub">' + esc(p.email) + '</div></td>'
              + '<td>' + esc({ super_admin: 'Super Admin', platform_admin: 'Director', office: 'Office' }[p.role] || p.role) + '</td>'
              + '<td>' + state + '</td>'
              + '<td class="num">' + (p.login_count || 0) + '</td></tr>';
          }),
          { empty: empty('users', 'Nobody yet', 'Sign-ins show up here.') })
        + '</div>'
    };
  }

  /* ===================================================================
     ACCOUNT
     =================================================================== */
  async function account() {
    const me = A.store.me;
    const roleLabel = { super_admin: 'Super Admin', platform_admin: 'Director', office: 'Office', pending: 'Waiting for approval' };
    return {
      title: 'Account',
      html: '<div class="card"><div class="card-h"><div><div class="card-t">You</div></div></div>'
        + '<div class="two">'
        + '<div class="field"><label for="a-name">Full name</label>'
        + '<input class="input" id="a-name" value="' + esc(me.full_name || '') + '"></div>'
        + '<div class="field"><label for="a-phone">Phone</label>'
        + '<input class="input" id="a-phone" type="tel" value="' + esc(me.phone || '') + '"></div></div>'
        + '<div class="field"><label>Email</label><input class="input" value="' + esc(me.email) + '" disabled></div>'
        + '<div class="row"><span class="card-s">Role:</span> ' + tag(roleLabel[me.role] || me.role, 't-ok')
        + (me.office ? tag(me.office.name, 't-mute') : '') + '</div>'
        + '<div class="row" style="justify-content:flex-end;margin-top:14px">'
        + '<button class="btn btn-p" data-act="name-save">' + ico('check', 15) + 'Save</button></div></div>'

        + (A.isOffice() ? '<div class="card"><div class="card-h"><div><div class="card-t">Your office</div>'
          + '<div class="card-s">What the zone sees next to your reports.</div></div></div>'
          + '<div class="two">'
          + '<div class="field"><label for="o-name">Office name</label>'
          + '<input class="input" id="o-name" value="' + esc(me.office.name) + '"></div>'
          + '<div class="field"><label for="o-manager">Team leader</label>'
          + '<input class="input" id="o-manager" value="' + esc(me.office.manager_name || '') + '"></div></div>'
          + '<div class="two">'
          + '<div class="field"><label for="o-phone">Office phone</label>'
          + '<input class="input" id="o-phone" type="tel" value="' + esc(me.office.phone || '') + '"></div>'
          + '<div class="field"><label for="o-address">Address</label>'
          + '<input class="input" id="o-address" value="' + esc(me.office.address || '') + '"></div></div>'
          + '<div class="row" style="justify-content:flex-end">'
          + '<button class="btn btn-p" data-act="office-save">' + ico('check', 15) + 'Save office</button></div></div>' : '')

        + '<div class="card"><div class="card-h"><div><div class="card-t">Password</div>'
        + '<div class="card-s">At least eight characters.</div></div></div>'
        + '<div class="two">'
        + '<div class="field"><label for="p-new">New password</label>'
        + '<input class="input" id="p-new" type="password" autocomplete="new-password"></div>'
        + '<div class="field"><label for="p-again">Again</label>'
        + '<input class="input" id="p-again" type="password" autocomplete="new-password"></div></div>'
        + '<div class="row" style="justify-content:flex-end">'
        + '<button class="btn btn-p" data-act="pw-save">' + ico('lock', 15) + 'Change password</button></div></div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">How this works</div>'
        + '<div class="card-s">The short walkthrough you saw the first time you signed in.</div></div>'
        + '<div class="card-a"><button class="btn btn-sm" data-act="tour-again">'
        + ico('help', 14) + 'Show it again</button></div></div></div>'
    };
  }

  /* ===================================================================
     GUIDE  —  what the platform is for, and what this role does with it
     =================================================================== */
  const DOES = [
    'Manage documentation digitally.',
    'Track attendance for trainings and meetings.',
    'Conduct evaluations.',
    'Monitor productivity and performance across every office.',
    'Generate reports that help us make better decisions and measure our growth over time.'
  ];

  const STEPS = {
    office: [
      ['clipboard', 'File one report a week', 'Open <b>Weekly report</b> before Tuesday closes and put in the number of orders you got, what they came to, the products they came from, and anything that slowed you down. That single form is what every ranking and every summary is built from.'],
      ['users', 'Keep your distributor list true', 'Add everyone under <b>Distributors</b>, with a phone number for each. The number matters: it is what a distributor completes at the door to prove the scan is really them.'],
      ['qr', 'Open scanning when a session starts', 'On <b>Trainings</b>, press open when the room fills. Everyone scans the zone QR, finds their name, completes their number, and they are in. Close it when the session ends.'],
      ['card', 'Keep your subscription live', 'Your office has its own subscription. Check <b>Subscription</b> for when the next payment falls due.']
    ],
    platform_admin: [
      ['grid', 'Read the week at a glance', 'The <b>Dashboard</b> shows every zone for the week you pick: what came in, who filed and who has not.'],
      ['clipboard', 'Run the Wednesday evaluation', '<b>Evaluation list</b> is the sheet for the 2:45pm meeting. It arrives already filled in from the reports that were filed.'],
      ['crown', 'Watch the rankings', '<b>Office rankings</b> orders every office by the week, so the conversation starts from the numbers rather than from memory.'],
      ['qr', 'Keep attendance honest', 'Open and close scanning for your zones, and check <b>Trainings</b> afterwards for who actually came.']
    ],
    super_admin: [
      ['shield', 'Approve who gets in', 'Nobody sees anything until you approve them. <b>Zones & directors</b> carries a blue count whenever somebody is waiting. Approving an office is what creates that office.'],
      ['layers', 'Create the zones first', 'Everything hangs off a zone. Offices pick one when they sign up, and each zone runs its own Wednesday evaluation and has its own permanent QR poster.'],
      ['building', 'Watch every office', '<b>Offices</b>, <b>Office rankings</b> and <b>Weekly reports</b> give you the whole picture, week by week.'],
      ['card', 'Keep an eye on billing', '<b>Subscriptions</b> shows which offices are on trial, which are paying, and which have lapsed.']
    ]
  };

  async function guide() {
    const me = A.store.me;
    const steps = STEPS[me.role] || STEPS.office;
    const roleName = { super_admin: 'Super Admin', platform_admin: 'Director', office: 'an Office' }[me.role] || '';
    return {
      title: 'Guide',
      html: '<div class="card card-dark"><div class="card-h"><div>'
        + '<div class="card-t" style="font-size:22px">What this platform is for</div>'
        + '<div class="card-s">Sky Team Ife runs on what it writes down. This is the whole of it.</div>'
        + '</div></div>'
        + '<ul class="ticks">' + DOES.map(d => '<li>' + ico('check', 15) + '<span>' + esc(d) + '</span></li>').join('') + '</ul>'
        + '</div>'

        + '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">You are signed in as ' + esc(roleName) + '</div>'
        + '<div class="card-s">Here is what that means week to week.</div></div></div>'
        + '<div class="steps">' + steps.map((s, i) => '<div class="step">'
          + '<div class="step-n">' + ico(s[0], 18) + '<i>' + (i + 1) + '</i></div>'
          + '<div><div class="step-t">' + esc(s[1]) + '</div>'
          + '<div class="step-d">' + s[2] + '</div></div></div>').join('')
        + '</div></div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">The week</div>'
        + '<div class="card-s">Everything is stamped to the Thursday that opens it.</div></div></div>'
        + '<div class="steps">'
        + '<div class="step"><div class="step-n">' + ico('calendar', 18) + '<i>W</i></div>'
        + '<div><div class="step-t">Wednesday to Tuesday</div>'
        + '<div class="step-d">A week opens on Thursday and stays open all the way through the following Wednesday. Reports belong to the week they cover, not the day they are filed.</div></div></div>'
        + '<div class="step"><div class="step-n">' + ico('qr', 18) + '<i>1</i></div>'
        + '<div><div class="step-t">Senior Manager Training, Wednesday 2:45pm</div>'
        + '<div class="step-d">Senior Managers and above. Creates itself for every zone.</div></div></div>'
        + '<div class="step"><div class="step-n">' + ico('qr', 18) + '<i>2</i></div>'
        + '<div><div class="step-t">Distributor Training, Friday 2:45pm</div>'
        + '<div class="step-d">Everyone. Also creates itself.</div></div></div>'
        + '<div class="step"><div class="step-n">' + ico('clipboard', 18) + '<i>3</i></div>'
        + '<div><div class="step-t">Evaluation, the Wednesday after the week closes</div>'
        + '<div class="step-d">Read against the reports that were filed for that week.</div></div></div>'
        + '</div></div>'
    };
  }

  window.VIEWS = {
    guide,
    /* A Director's dashboard is the same page a Super Admin gets — every
       zone, every office, the whole week — not a view scoped down to
       their own zone. It is visibility only: the two role checks inside
       adminDash keep the create-a-zone link and button Super Admin only,
       so nothing here hands a Director a power they did not have. */
    dashboard: () => A.isOffice() ? officeDash() : adminDash(),
    evaluation, monthly, centers, offices, rankings, niches,
    reports: reportsView,
    trainings: (id) => sessions('training', id),
    events: (id) => sessions('event', id),
    distributors, center: myCenter, subscriptions, admin: adminPanel, account,
    helpers: { rankOffices, totals, nicheTally, nicheChips, statusTag, STATUSES, SM_PLUS, LEADER, peopleIn }
  };
})();

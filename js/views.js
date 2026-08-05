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
  const totals = rs => ({ orders: sumBy(rs, r => r.orders), amount: sumBy(rs, r => r.amount), count: rs.length });

  function rankOffices(reps, offices) {
    const by = {};
    reps.forEach(r => {
      by[r.office_id] = by[r.office_id] || { office_id: r.office_id, orders: 0, amount: 0 };
      by[r.office_id].orders += Number(r.orders) || 0;
      by[r.office_id].amount += Number(r.amount) || 0;
    });
    offices.forEach(o => { by[o.id] = by[o.id] || { office_id: o.id, orders: 0, amount: 0, missing: true }; });
    return Object.values(by)
      .map(r => Object.assign(r, { office: A.officeById(r.office_id) }))
      .filter(r => r.office)
      .sort((a, b) => b.amount - a.amount || b.orders - a.orders)
      .map((r, i) => Object.assign(r, { rank: i + 1 }));
  }

  function nicheTally(reps) {
    const t = {};
    reps.forEach(r => (r.niches || []).forEach(n => { t[n] = (t[n] || 0) + 1; }));
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }

  const link = (page, id) => '#/' + page + (id ? '/' + id : '');
  const weekOpts = (sel) => U.recentWeeks(window.CONFIG.weeksShown || 12)
    .map(w => '<option value="' + w + '" ' + (w === sel ? 'selected' : '') + '>'
      + esc(U.weekLabel(w)) + (U.weekClosed(w) ? '' : ' (open)') + '</option>').join('');
  const monthOpts = (sel) => U.recentMonths(12)
    .map(m => '<option value="' + m + '" ' + (m === sel ? 'selected' : '') + '>' + esc(U.monthLabel(m)) + '</option>').join('');

  const centerPick = (sel, act) => '<select class="select" data-act="' + act + '" style="max-width:230px">'
    + A.store.centers.map(c => '<option value="' + c.id + '" ' + (c.id === sel ? 'selected' : '') + '>'
      + esc(c.name) + '</option>').join('') + '</select>';

  const statusTag = st => LEADER.includes(st) ? tag(st, 't-gold')
    : SM_PLUS.includes(st) ? tag(st, 't-ok') : tag(st, 't-mute');

  const evalLine = (ws) => 'Read at the center evaluation on ' + esc(U.fullDate(U.evalDate(ws))) + ' at 2:45pm.';

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
      l: 'W' + U.isoWeekNo(w),
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
      crumbs: esc(U.weekLabel(ws)) + (U.weekClosed(ws) ? '' : ' · open until Tuesday'),
      html:
        (!A.store.centers.length ? note('gold', 'info',
          '<b>No centers yet.</b> Create your first center under <a href="' + link('admin') + '" style="text-decoration:underline">Centers &amp; admins</a>, then send your offices the site address so they can ask to join.') + '<div style="height:18px"></div>' : '')
        + '<div class="grid g4">'
        + kpi('Orders this week', t.orders.toLocaleString(), U.change(t.orders, p.orders), 'trend')
        + kpi('Amount this week', usd(t.amount), U.change(t.amount, p.amount), 'cash', 'kpi-blue')
        + kpi('Reports in', t.count + ' of ' + offices.length,
          missing.length ? esc(missing.length + ' still missing') : 'Every office has filed', 'file')
        + kpi('Leading office', top ? esc(top.office.name) : '—',
          top ? usdFull(top.amount) + ' · ' + top.orders + ' orders' : 'No reports filed yet', 'crown', 'kpi-dark')
        + '</div>'

        + '<div class="grid g-2-1" style="margin-top:18px">'
        + '<div class="card"><div class="card-h"><div><div class="card-t">Amount by week</div>'
        + '<div class="card-s">Every office, the last eight weeks.</div></div>'
        + '<div class="card-a">' + chartToggle(S().chartType) + '</div></div>'
        + chart(series, series.length - 1, S().chartType) + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Centers this week</div>'
        + '<div class="card-s">Ranked by amount.</div></div></div>'
        + (centerRows.length ? centerRows.map(r =>
          '<a href="' + link('centers', r.c.id) + '" style="display:block;padding:11px 0;border-bottom:1px solid #edf0f7">'
          + '<div class="spread"><div class="nm">' + esc(r.c.name) + '</div>'
          + '<div class="num nm">' + usd(r.amount) + '</div></div>'
          + '<div style="margin-top:7px">' + bar(r.amount, maxCenter, true) + '</div>'
          + '<div class="sub">' + r.count + ' of ' + r.os.length + ' offices filed · ' + r.orders + ' orders</div></a>').join('')
          : empty('layers', 'No centers yet', 'Create a center and its offices can start filing.'))
        + '</div></div>'

        + (missing.length ? '<div class="card" style="margin-top:18px">'
          + '<div class="card-h"><div><div class="card-t">Still to file · ' + missing.length + '</div>'
          + '<div class="card-s">' + evalLine(ws) + '</div></div></div>'
          + table([{ label: 'Office' }, { label: 'Center' }, { label: 'Team leader' }, { label: '' }],
            missing.map(r => '<tr class="click" data-href="' + link('offices', r.office.id) + '">'
              + '<td class="nm">' + esc(r.office.name) + '</td>'
              + '<td>' + esc((A.centerById(r.office.center_id) || {}).name || '—') + '</td>'
              + '<td>' + esc(r.office.manager_name || '—') + '</td>'
              + '<td class="num">' + tag('Not filed', 't-warn') + '</td></tr>'))
          + '</div>' : '')
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
      return { l: 'W' + U.isoWeekNo(w), v: r ? Number(r.amount) : 0 };
    });
    const scanCounts = evs.length ? await A.scans.forEvents(evs.map(e => e.id)) : [];
    const mineScans = scanCounts.filter(s => s.office_id === off.id && s.status === 'accepted');

    return {
      title: 'Dashboard', picker: 'week',
      crumbs: esc(off.name + ' · ' + ((A.centerById(off.center_id) || {}).name || '')),
      html:
        (!mine && !U.weekClosed(ws) ? note('gold', 'alert',
          '<b>Your ' + esc(U.weekName(ws)) + ' report is not in.</b> ' + evalLine(ws)
          + ' <a href="' + link('reports') + '" style="text-decoration:underline;font-weight:600">Fill it now</a>.')
          + '<div style="height:18px"></div>' : '')
        + '<div class="grid g4">'
        + kpi('Your orders', mine ? Number(mine.orders).toLocaleString() : '—',
          mine ? U.change(mine.orders, prevMine ? prevMine.orders : 0) : 'No report for this week', 'trend')
        + kpi('Your amount', mine ? usd(mine.amount) : '—',
          mine ? U.change(mine.amount, prevMine ? prevMine.amount : 0) : 'Nothing filed yet', 'cash', 'kpi-blue')
        + kpi('Rank in center', meRank.rank ? '#' + meRank.rank + ' of ' + ranked.length : '—',
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
        + '<div class="card"><div class="card-h"><div><div class="card-t">This week in your center</div>'
        + '<div class="card-s">Ranked by amount.</div></div></div>'
        + (ranked.length ? ranked.slice(0, 6).map(r =>
          '<div class="spread" style="padding:9px 0;border-bottom:1px solid #edf0f7">'
          + '<div class="row" style="gap:9px"><span class="rk rk-' + r.rank + '">' + r.rank + '</span>'
          + '<span class="' + (r.office_id === off.id ? 'nm' : '') + '">' + esc(r.office.name)
          + (r.office_id === off.id ? ' <span class="tag t-ok">You</span>' : '') + '</span></div>'
          + '<div class="num nm">' + (r.missing ? '<span style="color:var(--faint)">—</span>' : usd(r.amount)) + '</div></div>').join('')
          : empty('crown', 'No reports yet', 'Once offices in your center file, the ranking appears.'))
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
    const ws = S().week, prev = U.iso(U.addDays(ws, -7));
    const cid = S().center || (A.store.centers[0] || {}).id;
    if (!cid) return { title: 'Evaluation list', html: empty('layers', 'No centers yet', 'Create a center first.') };
    const [reps, prevReps] = await Promise.all([
      A.reports.list({ week: ws, center: cid }),
      A.reports.list({ week: prev, center: cid })
    ]);
    const offs = A.officesOf(cid).filter(o => o.active);
    const ranked = rankOffices(reps, offs);
    const t = totals(reps);
    const c = A.centerById(cid);

    return {
      title: 'Evaluation list', picker: 'week',
      crumbs: esc(U.weekLabel(ws)),
      html: '<div class="card"><div class="card-h">'
        + '<div><div class="card-t">' + esc(c.name) + '</div>'
        + '<div class="card-s">' + evalLine(ws) + '</div></div>'
        + '<div class="card-a">' + centerPick(cid, 'center') + '</div></div>'
        + '<div class="grid g4" style="margin-bottom:4px">'
        + kpi('Offices', offs.length, '', 'building')
        + kpi('Filed', t.count + ' of ' + offs.length, '', 'file', t.count === offs.length ? 'kpi-blue' : '')
        + kpi('Orders', t.orders.toLocaleString(), '', 'trend')
        + kpi('Amount', usd(t.amount), '', 'cash', 'kpi-dark')
        + '</div></div>'

        + '<div class="card">' + table(
          [{ label: '#' }, { label: 'Office' }, { label: 'Last week', num: true }, { label: 'This week', num: true },
          { label: 'Move', num: true }, { label: 'Niches' }, { label: 'New' }, { label: 'Issues raised' }],
          ranked.map(r => {
            const rep = reps.find(x => x.office_id === r.office_id);
            const pr = prevReps.find(x => x.office_id === r.office_id);
            if (!rep) {
              return '<tr><td><span class="rk">—</span></td>'
                + '<td class="nm">' + esc(r.office.name) + '</td>'
                + '<td class="num">' + (pr ? usdFull(pr.amount) : '—') + '</td>'
                + '<td class="num" colspan="6">' + tag('No report filed', 't-warn') + '</td></tr>';
            }
            return '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
              + '<td><span class="rk rk-' + r.rank + '">' + r.rank + '</span></td>'
              + '<td><div class="nm">' + esc(r.office.name) + '</div>'
              + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
              + '<td class="num">' + (pr ? usdFull(pr.amount) : '—') + '</td>'
              + '<td class="num nm">' + usdFull(rep.amount) + '<div class="sub">' + rep.orders + ' orders</div></td>'
              + '<td class="num">' + (pr ? U.change(rep.amount, pr.amount) : '<span class="sub">first week</span>') + '</td>'
              + '<td>' + ((rep.niches || []).map(n => tag(n)).join(' ') || '<span class="sub">—</span>') + '</td>'
              + '<td>' + ((rep.new_niches || []).map(n => tag(n, 't-dark')).join(' ') || '<span class="sub">—</span>') + '</td>'
              + '<td style="max-width:280px;white-space:normal">' + esc(rep.issues || '—') + '</td></tr>';
          }),
          { empty: empty('clipboard', 'No offices in this center', 'Offices appear here once they sign up and you approve them.') })
        + '</div>'
    };
  }

  /* ===================================================================
     MONTHLY SUMMARY
     =================================================================== */
  async function monthly() {
    const key = S().month;
    const weeks = U.recentWeeks(30).filter(w => U.monthKey(w) === key).reverse();
    if (!weeks.length) return { title: 'Monthly summary', picker: 'month', html: empty('calendar', 'Nothing for this month', 'Pick another month.') };
    const mine = A.isOffice() ? A.store.me.office_id : null;
    const reps = await A.reports.list(mine ? { weeks, office: mine } : { weeks });
    const t = totals(reps);
    const offices = A.store.offices.filter(o => o.active);
    const ranked = rankOffices(reps, mine ? [] : offices).filter(r => !r.missing);
    const tally = nicheTally(reps);
    const series = weeks.map(w => ({
      l: 'W' + U.isoWeekNo(w), v: sumBy(reps.filter(r => r.week_start === w), r => r.amount)
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
          + '<div class="card-s">Ranked by amount across ' + weeks.length + ' weeks.</div></div></div>'
          + table([{ label: '#' }, { label: 'Office' }, { label: 'Center' }, { label: 'Reports', num: true },
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
        + '<td>' + esc(c.address || '—') + '</td>'
        + '<td>' + esc(c.leader_name || '—') + '<div class="sub">' + esc(c.assistant_name || '') + '</div></td>'
        + '<td class="num">' + os.length + '</td>'
        + '<td class="num">' + t.count + ' of ' + os.length + '</td>'
        + '<td class="num nm">' + usdFull(t.amount) + '</td></tr>';
    });
    return {
      title: 'Centers', picker: 'week',
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Every center</div>'
        + '<div class="card-s">Numbers are for ' + esc(U.weekLabel(ws)) + '.</div></div>'
        + (A.isSuper() ? '<div class="card-a"><button class="btn btn-a btn-pop" data-act="center-new">'
          + ico('plus', 15) + 'New center</button></div>' : '') + '</div>'
        + table([{ label: 'Center' }, { label: 'Address' }, { label: 'Leader' }, { label: 'Offices', num: true },
        { label: 'Filed', num: true }, { label: 'Amount', num: true }], rowsHtml,
          { empty: empty('layers', 'No centers yet', 'A center holds its own offices and runs its own Wednesday evaluation.',
            A.isSuper() ? '<button class="btn btn-a btn-pop" data-act="center-new">' + ico('plus', 15) + 'Create the first center</button>' : '') })
        + '</div>'
    };
  }

  async function centerDetail(id) {
    const c = A.centerById(id);
    if (!c) return { title: 'Center', html: empty('layers', 'Center not found', 'It may have been removed.') };
    const ws = S().week;
    const offs = A.officesOf(id).filter(o => o.active);
    const [reps, evs, dists] = await Promise.all([
      A.reports.list({ week: ws, center: id }),
      A.events.list({ week: ws, center: id }),
      A.distributors.list({ center: id })
    ]);
    const ranked = rankOffices(reps, offs);
    const t = totals(reps);
    const scans = evs.length ? await A.scans.forEvents(evs.map(e => e.id)) : [];

    const centerUrl = window.CONFIG.appUrl + '/scan.html?center=' + encodeURIComponent(c.id);
    return {
      title: c.name, crumbs: '<a href="' + link('centers') + '">Centers</a>', picker: 'week',
      html: '<div class="grid g4">'
        + kpi('Offices', offs.length, '', 'building')
        + kpi('Distributors', dists.length, dists.filter(d => SM_PLUS.includes(d.status)).length + ' SM and above', 'users')
        + kpi('Amount this week', usd(t.amount), t.count + ' of ' + offs.length + ' filed', 'cash', 'kpi-blue')
        + kpi('Leader', esc(c.leader_name || '—'), esc(c.assistant_name ? 'Assistant: ' + c.assistant_name : ''), 'crown', 'kpi-dark')
        + '</div>'

        + '<div style="margin-top:18px;max-width:660px">'
        + '<div class="ticket tilt"><div class="ticket-h">'
        + '<div class="t-n">Center QR, one code for every session</div>'
        + '<div class="t-m">' + esc(c.name) + '</div></div>'
        + '<div class="ticket-b"><div class="qr-box">' + U.qrSvg(centerUrl) + '</div>'
        + '<div><div class="card-s" style="margin:0 0 10px">Print this once and keep it at the door. '
        + 'A distributor scans it, picks today\'s session, and is signed in. The QR never changes.</div>'
        + '<div class="row">'
        + '<button class="btn btn-a btn-pop btn-sm" data-act="qr-download"'
        + ' data-url="' + esc(centerUrl) + '"'
        + ' data-title="' + esc(c.name) + '"'
        + ' data-sub="' + esc('Training sign-in') + '"'
        + ' data-lines="' + esc((c.address || '') + '|' + (c.leader_name ? 'Leader: ' + c.leader_name : '')) + '"'
        + ' data-file="' + esc('qr-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '">'
        + ico('qr', 14) + 'Download poster</button>'
        + '<button class="btn btn-sm" data-act="copy" data-v="' + esc(centerUrl) + '">' + ico('copy', 14) + 'Copy link</button>'
        + '<a class="btn btn-sm" href="' + esc(centerUrl) + '" target="_blank" rel="noopener">' + ico('scan', 14) + 'Open</a>'
        + '</div></div></div></div>'
        + '</div>'

        + '<div class="card" style="margin-top:18px"><div class="card-h"><div>'
        + '<div class="card-t">Offices ranked</div><div class="card-s">' + esc(U.weekLabel(ws)) + '</div></div>'
        + (A.isSuper() ? '<div class="card-a"><button class="btn btn-sm" data-act="center-edit" data-id="' + c.id + '">'
          + ico('edit', 14) + 'Edit center</button></div>' : '') + '</div>'
        + table([{ label: '#' }, { label: 'Office' }, { label: 'Team leader' }, { label: 'Orders', num: true }, { label: 'Amount', num: true }],
          ranked.map(r => '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
            + '<td><span class="rk rk-' + r.rank + '">' + (r.missing ? '—' : r.rank) + '</span></td>'
            + '<td class="nm">' + esc(r.office.name) + '</td>'
            + '<td>' + esc(r.office.manager_name || '—') + '</td>'
            + '<td class="num">' + (r.missing ? tag('Not filed', 't-warn') : r.orders) + '</td>'
            + '<td class="num nm">' + (r.missing ? '—' : usdFull(r.amount)) + '</td></tr>'),
          { empty: empty('building', 'No offices yet', 'Offices pick this center when they sign up, and appear once approved.') })
        + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Sessions this week</div>'
        + '<div class="card-s">Trainings and events at this center.</div></div></div>'
        + table([{ label: 'Session' }, { label: 'Date' }, { label: 'Who may scan' }, { label: 'Status' }, { label: 'In', num: true }],
          evs.map(e => '<tr class="click" data-href="' + link('trainings', e.id) + '">'
            + '<td class="nm">' + esc(e.name) + '</td>'
            + '<td>' + esc(U.fullDate(e.event_date)) + '<div class="sub">' + esc(e.event_time) + '</div></td>'
            + '<td>' + (e.elig === 'sm' ? 'Senior Managers and above' : 'All distributors') + '</td>'
            + '<td>' + statusTagEvent(e) + '</td>'
            + '<td class="num nm">' + scans.filter(s => s.event_id === e.id && s.status === 'accepted').length + '</td></tr>'),
          { empty: empty('qr', 'No sessions this week', 'The two weekly trainings are created automatically once the week opens.') })
        + '</div>'
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
    const [reps, dists] = await Promise.all([A.reports.list({ week: ws }), A.distributors.list({})]);
    const list = A.store.offices.filter(o => o.active);
    return {
      title: 'Offices', picker: 'week',
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Every office</div>'
        + '<div class="card-s">' + list.length + ' offices · numbers are for ' + esc(U.weekLabel(ws)) + '.</div></div></div>'
        + table([{ label: 'Office' }, { label: 'Center' }, { label: 'Team leader' }, { label: 'Distributors', num: true },
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
          { empty: empty('building', 'No offices yet', 'An office signs up on this site, picks its center, and appears once you approve it.') })
        + '</div>'
    };
  }

  async function officeDetail(id) {
    const o = A.officeById(id);
    if (!o) return { title: 'Office', html: empty('building', 'Office not found', 'It may have been removed.') };
    const hist = U.recentWeeks(10).reverse();
    const [reps, dists] = await Promise.all([
      A.reports.list({ office: id }), A.distributors.list({ office: id })
    ]);
    const series = hist.map(w => {
      const r = reps.find(x => x.week_start === w);
      return { l: 'W' + U.isoWeekNo(w), v: r ? Number(r.amount) : 0 };
    });
    const t = totals(reps);
    return {
      title: o.name,
      crumbs: '<a href="' + link('offices') + '">Offices</a> · ' + esc((A.centerById(o.center_id) || {}).name || ''),
      html: '<div class="grid g4">'
        + kpi('Reports filed', reps.length, 'all time', 'file')
        + kpi('Total orders', t.orders.toLocaleString(), '', 'trend')
        + kpi('Total amount', usd(t.amount), '', 'cash', 'kpi-blue')
        + kpi('Distributors', dists.length, dists.filter(d => LEADER.includes(d.status)).length + ' at Director level', 'users', 'kpi-dark')
        + '</div>'

        + '<div class="card" style="margin-top:18px"><div class="card-h"><div><div class="card-t">Amount by week</div>'
        + '<div class="card-s">The last ten weeks.</div></div><div class="card-a">' + chartToggle(S().chartType) + '</div></div>'
        + chart(series, -1, S().chartType) + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Everything filed</div>'
        + '<div class="card-s">Newest first.</div></div></div>'
        + table([{ label: 'Week' }, { label: 'Orders', num: true }, { label: 'Amount', num: true },
        { label: 'Niches' }, { label: 'Issues' }, { label: 'Filed' }],
          reps.map(r => '<tr><td class="nm">' + esc(U.weekName(r.week_start))
            + '<div class="sub">' + esc(U.weekRange(r.week_start)) + '</div></td>'
            + '<td class="num">' + r.orders + '</td>'
            + '<td class="num nm">' + usdFull(r.amount) + '</td>'
            + '<td>' + ((r.niches || []).map(n => tag(n)).join(' ') || '—') + '</td>'
            + '<td style="max-width:260px;white-space:normal">' + esc(r.issues || '—') + '</td>'
            + '<td class="sub">' + esc(U.timeAgo(r.submitted_at)) + '</td></tr>'),
          { empty: empty('file', 'Nothing filed yet', 'This office has not submitted a weekly report.') })
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
     RANKINGS
     =================================================================== */
  async function rankings() {
    const ws = S().week;
    const reps = await A.reports.list({ week: ws });
    const ranked = rankOffices(reps, A.store.offices.filter(o => o.active));
    const max = Math.max.apply(null, ranked.map(r => r.amount).concat([1]));
    return {
      title: 'Office rankings', picker: 'week', crumbs: esc(U.weekLabel(ws)),
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Ranked by amount</div>'
        + '<div class="card-s">Every office across every center. ' + evalLine(ws) + '</div></div></div>'
        + table([{ label: '#' }, { label: 'Office' }, { label: 'Center' }, { label: 'Orders', num: true },
        { label: 'Amount', num: true }, { label: '' }],
          ranked.map(r => '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
            + '<td><span class="rk rk-' + r.rank + '">' + (r.missing ? '—' : r.rank) + '</span></td>'
            + '<td class="nm">' + esc(r.office.name) + '</td>'
            + '<td>' + esc((A.centerById(r.office.center_id) || {}).name || '—') + '</td>'
            + '<td class="num">' + (r.missing ? '—' : r.orders) + '</td>'
            + '<td class="num nm">' + (r.missing ? tag('Not filed', 't-warn') : usdFull(r.amount)) + '</td>'
            + '<td style="width:180px">' + bar(r.amount, max, r.rank === 1) + '</td></tr>'),
          { empty: empty('crown', 'Nothing to rank yet', 'Rankings appear as soon as offices file for this week.') })
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
        + table([{ label: 'Office' }, { label: 'Center' }, { label: 'Orders', num: true }, { label: 'Amount', num: true },
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
    const [mine, all] = await Promise.all([A.reports.get(off.id, ws), A.reports.list({ office: off.id })]);
    const dists = await A.distributors.list({ office: off.id });
    const f = S().form || {};
    const niches = f.niches || (mine ? (mine.niches || []).slice() : []);
    const newNiches = f.newNiches || (mine ? (mine.new_niches || []).slice() : []);
    S().form = { niches, newNiches };

    const closed = U.weekClosed(ws);
    return {
      title: 'Weekly report', picker: 'week', crumbs: esc(U.weekLabel(ws)),
      html: '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">' + esc(U.weekName(ws)) + ' · ' + esc(U.weekRange(ws)) + '</div>'
        + '<div class="card-s">' + evalLine(ws) + '</div></div>'
        + '<div class="card-a">' + (mine ? tag('Filed ' + U.timeAgo(mine.submitted_at), 't-ok') : tag('Not filed', 't-warn')) + '</div></div>'

        + (closed && !mine ? note('warn', 'alert', 'This week has closed. Anything filed now is late, and the evaluation has already been read.') + '<div style="height:16px"></div>' : '')

        + '<form id="report-form">'
        + '<div class="two">'
        + '<div class="field"><label for="f-orders">Number of orders gotten</label>'
        + '<input class="input" id="f-orders" type="number" min="0" step="1" required value="' + (mine ? mine.orders : '') + '" placeholder="0"></div>'
        + '<div class="field"><label for="f-amount">Amount in USD</label>'
        + '<input class="input" id="f-amount" type="number" min="0" step="0.01" required value="' + (mine ? mine.amount : '') + '" placeholder="0"></div>'
        + '</div>'
        + '<div class="two">'
        + '<div class="field"><label for="f-size">Distributors who wrote orders</label>'
        + '<input class="input" id="f-size" type="number" min="0" step="1" value="' + (mine ? mine.office_size : dists.length) + '"></div>'
        + '<div class="field"><label for="f-total">Total distributors in the office</label>'
        + '<input class="input" id="f-total" type="number" min="0" step="1" value="' + (mine ? mine.total_office : dists.length) + '"></div>'
        + '</div>'

        + '<div class="field"><label>Which niches did the orders come from?</label>'
        + '<div class="chips" id="niche-chips">' + nicheChips(niches) + '</div>'
        + '<div class="combo" style="margin-top:9px"><input class="input" id="niche-input" placeholder="Type a product and press Enter to add it" autocomplete="off">'
        + '<div id="niche-menu"></div></div>'
        + '<div class="hint">Press Enter to add what you typed. Anything that is not already on the list '
        + 'joins the catalogue for every office.</div></div>'

        + '<div class="field"><label>Anything brand new this week?</label>'
        + '<div class="chips" id="new-chips">' + (newNiches.length ? newNiches.map(n =>
          '<span class="chip new">' + esc(n) + '<button type="button" data-act="new-niche-del" data-v="' + esc(n) + '">'
          + ico('x', 12) + '</button></span>').join('') : '<span class="sub">None marked.</span>') + '</div>'
        + '<div class="hint">Tick a niche above then press “Mark as new” to flag a product your office sold for the first time.</div>'
        + '<div class="row" style="margin-top:8px"><input class="input" id="new-niche-input" placeholder="A product sold for the first time" style="max-width:280px">'
        + '<button type="button" class="btn btn-sm" data-act="new-niche-add">' + ico('plus', 14) + 'Mark as new</button></div></div>'

        + '<div class="field"><label for="f-issues">What slowed you down this week?</label>'
        + '<textarea class="input" id="f-issues" placeholder="Anything the center should hear at the evaluation. Write “No major blockers” if the week ran clean.">'
        + esc(mine ? mine.issues : '') + '</textarea></div>'

        + '<div class="row" style="justify-content:flex-end">'
        + '<button type="submit" class="btn btn-a btn-pop btn-lg" data-act="report-save">'
        + ico('check', 16) + (mine ? 'Update the report' : 'File the report') + '</button></div>'
        + '</form></div>'

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
    if (kind === 'training') await A.events.ensureWeek(ws);
    const evs = await A.events.list(filter);
    const scans = evs.length ? await A.scans.forEvents(evs.map(e => e.id)) : [];
    const dists = await A.distributors.list(A.isOffice() ? { center: A.store.me.center_id } : {});

    const eligible = e => dists.filter(d => d.center_id === e.center_id
      && (e.elig === 'sm' ? SM_PLUS.includes(d.status) : true)).length;

    return {
      title: kind === 'training' ? 'Trainings' : 'Center events', picker: 'week',
      crumbs: esc(U.weekLabel(ws)),
      html: (kind === 'training'
        ? note('info', 'info', '<b>Senior Manager Training runs every Wednesday, Distributor Training every Friday, both at 2:45pm.</b> '
          + 'The platform creates them for each center. Open scanning when the session starts, and close it when it ends.')
        : '')
        + '<div class="card" style="margin-top:16px"><div class="card-h"><div>'
        + '<div class="card-t">' + (kind === 'training' ? 'This week\'s trainings' : 'Events this week') + '</div>'
        + '<div class="card-s">' + evs.length + ' session' + (evs.length === 1 ? '' : 's') + '.</div></div>'
        + '<div class="card-a">'
        + (A.isAdmin() && A.store.centers.length ? centerPick(S().center || A.store.centers[0].id, 'center') : '')
        + (kind === 'event' ? '<button class="btn btn-a btn-pop" data-act="event-new">' + ico('plus', 15) + 'New event</button>' : '')
        + '</div></div>'
        + table([{ label: 'Session' }, { label: 'Center' }, { label: 'Date' }, { label: 'Who may scan' },
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
                ? 'Trainings appear once at least one center exists. Create a center first.'
                : 'A center event is anything outside the two weekly trainings: a rally, a launch, a leaders\' meeting.',
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
        + (e.kind === 'training' ? 'Trainings' : 'Center events') + '</a> · ' + esc(c.name || ''),
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
              + '<td class="mono sub">' + esc(s.device_id || '—') + '</td></tr>';
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

        + '<div class="card"><div class="card-h"><div><div class="card-t">Did not come · ' + missed.length + '</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Office' }, { label: 'Status' }],
          missed.map(d => '<tr><td class="nm">' + esc(d.full_name) + '</td>'
            + '<td>' + esc((A.officeById(d.office_id) || {}).name || '—') + '</td>'
            + '<td>' + statusTag(d.status) + '</td></tr>'),
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
        { label: own ? 'Added' : 'Center' }, { label: '' }],
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
    if (!cid) return { title: 'Center', html: empty('layers', 'No center', 'Your office is not attached to a center yet.') };
    return centerDetail(cid);
  }

  /* ===================================================================
     SUBSCRIPTIONS
     =================================================================== */
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
      html: (!window.CONFIG.billingEnabled ? note('info', 'card',
        '<b>Card payments are not switched on yet.</b> Every office is on the free trial and nothing is charged. '
        + 'The plan is ' + U.ngn(plan.amountNgn) + ' every ' + plan.days + ' days after a ' + plan.trialDays
        + '-day trial. Turn on <span class="mono">billingEnabled</span> in config.js once Paystack is connected.')
        + '<div style="height:18px"></div>' : '')
        + '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">' + (own ? 'Your plan' : 'Every office') + '</div>'
        + '<div class="card-s">' + U.ngn(plan.amountNgn) + ' per office every ' + plan.days + ' days.</div></div></div>'
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
    const [admins, pending] = await Promise.all([A.people.admins(), A.people.pending()]);
    const asked = pending.filter(p => p.req_status === 'pending');
    const quiet = pending.filter(p => p.req_status !== 'pending');
    const wants = p => p.req_kind === 'leader'
      ? tag('Leader / Director', 't-gold')
      : tag('An office', 't-ok')
      + '<div class="sub"><b>' + esc(p.req_office_name || '—') + '</b>'
      + ' · ' + esc((A.centerById(p.req_center_id) || {}).name || 'no center') + '</div>'
      + '<div class="sub">' + esc(p.req_address || 'no address') + '</div>';
    return {
      title: 'Centers & admins',
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Centers</div>'
        + '<div class="card-s">A center holds its own offices and runs its own Wednesday evaluation.</div></div>'
        + '<div class="card-a"><button class="btn btn-a btn-pop" data-act="center-new">' + ico('plus', 15) + 'New center</button></div></div>'
        + table([{ label: 'Center' }, { label: 'Address' }, { label: 'Leader' }, { label: 'Offices', num: true }, { label: '' }],
          A.store.centers.map(c => '<tr><td class="nm">' + esc(c.name) + '</td>'
            + '<td>' + esc(c.address || '—') + '</td>'
            + '<td>' + esc(c.leader_name || '—') + '<div class="sub">' + esc(c.assistant_name || '') + '</div></td>'
            + '<td class="num">' + A.officesOf(c.id).length + '</td>'
            + '<td class="num"><button class="btn btn-sm" data-act="center-edit" data-id="' + c.id + '">'
            + ico('edit', 13) + 'Edit</button></td></tr>'),
          { empty: empty('layers', 'No centers yet', 'Everything else hangs off a center, so start here.') })
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
        + '<div class="card-s">Leaders see every center and run the Wednesday evaluation. They cannot create centers.</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Email' }, { label: 'Role' }, { label: 'Added' }, { label: '' }],
          admins.map(p => '<tr><td class="nm">' + esc(p.full_name || '—') + '</td>'
            + '<td>' + esc(p.email) + '</td>'
            + '<td>' + (p.role === 'super_admin' ? tag('Super Admin', 't-gold') : tag('Leader', 't-ok')) + '</td>'
            + '<td class="sub">' + esc(U.fullDate(p.created_at)) + '</td>'
            + '<td class="num">' + (p.role === 'platform_admin' && p.id !== A.store.me.id
              ? '<button class="btn btn-sm btn-d" data-act="drop-admin" data-id="' + p.id + '">Remove</button>' : '') + '</td></tr>'))
        + '</div>'
    };
  }

  /* ===================================================================
     ACCOUNT
     =================================================================== */
  async function account() {
    const me = A.store.me;
    const roleLabel = { super_admin: 'Super Admin', platform_admin: 'Leader', office: 'Office', pending: 'Waiting for approval' };
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
          + '<div class="card-s">What the center sees next to your reports.</div></div></div>'
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
    };
  }

  window.VIEWS = {
    dashboard: () => A.isOffice() ? officeDash() : adminDash(),
    evaluation, monthly, centers, offices, rankings,
    reports: reportsView,
    trainings: (id) => sessions('training', id),
    events: (id) => sessions('event', id),
    distributors, center: myCenter, subscriptions, admin: adminPanel, account,
    helpers: { rankOffices, totals, nicheTally, nicheChips, statusTag, STATUSES, SM_PLUS, LEADER }
  };
})();

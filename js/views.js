/* =====================================================================
   Sky Team Ife - views. Each one fetches what it needs and returns
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
       productive  what each earner brought in - amount over the pros
       numbers     how many people the office has in the room

     "Pros" are the people who actually write orders: distributors and
     senior managers. Newbies count towards the room but not towards
     productivity, or an office would be punished for training people.

     Each is scored against the best office in the same group, so a score
     is "how close to the leader" rather than a raw figure. The weights
     below are the whole of the policy - change them here and every
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
         not - the same people come back - so it is the largest week, not
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
     hold. Displayed under whichever spelling was written most often -
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

  /* The score decides the order - it does not have to be read as a
     number to do that. Four bands turn it into a word instead, which is
     what the evaluation list shows: the grade an office earned, not the
     arithmetic behind it. */
  const GRADE_BANDS = [[80, 'Excellent', 't-ok'], [60, 'Good', 't-gold'],
    [40, 'Fair', 't-warn'], [0, 'Starting', 't-mute']];
  const grade = score => (GRADE_BANDS.find(b => score >= b[0]) || GRADE_BANDS[GRADE_BANDS.length - 1]);

  /* The standing, as a card. Used on the evaluation list and anywhere
     else a ranking has to be read rather than worked through - graded,
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
        + kpi('Leading office', top ? esc(top.office.name) : '-',
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

  /* ------------------------------------------------- how to do better */
  /* Read off the office's own numbers against its zone's, this month and
     the last eight weeks - nothing invented, nothing generic. Each line
     is a fact and the one thing to do about it, most urgent first, and
     at most four of them so it gets read. */
  function insights(d) {
    const out = [];
    const { ranked, meRank, monthReps, histReps, hist, myMonth } = d;
    const real = histReps.filter(r => !isEstimate(r));
    const filed = hist.filter(w => real.some(r => r.week_start === w)).length;
    const zoneFiled = ranked.filter(r => !r.missing);
    const zoneT = totals(monthReps);

    if (filed < hist.length) {
      out.push({ i: 'file', k: 'down', t: 'You filed ' + filed + ' of the last ' + hist.length + ' weeks.',
        d: 'A missing week counts as nothing in the ranking. Filing every week, even a slow one, is the easiest place to gain.' });
    }

    if (meRank.rank > 1 && !meRank.missing) {
      const above = ranked[meRank.rank - 2];
      const gap = Math.max(0, above.amount - meRank.amount);
      const aov = myMonth.orders ? myMonth.amount / myMonth.orders : 0;
      const need = aov ? Math.ceil(gap / aov) : 0;
      out.push({ i: 'crown', k: '', t: esc(above.office.name) + ' is one place above you.',
        d: gap > 0
          ? usd(gap) + ' more this month closes the gap' + (need ? ' - about ' + need + ' more order' + (need === 1 ? '' : 's') + ' at your usual order size.' : '.')
          : 'You are level on money; a bigger room or more per person moves you past them.' });
    }

    const last4 = hist.slice(-4), prev4 = hist.slice(0, -4);
    const avgOf = ws => {
      const rs = real.filter(r => ws.indexOf(r.week_start) > -1);
      return rs.length ? sumBy(rs, r => r.amount) / rs.length : null;
    };
    const a1 = avgOf(last4), a0 = avgOf(prev4);
    if (a1 !== null && a0) {
      const pct = Math.round(100 * (a1 - a0) / a0);
      const best = real.slice().sort((x, y) => y.amount - x.amount)[0];
      if (pct >= 5) {
        out.push({ i: 'trend', k: 'up', t: 'Up ' + pct + '% on the four weeks before.',
          d: 'Whatever changed is working. Keep the same training days and the same products in front.' });
      } else if (pct <= -5) {
        out.push({ i: 'trend', k: 'down', t: 'Down ' + Math.abs(pct) + '% on the four weeks before.',
          d: best ? 'Your best recent week was ' + esc(U.weekRange(best.week_start)) + ' at ' + usd(best.amount)
            + ((best.niches || []).length ? ', selling ' + esc(best.niches.slice(0, 3).join(', ')) : '') + '. Go back to what you did that week.' : '' });
      }
    }

    const mineNiches = {};
    real.concat(monthReps.filter(r => r.office_id === d.off.id))
      .forEach(r => (r.niches || []).forEach(n => { mineNiches[String(n).toLowerCase()] = 1; }));
    const hot = nicheTally(monthReps.filter(r => r.office_id !== d.off.id))
      .filter(n => !mineNiches[n[0].toLowerCase()]).slice(0, 3).map(n => n[0]);
    if (hot.length) {
      out.push({ i: 'star', k: '', t: 'Selling in your zone, not in your office: ' + esc(hot.join(', ')) + '.',
        d: 'Other offices are getting orders from these this month. Ask them at the evaluation what is working.' });
    }

    if (myMonth.orders && zoneT.orders) {
      const mine = myMonth.amount / myMonth.orders, zone = zoneT.amount / zoneT.orders;
      if (mine < zone * 0.9) {
        out.push({ i: 'cash', k: 'down', t: 'Your average order is ' + usd(mine) + '; the zone\'s is ' + usd(zone) + '.',
          d: 'Same number of orders at the zone\'s size would add ' + usd((zone - mine) * myMonth.orders) + '. Lead with bigger packages.' });
      } else if (mine > zone * 1.1) {
        out.push({ i: 'cash', k: 'up', t: 'Your orders are worth more than the zone average (' + usd(mine) + ' vs ' + usd(zone) + ').',
          d: 'More orders at this size is your fastest way up - every extra one counts for more than anyone else\'s.' });
      }
    }

    if (meRank.pros && zoneFiled.length > 1) {
      const zonePer = sumBy(zoneFiled, r => r.amount) / (sumBy(zoneFiled, r => r.pros) || 1);
      if (meRank.perPro < zonePer * 0.85) {
        out.push({ i: 'users', k: 'down', t: 'Each of your pros brings in ' + usd(meRank.perPro) + '; the zone average is ' + usd(zonePer) + '.',
          d: 'Pair the ones who are not selling with your best seller this week, and get them to Friday\'s training.' });
      }
    }

    if (zoneFiled.length > 1 && !meRank.missing) {
      const zonePeople = sumBy(zoneFiled, r => r.people) / zoneFiled.length;
      if (meRank.people < zonePeople * 0.85) {
        out.push({ i: 'users', k: '', t: 'Your room is ' + meRank.people + ' people; the zone average is ' + Math.round(zonePeople) + '.',
          d: 'Room size is almost a third of the ranking. Bring prospects to the Friday training.' });
      }
    }

    const recentNew = sumBy(real.filter(r => last4.indexOf(r.week_start) > -1), r => r.num_newbies);
    if (real.length >= 2 && recentNew === 0) {
      out.push({ i: 'plus', k: '', t: 'No newbies in the last four weeks.',
        d: 'New people are how a room grows. Aim for one new person a week.' });
    }
    return out.slice(0, 4);
  }

  function insightsCard(d) {
    const list = insights(d);
    return '<div class="card" style="margin-top:18px"><div class="card-h"><div>'
      + '<div class="card-t">How to do better</div>'
      + '<div class="card-s">From your own numbers against your zone\'s - ' + esc(U.monthLabel(U.currentMonthNo())) + '.</div></div></div>'
      + (list.length ? list.map(x => '<div class="ins"><div class="ins-i ' + x.k + '">' + ico(x.i, 16) + '</div>'
        + '<div><div class="ins-t">' + x.t + '</div><div class="ins-d">' + x.d + '</div></div></div>').join('')
        : empty('trend', 'Nothing to flag', 'File a few weeks and this fills with what to work on.'))
      + '</div>';
  }

  /* The newest answers the Directors have given this office. */
  function solutionsCard(sols) {
    if (!sols || !sols.length) return '';
    const latest = sols.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3);
    return '<div class="card" style="margin-top:18px"><div class="card-h"><div>'
      + '<div class="card-t">Solutions from your Directors</div>'
      + '<div class="card-s">Answers to the issues you raised. All of them are on the report for that week.</div></div></div>'
      + latest.map(s => '<div class="iss"><div class="iss-h"><span class="iss-n">!</span><div class="iss-t">' + esc(s.issue)
        + '<div class="sub">' + esc(U.weekName(s.week_start) + ' · ' + U.weekRange(s.week_start)) + '</div></div></div>'
        + '<div class="iss-sol">' + ico('check', 13) + '<div><b>' + esc(s.solved_by_name || 'Directors') + ':</b> ' + esc(s.solution) + '</div></div></div>').join('')
      + '</div>';
  }

  async function officeDash() {
    const me = A.store.me, off = me.office, ws = S().week;
    const prev = U.iso(U.addDays(ws, -7));
    const hist = U.recentWeeks(8).reverse();
    /* The zone standing is scoped to the current month rather than the
       one week on screen - "where do we stand" and "what does it take
       to be #1" are both month questions, and rankOffices already knows
       how to add several weeks of reports together. */
    const mn = U.currentMonthNo();
    const monthWeeks = U.weeksOfMonth(mn).filter(U.weekStarted);
    const [mine, prevMine, monthReps, histReps, dists, evs, goal, sols] = await Promise.all([
      A.reports.get(off.id, ws),
      A.reports.get(off.id, prev),
      A.reports.list({ weeks: monthWeeks, center: off.center_id }),
      A.reports.list({ weeks: hist, office: off.id }),
      A.distributors.list({ office: off.id }),
      A.events.list({ week: ws, center: off.center_id }),
      A.feature('goals') ? A.goals.get(off.id, mn) : null,
      A.issues.solutions({ office: off.id }).catch(() => [])
    ]);
    const myMonth = totals(monthReps.filter(r => r.office_id === off.id));
    const ranked = rankOffices(monthReps, A.officesOf(off.center_id).filter(o => o.active));
    const meRank = ranked.find(r => r.office_id === off.id) || {};
    const leader = ranked.find(r => !r.missing);
    const iLead = leader && leader.office_id === off.id;
    /* What it would take to match the leader's raw numbers this month -
       not a guarantee of #1, since the ranking also weighs output per
       pro and room size, but the plainest possible answer to "how much
       more". Floored at zero so a leader never reads a negative gap. */
    const amountGap = leader && !iLead ? Math.max(0, leader.amount - (meRank.amount || 0)) : 0;
    const orderGap = leader && !iLead ? Math.max(0, leader.orders - (meRank.orders || 0)) : 0;
    const series = hist.map(w => {
      const r = histReps.find(x => x.week_start === w);
      return { l: 'W' + U.weekNo(w), v: r ? Number(r.amount) : 0 };
    });
    const scanCounts = evs.length ? await A.scans.forEvents(evs.map(e => e.id)) : [];
    const mineScans = scanCounts.filter(s => s.office_id === off.id && s.status === 'accepted');
    /* hist is oldest-first for the chart above; the streak needs the
       opposite order, since "how many in a row" only means something
       counted backward from right now. */
    const streak = A.feature('streaks') ? U.filingStreak(histReps, hist.slice().reverse()) : 0;

    return {
      title: 'Dashboard', picker: 'week',
      crumbs: esc(off.name + ' · ' + ((A.centerById(off.center_id) || {}).name || ''))
        + (A.feature('streaks') && streak > 0
          ? ' · <span style="color:var(--blue)">' + streak + ' week' + (streak === 1 ? '' : 's') + ' straight</span>' : ''),
      html:
        ''
        /* One reminder, not a stack of them: whatever is still to file,
           last week first since it is the older of the two. */
        + ((() => {
          const lastWk = U.iso(U.addDays(U.weekStart(), -7));
          const todo = [];
          if (!prevMine && ws === U.weekStart()) {
            todo.push('<a href="#" data-act="go-week" data-v="' + lastWk + '" style="text-decoration:underline;font-weight:600">'
              + 'last week (' + esc(U.weekRange(lastWk)) + ')</a>');
          }
          if (!mine && !U.weekClosed(ws)) {
            todo.push('<a href="' + link('reports') + '" style="text-decoration:underline;font-weight:600">this week</a>');
          }
          if (!todo.length) return '';
          return note('gold', 'alert', '<b>Still to file:</b> ' + todo.join(' and ') + '.')
            + '<div style="height:18px"></div>';
        })())
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
        + kpi('Your orders', mine ? Number(mine.orders).toLocaleString() : '-',
          mine ? U.change(mine.orders, prevMine ? prevMine.orders : 0) : 'No report for this week', 'trend')
        + kpi('Your amount', mine ? usd(mine.amount) : '-',
          mine ? U.change(mine.amount, prevMine ? prevMine.amount : 0) : 'Nothing filed yet', 'cash', 'kpi-blue')
        + kpi('Rank this month', meRank.rank ? '#' + meRank.rank + ' of ' + ranked.length : '-',
          esc(U.monthLabel(mn)) + ' · ' + esc((A.centerById(off.center_id) || {}).name || ''), 'crown', 'kpi-dark')
        /* The whole point of a rank: what does it take to move it. Not
           shown at all until at least one office has filed something
           this month - a gap against nothing means nothing. */
        + (!leader ? kpi('To be #1', '-', 'No reports yet this month', 'star')
          : iLead ? kpi('To be #1', 'You lead', esc(U.monthLabel(mn)) + ' so far', 'star', 'kpi-blue')
            : meRank.missing ? kpi('To be #1', 'File first', 'This month has no report from you yet', 'star')
              : kpi('To be #1', usd(amountGap) + ' more',
                orderGap + ' more order' + (orderGap === 1 ? '' : 's') + ' than now', 'star'))
        + '</div>'

        + insightsCard({ off, ranked, meRank, monthReps, histReps, hist, myMonth })
        + solutionsCard(sols)

        + '<div class="grid g-2-1" style="margin-top:18px">'
        + '<div class="card"><div class="card-h"><div><div class="card-t">Your amount by week</div>'
        + '<div class="card-s">The last eight weeks you filed.</div></div>'
        + '<div class="card-a">' + chartToggle(S().chartType) + '</div></div>'
        + chart(series, series.length - 1, S().chartType) + '</div>'

        + '<div class="stack">'
        + '<div class="card"><div class="card-h"><div><div class="card-t">This month in your zone</div>'
        + '<div class="card-s">' + esc(U.monthLabel(mn)) + ' · ' + RANK_BASIS + '</div></div></div>'
        + (ranked.length ? ranked.slice(0, 6).map(r =>
          '<div class="spread" style="padding:9px 0;border-bottom:1px solid #edf0f7">'
          + '<div class="row" style="gap:9px"><span class="rk rk-' + r.rank + '">' + r.rank + '</span>'
          + '<span class="' + (r.office_id === off.id ? 'nm' : '') + '">' + esc(r.office.name)
          + (r.office_id === off.id ? ' <span class="tag t-ok">You</span>' : '') + '</span></div>'
          + '<div class="num nm">' + (r.missing ? '<span style="color:var(--faint)">-</span>' : usd(r.amount)) + '</div></div>').join('')
          : empty('crown', 'No reports yet', 'Once offices in your zone file, the ranking appears.'))
        + '</div>'

        + (!A.feature('goals') ? '' : '<div class="card" id="goal-card"><div class="card-h"><div>'
          + '<div class="card-t">Your goal for ' + esc(U.monthLabel(mn)) + '</div>'
          + '<div class="card-s">' + (goal && (goal.target_orders || goal.target_amount)
            ? myMonth.orders + ' of ' + goal.target_orders + ' orders · ' + usd(myMonth.amount) + ' of ' + usd(goal.target_amount)
            : 'Not set yet - pick a target and see how close you are all month.') + '</div></div></div>'
          + (goal && (goal.target_orders || goal.target_amount)
            ? '<div class="grid g2" style="margin-bottom:12px">'
            + '<div><div class="bar"><i style="width:' + Math.min(100, goal.target_orders ? 100 * myMonth.orders / goal.target_orders : 0) + '%"></i></div>'
            + '<div class="sub" style="margin-top:5px">Orders</div></div>'
            + '<div><div class="bar"><i style="width:' + Math.min(100, goal.target_amount ? 100 * myMonth.amount / goal.target_amount : 0) + '%"></i></div>'
            + '<div class="sub" style="margin-top:5px">Amount</div></div></div>' : '')
          + '<div class="row" style="gap:10px;flex-wrap:wrap">'
          + '<div class="field" style="margin:0;flex:1;min-width:120px"><label for="goal-orders">Target orders</label>'
          + '<input class="input" id="goal-orders" type="number" min="0" step="1" value="' + (goal ? goal.target_orders : '') + '"></div>'
          + '<div class="field" style="margin:0;flex:1;min-width:120px"><label for="goal-amount">Target amount</label>'
          + '<input class="input" id="goal-amount" type="number" min="0" step="1" value="' + (goal ? goal.target_amount : '') + '"></div>'
          + '<button class="btn btn-a" style="align-self:flex-end" data-act="save-goal">Save</button>'
          + '</div></div>')

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
     ISSUES & SOLUTIONS  (Super Admin, Directors)
     Every issue an office raised this month, one card each, with a box
     for the solution. The office sees the answer under its own issue.
     =================================================================== */
  async function issuesBoard() {
    const ro = A.isMember();
    const key = S().month || U.currentMonthNo();
    const weeks = U.weeksOfMonth(key).filter(U.weekStarted);
    const zone = S().issueZone || '';
    const show = S().issueShow || 'open';
    if (!weeks.length) return { title: 'Issues & solutions', picker: 'month', html: empty('alert', 'Nothing for this month', 'Pick another month.') };

    const reps = await A.reports.list(zone ? { weeks, center: zone } : { weeks });
    let sols = [], missing = '';
    try { sols = reps.length ? await A.issues.solutions({ weeks }) : []; }
    catch (e) { if (e.missingTable) missing = e.message; else throw e; }

    const all = [];
    reps.forEach(r => {
      if (isEstimate(r)) return;
      A.issues.split(r.issues).forEach(t => all.push({
        r, t, s: sols.find(x => x.report_id === r.id && x.issue === t) || null,
        name: ((A.officeById(r.office_id) || {}).name || '-')
      }));
    });
    all.sort((a, b) => (a.r.week_start < b.r.week_start ? 1 : a.r.week_start > b.r.week_start ? -1 : a.name.localeCompare(b.name)));
    const open = all.filter(x => !x.s), solved = all.filter(x => x.s);
    const list = show === 'open' ? open : show === 'solved' ? solved : all;
    S().issueRows = list;

    const seg = [['open', 'Need a solution', open.length], ['solved', 'Solved', solved.length], ['all', 'All', all.length]]
      .map(o => '<button class="' + (show === o[0] ? 'on' : '') + '" data-act="issue-show" data-v="' + o[0] + '">'
        + o[1] + ' · ' + o[2] + '</button>').join('');
    const zonePick = '<select class="select" data-act="issue-zone" style="max-width:230px">'
      + '<option value="">All zones</option>'
      + A.store.centers.map(c => '<option value="' + c.id + '"' + (c.id === zone ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')
      + '</select>';

    return {
      title: 'Issues & solutions', picker: 'month', crumbs: esc(U.monthLabel(key)),
      html: (missing ? note('warn', 'alert', '<b>' + esc(missing) + '</b> Until then the issues show, but solutions cannot be saved.')
        + '<div style="height:16px"></div>' : '')
        + '<div class="grid g3">'
        + kpi('Issues raised', all.length, esc(U.monthLabel(key)), 'alert')
        + kpi('Need a solution', open.length, open.length ? 'Answer them below' : 'All answered', 'clock', open.length ? 'kpi-dark' : '')
        + kpi('Solved', solved.length, all.length ? Math.round(100 * solved.length / all.length) + '% answered' : '', 'check', 'kpi-blue')
        + '</div>'
        + '<div class="row" style="margin:18px 0 12px;gap:10px;flex-wrap:wrap;justify-content:space-between">'
        + '<div class="seg">' + seg + '</div>' + (ro ? '' : zonePick) + '</div>'
        + (list.length ? list.map((x, i) =>
          '<div class="card iss-card" id="iss-card-' + i + '"><div class="card-h"><div>'
          + '<div class="card-t">' + esc(x.name) + '</div>'
          + '<div class="card-s">' + esc(((A.centerById(x.r.center_id) || {}).name || '') + ' · Week ' + U.weekOfMonth(x.r.week_start)
            + ' · ' + U.weekRange(x.r.week_start)) + '</div></div>'
          + '<div class="card-a" id="iss-tag-' + i + '">' + (x.s ? tag('Solved', 't-ok') : tag('Needs a solution', 't-warn')) + '</div></div>'
          + '<div class="iss-q">' + esc(x.t) + '</div>'
          + (ro ? '<div class="field" style="margin:12px 0 0"><label>Solution</label>'
            + '<p style="font-size:14px;line-height:1.6;margin:0;color:var(--muted)">' + (x.s ? esc(x.s.solution) : 'No solution yet.') + '</p>'
            + (x.s && x.s.solved_by_name ? '<div class="hint">Answered by ' + esc(x.s.solved_by_name) + '</div>' : '')
            + '</div></div>'
            : '<div class="field" style="margin:12px 0 0"><label for="sol-' + i + '">Solution</label>'
          + '<textarea class="input" id="sol-' + i + '" rows="2" placeholder="What should this office do about it?">'
          + esc(x.s ? x.s.solution : '') + '</textarea>'
          + (x.s && x.s.solved_by_name ? '<div class="hint">Last answered by ' + esc(x.s.solved_by_name) + ' · ' + esc(U.timeAgo(x.s.updated_at)) + '</div>' : '')
          + '</div>'
          + '<div class="row" style="justify-content:flex-end;margin-top:10px">'
          + '<button class="btn btn-sm btn-a" data-act="issue-solve" data-i="' + i + '"' + (missing ? ' disabled' : '') + '>'
          + ico('check', 14) + (x.s ? 'Update solution' : 'Save solution') + '</button></div></div>')).join('')
          : '<div class="card">' + empty('check', show === 'open' ? 'Nothing waiting' : 'Nothing here',
            show === 'open' ? 'Every issue raised this month has a solution.' : 'No issues for this filter.') + '</div>')
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
              return '<tr><td><span class="rk">-</span></td>'
                + '<td class="nm">' + esc(r.office.name)
                + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
                + '<td class="num">' + (pr ? usdFull(pr.amount) + '<div class="sub">' + pr.orders + ' orders</div>' : '-') + '</td>'
                + '<td class="num" colspan="7">' + tag('No report filed', 't-warn') + '</td></tr>';
            }
            return '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
              + '<td><span class="rk rk-' + r.rank + '">' + r.rank + '</span></td>'
              + '<td><div class="nm">' + esc(r.office.name) + '</div>'
              + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
              + '<td class="num">' + (pr ? usdFull(pr.amount) + '<div class="sub">' + pr.orders + ' orders</div>' : '-') + '</td>'
              + '<td class="num nm">' + usdFull(rep.amount) + '<div class="sub">' + rep.orders + ' orders</div></td>'
              + '<td class="num">' + (pr ? U.change(rep.amount, pr.amount) : '<span class="sub">first week</span>') + '</td>'
              + '<td class="sub">' + peopleIn(rep) + ' people<div class="sub">'
              + rep.num_distributors + ' dist · ' + rep.num_senior_managers + ' SM · ' + rep.num_newbies + ' new</div></td>'
              + '<td>' + ((rep.niches || []).map(n => tag(n)).join(' ') || '<span class="sub">-</span>') + '</td>'
              + '<td>' + ((rep.new_niches || []).map(n => tag(n, 't-dark')).join(' ') || '<span class="sub">-</span>') + '</td>'
              + '<td style="max-width:260px;white-space:pre-line">' + esc(rep.issues || '-') + '</td></tr>';
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
          mine ? (series.length ? series.reduce((a, b) => b.v > a.v ? b : a, series[0]).l : '-')
            : (ranked[0] ? esc(ranked[0].office.name) : '-'),
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
              + '<td>' + esc((A.centerById(r.office.center_id) || {}).name || '-') + '</td>'
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
        + '<td>' + esc(c.leader_name || '-') + '<div class="sub">' + esc(c.assistant_name || '') + '</div></td>'
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
        + kpi('Zone leader', esc(c.leader_name || '-'), esc(c.assistant_name ? 'Assistant: ' + c.assistant_name : ''), 'crown', 'kpi-dark')
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
            + '<td><span class="rk rk-' + r.rank + '">' + (r.missing ? '-' : r.rank) + '</span></td>'
            + '<td class="nm">' + esc(r.office.name)
            + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
            + '<td class="num">' + (r.missing ? tag('Not filed', 't-warn') : r.orders) + '</td>'
            + '<td class="num nm">' + (r.missing ? '-' : usdFull(r.amount)) + '</td></tr>'),
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
    const own = (A.isOffice() || A.isMember()) ? A.store.me.center_id : null;
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
        { label: 'Orders', num: true }, { label: 'Amount', num: true }]
          .concat(A.isSuper() ? [{ label: '' }] : []),
          list.map(o => {
            const r = reps.find(x => x.office_id === o.id);
            return '<tr class="click" data-href="' + link('offices', o.id) + '">'
              + '<td class="nm">' + esc(o.name) + '</td>'
              + '<td>' + esc((A.centerById(o.center_id) || {}).name || '-') + '</td>'
              + '<td>' + esc(o.manager_name || '-') + '<div class="sub">' + esc(o.email || '') + '</div></td>'
              + '<td class="num">' + dists.filter(d => d.office_id === o.id).length + '</td>'
              + '<td class="num">' + (r ? r.orders : tag('Not filed', 't-warn')) + '</td>'
              + '<td class="num nm">' + (r ? usdFull(r.amount) : '-') + '</td>'
              + (A.isSuper() ? '<td><button class="btn btn-sm" data-act="view-as" data-kind="office" data-id="' + o.id + '">View as</button></td>' : '')
              + '</tr>';
          }),
          { empty: empty('building', 'No offices yet', 'An office signs up on this site, picks its zone, and appears once you approve it.') })
        + '</div>'
    };
  }

  async function directors() {
    const list = (await A.people.admins()).filter(p => p.role === 'platform_admin');
    return {
      title: 'Directors',
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Every Director</div>'
        + '<div class="card-s">' + list.length + ' Director' + (list.length === 1 ? '' : 's')
        + '. Press View as to see the app exactly as they see it.</div></div></div>'
        + table([{ label: 'Director' }, { label: 'Zone' }, { label: 'Last seen' }, { label: '' }],
          list.map(p => '<tr><td class="nm">' + esc(p.full_name || p.email) + '<div class="sub">' + esc(p.email || '') + '</div></td>'
            + '<td>' + esc((A.centerById(p.center_id) || {}).name || 'All zones') + '</td>'
            + '<td>' + (p.last_seen ? esc(U.timeAgo(p.last_seen)) : '-') + '</td>'
            + '<td><button class="btn btn-sm" data-act="view-as" data-kind="director" data-id="' + p.id + '">View as</button></td></tr>'),
          { empty: empty('users', 'No Directors yet', 'A Director signs up, picks Director, and appears here once you approve them.') })
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
        + '<div><div class="perf-v">' + (p.rank ? '#' + p.rank + ' of ' + p.rankOf : '-') + '</div><div class="perf-l">Zone rank</div></div>'
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
            + '<td>' + statusTag(d.status) + '</td><td>' + esc(d.phone || '-') + '</td></tr>'),
          { empty: empty('users', 'No distributors', 'The office adds them from its own Distributors page.') })
        + '</div>'
    };
  }

  /* ===================================================================
     NICHES
     ---------------------------------------------------------------
     What is actually selling, across everything and then zone by zone.
     Counted by the number of reports a product appears on rather than
     by money, because a niche is a thing offices are working on - the
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

    /* One column per week that has opened so far this month - Week 1
       through however far the month has got, growing to four on its
       own once Week 4 arrives. Ranked by the whole month together;
       what each column shows is just that week's orders. */
    const weekHead = weeks.map(w => ({ label: 'Wk ' + U.weekOfMonth(w), num: true }));
    const ordersFor = (officeId, w) => {
      const rep = reps.find(x => x.office_id === officeId && x.week_start === w);
      return rep ? rep.orders : '-';
    };

    return {
      title: 'Office rankings', picker: 'month', crumbs: esc(U.monthLabel(mn)),
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Office rankings</div>'
        + '<div class="card-s">Every office across every zone. ' + RANK_BASIS
        + ' Orders by week, ' + esc(U.monthLabel(mn)) + '.</div></div></div>'
        + table([{ label: '#' }, { label: 'Office' }, { label: 'Zone' }].concat(weekHead)
          .concat([{ label: 'Amount', num: true }, { label: 'Score', num: true }, { label: '' }]),
          ranked.map(r => '<tr class="click" data-href="' + link('offices', r.office_id) + '">'
            + '<td><span class="rk rk-' + r.rank + '">' + (r.missing ? '-' : r.rank) + '</span></td>'
            + '<td class="nm">' + esc(r.office.name)
            + '<div class="sub">' + esc(r.office.manager_name || '') + '</div></td>'
            + '<td>' + esc((A.centerById(r.office.center_id) || {}).name || '-') + '</td>'
            + weeks.map(w => '<td class="num">' + ordersFor(r.office_id, w) + '</td>').join('')
            + '<td class="num nm">' + (r.missing ? tag('Not filed', 't-warn') : usdFull(r.amount)) + '</td>'
            + '<td class="num nm">' + (r.missing ? '-' : r.score) + '</td>'
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
              + '<td class="nm">' + esc(o.name || '-') + '</td>'
              + '<td>' + esc((A.centerById(r.center_id) || {}).name || '-') + '</td>'
              + '<td class="num">' + r.orders + '</td>'
              + '<td class="num nm">' + usdFull(r.amount) + '</td>'
              + '<td>' + ((r.niches || []).map(n => tag(n)).join(' ') || '-') + '</td>'
              + '<td>' + ((r.new_niches || []).map(n => tag(n, 't-dark')).join(' ') || '-') + '</td>'
              + '<td style="max-width:280px;white-space:pre-line">' + esc(r.issues || '-') + '</td>'
              + '<td class="sub">' + esc(U.timeAgo(r.submitted_at)) + '</td></tr>';
          }),
          { empty: empty('file', 'Nothing filed for this week', 'Offices file one report a week, before the Wednesday evaluation.') })
        + '</div>'
    };
  }

  async function officeReports() {
    const off = A.store.me.office, ws = S().week;
    /* Independent queries, so all of them go at once. */
    const [mine, all, dists, sols] = await Promise.all([
      A.reports.get(off.id, ws),
      A.reports.list({ office: off.id }),
      A.distributors.list({ office: off.id }),
      A.issues.solutions({ office: off.id }).catch(() => [])
    ]);
    const f = S().form || {};
    const niches = f.niches || (mine ? (mine.niches || []).slice() : []);
    const newNiches = f.newNiches || (mine ? (mine.new_niches || []).slice() : []);
    const issueItems = f.issues || (mine && !isEstimate(mine) ? A.issues.split(mine.issues) : []);
    S().form = { niches, newNiches, issues: issueItems };
    S().issueSols = mine ? sols.filter(s => s.report_id === mine.id) : [];

    const closed = U.weekClosed(ws);
    /* Every week of last tracking month and this one. Anything older is
       read only: that month has been reported on, so rewriting it after
       the fact would change a record people have already acted on. */
    const thisWk = U.weekStart();
    const lastWk = U.iso(U.addDays(thisWk, -7));
    const fileable = U.fileableWeeks();
    const openToFile = fileable.indexOf(ws) > -1;
    const oldestOpen = fileable[0];
    const lastFiled = all.some(r => r.week_start === lastWk);

    return {
      title: 'Weekly report', picker: 'week', crumbs: esc(U.weekLabel(ws)),
      html:
        /* The nudge, wherever they are in the picker. */
        (!lastFiled && ws !== lastWk
          ? note('warn', 'alert', '<b>Last week is still not filed.</b> '
            + esc(U.weekRange(lastWk)) + ' is missing. <a href="' + link('reports') + '" data-act="go-week" data-v="' + lastWk
            + '" style="text-decoration:underline">Fill it now</a>.') + '<div style="height:16px"></div>'
          : '')

        + '<div class="card"><div class="card-h"><div>'
        + '<div class="card-t">' + esc(U.weekName(ws)) + ' · ' + esc(U.weekRange(ws)) + '</div>'
        + '<div class="card-s">' + evalLine(ws) + '</div></div>'
        + '<div class="card-a">' + (isEstimate(mine) ? tag('Estimate - please update', 't-warn')
          : mine ? tag('Filed ' + U.timeAgo(mine.submitted_at), 't-ok') : tag('Not filed', 't-warn')) + '</div></div>'

        + (!openToFile
          ? note('info', 'lock', '<b>This week is closed for filing.</b> '
            + 'Only last month and this month can still be filled in, from <a href="#" data-act="go-week" data-v="'
            + oldestOpen + '" style="text-decoration:underline">' + esc(U.weekRange(oldestOpen)) + '</a> '
            + 'up to the week running now.')
          : (ws !== thisWk && !mine
            ? note('warn', 'alert', '<b>This week has no report yet.</b> '
              + 'You can still file it - pick any week of last month or this month from the Week menu at the top.')
              + '<div style="height:16px"></div>'
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

        /* One issue at a time, so each one can get its own answer from
           the Directors rather than a paragraph nobody replies to. */
        + '<div class="field"><label for="issue-input">What slowed you down this week?</label>'
        + '<div id="issue-list">' + issueList(issueItems, S().issueSols, openToFile) + '</div>'
        + (openToFile ? '<div class="row" style="margin-top:8px;gap:8px">'
          + '<input class="input" id="issue-input" placeholder="One issue - then press Enter or Add" style="flex:1;min-width:0" autocomplete="off">'
          + '<button type="button" class="btn btn-sm" data-act="issue-add">' + ico('plus', 14) + 'Add</button></div>'
          + '<div class="hint">Add each issue on its own. The Directors answer them one by one, and their solution shows up right here under the issue. Leave it empty if the week ran clean.</div>' : '')
        + '</div>'

        + (openToFile
          ? '<div class="row" style="justify-content:flex-end">'
          /* The week is named on the button as well as at the top of the
             form. The picker opens on the week running now, so filing on
             a Thursday for the seven days that just ended goes to the
             wrong week unless it is changed first - and that is exactly
             how a report ends up one week out. */
          + '<button type="submit" class="btn btn-a btn-pop btn-lg" data-act="report-save">'
          + ico('check', 16) + (mine ? 'Update ' : 'File ') + esc(U.weekName(ws)) + '</button></div>'
          + '</form>'
          : '</div>')
        + '</div>'

        + '<div class="card"><div class="card-h"><div><div class="card-t">Everything you have filed</div>'
        + '<div class="card-s">' + all.length + ' report' + (all.length === 1 ? '' : 's') + ', newest first.</div></div>'
        + (A.feature('csv_export') && all.length ? '<div class="card-a"><button class="btn btn-sm" data-act="export-reports">'
          + ico('file', 13) + 'Export CSV</button></div>' : '') + '</div>'
        + table([{ label: 'Week' }, { label: 'Orders', num: true }, { label: 'Amount', num: true }, { label: 'Niches' }, { label: 'Filed' }],
          all.map(r => '<tr><td class="nm">' + esc(U.weekName(r.week_start))
            + '<div class="sub">' + esc(U.weekRange(r.week_start)) + '</div></td>'
            + '<td class="num">' + r.orders + '</td>'
            + '<td class="num nm">' + usdFull(r.amount) + '</td>'
            + '<td>' + ((r.niches || []).map(n => tag(n)).join(' ') || '-') + '</td>'
            + '<td class="sub">' + (isEstimate(r) ? tag('Estimate', 't-warn') : esc(U.timeAgo(r.submitted_at))) + '</td></tr>'),
          { empty: empty('file', 'Nothing filed yet', 'Your first report is the one above.') })
        + '</div>'
    };
  }

  /* The office's issues, numbered, each with the Directors' answer under
     it once there is one. Editable only while the week is open. */
  function issueList(items, sols, editable) {
    if (!items.length) return '<div class="sub" style="padding:4px 0">No issues added.</div>';
    return items.map((t, i) => {
      const s = (sols || []).find(x => x.issue === t);
      return '<div class="iss">'
        + '<div class="iss-h"><span class="iss-n">' + (i + 1) + '</span><div class="iss-t">' + esc(t) + '</div>'
        + (editable ? '<button type="button" class="iss-x" data-act="issue-del" data-v="' + i + '" aria-label="Remove">' + ico('x', 13) + '</button>' : '')
        + '</div>'
        + (s ? '<div class="iss-sol">' + ico('check', 13) + '<div><b>Solution' + (s.solved_by_name ? ' from ' + esc(s.solved_by_name) : '') + ':</b> '
          + esc(s.solution) + '</div></div>'
          : '<div class="iss-wait">Waiting for a solution from the Directors</div>')
        + '</div>';
    }).join('');
  }

  /* A week the Super Admin filled in with an estimate (supabase/
     2026-10-backfill-estimates.sql) rather than one the office filed.
     It counts like any report, but says so wherever it shows, and the
     office filing that week for real replaces it. */
  const ESTIMATE_NOTE = 'Estimated by admin';
  const isEstimate = r => !!r && !r.submitted_by && String(r.issues || '').indexOf(ESTIMATE_NOTE) === 0;

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
       alongside rather than after - this page used to make four round
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
        ? note('info', 'info', '<b>Senior Manager Training runs every Wednesday, 3:00pm to 6:00pm.</b> '
          + 'The app creates it for each zone. Check-in is with the Wednesday code, and after 2:45pm counts as late.')
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
              + '<td>' + esc((A.centerById(e.center_id) || {}).name || '-') + '</td>'
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
      A.scans.forEvent(id), A.distributors.list({ center: e.center_id }),
      U.loadQr().catch(() => null)      // qrSvg below falls back on its own
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
        + kpi('Turnout', eligible.length ? U.pct((acc.length / eligible.length) * 100) : '-', '', 'trend', 'kpi-dark')
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
            return '<tr><td class="nm">' + esc(d.full_name || '-') + '</td>'
              + '<td>' + esc(o.name || '-') + '</td>'
              + '<td>' + (d.status ? statusTag(d.status) : '-') + '</td>'
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
              return '<tr><td>' + esc(d.full_name || '-') + '</td><td>' + esc(s.reason) + '</td>'
                + '<td>' + esc(U.clock(s.scanned_at)) + '</td>'
                + '<td class="mono sub">' + esc(s.device_id || '-') + '</td></tr>';
            })) + '</div>' : '')

        + '<div class="card"><div class="card-h"><div><div class="card-t">Did not come · ' + missed.length + '</div>'
        + (A.isAdmin()
          ? '<div class="card-s">Somebody here without a phone? Mark them in by hand. '
          + 'It is recorded as marked by you, not as a scan.</div>'
          : '') + '</div></div>'
        + table([{ label: 'Name' }, { label: 'Office' }, { label: 'Status' }]
          .concat(A.isAdmin() ? [{ label: '' }] : []),
          missed.map(d => '<tr><td class="nm">' + esc(d.full_name) + '</td>'
            + '<td>' + esc((A.officeById(d.office_id) || {}).name || '-') + '</td>'
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
        + (own && A.feature('csv_import')
          ? '<input type="file" id="dist-csv-file" data-act="dist-csv-file" accept=".csv,text/csv" hidden>'
          + '<button class="btn" data-act="dist-csv-pick" title="A sheet of names, one per row">'
          + ico('file', 15) + 'Import CSV</button>'
          + '<button class="btn" data-act="dist-csv-template" title="Download a blank one to fill in">'
          + ico('copy', 15) + 'Template</button>' : '')
        + (own ? '<button class="btn btn-a btn-pop" data-act="dist-new">' + ico('plus', 15) + 'Add distributor</button>' : '')
        + '</div></div>'
        + table([{ label: 'Name' }, { label: own ? 'Status' : 'Office' }, { label: own ? 'Phone' : 'Status' },
        { label: own ? 'Added' : 'Zone' }, { label: '' }],
          shown.map(d => '<tr>'
            + '<td class="nm">' + esc(d.full_name) + '</td>'
            + '<td>' + (own ? statusTag(d.status) : esc((A.officeById(d.office_id) || {}).name || '-')) + '</td>'
            + '<td>' + (own ? esc(d.phone || '-') : statusTag(d.status)) + '</td>'
            + '<td class="sub">' + (own ? esc(U.fullDate(d.created_at)) : esc((A.centerById(d.center_id) || {}).name || '-')) + '</td>'
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
     CENTERS & ADMINS  (super admin)
     =================================================================== */
  /* The ten features, each behind its own switch, off until turned on.
     Two - WhatsApp and SMS - have no code behind them yet: they need a
     provider picked and real credentials, which is a decision for
     outside this app, so their row is there and disabled rather than
     pretending a flip would do anything. */
  const FEATURES = [
    { flag: 'members', label: 'Member accounts and Wednesday check-in', sub: 'Senior and Executive Managers join through their office link, check in with the weekly zone code, and track their own distributors.' },
    { flag: 'streaks', label: 'Filing streaks', sub: 'How many weeks in a row an office has filed, shown on its own dashboard.' },
    { flag: 'csv_import', label: 'Distributor CSV import', sub: 'Upload a sheet of names instead of typing each one in.' },
    { flag: 'goals', label: 'Self-set monthly goals', sub: 'An office sets its own order and amount target for the month.' },
    { flag: 'csv_export', label: 'Export reports as CSV', sub: 'A download button on the weekly report history.' },
    { flag: 'activity_log', label: 'Activity log', sub: 'Who moved an office, edited a zone, or deleted what - with a time on it.' },
    { flag: 'monthly_digest', label: 'Monday zone digest', sub: 'Last week’s numbers, emailed to each Director. Needs notify deployed and scheduled.' },
    { flag: 'broadcast_email', label: 'Send an announcement', sub: 'A message to everyone in the app, or one role at a time, sent by you on demand. Needs notify deployed.' },
    { flag: 'whatsapp', label: 'WhatsApp notifications', sub: 'Coming soon - needs a WhatsApp Business API set up first.', soon: true },
    { flag: 'sms', label: 'SMS notifications', sub: 'Coming soon - needs an SMS gateway picked first.', soon: true }
  ];

  /* What people said in the "What's new" popup: does the update solve a
     problem, and then either what an office should pay and what they
     want, or what is missing. */
  function feedbackCard(fb, missing) {
    const yes = fb.filter(f => f.solves), no = fb.filter(f => !f.solves);
    const prices = yes.map(f => f.price_ngn).filter(p => p !== null && p !== undefined && p > 0).sort((a, b) => a - b);
    const mid = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : 0;
    const avg = prices.length ? Math.round(sumBy(prices, p => p) / prices.length) : 0;
    return '<div class="card"><div class="card-h"><div><div class="card-t">What people said about the update</div>'
      + '<div class="card-s">Answers from the "What\'s new" popup. Only you can see these.</div></div></div>'
      + (missing ? note('warn', 'alert', '<b>' + esc(missing) + '</b>')
        : !fb.length ? empty('mail', 'No answers yet', 'They come in as people open the app and answer the popup.')
          : '<div class="grid g4" style="margin-bottom:14px">'
          + kpi('Answers', fb.length, '', 'mail')
          + kpi('Says it helps', yes.length, fb.length ? Math.round(100 * yes.length / fb.length) + '%' : '', 'check', 'kpi-blue')
          + kpi('Price they suggest', prices.length ? U.ngn(mid) : '-', prices.length ? 'middle answer · average ' + U.ngn(avg) : 'No prices yet', 'cash')
          + kpi('Wants more', no.length, 'said it does not help yet', 'alert')
          + '</div>'
          + table([{ label: 'Who' }, { label: 'Helps?' }, { label: 'Price / month', num: true }, { label: 'What they want' }, { label: 'When' }],
            fb.map(f => '<tr><td class="nm">' + esc(f.name || '-')
              + '<div class="sub">' + esc(f.role === 'office' ? ((A.officeById(f.office_id) || {}).name || 'Office') : f.role === 'platform_admin' ? 'Director' : f.role === 'super_admin' ? 'Super Admin' : f.role) + '</div></td>'
              + '<td>' + (f.solves ? tag('Yes', 't-ok') : tag('No', 't-warn')) + '</td>'
              + '<td class="num nm">' + (f.price_ngn ? U.ngn(f.price_ngn) : '-') + '</td>'
              + '<td style="max-width:320px;white-space:pre-line">' + esc((f.solves ? f.features : f.needs) || '-') + '</td>'
              + '<td class="sub">' + esc(U.timeAgo(f.created_at)) + '</td></tr>'), {}))
      + '</div>';
  }

  /* Notifications on this device, and the test. The status line is
     filled in after the page paints - the browser has to be asked. */
  function pushCard() {
    return '<div class="card" id="push-card"><div class="card-h"><div><div class="card-t">Push notifications</div>'
      + '<div class="card-s">Turn them on for this phone or computer, then send yourself a test.</div></div></div>'
      + '<div id="push-status" class="sub" style="margin-bottom:12px">Checking this device…</div>'
      + '<div class="row" style="gap:8px;flex-wrap:wrap">'
      + '<button class="btn btn-a" data-act="push-on">' + ico('drop', 14) + 'Turn on for this device</button>'
      + '<button class="btn" data-act="push-test">' + ico('play', 14) + 'Send me a test</button>'
      + '</div></div>';
  }

  async function adminPanel() {
    let fbMissing = '';
    const [admins, pending, all, fb] = await Promise.all([
      A.people.admins(), A.people.pending(), A.people.everyone(),
      A.feedback.list().catch(e => { fbMissing = e.missingTable ? e.message : 'Could not load the answers: ' + e.message; return []; })
    ]);
    const asked = pending.filter(p => p.req_status === 'pending');
    const quiet = pending.filter(p => p.req_status !== 'pending');
    const wants = p => p.req_kind === 'leader'
      ? tag('Director', 't-gold')
      : tag('An office', 't-ok')
      + '<div class="sub"><b>' + esc(p.req_office_name || '-') + '</b>'
      + ' · ' + esc((A.centerById(p.req_center_id) || {}).name || 'no zone') + '</div>'
      + '<div class="sub">' + esc(p.req_address || 'no address') + '</div>';
    return {
      title: 'Zones & directors',
      html: pushCard()
        + feedbackCard(fb, fbMissing)
        + '<div class="card"><div class="card-h"><div><div class="card-t">Features</div>'
        + '<div class="card-s">Off until you turn it on. Nothing here changes what anyone sees by itself.</div></div></div>'
        + FEATURES.map(f => U.toggleRow(f.flag, f.label, f.sub, A.feature(f.flag), f.soon)).join('')
        + '</div>'

        + (!A.feature('broadcast_email') ? '' : '<div class="card"><div class="card-h"><div>'
          + '<div class="card-t">Send an announcement</div>'
          + '<div class="card-s">One email, to everyone or to one role. Goes out the moment you press send - '
          + 'there is no draft and no undo.</div></div></div>'
          + '<div class="field"><label for="an-audience">Who gets it</label>'
          + '<select class="select" id="an-audience">'
          + '<option value="all">Everyone in the app</option>'
          + '<option value="office">Offices only</option>'
          + '<option value="platform_admin">Directors only</option>'
          + '<option value="super_admin">Super Admins only</option>'
          + '</select></div>'
          + '<div class="field"><label for="an-subject">Subject</label>'
          + '<input class="input" id="an-subject" placeholder="An update from Sky Team Ife"></div>'
          + '<div class="field"><label for="an-message">Message</label>'
          + '<textarea class="input" id="an-message" rows="5" placeholder="Write it the way you would say it. A blank line starts a new paragraph."></textarea></div>'
          + '<div class="row" style="justify-content:flex-end">'
          + '<button class="btn btn-a btn-pop" data-act="send-announce">' + ico('mail', 15) + 'Send</button></div>'
          + '</div>')

        + '<div class="card"><div class="card-h"><div><div class="card-t">Zones</div>'
        + '<div class="card-s">A zone holds its own offices and runs its own Wednesday evaluation.</div></div>'
        + '<div class="card-a"><button class="btn btn-a btn-pop" data-act="center-new">' + ico('plus', 15) + 'New zone</button></div></div>'
        + table([{ label: 'Zone' }, { label: 'Zone leader' }, { label: 'Offices', num: true }, { label: '' }],
          A.store.centers.map(c => '<tr><td class="nm">' + esc(c.name) + '</td>'
            + '<td>' + esc(c.leader_name || '-') + '<div class="sub">' + esc(c.assistant_name || '') + '</div></td>'
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
            asked.map(p => '<tr><td class="nm">' + esc(p.full_name || '-')
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
            quiet.map(p => '<tr><td class="nm">' + esc(p.full_name || '-') + '</td>'
              + '<td>' + esc(p.email) + '</td><td class="sub">' + esc(U.timeAgo(p.created_at)) + '</td>'
              + '<td class="num">' + (p.req_status === 'declined'
                ? tag('Declined', 't-mute') + '<div class="sub">' + esc(p.req_note || '') + '</div>' : '')
              + '</td></tr>'))
          + '</div>' : '')

        + (await applicationsCard())
        + '<div class="card"><div class="card-h"><div><div class="card-t">Admins · ' + admins.length + '</div>'
        + '<div class="card-s">Directors see every zone and run the Wednesday evaluation. They cannot create zones.</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Email' }, { label: 'Role' }, { label: 'Added' }, { label: '' }],
          admins.map(p => '<tr><td class="nm">' + esc(p.full_name || '-') + '</td>'
            + '<td>' + esc(p.email) + '</td>'
            + '<td>' + (p.role === 'super_admin' ? tag('Super Admin', 't-gold') : tag('Director', 't-ok')) + '</td>'
            + '<td class="sub">' + esc(U.fullDate(p.created_at)) + '</td>'
            + '<td class="num">' + (p.role === 'platform_admin' && p.id !== A.store.me.id
              ? '<button class="btn btn-sm btn-d" data-act="drop-admin" data-id="' + p.id + '">Remove</button>' : '') + '</td></tr>'))
        + '</div>'

    };
  }

  /* The NeoLife anthem, at the foot of every dashboard. */
  const anthemCard = () => '<div class="card" style="margin-top:16px"><div class="card-h"><div>'
    + '<div class="card-t">NeoLife anthem</div><div class="card-s">Press play. About three minutes.</div></div></div>'
    + '<video controls preload="none" playsinline poster="media/neolife-anthem.jpg" '
    + 'style="width:100%;border-radius:12px;background:#000"><source src="media/neolife-anthem.mp4" type="video/mp4"></video></div>';

  /* Senior and Executive Managers asking to become Directors. */
  async function applicationsCard() {
    let apps = [];
    try { apps = await A.member.applications(); } catch (e) { return ''; }
    if (!apps.length) return '';
    return '<div class="card"><div class="card-h"><div><div class="card-t">Director applications · ' + apps.length + '</div>'
      + '<div class="card-s">Senior and Executive Managers asking to step up. Any Director or the Super Admin can decide.</div></div></div>'
      + table([{ label: 'Name' }, { label: 'Office' }, { label: '' }],
        apps.map(p => {
          const off = A.officeById(p.member_office_id);
          return '<tr><td class="nm">' + esc(p.full_name) + '<div class="sub">' + esc(p.rank || '') + (p.phone ? ' · ' + esc(p.phone) : '') + '</div></td>'
            + '<td>' + esc(off ? off.name : '-') + '<div class="sub">' + esc((A.centerById(p.center_id) || {}).name || '') + '</div></td>'
            + '<td style="white-space:nowrap"><button class="btn btn-sm btn-a" data-act="app-approve" data-id="' + p.id + '">Approve</button> '
            + '<button class="btn btn-sm btn-g" data-act="app-decline" data-id="' + p.id + '">Decline</button></td></tr>';
        }), { empty: '' })
      + '</div><div style="height:16px"></div>';
  }

  /* A Director's own Wednesday check-in. Late after 3:00pm. */
  async function directorCheckCard(me, thu) {
    const mine = (await A.member.directorCheckins(thu)).find(x => x.user_id === me.id);
    const ln = new Date(Date.now() + 3600000);
    const isWed = ln.getUTCDay() === 3, hhmm = ln.toISOString().slice(11, 16);
    let body;
    if (mine) {
      body = '<div class="row" style="gap:10px;align-items:center">' + tag(mine.late ? 'Checked in, late' : 'Checked in, on time', mine.late ? 't-warn' : 't-ok')
        + '<span class="sub">at ' + esc(lagosClock(mine.scanned_at)) + '</span></div>';
    } else if (isWed && hhmm >= '13:00' && hhmm <= A.member.endFor(ln.toISOString().slice(0, 10))) {
      body = '<button class="btn btn-a btn-pop btn-lg btn-block" data-act="dir-check-in">' + ico('check', 16) + 'Check in to the training</button>'
        + '<div class="hint" style="margin-top:8px">After 3:00pm counts as late.</div>';
    } else if (isWed && hhmm < '13:00') {
      body = note('info', 'clock', '<b>Check-in opens at 1:00pm today.</b>');
    } else if (isWed) {
      body = note('warn', 'clock', '<b>Today\'s training is over.</b>');
    } else {
      body = note('info', 'calendar', '<b>Next check-in: Wednesday.</b> The Senior Manager Training.');
    }
    return '<div class="card"><div class="card-h"><div><div class="card-t">Your check-in</div>'
      + '<div class="card-s">Wednesday Senior Manager Training</div></div></div>' + body + '</div>';
  }

  /* A Director's home, in four parts: today, what needs them, the week, and everywhere they can go. */
  async function directorDash() {
    const me = A.store.me;
    const ws = S().week;
    const weeks = U.weeksOfMonth(U.currentMonthNo()).filter(U.weekStarted);
    const zone = me.center_id || '';
    const sec = t => '<h3 style="margin:22px 0 10px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600">' + t + '</h3>';
    const gap = '<div style="height:16px"></div>';

    /* Issues waiting for a solution this month. */
    let open = 0;
    try {
      const reps = weeks.length ? await A.reports.list(zone ? { weeks, center: zone } : { weeks }) : [];
      const sols = reps.length ? await A.issues.solutions({ weeks }).catch(() => []) : [];
      reps.forEach(r => {
        if (isEstimate(r)) return;
        A.issues.split(r.issues).forEach(t => { if (!sols.find(x => x.report_id === r.id && x.issue === t)) open++; });
      });
    } catch (e) { open = 0; }

    /* Today: check in and the code. */
    let checkCard = '', codeCard = '';
    if (A.feature('members')) {
      try { checkCard = await directorCheckCard(me, U.weekStart()); } catch (e) { checkCard = ''; }
      let codes = [], codeErr = '';
      try { codes = await A.member.codes(U.weekStart()); } catch (e) { codeErr = e.message || 'Could not load the code.'; }
      const zones = A.store.centers.filter(c => !zone || c.id === zone);
      codeCard = '<div class="card"><div class="card-h"><div><div class="card-t">Wednesday code</div>'
        + '<div class="card-s">Give this to your Senior and Executive Managers.</div></div></div>'
        + (codeErr ? note('warn', 'alert', '<b>' + esc(codeErr) + '</b> The database file for Member accounts may not have been run yet.') : '')
        + (zones.map(z => {
          const c = codes.find(x => x.center_id === z.id);
          return '<div style="text-align:center;margin:6px 0 14px"><div class="sub">' + esc(z.name) + '</div>'
            + (c ? '<div class="mono" style="font-size:38px;letter-spacing:.25em;font-weight:600">' + esc(c.code) + '</div>'
              : '<div class="sub">Not ready yet. Refresh in a moment.</div>') + '</div>';
        }).join('') || '<div class="sub">No zone yet.</div>')
        + '</div>';
    } else {
      codeCard = note('info', 'info', '<b>The Wednesday code is switched off.</b> The Super Admin turns on Member accounts and Wednesday check-in in Admin, Features.');
    }
    const todayHtml = sec('Today, Wednesday training')
      + (checkCard ? '<div class="grid g2">' + checkCard + codeCard + '</div>' : codeCard);

    /* This week: who has filed, totals, top three, who has not. */
    let weekHtml = '', needs = '';
    try {
      const wreps = await A.reports.list(zone ? { week: ws, center: zone } : { week: ws });
      const offs = A.store.offices.filter(o => o.active && (!zone || o.center_id === zone));
      const ranked = rankOffices(wreps, offs).filter(r => !r.missing).slice(0, 3);
      const orders = wreps.reduce((a, r) => a + (Number(r.orders) || 0), 0);
      const amount = wreps.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const notFiled = offs.filter(o => !wreps.find(r => r.office_id === o.id));
      weekHtml = sec(esc(U.weekName(ws)) + ', ' + esc(U.weekRange(ws)))
        + '<div class="grid g3">'
        + kpi('Offices filed', wreps.length + ' / ' + offs.length, 'this week', 'building')
        + kpi('Orders', orders, 'zone total', 'trend')
        + kpi('Amount', usdFull(amount), 'zone total', 'cash', 'kpi-blue')
        + '</div>'
        + (ranked.length ? gap + '<div class="card"><div class="card-h"><div><div class="card-t">Top offices this week</div></div>'
          + '<div class="card-a"><a class="btn btn-sm" href="' + link('rankings') + '">All rankings</a></div></div>'
          + table([{ label: '#', num: true }, { label: 'Office' }, { label: 'Orders', num: true }],
            ranked.map(r => '<tr><td class="num">' + r.rank + '</td><td class="nm">' + esc(r.office.name) + '</td><td class="num">' + r.orders + '</td></tr>'),
            { empty: '' }) + '</div>' : '');
      if (notFiled.length) {
        needs += '<div class="card"><div class="card-h"><div><div class="card-t">Not filed yet · ' + notFiled.length + '</div>'
          + '<div class="card-s">These offices have no report for this week.</div></div></div>'
          + '<div class="chips">' + notFiled.slice(0, 12).map(o => tag(o.name, 't-warn')).join(' ')
          + (notFiled.length > 12 ? ' ' + tag('+' + (notFiled.length - 12) + ' more', 't-mute') : '') + '</div></div>' + gap;
      }
    } catch (e) { weekHtml = ''; }

    /* What needs the Director. */
    const apps = await applicationsCard();
    if (open) {
      needs = '<a class="card" href="' + link('issues') + '" style="display:block;text-decoration:none;color:inherit">'
        + '<div class="card-h" style="margin:0"><div><div class="card-t">' + ico('alert', 18) + ' ' + open + ' issue' + (open === 1 ? '' : 's') + ' waiting for your solution</div>'
        + '<div class="card-s">Tap to answer them. The office sees your answer straight away.</div></div></div></a>' + gap + needs;
    }
    const needsHtml = (apps || needs) ? sec('Needs you') + apps + needs : '';

    /* Everywhere a Director can go. */
    const tile = (page, icon, title, sub) => '<a class="card" href="' + link(page) + '" style="display:block;text-decoration:none;color:inherit">'
      + '<div class="card-h" style="margin:0"><div><div class="card-t">' + ico(icon, 18) + ' ' + esc(title) + '</div>'
      + '<div class="card-s">' + esc(sub) + '</div></div></div></a>';
    const tiles = [
      tile('issues', 'alert', 'Issues & solutions', open ? open + ' waiting for you' : 'Everything is answered'),
      tile('centers', 'layers', 'Zones and offices', 'Every office, its numbers and reports'),
      tile('evaluation', 'clipboard', 'Evaluation list', 'For the Wednesday evaluation, as a PDF'),
      tile('rankings', 'crown', 'Office rankings', 'Who is ahead, week by week'),
      tile('monthly', 'calendar', 'Monthly summary', 'The shape of the month'),
      tile('niches', 'star', 'Niches', 'What is selling'),
      A.feature('members') ? tile('zonemembers', 'users', 'Members in your zone', 'Senior and Executive Managers') : '',
      tile('codes', 'qr', 'Wednesday training', 'The code, who has checked in, and the records')
    ].join('');
    return {
      title: 'Dashboard', crumbs: esc(me.full_name || 'Director') + (me.center ? ' · ' + esc(me.center.name) : ''),
      html: weekHtml + todayHtml + needsHtml + sec('Everything you can do') + '<div class="grid g2">' + tiles + '</div>'
    };
  }

  /* The Senior and Executive Managers in a Director's zone. Counts only for the people they follow up. */
  async function zoneMembersView() {
    const me = A.store.me;
    if (!A.feature('members')) return { title: 'Members in your zone', html: empty('lock', 'Not open yet', 'Member accounts have not been switched on.') };
    let list = [];
    try { list = await A.member.zoneMembers(me.center_id || null); }
    catch (e) {
      return { title: 'Members in your zone',
        html: note('warn', 'alert', '<b>' + esc(e.message) + '</b> Run the zone members database file in Supabase first.') };
    }
    const byCenter = {};
    list.forEach(m => { (byCenter[m.center_id] = byCenter[m.center_id] || []).push(m); });
    const atts = {};
    await Promise.all(Object.keys(byCenter).map(async c => {
      atts[c] = await A.member.attendance(c, byCenter[c].map(m => m.distributor_id).filter(Boolean));
    }));
    const stat = m => {
      const att = atts[m.center_id];
      if (!att) return '';
      const r = att.events.map(ev => A.member.classify(att, ev, m.distributor_id, m.joined)).filter(s => s !== 'none');
      const c = s => r.filter(x => x === s).length;
      return tag(c('present') + ' on time', 't-ok') + ' ' + tag(c('late') + ' late', 't-warn') + ' ' + tag(c('absent') + ' absent', 't-mute');
    };
    const total = list.reduce((a, m) => a + (Number(m.tracking) || 0), 0);
    return {
      title: 'Members in your zone',
      html: '<div class="grid g3">'
        + kpi('Members', list.length, 'Senior and Executive Managers', 'users')
        + kpi('Following up', total, 'people, in total', 'trend', 'kpi-blue')
        + kpi('Offices', Object.keys(list.reduce((o, m) => { o[m.office_id] = 1; return o; }, {})).length, 'with members', 'building')
        + '</div>'
        + '<div class="card" style="margin-top:16px"><div class="card-h"><div><div class="card-t">Every member</div>'
        + '<div class="card-s">Attendance is the last 12 Wednesdays. You see how many people each member follows up, never who they are.</div></div></div>'
        + table([{ label: 'Member' }, { label: 'Office' }, { label: 'Attendance' }, { label: 'Following up', num: true }],
          list.map(m => {
            const off = A.officeById(m.office_id);
            return '<tr><td class="nm">' + esc(m.name) + '<div class="sub">' + esc(m.rank || '') + '</div></td>'
              + '<td>' + esc(off ? off.name : '-') + '<div class="sub">' + esc((A.centerById(m.center_id) || {}).name || '') + '</div></td>'
              + '<td>' + stat(m) + '</td><td class="num">' + m.tracking + '</td></tr>';
          }),
          { empty: empty('users', 'No members yet', 'They appear when Senior and Executive Managers join through their office link.') })
        + '</div>'
    };
  }

  /* ===================================================================
     SIGN-INS (Super Admin): every account, who has signed in and when
     =================================================================== */
  async function signins() {
    const everyone = await A.people.all();
    const roleOf = p => p.role === 'pending' ? 'waiting' : p.role === 'platform_admin' ? 'director' : p.role;
    const filt = S().signFilter || 'all';
    const list = filt === 'all' ? everyone : everyone.filter(p => roleOf(p) === filt);
    const days = p => p.last_seen ? (Date.now() - new Date(p.last_seen).getTime()) / 86400000 : null;
    const active = everyone.filter(p => days(p) !== null && days(p) <= 7).length;
    const never = everyone.filter(p => !p.last_seen).length;
    const cnt = k => k === 'all' ? everyone.length : everyone.filter(p => roleOf(p) === k).length;
    const seg = [['all', 'Everyone'], ['office', 'Offices'], ['director', 'Directors'], ['member', 'Members'], ['waiting', 'Waiting']]
      .map(o => '<button class="' + (filt === o[0] ? 'on' : '') + '" data-act="sign-filter" data-v="' + o[0] + '">'
        + o[1] + ' · ' + cnt(o[0]) + '</button>').join('');
    const roleName = { super_admin: 'Super Admin', platform_admin: 'Director', office: 'Office', member: 'Member', pending: 'Waiting' };
    return {
      title: 'Sign-ins',
      html: '<div class="grid g3">'
        + kpi('Accounts', everyone.length, 'every sign-up', 'users')
        + kpi('Active this week', active, 'opened the app in 7 days', 'check', 'kpi-blue')
        + kpi('Never signed in', never, never ? 'created an account, never opened it' : 'everyone has', 'clock')
        + '</div>'
        + '<div class="row" style="margin:18px 0 12px;gap:10px;flex-wrap:wrap"><div class="seg">' + seg + '</div></div>'
        + '<div class="card"><div class="card-h"><div><div class="card-t">Who has signed in</div>'
        + '<div class="card-s">Most recent first. Stamped each time someone opens the app signed in.</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Role' }, { label: 'Office or zone' }, { label: 'Joined' }, { label: 'Last seen' }, { label: 'Sign-ins', num: true }],
          list.map(p => {
            const off = A.officeById(p.office_id || p.member_office_id);
            const zone = A.centerById(p.center_id || (off && off.center_id));
            const d = days(p);
            const state = d === null ? tag('Never', 't-warn') : d >= 14 ? tag(U.timeAgo(p.last_seen), 't-warn') : tag(U.timeAgo(p.last_seen), 't-ok');
            return '<tr><td class="nm">' + esc(p.full_name || '-') + '<div class="sub">' + esc(p.email || '') + '</div></td>'
              + '<td>' + esc(roleName[p.role] || p.role) + (p.rank ? '<div class="sub">' + esc(p.rank) + '</div>' : '') + '</td>'
              + '<td>' + esc(off ? off.name : '-') + '<div class="sub">' + esc(zone ? zone.name : '') + '</div></td>'
              + '<td class="sub">' + esc(U.fullDate(p.created_at)) + '</td>'
              + '<td>' + state + '</td>'
              + '<td class="num">' + (p.login_count || 0) + '</td></tr>';
          }),
          { empty: empty('users', 'Nobody here', 'No accounts match this filter.') })
        + '</div>'
    };
  }

  /* ===================================================================
     ACCOUNT
     =================================================================== */
  /* ===================================================================
     ACTIVITY LOG
     =================================================================== */
  async function activityLog() {
    if (!A.feature('activity_log')) {
      return { title: 'Activity log', html: empty('shield', 'Not turned on',
        'Admin -> Features has a switch for this. Nothing was recorded before it is on.') };
    }
    const rowsIn = await A.activity.list(200);
    return {
      title: 'Activity log',
      crumbs: 'Last 200 actions',
      html: '<div class="card">' + table(
        [{ label: 'When' }, { label: 'Who' }, { label: 'Did what' }, { label: 'To' }],
        rowsIn.map(r => '<tr><td class="sub">' + esc(U.timeAgo(r.created_at)) + '</td>'
          + '<td class="nm">' + esc(r.actor_name || '-') + '</td>'
          + '<td>' + esc(r.action) + '</td>'
          + '<td>' + esc(r.target_name || '-')
          + (r.detail ? '<div class="sub">' + esc(r.detail) + '</div>' : '') + '</td></tr>'),
        { empty: empty('shield', 'Nothing recorded yet', 'It fills in as zones and offices are managed.') })
        + '</div>'
    };
  }

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
     GUIDE  -  what the platform is for, and what this role does with it
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
      ['building', 'Watch every office', '<b>Offices</b>, <b>Office rankings</b> and <b>Weekly reports</b> give you the whole picture, week by week.']
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
        + '<div class="step"><div class="step-n">' + ico('clipboard', 18) + '<i>2</i></div>'
        + '<div><div class="step-t">Evaluation, the Wednesday after the week closes</div>'
        + '<div class="step-d">Read against the reports that were filed for that week.</div></div></div>'
        + '</div></div>'
    };
  }

  /* ===================================================================
     MEMBERS: Senior and Executive Managers (look only, plus their own)
     =================================================================== */
  const PEOPLE_STAGES = ['New number', 'Talking', 'Invited', 'Came to office', 'Joined'];
  const attTag = st => ({ present: tag('On time', 't-ok'), late: tag('Late', 't-warn'),
    absent: tag('Absent', 't-mute'), pending: tag('Not yet', 't-mute') }[st] || '');
  const lagosClock = ts => {
    const t = new Date(new Date(ts).getTime() + 3600000);
    const h = t.getUTCHours(), m = String(t.getUTCMinutes()).padStart(2, '0');
    return ((h % 12) || 12) + ':' + m + (h >= 12 ? 'pm' : 'am');
  };

  async function memberDash() {
    const me = A.store.me;
    if (!A.feature('members')) {
      return { title: 'Dashboard', html: empty('lock', 'Not open yet', 'Member accounts have not been switched on. Check back soon.') };
    }
    const thu = U.weekStart();
    await A.member.ensureWeek(me.center_id, thu);
    const [att, reps] = await Promise.all([
      A.member.attendance(me.center_id, me.distributor_id ? [me.distributor_id] : []),
      A.reports.list({ week: thu, center: me.center_id })
    ]);
    const joined = me.created_at;
    const rowsAtt = att.events.map(ev => ({ ev, st: A.member.classify(att, ev, me.distributor_id, joined) }))
      .filter(r => r.st !== 'none');
    const count = s => rowsAtt.filter(r => r.st === s).length;
    const thisEv = att.events.find(e => e.week_start === thu);
    const mine = thisEv ? att.scans.find(s => s.event_id === thisEv.id) : null;
    const isWed = thisEv && thisEv.event_date === att.today;

    let check;
    if (mine) {
      check = '<div class="row" style="gap:10px;align-items:center">' + tag(mine.late ? 'Checked in, late' : 'Checked in, on time', mine.late ? 't-warn' : 't-ok')
        + '<span class="sub">at ' + esc(lagosClock(mine.scanned_at)) + '</span></div>';
    } else if (isWed && att.hhmm >= '13:00' && att.hhmm <= A.member.endFor(att.today)) {
      check = '<form id="ci-form"><div class="field"><label for="ci-code">Code from your Director</label>'
        + '<input class="input" id="ci-code" maxlength="8" autocomplete="off" autocapitalize="characters" '
        + 'style="text-transform:uppercase;letter-spacing:.2em;font-size:20px" placeholder="ABCDE"></div>'
        + '<button class="btn btn-a btn-pop btn-lg btn-block" type="submit" data-act="check-in">' + ico('check', 16) + 'Check in</button>'
        + '<div class="hint" style="margin-top:8px">After 2:45pm counts as late. Not checked in by ' + (A.member.endFor(att.today) === '18:00' ? '6:00pm' : '8:00pm today') + ' means absent.</div></form>';
    } else if (isWed && att.hhmm < '13:00') {
      check = note('info', 'clock', '<b>Check-in opens at 1:00pm today.</b> Your Director will give you the code.');
    } else if (isWed) {
      check = note('warn', 'clock', '<b>Today\'s training is over.</b> If you did not check in you are marked absent.');
    } else {
      check = note('info', 'calendar', '<b>Next check-in: Wednesday.</b> The Senior Manager Training. Your Director gives you the code that day.');
    }

    const orders = reps.reduce((a, r) => a + (Number(r.orders) || 0), 0);
    const amount = reps.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const zoneOffices = A.store.offices.filter(o => o.active && o.center_id === me.center_id);
    const up = me.upgrade_status;
    const stepUp = '<div class="card" style="margin-top:16px"><div class="card-h"><div><div class="card-t">Step up</div>'
      + '<div class="card-s">Ready to lead? Apply to be a Director. Any Director or the Super Admin can approve you.</div></div></div>'
      + (up === 'pending' ? note('info', 'clock', '<b>Your application is waiting.</b> A Director or the Super Admin will decide.')
        : (up === 'declined' ? note('warn', 'alert', 'Your last application was declined. You can apply again.') + '<div style="height:10px"></div>' : '')
          + '<button class="btn btn-a" data-act="apply-director">' + ico('crown', 15) + 'Apply to be a Director</button>')
      + '</div>';
    return {
      title: 'Dashboard', crumbs: esc((me.office || {}).name || '') + ' · ' + esc((me.center || {}).name || ''),
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Wednesday check-in</div>'
        + '<div class="card-s">Senior Manager Training, ' + esc(me.rank || 'Senior Manager') + '</div></div></div>' + check + '</div>'
        + '<div class="grid g3" style="margin-top:16px">'
        + kpi('On time', count('present'), 'last 12 trainings', 'check', 'kpi-blue')
        + kpi('Late', count('late'), 'after 2:45pm', 'clock')
        + kpi('Absent', count('absent'), 'no check-in', 'alert')
        + '</div>'
        + '<div class="grid g3" style="margin-top:16px">'
        + kpi('Zone orders', orders, esc(U.weekName(thu)), 'trend')
        + kpi('Zone amount', usdFull(amount), esc(U.weekRange(thu)), 'cash', 'kpi-blue')
        + kpi('Offices filed', reps.length + ' / ' + zoneOffices.length, 'this week', 'building')
        + '</div>'
        + '<div class="card" style="margin-top:16px"><div class="card-h"><div><div class="card-t">Your attendance</div>'
        + '<div class="card-s">Newest first.</div></div></div>'
        + table([{ label: 'Wednesday' }, { label: 'Status' }],
          rowsAtt.map(r => '<tr><td class="nm">' + esc(U.dayLabel(r.ev.event_date)) + '</td><td>' + attTag(r.st) + '</td></tr>'),
          { empty: empty('qr', 'No trainings yet', 'Your first one is the next Wednesday.') })
        + '</div>'
        + stepUp
        + '<div class="row" style="gap:10px;margin-top:16px;flex-wrap:wrap">'
        + '<a class="btn" href="' + link('offices') + '">' + ico('building', 15) + 'Offices in your zone</a>'
        + '<a class="btn" href="' + link('issues') + '">' + ico('alert', 15) + 'Issues &amp; solutions</a>'
        + '<a class="btn" href="' + link('people') + '">' + ico('users', 15) + 'My distributors</a></div>'
    };
  }

  async function peopleView() {
    if (!A.feature('members')) return { title: 'My distributors', html: empty('lock', 'Not open yet', 'Member accounts have not been switched on.') };
    const list = await A.member.people.list();
    const n = s => list.filter(p => p.stage === s).length;
    const came = n('Came to office') + n('Joined');
    return {
      title: 'My distributors',
      html: '<div class="grid g3">'
        + kpi('Tracking', list.length, 'people you follow up', 'users')
        + kpi('Talking', n('Talking') + n('Invited'), 'talking or invited', 'trend', 'kpi-blue')
        + kpi('Came to office', came, list.length ? Math.round(100 * came / list.length) + '% of your list' : '', 'building')
        + '</div>'
        + '<div class="card" style="margin-top:16px"><div class="card-h"><div><div class="card-t">Your list</div>'
        + '<div class="card-s">Only you see the phone numbers. Your office leader sees names and stages. Directors see how many.</div></div>'
        + '<div class="card-a"><button class="btn btn-a btn-pop" data-act="person-new">' + ico('plus', 15) + 'Add someone</button></div></div>'
        + table([{ label: 'Name' }, { label: 'Phone' }, { label: 'Stage' }, { label: '' }],
          list.map(p => {
            const i = PEOPLE_STAGES.indexOf(p.stage);
            return '<tr><td class="nm">' + esc(p.name) + (p.note ? '<div class="sub">' + esc(p.note) + '</div>' : '') + '</td>'
              + '<td>' + esc(p.phone || '-') + '</td>'
              + '<td>' + tag(p.stage, p.stage === 'Joined' ? 't-ok' : p.stage === 'New number' ? 't-mute' : 't-warn') + '</td>'
              + '<td style="white-space:nowrap">'
              + (i < PEOPLE_STAGES.length - 1
                ? '<button class="btn btn-sm" data-act="person-next" data-id="' + p.id + '" data-v="' + PEOPLE_STAGES[i + 1] + '">To ' + esc(PEOPLE_STAGES[i + 1]) + '</button> ' : '')
              + '<button class="btn btn-sm btn-g" data-act="person-del" data-id="' + p.id + '" aria-label="Remove">' + ico('trash', 14) + '</button></td></tr>';
          }),
          { empty: empty('users', 'Nobody yet', 'Add the numbers you get from prospecting, then move each one along as they reply, visit and join.') })
        + '</div>'
    };
  }

  async function membersView() {
    const off = (A.store.me && A.store.me.office) || null;
    if (!off) return { title: 'Members', html: empty('building', 'No office', 'This page belongs to an office.') };
    if (!A.feature('members')) return { title: 'Members', html: empty('lock', 'Not open yet', 'Member accounts have not been switched on. The Super Admin turns them on.') };
    const [code, roster, names] = await Promise.all([A.member.joinCode(off.id), A.member.roster(off.id), A.member.names(off.id)]);
    const att = await A.member.attendance(off.center_id, roster.map(m => m.distributor_id).filter(Boolean));
    const url = window.CONFIG.appUrl + '/#/m/' + code;
    const stat = m => {
      const r = att.events.map(ev => A.member.classify(att, ev, m.distributor_id, m.joined)).filter(s => s !== 'none');
      const c = s => r.filter(x => x === s).length;
      return tag(c('present') + ' on time', 't-ok') + ' ' + tag(c('late') + ' late', 't-warn') + ' ' + tag(c('absent') + ' absent', 't-mute');
    };
    return {
      title: 'Members', crumbs: esc(off.name),
      html: '<div class="card"><div class="card-h"><div><div class="card-t">Your sign-up link</div>'
        + '<div class="card-s">Send this to your Senior and Executive Managers. They sign up through it and land in your office. No approval needed.</div></div></div>'
        + '<div class="field"><input class="input mono" readonly value="' + esc(url) + '" onclick="this.select()"></div>'
        + '<div class="row" style="gap:8px;flex-wrap:wrap">'
        + '<button class="btn btn-a" data-act="copy" data-v="' + esc(url) + '">' + ico('copy', 14) + 'Copy link</button>'
        + '<button class="btn" data-act="join-regen">' + ico('refresh', 14) + 'New link</button></div>'
        + '<div class="hint" style="margin-top:8px">A new link stops the old one working. People already in stay in.</div></div>'
        + '<div class="card" style="margin-top:16px"><div class="card-h"><div><div class="card-t">Your members</div>'
        + '<div class="card-s">' + roster.length + ' signed in. Attendance is the last 12 Wednesdays.</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Rank' }, { label: 'Attendance' }, { label: 'Following up', num: true }, { label: '' }],
          roster.map(m => '<tr><td class="nm">' + esc(m.name) + '<div class="sub">' + esc(m.phone || '') + (m.sponsor ? ' · Sponsor: ' + esc(m.sponsor) : '') + '</div></td>'
            + '<td>' + esc(m.rank || '-') + '</td><td>' + stat(m) + '</td>'
            + '<td class="num">' + m.tracking + '</td>'
            + '<td><button class="btn btn-sm btn-g" data-act="member-del" data-id="' + m.id + '" aria-label="Remove">' + ico('trash', 14) + '</button></td></tr>'),
          { empty: empty('users', 'No members yet', 'Share your link above. They appear here the moment they join.') })
        + '</div>'
        + '<div class="card" style="margin-top:16px"><div class="card-h"><div><div class="card-t">People your members are following up</div>'
        + '<div class="card-s">Names and stages only. The phone numbers stay private to each member.</div></div></div>'
        + table([{ label: 'Member' }, { label: 'Name' }, { label: 'Stage' }],
          names.map(x => '<tr><td>' + esc(x.member) + '</td><td class="nm">' + esc(x.name) + '</td><td>' + tag(x.stage, 't-mute') + '</td></tr>'),
          { empty: empty('users', 'Nothing yet', 'When members add people to follow up, their names show here.') })
        + '</div>'
    };
  }

  /* Directors and the Super Admin: this Wednesday's code, one per zone. */
  async function codesView() {
    const me = A.store.me;
    if (!A.feature('members')) return { title: 'Wednesday training', html: empty('lock', 'Not open yet', 'Turn on Member accounts in Admin, Features first.')
      + '<div class="row" style="justify-content:center;margin-top:12px"><a class="btn" href="' + link('trainings') + '">Session records</a></div>' };
    const thu = U.weekStart();
    const codes = await A.member.codes(thu);
    const wed = U.iso(U.addDays(thu, 6));
    const zones = A.store.centers.filter(c => !me.center_id || c.id === me.center_id);
    const [dirs, zscans] = await Promise.all([A.member.directorCheckins(thu).catch(() => []), A.member.zoneCheckins(thu).catch(() => [])]);
    const inRows = zscans.map(x => ({ n: (x.distributors || {}).full_name || '-', r: (x.distributors || {}).status || '', z: (A.centerById(x.events.center_id) || {}).name || '', at: x.scanned_at, late: x.late }))
      .concat(dirs.map(d => ({ n: (d.profiles || {}).full_name || (d.profiles || {}).email || '-', r: 'Director', z: '', at: d.scanned_at, late: d.late })))
      .sort((p, q) => (p.at < q.at ? -1 : 1));
    return {
      title: 'Wednesday training', crumbs: esc(U.fullDate(wed)),
      html: note('info', 'info', 'One code per zone, the same all day. Give it to your Senior and Executive Managers at the training. '
        + 'It is also sent to your phone at 2:00pm and 3:05pm. Check-in is open from 1:00pm to 6:00pm, and after 2:45pm counts as late.')
        + '<div style="height:16px"></div>'
        + (zones.length ? '<div class="grid g2">' + zones.map(z => {
          const c = codes.find(x => x.center_id === z.id);
          return '<div class="card"><div class="card-h"><div><div class="card-t">' + esc(z.name) + '</div>'
            + '<div class="card-s">Senior Manager Training</div></div></div>'
            + (c ? '<div style="font-size:40px;letter-spacing:.25em;font-weight:600;text-align:center;margin:8px 0" class="mono">' + esc(c.code) + '</div>'
              + '<div class="row" style="justify-content:center"><button class="btn btn-a" data-act="copy" data-v="' + esc(c.code) + '">' + ico('copy', 14) + 'Copy code</button></div>'
              : '<div class="sub">The code is not ready yet. Refresh in a moment.</div>')
            + '</div>';
        }).join('') + '</div>' : empty('layers', 'No zones', 'Create a zone first.'))
        + '<div class="card" style="margin-top:16px"><div class="card-h"><div><div class="card-t">Checked in this Wednesday · ' + inRows.length + '</div>'
        + '<div class="card-s">Senior Managers, Executive Managers and Directors, in the order they checked in.</div></div></div>'
        + table([{ label: 'Name' }, { label: 'Rank' }, { label: 'Zone' }, { label: 'Time' }, { label: 'Status' }],
          inRows.map(x => '<tr><td class="nm">' + esc(x.n) + '</td><td>' + esc(x.r) + '</td><td>' + esc(x.z) + '</td><td>' + esc(lagosClock(x.at)) + '</td>'
            + '<td>' + (x.late ? tag('Late', 't-warn') : tag('On time', 't-ok')) + '</td></tr>'),
          { empty: empty('qr', 'Nobody yet', 'Names appear here as people check in.') })
        + '</div>'
        + '<div class="row" style="margin-top:16px"><a class="btn" href="' + link('trainings') + '">' + ico('qr', 15) + 'Session records and scan sheets</a></div>'
    };
  }

  window.VIEWS = {
    guide,
    /* A Director's dashboard is the same page a Super Admin gets - every
       zone, every office, the whole week - not a view scoped down to
       their own zone. It is visibility only: the two role checks inside
       adminDash keep the create-a-zone link and button Super Admin only,
       so nothing here hands a Director a power they did not have. */
    dashboard: async () => {
      const v = await (A.isMember() ? memberDash() : A.isOffice() ? officeDash()
        : (A.store.me.role === 'platform_admin' ? directorDash() : adminDash()));
      v.html += anthemCard();
      return v;
    },
    people: peopleView, members: membersView, codes: codesView, signins, zonemembers: zoneMembersView,
    evaluation, monthly, centers, offices, directors, rankings, niches, issues: issuesBoard,
    reports: reportsView,
    trainings: (id) => sessions('training', id),
    events: (id) => sessions('event', id),
    distributors, center: myCenter, admin: adminPanel, account, activityLog,
    helpers: { rankOffices, totals, nicheTally, nicheChips, issueList, statusTag, STATUSES, SM_PLUS, LEADER, peopleIn }
  };
})();

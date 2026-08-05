/* =====================================================================
   Sky Team Ife — the page a distributor lands on after scanning the QR
   code at the door. No account, no password: pick your office, find your
   name, and you are in. One phone records one person per session.
   ===================================================================== */
(function () {
  'use strict';

  const U = window.UI, A = window.API;
  const { esc, ico } = U;
  const root = document.getElementById('root');

  const S = { step: 'load', code: '', data: null, office: null, dist: null, q: '', error: '', center: null };

  /* One stable id per handset, so the same phone cannot sign two people
     in. It is written to three places that heal each other: clearing any
     one of them leaves the other two to put it back. Only wiping all the
     site data resets it, and the database records the collision either
     way, so a second attempt is still written down as a rejection. */
  const DKEY = 'sti-device';
  function deviceId() {
    const fromCookie = () => {
      const m = document.cookie.match(/(?:^|;\s*)sti-device=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    };
    const get = (store) => { try { return store.getItem(DKEY); } catch (e) { return null; } };
    let d = get(window.localStorage) || get(window.sessionStorage) || fromCookie();
    if (!d) {
      d = '';
      for (let i = 0; i < 12; i++) d += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
    }
    try { localStorage.setItem(DKEY, d); } catch (e) { /* private mode */ }
    try { sessionStorage.setItem(DKEY, d); } catch (e) { /* private mode */ }
    document.cookie = DKEY + '=' + encodeURIComponent(d) + ';path=/;max-age=31536000;samesite=lax';
    return d;
  }

  const shell = (body, foot) => '<div class="scan-wrap">'
    + '<div class="scan-brand">' + U.logo(26) + '</div>'
    + '<div class="card scan-card">' + body + '</div>'
    + '<div class="scan-foot">' + esc(foot || (window.CONFIG.organisation || 'Sky Team Ife')) + '</div>'
    + '<div class="credit">Site developed by <b>Large Technologies</b></div></div>';

  function paint() {
    if (!window.CONFIG.ready || !A.ready) {
      root.innerHTML = shell('<div class="card-h"><div><div class="card-t">Not connected yet</div>'
        + '<div class="card-s">This site has not been pointed at its database.</div></div></div>'
        + U.note('gold', 'key', 'Paste your Supabase URL and anon key into <span class="mono">config.js</span>.'));
      return;
    }

    if (S.step === 'load') {
      root.innerHTML = shell('<div class="loading" style="min-height:180px">'
        + '<div class="spinner"></div><div class="card-s">Finding the session…</div></div>');
      return;
    }

    if (S.step === 'code') {
      root.innerHTML = shell(
        '<div class="card-h"><div><div class="card-t">Type the session code</div>'
        + '<div class="card-s">It is printed under the QR code at the door.</div></div></div>'
        + (S.error ? U.note('err', 'alert', esc(S.error)) + '<div style="height:14px"></div>' : '')
        + '<div class="field"><input class="input mono" id="s-code" placeholder="SM-XXXXXX-202631" '
        + 'autocapitalize="characters" autocomplete="off" value="' + esc(S.code) + '"></div>'
        + '<button class="btn btn-a btn-pop btn-lg btn-block" id="s-go">Find the session</button>');
      return;
    }

    if (S.step === 'pick') {
      const c = S.center.center, evs = S.center.events;
      root.innerHTML = shell(
        '<div class="card-h"><div><div class="card-t">' + esc(c.name) + '</div>'
        + '<div class="card-s">Pick the session happening now.</div></div></div>'
        + '<div class="auto" style="max-height:320px">'
        + (evs.length ? evs.map(e => '<button data-code="' + esc(e.code) + '">'
          + '<span style="flex:1"><span style="display:block;font-weight:500">' + esc(e.name) + '</span>'
          + '<span class="sub">' + esc(U.fullDate(e.date)) + ' · ' + esc(e.time) + '</span></span>'
          + (e.status === 'open' ? U.tag('Open', 't-ok') : U.tag(e.status === 'scheduled' ? 'Not open yet' : 'Closed', 't-mute'))
          + '</button>').join('')
          : '<div class="empty-d">No sessions this week yet. Ask the office.</div>')
        + '</div>');
      return;
    }

    if (S.step === 'office') {
      const e = S.data.event, c = S.data.center;
      root.innerHTML = shell(
        header(e, c)
        + '<div class="field"><label>Which office are you from?</label>'
        + '<div class="auto" style="max-height:340px">'
        + (S.data.offices.length
          ? S.data.offices.map(o => '<button data-office="' + o.id + '">'
            + '<span style="flex:1">' + esc(o.name) + '</span>'
            + ico('right', 15) + '</button>').join('')
          : '<div class="empty-d">No offices in this zone yet.</div>')
        + '</div></div>');
      return;
    }

    if (S.step === 'name') {
      const e = S.data.event, c = S.data.center;
      const q = S.q.toLowerCase();
      const list = S.data.distributors
        .filter(d => d.office_id === S.office.id)
        .filter(d => !q || d.name.toLowerCase().includes(q));
      root.innerHTML = shell(
        header(e, c)
        + '<div class="field"><label>Find your name · ' + esc(S.office.name) + '</label>'
        + '<input class="input" id="s-q" placeholder="Start typing your name" value="' + esc(S.q) + '" autocomplete="off"></div>'
        + '<div class="auto" style="max-height:260px">'
        + (list.length ? list.map(d => '<button data-dist="' + d.id + '">'
          + '<span style="flex:1">' + esc(d.name) + '</span>'
          + '<span class="tag t-mute">' + esc(d.status) + '</span></button>').join('')
          : '<div class="empty-d">' + (S.data.distributors.filter(d => d.office_id === S.office.id).length
            ? 'Nobody matches that.' : 'Your office has not added anybody yet. Ask your team leader.') + '</div>')
        + '</div>'
        + '<button class="btn btn-block" id="s-back" style="margin-top:14px">' + ico('left', 15) + 'Different office</button>');
      return;
    }

    /* Picking your name off a list is not proof. Completing the number
       the office already holds for you is. */
    if (S.step === 'phone') {
      const e = S.data.event, c = S.data.center, d = S.dist;
      const known = !!d.has_phone;
      root.innerHTML = shell(
        header(e, c)
        + '<div class="who"><div class="who-av">' + esc(U.initials(d.name)) + '</div>'
        + '<div><div class="who-n">' + esc(d.name) + '</div>'
        + '<div class="card-s">' + esc(S.office.name) + '</div></div></div>'
        + (known
          ? '<div class="ph-mask">' + esc(d.hint) + '<span>&bull;&bull;&bull; &bull;&bull;&bull;&bull;</span></div>'
          + '<div class="field"><label for="s-ph">Last 4 digits of your number</label>'
          + '<input class="input mono ph-in" id="s-ph" type="tel" inputmode="numeric" '
          + 'maxlength="4" placeholder="0000" autocomplete="off"></div>'
          : U.note('info', 'info', 'Your office has not saved a number for you. Type it once and we will keep it.')
          + '<div style="height:14px"></div>'
          + '<div class="field"><label for="s-ph">Your phone number</label>'
          + '<input class="input mono" id="s-ph" type="tel" inputmode="numeric" '
          + 'placeholder="0803 000 0000" autocomplete="tel"></div>')
        + (S.error ? U.note('err', 'alert', esc(S.error)) + '<div style="height:14px"></div>' : '')
        + '<button class="btn btn-a btn-pop btn-lg btn-block" id="s-send">Scan me in</button>'
        + '<button class="btn btn-block" id="s-notme" style="margin-top:10px">' + ico('left', 15) + 'Not me</button>');
      const f = document.getElementById('s-ph');
      if (f) setTimeout(() => f.focus(), 80);
      return;
    }

    if (S.step === 'sending') {
      root.innerHTML = shell('<div class="loading" style="min-height:180px">'
        + '<div class="spinner"></div><div class="card-s">Scanning you in…</div></div>');
      return;
    }

    if (S.step === 'done') {
      root.innerHTML = shell(
        '<div style="text-align:center">'
        + '<div class="big-ok">' + ico('check', 34, 2.4) + '</div>'
        + '<div class="card-t" style="font-size:20px">You are in, ' + esc(String(S.dist.name).split(' ')[0]) + '</div>'
        + '<div class="card-s" style="margin-top:6px">' + esc(S.data.event.name) + ' · ' + esc(S.data.center.name) + '</div>'
        + '<div class="card-s">' + esc(U.fullDate(S.data.event.date)) + ' · ' + esc(S.data.event.time) + '</div>'
        + '<div style="margin-top:18px">' + U.tag('Attendance recorded', 't-ok') + '</div>'
        + '<p class="card-s" style="margin-top:18px">You can close this page.</p></div>');
      return;
    }

    if (S.step === 'fail') {
      root.innerHTML = shell(
        '<div style="text-align:center">'
        + '<div class="big-ok big-no">' + ico('alert', 32, 2.2) + '</div>'
        + '<div class="card-t" style="font-size:19px">Not scanned in</div>'
        + '<div class="card-s" style="margin:8px auto 0;max-width:300px">' + esc(S.error) + '</div>'
        + '<button class="btn btn-block btn-lg" id="s-again" style="margin-top:20px">Try again</button></div>');
    }
  }

  const header = (e, c) => '<div class="card-h"><div>'
    + '<div class="card-t">' + esc(e.name) + '</div>'
    + '<div class="card-s">' + esc(c.name) + ' · ' + esc(U.fullDate(e.date)) + ' · ' + esc(e.time) + '</div></div>'
    + '<div class="card-a">' + (e.status === 'open' ? U.tag('Open', 't-ok') : U.tag('Not open', 't-warn')) + '</div></div>'
    + (e.status !== 'open'
      ? U.note('warn', 'clock', 'Scanning is not open yet. The office opens it when the session starts.')
      + '<div style="height:14px"></div>' : '')
    + (e.elig === 'sm'
      ? U.note('info', 'crown', 'This session is for Senior Managers and above.') + '<div style="height:14px"></div>' : '');

  /* The zone QR — one code per zone, forever. Look the zone up,
     list this week's sessions, and let the distributor pick one. */
  async function lookupCenter(id) {
    S.step = 'load'; paint();
    try {
      const { data, error } = await A.sb.rpc('center_lookup', { p_center: id });
      if (error) throw new Error(error.message);
      if (!data || !data.ok) {
        S.step = 'code'; S.error = (data && data.error) || 'That QR code does not match any zone.';
        paint(); return;
      }
      S.center = data; S.step = 'pick'; paint();
    } catch (err) {
      S.step = 'code'; S.error = err.message; paint();
    }
  }

  async function lookup(code) {
    S.step = 'load'; paint();
    try {
      const { data, error } = await A.sb.rpc('scan_lookup', { p_code: code });
      if (error) throw new Error(error.message);
      if (!data || !data.ok) {
        S.step = 'code'; S.error = (data && data.error) || 'That code does not match any session.';
        paint(); return;
      }
      S.data = data; S.code = code; S.error = '';
      S.step = 'office';
      /* One office in the zone? Skip straight to the name list. */
      if (data.offices.length === 1) { S.office = data.offices[0]; S.step = 'name'; }
      paint();
    } catch (err) {
      S.step = 'code'; S.error = err.message; paint();
    }
  }

  async function send(phone) {
    S.step = 'sending'; paint();
    try {
      const { data, error } = await A.sb.rpc('record_scan', {
        p_code: S.code, p_distributor: S.dist.id, p_device: deviceId(), p_phone: phone || ''
      });
      if (error) throw new Error(error.message);
      if (data && data.ok) { S.step = 'done'; S.error = ''; return paint(); }
      /* A wrong number or a missing one is worth another go; anything
         else — closed session, already in, wrong zone — is final. */
      S.error = (data && data.error) || 'We could not scan you in.';
      S.step = (data && (data.retry || data.needs_phone)) ? 'phone' : 'fail';
    } catch (err) { S.step = 'fail'; S.error = err.message; }
    paint();
  }

  /* --------------------------------------------------------- events */
  document.addEventListener('click', (e) => {
    const ev = e.target.closest('[data-code]');
    if (ev) { lookup(ev.dataset.code); return; }
    const off = e.target.closest('[data-office]');
    if (off) { S.office = S.data.offices.find(o => o.id === off.dataset.office); S.q = ''; S.step = 'name'; return paint(); }
    const d = e.target.closest('[data-dist]');
    if (d) {
      S.dist = S.data.distributors.find(x => x.id === d.dataset.dist);
      S.step = 'phone'; S.error = '';
      return paint();
    }
    if (e.target.closest('#s-send')) {
      const f = document.getElementById('s-ph');
      const v = (f && f.value || '').trim();
      if (!v) return;
      return send(v);
    }
    if (e.target.closest('#s-notme')) { S.step = 'name'; S.dist = null; S.error = ''; return paint(); }
    if (e.target.closest('#s-back')) { S.step = 'office'; S.office = null; return paint(); }
    if (e.target.closest('#s-again')) {
      S.step = S.dist ? 'phone' : S.office ? 'name' : 'office'; S.error = ''; return paint();
    }
    if (e.target.closest('#s-go')) {
      const v = (document.getElementById('s-code').value || '').trim();
      if (v) lookup(v);
      return;
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 's-q') {
      S.q = e.target.value;
      const box = document.querySelector('.auto');
      const list = S.data.distributors.filter(x => x.office_id === S.office.id)
        .filter(x => !S.q || x.name.toLowerCase().includes(S.q.toLowerCase()));
      box.innerHTML = list.length ? list.map(d => '<button data-dist="' + d.id + '">'
        + '<span style="flex:1">' + esc(d.name) + '</span>'
        + '<span class="tag t-mute">' + esc(d.status) + '</span></button>').join('')
        : '<div class="empty-d">Nobody matches that.</div>';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 's-code') {
      e.preventDefault();
      const v = (e.target.value || '').trim();
      if (v) lookup(v);
    }
    if (e.key === 'Enter' && e.target.id === 's-ph') {
      e.preventDefault();
      const v = (e.target.value || '').trim();
      if (v) send(v);
    }
  });

  /* ----------------------------------------------------------- boot */
  const params = new URLSearchParams(location.search);
  const code = (params.get('c') || params.get('code') || '').trim();
  const zone = (params.get('center') || '').trim();
  if (!window.CONFIG.ready || !A.ready) paint();
  else if (zone) lookupCenter(zone);
  else if (code) lookup(code);
  else { S.step = 'code'; paint(); }
})();

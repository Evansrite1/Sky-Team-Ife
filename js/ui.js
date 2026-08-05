/* =====================================================================
   Sky Team Ife — shared UI. Formatting, week maths, icons, charts and
   the small set of components every view is built from.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- dom */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const val = sel => { const e = $(sel); return e ? String(e.value).trim() : ''; };

  /* --------------------------------------------------------- formatting */
  const usd = n => {
    n = Number(n) || 0;
    if (!n) return '$0';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 10000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + Math.round(n).toLocaleString('en-US');
  };
  const usdFull = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const ngn = n => '₦' + (Number(n) || 0).toLocaleString('en-NG');
  const pct = n => Math.round(n) + '%';
  const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]).join('').toUpperCase() || '?';

  /* -------------------------------------------------------------- weeks */
  /* A week runs Wednesday -> Tuesday. Everything is stamped with the
     Wednesday that opens it, as a plain YYYY-MM-DD string. */
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const toDate = d => (d instanceof Date ? new Date(d.getTime()) : new Date(String(d) + 'T00:00:00'));
  const iso = d => {
    const t = d instanceof Date ? d : toDate(d);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  };
  const addDays = (d, n) => { const t = toDate(d); t.setDate(t.getDate() + n); return t; };

  const weekStart = (d) => {
    const t = d ? toDate(d) : new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - ((t.getDay() - 3 + 7) % 7));
    return iso(t);
  };
  const isoWeekNo = ws => {
    const t = toDate(ws);
    const th = addDays(t, 3 - ((t.getDay() + 6) % 7));  // Thursday of that ISO week
    const jan1 = new Date(th.getFullYear(), 0, 1);
    return 1 + Math.round(((th - jan1) / 86400000 - 3 + ((jan1.getDay() + 6) % 7)) / 7);
  };
  const dayLabel = d => { const t = toDate(d); return t.getDate() + ' ' + MON[t.getMonth()]; };
  const fullDate = d => { const t = toDate(d); return t.getDate() + ' ' + MON[t.getMonth()] + ' ' + t.getFullYear(); };
  const weekRange = ws => dayLabel(ws) + ' – ' + dayLabel(addDays(ws, 6));
  const weekName = ws => 'Week ' + isoWeekNo(ws);
  const weekLabel = ws => weekName(ws) + ' · ' + weekRange(ws);
  const weekClosed = ws => iso(addDays(ws, 6)) < iso(new Date());
  const evalDate = ws => addDays(ws, 7);
  const monthKey = ws => { const t = toDate(ws); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'); };
  const monthLabel = key => {
    const [y, m] = String(key).split('-');
    return MON_FULL[Number(m) - 1] + ' ' + y;
  };
  const recentWeeks = (n) => {
    const out = [];
    let ws = weekStart();
    for (let i = 0; i < n; i++) { out.push(ws); ws = iso(addDays(ws, -7)); }
    return out;               // newest first
  };
  const recentMonths = (n) => {
    const out = [], t = new Date();
    t.setDate(1);
    for (let i = 0; i < n; i++) {
      out.push(t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'));
      t.setMonth(t.getMonth() - 1);
    }
    return out;
  };
  const timeAgo = ts => {
    if (!ts) return '';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return fullDate(new Date(ts));
  };
  const clock = ts => {
    if (!ts) return '';
    const t = new Date(ts);
    return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  };

  /* -------------------------------------------------------------- icons */
  const IC = {
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    building: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11',
    qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2M19 15h2M15 19h2M19 19h2M15 17h6',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4',
    chart: 'M3 3v18h18M7 15v3M12 9v9M17 5v13',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    clipboard: 'M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M9 12h6M9 16h4',
    out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    right: 'M9 18l6-6-6-6', left: 'M15 18l-6-6 6-6', down: 'M6 9l6 6 6-6',
    plus: 'M12 5v14M5 12h14', x: 'M18 6 6 18M6 6l12 12', check: 'M20 6 9 17l-5-5',
    alert: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    info: 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    help: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    crown: 'M2 18h20l-2-9-5 4-3-7-3 7-5-4z',
    calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    trend: 'M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6',
    pin: 'M12 22s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12zM12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2',
    edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
    trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
    scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
    menu: 'M3 12h18M3 6h18M3 18h18',
    star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
    cash: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 10v4M18 10v4',
    card: 'M2 5h20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM1 10h22M5 15h4',
    lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 1 1 8 0v4',
    phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
    bars: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    line: 'M3 17l6-6 4 4 8-8M21 3h-4M21 3v4',
    area: 'M3 17l6-6 4 4 8-8v10z',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 7l-10 6L2 7',
    key: 'M15 7a5 5 0 1 1-4.9 6L7 16H4v-3l3.1-3.1A5 5 0 0 1 15 7z',
    copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    play: 'M6 3l14 9-14 9z',
    stop: 'M6 6h12v12H6z',
    refresh: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6'
  };
  const ico = (n, sz, sw) => {
    const d = IC[n] || IC.info;
    sz = sz || 17; sw = sw || 1.9;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">'
      + d.split(' M').map((p, i) => '<path d="' + (i ? 'M' + p : p) + '"/>').join('') + '</svg>';
  };

  /* --------------------------------------------------------- components */
  const kpi = (label, value, meta, icon, mod) =>
    '<div class="kpi ' + (mod || '') + '"><div class="kpi-l">' + (icon ? ico(icon, 13) : '') + esc(label)
    + '</div><div class="kpi-v">' + value + '</div><div class="kpi-m">' + (meta || '') + '</div></div>';

  /* The Sky Team mark. Two blocks — one capped left, one capped right —
     with a four-pointed star cut out of the seam where they meet. It is
     one path with three subpaths; the even-odd rule turns the star into
     a hole rather than a white shape, so it works on any background. */
  const LOGO_PATH = 'M110 12H34a24 24 0 0 0 0 48h76Z'
    + 'M10 60h76a24 24 0 0 1 0 48H10Z'
    + 'M60 33q2 21 17 27-15 6-17 27-2-21-17-27 15-6 17-27Z';

  const logo = (size, cls) => '<svg class="logo' + (cls ? ' ' + cls : '') + '" width="' + size
    + '" height="' + size + '" viewBox="0 0 120 120" role="img" aria-label="Sky Team">'
    + '<path fill="currentColor" fill-rule="evenodd" d="' + LOGO_PATH + '"/></svg>';

  /* The same mark for the canvas poster, drawn with Path2D. */
  const drawLogo = (g, x, y, size, colour) => {
    g.save();
    g.translate(x, y);
    g.scale(size / 120, size / 120);
    g.fillStyle = colour;
    g.fill(new Path2D(LOGO_PATH), 'evenodd');
    g.restore();
  };

  const tag = (text, kind) => '<span class="tag ' + (kind || '') + '">' + esc(text) + '</span>';

  const note = (kind, icon, html) =>
    '<div class="note n-' + kind + '">' + ico(icon, 17) + '<div>' + html + '</div></div>';

  const empty = (icon, title, desc, action) =>
    '<div class="empty"><div class="empty-ic">' + ico(icon, 24) + '</div>'
    + '<div class="empty-t">' + esc(title) + '</div>'
    + '<div class="empty-d">' + esc(desc) + '</div>' + (action || '') + '</div>';

  const bar = (v, max, accent) =>
    '<div class="bar ' + (accent ? 'gold' : '') + '"><i style="width:'
    + Math.min(100, (Number(v) / Math.max(Number(max) || 1, 1)) * 100) + '%"></i></div>';

  const change = (cur, prev) => {
    if (prev == null || !prev) return '';
    const d = ((cur - prev) / prev) * 100;
    if (!isFinite(d) || Math.abs(d) < 0.5) return '<span class="kpi-m">level with last week</span>';
    return '<span class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '↑ ' : '↓ ')
      + Math.abs(Math.round(d)) + '%</span> <span style="color:var(--faint)">vs last week</span>';
  };

  const table = (cols, rows, opts) => {
    opts = opts || {};
    if (!rows.length) return opts.empty || empty('file', 'Nothing here yet', 'Once there is data it shows up in this table.');
    return '<div class="tw"><table><thead><tr>'
      + cols.map(c => '<th class="' + (c.num ? 'num' : '') + '">' + esc(c.label) + '</th>').join('')
      + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  };

  /* ------------------------------------------------------------ charts */
  const barChart = (items, hiIdx) => {
    if (!items.length) return '<div class="empty-d" style="padding:40px 0;text-align:center">Not enough history yet.</div>';
    const W = 640, H = 208, pl = 34, pb = 26, pt = 14;
    const max = Math.max.apply(null, items.map(i => i.v).concat([1]));
    const bw = (W - pl - 10) / items.length;
    let g = '';
    for (let i = 0; i <= 3; i++) {
      const y = pt + ((H - pt - pb) / 3) * i;
      g += '<line class="gl" x1="' + pl + '" y1="' + y + '" x2="' + W + '" y2="' + y + '"/>';
    }
    const bars = items.map((it, i) => {
      const h = Math.max(2, ((it.v / max) * (H - pt - pb)));
      const x = pl + bw * i + bw * 0.2, y = H - pb - h, w = bw * 0.6;
      return '<rect class="bx ' + (i === hiIdx ? 'hi' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1)
        + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="4"/>'
        + '<text class="lb" x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(it.l) + '</text>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + g + bars + '</svg>';
  };

  const lineChart = (items, hiIdx, area) => {
    if (items.length < 2) return barChart(items, hiIdx);
    const W = 640, H = 208, pl = 34, pb = 26, pt = 14;
    const max = Math.max.apply(null, items.map(i => i.v).concat([1]));
    const step = (W - pl - 14) / (items.length - 1);
    const pts = items.map((it, i) => [pl + step * i, H - pb - (it.v / max) * (H - pt - pb)]);
    let g = '';
    for (let i = 0; i <= 3; i++) {
      const y = pt + ((H - pt - pb) / 3) * i;
      g += '<line class="gl" x1="' + pl + '" y1="' + y + '" x2="' + W + '" y2="' + y + '"/>';
    }
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const fill = area ? '<path class="ar" d="' + d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - pb)
      + ' L' + pts[0][0].toFixed(1) + ' ' + (H - pb) + ' Z"/>' : '';
    const dots = pts.map((p, i) => '<circle class="dt" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1)
      + '" r="' + (i === hiIdx ? 5 : 3.4) + '"/>').join('');
    const labels = items.map((it, i) => '<text class="lb" x="' + pts[i][0].toFixed(1) + '" y="' + (H - 8)
      + '" text-anchor="middle">' + esc(it.l) + '</text>').join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
      + g + fill + '<path class="ln" d="' + d + '"/>' + dots + labels + '</svg>';
  };

  const chartToggle = (type) => '<div class="seg">' + [['bar', 'bars', 'Bar'], ['line', 'line', 'Line'], ['area', 'area', 'Area']]
    .map(t => '<button data-act="chart-type" data-v="' + t[0] + '" class="' + (type === t[0] ? 'on' : '') + '">'
      + ico(t[1], 13) + t[2] + '</button>').join('') + '</div>';

  const chart = (items, hiIdx, type) => type === 'bar' ? barChart(items, hiIdx)
    : lineChart(items, hiIdx, type === 'area');

  /* ---------------------------------------------------------------- qr */
  const qrSvg = (text, size) => {
    try {
      const q = window.qrcode(0, 'M');
      q.addData(String(text));
      q.make();
      const n = q.getModuleCount(), cell = 100 / n;
      let rects = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (q.isDark(r, c)) {
            rects += '<rect x="' + (c * cell).toFixed(3) + '" y="' + (r * cell).toFixed(3)
              + '" width="' + cell.toFixed(3) + '" height="' + cell.toFixed(3) + '"/>';
          }
        }
      }
      return '<svg viewBox="0 0 100 100" width="' + (size || '100%') + '" shape-rendering="crispEdges">'
        + '<rect width="100" height="100" fill="#fff"/><g fill="#191a23">' + rects + '</g></svg>';
    } catch (e) {
      return '<div class="empty-d">QR code unavailable</div>';
    }
  };

  /* A printable A-series poster with the QR on it, downloaded as a PNG.
     opts: { url, title, sub, lines[], code, foot, file } */
  function downloadQrPoster(opts) {
    const W = 1080, H = 1500;
    const navy = '#0d1b3d', blue = '#2f6bff', tint = '#e9efff', grey = '#8790a5';
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const font = w => w + 'px "Space Grotesk", sans-serif';
    const rr = (x, y, w, h, r) => {
      g.beginPath();
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    };

    // paper + frame
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = navy; g.lineWidth = 6; rr(16, 16, W - 32, H - 32, 40); g.stroke();

    // header band
    g.fillStyle = navy; rr(48, 48, W - 96, 240, 28); g.fill();
    g.textBaseline = 'middle';
    drawLogo(g, 84, 96, 64, '#fff');
    g.fillStyle = '#fff';
    g.font = '600 ' + font(34); g.fillText(opts.brand || 'Sky Team Ife', 170, 124);
    g.font = '700 ' + font(52); g.fillStyle = '#fff';
    g.fillText(opts.title || '', 84, 214);

    // QR
    let qsize = 0, qn = 0, q = null;
    try {
      q = window.qrcode(0, 'M'); q.addData(String(opts.url)); q.make();
      qn = q.getModuleCount();
    } catch (e) { /* leave empty */ }
    const box = 620, bx = (W - box) / 2, by = 340;
    g.strokeStyle = navy; g.lineWidth = 5; rr(bx - 20, by - 20, box + 40, box + 40, 32); g.stroke();
    if (q) {
      qsize = box / qn;
      g.fillStyle = navy;
      for (let r = 0; r < qn; r++) for (let c = 0; c < qn; c++) {
        if (q.isDark(r, c)) g.fillRect(bx + c * qsize, by + r * qsize, Math.ceil(qsize), Math.ceil(qsize));
      }
    }

    // code chip
    let y = by + box + 74;
    if (opts.code) {
      g.font = '600 44px ui-monospace, Menlo, monospace';
      const tw = g.measureText(opts.code).width;
      g.fillStyle = tint; rr((W - tw - 88) / 2, y - 44, tw + 88, 84, 20); g.fill();
      g.strokeStyle = navy; g.lineWidth = 4; rr((W - tw - 88) / 2, y - 44, tw + 88, 84, 20); g.stroke();
      g.fillStyle = navy; g.textAlign = 'center'; g.fillText(opts.code, W / 2, y);
      g.textAlign = 'left';
      y += 96;
    }

    // details
    g.textAlign = 'center';
    if (opts.sub) { g.fillStyle = navy; g.font = '600 ' + font(40); g.fillText(opts.sub, W / 2, y); y += 58; }
    (opts.lines || []).forEach(t => {
      if (!t) return;
      g.fillStyle = grey; g.font = '500 ' + font(32); g.fillText(t, W / 2, y); y += 48;
    });

    // footer band
    g.fillStyle = blue; rr(48, H - 168, W - 96, 120, 28); g.fill();
    g.fillStyle = '#fff'; g.font = '600 ' + font(36);
    g.fillText(opts.foot || 'Scan with your phone camera to sign in', W / 2, H - 108);
    g.textAlign = 'left';

    const a = document.createElement('a');
    a.download = (opts.file || 'qr-poster') + '.png';
    a.href = cv.toDataURL('image/png');
    a.click();
  }

  /* ------------------------------------------------------- toast, modal */
  function toast(msg, kind) {
    const host = $('#toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = ico(kind === 'no' ? 'alert' : 'check', 17) + '<div>' + esc(msg) + '</div>';
    host.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = 0; el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 320);
    }, 4600);
  }

  function modal(title, sub, body, footer, wide) {
    $('#modal').innerHTML = '<div class="mo" data-act="modal-bg"><div class="mo-c ' + (wide ? 'wide' : '') + '">'
      + '<div class="mo-h"><div><div class="mo-t">' + title + '</div>'
      + (sub ? '<div class="card-s">' + sub + '</div>' : '') + '</div>'
      + '<button class="mo-x" data-act="modal-close" aria-label="Close">' + ico('x', 18) + '</button></div>'
      + '<div class="mo-b">' + body + '</div>'
      + '<div class="mo-f">' + footer + '</div></div></div>';
    const first = $('.mo-b input, .mo-b select, .mo-b textarea');
    if (first) setTimeout(() => first.focus(), 60);
  }
  const closeModal = () => { const m = $('#modal'); if (m) m.innerHTML = ''; };

  const busy = (btn, on, label) => {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner ' + (btn.classList.contains('btn-p') ? 'light' : '') + '"></span>'
        + (label || 'Working…');
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  };

  const confirmDialog = (title, body, confirmLabel, act, danger) => modal(
    esc(title), '', '<p style="font-size:14px;line-height:1.6;color:var(--muted)">' + body + '</p>',
    '<button class="btn btn-g" data-act="modal-close">Cancel</button>'
    + '<button class="btn ' + (danger ? 'btn-d' : 'btn-p') + '" data-act="' + act + '">' + esc(confirmLabel) + '</button>');

  /* ------------------------------------------------- installability */
  /* Both pages load this file, so both get the service worker and both
     know when the browser is willing to install the app. */
  (function pwa() {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* fine without it */ });
      });
    }
    /* Chrome fires this the moment the app qualifies. Holding on to the
       event is the only way to raise the real install dialog later. */
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.__installPrompt = e;
      document.body.classList.add('can-install');
    });
    window.addEventListener('appinstalled', () => {
      window.__installPrompt = null;
      document.body.classList.remove('can-install');
      try { localStorage.setItem('sti-installed', '1'); } catch (err) { /* ignore */ }
    });
    /* Running from the home screen rather than a browser tab. */
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      document.documentElement.classList.add('standalone');
    }
  })();

  /* ------------------------------------------------------------ export */
  window.UI = {
    $, $$, esc, val, usd, usdFull, ngn, pct, initials,
    iso, toDate, addDays, weekStart, weekLabel, weekName, weekRange, weekClosed,
    evalDate, monthKey, monthLabel, recentWeeks, recentMonths, dayLabel, fullDate,
    isoWeekNo, timeAgo, clock, MON, MON_FULL,
    ico, IC, logo, drawLogo, LOGO_PATH, kpi, tag, note, empty, bar, change, table,
    chart, chartToggle, barChart, lineChart, qrSvg, downloadQrPoster,
    toast, modal, closeModal, busy, confirmDialog
  };
})();

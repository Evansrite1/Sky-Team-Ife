/* =====================================================================
   Sky Team Ife — the look

   The app is dark, and everything else about how it looks is rolled
   fresh every time it is opened: the accent hue, how saturated it is,
   and how round the corners are. Open it tomorrow and it is a different
   colour. The button in the sidebar rolls again on demand.

   Three rules keep the randomness from turning into a bug:

     · Only hue, saturation and radius move. Type, spacing and layout
       are fixed, so nothing can reflow into a shape nobody has seen.
     · Every accent is corrected to the same *brightness* as the blue
       the app shipped with. Hues are not equally bright at the same
       lightness — a 66% yellow is four times the luminance of a 66%
       blue, which is how you end up with white text on a highlighter.
       So the lightness is solved per hue rather than fixed: yellow
       comes out a deep gold, blue is untouched, and white on the
       accent reads exactly the same wherever the dice land.
     · --on-accent backs that up. It is the colour of text sitting on
       an accent fill, and it flips to dark ink if a fill ever does come
       out bright. With the correction above it stays white — it is the
       guard rail, not the mechanism.

   This file is loaded in <head>, before the stylesheet, so the look is
   settled before the first paint and nothing flashes on the way in.
   ui.js and scan.js reach it through window.LOOK.
   ===================================================================== */
(function () {
  var R = document.documentElement;

  /* Corner radii. Only the numbers change — every rule that uses them is
     written against the variables, so the layout is untouched. Pills stay
     pills in all three. */
  var SHAPES = {
    round: { sm: 10, r: 14, lg: 22, xl: 32 },   /* the app as it shipped */
    soft:  { sm: 14, r: 20, lg: 30, xl: 42 },
    sharp: { sm: 4,  r: 6,  lg: 10, xl: 14 }
  };
  var SHAPE_KEYS = ['round', 'soft', 'sharp'];
  var SATS = [100, 90, 78];

  /* Rough names for the arcs of the wheel, so the toast can say what it
     landed on. Each pair is the hue the arc ends at. */
  var NAMES = [
    [15, 'Red'], [40, 'Orange'], [60, 'Amber'], [80, 'Lime'], [150, 'Green'],
    [175, 'Teal'], [195, 'Cyan'], [225, 'Blue'], [260, 'Indigo'], [290, 'Violet'],
    [320, 'Magenta'], [345, 'Pink']
  ];
  function hueName(h) {
    h = wrap(h);
    for (var i = 0; i < NAMES.length; i++) if (h < NAMES[i][0]) return NAMES[i][1];
    return 'Red';                        /* the arc that wraps past 345 */
  }

  function wrap(h) { return ((Math.round(h) % 360) + 360) % 360; }

  /* hsl(224 100% 66%) — the blue the app shipped with. Every other hue is
     pushed to this luminance so no roll is ever brighter or duller than
     the colour the design was drawn around. */
  var TARGET = 0.2497;

  function luminance(c) {
    var lin = function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  }

  /* The lightness this hue needs to hit TARGET. Luminance climbs with
     lightness, so eighteen halvings of the range land on it exactly. */
  function lightnessFor(h, s) {
    var lo = 0.10, hi = 0.97, mid = 0.66;
    for (var i = 0; i < 18; i++) {
      mid = (lo + hi) / 2;
      if (luminance(hslToRgb(h, s / 100, mid)) > TARGET) hi = mid; else lo = mid;
    }
    return Math.round(mid * 1000) / 10;
  }

  function hslToRgb(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [p[0] + m, p[1] + m, p[2] + m];
  }

  function apply(look) {
    var sh = SHAPES[look.shape] || SHAPES.round;
    var l = lightnessFor(look.hue, look.sat);
    R.style.setProperty('--hue', look.hue);
    R.style.setProperty('--sat', look.sat + '%');
    R.style.setProperty('--l', l + '%');
    R.style.setProperty('--on-accent',
      luminance(hslToRgb(look.hue, look.sat / 100, l / 100)) > 0.45 ? '#0a1024' : '#fff');
    R.style.setProperty('--r-sm', sh.sm + 'px');
    R.style.setProperty('--r', sh.r + 'px');
    R.style.setProperty('--r-lg', sh.lg + 'px');
    R.style.setProperty('--r-xl', sh.xl + 'px');
    R.setAttribute('data-shape', look.shape);
    return look;
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function read() {
    return {
      hue: wrap(parseInt(R.style.getPropertyValue('--hue'), 10) || 0),
      sat: parseInt(R.style.getPropertyValue('--sat'), 10) || 100,
      shape: R.getAttribute('data-shape') || 'round'
    };
  }

  /* A roll, with one guard: the hue lands at least forty degrees from
     where it was, so pressing the button never reads as nothing having
     happened. */
  function roll() {
    var from = read().hue;
    return apply({
      hue: wrap(from + 40 + Math.random() * 280),
      sat: pick(SATS),
      shape: pick(SHAPE_KEYS)
    });
  }

  function describe(look) {
    look = look || read();
    return hueName(look.hue) + ', ' + look.shape + ' corners';
  }

  window.LOOK = { roll: roll, read: read, apply: apply, hueName: hueName, describe: describe };

  /* Rolled on the way in, before anything is painted. */
  apply({ hue: Math.floor(Math.random() * 360), sat: pick(SATS), shape: pick(SHAPE_KEYS) });
})();

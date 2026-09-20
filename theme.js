/* Shared theme engine for the portfolio.

   Two jobs:

   1. Resolution — the device decides unless the visitor has overridden it.
      'jrr-theme' holds 'dark' | 'light' only after an explicit toggle; while it is
      absent the site follows prefers-color-scheme and keeps following it live, so a
      phone flipping to dark at sunset flips the site too.

   2. Easing — CSS custom properties do not interpolate, so flipping the palette in
      one assignment is a hard cut across the whole page: harsh at night, and the
      worst of it lands on large light surfaces. Every variable is instead tweened
      per-channel over ~460ms on an ease-in-out curve, in ONE rAF loop, so the page
      crossfades as a single gesture.

   Pages keep owning their own palettes; this file only resolves, tweens and watches.
*/
(function () {
  if (window.JRRTheme) return;

  var KEY = 'jrr-theme';
  var MS = 460;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) { return null; }
  }

  function mq() {
    return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  }

  function prefersDark() {
    var m = mq();
    return !!(m && m.matches);
  }

  // true = show dark. Explicit choice wins; otherwise the device decides, unless the page passes its own
  // fallback (the See pages pass true: dark unless the visitor has chosen otherwise).
  function resolve(fallbackDark) {
    var s = stored();
    if (s) return s === 'dark';
    return typeof fallbackDark === 'boolean' ? fallbackDark : prefersDark();
  }

  function choose(dark) {
    try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch (e) {}
  }

  // Forget the override and hand control back to the device.
  function followDevice() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    return prefersDark();
  }

  /* ---------- colour parsing ---------- */
  function parse(v) {
    if (!v) return null;
    v = String(v).trim();
    var m = v.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) {
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16),
                h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1];
      }
      if (h.length === 6 || h.length === 8) {
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
                h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      }
      return null;
    }
    m = v.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (p.length >= 3 && p.every(function (n) { return isFinite(n); })) {
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      }
    }
    return null;
  }

  function css(c) {
    var r = Math.round(c[0]), g = Math.round(c[1]), b = Math.round(c[2]);
    return c[3] >= 0.999 ? 'rgb(' + r + ',' + g + ',' + b + ')'
                         : 'rgba(' + r + ',' + g + ',' + b + ',' + c[3].toFixed(3) + ')';
  }

  var raf = null;

  /* Apply a palette. animate=false sets it instantly — correct on first paint, where
     there is nothing to ease from and any tween would just be a visible flash. */
  function apply(themes, dark, animate) {
    var target = themes[dark ? 'dark' : 'light'];
    if (!target) return;
    var root = document.documentElement;
    var keys = Object.keys(target);

    function commit() {
      keys.forEach(function (k) { root.style.setProperty(k, target[k]); });
      if (document.body) document.body.style.background = target['--bg'] || '';
      root.style.colorScheme = dark ? 'dark' : 'light';
    }

    if (raf) { cancelAnimationFrame(raf); raf = null; }

    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!animate || reduce || !window.requestAnimationFrame) { commit(); return; }

    // Snapshot where each variable is right now — mid-tween values included, so a
    // toggle pressed twice in quick succession turns around smoothly.
    var cs = getComputedStyle(root);
    var legs = [];
    keys.forEach(function (k) {
      var from = parse(cs.getPropertyValue(k)), to = parse(target[k]);
      if (from && to) legs.push({ k: k, from: from, to: to });
      else root.style.setProperty(k, target[k]);   // non-colour or unreadable: set it
    });
    if (!legs.length) { commit(); return; }

    root.style.colorScheme = dark ? 'dark' : 'light';

    var t0 = 0;
    raf = requestAnimationFrame(function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / MS);
      var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // easeInOutCubic
      for (var i = 0; i < legs.length; i++) {
        var l = legs[i];
        root.style.setProperty(l.k, css([
          l.from[0] + (l.to[0] - l.from[0]) * e,
          l.from[1] + (l.to[1] - l.from[1]) * e,
          l.from[2] + (l.to[2] - l.from[2]) * e,
          l.from[3] + (l.to[3] - l.from[3]) * e
        ]));
      }
      if (document.body) document.body.style.background = cs.getPropertyValue('--bg') ? root.style.getPropertyValue('--bg') : '';
      if (p < 1) { raf = requestAnimationFrame(step); } else { raf = null; commit(); }
    });
  }

  /* Call cb(dark) when the DEVICE preference changes and no override is in force. */
  function watch(cb) {
    var m = mq();
    if (!m) return function () {};
    function onChange(e) { if (!stored()) cb(!!e.matches); }
    if (m.addEventListener) { m.addEventListener('change', onChange); return function () { m.removeEventListener('change', onChange); }; }
    if (m.addListener) { m.addListener(onChange); return function () { m.removeListener(onChange); }; }
    return function () {};
  }

  window.JRRTheme = {
    resolve: resolve, prefersDark: prefersDark, stored: stored,
    choose: choose, followDevice: followDevice, apply: apply, watch: watch, KEY: KEY
  };
})();

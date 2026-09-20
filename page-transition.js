/* Shared page transition for the dual portfolio.

   Choreography — deliberately asymmetric, because the two halves have different jobs:

     outgoing (the part you watch)
       curtain rises from below in the DESTINATION's colours, its title fading in
       as it climbs, comes to rest, holds a beat, then the title fades out so that
       at the moment of navigation the curtain is a FLAT FIELD OF COLOUR.

     incoming (the part that must be invisible)
       an identical flat field is mounted before the new document's first paint and
       immediately continues upward, off the top.

   Why flat at the handover: the old build rendered the same title on both sides and
   trusted them to match. Any difference — a font still swapping, a clamp() rounding,
   a scrollbar — surfaced as a visible cut at the exact frame you were looking at.
   With no type on screen at the swap, the two sides are the same solid rectangle and
   the cut cannot be seen at all.

   Why no cross-document view transition: it holds the outgoing snapshot until the new
   document renders, so a slow fetch froze the page mid-gesture — the "hang" before the
   jump. Destinations are prefetched on hover instead, and the curtain simply keeps
   moving; the document swap happens underneath it.
*/
(function () {
  // The DC runtime rebuilds <head>, so this file is loaded from each page's <helmet>.
  // Both entry points can end up present; install exactly once.
  if (window.__jrrTransitInstalled) return;
  window.__jrrTransitInstalled = true;

  var KEY = 'jrr-transit';
  var STALE_MS = 6000;   // a handoff older than this belongs to a dead navigation
  var MONO = "'IBM Plex Mono',ui-monospace,monospace";
  var WORK_FACE = "'Schibsted Grotesk',system-ui,sans-serif";
  var SEE_FACE = "'EB Garamond',Georgia,serif";

  var RISE_MS = 420;    // curtain climbs into place
  var HOLD_MS = 150;    // beat at rest, title legible
  var TYPE_MS = 170;    // title clears before the swap
  var EXIT_MS = 480;    // curtain continues up on the new page
  var RISE_EASE = 'cubic-bezier(.22,1,.36,1)';
  var EXIT_EASE = 'cubic-bezier(.64,0,.78,0)';

  /* The curtain always wears the DESTINATION's palette, so it uncovers a page it
     already matches. The document side (Work / Case studies / resume) is theme-aware,
     resolved from the same 'jrr-theme' key those pages read. */
  var DOC_LIGHT = { bg: '#FAF9F7', ink: '#14151A', accent: '#2F4B8C' };
  var DOC_DARK  = { bg: '#0F1114', ink: '#F1F0EC', accent: '#8FA8E0' };
  // See side: dark unless the visitor has chosen light
  var SEE_LIGHT = { bg: '#F3F1EC', ink: '#14151A', accent: '#7A5C1E' };
  var SEE_DARK  = { bg: '#0C0D10', ink: '#F2F0EC', accent: '#C9B892' };

  var TRANSIT = {
    'index.html': { label: 'Two worlds', kicker: 'One person \u00b7 two worlds', bg: '#0E0F12', ink: '#F2F0EC', accent: '#8FA8E0', style: 'normal' },
    'how-i-work.html': { label: 'How I Work', kicker: 'Projects, data, systems', doc: true, style: 'normal' },
    'case-studies.html': { label: 'Case studies', kicker: 'Three problems, worked end to end', doc: true, style: 'normal' },
    'case-study.html': { label: 'Case study', kicker: 'Context, model, outcome', doc: true, style: 'normal' },
    'resume.html': { label: 'Resume', kicker: 'The full record', doc: true, style: 'normal' },
    'how-i-see.html': { label: 'How I See', kicker: 'Photography, design, writing', see: true, style: 'italic' },
    'writing.html': { label: 'Writing', kicker: 'Essays and reflections', see: true, style: 'italic' }
  };

  function resolve(t) {
    var out = { label: t.label, kicker: t.kicker, style: t.style || 'normal', bg: t.bg, ink: t.ink, accent: t.accent };
    if (t.doc) {
      // Same resolution the pages use: explicit choice, else the device.
      var dark = false;
      try {
        dark = window.JRRTheme ? window.JRRTheme.resolve()
             : (localStorage.getItem('jrr-theme') === 'dark'
                || (!localStorage.getItem('jrr-theme') && window.matchMedia
                    && window.matchMedia('(prefers-color-scheme: dark)').matches));
      } catch (e) {}
      var p = dark ? DOC_DARK : DOC_LIGHT;
      out.bg = p.bg; out.ink = p.ink; out.accent = p.accent;
    }
    if (t.see) {
      var seeDark = true;
      try { seeDark = localStorage.getItem('jrr-theme') !== 'light'; } catch (e) {}
      var q = seeDark ? SEE_DARK : SEE_LIGHT;
      out.bg = q.bg; out.ink = q.ink; out.accent = q.accent;
    }
    return out;
  }

  function reduce() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function fileOf(href) {
    var path = href.split('#')[0].split('?')[0];
    try { return decodeURIComponent(path.split('/').pop() || ''); } catch (e) { return path.split('/').pop() || ''; }
  }

  // Must be able to mount before <body> exists: the incoming curtain has to be part
  // of the very first paint, or the new page flashes uncovered.
  function mount(el) { (document.body || document.documentElement).appendChild(el); }

  /* ---------- easing shared by WAAPI and the rAF fallback ---------- */
  var BEZ = {};
  function bezier(name, x1, y1, x2, y2) {
    if (BEZ[name]) return BEZ[name];
    var N = 48, xs = new Float64Array(N + 1), i;
    function cx(t) { var u = 1 - t; return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t; }
    function cy(t) { var u = 1 - t; return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t; }
    for (i = 0; i <= N; i++) xs[i] = cx(i / N);
    BEZ[name] = function (p) {
      if (p <= 0) return 0;
      if (p >= 1) return 1;
      var lo = 0, hi = N, mid;
      while (hi - lo > 1) { mid = (lo + hi) >> 1; if (xs[mid] < p) lo = mid; else hi = mid; }
      var span = xs[hi] - xs[lo] || 1e-6;
      return cy((lo + (p - xs[lo]) / span) / N);
    };
    return BEZ[name];
  }
  var riseCurve = bezier('rise', .22, 1, .36, 1);
  var exitCurve = bezier('exit', .64, 0, .78, 0);

  /* One composited transform, WAAPI-driven where available (immune to main-thread
     hiccups), rAF-tweened on the identical curve where it is not. done() fires once. */
  function slide(el, fromPct, toPct, ms, cssEase, curve, done) {
    var fired = false;
    function finish() { if (fired) return; fired = true; el.style.transform = 'translate3d(0,' + toPct + '%,0)'; if (done) done(); }
    el.style.transform = 'translate3d(0,' + fromPct + '%,0)';
    if (el.animate) {
      var a = null;
      try {
        a = el.animate(
          [{ transform: 'translate3d(0,' + fromPct + '%,0)' }, { transform: 'translate3d(0,' + toPct + '%,0)' }],
          { duration: ms, easing: cssEase, fill: 'both' }
        );
      } catch (e) { a = null; }
      if (a) {
        if (a.finished && a.finished.then) a.finished.then(finish, finish); else a.onfinish = finish;
        setTimeout(finish, ms + 140);
        return;
      }
    }
    var t0 = 0, raf = window.requestAnimationFrame;
    if (!raf) { setTimeout(finish, ms); return; }
    raf(function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / ms);
      el.style.transform = 'translate3d(0,' + (fromPct + (toPct - fromPct) * curve(p)) + '%,0)';
      if (p < 1) raf(step); else finish();
    });
    setTimeout(finish, ms + 220);
  }

  function fadeTo(el, from, to, ms, done) {
    el.style.opacity = from;
    if (el.animate) {
      var a = null;
      try { a = el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: 'linear', fill: 'both' }); } catch (e) { a = null; }
      if (a) { el.style.opacity = to; if (done) setTimeout(done, ms); return; }
    }
    el.style.transition = 'opacity ' + ms + 'ms linear';
    void el.offsetHeight;
    el.style.opacity = to;
    if (done) setTimeout(done, ms);
  }

  /* ---------- the curtain ---------- */
  function build(t, withType) {
    var el = document.createElement('div');
    el.setAttribute('data-noprint', '');
    el.setAttribute('data-jrr-curtain', '');
    el.style.cssText = 'position:fixed; inset:0; z-index:9000; display:flex; align-items:center;' +
      ' justify-content:center; padding:24px; box-sizing:border-box; text-align:center;' +
      ' background:' + t.bg + '; contain:layout paint; will-change:transform;' +
      ' transform:translate3d(0,100%,0); backface-visibility:hidden;';
    if (!withType) return { el: el, type: null };

    var type = document.createElement('div');
    type.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:clamp(12px,2.4vw,18px); opacity:0;';

    var kicker = document.createElement('div');
    kicker.style.cssText = 'flex:none; max-width:32ch; font-family:' + MONO +
      '; font-size:11px; letter-spacing:0.2em; text-transform:uppercase; line-height:1.6; color:' + t.accent + ';';
    kicker.textContent = t.kicker || '';

    var label = document.createElement('div');
    var seeVoice = t.style === 'italic';
    label.style.cssText = 'flex:none; max-width:20ch; text-wrap:balance; font-family:' + (seeVoice ? SEE_FACE : WORK_FACE) +
      '; font-weight:' + (seeVoice ? 400 : 700) + '; letter-spacing:' + (seeVoice ? '-0.01em' : '-0.02em') +
      '; font-size:' + (seeVoice ? 'clamp(30px,8.5vw,84px)' : 'clamp(27px,7.7vw,76px)') + '; line-height:1.1; color:' +
      (t.ink || '#F2F0EC') + '; font-style:' + (t.style || 'normal') + ';';
    label.textContent = t.label || '';

    var rule = document.createElement('div');
    rule.style.cssText = 'flex:none; width:min(220px,48vw); height:1px; background:' + t.accent + ';';

    type.appendChild(kicker); type.appendChild(label); type.appendChild(rule);
    el.appendChild(type);
    return { el: el, type: type };
  }

  /* ---------- incoming: flat field, straight out ---------- */
  function incoming() {
    var raw = null;
    try { raw = sessionStorage.getItem(KEY); if (raw) sessionStorage.removeItem(KEY); } catch (e) {}
    if (!raw) return;
    var t; try { t = JSON.parse(raw); } catch (e) { return; }
    if (!t || !t.bg) return;
    // Ignore a leftover key from a navigation that never completed, or the first
    // load would play an exit curtain nobody asked for.
    if (!t.at || Date.now() - t.at > STALE_MS) return;

    var root = document.documentElement;
    root.style.background = t.bg;

    var c = build(t, false);
    c.el.style.transform = 'translate3d(0,0,0)';   // exactly where the rise ended
    mount(c.el);
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () {
        if (c.el.parentNode !== document.body) document.body.appendChild(c.el);
      }, { once: true });
    }

    var gone = false;
    function clear() {
      if (gone) return;
      gone = true;
      if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
      root.style.background = '';
    }

    var started = false;
    function exit() {
      if (started || gone) return;
      started = true;
      if (reduce()) { clear(); return; }
      slide(c.el, 0, -100, EXIT_MS, EXIT_EASE, exitCurve, clear);
    }

    /* No type on screen means nothing to wait for: leave as soon as there is a page
       under the curtain, and never linger — a static curtain is what read as a hang.
       Fonts are deliberately NOT gated on; the destination's own type is below. */
    var start = Date.now(), MIN = 60, MAX = 420;
    var poll = setInterval(function () {
      var age = Date.now() - start;
      var dc = document.getElementById('dc-root') || document.querySelector('x-dc');
      var painted = !!dc && dc.getBoundingClientRect().height > 120;
      if (age >= MAX || (age >= MIN && painted)) { clearInterval(poll); exit(); }
    }, 24);
  }

  /* ---------- prefetch: the destination is warm before the gesture ends ---------- */
  var prefetched = {};
  function prefetch(href) {
    var f = fileOf(href);
    if (!f || prefetched[f] || !TRANSIT[f]) return;
    prefetched[f] = true;
    var l = document.createElement('link');
    l.rel = 'prefetch';
    l.href = href;
    (document.head || document.documentElement).appendChild(l);
  }
  function onHover(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a) prefetch(a.getAttribute('href') || '');
  }

  /* ---------- outgoing ---------- */
  var leaving = false;

  function onClick(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank') return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:|https?:|\/\/)/i.test(href)) return;
    var raw = TRANSIT[fileOf(href)];
    if (!raw) return;

    e.preventDefault();
    if (leaving) return;
    leaving = true;

    var t = resolve(raw);
    t.at = Date.now();
    try { sessionStorage.setItem(KEY, JSON.stringify(t)); } catch (err) {}
    if (reduce()) { window.location.href = href; return; }

    prefetch(href);
    document.documentElement.style.background = t.bg;

    var c = build(t, true);
    mount(c.el);

    var went = false;
    function go() { if (went) return; went = true; window.location.href = href; }

    slide(c.el, 100, 0, RISE_MS, RISE_EASE, riseCurve, function () {
      // rest → beat → clear the type → hand over as a flat field
      setTimeout(function () { fadeTo(c.type, 1, 0, TYPE_MS, go); }, HOLD_MS);
    });
    if (c.type) fadeTo(c.type, 0, 1, 240);
    setTimeout(go, RISE_MS + HOLD_MS + TYPE_MS + 260);   // safety net
  }

  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    leaving = false;
    var stale = document.querySelectorAll('[data-jrr-curtain]');
    for (var i = 0; i < stale.length; i++) {
      if (stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
    }
    document.documentElement.style.background = '';
  });

  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerenter', onHover, true);
  document.addEventListener('pointerdown', onHover, true);
  incoming();
})();

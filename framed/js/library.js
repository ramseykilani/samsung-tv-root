/*
 * framed — IMAGE LIBRARY SOURCE. The single seam for "where do the pictures come from".
 *
 *   F.library.list()   -> [{ id, src, title, meta }]   (ordered, stable ids)
 *   F.library.get(id)  -> item | null
 *   F.library.source() -> 'bundled' | 'remote'          (which source list() currently reflects)
 *   F.library.rejected() -> count of remote pictures left out for not being 16:9
 *   F.library.set(items, source) replaces the list at runtime and fires 'framed:library'
 *
 * Only 16:9 pictures pass: anything more than 1% off the screen's shape is left out
 * (the art screen refuses to crop or mat, so a wrong-shape picture would break the
 * illusion). The manifest's width/height decides when present; otherwise the image
 * is loaded and measured. Unmeasurable files count as left out.
 *
 * Manifest (index.json), generated server-side whenever the folder changes:
 *   { "images": [ { "file": "name.png", "title": "Optional title",
 *                  "width": 1208, "height": 680 } ] }
 * ('orientation' from older generators is ignored; width/height are optional.)
 *
 * Two sources, graceful fallback:
 *   1. remote  — a static LAN HTTP folder on the user's desktop. We GET <REMOTE_ART_BASE>index.json
 *                (manifest format below) and load the images from the same base URL.
 *   2. bundled — the files under assets/art/. Used at boot, and kept when REMOTE_ART_BASE is empty
 *                or the manifest fails/times out/is malformed. No error UI: the TV simply shows the
 *                bundled set and logs one console.info line.
 *
 * Nothing else in the app knows about assets/art/ or the remote base — to change the source
 * again later (USB mount via tizen.filesystem, a TV photo API…), replace THIS FILE only and keep
 * the item shape + the four functions above.
 */
window.framed = window.framed || {};
(function (F) {
  /* ======== CONFIG — edit here ======== */
  var REMOTE_ART_BASE = '';          // e.g. 'http://<desktop-ip>:8080/art/'  ('' = remote disabled)
  var REMOTE_TIMEOUT_MS = 4000;      // manifest fetch budget before falling back to bundled
  /* =================================== */

  // Sample works (generated stand-ins until the owner's own pictures are added here or served remotely).
  var BUNDLED = [
    { id: 'marsh', src: 'assets/art/marsh.jpg', title: 'Marsh at dusk', meta: 'Sample', width: 1264, height: 711 }
  ];

  var ITEMS = BUNDLED.slice();
  var SOURCE = 'bundled';
  var REJECTED = 0;
  var loading = false;
  var dimensions = Object.create(null);
  var SHAPE = 16 / 9;
  var SHAPE_TOLERANCE = 0.01;   // fraction of 16:9 the ratio may be off by (~7 px at 1208 px wide)

  function set(items, source) {
    ITEMS = (items || []).slice();
    SOURCE = source || 'custom';
    window.dispatchEvent(new CustomEvent('framed:library'));
  }

  // Candidates carry an optional width/height (the manifest's, or bundled facts). Candidates without
  // one are measured by loading the image; failures count as left out. cb(ok, bad).
  function screenShape(candidates, cb) {
    var accepted = [], bad = 0, next = 0, pending = 0;
    function measure(it, size, index) {
      var ratio = size.width / size.height;
      if (Math.abs(ratio - SHAPE) / SHAPE <= SHAPE_TOLERANCE) accepted[index] = it;
      else bad++;
    }
    function pump() {
      while (next < candidates.length && pending < 2) {
        var index = next++, it = candidates[index];
        var size = it.width > 0 && it.height > 0 ? it : dimensions[it.src];
        if (size) { measure(it, size, index); continue; }
        probe(it, index);
      }
      if (next === candidates.length && !pending) cb(accepted.filter(Boolean), bad);
    }
    function probe(it, index) {
      pending++;
      var img = new Image(), settled = false;
      var timer = setTimeout(function () { finish(false); }, REMOTE_TIMEOUT_MS);
      function finish(ok) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.onload = img.onerror = null;
        if (ok && img.naturalWidth && img.naturalHeight) {
          var size = { width: img.naturalWidth, height: img.naturalHeight };
          dimensions[it.src] = size;
          measure(it, size, index);
        } else bad++; // transient failures are retried on the next refresh
        pending--;
        pump();
      }
      img.onload = function () { finish(true); };
      img.onerror = function () { finish(false); };
      img.src = it.src;
    }
    pump(); // bounded decoding; results retain manifest order, regardless of load order
  }

  function normalizeBase(base) {
    base = String(base || '').trim();
    if (!base) return '';
    return base.charAt(base.length - 1) === '/' ? base : base + '/';
  }

  // manifest -> items; returns null when the manifest is unusable
  function fromManifest(base, json) {
    var images = json && json.images;
    if (!images || !images.length) return null;
    var out = [];
    for (var i = 0; i < images.length; i++) {
      var im = images[i];
      if (!im || !im.file) continue;
      var w = parseInt(im.width, 10), h = parseInt(im.height, 10);
      var item = {
        id: 'remote:' + im.file,
        src: base + encodeURI(im.file) + (im.version != null ? '?v=' + encodeURIComponent(im.version) : ''),
        title: im.title || im.file.replace(/\.[^.]+$/, ''),
        meta: im.orientation ? im.orientation : 'remote'
      };
      if (w > 0 && h > 0) { item.width = w; item.height = h; }
      out.push(item);
    }
    return out.length ? out : null;
  }

  function loadRemote(base) {
    base = normalizeBase(base);
    if (!base || loading) return;
    loading = true;
    var done = false;
    function fallback(why) {
      if (done) return; done = true;
      loading = false;
      console.info('[framed] remote art library unavailable (' + why + ') — using bundled assets/art/');
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', base + 'index.json?t=' + Date.now(), true);   // cache-bust: the desktop regenerates it
      xhr.timeout = REMOTE_TIMEOUT_MS;
      xhr.onload = function () {
        if (done) return;
        if (xhr.status < 200 || xhr.status >= 300) return fallback('HTTP ' + xhr.status);
        var items = null;
        try { items = fromManifest(base, JSON.parse(xhr.responseText)); } catch (e) { /* malformed */ }
        if (!items) return fallback('bad manifest');
        done = true;
        screenShape(items, function (ok, bad) {
          loading = false;
          var retained = Object.create(null);
          items.forEach(function (it) { if (dimensions[it.src]) retained[it.src] = dimensions[it.src]; });
          dimensions = retained;
          // only notify listeners when the manifest actually changed — the art screen
          // polls this every minute and a no-change event would rebuild its controls
          var same = REJECTED === bad && ITEMS.length === ok.length && ITEMS.every(function (it, i) {
            return it.id === ok[i].id && it.src === ok[i].src && it.title === ok[i].title && it.meta === ok[i].meta;
          });
          if (same) return;
          REJECTED = bad;
          if (bad) console.info('[framed] left out ' + bad + ' remote ' + (bad === 1 ? 'picture' : 'pictures') + ' (not 16:9)');
          set(ok, 'remote');
        });
      };
      xhr.onerror = function () { fallback('network error'); };
      xhr.ontimeout = function () { fallback('timeout after ' + REMOTE_TIMEOUT_MS + ' ms'); };
      xhr.send();
    } catch (e) { fallback(e && e.message || 'exception'); }
  }

  F.library = {
    list: function () { return ITEMS.slice(); },
    get: function (id) {
      for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i];
      return null;
    },
    set: set,
    source: function () { return SOURCE; },
    rejected: function () { return REJECTED; },
    remoteBase: function () { return normalizeBase(REMOTE_ART_BASE); },
    reload: function () { loadRemote(REMOTE_ART_BASE); }
  };

  loadRemote(REMOTE_ART_BASE);
})(window.framed);

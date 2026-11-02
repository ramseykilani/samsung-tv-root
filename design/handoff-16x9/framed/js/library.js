/*
 * framed — IMAGE LIBRARY SOURCE. The single seam for "where do the pictures come from".
 *
 *   F.library.list()   -> [{ id, src, title, meta }]   (ordered, stable ids)
 *   F.library.get(id)  -> item | null
 *   F.library.source() -> 'bundled' | 'remote'          (which source list() currently reflects)
 *   F.library.rejected() -> items left out because they aren't 16:9
 *   F.library.set(items, source) replaces the list at runtime and fires 'framed:library'
 *
 * Only pictures the screen's shape are hung: 16:9 (within 1%, e.g. 3840 x 2160, 1920 x 1080), so the
 * frame never has to crop or pad one. set() measures each item (the manifest's width/height when given,
 * otherwise the image's own size) and leaves the rest out; Settings → About says how many.
 *
 * Two sources, graceful fallback:
 *   1. remote  — a static LAN HTTP folder on the user's desktop. We GET <REMOTE_ART_BASE>index.json
 *                (manifest format below) and load the images from the same base URL.
 *   2. bundled — the files under assets/art/. Used at boot, and kept when REMOTE_ART_BASE is empty
 *                or the manifest fails/times out/is malformed. No error UI: the TV simply shows the
 *                bundled set and logs one console.info line.
 *
 * Manifest (index.json), generated server-side whenever the folder changes:
 *   { "images": [ { "file": "name.png", "title": "Optional title", "width": 3840, "height": 2160 } ] }
 * width/height are optional but save the TV loading every picture to measure it.
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

  // Sample work (a stand-in until the owner's own pictures are added here or served remotely).
  var BUNDLED = [
    { id: 'marsh', src: 'assets/art/marsh.jpg', title: 'Marsh at dusk', meta: 'Sample', width: 1264, height: 711 }
  ];
  var SHAPE = 16 / 9, SHAPE_TOLERANCE = 0.01;   // as tools/slim_frames.py

  var ITEMS = BUNDLED.slice();
  var REJECTED = [];
  var SOURCE = 'bundled';

  function fits(w, h) { return w > 0 && h > 0 && Math.abs(w / h / SHAPE - 1) <= SHAPE_TOLERANCE; }

  // measure every item, then cb(the ones the screen's shape, the rest); an image that fails to load is left out
  function screenShape(items, cb) {
    var sizes = [], pending = items.length;
    if (!pending) { cb([], []); return; }
    items.forEach(function (it, i) {
      if (it.width > 0 && it.height > 0) { done(i, it.width, it.height); return; }
      var img = new Image();
      img.onload = function () { done(i, img.naturalWidth, img.naturalHeight); };
      img.onerror = function () { done(i, 0, 0); };
      img.src = it.src;
    });
    function done(i, w, h) {
      sizes[i] = [w, h];
      if (--pending) return;
      var ok = [], bad = [];
      items.forEach(function (it, j) { (fits(sizes[j][0], sizes[j][1]) ? ok : bad).push(it); });
      cb(ok, bad);
    }
  }

  function set(items, source) {
    screenShape((items || []).slice(), function (ok, bad) {
      ITEMS = ok;
      REJECTED = bad;
      SOURCE = source || 'custom';
      if (bad.length) console.info('[framed] left out, not 16:9: ' + bad.map(function (b) { return b.title; }).join(', '));
      window.dispatchEvent(new CustomEvent('framed:library'));
    });
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
      out.push({
        id: 'remote:' + im.file,
        src: base + encodeURI(im.file),
        title: im.title || im.file.replace(/\.[^.]+$/, ''),
        meta: 'remote',
        width: Number(im.width) || 0,
        height: Number(im.height) || 0
      });
    }
    return out.length ? out : null;
  }

  function loadRemote(base) {
    base = normalizeBase(base);
    if (!base) return;
    var done = false;
    function fallback(why) {
      if (done) return; done = true;
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
        set(items, 'remote');
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
    rejected: function () { return REJECTED.slice(); },
    remoteBase: function () { return normalizeBase(REMOTE_ART_BASE); },
    reload: function () { loadRemote(REMOTE_ART_BASE); }
  };

  loadRemote(REMOTE_ART_BASE);
})(window.framed);

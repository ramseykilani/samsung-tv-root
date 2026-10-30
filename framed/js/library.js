/*
 * framed — IMAGE LIBRARY SOURCE. The single seam for "where do the pictures come from".
 *
 *   F.library.list()   -> [{ id, src, title, meta }]   (ordered, stable ids)
 *   F.library.get(id)  -> item | null
 *   F.library.source() -> 'bundled' | 'remote'          (which source list() currently reflects)
 *   F.library.set(items, source) replaces the list at runtime and fires 'framed:library'
 *
 * Two sources, graceful fallback:
 *   1. remote  — a static LAN HTTP folder on the user's desktop. We GET <REMOTE_ART_BASE>index.json
 *                (manifest format below) and load the images from the same base URL.
 *   2. bundled — the files under assets/art/. Used at boot, and kept when REMOTE_ART_BASE is empty
 *                or the manifest fails/times out/is malformed. No error UI: the TV simply shows the
 *                bundled set and logs one console.info line.
 *
 * Manifest (index.json), generated server-side whenever the folder changes:
 *   { "images": [ { "file": "name.png", "title": "Optional title", "orientation": "landscape|portrait" } ] }
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
    { id: 'marsh',      src: 'assets/art/landscape.jpg', title: 'Marsh at dusk',              meta: 'Sample' },
    { id: 'still-life', src: 'assets/art/portrait.jpg',  title: 'Still life with pewter jug', meta: 'Sample' }
  ];

  var ITEMS = BUNDLED.slice();
  var SOURCE = 'bundled';

  function set(items, source) {
    ITEMS = (items || []).slice();
    SOURCE = source || 'custom';
    window.dispatchEvent(new CustomEvent('framed:library'));
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
        meta: im.orientation ? im.orientation : 'remote'
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
    remoteBase: function () { return normalizeBase(REMOTE_ART_BASE); },
    reload: function () { loadRemote(REMOTE_ART_BASE); }
  };

  loadRemote(REMOTE_ART_BASE);
})(window.framed);

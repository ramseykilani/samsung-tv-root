/*
 * framed — MEDIA SOURCE SEAM. "Our own Stremio": catalogs, metadata and streams fetched
 * from Stremio-protocol addons over HTTP, same conventions as js/library.js.
 *
 * Addon protocol (https://github.com/Stremio/stremio-addon-sdk):
 *   GET <base>/manifest.json                 -> { resources: [...], types: [...], catalogs: [...] }
 *   GET <base>/catalog/<type>/<id>.json      -> { metas: [{ id, type, name, poster, ... }] }
 *   GET <base>/meta/<type>/<id>.json         -> { meta: { name, poster, description, year, ... } }
 *   GET <base>/stream/<type>/<id>.json       -> { streams: [{ name, title, url|infoHash|externalUrl }] }
 *
 * API used by the screens:
 *   F.media.catalogs(cb)  -> cb([{ addon, type, id, label }])   aggregated across addons
 *   F.media.catalog(cat, cb)  -> cb(items | null)   metas for one catalog
 *   F.media.meta(cat, id, cb) -> cb(meta | null)    full metadata for one item
 *   F.media.streams(type, id, cb) -> cb(streams[])  normalized, every stream-capable addon
 *   F.media.open(cat, item) / F.media.item()        browse -> detail handoff
 *   F.media.start(stream)  / F.media.playing()      detail -> player handoff
 *   F.media.picked() / F.media.pick(i)              persisted catalog selection ("framed.media")
 *
 * Streams are normalized to { name, label, sub, url, playable }. Anything that is not a
 * direct http(s) URL (infoHash remote-source, ytId, externalUrl) comes back playable:false —
 * Tizen's <video> cannot resolve them and the detail screen offers a quiet refusal.
 *
 * Offline/degraded: every fetch has a timeout and fails the same way as library.js —
 * one console.info line, callback gets null/[], no error UI, the rest of the app keeps working.
 */
window.framed = window.framed || {};
(function (F) {
  /* ======== CONFIG — edit here ========
   * Each entry is a Stremio addon base URL (the thing that ends before /manifest.json).
   * Order = the order catalogs and stream results appear in. Public defaults:
   *   Cinemeta — official movie/series catalogs + metadata.
   *   StreamFeed — stream results; note its sources are remote-source (unplayable on TV, kept for parity).
   *   Local demo — bundled offline catalog under addons/demo/ so the section works with no network.
   */
  var MEDIA_ADDONS = [
    { name: 'Cinemeta', base: 'https://v3-cinemeta.strem.io' },
    { name: 'StreamFeed', base: 'https://streams.example.com' },
    { name: 'Local demo', base: 'addons/demo' }
  ];
  var MEDIA_TIMEOUT_MS = 6000;      // per-request budget before an addon counts as unreachable
  var MEDIA_MAX_STREAMS = 40;       // stream rows offered per item
  /* ================================== */

  var manifests = {};               // base -> manifest object | false (failed) | undefined (not asked)
  var current = null;               // { cat, item } handed from browse to detail
  var currentStream = null;         // stream handed from detail to player

  function note(msg) { console.info('[framed] media: ' + msg); }

  function addonUrl(base, path) {
    return base.replace(/\/+$/, '') + '/' + path;
  }

  // GET JSON with timeout; cb(json) or cb(null) on any failure (one console.info, no UI).
  function getJSON(url, cb) {
    var done = false;
    function fail(why) { if (!done) { done = true; note('unreachable ' + url + ' (' + why + ')'); cb(null); } }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = MEDIA_TIMEOUT_MS;
      xhr.onload = function () {
        if (done) return;
        if (xhr.status < 200 || xhr.status >= 300) return fail('HTTP ' + xhr.status);
        var json = null;
        try { json = JSON.parse(xhr.responseText); } catch (e) { /* malformed */ }
        if (json == null) return fail('bad JSON');
        done = true;
        cb(json);
      };
      xhr.onerror = function () { fail('network error'); };
      xhr.ontimeout = function () { fail('timeout after ' + MEDIA_TIMEOUT_MS + ' ms'); };
      xhr.send();
    } catch (e) { fail(e && e.message || 'exception'); }
  }

  function loadManifest(addon, cb) {
    var cached = manifests[addon.base];
    if (cached !== undefined) return cb(cached || null);
    getJSON(addonUrl(addon.base, 'manifest.json'), function (m) {
      manifests[addon.base] = m && m.id ? m : false;
      cb(manifests[addon.base] || null);
    });
  }

  function hasResource(manifest, res) {
    var r = manifest && manifest.resources;
    if (!r) return false;
    for (var i = 0; i < r.length; i++) {
      if (r[i] === res) return true;
      if (r[i] && r[i].name === res) return true; // object-form resources
    }
    return false;
  }

  // Flatten per-addon-index buckets back into MEDIA_ADDONS order.
  function flatten(per) {
    var out = [];
    for (var i = 0; i < MEDIA_ADDONS.length; i++) {
      if (per[i]) for (var j = 0; j < per[i].length; j++) out.push(per[i][j]);
    }
    return out;
  }

  // Aggregate catalogs across addons that declare the 'catalog' resource.
  function catalogs(cb) {
    var per = {};
    var pending = MEDIA_ADDONS.length;
    if (!pending) return cb([]);
    MEDIA_ADDONS.forEach(function (addon, ai) {
      loadManifest(addon, function (m) {
        if (m && hasResource(m, 'catalog') && m.catalogs && m.catalogs.length) {
          per[ai] = [];
          m.catalogs.forEach(function (c) {
            if (!c || !c.type || !c.id) return;
            per[ai].push({ addon: addon, type: c.type, id: c.id, label: (c.name || c.id) + ' · ' + c.type });
          });
        }
        if (--pending === 0) cb(flatten(per));
      });
    });
  }

  // One catalog's metas -> normalized items.
  function catalog(cat, cb) {
    if (!cat) return cb(null);
    var path = 'catalog/' + encodeURIComponent(cat.type) + '/' + encodeURIComponent(cat.id) + '.json';
    getJSON(addonUrl(cat.addon.base, path), function (json) {
      var metas = json && json.metas;
      if (!metas || !metas.length) return cb(null);
      var out = [];
      for (var i = 0; i < metas.length; i++) {
        var m = metas[i];
        if (!m || !m.id || !m.name) continue;
        out.push({
          id: m.id,
          type: m.type || cat.type,
          name: m.name,
          poster: m.poster || null,
          year: m.releaseInfo || m.year || '',
          description: m.description || '',
          raw: m
        });
      }
      cb(out.length ? out : null);
    });
  }

  // Full meta for one item (detail screen).
  function meta(cat, id, cb) {
    if (!cat || !id) return cb(null);
    var path = 'meta/' + encodeURIComponent(cat.type) + '/' + encodeURIComponent(id) + '.json';
    getJSON(addonUrl(cat.addon.base, path), function (json) {
      cb(json && json.meta ? json.meta : null);
    });
  }

  function normalizeStream(addon, s) {
    if (!s) return null;
    // direct URLs only — http(s) absolute or app/LAN-relative; reject magnet/remote-source indirection
    var url = (typeof s.url === 'string' && s.url && !/^(magnet|stremio|intent):/i.test(s.url)) ? s.url : null;
    var name = s.name || addon.name;
    var title = s.title || s.description || '';
    var hint = s.behaviorHints || {};
    var sub = title || (url ? url.replace(/^https?:\/\//, '').split('/')[0] : '');
    var playable = !!url && !hint.notWebReady;
    var kind = url ? 'http' : (s.infoHash ? 'remote-source' : (s.externalUrl || s.ytId ? 'external' : 'unknown'));
    return { addon: addon.name, name: name, label: name, sub: sub, url: url, playable: playable, kind: kind, raw: s };
  }

  // Streams for an item, from every addon that declares the 'stream' resource.
  function streams(type, id, cb) {
    var per = {};
    var pending = MEDIA_ADDONS.length;
    function done() { if (--pending === 0) cb(flatten(per).slice(0, MEDIA_MAX_STREAMS)); }
    if (!pending || !id) return cb([]);
    MEDIA_ADDONS.forEach(function (addon, ai) {
      loadManifest(addon, function (m) {
        if (m && hasResource(m, 'stream')) {
          var path = 'stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
          getJSON(addonUrl(addon.base, path), function (json) {
            var ss = json && json.streams;
            if (ss && ss.length) {
              per[ai] = [];
              for (var i = 0; i < ss.length; i++) {
                var n = normalizeStream(addon, ss[i]);
                if (n) per[ai].push(n);
              }
            }
            done();
          });
        } else done();
      });
    });
  }

  // Persisted catalog pick: just the index, nothing worth more.
  function pick(i) { F.store.merge('media', { catalog: i }, { catalog: 0 }); }

  F.media = {
    catalogs: catalogs,
    catalog: catalog,
    meta: meta,
    streams: streams,
    addonCount: function () { return MEDIA_ADDONS.length; },
    open: function (cat, item) { current = { cat: cat, item: item }; },
    item: function () { return current; },
    start: function (stream) { currentStream = stream; },
    playing: function () { return currentStream; },
    pick: pick,
    picked: function () { return F.store.get('media', { catalog: 0 }).catalog || 0; }
  };
})(window.framed);

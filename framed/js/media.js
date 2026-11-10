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
 *   F.media.start(stream, ctx) / F.media.playing()  detail -> player handoff (ctx = { cat, item, episodeId, episodeLabel })
 *   F.media.picked() / F.media.pick(i)              persisted catalog selection ("framed.media")
 *   F.media.search(query, cb) -> cb(items)          addon `search` extra where offered, else a filtered catalog fetch
 *   F.media.toggleSaved(cat, item) / isSaved / savedItems()   the viewer's own library ("framed.watch".saved)
 *   F.media.recordProgress(pos, dur) / progressFor… / continueItems()  resume points ("framed.watch".progress)
 *
 * Streams are normalized to { name, label, sub, url, playable }. Anything that is not a
 * direct http(s) URL (infoHash torrents, ytId, externalUrl) comes back playable:false —
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
   *   Torrentio — stream results; its sources are torrents (unplayable on TV, kept for parity).
   *   OpenSubtitles v3 — external subtitles for movies and series.
   *   Local demo — bundled offline catalog under addons/demo/ so the section works with no network.
   *
   * Personal/debrid addon URLs (e.g. a Torrentio URL configured with a debrid key at
   * torrentio.strem.fun/configure) contain secrets — keep them out of git by dropping a
   * gitignored 'addons.local.json' next to index.html:
   *   {"addons": [{"name": "Torrentio", "base": "<your configured url>"}]}
   * Local entries replace same-name defaults; unknown names are prepended.
   */
  var DEFAULT_ADDONS = [
    { name: 'Cinemeta', base: 'https://v3-cinemeta.strem.io' },
    { name: 'Torrentio', base: 'https://torrentio.strem.fun' },
    { name: 'OpenSubtitles v3', base: 'https://opensubtitles-v3.strem.io' },
    { name: 'Local demo', base: 'addons/demo' }
  ];
  // Installed set = defaults (minus any the viewer disabled) + addons installed
  // from the Addons shelf, persisted in "framed.media" { customAddons, disabledAddons }.
  var MEDIA_ADDONS = DEFAULT_ADDONS.slice();

  function applyAddonPrefs() {
    var prefs = F.store.get('media', { catalog: 0 });
    var disabled = prefs.disabledAddons || [];
    var out = DEFAULT_ADDONS.filter(function (a) { return disabled.indexOf(a.name) === -1; });
    (prefs.customAddons || []).forEach(function (a) { if (a && a.base && a.name) out.push(a); });
    MEDIA_ADDONS = out;
    manifests = {};
  }
  var MEDIA_TIMEOUT_MS = 6000;      // per-request budget before an addon counts as unreachable
  var MEDIA_MAX_STREAMS = 40;       // stream rows offered per item
  /* ================================== */

  var manifests = {};               // base -> manifest object | false (failed) | undefined (not asked)
  var current = null;               // { cat, item } handed from browse to detail
  var currentStream = null;         // stream handed from detail to player
  var playingCtx = null;            // { cat, item, episodeId, episodeLabel } for resume bookkeeping
  var localAddonsLoaded = false;    // addons.local.json merge applied (or file absent)
  var WATCH_DEFAULTS = { saved: [], progress: {}, watched: {}, searches: [],
    prefs: { subLang: '', audioLang: '', subSize: 100, subPosition: 6, speed: 1, autoplayNext: true, endBehavior: null } };

  applyAddonPrefs();

  function watch() { return F.store.get('watch', WATCH_DEFAULTS); }
  function saveWatch(w) { return F.store.set('watch', w); }
  function progressKey(type, id) { return (type || 'movie') + ':' + id; }

  // Catalogs and items are handed around live ({ addon:{base}, … }); anything persisted
  // (library, resume points) needs a plain, revivable snapshot instead.
  function snapshotCat(cat) {
    if (!cat) return null;
    if (cat.addonBase) return { addonName: cat.addonName || '', addonBase: cat.addonBase, type: cat.type, id: cat.id, label: cat.label }; // already a snapshot
    return { addonName: cat.addon ? cat.addon.name : '', addonBase: cat.addon ? cat.addon.base : '', type: cat.type, id: cat.id, label: cat.label };
  }
  function reviveCat(snap) {
    if (!snap || !snap.addonBase) return null;
    return { addon: { name: snap.addonName || snap.addonBase, base: snap.addonBase }, type: snap.type, id: snap.id, label: snap.label };
  }
  function snapshotItem(cat, item) {
    if (!item) return null;
    if (!cat && item.cat) return item; // already a snapshot
    return {
      id: item.id, type: item.type || (cat && cat.type) || 'movie', name: item.name,
      poster: item.poster || null, year: item.year || item.releaseInfo || '',
      description: item.description || '', cat: snapshotCat(cat)
    };
  }

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

  // Merge gitignored addons.local.json once: same-name entries replace defaults,
  // unknown names prepend. Silent no-op when the file is absent (keep-off-the-air key store).
  function withLocalAddons(cb) {
    if (localAddonsLoaded) return cb();
    localAddonsLoaded = true;
    getJSON('addons.local.json', function (json) {
      var locals = json && json.addons;
      if (locals && locals.length) {
        var fresh = [];
        for (var i = 0; i < locals.length; i++) {
          var l = locals[i];
          if (!l || !l.base || !l.name) continue;
          var replaced = false;
          for (var j = 0; j < MEDIA_ADDONS.length; j++) {
            if (MEDIA_ADDONS[j].name === l.name) { MEDIA_ADDONS[j].base = l.base; replaced = true; break; }
          }
          if (!replaced) fresh.push(l);
        }
        MEDIA_ADDONS = fresh.concat(MEDIA_ADDONS);
        note('addons.local.json applied: ' + (fresh.length ? fresh.length + ' prepended, ' : '') + (locals.length - fresh.length) + ' replaced');
      }
      cb();
    });
  }

  // Aggregate catalogs across addons that declare the 'catalog' resource.
  function catalogs(cb) {
    withLocalAddons(function () {
      var per = {};
      var pending = MEDIA_ADDONS.length;
      if (!pending) return cb([]);
      MEDIA_ADDONS.forEach(function (addon, ai) {
        loadManifest(addon, function (m) {
          if (m && hasResource(m, 'catalog') && m.catalogs && m.catalogs.length) {
            per[ai] = [];
            m.catalogs.forEach(function (c) {
              if (!c || !c.type || !c.id) return;
              var extras = [], filters = [];
              var ex = c.extra || [];
              for (var k = 0; k < ex.length; k++) {
                var name = typeof ex[k] === 'string' ? ex[k] : ex[k] && ex[k].name;
                if (name) extras.push(name);
                // Discover-style filters: any declared extra with options (genre, year…)
                if (typeof ex[k] === 'object' && ex[k] && ex[k].name && ex[k].options && ex[k].options.length &&
                    ex[k].name !== 'search' && ex[k].name !== 'skip') {
                  filters.push({ name: ex[k].name, options: ex[k].options.slice() });
                }
              }
              (c.extraSupported || []).forEach(function (n) { if (extras.indexOf(n) === -1) extras.push(n); });
              if (!filters.length && c.genres && c.genres.length && extras.indexOf('genre') !== -1) {
                filters.push({ name: 'genre', options: c.genres.slice() });
              }
              per[ai].push({ addon: addon, type: c.type, id: c.id, label: (c.name || c.id) + ' · ' + c.type, searchable: extras.indexOf('search') !== -1, pageable: extras.indexOf('skip') !== -1, filters: filters });
            });
          }
          if (--pending === 0) cb(flatten(per));
        });
      });
    });
  }

  // One catalog's metas -> normalized items. `extra` is the protocol's optional
  // trailing segment, e.g. "search=the%20matrix" on catalogs that declare it.
  function catalog(cat, cb, extra) {
    if (!cat) return cb(null);
    var path = 'catalog/' + encodeURIComponent(cat.type) + '/' + encodeURIComponent(cat.id) +
      (extra ? '/' + extra : '') + '.json';
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

  // Row contract (design/pass-2 markup §3): { q, name, size, file, flag, playable, ready,
  // kind, reason } — plus url/addon/binge/raw. Debrid tags ([TB+], "TorBox" …) rename the
  // source to "<addon> via TorBox" and decide Ready vs "TorBox fetches it first"; the tag
  // itself is never printed. DTS/DTS-HD/TrueHD is the real silent-audio offender on
  // Samsung panels (Dolby decodes fine): flagged on the row and named in refusals.
  var DEBRID_RE = /\b(torbox|real-?debrid|alldebrid|premiumize|easydebrid|debrid-?link|offcloud)\b|\[(tb|rd|ad|pm|ed|dl|oc)\+?\]/i;
  var READY_RE = /\[(tb|rd|ad|pm|ed|dl|oc)\+\]|\bcached\b|\binstant\b/i;
  var DTS_RE = /\b(dts(-?hd|-?x|-?es)?|truehd|atmos)\b/i;
  function normalizeStream(addon, s) {
    if (!s) return null;
    // direct URLs only — http(s) absolute or app/LAN-relative; reject magnet/torrent indirection
    var url = (typeof s.url === 'string' && s.url && !/^(magnet|stremio|intent):/i.test(s.url)) ? s.url : null;
    var title = s.title || s.description || '';
    var hint = s.behaviorHints || {};
    var playable = !!url && !hint.notWebReady;
    var kind = url ? 'http' : (s.infoHash ? 'torrent' : (s.externalUrl ? 'external' : (s.ytId ? 'ytId' : (hint.notWebReady ? 'notWebReady' : 'unknown'))));
    var hay = (s.name || '') + ' ' + title;
    var debrid = DEBRID_RE.test(hay);
    var ready = playable && debrid && READY_RE.test(hay);
    var name = (debrid && !/torbox|debrid/i.test(addon.name)) ? addon.name + ' via TorBox' : addon.name;
    var qm = /(\d{3,4}p|4k|2160|1080|720|480)/i.exec(title || '');
    var q = qm ? (/2160|4k/i.test(qm[1]) ? '4K' : qm[1].toLowerCase()) : '—';
    var sm = /💾\s*([0-9.]+\s*(?:GB|MB|TB|GiB|MiB|TiB))/i.exec(title);
    var size = sm ? sm[1] : '';
    var file = String(title).split('\n')[0];
    var flags = [];
    if (playable) {
      if (debrid) flags.push(ready ? 'Ready' : 'TorBox fetches it first');
      if (/\b(hdr|hdr10|dolby[ -]?vision|\bdv\b)/i.test(hay)) flags.push('HDR');
      var dm = DTS_RE.exec(hay);
      if (dm) flags.push('sound may not play (' + (/truehd|atmos/i.test(dm[1]) ? 'TrueHD' : 'DTS') + ')');
    }
    var flag = flags.join(' · ');
    var reason = playable ? '' :
      kind === 'torrent' ? 'Torrent · needs a debrid service' :
      kind === 'external' ? 'Plays outside framed only' :
      kind === 'ytId' ? 'YouTube link · open in YouTube' :
      kind === 'notWebReady' ? 'The TV’s player can’t open this link' : 'No direct file link';
    var reasonSentence = playable ? '' :
      kind === 'torrent' ? 'This is a torrent. A debrid service such as TorBox makes torrents playable.' :
      kind === 'external' ? 'This source opens in another app, not in framed.' :
      kind === 'ytId' ? 'This is a YouTube link. Open it in the YouTube app.' :
      'The TV’s player can’t open this source’s link.';
    var dts = playable && DTS_RE.test(hay);
    return { addon: addon.name, name: name, q: q, size: size, file: file, flag: flag, reason: reason,
      reasonSentence: reasonSentence, playable: playable, ready: ready, debrid: debrid, dts: dts,
      kind: kind, url: url, binge: hint.bingeGroup || null, raw: s };
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

  /* ---------- the viewer's own library + resume points ("framed.watch") ---------- */

  function isSaved(type, id) {
    var list = watch().saved || [];
    for (var i = 0; i < list.length; i++) if (list[i].type === type && list[i].id === id) return true;
    return false;
  }

  // Returns true when the item is saved after the call.
  function toggleSaved(cat, item) {
    var snap = snapshotItem(cat, item);
    if (!snap || !snap.id) return false;
    var w = watch();
    var list = w.saved || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === snap.type && list[i].id === snap.id) {
        list.splice(i, 1);
        w.saved = list; saveWatch(w);
        return false;
      }
    }
    list.unshift(snap);
    w.saved = list.slice(0, 200);
    saveWatch(w);
    return true;
  }

  // Snapshots newest-first; cat is revived on open (see screens/media.js openSnapshot).
  function savedItems() { return (watch().saved || []).slice(); }

  // Called by the player (throttled there). Finished titles (>92% or <10 s left) drop
  // off Continue Watching but stay in history-free oblivion — no separate watched list.
  function recordProgress(pos, dur) {
    if (!playingCtx || !playingCtx.item || !(dur > 0)) return;
    var it = playingCtx.item;
    var videoId = playingCtx.episodeId || it.id;
    var w = watch();
    var all = w.progress || {};
    var finished = pos >= dur * 0.92 || dur - pos < 10;
    if (pos < 5 && !finished) return; // a stray open is not a resume point
    if (finished) {
      delete all[progressKey(it.type, videoId)];
      var watchedAll = w.watched || {};
      watchedAll[progressKey(it.type, videoId)] = { at: Date.now(), item: snapshotItem(playingCtx.cat, it) };
      w.watched = watchedAll;
    }
    else all[progressKey(it.type, videoId)] = {
      pos: Math.floor(pos), dur: Math.floor(dur), at: Date.now(),
      episodeId: playingCtx.episodeId || null, episodeLabel: playingCtx.episodeLabel || '',
      item: snapshotItem(playingCtx.cat, it)
    };
    // keep the shelf small and fresh: newest 40
    var keys = Object.keys(all).sort(function (a, b) { return (all[b].at || 0) - (all[a].at || 0); });
    for (var i = 40; i < keys.length; i++) delete all[keys[i]];
    w.progress = all; saveWatch(w);
  }

  function progressFor(type, id) {
    var all = watch().progress || {};
    if (id && all[progressKey(type, id)]) return all[progressKey(type, id)];
    // latest entry belonging to this title (e.g. any episode of a series)
    var best = null;
    for (var k in all) {
      if (all[k].item && all[k].item.id === id && (!best || (all[k].at || 0) > (best.at || 0))) best = all[k];
    }
    return best;
  }

  // [{ item(snapshot), progress }] newest first — the Continue Watching shelf.
  function continueItems() {
    var all = watch().progress || {};
    return Object.keys(all).map(function (k) { return all[k]; })
      .filter(function (p) { return p && p.item && p.dur > 0 && p.pos > 0; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); })
      .map(function (p) { return { item: p.item, progress: p }; });
  }

  function clearProgress(type, id) {
    var w = watch();
    if (w.progress) { delete w.progress[progressKey(type, id)]; saveWatch(w); }
  }

  // Drop every resume point belonging to a title (Continue Watching "dismiss").
  function clearProgressForItem(type, id) {
    var w = watch();
    var all = w.progress || {};
    for (var k in all) {
      if (k === progressKey(type, id) || (all[k].item && all[k].item.id === id)) delete all[k];
    }
    w.progress = all; saveWatch(w);
  }

  /* ---------- watched state (Stremio's watched indicator / mark as watched) ---------- */

  function isWatched(type, id) { return !!(watch().watched || {})[progressKey(type, id)]; }

  function setWatched(cat, item, videoId, on) {
    if (!item) return false;
    var w = watch();
    var all = w.watched || {};
    var key = progressKey(item.type, videoId || item.id);
    if (on) all[key] = { at: Date.now(), item: snapshotItem(cat, item) };
    else delete all[key];
    w.watched = all; saveWatch(w);
    if (on) clearProgress(item.type, videoId || item.id);
    return on;
  }

  function toggleWatched(cat, item, videoId) {
    return setWatched(cat, item, videoId, !isWatched(item && item.type, videoId || (item && item.id)));
  }

  // Stremio adds anything you actually play to the library; My List doubles as it.
  function ensureSaved(cat, item) {
    var snap = snapshotItem(cat, item);
    if (!snap || !snap.id || isSaved(snap.type, snap.id)) return;
    var w = watch();
    var list = w.saved || [];
    list.unshift(snap);
    w.saved = list.slice(0, 200);
    saveWatch(w);
  }

  /* ---------- player prefs + search history ---------- */

  function prefs() {
    var p = (watch().prefs || {});
    var out = { subLang: '', audioLang: '', subSize: 100, subPosition: 6, speed: 1, autoplayNext: true, endBehavior: null };
    for (var k in out) if (p[k] !== undefined) out[k] = p[k];
    if (!out.endBehavior) out.endBehavior = out.autoplayNext ? 'auto' : 'ask';
    return out;
  }
  function setPrefs(patch) {
    var w = watch();
    var p = prefs();
    for (var k in patch) p[k] = patch[k];
    w.prefs = p; saveWatch(w);
    return p;
  }

  function searches() { return (watch().searches || []).slice(); }
  function pushSearch(q) {
    q = String(q || '').trim();
    if (!q) return;
    var w = watch();
    var list = (w.searches || []).filter(function (s) { return s.toLowerCase() !== q.toLowerCase(); });
    list.unshift(q);
    w.searches = list.slice(0, 8); saveWatch(w);
  }

  /* ---------- subtitles (addon `subtitles` resource) ---------- */

  // Respect both manifest-wide and resource-specific type/ID restrictions.
  function supportsSubtitles(m, type, id) {
    if (!m) return false;
    return (m.resources || []).some(function (r) {
      if (r !== 'subtitles' && (!r || r.name !== 'subtitles')) return false;
      var types = r.types || m.types;
      var prefixes = r.idPrefixes || m.idPrefixes;
      return (!types || types.indexOf(type) !== -1) &&
        (!prefixes || prefixes.some(function (prefix) { return id.indexOf(prefix) === 0; }));
    });
  }

  function subtitles(type, id, cb) {
    if (!id) return cb([]);
    withLocalAddons(function () {
      var per = {};
      var pending = MEDIA_ADDONS.length;
      function done() { if (--pending === 0) cb(flatten(per)); }
      if (!pending || !id) return cb([]);
      MEDIA_ADDONS.forEach(function (addon, ai) {
        loadManifest(addon, function (m) {
          if (supportsSubtitles(m, type, id)) {
            var path = 'subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
            getJSON(addonUrl(addon.base, path), function (json) {
              var ss = json && json.subtitles;
              if (ss && ss.length) {
                per[ai] = [];
                for (var i = 0; i < ss.length; i++) {
                  if (ss[i] && ss[i].url) per[ai].push({ lang: ss[i].lang || '', url: ss[i].url, addon: addon.name });
                }
              }
              done();
            });
          } else done();
        });
      });
    });
  }

  /* ---------- addon management (Stremio's Addons page, TV edition) ---------- */

  function resourceNames(m) {
    return (m && m.resources || []).map(function (r) { return typeof r === 'string' ? r : r && r.name; }).filter(Boolean);
  }

  // Active addons with manifest detail, for the Addons shelf.
  function addonList(cb) {
    withLocalAddons(function () {
      var out = [], pending = MEDIA_ADDONS.length;
      if (!pending) return cb([]);
      MEDIA_ADDONS.forEach(function (addon, ai) {
        loadManifest(addon, function (m) {
          out[ai] = {
            name: addon.name, base: addon.base,
            custom: !(function () { for (var i = 0; i < DEFAULT_ADDONS.length; i++) if (DEFAULT_ADDONS[i].base === addon.base) return false; return true; })(),
            version: (m && m.version) || '', description: (m && m.description) || '',
            resources: resourceNames(m), types: (m && m.types) || [],
            reachable: !!m
          };
          if (--pending === 0) cb(out.filter(Boolean));
        });
      });
    });
  }

  function disabledAddons() { return (F.store.get('media', { catalog: 0 }).disabledAddons || []).slice(); }

  // Install by manifest/base URL. cb(ok, nameOrWhy).
  function addAddon(input, cb) {
    var base = String(input || '').trim().replace(/\s+/g, '').replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return cb(false, 'That does not look like an addon URL');
    getJSON(addonUrl(base, 'manifest.json'), function (m) {
      if (!m || !m.id) return cb(false, 'No addon answered at that URL');
      var name = m.name || base.replace(/^https?:\/\//, '').split('/')[0];
      var prefs = F.store.get('media', { catalog: 0 });
      var customs = (prefs.customAddons || []).filter(function (a) { return a.base !== base; });
      customs.push({ name: name, base: base });
      var disabled = (prefs.disabledAddons || []).filter(function (n) { return n !== name; });
      F.store.set('media', { catalog: prefs.catalog || 0, view: prefs.view, customAddons: customs, disabledAddons: disabled });
      applyAddonPrefs();
      cb(true, name);
    });
  }

  // Custom addons are removed; bundled defaults are disabled (restorable).
  function removeAddon(descriptor) {
    var prefs = F.store.get('media', { catalog: 0 });
    var customs = (prefs.customAddons || []).filter(function (a) { return a.base !== descriptor.base; });
    var disabled = prefs.disabledAddons || [];
    if (customs.length === (prefs.customAddons || []).length && disabled.indexOf(descriptor.name) === -1) disabled.push(descriptor.name);
    F.store.set('media', { catalog: prefs.catalog || 0, view: prefs.view, customAddons: customs, disabledAddons: disabled });
    applyAddonPrefs();
  }

  function restoreAddon(name) {
    var prefs = F.store.get('media', { catalog: 0 });
    var disabled = (prefs.disabledAddons || []).filter(function (n) { return n !== name; });
    F.store.set('media', { catalog: prefs.catalog || 0, view: prefs.view, customAddons: prefs.customAddons || [], disabledAddons: disabled });
    applyAddonPrefs();
  }

  /* ---------- search ---------- */

  // Every catalog is asked. Catalogs declaring the `search` extra get the protocol
  // request; the rest (including the bundled demo, whose JSON is static) are fetched
  // whole and filtered by title here, so search works with zero network too.
  function search(query, cb) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return cb([]);
    catalogs(function (cats) {
      if (!cats.length) return cb([]);
      // One searchable catalog per addon+type is enough (the rest are genre/year
      // re-sorts of the same titles); every non-searchable catalog is filtered locally.
      var asked = {}, ask = [];
      cats.forEach(function (c) {
        var key = (c.addon.base || c.addon.name) + '|' + c.type;
        if (c.searchable && asked[key]) return;
        asked[key] = true;
        ask.push(c);
      });
      cats = ask;
      var per = {}, pending = cats.length, seen = {};
      function keep(cat, items, filterLocal) {
        var out = [];
        (items || []).forEach(function (it) {
          if (filterLocal && it.name.toLowerCase().indexOf(q) === -1) return;
          var key = progressKey(it.type, it.id);
          if (seen[key]) return;
          seen[key] = true;
          out.push({ cat: cat, item: it });
        });
        return out;
      }
      cats.forEach(function (cat, ci) {
        function done(items, filterLocal) {
          per[ci] = keep(cat, items, filterLocal);
          if (--pending === 0) { // per-catalog buckets, in catalog order (not flatten(): that is per-addon)
            var out = [];
            cats.forEach(function (c, i) { (per[i] || []).forEach(function (e) { out.push(e); }); });
            cb(out);
          }
        }
        if (cat.searchable) {
          catalog(cat, function (items) {
            if (items) done(items, false);
            else catalog(cat, function (all) { done(all, true); }); // addon ignored the extra: fall back
          }, 'search=' + encodeURIComponent(q));
        } else {
          catalog(cat, function (all) { done(all, true); });
        }
      });
    });
  }

  F.media = {
    catalogs: catalogs,
    catalog: catalog,
    meta: meta,
    streams: streams,
    search: search,
    addonCount: function () { return MEDIA_ADDONS.length; },
    // a debrid addon (TorBox etc.) is installed: torrents can actually play
    debridConfigured: function () {
      return MEDIA_ADDONS.some(function (a) {
        return DEBRID_RE.test(String(a.name || '') + ' ' + String(a.base || ''));
      });
    },
    // hand a live (cat,item) or a persisted snapshot to the detail screen
    open: function (cat, item) {
      if (!cat && item && item.cat) { cat = reviveCat(item.cat); item = snapshotItem(null, item); }
      current = { cat: cat, item: item };
    },
    item: function () { return current; },
    start: function (stream, ctx) { currentStream = stream; playingCtx = ctx || playingCtx; },
    playing: function () { return currentStream; },
    playingContext: function () { return playingCtx; },
    snapshotItem: snapshotItem,
    reviveCat: reviveCat,
    isSaved: isSaved,
    toggleSaved: toggleSaved,
    savedItems: savedItems,
    ensureSaved: ensureSaved,
    recordProgress: recordProgress,
    progressFor: progressFor,
    continueItems: continueItems,
    clearProgress: clearProgress,
    clearProgressForItem: clearProgressForItem,
    isWatched: isWatched,
    setWatched: setWatched,
    toggleWatched: toggleWatched,
    subtitles: subtitles,
    prefs: prefs,
    setPrefs: setPrefs,
    searches: searches,
    pushSearch: pushSearch,
    addonList: addonList,
    disabledAddons: disabledAddons,
    addAddon: addAddon,
    removeAddon: removeAddon,
    restoreAddon: restoreAddon,
    pick: pick,
    picked: function () { return F.store.get('media', { catalog: 0 }).catalog || 0; }
  };
})(window.framed);

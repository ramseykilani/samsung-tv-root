/*
 * framed — Media detail screen, design pass-2 contract.
 *   One filled act: Play/Resume (gated while sources load or when none play).
 *   Quiet acts: Save to My List, Mark watched (series: scoped to the open episode),
 *   Forget my place. Series render one season at a time; the open episode's sources
 *   hang beneath it. Sources: playable rows first, dead rows folded behind .src-more;
 *   struck rows stay reachable and OK repeats the reason as a sentence.
 * Async loads carry a token so a slow addon can't paint stale lists over a newer pick.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media-item');
  var posterEl = document.getElementById('md-poster');
  var titleEl = document.getElementById('md-title');
  var metaEl = document.getElementById('md-meta');
  var descEl = document.getElementById('md-desc');
  var backdropEl = document.getElementById('md-backdrop');
  var castEl = document.getElementById('md-cast');
  var playBtn = document.getElementById('md-play');
  var playWhy = document.getElementById('md-play-why');
  var saveBtn = document.getElementById('md-save');
  var watchedBtn = document.getElementById('md-watched');
  var dismissBtn = document.getElementById('md-dismiss');
  var episodesHead = document.getElementById('md-episodes-head');
  var episodesEl = document.getElementById('md-episodes');
  var seasonEl = document.getElementById('md-season');
  var sourcesHead = document.getElementById('md-sources-head');
  var sourcesCount = document.getElementById('md-sources-count');
  var streamsEl = document.getElementById('md-streams');
  var statusEl = document.getElementById('md-status');

  var cur = null;            // { cat, item }
  var episodes = [];         // meta.videos
  var seasons = [];          // distinct season numbers, specials last
  var seasonCtl = null;
  var season = null;
  var openEp = null;         // the episode whose sources are shown
  var openRow = null;
  var epSourcesEl = null;    // .ep-sources hanging under the open row
  var streams = [];
  var firstPlayable = null;
  var bestReady = null;
  var foldOpen = false;
  var loadToken = 0;
  var playFocusedOnce = false;

  function setStatus(t) { statusEl.textContent = t || ''; }
  function prefs() { return F.media.prefs(); }
  function isSeries() { return episodes.length > 0; }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function epSE(v) {
    return (v.season != null && v.episode != null) ? 'S' + v.season + ' · E' + v.episode : '';
  }
  function episodeLabel(v) {
    var se = epSE(v);
    return (se ? se + ' · ' : '') + (v.title || v.name || 'Episode');
  }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function debridConfigured() {
    return streams.some(function (s) { return s.debrid; }) || F.media.debridConfigured && F.media.debridConfigured();
  }

  /* ---------- chrome of the header ---------- */

  function paintMeta(m) {
    var bits = [];
    var info = m.releaseInfo || m.year || '';
    if (info) bits.push(info);
    if (m.runtime) bits.push(m.runtime);
    var genres = m.genres || m.genre;
    if (genres && genres.length) bits.push(genres.slice(0, 3).join(' · '));
    if (m.imdbRating) bits.push('★ ' + m.imdbRating);
    metaEl.textContent = bits.join('  ·  ');
    var people = [];
    var cast = m.cast || m.actors;
    if (cast && cast.length) people.push('Cast: ' + (cast.join ? cast.slice(0, 5).join(', ') : cast));
    var directors = m.director || m.directors;
    if (directors && directors.length) people.push('Directed by ' + (directors.join ? directors.join(', ') : directors));
    castEl.textContent = people.join('   ·   ');
    if (m.description) descEl.textContent = m.description;
    if (m.poster) posterEl.style.backgroundImage = 'url("' + String(m.poster).replace(/"/g, '') + '")';
    if (m.background) backdropEl.style.backgroundImage = 'url("' + String(m.background).replace(/"/g, '') + '")';
  }

  /* ---------- actions ---------- */

  function playValue() {
    var it = cur.item;
    var p = F.media.progressFor(it.type, it.id);
    if (isSeries()) {
      var v = openEp || resumeEp() || episodes[0];
      var se = epSE(v);
      var pv = v && F.media.progressFor(it.type, v.id);
      if (pv && pv.dur > 0) return se + ' · from ' + fmt(pv.pos);
      return se;
    }
    if (p && p.dur > 0) return 'from ' + fmt(p.pos);
    return '';
  }

  function resumeEp() {
    var p = F.media.progressFor(cur.item.type, cur.item.id);
    if (p && p.episodeId) {
      for (var i = 0; i < episodes.length; i++) if (episodes[i].id === p.episodeId) return episodes[i];
    }
    return null;
  }

  function paintPlay() {
    if (!cur) return;
    var p = F.media.progressFor(cur.item.type, cur.item.id);
    var hasProgress = !!(p && p.dur > 0 && p.pos > 5);
    playBtn.querySelector('.act__name').textContent = hasProgress ? 'Resume' : 'Play';
    playBtn.querySelector('.act__value').textContent = playValue();
    var gated, why = '';
    if (!streams.length) { gated = true; why = 'Finding sources…'; }
    else if (!firstPlayable) { gated = true; why = 'Nothing here plays on this TV yet'; }
    else { gated = false; }
    if (gated) playBtn.setAttribute('data-gated', 'true'); else playBtn.removeAttribute('data-gated');
    playWhy.hidden = !why;
    playWhy.textContent = why;
    dismissBtn.hidden = !hasProgress;
    saveBtn.querySelector('.act__name').textContent = F.media.isSaved(cur.item.type, cur.item.id) ? 'Remove from My List' : 'Save to My List';
    var videoId = openEp ? openEp.id : cur.item.id;
    var watched = F.media.isWatched(cur.item.type, videoId);
    watchedBtn.querySelector('.act__name').textContent = isSeries()
      ? (watched ? 'Mark ' + epSE(openEp) + ' unwatched' : 'Mark ' + epSE(openEp) + ' watched')
      : (watched ? 'Mark unwatched' : 'Mark watched');
  }

  playBtn.addEventListener('click', function () {
    if (playBtn.getAttribute('data-gated') === 'true') return;
    if (firstPlayable) playStream(firstPlayable);
  });
  saveBtn.addEventListener('click', function () {
    if (!cur) return;
    var now = F.media.toggleSaved(cur.cat, cur.item);
    paintPlay();
    F.toast(now ? 'Saved to My List' : 'Removed from My List', now ? 'ok' : 'info');
  });
  watchedBtn.addEventListener('click', function () {
    if (!cur) return;
    var now = F.media.toggleWatched(cur.cat, cur.item, openEp ? openEp.id : null);
    paintPlay();
    renderEpisodes();
    F.toast(now ? 'Marked as watched' : 'Marked as unwatched', now ? 'ok' : 'info');
  });
  dismissBtn.addEventListener('click', function () {
    if (!cur) return;
    F.media.clearProgressForItem(cur.item.type, cur.item.id);
    paintPlay();
    F.toast('Forgot your place in ' + cur.item.name, 'info');
  });

  function playStream(s) {
    F.media.start(s, {
      cat: cur.cat, item: cur.item,
      episodeId: openEp ? openEp.id : null,
      episodeLabel: openEp ? episodeLabel(openEp) : '',
      episodes: episodes,
      streams: streams,
      streamName: s.name
    });
    F.router.go('media-play');
  }

  /* ---------- episodes (one season at a time) ---------- */

  function computeSeasons() {
    var seen = {}, list = [];
    episodes.forEach(function (v) {
      var s = v.season == null ? 0 : v.season;
      if (!seen[s]) { seen[s] = true; list.push(s); }
    });
    list.sort(function (a, b) { return a - b; });
    if (list.length && list[0] === 0) { list.shift(); list.push(0); } // specials last
    return list;
  }

  function seasonOptions() {
    return seasons.map(function (s) { return { value: s, label: s === 0 ? 'Specials' : String(s) }; });
  }

  function renderSeasonPick() {
    if (!isSeries() || seasons.length < 1) { seasonEl.innerHTML = ''; seasonCtl = null; return; }
    seasonCtl = F.controls.render(seasonEl, [{
      id: 'season', name: 'Season', type: 'choice', value: season, options: seasonOptions()
    }], function (id, value) {
      season = value;
      renderEpisodes();
    });
  }

  function epMeta(v) {
    var bits = [];
    if (v.runtime) bits.push(v.runtime);
    var d = v.released || v.firstAired;
    if (d) {
      var t = Date.parse(d);
      if (t && t > Date.now()) bits.push('Airs ' + new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
      else bits.push(new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    }
    return bits.join(' · ');
  }

  function epMark(v) {
    if (F.media.isWatched(cur.item.type, v.id)) return 'Watched';
    var p = F.media.progressFor(cur.item.type, v.id);
    if (openEp === v) {
      var base = 'Up next';
      if (p && p.dur > 0 && p.pos > 0) base += ' · ' + leftWords(p);
      return base;
    }
    if (p && p.dur > 0 && p.pos > 0) return leftWords(p);
    return '';
  }

  function leftWords(p) {
    var min = Math.ceil(Math.max(0, (p.dur || 0) - (p.pos || 0)) / 60);
    if (min >= 90) return Math.floor(min / 60) + ' h ' + Math.round(min % 60) + ' min left';
    return min + ' min left';
  }

  function renderEpisodes() {
    // Rebuild destroys the focused row; remember the cursor's episode and put it back.
    var active = document.activeElement;
    var focusedId = active && episodesEl.contains(active) ? active._videoId : null;
    var kept = [];
    for (var i = 0; i < episodesEl.children.length; i++) {
      if (episodesEl.children[i] !== seasonEl) kept.push(episodesEl.children[i]);
    }
    kept.forEach(function (n) { n.remove(); });
    if (!isSeries()) { episodesHead.hidden = true; return; }
    episodesHead.hidden = false;
    var firstOfSeason = null;
    episodes.forEach(function (v) {
      var s = v.season == null ? 0 : v.season;
      if (s !== season) return;
      var row = document.createElement('button');
      row.className = 'ep';
      row.setAttribute('data-focusable', '');
      row.setAttribute('tabindex', '-1');
      row._videoId = v.id;
      var watched = F.media.isWatched(cur.item.type, v.id);
      if (watched) row.setAttribute('data-watched', 'true');
      if (openEp === v) row.setAttribute('data-open', 'true');
      else if (resumeEp() === v && !openEp) row.setAttribute('data-upnext', 'true');
      var num = h('span', 'ep__num', v.episode != null ? String(v.episode) : '·');
      var ttl = h('span', 'ep__title');
      ttl.appendChild(h('span', null, v.title || v.name || 'Episode'));
      var mark = h('span', 'ep__mark', epMark(v));
      var meta = h('span', 'ep__meta', epMeta(v));
      row.appendChild(num); row.appendChild(ttl); row.appendChild(mark); row.appendChild(meta);
      var p = F.media.progressFor(cur.item.type, v.id);
      if (p && p.dur > 0 && p.pos > 0 && !watched) {
        var prog = h('div', 'progress ep__progress');
        var fill = h('div', 'progress__fill');
        fill.style.width = Math.min(100, Math.round(p.pos / p.dur * 100)) + '%';
        prog.appendChild(fill); row.appendChild(prog);
      }
      row.addEventListener('click', function () { toggleEpisode(v, row); });
      episodesEl.appendChild(row);
      if (!firstOfSeason) firstOfSeason = row;
      if (openEp === v) {
        openRow = row;
        epSourcesEl = h('div', 'ep-sources sources');
        episodesEl.appendChild(epSourcesEl);
      }
      if (focusedId && focusedId === v.id) F.nav.focus(row);
    });
  }

  function toggleEpisode(v, row) {
    if (openEp === v) { // closing keeps nothing to show
      openEp = null; openRow = null; epSourcesEl = null; streams = []; renderSources();
      renderEpisodes();
      return;
    }
    openEp = v;
    renderEpisodes();
    paintPlay();
    loadStreams(true); // cursor follows into the episode's first playable source
  }

  /* ---------- sources ---------- */

  function sourceRow(s) {
    var row = document.createElement('button');
    row.className = 'src';
    row.setAttribute('data-focusable', '');
    row.setAttribute('tabindex', '-1');
    row.setAttribute('data-playable', s.playable ? 'true' : 'false');
    if (s.ready) row.setAttribute('data-ready', 'true');
    row.appendChild(h('span', 'src__q', s.q));
    row.appendChild(h('span', 'src__name', s.name));
    row.appendChild(h('span', 'src__size', s.size));
    row.appendChild(h('span', 'src__file', s.file));
    row.appendChild(h('span', 'src__flag', s.playable ? s.flag : s.reason));
    row.addEventListener('click', function () {
      if (!s.playable) { F.toast(s.reasonSentence, 'info'); return; }
      playStream(s);
    });
    return row;
  }

  function container() { return epSourcesEl || streamsEl; }

  function note(text) { return h('div', 'note', text); }

  function emptyState(headText, causeText, actName, onAct, fault) {
    var box = h('div', 'empty' + (fault ? ' empty--fault' : ''));
    box.appendChild(h('div', 'empty__head', headText));
    box.appendChild(h('p', 'empty__cause', causeText));
    if (actName) {
      var acts = h('div', 'acts');
      var b = document.createElement('button');
      b.className = 'act';
      b.setAttribute('data-focusable', ''); b.setAttribute('tabindex', '-1');
      b.appendChild(h('span', 'act__name', actName));
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (b.getAttribute('data-busy') === 'true') return;
        b.setAttribute('data-busy', 'true');
        onAct();
      });
      acts.appendChild(b); box.appendChild(acts);
      box._act = b;
    }
    return box;
  }

  function renderSources() {
    var box = container();
    if (!box) return;
    box.innerHTML = '';
    sourcesHead.hidden = isSeries(); // series heads live inside .ep-sources
    if (!isSeries()) sourcesCount.textContent = streams.length ? ' ' + streams.length : '';
    firstPlayable = null; bestReady = null;
    var playable = streams.filter(function (s) { return s.playable; });
    var dead = streams.filter(function (s) { return !s.playable; });
    playable.forEach(function (s) {
      if (!firstPlayable) firstPlayable = s;
      if (!bestReady && s.ready) bestReady = s;
    });
    if (bestReady) firstPlayable = bestReady;

    if (!streams.length) {
      box.appendChild(emptyState('No sources for this episode',
        'None of your addons listed one. A new episode can take a day to appear.',
        'Ask again', function () { reloadStreams(); }));
      paintPlay();
      return;
    }

    if (playable.length) {
      var readyAny = playable.some(function (s) { return s.ready; });
      box.appendChild(note('Sources for this episode · ' + playable.length +
        ' play on this TV' + (readyAny ? '. Ready ones start at once.' : '.')));
      playable.forEach(function (s) { box.appendChild(sourceRow(s)); });
      if (dead.length) {
        var why = debridConfigured() ? 'torrents your debrid service didn’t take'
                                   : 'plain torrents, from addons without TorBox';
        var fold = document.createElement('button');
        fold.className = 'src-more';
        fold.setAttribute('data-focusable', ''); fold.setAttribute('tabindex', '-1');
        fold.setAttribute('aria-expanded', String(foldOpen));
        fold.appendChild(h('span', null, dead.length + ' more can’t play on this TV'));
        fold.appendChild(h('span', 'src-more__why', why));
        fold.appendChild(h('span', 'src-more__sign', foldOpen ? 'Hide' : 'Show'));
        var deadBox = h('div', 'src-dead');
        deadBox.hidden = !foldOpen;
        dead.forEach(function (s) { deadBox.appendChild(sourceRow(s)); });
        fold.addEventListener('click', function (e) {
          e.stopPropagation();
          foldOpen = !foldOpen;
          renderSources();
          var t = container() && container().querySelector('.src-more');
          if (t) F.nav.focus(t, { noScroll: true });
        });
        box.appendChild(fold);
        box.appendChild(deadBox);
      }
    } else {
      var n = streams.length;
      var allTorrents = dead.every(function (s) { return s.kind === 'torrent'; });
      var empty = emptyState('Nothing here plays on this TV yet',
        allTorrents ? 'All ' + n + ' sources are torrents. A TV can only play a torrent through a debrid service such as TorBox: it fetches the torrent and hands the TV an ordinary video link.'
                    : 'None of the ' + n + ' sources is a file this TV can play directly.',
        allTorrents ? 'Set one up in Addons' : null,
        function () { F.router.go('media'); });
      box.appendChild(empty);
      box.appendChild(note('What the addons found'));
      var deadList = h('div', 'src-dead');
      dead.forEach(function (s) { deadList.appendChild(sourceRow(s)); });
      box.appendChild(deadList);
      foldOpen = false;
    }
    paintPlay();
    if (!playFocusedOnce && firstPlayable) {
      playFocusedOnce = true;
      F.nav.focus(playBtn, { noScroll: true });
    }
  }

  function loadingSources() {
    var box = container();
    if (!box) return;
    box.innerHTML = '';
    var wait = h('div', 'wait');
    wait.appendChild(h('span', 'wait__tick'));
    box.appendChild(wait);
    box.appendChild(note('Asking your ' + F.media.addonCount() + ' addons'));
    paintPlay();
  }

  function loadStreams(focusSource) {
    var token = ++loadToken;
    streams = [];
    foldOpen = false;
    loadingSources();
    var videoId = openEp ? openEp.id : cur.item.id;
    F.media.streams(cur.item.type, videoId, function (ss) {
      if (el.hidden || token !== loadToken) return;
      streams = ss || [];
      if (!streams.length) {
        var box = container();
        if (box) {
          box.innerHTML = '';
          box.appendChild(emptyState('Couldn’t reach your addons',
            'None of them answered within 6 seconds. The TV may be offline, or the addons are down.',
            'Ask again', function () { loadStreams(false); }, true));
          paintPlay();
        }
        return;
      }
      renderSources();
      if (focusSource) {
        var target = container() && container().querySelector('.src[data-playable="true"]');
        if (target) F.nav.focus(target);
      }
    });
  }

  function reloadStreams() { loadStreams(false); }

  F.router.register('media-item', {
    el: el,
    enter: function () {
      cur = F.media.item();
      if (!cur) { F.router.go('media'); return; }
      var it = cur.item;
      episodes = []; seasons = []; season = null; seasonCtl = null;
      openEp = null; openRow = null; epSourcesEl = null;
      streams = []; firstPlayable = null; bestReady = null; foldOpen = false;
      playFocusedOnce = false;
      var token = ++loadToken;
      titleEl.textContent = it.name;
      metaEl.textContent = '';
      descEl.textContent = it.description || '';
      streamsEl.innerHTML = '';
      castEl.textContent = '';
      backdropEl.style.backgroundImage = 'none';
      posterEl.style.backgroundImage = it.poster ? 'url("' + String(it.poster).replace(/"/g, '') + '")' : 'none';
      seasonEl.innerHTML = '';
      var kept = [];
      for (var i = 0; i < episodesEl.children.length; i++) if (episodesEl.children[i] !== seasonEl) kept.push(episodesEl.children[i]);
      kept.forEach(function (n) { n.remove(); });
      episodesHead.hidden = true;
      sourcesHead.hidden = true;
      paintMeta(it.raw || it);
      paintPlay();
      setStatus('Loading…');
      F.nav.setScope(el, { remember: true });
      F.media.meta(cur.cat, it.id, function (m) {
        if (el.hidden || token !== loadToken) return;
        setStatus('');
        if (m) {
          paintMeta(m);
          if (m.videos && m.videos.length) {
            episodes = m.videos.slice().sort(function (a, b) {
              return ((a.season || 0) - (b.season || 0)) || ((a.episode || 0) - (b.episode || 0));
            });
            seasons = computeSeasons();
            var rp = resumeEp();
            season = rp ? (rp.season == null ? 0 : rp.season) : seasons[0];
            openEp = rp || episodes.filter(function (v) { return (v.season == null ? 0 : v.season) === season; })[0] || episodes[0];
            renderSeasonPick();
            renderEpisodes();
            paintPlay();
          }
        }
        loadStreams(false);
      });
      // meta may never arrive (addon without the meta resource): streams must still load
      setTimeout(function () { if (!el.hidden && token === loadToken && !streams.length && !firstPlayable) loadStreams(false); }, 1200);
    },
    back: function () {
      F.router.go('media');
      return true;
    },
    onKey: function () { return false; }
  });
})(window.framed);

/*
 * framed — Media detail screen: poster, title, meta, description, the viewer's own
 * actions (Save to My List, Resume), episodes for series, and the stream list
 * reported by every stream-capable addon. OK on a playable stream → media-play
 * (which seeks to the resume point); OK on an unplayable source (torrent,
 * external) → quiet toast refusal.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media-item');
  var crumb = document.getElementById('md-crumb');
  var posterEl = document.getElementById('md-poster');
  var titleEl = document.getElementById('md-title');
  var metaEl = document.getElementById('md-meta');
  var descEl = document.getElementById('md-desc');
  var backdropEl = document.getElementById('md-backdrop');
  var castEl = document.getElementById('md-cast');
  var saveBtn = document.getElementById('md-save');
  var resumeBtn = document.getElementById('md-resume');
  var watchedBtn = document.getElementById('md-watched');
  var dismissBtn = document.getElementById('md-dismiss');
  var episodesEl = document.getElementById('md-episodes');
  var streamsEl = document.getElementById('md-streams');
  var statusEl = document.getElementById('md-status');

  var cur = null;            // { cat, item }
  var episodes = [];         // meta.videos, season/episode order
  var selectedVideo = null;  // episode object, or null for movies (streams key off the item id)
  var firstPlayable = null;
  var streamsRequested = false;
  var wantStreamFocus = false; // focus should follow the viewer into the stream list

  function setStatus(t) { statusEl.textContent = t || ''; }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function paintMeta(m) {
    var bits = [];
    var info = m.releaseInfo || m.year || '';
    if (info) bits.push(info);
    if (m.runtime) bits.push(m.runtime);
    var genres = m.genres || m.genre;
    if (genres && genres.length) bits.push(genres.slice(0, 3).join(' · '));
    if (m.imdbRating) bits.push('★ ' + m.imdbRating);
    if (m.certification) bits.push(m.certification);
    if (m.country) bits.push(m.country);
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

  function paintActions() {
    if (!cur) return;
    var it = cur.item;
    saveBtn.textContent = F.media.isSaved(it.type, it.id) ? 'Saved to My List — remove' : 'Save to My List';
    var p = F.media.progressFor(it.type, it.id);
    resumeBtn.hidden = !p;
    dismissBtn.hidden = !p;
    if (p) resumeBtn.textContent = 'Resume from ' + fmt(p.pos) + (p.episodeLabel ? ' · ' + p.episodeLabel : '');
    var videoId = selectedVideo ? selectedVideo.id : it.id;
    var watched = F.media.isWatched(it.type, videoId);
    watchedBtn.textContent = (watched ? 'Watched ✓ — mark unwatched' : 'Mark watched') +
      (selectedVideo ? ' (' + episodeLabel(selectedVideo) + ')' : '');
  }

  watchedBtn.addEventListener('click', function () {
    if (!cur) return;
    var now = F.media.toggleWatched(cur.cat, cur.item, selectedVideo ? selectedVideo.id : null);
    paintActions();
    renderEpisodes();
    F.toast(now ? 'Marked as watched' : 'Marked as unwatched', now ? 'ok' : 'info');
  });

  dismissBtn.addEventListener('click', function () {
    if (!cur) return;
    F.media.clearProgressForItem(cur.item.type, cur.item.id);
    paintActions();
    F.toast('Removed from Continue Watching', 'info');
  });

  saveBtn.addEventListener('click', function () {
    if (!cur) return;
    var now = F.media.toggleSaved(cur.cat, cur.item);
    paintActions();
    F.toast(now ? 'Saved to My List' : 'Removed from My List', now ? 'ok' : 'info');
  });

  resumeBtn.addEventListener('click', function () {
    if (firstPlayable) playStream(firstPlayable);
    else F.toast('Streams are still loading', 'info');
  });

  function playStream(s) {
    F.media.start(s, {
      cat: cur.cat, item: cur.item,
      episodeId: selectedVideo ? selectedVideo.id : null,
      episodeLabel: selectedVideo ? episodeLabel(selectedVideo) : '',
      episodes: episodes,
      streamName: s.name
    });
    F.router.go('media-play');
  }

  function episodeLabel(v) {
    var se = (v.season != null && v.episode != null) ? 'S' + v.season + ' E' + v.episode : '';
    return (se ? se + ' · ' : '') + (v.title || v.name || 'Episode');
  }

  function renderEpisodes() {
    // Rebuilding these rows destroys the focused button; remember where the
    // cursor was so it lands on the same episode again, not the top of the page.
    var active = document.activeElement;
    var focusedVideoId = active && episodesEl.contains(active) ? active._videoId : null;
    episodesEl.innerHTML = '';
    if (!episodes.length) return;
    var head = document.createElement('div');
    head.className = 'media-episodes__head';
    head.textContent = 'Episodes';
    episodesEl.appendChild(head);
    episodes.forEach(function (v) {
      var row = document.createElement('button');
      row.className = 'media-stream' + (selectedVideo && selectedVideo.id === v.id ? ' media-stream--selected' : '');
      row.setAttribute('data-focusable', '');
      row.setAttribute('tabindex', '-1');
      var name = document.createElement('span');
      name.className = 'media-stream__name';
      name.textContent = episodeLabel(v);
      var p = F.media.progressFor(cur.item.type, v.id);
      var sub = document.createElement('span');
      sub.className = 'media-stream__sub';
      sub.textContent = F.media.isWatched(cur.item.type, v.id) ? '✓ Watched'
        : (p && p.dur > 0 ? Math.round(p.pos / p.dur * 100) + '% watched' : (v.released ? String(v.released).slice(0, 10) : ''));
      row.appendChild(name);
      row.appendChild(sub);
      row._videoId = v.id;
      row.addEventListener('click', function () { selectEpisode(v, true); });
      episodesEl.appendChild(row);
      if (focusedVideoId && focusedVideoId === v.id) F.nav.focus(row);
    });
  }

  function selectEpisode(v, focusStreams) {
    selectedVideo = v;
    streamsRequested = false;
    wantStreamFocus = !!focusStreams; // applied in renderStreams, once rows exist
    renderEpisodes();
    paintActions();
    loadStreams();
  }

  function loadStreams() {
    if (streamsRequested) return;
    streamsRequested = true;
    var videoId = selectedVideo ? selectedVideo.id : cur.item.id;
    streamsEl.innerHTML = '';
    firstPlayable = null;
    setStatus('Loading streams…');
    F.media.streams(cur.item.type, videoId, function (ss) { if (!el.hidden) renderStreams(ss); });
  }

  function renderStreams(streams) {
    streamsEl.innerHTML = '';
    // playable sources first (stable within each group) — what you can watch is the point
    streams = streams.filter(function (s) { return s.playable; }).concat(streams.filter(function (s) { return !s.playable; }));
    if (!streams.length) { setStatus('No streams reported. Add a stream addon from the Addons shelf.'); return; }
    setStatus('');
    streams.forEach(function (s) {
      if (s.playable && !firstPlayable) firstPlayable = s;
      var row = document.createElement('button');
      row.className = 'media-stream' + (s.playable ? '' : ' media-stream--dead');
      row.setAttribute('data-focusable', '');
      row.setAttribute('tabindex', '-1');
      var name = document.createElement('span');
      name.className = 'media-stream__name';
      name.textContent = s.label;
      var sub = document.createElement('span');
      sub.className = 'media-stream__sub';
      sub.textContent = (s.quality ? s.quality + '  ·  ' : '') + s.sub + (s.playable ? '' : (s.sub ? '  ·  ' : '') + 'not playable on TV');
      row.appendChild(name);
      row.appendChild(sub);
      row.addEventListener('click', function () {
        if (!s.playable) { F.toast("This source can't be played on the TV", 'error'); return; }
        playStream(s);
      });
      streamsEl.appendChild(row);
    });
    paintActions();
    if (!firstPlayable) {
      setStatus('Nothing playable here — the addons returned only torrent/external sources, which this TV can\'t play. A debrid-backed stream addon (Addons shelf) makes titles like this playable.');
    }
    // Follow the viewer into the list: on entry, and after picking an episode.
    // Don't yank focus from the action buttons if the viewer deliberately went up.
    var curEl = F.nav.current();
    if (wantStreamFocus && (!curEl || curEl === saveBtn || episodesEl.contains(curEl) || !el.contains(curEl))) {
      wantStreamFocus = false;
      var target = streamsEl.querySelector('.media-stream:not(.media-stream--dead)') || streamsEl.querySelector('[data-focusable]');
      if (target) F.nav.focus(target);
    } else if (!curEl) {
      F.nav.setScope(el, { remember: true });
    }
  }

  F.router.register('media-item', {
    el: el,
    enter: function () {
      cur = F.media.item();
      if (!cur) { F.router.go('media'); return; }
      var it = cur.item;
      episodes = [];
      selectedVideo = null;
      firstPlayable = null;
      streamsRequested = false;
      wantStreamFocus = true; // opening a title means watching it: land on the streams
      crumb.textContent = 'framed / media / ' + it.name;
      titleEl.textContent = it.name;
      metaEl.textContent = '';
      descEl.textContent = it.description || '';
      streamsEl.innerHTML = '';
      episodesEl.innerHTML = '';
      castEl.textContent = '';
      backdropEl.style.backgroundImage = 'none';
      posterEl.style.backgroundImage = it.poster ? 'url("' + String(it.poster).replace(/"/g, '') + '")' : 'none';
      paintMeta(it.raw || it);
      paintActions();
      setStatus('Loading…');
      F.nav.setScope(el, { remember: true }); // scope first: renderStreams may move focus to the streams when they land
      F.media.meta(cur.cat, it.id, function (m) {
        if (el.hidden) return;
        if (!m) { loadStreams(); return; }
        paintMeta(m);
        if (m.videos && m.videos.length) {
          episodes = m.videos.slice().sort(function (a, b) {
            return ((a.season || 0) - (b.season || 0)) || ((a.episode || 0) - (b.episode || 0));
          });
          // reopen a series where it was left: the episode holding the resume point
          var p = F.media.progressFor(it.type, it.id);
          selectedVideo = null;
          if (p && p.episodeId) {
            for (var i = 0; i < episodes.length; i++) if (episodes[i].id === p.episodeId) selectedVideo = episodes[i];
          }
          selectedVideo = selectedVideo || episodes[0];
          renderEpisodes();
          paintActions();
        }
        loadStreams();
      });
      // meta may never arrive (addon without the meta resource): streams must still load
      if (!cur.cat) loadStreams();
      else setTimeout(function () { if (!el.hidden && !streamsEl.children.length && !firstPlayable) loadStreams(); }, 1200);
    },
    back: function () {
      F.router.go('media');
      return true;
    }
  });
})(window.framed);

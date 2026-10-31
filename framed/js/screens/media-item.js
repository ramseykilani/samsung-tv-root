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
  var saveBtn = document.getElementById('md-save');
  var resumeBtn = document.getElementById('md-resume');
  var episodesEl = document.getElementById('md-episodes');
  var streamsEl = document.getElementById('md-streams');
  var statusEl = document.getElementById('md-status');

  var cur = null;            // { cat, item }
  var episodes = [];         // meta.videos, season/episode order
  var selectedVideo = null;  // episode object, or null for movies (streams key off the item id)
  var firstPlayable = null;
  var streamsRequested = false;

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
    metaEl.textContent = bits.join('  ·  ');
    if (m.description) descEl.textContent = m.description;
    if (m.poster) posterEl.style.backgroundImage = 'url("' + String(m.poster).replace(/"/g, '') + '")';
  }

  function paintActions() {
    if (!cur) return;
    var it = cur.item;
    saveBtn.textContent = F.media.isSaved(it.type, it.id) ? 'Saved to My List — remove' : 'Save to My List';
    var p = F.media.progressFor(it.type, it.id);
    resumeBtn.hidden = !p;
    if (p) resumeBtn.textContent = 'Resume from ' + fmt(p.pos) + (p.episodeLabel ? ' · ' + p.episodeLabel : '');
  }

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
      episodeLabel: selectedVideo ? episodeLabel(selectedVideo) : ''
    });
    F.router.go('media-play');
  }

  function episodeLabel(v) {
    var se = (v.season != null && v.episode != null) ? 'S' + v.season + ' E' + v.episode : '';
    return (se ? se + ' · ' : '') + (v.title || v.name || 'Episode');
  }

  function renderEpisodes() {
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
      sub.textContent = p && p.dur > 0 ? Math.round(p.pos / p.dur * 100) + '% watched' : (v.released ? String(v.released).slice(0, 10) : '');
      row.appendChild(name);
      row.appendChild(sub);
      row.addEventListener('click', function () { selectEpisode(v, true); });
      episodesEl.appendChild(row);
    });
  }

  function selectEpisode(v, focusStreams) {
    selectedVideo = v;
    streamsRequested = false;
    renderEpisodes();
    loadStreams();
    if (focusStreams) {
      var first = streamsEl.querySelector('[data-focusable]');
      if (first) F.nav.focus(first);
    }
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
    if (!streams.length) { setStatus('No streams reported. Add a stream addon in js/media.js.'); return; }
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
      sub.textContent = s.sub + (s.playable ? '' : (s.sub ? '  ·  ' : '') + 'not playable on TV');
      row.appendChild(name);
      row.appendChild(sub);
      row.addEventListener('click', function () {
        if (!s.playable) { F.toast("This source can't be played on the TV", 'error'); return; }
        playStream(s);
      });
      streamsEl.appendChild(row);
    });
    paintActions();
    // streams landed after enter()'s setScope — claim focus if the screen has none
    if (!F.nav.current()) F.nav.setScope(el, { remember: true });
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
      crumb.textContent = 'framed / media / ' + it.name;
      titleEl.textContent = it.name;
      metaEl.textContent = '';
      descEl.textContent = it.description || '';
      streamsEl.innerHTML = '';
      episodesEl.innerHTML = '';
      posterEl.style.backgroundImage = it.poster ? 'url("' + String(it.poster).replace(/"/g, '') + '")' : 'none';
      paintMeta(it.raw || it);
      paintActions();
      setStatus('Loading…');
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
      F.nav.setScope(el, { remember: true });
    },
    back: function () {
      F.router.go('media');
      return true;
    }
  });
})(window.framed);

/*
 * framed — Media detail screen: poster, title, meta, description and the stream list
 * reported by every stream-capable addon. OK on a playable stream → media-play;
 * OK on an unplayable source (remote-source, external) → quiet toast refusal.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media-item');
  var crumb = document.getElementById('md-crumb');
  var posterEl = document.getElementById('md-poster');
  var titleEl = document.getElementById('md-title');
  var metaEl = document.getElementById('md-meta');
  var descEl = document.getElementById('md-desc');
  var streamsEl = document.getElementById('md-streams');
  var statusEl = document.getElementById('md-status');

  function setStatus(t) { statusEl.textContent = t || ''; }

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

  function renderStreams(streams) {
    streamsEl.innerHTML = '';
    if (!streams.length) { setStatus('No streams reported.'); return; }
    setStatus('');
    streams.forEach(function (s) {
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
        F.media.start(s);
        F.router.go('media-play');
      });
      streamsEl.appendChild(row);
    });
  }

  F.router.register('media-item', {
    el: el,
    enter: function () {
      var cur = F.media.item();
      if (!cur) { F.router.go('media'); return; }
      var it = cur.item;
      crumb.textContent = 'framed / media / ' + it.name;
      titleEl.textContent = it.name;
      metaEl.textContent = '';
      descEl.textContent = it.description || '';
      streamsEl.innerHTML = '';
      posterEl.style.backgroundImage = it.poster ? 'url("' + String(it.poster).replace(/"/g, '') + '")' : 'none';
      paintMeta(it.raw || it);
      setStatus('Loading…');
      F.media.meta(cur.cat, it.id, function (m) { if (m && !el.hidden) paintMeta(m); });
      F.media.streams(it.type, it.id, function (ss) { if (!el.hidden) renderStreams(ss); });
      F.nav.setScope(el, { remember: true });
    },
    back: function () {
      F.router.go('media');
      return true;
    }
  });
})(window.framed);

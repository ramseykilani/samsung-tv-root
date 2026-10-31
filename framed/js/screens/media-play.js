/*
 * framed — Media playback screen: the TV's native HTML5 <video>, Stremio-style.
 *   OK / MediaPlayPause   play · pause (status shows position / duration)
 *   ◂ ▸                   seek −10 s / +30 s      ▴ ▾  ∓60 s
 *   Green / C             playback panel: speed, subtitles (embedded + addon
 *                         tracks, SRT converted to VTT), audio tracks, autoplay
 *   Back                  close panel first; else stop, keep the resume point
 * Position is written to "framed.watch" (throttled) and restored on entry.
 * Playing a title adds it to My List automatically, as Stremio's library does.
 * For series, the next episode is offered in the final minute and autoplays at
 * the end when enabled, preferring a stream from the same binge group.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media-play');
  var surface = document.getElementById('mp-surface');
  var video = document.getElementById('mp-video');
  var statusEl = document.getElementById('mp-status');
  var nextWrap = document.getElementById('mp-next');
  var nextBtn = document.getElementById('mp-next-btn');
  var panelEl = document.getElementById('mp-panel');
  var panelList = document.getElementById('mp-panel-list');

  var lastSaved = 0;   // media time at the last progress write
  var seeked = false;  // resume seek applied for this entry
  var panelOpen = false;
  var addonSubs = [];  // [{ lang, url, addon }]
  var subTrackEls = {}; // url -> <track> element once loaded
  var nextShown = false;

  function setStatus(t) { statusEl.textContent = t || ''; }
  function prefs() { return F.media.prefs(); }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function positionLine(prefix) {
    if (!video.duration) return prefix || '';
    return (prefix ? prefix + ' · ' : '') + fmt(video.currentTime) + ' / ' + fmt(video.duration);
  }

  function saveProgress(force) {
    if (!video.duration || !video.currentTime) return;
    if (!force && Math.abs(video.currentTime - lastSaved) < 5) return;
    lastSaved = video.currentTime;
    F.media.recordProgress(video.currentTime, video.duration);
  }

  function resumePoint() {
    var ctx = F.media.playingContext();
    if (!ctx || !ctx.item) return 0;
    var p = F.media.progressFor(ctx.item.type, ctx.episodeId || ctx.item.id);
    return p && p.dur > 0 ? p.pos : 0;
  }

  function toggle() {
    if (!video.getAttribute('src')) return;
    if (video.paused) {
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* surfaced by the error event */ });
    } else {
      video.pause();
      saveProgress(true);
      setStatus(positionLine('Paused'));
    }
  }

  function seek(delta) {
    if (!video.duration) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta));
    setStatus(positionLine(delta < 0 ? '−' + Math.abs(delta) + 's' : '+' + delta + 's'));
  }

  /* ---------- next episode ---------- */

  function nextEpisode() {
    var ctx = F.media.playingContext();
    if (!ctx || !ctx.episodes || !ctx.episodeId) return null;
    for (var i = 0; i < ctx.episodes.length - 1; i++) {
      if (ctx.episodes[i].id === ctx.episodeId) return ctx.episodes[i + 1];
    }
    return null;
  }

  function episodeLabel(v) {
    var se = (v.season != null && v.episode != null) ? 'S' + v.season + ' E' + v.episode : '';
    return (se ? se + ' · ' : '') + (v.title || v.name || 'Episode');
  }

  function showNext() {
    var next = nextEpisode();
    if (!next || nextShown) return;
    nextShown = true;
    nextBtn.textContent = 'Next episode: ' + episodeLabel(next);
    nextWrap.hidden = false;
    F.nav.focus(nextBtn); // the popup takes the cursor: OK starts it, anything else keeps watching
  }

  function playNext() {
    var next = nextEpisode();
    var ctx = F.media.playingContext();
    if (!next || !ctx) return;
    // choosing "next" means this one is done with, wherever the credits are
    F.media.setWatched(ctx.cat, ctx.item, ctx.episodeId || null, true);
    setStatus('Loading next episode…');
    F.media.streams(ctx.item.type, next.id, function (ss) {
      if (el.hidden) return;
      var current = F.media.playing();
      var binge = current && current.binge;
      var pick = null;
      ss.forEach(function (s) { if (!pick && s.playable && binge && s.binge === binge) pick = s; });
      if (!pick) ss.forEach(function (s) { if (!pick && s.playable) pick = s; });
      if (!pick) { setStatus('No playable stream for the next episode'); return; }
      F.media.start(pick, {
        cat: ctx.cat, item: ctx.item, episodes: ctx.episodes,
        episodeId: next.id, episodeLabel: episodeLabel(next), streamName: pick.name
      });
      startPlayback();
    });
  }

  nextBtn.addEventListener('click', function (e) { e.stopPropagation(); playNext(); });

  /* ---------- subtitles ---------- */

  function srtToVtt(text) {
    var body = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return 'WEBVTT\n\n' + body;
  }

  function disableAllSubs() {
    var tracks = video.textTracks;
    for (var i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
  }

  function applySubSize() {
    video.style.setProperty('--cue-size', prefs().subSize + '%');
  }

  function selectAddonSub(sub) {
    disableAllSubs();
    F.media.setPrefs({ subLang: sub.lang || '' });
    function show(track) { if (track) track.mode = 'showing'; setStatus(sub.lang ? 'Subtitles: ' + sub.lang : 'Subtitles on'); }
    var existing = subTrackEls[sub.url];
    if (existing) return show(existing.track);
    var trackEl = document.createElement('track');
    trackEl.kind = 'subtitles';
    trackEl.label = sub.lang || sub.addon || 'Subtitle';
    trackEl.srclang = String(sub.lang || 'en').slice(0, 2).toLowerCase() || 'en';
    function attach(src) {
      trackEl.src = src;
      video.appendChild(trackEl);
      subTrackEls[sub.url] = trackEl;
      // the track registers after load; flip it on then
      trackEl.addEventListener('load', function () { show(trackEl.track); });
      setTimeout(function () { show(trackEl.track); }, 350);
    }
    if (/\.srt($|\?)/i.test(sub.url)) {
      // <video> only speaks WebVTT: fetch the SRT and hand over a converted blob
      var xhr = new XMLHttpRequest();
      xhr.open('GET', sub.url, true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) attach(URL.createObjectURL(new Blob([srtToVtt(xhr.responseText)], { type: 'text/vtt' })));
        else setStatus('Subtitle file unreachable');
      };
      xhr.onerror = function () { setStatus('Subtitle file unreachable'); };
      xhr.send();
    } else attach(sub.url);
  }

  function autoSelectSub() {
    var lang = prefs().subLang;
    if (!lang) return;
    for (var i = 0; i < addonSubs.length; i++) {
      if (addonSubs[i].lang && addonSubs[i].lang.toLowerCase().indexOf(lang.toLowerCase()) === 0) { selectAddonSub(addonSubs[i]); return; }
    }
    var tracks = video.textTracks;
    for (var j = 0; j < tracks.length; j++) {
      if (tracks[j].language && tracks[j].language.toLowerCase().indexOf(lang.toLowerCase()) === 0) { disableAllSubs(); tracks[j].mode = 'showing'; return; }
    }
  }

  function loadSubtitles() {
    addonSubs = [];
    subTrackEls = {};
    // drop <track> elements from the previous video, or its subtitles (and the
    // auto-select language match) leak into whatever plays next
    var old = video.querySelectorAll('track');
    for (var i = 0; i < old.length; i++) {
      if (old[i].src && old[i].src.indexOf('blob:') === 0) { try { URL.revokeObjectURL(old[i].src); } catch (e) { /* ignore */ } }
      if (old[i].parentElement) old[i].parentElement.removeChild(old[i]);
    }
    var ctx = F.media.playingContext();
    if (!ctx || !ctx.item) return;
    F.media.subtitles(ctx.item.type, ctx.episodeId || ctx.item.id, function (subs) {
      addonSubs = subs || [];
      autoSelectSub();
    });
  }

  /* ---------- playback panel (speed / subs / audio / autoplay) ---------- */

  function panelRow(label, onOk, state) {
    var b = document.createElement('button');
    b.className = 'media-stream';
    b.setAttribute('data-focusable', '');
    b.setAttribute('tabindex', '-1');
    var n = document.createElement('span');
    n.className = 'media-stream__name';
    n.textContent = label;
    var s = document.createElement('span');
    s.className = 'media-stream__sub';
    s.textContent = state || '';
    b.appendChild(n);
    b.appendChild(s);
    b._label = label;
    b.addEventListener('click', function (e) { e.stopPropagation(); onOk(); });
    return b;
  }

  function panelHead(text) {
    var d = document.createElement('div');
    d.className = 'media-episodes__head';
    d.textContent = text;
    return d;
  }

  function buildPanel() {
    // rows that change a setting rebuild the panel (speed/size/autoplay): keep
    // the cursor on the same row instead of restarting at the top of the panel
    var prevLabel = null;
    if (document.activeElement && panelList.contains(document.activeElement)) prevLabel = document.activeElement._label;
    panelList.innerHTML = '';
    var p = prefs();
    panelList.appendChild(panelHead('Speed'));
    [0.5, 0.75, 1, 1.25, 1.5, 2].forEach(function (rate) {
      panelList.appendChild(panelRow(rate + '×', function () {
        video.playbackRate = rate;
        F.media.setPrefs({ speed: rate });
        setStatus('Speed ' + rate + '×');
        buildPanel();
      }, Math.abs(p.speed - rate) < 0.01 ? 'current' : ''));
    });
    panelList.appendChild(panelHead('Subtitles'));
    panelList.appendChild(panelRow('Off', function () { disableAllSubs(); F.media.setPrefs({ subLang: '' }); setStatus('Subtitles off'); }));
    var tracks = video.textTracks;
    var i;
    for (i = 0; i < tracks.length; i++) {
      (function (track) {
        if (track.kind !== 'subtitles' && track.kind !== 'captions') return;
        panelList.appendChild(panelRow('Embedded · ' + (track.label || track.language || 'track'), function () {
          disableAllSubs(); track.mode = 'showing'; F.media.setPrefs({ subLang: track.language || '' }); setStatus('Subtitles: ' + (track.label || track.language));
        }, track.mode === 'showing' ? 'current' : ''));
      })(tracks[i]);
    }
    addonSubs.forEach(function (sub) {
      panelList.appendChild(panelRow('Addon · ' + (sub.lang || '?') + ' (' + sub.addon + ')', function () { selectAddonSub(sub); }, ''));
    });
    panelList.appendChild(panelRow('Subtitle size: ' + p.subSize + '%', function () {
      var sizes = [75, 100, 125, 150, 200];
      var next = sizes[(sizes.indexOf(p.subSize) + 1) % sizes.length];
      F.media.setPrefs({ subSize: next });
      applySubSize();
      buildPanel();
      setStatus('Subtitle size ' + next + '%');
    }, 'OK cycles'));
    if (video.audioTracks && video.audioTracks.length > 1) {
      panelList.appendChild(panelHead('Audio'));
      for (i = 0; i < video.audioTracks.length; i++) {
        (function (track, idx) {
          panelList.appendChild(panelRow((track.label || track.language || 'Track ' + (idx + 1)), function () {
            for (var j = 0; j < video.audioTracks.length; j++) video.audioTracks[j].enabled = j === idx;
            setStatus('Audio: ' + (track.label || track.language || idx + 1));
          }, track.enabled ? 'current' : ''));
        })(video.audioTracks[i], i);
      }
    }
    panelList.appendChild(panelHead('Series'));
    panelList.appendChild(panelRow('Autoplay next episode', function () {
      F.media.setPrefs({ autoplayNext: !prefs().autoplayNext });
      buildPanel();
    }, p.autoplayNext ? 'on' : 'off'));
    // 'Subtitle size' rows change label as they cycle; match on the stable prefix
    if (prevLabel && (!document.activeElement || document.activeElement === document.body || !panelList.contains(document.activeElement))) {
      var rows = panelList.querySelectorAll('.media-stream');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i]._label === prevLabel || rows[i]._label.split(':')[0] === prevLabel.split(':')[0]) { F.nav.focus(rows[i]); break; }
      }
    }
  }

  function openPanel() {
    buildPanel();
    panelOpen = true;
    panelEl.hidden = false;
    F.nav.setScope(panelEl, { remember: false });
  }

  function closePanel() {
    panelOpen = false;
    panelEl.hidden = true;
    F.nav.setScope(el, { remember: false });
  }

  surface.addEventListener('click', function () { if (!panelOpen) toggle(); });

  video.addEventListener('loadedmetadata', function () {
    video.playbackRate = prefs().speed || 1;
    applySubSize();
    autoSelectSub();
    if (seeked) return;
    seeked = true;
    var pos = resumePoint();
    if (pos > 5 && video.duration && pos < video.duration - 10) {
      try { video.currentTime = pos; } catch (e) { /* engine not ready */ }
      setStatus('Resumed at ' + fmt(pos));
    }
  });
  video.addEventListener('playing', function () { setStatus(''); });
  video.addEventListener('waiting', function () { setStatus('Buffering…'); });
  video.addEventListener('timeupdate', function () {
    saveProgress(false);
    if (!nextShown && video.duration && video.duration - video.currentTime < 60) showNext();
  });
  video.addEventListener('pause', function () { saveProgress(true); });
  video.addEventListener('ended', function () {
    saveProgress(true);
    if (nextEpisode() && prefs().autoplayNext) playNext();
    else if (nextEpisode()) showNext();
    else setStatus('Ended');
  });
  video.addEventListener('error', function () {
    setStatus("Can't play this format on this TV");
  });

  function startPlayback() {
    var s = F.media.playing();
    if (!s || !s.url) { F.router.go('media-item'); return; }
    var ctx = F.media.playingContext();
    if (ctx && ctx.item) F.media.ensureSaved(ctx.cat, ctx.item); // Stremio: playing adds to the library
    seeked = false;
    nextShown = false;
    nextWrap.hidden = true;
    lastSaved = 0;
    setStatus('Loading ' + s.name + '…');
    video.setAttribute('src', s.url);
    video.load();
    loadSubtitles();
    var p = video.play();
    if (p && p.catch) p.catch(function () { setStatus('Press OK to play'); });
    F.nav.setScope(el, { remember: false });
  }

  F.router.register('media-play', {
    el: el,
    enter: startPlayback,
    leave: function () {
      saveProgress(true);
      panelOpen = false;
      panelEl.hidden = true;
      nextWrap.hidden = true;
      try { video.pause(); } catch (e) { /* ignore */ }
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* ignore */ }
      setStatus('');
    },
    back: function () {
      if (panelOpen) { closePanel(); return true; }
      saveProgress(true);
      F.router.go('media-item');
      return true;
    },
    onKey: function (e) {
      var name = e.key || '';
      if (panelOpen) {
        if (e.keyCode === 404 || name.toLowerCase() === 'c' || F.nav.isBackKey(e)) { closePanel(); return true; }
        return false; // arrows/OK drive the panel
      }
      if (e.keyCode === 404 || name.toLowerCase() === 'c') { openPanel(); return true; }
      if (name === 'MediaPlayPause' || e.keyCode === 10252) { toggle(); return true; }
      if (name === 'MediaPlay' || e.keyCode === 415) { if (video.paused) toggle(); return true; }
      if (name === 'MediaPause' || e.keyCode === 19) { if (!video.paused) toggle(); return true; }
      if (name === 'MediaStop' || e.keyCode === 413) { F.router.back(); return true; }
      if (nextShown && (name.toLowerCase() === 'n' || e.keyCode === 417)) { playNext(); return true; }
      if (name === 'MediaRewind' || e.keyCode === 412) { seek(-30); return true; }
      if (name === 'MediaFastForward' || e.keyCode === 417) { seek(30); return true; }
      if (e.keyCode === 37) { seek(-10); return true; }   // ◂
      if (e.keyCode === 39) { seek(30); return true; }    // ▸
      if (e.keyCode === 38) { seek(60); return true; }    // ▴
      if (e.keyCode === 40) { seek(-60); return true; }   // ▾
      return false;
    }
  });
})(window.framed);

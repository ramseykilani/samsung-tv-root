/*
 * framed — Media playback screen: the TV's native HTML5 <video>.
 *   OK / MediaPlayPause   play · pause (status shows position / duration)
 *   ◂ ▸                   seek −10 s / +30 s      ▴ ▾  ∓60 s
 *   Back                  stop, remember the resume point, return to detail
 * Position is written to "framed.watch" (throttled) and restored on entry, so a
 * title left mid-way reopens where it stopped. Streams the engine can't decode
 * land on a quiet "can't play this format" status line — never a crash.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media-play');
  var surface = document.getElementById('mp-surface');
  var video = document.getElementById('mp-video');
  var statusEl = document.getElementById('mp-status');

  var lastSaved = 0;   // seconds (media time) at the last progress write
  var seeked = false;  // resume seek applied for this entry

  function setStatus(t) { statusEl.textContent = t || ''; }

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

  surface.addEventListener('click', toggle);

  video.addEventListener('loadedmetadata', function () {
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
  video.addEventListener('timeupdate', function () { saveProgress(false); });
  video.addEventListener('pause', function () { saveProgress(true); });
  video.addEventListener('ended', function () { saveProgress(true); setStatus('Ended'); });
  video.addEventListener('error', function () {
    // MEDIA_ERR_SRC_NOT_SUPPORTED (4) covers most real cases on Tizen: HLS-in-<video>,
    // codec/container mismatches. Network (2) and decode (3) land here too.
    setStatus("Can't play this format on this TV");
  });

  F.router.register('media-play', {
    el: el,
    enter: function () {
      var s = F.media.playing();
      if (!s || !s.url) { F.router.go('media-item'); return; }
      seeked = false;
      lastSaved = 0;
      setStatus('Loading ' + s.name + '…');
      video.setAttribute('src', s.url);
      video.load();
      var p = video.play();
      if (p && p.catch) p.catch(function () { setStatus('Press OK to play'); });
      F.nav.setScope(el, { remember: false });
    },
    leave: function () {
      saveProgress(true);
      try { video.pause(); } catch (e) { /* ignore */ }
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* ignore */ }
      setStatus('');
    },
    back: function () {
      saveProgress(true);
      F.router.go('media-item');
      return true;
    },
    onKey: function (e) {
      var name = e.key || '';
      // Tizen media keys arrive by name; desktop browsers send MediaPlayPause etc. too
      if (name === 'MediaPlayPause' || e.keyCode === 10252) { toggle(); return true; }
      if (name === 'MediaPlay' || e.keyCode === 415) { if (video.paused) toggle(); return true; }
      if (name === 'MediaPause' || e.keyCode === 19) { if (!video.paused) toggle(); return true; }
      if (name === 'MediaStop' || e.keyCode === 413) { F.router.back(); return true; }
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

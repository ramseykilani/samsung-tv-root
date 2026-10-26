/*
 * framed — Media playback screen: the TV's native HTML5 <video>. OK toggles play/pause,
 * Back stops and returns to the detail screen. Streams the engine can't decode land on a
 * quiet "can't play this format" status line — never a crash.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media-play');
  var surface = document.getElementById('mp-surface');
  var video = document.getElementById('mp-video');
  var statusEl = document.getElementById('mp-status');

  function setStatus(t) { statusEl.textContent = t || ''; }

  function toggle() {
    if (!video.getAttribute('src')) return;
    if (video.paused) {
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* surfaced by the error event */ });
    } else {
      video.pause();
      setStatus('Paused');
    }
  }

  surface.addEventListener('click', toggle);

  video.addEventListener('playing', function () { setStatus(''); });
  video.addEventListener('waiting', function () { setStatus('Buffering…'); });
  video.addEventListener('ended', function () { setStatus('Ended'); });
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
      setStatus('Loading ' + s.name + '…');
      video.setAttribute('src', s.url);
      video.load();
      var p = video.play();
      if (p && p.catch) p.catch(function () { setStatus('Press OK to play'); });
      F.nav.setScope(el, { remember: false });
    },
    leave: function () {
      try { video.pause(); } catch (e) { /* ignore */ }
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* ignore */ }
      setStatus('');
    },
    back: function () {
      F.router.go('media-item');
      return true;
    }
  });
})(window.framed);

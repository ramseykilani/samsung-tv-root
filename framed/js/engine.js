/*
 * framed — playback engine seam.
 * On Tizen TVs, plain <video> can't decode AC3 / E-AC3 (DD+) — the file plays
 * silent. The Samsung AVPlay API (webapis.avplay) decodes them on the TV's own
 * hardware decoders and can enumerate and select audio tracks, so this file
 * prefers AVPlay whenever it exists and falls back to <video> everywhere else
 * (desktop dev, non-Tizen browsers).
 *
 * DTS / DTS-HD / TrueHD are NOT decoded by Samsung TVs since Tizen 7 (2023) —
 * neither <video> nor AVPlay plays them. AVPlay still wins there: it exposes
 * the file's other audio tracks so the Sound control (and an automatic pick at
 * start) can switch to a decodable one.
 *
 * The engine looks like the parts of <video> the player uses; for AVPlay it
 * re-dispatches the same DOM events on the (hidden) video element so the
 * player's state machine doesn't care which backend is live:
 *   loadedmetadata · play · playing · pause · waiting · timeupdate · ended · error
 * video.error is mirrored through eng.lastError() with normalized codes:
 *   2 network · 3 decode · 4 format · 0 other.
 */
window.framed = window.framed || {};
(function (F) {

  /* ---------- capability ---------- */

  function avplayAvailable() {
    return !!(window.webapis && window.webapis.avplay && window.tizen);
  }

  function emit(video, name) {
    try { video.dispatchEvent(new Event(name)); } catch (e) { /* older engines */ }
  }

  /* ---------- AVPlay error normalization ---------- */
  // avplay onerror eventType strings -> the <video>-style codes the veil already speaks.
  var AVP_ERR = {
    PLAYER_ERROR_CONNECTION_FAILED: 2, PLAYER_ERROR_GENEREIC: 0,
    PLAYER_ERROR_INVALID_URI: 4, PLAYER_ERROR_INVALID_STATE: 0,
    PLAYER_ERROR_NOT_SUPPORTED_CODEC: 3, PLAYER_ERROR_NOT_SUPPORTED_FORMAT: 4,
    PLAYER_ERROR_NOT_SUPPORTED_FILE: 4, PLAYER_ERROR_OPERATION_FAILED: 0,
    PLAYER_ERROR_SEEK_FAILED: 0, AVPLAY_ERROR_NETWORK_FAILED: 2
  };
  function avpErrCode(t) { return AVP_ERR.hasOwnProperty(t) ? AVP_ERR[t] : 0; }

  function parseTrackExtra(raw) {
    try { return JSON.parse(raw || '{}') || {}; } catch (e) { return {}; }
  }
  var DTS_RE = /\b(dts|dtse|dts-hd|dtshd|truehd|mlp)\b/i;
  function trackCodecName(info) {
    // extra_info fields vary by firmware: fourCC / codec / codec_type appear for audio
    return String(info.fourCC || info.codec || info.codec_type || info.bit_rate || '');
  }

  /* ---------- AVPlay backend ---------- */

  function AvplayBackend(video) {
    var av = window.webapis.avplay;
    var meta = false;          // READY seen (≈ loadedmetadata)
    var pausedFlag = true;
    var pendingRate = 1;
    var err = null;
    var timeMs = 0, durMs = 0;
    var tracks = null;         // [{index,label,lang,codec,enabled}]
    var dtsSwitched = false;
    var generation = 0, active = false, wantPlay = false;

    function refreshDuration() {
      try { var d = av.getDuration(); if (d > 0) durMs = d; } catch (e) { /* not ready */ }
    }
    function refreshTracks() {
      try {
        var all = av.getTotalTrackInfo() || [];
        var cur = {};
        try {
          var sel = av.getCurrentStreamInfo() || [];
          for (var i = 0; i < sel.length; i++) cur[sel[i].type + ':' + sel[i].index] = true;
        } catch (e) { /* firmware without getCurrentStreamInfo */ }
        tracks = [];
        for (var j = 0; j < all.length; j++) {
          if (all[j].type !== 'AUDIO') continue;
          var x = parseTrackExtra(all[j].extra_info);
          var codec = trackCodecName(x);
          tracks.push({
            index: all[j].index,
            lang: x.track_lang || x.language || '',
            codec: codec,
            label: (x.track_lang || x.language || codec || ('Track ' + tracks.length)),
            enabled: !!cur['AUDIO:' + all[j].index] || tracks.length === 0 && !Object.keys(cur).length
          });
        }
      } catch (e) { tracks = []; }
    }
    // prefer a track the TV can actually decode when the default is DTS-family
    function preferPlayableTrack() {
      if (dtsSwitched || !tracks || tracks.length < 2) return;
      dtsSwitched = true;
      var cur = tracks.filter(function (t) { return t.enabled; })[0] || tracks[0];
      if (!DTS_RE.test(cur.codec || cur.lang)) return;
      for (var i = 0; i < tracks.length; i++) {
        if (!DTS_RE.test(tracks[i].codec || '')) {
          try {
            av.setSelectTrack('AUDIO', tracks[i].index);
            for (var j = 0; j < tracks.length; j++) tracks[j].enabled = j === i;
            F.toast('Sound switched to a track this TV can decode — the file’s main track is DTS', 'ok');
          } catch (e) { /* keep the default */ }
          return;
        }
      }
      // every track is DTS-family: nothing AVPlay (or this TV) can decode
      F.toast('Every sound track in this file is DTS — this TV can’t decode DTS. Pick another source.', 'warn');
    }

    function fail(e, stage) {
      wantPlay = false; pausedFlag = true;
      err = { code: avpErrCode(String(e)), _avplay: stage + ': ' + String(e && e.name || e) };
      emit(video, 'error');
    }
    function startPlayback() {
      if (!active || !meta || !wantPlay || !pausedFlag || err) return;
      try {
        av.play();
        pausedFlag = false;
        // Audio selection and speed changes require PLAYING on Samsung TVs.
        refreshTracks(); preferPlayableTrack();
        if (pendingRate !== 1) try { av.setSpeed(pendingRate); } catch (e) { /* unsupported speed */ }
        emit(video, 'play'); emit(video, 'playing');
      } catch (e) { fail(e, 'play'); }
    }
    function close() {
      generation++; active = false; wantPlay = false;
      try { av.stop(); } catch (e) { /* idle */ }
      try { av.close(); } catch (e) { /* none */ }
      document.documentElement.removeAttribute('data-playback-engine');
      timeMs = 0; durMs = 0; meta = false; pausedFlag = true;
    }
    function makeListener(token) {
      function guard(fn) {
        return function (value) { if (active && token === generation && !err) fn(value); };
      }
      return {
        onbufferingstart: guard(function () { emit(video, 'waiting'); }),
        onbufferingprogress: function () {},
        onbufferingcomplete: guard(function () {
          refreshDuration();
          // Initial buffering may complete before prepareAsync succeeds.
          if (meta && !pausedFlag) emit(video, 'playing');
        }),
        onstreamcompleted: guard(function () { pausedFlag = true; wantPlay = false; emit(video, 'ended'); }),
        oncurrentplaytime: guard(function (ms) { timeMs = ms; emit(video, 'timeupdate'); }),
        onerror: guard(function (type) { fail(type, 'event'); }),
        onevent: function () {}, onsubtitlechange: function () {}, ondrmevent: function () {}
      };
    }

    return {
      kind: 'avplay',
      open: function (url) {
        close();
        active = true;
        err = null; tracks = null; dtsSwitched = false; pendingRate = 1;
        var token = generation;
        document.documentElement.setAttribute('data-playback-engine', 'avplay');
        function prepared() {
          if (!active || token !== generation || err) return;
          refreshDuration(); refreshTracks();
          meta = true;
          emit(video, 'loadedmetadata');
          startPlayback();
        }
        try {
          av.open(url);
          av.setListener(makeListener(token));
          av.setDisplayRect(0, 0, 1920, 1080);
          try { av.setDisplayMethod('PLAYER_DISP_MODE_LETTER_BOX'); } catch (e) { /* optional */ }
          try { av.setSilentSubtitle(true); } catch (e) { /* own cues */ }
          if (typeof av.prepareAsync === 'function') {
            av.prepareAsync(prepared, function (e) {
              if (active && token === generation) fail(e, 'prepare');
            });
          } else {
            av.prepare(); prepared();
          }
        } catch (e) { fail(e, 'open/prepare'); }
      },
      close: close,
      play: function () { wantPlay = true; startPlayback(); },
      pause: function () {
        wantPlay = false;
        if (!meta || pausedFlag) return;
        try { av.pause(); pausedFlag = true; emit(video, 'pause'); } catch (e) { fail(e, 'pause'); }
      },
      paused: function () { return pausedFlag; },
      hasMeta: function () { return meta; },
      seek: function (sec) { try { av.seekTo(Math.round(sec * 1000)); } catch (e) { /* out of range */ } },
      time: function () { return timeMs / 1000; },
      duration: function () { return durMs / 1000; },
      bufferedEnd: function () { return null; }, // AVPlay exposes no buffered range
      setRate: function (r) {
        pendingRate = r;
        try { if (!pausedFlag) av.setSpeed(r); } catch (e) { /* normal playback is 1× anyway */ }
      },
      rate: function () { try { var s = av.getSpeed && av.getSpeed(); return s || pendingRate; } catch (e) { return pendingRate; } },
      audioTracks: function () { if (tracks === null) refreshTracks(); return tracks; },
      selectAudio: function (i) {
        if (!tracks || !tracks[i]) return false;
        try { av.setSelectTrack('AUDIO', tracks[i].index); } catch (e) { return false; }
        for (var j = 0; j < tracks.length; j++) tracks[j].enabled = j === i;
        return true;
      },
      lastError: function () { return err; }
    };
  }

  /* ---------- HTML5 <video> backend ---------- */

  function VideoBackend(video) {
    return {
      kind: 'video',
      open: function (url) { video.src = url; try { video.load(); } catch (e) { /* ignore */ } },
      close: function () {
        try { video.pause(); } catch (e) { /* ignore */ }
        video.removeAttribute('src');
        try { video.load(); } catch (e) { /* ignore */ }
      },
      play: function () { var p = video.play(); if (p && p.catch) p.catch(function () {}); },
      pause: function () { try { video.pause(); } catch (e) { /* ignore */ } },
      paused: function () { return video.paused; },
      hasMeta: function () { return video.readyState > 0; },
      seek: function (sec) { try { video.currentTime = sec; } catch (e) { /* out of range */ } },
      time: function () { return video.currentTime || 0; },
      duration: function () { return isFinite(video.duration) && video.duration > 0 ? video.duration : 0; },
      bufferedEnd: function () {
        try { var b = video.buffered; return b.length ? b.end(b.length - 1) : 0; } catch (e) { return 0; }
      },
      setRate: function (r) { video.playbackRate = r; },
      rate: function () { return video.playbackRate || 1; },
      audioTracks: function () {
        var t = video.audioTracks;
        if (t === undefined) return undefined;
        var out = [];
        for (var i = 0; i < t.length; i++) out.push({ label: t[i].label || t[i].language || ('Track ' + (i + 1)), lang: t[i].language || '', codec: '', enabled: t[i].enabled });
        return out;
      },
      selectAudio: function (i) {
        var t = video.audioTracks;
        if (!t || !t[i]) return false;
        try {
          for (var j = 0; j < t.length; j++) t[j].enabled = j === i;
        } catch (e) { return false; }
        return !!t[i].enabled;
      },
      lastError: function () { return video.error; }
    };
  }

  /* ---------- cue parsing + DOM overlay ---------- */
  // AVPlay draws video on a plane behind the page, so <track> can't render cues;
  // addon subtitles are fetched and shown in .player__subs instead.

  function parseTime(s) {
    var m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s || '');
    if (!m) return -1;
    return (+m[1] || 0) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / (m[4].length === 3 ? 1000 : Math.pow(10, m[4].length));
  }
  // tolerant SRT/VTT block parser -> [{ start, end, text }] (text sanitized to plain lines)
  function parseCues(text) {
    var cues = [];
    var blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split('\n');
      var ti = -1;
      for (var j = 0; j < lines.length && j < 3; j++) {
        if (lines[j].indexOf('-->') !== -1) { ti = j; break; }
      }
      if (ti < 0) continue;
      var seg = lines[ti].split('-->');
      var start = parseTime(seg[0]), end = parseTime(seg[1]);
      if (start < 0 || end < 0) continue;
      var textLines = lines.slice(ti + 1).map(function (l) { return l.replace(/<[^>]+>/g, '').trim(); })
        .filter(function (l) { return l; });
      if (textLines.length) cues.push({ start: start, end: end, text: textLines.join('\n') });
    }
    cues.sort(function (a, b) { return a.start - b.start; });
    return cues;
  }

  function CueOverlay(el) {
    var cues = null, active = -1;
    function paint(t) {
      if (!cues) return;
      var found = -1;
      for (var i = 0; i < cues.length; i++) {
        if (cues[i].start > t) break;
        if (t < cues[i].end) { found = i; break; }
      }
      if (found === active) return;
      active = found;
      if (found < 0) { el.textContent = ''; return; }
      var lines = cues[found].text.split('\n');
      el.innerHTML = '';
      for (var k = 0; k < lines.length; k++) {
        var d = document.createElement('div');
        d.className = 'player__sub-line';
        d.textContent = lines[k];
        el.appendChild(d);
      }
    }
    return {
      setCues: function (list) { cues = list; active = -1; if (!list) el.textContent = ''; },
      tick: function (t) { paint(t); },
      clear: function () { cues = null; active = -1; el.textContent = ''; }
    };
  }

  /* ---------- public ---------- */

  F.engine = {
    attach: function (video) {
      return avplayAvailable() ? AvplayBackend(video) : VideoBackend(video);
    },
    parseCues: parseCues,
    cueOverlay: CueOverlay,
    avplayAvailable: avplayAvailable
  };
})(window.framed);

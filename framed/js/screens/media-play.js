/*
 * framed — Playback screen, design pass-2 contract.
 * The .player root carries the machine as data-* attributes:
 *   data-state  starting | playing | paused | buffering | ended | refused
 *   data-chrome shown | hidden          (the band; opacity only, focus survives)
 *   data-scrub  idle | active           (timeline preview vs committed position)
 *   data-slow   false | true            (start took > --fr-slow-start)
 *   data-panel  open | closed           (options drawer)
 *   data-upnext none | offered | counting | missing
 * This file owns the machine and every timer; lengths come from theme.css vars.
 * Focus order: timeline (cursor home) -> strip acts -> upnext acts -> veil acts
 * -> drawer rows. The surface itself is never focusable.
 */
window.framed = window.framed || {};
(function (F) {
  var root = document.getElementById('mp');
  var video = document.getElementById('mp-video');
  // AVPlay on Tizen (hardware decode of AC3/E-AC3), <video> everywhere else.
  var eng = F.engine.attach(video);
  root.setAttribute('data-engine', eng.kind);
  var subsOverlayEl = document.getElementById('mp-subtitles');
  var cueOverlay = subsOverlayEl ? F.engine.cueOverlay(subsOverlayEl) : null;
  var titleEl = document.getElementById('mp-title');
  var epEl = document.getElementById('mp-ep');
  var clockEl = document.getElementById('mp-clock');
  var stateEl = document.getElementById('mp-state');
  var nowEl = document.getElementById('mp-now');
  var durEl = document.getElementById('mp-dur');
  var timeline = document.getElementById('mp-timeline');
  var bufferedEl = document.getElementById('mp-buffered');
  var playedEl = document.getElementById('mp-played');
  var spanEl = document.getElementById('mp-span');
  var previewEl = document.getElementById('mp-preview');
  var tipEl = document.getElementById('mp-tip');
  var tipDeltaEl = document.getElementById('mp-tip-delta');
  var headEl = document.getElementById('mp-head');
  var exitBtn = document.getElementById('mp-exit');
  var subsBtn = document.getElementById('mp-subs');
  var speedBtn = document.getElementById('mp-speed');
  var soundBtn = document.getElementById('mp-sound');
  var optionsBtn = document.getElementById('mp-options');
  var panelMenu = 'options';
  var nextBtn = document.getElementById('mp-next');
  var legendEl = document.getElementById('mp-legend');
  var veilEl = document.getElementById('mp-veil');
  var veilKicker = document.getElementById('mp-veil-kicker');
  var veilTitle = document.getElementById('mp-veil-title');
  var veilSub = document.getElementById('mp-veil-sub');
  var veilWait = document.getElementById('mp-veil-wait');
  var veilMsg = document.getElementById('mp-veil-msg');
  var veilCause = document.getElementById('mp-veil-cause');
  var veilSlow = document.getElementById('mp-veil-slowcause');
  var veilGo = document.getElementById('mp-veil-go');
  var veilAlt = document.getElementById('mp-veil-alt');
  var veilLegend = document.getElementById('mp-veil-legend');
  var upnextTitle = document.getElementById('mp-upnext-title');
  var upnextWords = document.getElementById('mp-upnext-words');
  var upnextFill = document.getElementById('mp-upnext-fill');
  var upnextGo = document.getElementById('mp-upnext-go');
  var upnextStay = document.getElementById('mp-upnext-stay');
  var panelEl = document.getElementById('mp-panel');
  var grpSeries = document.getElementById('mp-grp-series');

  var ctx = null;                 // F.media.playingContext()
  var stream = null;              // F.media.playing()
  var addonSubs = [];             // raw subtitle resources
  var subFiles = {};              // lang -> [sub,...]
  var subLangs = [];              // deduped language list
  var subLang = '';               // '' = off
  var subDelay = 0;              // seconds; positive delays captions, reset per video
  var subUrl = null;              // chosen file within lang
  var subTrackEls = {};           // url -> <track> element
  var nextEp = null;              // following meta.video
  var altStream = null;           // another playable source for the refused veil
  var silentWarned = false;

  var state = 'starting';
  var chrome = 'shown';
  var scrub = 'idle';
  var scrubTarget = 0;
  var scrubStepIdx = 0;
  var SCRUB_STEPS = [10, 30, 60, 120];
  var panel = 'closed';
  var panelReturnFocus = null;
  var upnext = 'none';
  var upnextLeft = 0;

  var hideTimer = 0, settleTimer = 0, slowTimer = 0, stallTimer = 0, upnextTimer = 0, saveTimer = 0, clockTimer = 0;

  function attr(k, v) { root.setAttribute('data-' + k, v); }
  function themeMs(name, dflt) {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    if (isNaN(v)) return dflt;
    return v > 50 ? v : v * 1000; // accept both '8s' and '8000'
  }
  function prefs() { return F.media.prefs(); }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function clear(name) { clearTimeout(name); }
  function dur() { return eng.duration(); }
  function pct(t) { var d = dur(); return d ? Math.min(100, Math.max(0, t / d * 100)) : 0; }

  /* ---------- chrome ---------- */

  function showChrome() {
    clear(hideTimer); hideTimer = 0;
    if (chrome !== 'shown') { chrome = 'shown'; attr('chrome', 'shown'); liftCues(); }
    paintLine();
    // linger only while actually playing: a paused or scrubbing band stays
    if (state === 'playing' && scrub === 'idle' && panel === 'closed' && upnext === 'none') {
      hideTimer = setTimeout(hideChrome, themeMs('--fr-chrome-linger', 5000));
    }
  }
  function hideChrome(force) {
    clear(hideTimer); hideTimer = 0;
    if ((!force && state !== 'playing') || panel === 'open' || scrub === 'active') return;
    if (chrome === 'hidden') return;
    chrome = 'hidden'; attr('chrome', 'hidden');
    lowerCues();
  }
  function chromeOn() { return chrome === 'shown'; }

  /* ---------- line / legend ---------- */

  var STATE_WORDS = { starting: 'Opening', playing: 'Playing', paused: 'Paused', buffering: 'Buffering', ended: '', refused: '' };
  function paintLine() {
    stateEl.textContent = chromeOn() ? (STATE_WORDS[state] || '') : '';
    nextBtn.hidden = !nextEp;
    var legend;
    if (scrub === 'active') legend = '<span class="legend__item"><span class="key">OK</span> Jump</span><span class="legend__item"><span class="key">Back</span> Cancel</span>';
    else if (!chromeOn()) legend = '<span class="legend__item"><span class="key">OK</span> Pause</span><span class="legend__item"><span class="key">◂ ▸</span> Skip</span>';
    else if (document.activeElement === timeline) legend = '<span class="legend__item"><span class="key">OK</span> ' + (eng.paused() ? 'Play' : 'Pause') + '</span><span class="legend__item"><span class="key">◂ ▸</span> ±10 s · hold skips farther</span><span class="legend__item"><span class="key">▾</span> Options</span>';
    else legend = '<span class="legend__item"><span class="key">OK</span> Choose</span><span class="legend__item"><span class="key">▴</span> Timeline</span>';
    if (scrub !== 'active') legend += '<span class="legend__item"><span class="key">Back</span> Exit player</span>';
    legendEl.innerHTML = legend;
  }

  /* ---------- timeline ---------- */

  function paintTimeline() {
    var d = dur(), t = eng.time();
    nowEl.textContent = fmt(scrub === 'active' ? scrubTarget : t);
    durEl.textContent = fmt(d);
    var p = pct(t);
    playedEl.style.width = p + '%';
    spanEl.style.left = p + '%';
    headEl.style.left = p + '%';
    var b = eng.bufferedEnd();
    bufferedEl.style.width = (b ? pct(b) : 0) + '%';
    if (scrub === 'active') {
      previewEl.style.left = pct(scrubTarget) + '%';
      spanEl.style.left = Math.min(p, pct(scrubTarget)) + '%';
      spanEl.style.width = Math.abs(pct(scrubTarget) - p) + '%';
      tipEl.style.left = pct(scrubTarget) + '%';
      var delta = Math.round(scrubTarget - t);
      tipDeltaEl.textContent = (delta >= 0 ? '+' : '−') + fmt(Math.abs(delta));
    }
    var d2 = dur();
    timeline.setAttribute('aria-valuemax', String(Math.floor(d2)));
    timeline.setAttribute('aria-valuenow', String(Math.floor(t)));
    timeline.setAttribute('aria-valuetext', fmt(t) + ' of ' + fmt(d2));
    var end = new Date(Date.now() + (d - t) * 1000);
    clockEl.textContent = new Date().toTimeString().slice(0, 5) + ' · ends ' + end.toTimeString().slice(0, 5);
  }

  function scrubStep(dir, fast) {
    if (state === 'refused' || state === 'ended') return;
    showChrome();
    if (scrub !== 'active') {
      scrub = 'active'; attr('scrub', 'active');
      scrubTarget = eng.time();
      scrubStepIdx = 0;
    } else if (fast) scrubStepIdx = Math.min(scrubStepIdx + 1, SCRUB_STEPS.length - 1);
    var step = SCRUB_STEPS[fast ? scrubStepIdx : 0];
    scrubTarget = Math.max(0, Math.min(dur() || scrubTarget + step, scrubTarget + dir * step));
    clear(settleTimer);
    settleTimer = setTimeout(commitScrub, themeMs('--fr-scrub-settle', 800));
    paintTimeline(); paintLine();
  }
  function commitScrub() {
    clear(settleTimer);
    if (scrub !== 'active') return;
    scrub = 'idle'; attr('scrub', 'idle');
    eng.seek(scrubTarget);
    paintTimeline(); paintLine(); showChrome();
  }
  function cancelScrub() {
    clear(settleTimer);
    if (scrub !== 'active') return false;
    scrub = 'idle'; attr('scrub', 'idle');
    paintTimeline(); paintLine();
    return true;
  }

  timeline.addEventListener('framed:adjust', function (e) { scrubStep(e.detail.delta, e.detail.fast); });
  timeline.addEventListener('click', function () { toggle(); });
  timeline.addEventListener('focus', paintLine);
  timeline.addEventListener('blur', paintLine);

  /* ---------- veil ---------- */

  function paintVeil(kind) {
    var t = ctx && ctx.item ? ctx.item.name : '';
    var se = ctx && ctx.episodeLabel ? ctx.episodeLabel : '';
    veilWait.hidden = true; veilMsg.hidden = false; veilCause.hidden = true;
    veilSlow.parentElement.hidden = true;
    veilGo.hidden = true; veilAlt.hidden = true; veilActsOn = false;
    veilLegend.innerHTML = '<span class="legend__item"><span class="key">Back</span> Back to the detail</span>';
    if (kind === 'starting') {
      veilKicker.textContent = 'Starting';
      veilTitle.textContent = t; veilSub.textContent = se;
      veilWait.hidden = false;
      veilMsg.textContent = 'Getting the stream ready…';
      if (root.getAttribute('data-slow') === 'true') {
        veilSlow.parentElement.hidden = false;
        veilSlow.textContent = 'This stream is taking a while. Still trying.';
      }
    } else if (kind === 'stalled') {
      veilKicker.textContent = 'Still waiting';
      veilTitle.textContent = t; veilSub.textContent = se;
      veilWait.hidden = false;
      veilMsg.textContent = 'This source has stopped answering.';
      veilCause.hidden = false;
      veilCause.textContent = 'The TV is holding this connection open, but the source is silent.';
      veilActsOn = true;
      veilGo.hidden = false; veilGo.querySelector('.act__name').textContent = 'Back to the sources';
      veilGo.querySelector('.act__value').textContent = '';
      veilAlt.hidden = false; veilAlt.querySelector('.act__name').textContent = 'Keep waiting';
    } else if (kind === 'refused') {
      veilKicker.textContent = 'This source can’t play';
      veilTitle.textContent = t; veilSub.textContent = se;
      var err = eng.lastError();
      var code = err && typeof err.code === 'number' ? err.code : 0;
      var msg = 'The TV’s player refused this link.', cause = '';
      if (code === 2) { msg = 'The video data never arrived.'; cause = 'The host may be down or the link has expired.'; }
      else if (code === 3) {
        msg = 'This TV can’t decode the video or sound in this file.';
        cause = stream && stream.dts ? 'The file’s sound is DTS — Samsung TVs don’t decode DTS. Pick a source without that flag.' : '';
      }
      else if (code === 4) msg = 'This file’s format isn’t one the TV can read.';
      veilMsg.textContent = msg;
      if (cause) { veilCause.hidden = false; veilCause.textContent = cause; }
      veilActsOn = true;
      veilGo.hidden = false; veilGo.querySelector('.act__name').textContent = 'Back to the sources';
      veilGo.querySelector('.act__value').textContent = '';
      if (altStream) { veilAlt.hidden = false; veilAlt.querySelector('.act__name').textContent = 'Try the next source'; }
    } else if (kind === 'ended') {
      veilKicker.textContent = 'Finished';
      veilTitle.textContent = t; veilSub.textContent = se;
      veilMsg.textContent = nextEp ? 'The next episode is ' + epLabel(nextEp) + '.' : 'That’s the end.';
      veilActsOn = true;
      veilGo.hidden = false; veilGo.querySelector('.act__name').textContent = nextEp ? 'Play the next episode' : 'Back to the detail';
      veilGo.querySelector('.act__value').textContent = '';
      if (nextEp) { veilAlt.hidden = false; veilAlt.querySelector('.act__name').textContent = 'Back to the detail'; }
    }
  }
  var veilActsOn = false;

  veilGo.addEventListener('click', function () {
    if (state === 'ended' && nextEp) { playNext(); return; }
    if ((state === 'starting' || state === 'buffering') && eng.paused() && eng.hasMeta()) { eng.play(); return; }
    F.router.back(); // refused / stalled / ended-without-next all land on the detail
  });
  veilAlt.addEventListener('click', function () {
    if (state === 'ended') { F.router.back(); return; }
    if (state === 'refused' && altStream) { startStream(altStream); return; }
    if (state === 'buffering') { // keep waiting
      attr('slow', 'false');
      stallTimer = setTimeout(function () { if (state === 'buffering' || state === 'starting') paintVeil('stalled'); }, themeMs('--fr-stall', 20000));
      paintVeil('starting');
      slowTimer = setTimeout(function () { attr('slow', 'true'); paintVeil('starting'); }, themeMs('--fr-slow-start', 8000));
    }
  });

  /* ---------- state ---------- */

  function setState(s) {
    if (state === s) return;
    state = s;
    attr('state', s);
    if (s === 'starting') { attr('slow', 'false'); paintVeil('starting'); showChrome(); }
    if (s === 'refused') { attr('slow', 'false'); paintVeil('refused'); chromeShowForce(); focusFirstVeil(); }
    if (s === 'buffering') {
      showChrome();
      clear(stallTimer);
      stallTimer = setTimeout(function () { if (state === 'buffering') paintVeil('stalled'); }, themeMs('--fr-stall', 20000));
    } else clear(stallTimer);
    if (s === 'ended') { paintVeil('ended'); chromeShowForce(); focusFirstVeil(); }
    if (s === 'paused' || s === 'playing') showChrome();
    if (s === 'paused') clear(hideTimer);
    paintLine();
  }
  function chromeShowForce() { chrome = 'hidden'; hideTimer = 0; showChrome(); }
  function focusFirstVeil() {
    if (!veilGo.hidden) F.nav.focus(veilGo);
  }

  video.addEventListener('play', function () { if (state !== 'refused') setState('playing'); });
  video.addEventListener('playing', function () { if (state !== 'refused') setState('playing'); restoreAudioLanguage(); silentCheck(); });
  video.addEventListener('pause', function () { if (state === 'playing' || state === 'buffering') setState('paused'); });
  video.addEventListener('waiting', function () { if (state === 'playing' || state === 'paused') setState('buffering'); });
  video.addEventListener('seeked', function () {
    if (state !== 'refused' && state !== 'ended') setState(eng.paused() ? 'paused' : 'playing');
    paintTimeline(); paintLine();
  });
  video.addEventListener('timeupdate', function () {
    if (cueOverlay) cueOverlay.tick(eng.time() - subDelay);
    paintTimeline();
    maybeUpnext();
  });
  video.addEventListener('ended', function () {
    var behavior = prefs().endBehavior;
    saveProgress();
    closePanel();
    stopUpnext();
    if (behavior === 'art' || behavior === 'detail') { exitPlayer(behavior === 'art' ? 'art' : 'media-item'); return; }
    if (behavior === 'auto' && nextEp) { playNext(); return; }
    setState('ended');
  });
  video.addEventListener('error', function () {
    if (stream) setState('refused');
  });
  document.addEventListener('visibilitychange', saveProgress);

  /* ---------- play / pause / next ---------- */

  function toggle() {
    if (eng.paused()) eng.play();
    else eng.pause();
  }
  exitBtn.addEventListener('click', function () { exitPlayer(); });

  function playNext() {
    if (!nextEp) return;
    var ep = nextEp;
    stopUpnext();
    var wantId = ep.id;
    F.media.streams(ctx.item.type, wantId, function (ss) {
      var playable = (ss || []).filter(function (s) { return s.playable; });
      var ready = playable.filter(function (s) { return s.ready; })[0];
      var pick = ready || playable[0];
      if (!pick) {
        attr('upnext', 'missing');
        upnext = 'missing';
        return;
      }
      F.media.start(pick, {
        cat: ctx.cat, item: ctx.item, episodeId: wantId,
        episodeLabel: (ep.season != null && ep.episode != null ? 'S' + ep.season + ' · E' + ep.episode + ' · ' : '') + (ep.title || ep.name || 'Episode'),
        episodes: ctx.episodes, streamName: pick.name
      });
      ctx = F.media.playingContext();
      nextEp = null;
      for (var i = 0; ctx.episodes && i < ctx.episodes.length - 1; i++) {
        if (ctx.episodes[i].id === wantId) { nextEp = ctx.episodes[i + 1]; break; }
      }
      startStream(pick);
    });
  }
  nextBtn.addEventListener('click', playNext);

  /* ---------- up next ---------- */

  function maybeUpnext() {
    if (!nextEp || upnext !== 'none' || panel === 'open' || (prefs().endBehavior !== 'auto' && prefs().endBehavior !== 'ask')) return;
    var d = dur(); if (!d) return;
    var left = d - eng.time();
    if (left > 45 || state !== 'playing') return;
    offerUpnext();
  }
  function offerUpnext() {
    if (!nextEp) return;
    upnextTitle.textContent = epLabel(nextEp);
    upnext = 'offered'; attr('upnext', 'offered');
    upnextWords.textContent = prefs().endBehavior === 'auto' ? 'Plays when this ends' : 'Choose Play now, or decide when this ends';
    showChrome();
    var cur = F.nav.current();
    if (cur === timeline || document.activeElement === timeline) F.nav.focus(upnextGo);
    paintLine();
  }
  function epLabel(v) {
    var se = (v.season != null && v.episode != null) ? 'S' + v.season + ' · E' + v.episode + ' · ' : '';
    return se + (v.title || v.name || 'Episode');
  }
  function stopUpnext() {
    clearInterval(upnextTimer); upnextTimer = 0;
    upnext = 'none'; attr('upnext', 'none');
    paintLine();
  }
  upnextGo.addEventListener('click', playNext);
  upnextStay.addEventListener('click', function () { stopUpnext(); F.nav.focus(timeline); });

  /* ---------- subtitles ---------- */

  function srtToVtt(text) {
    var body = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return 'WEBVTT\n\n' + body;
  }
  function disableAllSubs() {
    if (cueOverlay) cueOverlay.clear();
    var tracks = video.textTracks;
    for (var i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
  }
  function applySubTiming() {
    var tracks = video.textTracks;
    for (var i = 0; i < tracks.length; i++) {
      var cues = tracks[i].cues;
      if (!cues) continue;
      for (var j = 0; j < cues.length; j++) {
        var cue = cues[j];
        if (cue._frStart === undefined) { cue._frStart = cue.startTime; cue._frEnd = cue.endTime; }
        cue.startTime = cue._frStart + subDelay;
        cue.endTime = cue._frEnd + subDelay;
      }
    }
    if (cueOverlay) cueOverlay.tick(eng.time() - subDelay);
  }
  function applySubSize() {
    video.style.setProperty('--cue-size', prefs().subSize + '%');
    if (subsOverlayEl) subsOverlayEl.style.fontSize = (28 * prefs().subSize / 100) + 'px';
  }
  function groupSubs() {
    subFiles = {}; subLangs = [];
    addonSubs.forEach(function (s) {
      var lang = (s.lang || 'und');
      if (!subFiles[lang]) { subFiles[lang] = []; subLangs.push(lang); }
      subFiles[lang].push(s);
    });
  }
  function selectAddonSub(sub) {
    disableAllSubs();
    subUrl = sub.url;
    if (eng.kind === 'avplay') {
      // AVPlay draws video on a plane behind the page — <track> can't render;
      // fetch the file ourselves and paint cues into .player__subs.
      var subXhr = new XMLHttpRequest();
      subXhr.open('GET', sub.url, true);
      subXhr.onload = function () {
        if (subXhr.status >= 200 && subXhr.status < 300 && cueOverlay) {
          cueOverlay.setCues(F.engine.parseCues(subXhr.responseText));
          cueOverlay.tick(eng.time() - subDelay);
          liftCues();
        } else F.toast('That subtitle file didn’t load', 'warn');
      };
      subXhr.onerror = function () { F.toast('That subtitle file didn’t load', 'warn'); };
      subXhr.send();
      return;
    }
    function show(track) { if (track) { track.mode = 'showing'; applySubTiming(); liftCues(); } }
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
      trackEl.addEventListener('load', function () { show(trackEl.track); });
      setTimeout(function () { show(trackEl.track); }, 350);
    }
    if (/\.srt($|\?)/i.test(sub.url)) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', sub.url, true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) attach(URL.createObjectURL(new Blob([srtToVtt(xhr.responseText)], { type: 'text/vtt' })));
        else F.toast('That subtitle file didn’t load', 'warn');
      };
      xhr.onerror = function () { F.toast('That subtitle file didn’t load', 'warn'); };
      xhr.send();
    } else attach(sub.url);
  }
  function pickLang(lang) {
    subLang = lang;
    F.media.setPrefs({ subLang: lang });
    if (!lang) { disableAllSubs(); subsBtn.querySelector('.act__value').textContent = 'Off'; refreshDrawer(); return; }
    var files = subFiles[lang] || [];
    if (files.length) selectAddonSub(subUrl && subFiles[lang].some(function (s) { return s.url === subUrl; }) ? { url: subUrl, lang: lang } : files[0]);
    subsBtn.querySelector('.act__value').textContent = lang;
    refreshDrawer();
  }
  function loadSubtitles() {
    subDelay = 0; subTrackEls = {};
    addonSubs = []; subFiles = {}; subLangs = []; subUrl = null; subLang = '';
    if (cueOverlay) cueOverlay.clear();
    var old = video.querySelectorAll('track');
    for (var i = 0; i < old.length; i++) {
      if (old[i].src && old[i].src.indexOf('blob:') === 0) { try { URL.revokeObjectURL(old[i].src); } catch (e) { /* ignore */ } }
      if (old[i].parentElement) old[i].parentElement.removeChild(old[i]);
    }
    if (!ctx || !ctx.item) { refreshDrawer(); return; }
    if (ctl.subs) ctl.subs.setNote('lang', 'Asking your subtitle addons…');
    F.media.subtitles(ctx.item.type, ctx.episodeId || ctx.item.id, function (subs) {
      if (el.hidden) return;
      addonSubs = subs || [];
      groupSubs();
      refreshDrawer();
      var want = prefs().subLang;
      if (want && subFiles[want]) pickLang(want);
      else if (want && subLangs.length) pickLang(subLangs[0]);
    });
  }

  /* ---------- subtitle position ---------- */
  function subPosition() {
    var value = prefs().subPosition;
    return typeof value === 'number' && isFinite(value) ? Math.max(0, Math.min(80, value)) : 6;
  }
  // Keep captions above the controls, then return to the saved position.
  function liftCues() { applySubPosition(); }
  function lowerCues() { applySubPosition(); }
  function applySubPosition() {
    var bottom = Math.max(subPosition(), chrome === 'shown' ? 22 : 0);
    if (subsOverlayEl) subsOverlayEl.style.bottom = bottom + '%';
    var tracks = video.textTracks;
    for (var i = 0; i < tracks.length; i++) {
      var tr = tracks[i];
      if (tr.mode !== 'showing' || !tr.cues) continue;
      for (var j = 0; j < tr.cues.length; j++) {
        try {
          tr.cues[j].snapToLines = false;
          tr.cues[j].lineAlign = 'end';
          tr.cues[j].line = 100 - bottom;
        } catch (e) { /* cue is gone */ }
      }
    }
  }

  /* ---------- sound (DTS is the silent killer) ---------- */

  var audioRestored = false;
  function audioLanguage(track) {
    return String(track && (track.lang || track.language) || '').trim().toLowerCase();
  }
  function restoreAudioLanguage() {
    if (audioRestored) return;
    var tracks = eng.audioTracks();
    if (!tracks || !tracks.length) return;
    audioRestored = true;
    var want = prefs().audioLang;
    if (!want) return;
    for (var i = 0; i < tracks.length; i++) {
      if (audioLanguage(tracks[i]) === want && eng.selectAudio(i)) {
        stripValues();
        if (ctl.play) ctl.play.set('sound', String(i));
        return;
      }
    }
  }

  function soundSpec() {
    var tracks = eng.audioTracks();
    if (tracks === undefined) {
      return { id: 'sound', name: 'Sound', type: 'action', gated: true,
        note: 'This TV can’t switch sound tracks in this file.' + (stream && stream.dts ? ' Its sound is ' + (/\b(truehd|atmos)\b/i.test(stream.flag || '') ? 'TrueHD' : 'DTS') + ' — pick a source without that flag.' : '') };
    }
    if (!tracks || tracks.length < 2) {
      return { id: 'sound', name: 'Sound', type: 'action', gated: true,
        note: 'This stream has one sound track.' + (stream && stream.dts ? ' It’s ' + 'DTS — Samsung TVs don’t decode DTS; the video will be silent. Pick a source without that flag.' : '') };
    }
    var opts = [];
    for (var i = 0; i < tracks.length; i++) {
      opts.push({ value: String(i), label: tracks[i].label || tracks[i].language || ('Track ' + (i + 1)) });
    }
    return { id: 'sound', name: 'Sound', type: 'choice', value: String(currentAudioTrack()), options: opts };
  }
  function currentAudioTrack() {
    var tracks = eng.audioTracks();
    if (!tracks) return 0;
    for (var i = 0; i < tracks.length; i++) if (tracks[i].enabled) return i;
    return 0;
  }
  function silentCheck() {
    // software demux plays silent when the TV can't decode the track; warn once.
    // Only the <video> backend can go silent unnoticed — AVPlay decodes AC3/DD+
    // and preferPlayableTrack already steers off DTS defaults.
    if (eng.kind !== 'video') return;
    if (silentWarned) return;
    silentWarned = true;
    setTimeout(function () {
      if (el.hidden || state === 'refused') return;
      if (typeof video.webkitAudioDecodedByteCount === 'number' && video.webkitAudioDecodedByteCount === 0) {
        F.toast('Playing without sound — this TV can’t decode this track (likely DTS). Pick a source without the sound flag.', 'warn');
      }
    }, 4000);
  }

  /* ---------- drawer (F.controls.render) ---------- */

  var ctl = { subs: null, play: null, series: null };
  function langOptions() {
    var opts = [{ value: '', label: 'Off' }];
    subLangs.forEach(function (l) { opts.push({ value: l, label: l }); });
    return opts;
  }
  function versionOptions() {
    var files = subFiles[subLang] || [];
    return files.map(function (s, i) { return { value: s.url, label: 'File ' + (i + 1) }; });
  }
  function drawerSpecs() {
    var subSpecs = [
      { id: 'lang', name: 'Language', type: 'choice', value: subLang, options: langOptions(),
        note: !subLangs.length ? 'No subtitles arrived for this video.' : null },
      { id: 'version', name: 'Version', type: 'choice', value: subUrl, options: versionOptions(),
        hidden: !(subLang && (subFiles[subLang] || []).length > 1) },
      { id: 'size', name: 'Size', type: 'range', value: prefs().subSize, min: 25, max: 300, step: 5,
        format: function (v) { return v + '%'; } },
      { id: 'position', name: 'Vertical position', type: 'range', value: subPosition(), min: 0, max: 80, step: 1,
        format: function (v) { return v + '% from bottom'; },
        help: 'Left lowers captions; right raises them. Saved for future videos.' },
      { id: 'timing', name: 'Timing', type: 'range', value: subDelay, min: -10, max: 10, step: 0.5,
        format: function (v) { return v === 0 ? 'In sync' : Math.abs(v).toFixed(1) + ' s ' + (v < 0 ? 'earlier' : 'later'); },
        help: 'Adjust by half a second. Resets for each video.' },
      { id: 'timing-reset', name: 'Reset timing', type: 'action' }
    ];
    var playSpecs = [
      { id: 'speed', name: 'Speed', type: 'choice', value: String(eng.rate() || 1),
        options: [{ value: '0.75', label: '0.75×' }, { value: '1', label: '1×' }, { value: '1.25', label: '1.25×' }, { value: '1.5', label: '1.5×' }, { value: '2', label: '2×' }] },
      soundSpec()
    ];
    var seriesSpecs = [
      { id: 'autoplay', name: 'When this ends', type: 'choice',
        value: prefs().endBehavior,
        options: [{ value: 'auto', label: 'Play next episode' }, { value: 'ask', label: 'Ask me' },
          { value: 'art', label: 'Return to Art' }, { value: 'detail', label: 'Back to details' }],
        note: 'Applies to future videos too. Play next episode waits for the end; if there is no next episode, shows the finished screen.' }
    ];
    return { subs: subSpecs, play: playSpecs, series: seriesSpecs };
  }
  function buildDrawer() {
    var specs = drawerSpecs();
    var titles = { lang: 'Subtitles', speed: 'Speed', sound: 'Sound', options: 'Options' };
    document.getElementById('mp-panel-title').textContent = titles[panelMenu];
    ctl.subs = F.controls.render(document.getElementById('mp-ctl-subs'), panelMenu === 'lang' ? specs.subs : [], onSubChange);
    ctl.play = F.controls.render(document.getElementById('mp-ctl-play'), specs.play.filter(function (spec) { return spec.id === panelMenu; }), onPlayChange);
    grpSeries.hidden = panelMenu !== 'options';
    document.getElementById('mp-options-empty').hidden = panelMenu !== 'options' || !grpSeries.hidden;
    ctl.series = F.controls.render(document.getElementById('mp-ctl-series'), grpSeries.hidden ? [] : specs.series, onSeriesChange);
  }
  function refreshDrawer() { buildDrawer(); paintLine(); }
  function onSubChange(id, v, spec, meta) {
    if (meta && meta.rejected) return;
    if (id === 'timing' || id === 'timing-reset') {
      subDelay = id === 'timing-reset' ? 0 : v;
      applySubTiming();
      if (ctl.subs) ctl.subs.set('timing', subDelay);
    }
    else if (id === 'lang') pickLang(v);
    else if (id === 'version') {
      var files = subFiles[subLang] || [];
      for (var i = 0; i < files.length; i++) if (files[i].url === v) { selectAddonSub(files[i]); break; }
    }
    else if (id === 'size') { F.media.setPrefs({ subSize: parseInt(v, 10) }); applySubSize(); }
    else if (id === 'position') { F.media.setPrefs({ subPosition: v }); applySubPosition(); }
    stripValues();
  }
  function onPlayChange(id, v, spec, meta) {
    if (meta && meta.rejected) { F.toast('Nothing to switch here', 'info'); return; }
    if (id === 'speed') {
      var rate = parseFloat(v) || 1;
      eng.setRate(rate);
      F.media.setPrefs({ speed: rate });
      stripValues();
    }
    if (id === 'sound' && !spec.gated) {
      var switched = eng.selectAudio(parseInt(v, 10));
      // Controls paint optimistically. Restore the engine's selection so a
      // rejected switch does not turn the next click into a no-op.
      ctl.play.set('sound', String(currentAudioTrack()));
      if (switched) {
        audioRestored = true;
        F.media.setPrefs({ audioLang: audioLanguage(eng.audioTracks()[currentAudioTrack()]) });
      }
      if (!switched) F.toast('Couldn’t switch sound tracks. Try again or choose another track.', 'warn');
      stripValues();
    }
  }
  function onSeriesChange(id, v) {
    if (id === 'autoplay') {
      F.media.setPrefs({ endBehavior: v, autoplayNext: v === 'auto' });
      stopUpnext();
    }
  }
  function stripValues() {
    subsBtn.querySelector('.act__value').textContent = subLang || 'Off';
    speedBtn.querySelector('.act__value').textContent = String(eng.rate() || 1) + '×';
    var sv = soundBtn.querySelector('.act__value');
    var tracks = eng.audioTracks();
    sv.textContent = (!tracks || tracks.length < 2) ? '—' : (tracks[currentAudioTrack()].label || 'On');
  }

  function openPanel(focusId) {
    if (panel === 'closed') panelReturnFocus = document.activeElement;
    clear(hideTimer); hideTimer = 0;
    panelMenu = focusId || 'options';
    panel = 'open'; attr('panel', 'open');
    panelEl.hidden = false;
    panelEl.setAttribute('tabindex', '-1');
    buildDrawer();
    var target = focusId ? panelEl.querySelector('[data-control-id="' + focusId + '"]') : null;
    F.nav.setScope(panelEl, { remember: false, initial: target });
    if (!panelEl.querySelector('[data-focusable]')) F.nav.focus(panelEl);
    paintLine();
  }
  function closePanel() {
    if (panel === 'closed') return false;
    panel = 'closed'; attr('panel', 'closed');
    panelEl.hidden = true;
    F.nav.setScope(root, { remember: false, initial: panelReturnFocus || timeline });
    panelReturnFocus = null;
    showChrome();
    return true;
  }
  [subsBtn, speedBtn, soundBtn, optionsBtn].forEach(function (b) {
    b.addEventListener('click', function () { openPanel(b.getAttribute('data-row')); });
  });

  function exitPlayer(destination) {
    // The router's leave hook saves progress and closes either playback engine.
    F.router.go(destination || 'media-item');
  }

  /* ---------- progress ---------- */

  function saveProgress() {
    if (!ctx || !ctx.item) return;
    var d = dur(); if (!d) return;
    F.media.recordProgress(eng.time(), d);
  }

  /* ---------- stream lifecycle ---------- */

  var metadataHandler = null;

  function clearTimers() {
    if (metadataHandler) video.removeEventListener('loadedmetadata', metadataHandler);
    metadataHandler = null;
    [hideTimer, settleTimer, slowTimer, stallTimer, saveTimer, clockTimer].forEach(clear);
    clearInterval(upnextTimer); clearInterval(clockTimer);
    hideTimer = settleTimer = slowTimer = stallTimer = saveTimer = clockTimer = upnextTimer = 0;
  }

  function startStream(s) {
    while (titleEl.firstChild && titleEl.firstChild !== epEl) titleEl.removeChild(titleEl.firstChild);
    titleEl.insertBefore(document.createTextNode(ctx.item.name), epEl);
    epEl.textContent = ctx.episodeLabel ? ' · ' + ctx.episodeLabel : '';
    stream = s;
    clearTimers();
    state = 'starting';
    silentWarned = false;
    audioRestored = false;
    attr('state', 'starting'); attr('slow', 'false'); attr('scrub', 'idle');
    attr('upnext', 'none'); attr('panel', 'closed'); attr('chrome', 'shown');
    chrome = 'shown'; scrub = 'idle'; panel = 'closed'; upnext = 'none';
    panelEl.hidden = true;
    try { eng.pause(); } catch (e) { /* ignore */ }
    applySubSize();
    var resume = F.media.progressFor(ctx.item.type, ctx.episodeId || ctx.item.id);
    metadataHandler = function () {
      video.removeEventListener('loadedmetadata', metadataHandler);
      metadataHandler = null;
      if (resume && resume.pos > 5 && resume.pos < dur() - 30) {
        eng.seek(resume.pos);
      }
      stripValues();
      paintTimeline();
      // engines that block autoplay leave us parked on 'starting': offer a start act
      if (eng.paused() && state === 'starting') {
        veilGo.hidden = false;
        veilGo.querySelector('.act__name').textContent = 'Start playing';
        veilGo.querySelector('.act__value').textContent = '';
        veilActsOn = true;
      }
    };
    video.addEventListener('loadedmetadata', metadataHandler);
    eng.open(s.url);
    eng.setRate(prefs().speed || 1);
    eng.play();
    slowTimer = setTimeout(function () {
      if (state === 'starting' || state === 'buffering') { attr('slow', 'true'); paintVeil('starting'); }
    }, themeMs('--fr-slow-start', 8000));
    stallTimer = setTimeout(function () {
      if (state === 'starting' || state === 'buffering') { attr('slow', 'true'); paintVeil('stalled'); }
    }, themeMs('--fr-stall', 20000));
    applySubPosition();
    loadSubtitles();
    buildDrawer();
    paintVeil('starting');
    paintTimeline(); paintLine();
    saveTimer = setInterval(saveProgress, 5000);
    clockTimer = setInterval(paintTimeline, 1000);
  }

  var el = document.getElementById('screen-media-play');

  F.router.register('media-play', {
    el: el,
    enter: function () {
      stream = F.media.playing();
      ctx = F.media.playingContext();
      if (!stream || !ctx || !ctx.item) { F.router.back(); return; }
      nextEp = null; altStream = null;
      if (ctx.episodes && ctx.episodeId) {
        for (var i = 0; i < ctx.episodes.length; i++) {
          if (ctx.episodes[i].id === ctx.episodeId && i + 1 < ctx.episodes.length) nextEp = ctx.episodes[i + 1];
        }
      } else if (ctx.episodes && ctx.episodes.length > 1 && !ctx.episodeId) nextEp = ctx.episodes[1];
      nextBtn.hidden = !nextEp;
      F.nav.setScope(root, { remember: true });
      F.nav.focus(timeline);
      // another playable source exists? the refused veil offers it
      if (ctx.streams && ctx.streams.length) {
        for (var j = 0; j < ctx.streams.length; j++) {
          if (ctx.streams[j] !== stream && ctx.streams[j].playable) { altStream = ctx.streams[j]; break; }
        }
      }
      startStream(stream);
    },
    leave: function () {
      saveProgress();
      clearTimers();
      eng.close();
    },
    back: function () {
      if (closePanel()) return true;
      if (cancelScrub()) return true;
      if (upnext !== 'none') { stopUpnext(); return true; }
      if (chromeOn() && (state === 'playing' || state === 'paused' || state === 'buffering')) {
        hideChrome(true);
        return true;
      }
      exitPlayer(); // Back lands on the detail, not the launcher
      return true;
    },
    onKey: function (e) {
      var name = e.key || '';
      if (e.keyCode === 404 || name.toLowerCase() === 'c') {
        if (panel === 'open') closePanel(); else openPanel(null);
        return true;
      }
      if (name === 'MediaPlayPause' || e.keyCode === 10252) { showChrome(); toggle(); return true; }
      if (name === 'MediaPlay' || e.keyCode === 415) { showChrome(); if (eng.paused()) toggle(); return true; }
      if (name === 'MediaPause' || e.keyCode === 19) { showChrome(); if (!eng.paused()) toggle(); return true; }
      if (name === 'MediaStop' || e.keyCode === 413) { F.router.back(); return true; }
      if (name === 'MediaRewind' || e.keyCode === 412) { scrubStep(-1, false); return true; }
      if (name === 'MediaFastForward' || e.keyCode === 417) { scrubStep(1, false); return true; }
      if (panel === 'open') {
        // Horizontal keys only change this row, even at its first/last value.
        if (e.keyCode === 37 || e.keyCode === 39) {
          var row = document.activeElement;
          if (panelEl.contains(row) && row.hasAttribute('data-adjust')) {
            row.dispatchEvent(new CustomEvent('framed:adjust', { detail: { delta: e.keyCode === 37 ? -1 : 1, fast: e.repeat, handled: true }, bubbles: true }));
          }
          return true;
        }
        return false;
      }
      if (F.nav.isBackKey(e)) return false; // router.back() handles the matrix
      if (e.keyCode === 13) { // OK — before nav turns it into a click
        if (scrub === 'active') { commitScrub(); return true; }
        if (!chromeOn()) { showChrome(); if (state === 'playing') { eng.pause(); } return true; }
        return false; // chrome: nav clicks the focused act
      }
      if (e.keyCode === 37 || e.keyCode === 39) { // ◂ ▸
        var dir = e.keyCode === 37 ? -1 : 1;
        if (!chromeOn() || document.activeElement === timeline) { scrubStep(dir, e.repeat); return true; }
        return false; // strip moves between acts
      }
      if (e.keyCode === 38 || e.keyCode === 40) { // ▴ ▾: reveal chrome, stay in nav flow
        if (!chromeOn()) { showChrome(); return true; }
        return false;
      }
      return false;
    }
  });
})(window.framed);

/*
 * framed — __tvBridge seam (STUB).
 *
 * The app only ever talks to the TV through window.__tvBridge. This file defines a stub that
 * logs and toasts. The real bridge (Tizen APIs) is injected by loading a script that defines
 * window.__tvBridge BEFORE this file — if __tvBridge already exists, this stub steps aside.
 *
 * Contract (see README.md):
 *   launch(appId: string): Promise<{ok:boolean}>
 *   setBrightness(level: 0..100): void
 *   setArtFloor(level: 0..100): void
 *   setArtActive(active: boolean): void
 *   getState(): { platform, brightness, artFloor, lastLaunch, isStub }
 */
(function () {
  if (window.__tvBridge) {
    console.info('[__tvBridge] real bridge present (' + (window.__tvBridge.getState ? window.__tvBridge.getState().platform : 'unknown') + '), stub not installed');
    return;
  }

  var state = {
    platform: 'stub',
    brightness: 100,
    artFloor: 10,
    lastLaunch: null,
    isStub: true
  };

  function clamp(n) {
    n = Number(n);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[__tvBridge:stub]');
    console.log.apply(console, args);
  }

  function toast(msg, tone) {
    document.dispatchEvent(new CustomEvent('framed:toast', { detail: { message: msg, tone: tone || 'info' } }));
  }

  window.__tvBridge = {
    launch: function (appId) {
      state.lastLaunch = appId;
      log('launch', appId);
      toast('would launch ' + appId);
      return Promise.resolve({ ok: true, stub: true, appId: appId });
    },
    setBrightness: function (level) {
      state.brightness = clamp(level);
      log('setBrightness', state.brightness);
    },
    setArtFloor: function (level) {
      state.artFloor = clamp(level);
      log('setArtFloor', state.artFloor);
    },
    setArtActive: function () {},
    getState: function () {
      return {
        platform: state.platform,
        brightness: state.brightness,
        artFloor: state.artFloor,
        lastLaunch: state.lastLaunch,
        isStub: state.isStub
      };
    }
  };
})();

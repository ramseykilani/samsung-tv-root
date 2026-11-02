/* Native app launch plus the read-only LAN ambient sensor. Deployment settings
 * live in bridge.local.json; never embed the privileged root /intent token. */
(function () {
  var config = null, loading = null;
  var state = { platform: 'Tizen / software dimming', brightness: 100, artFloor: 10, isStub: false };
  function request(url, token) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true); xhr.timeout = 8000;
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.onload = function () {
        if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText)) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
        } else reject(new Error('Sensor bridge unavailable'));
      };
      xhr.onerror = xhr.ontimeout = function () { reject(new Error('Sensor bridge unavailable')); };
      xhr.send();
    });
  }
  function configuration() {
    if (config) return Promise.resolve(config);
    if (loading) return loading;
    loading = request('bridge.local.json').then(function (c) {
      if (!/^https?:\/\//.test(c.url) || typeof c.sensorToken !== 'string' || c.sensorToken.length < 32) throw new Error('Sensor bridge not configured');
      config = c; loading = null; return c;
    }).catch(function (e) { loading = null; throw e; });
    return loading;
  }
  window.__tvBridge = {
    launch: function (id) {
      return new Promise(function (resolve, reject) {
        if (!window.tizen || !tizen.application) { reject(new Error('App launch requires a TV')); return; }
        tizen.application.launch(id, function () { resolve({ ok: true }); }, reject);
      });
    },
    setBrightness: function (v) { state.brightness = v; },
    setArtFloor: function (v) { state.artFloor = v; },
    getState: function () { return state; },
    readAmbient: function () {
      return configuration().then(function (c) { return request(c.url.replace(/\/$/, '') + '/sensor/ambient', c.sensorToken); })
        .then(function (r) { if (!r.sensor) throw new Error('No sensor data'); return r.sensor; });
    }
  };
})();

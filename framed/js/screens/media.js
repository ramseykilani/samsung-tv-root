/*
 * framed — Media browse screen: catalogs across the configured Stremio addons,
 * metas as a poster grid. ◂ ▸ switch catalog (adjust row), ▴ ▾ move into the grid,
 * OK opens the detail screen. Empty/unreachable addons degrade to a quiet status line.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media');
  var catsEl = document.getElementById('media-cats');
  var statusEl = document.getElementById('media-status');
  var gridEl = document.getElementById('media-grid');
  var cats = [];

  function setStatus(t) { statusEl.textContent = t || ''; }

  function buildPicker() {
    var opts = cats.map(function (c, i) { return { value: i, label: c.label }; });
    var cur = F.media.picked();
    if (cur >= cats.length) cur = 0;
    F.controls.render(catsEl, [
      { id: 'catalog', name: 'Catalog', type: 'choice', value: cur, options: opts }
    ], function (id, v) {
      F.media.pick(v);
      loadGrid(v);
    });
    loadGrid(cur);
  }

  function loadGrid(i) {
    var cat = cats[i];
    gridEl.innerHTML = '';
    if (!cat) { setStatus('No catalog available.'); return; }
    setStatus('Loading ' + cat.label + '…');
    F.media.catalog(cat, function (items) {
      if (el.hidden) return;
      if (!items || !items.length) { setStatus('Nothing to show in this catalog.'); return; }
      setStatus('');
      items.forEach(function (it) {
        var card = document.createElement('button');
        card.className = 'media-card';
        card.setAttribute('data-focusable', '');
        card.setAttribute('tabindex', '-1');
        var poster = document.createElement('div');
        poster.className = 'media-card__poster';
        if (it.poster) poster.style.backgroundImage = 'url("' + String(it.poster).replace(/"/g, '') + '")';
        var title = document.createElement('span');
        title.className = 'media-card__title';
        title.textContent = it.name;
        var sub = document.createElement('span');
        sub.className = 'media-card__sub';
        sub.textContent = it.year || it.type || '';
        card.appendChild(poster);
        card.appendChild(title);
        card.appendChild(sub);
        card.addEventListener('click', function () {
          F.media.open(cat, it);
          F.router.go('media-item');
        });
        gridEl.appendChild(card);
      });
    });
  }

  F.router.register('media', {
    el: el,
    enter: function () {
      setStatus('Loading catalogs…');
      F.media.catalogs(function (cs) {
        cats = cs;
        if (el.hidden) return;
        if (!cs.length) { setStatus('No addons reachable.'); return; }
        buildPicker();
      });
      F.nav.setScope(el, { remember: true });
    }
  });
})(window.framed);

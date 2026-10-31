/*
 * framed — Media browse screen: catalogs across the configured Stremio addons,
 * metas as a poster grid, plus the viewer's own shelves:
 *   Browse        every catalog from the addons (◂ ▸ switches catalog)
 *   My List       titles saved with the detail screen's Save button or the red key
 *   Continue      titles with a resume point, newest first
 * Search (button above the grid) opens an on-screen keyboard — the remote has no
 * text entry — and asks every addon, not just the visible catalog.
 * The grid is painted a page at a time: a wall of hundreds of posters makes the
 * d-pad engine measure every card on every keypress, which reads as input lag.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media');
  var catsEl = document.getElementById('media-cats');
  var viewEl = document.getElementById('media-view');
  var searchBtn = document.getElementById('media-search-open');
  var statusEl = document.getElementById('media-status');
  var gridEl = document.getElementById('media-grid');
  var moreBtn = document.getElementById('media-more');
  var keysEl = document.getElementById('media-keys');
  var queryEl = document.getElementById('media-query');
  var keysGrid = document.getElementById('media-keys-grid');

  var PAGE = 24;
  var cats = [];
  var entries = [];        // [{ cat, item }] currently shown (item may be a saved snapshot)
  var rendered = 0;
  var view = 'browse';     // 'browse' | 'saved' | 'continue'
  var query = '';          // non-empty while search results are shown
  var fetchingMore = false;
  var loadToken = 0;       // stale async loads check this before painting
  var kbOpen = false;
  var kbText = '';
  var wantInitialFocus = false; // entering Watch should land on the first poster, not the toolbar

  function setStatus(t) { statusEl.textContent = t || ''; }
  function savedCount() { return F.media.savedItems().length; }
  function continueCount() { return F.media.continueItems().length; }

  function cardSub(it) {
    var bits = [];
    if (it.year) bits.push(it.year);
    if (F.media.isSaved(it.type, it.id)) bits.push('In My List');
    var p = F.media.progressFor(it.type, it.id);
    if (p && p.dur > 0) bits.push(Math.round(p.pos / p.dur * 100) + '% watched');
    return bits.join('  ·  ') || it.type || '';
  }

  function paintCard(entry) {
    var it = entry.item;
    var card = document.createElement('button');
    card.className = 'media-card';
    card.setAttribute('data-focusable', '');
    card.setAttribute('tabindex', '-1');
    card._entry = entry;
    var poster = document.createElement('div');
    poster.className = 'media-card__poster';
    if (it.poster) poster.style.backgroundImage = 'url("' + String(it.poster).replace(/"/g, '') + '")';
    var title = document.createElement('span');
    title.className = 'media-card__title';
    title.textContent = it.name;
    var sub = document.createElement('span');
    sub.className = 'media-card__sub';
    sub.textContent = cardSub(it);
    card._subEl = sub;
    card.appendChild(poster);
    card.appendChild(title);
    card.appendChild(sub);
    card.addEventListener('click', function () {
      F.media.open(entry.cat, entry.item);
      F.router.go('media-item');
    });
    return card;
  }

  function paintPage() {
    var end = Math.min(rendered + PAGE, entries.length);
    for (var i = rendered; i < end; i++) gridEl.appendChild(paintCard(entries[i]));
    rendered = end;
    var cat = cats[F.media.picked()];
    moreBtn.hidden = !(rendered < entries.length || (view === 'browse' && !query && cat && cat.pageable));
    if (!F.nav.current()) F.nav.setScope(el, { remember: true });
  }

  function showEntries(list, emptyMsg) {
    entries = list;
    rendered = 0;
    gridEl.innerHTML = '';
    moreBtn.hidden = true;
    if (!list.length) { setStatus(emptyMsg); return; }
    setStatus('');
    paintPage();
    if (wantInitialFocus) {
      wantInitialFocus = false;
      var first = gridEl.querySelector('[data-focusable]');
      if (first) F.nav.focus(first);
    }
  }

  function loadBrowse(i) {
    var cat = cats[i];
    gridEl.innerHTML = '';
    moreBtn.hidden = true;
    if (!cat) { setStatus('No catalog available. Add an addon in js/media.js.'); return; }
    var token = ++loadToken;
    setStatus('Loading ' + cat.label + '…');
    F.media.catalog(cat, function (items) {
      if (el.hidden || token !== loadToken) return;
      if (!items || !items.length) { setStatus('Nothing to show in this catalog.'); return; }
      showEntries(items.map(function (it) { return { cat: cat, item: it }; }), '');
      setStatus(items.length + ' titles · OK opens · red button saves to My List');
    });
  }

  function loadShelf() {
    ++loadToken;
    if (view === 'saved') {
      var saved = F.media.savedItems();
      showEntries(saved.map(function (it) { return { cat: null, item: it }; }),
        'My List is empty. Open a title and choose “Save to My List”, or press the red button on a poster.');
      if (saved.length) setStatus(saved.length + (saved.length === 1 ? ' title' : ' titles') + ' in My List');
    } else {
      var cont = F.media.continueItems();
      showEntries(cont.map(function (c) { return { cat: null, item: c.item }; }),
        'Nothing in progress. Start watching something and it will wait here.');
      if (cont.length) setStatus('Pick up where you left off');
    }
  }

  function runSearch(q) {
    query = q;
    catsEl.hidden = true;
    var token = ++loadToken;
    setStatus('Searching for “' + q + '”…');
    gridEl.innerHTML = '';
    moreBtn.hidden = true;
    F.media.search(q, function (results) {
      if (el.hidden || token !== loadToken) return;
      showEntries(results, 'No titles found for “' + q + '”. Back clears the search.');
      if (results.length) setStatus(results.length + (results.length === 1 ? ' result' : ' results') + ' for “' + q + '” · Back clears');
    });
  }

  function clearSearch() {
    query = '';
    catsEl.hidden = view !== 'browse';
    applyView();
  }

  function applyView() {
    catsEl.hidden = view !== 'browse' || !!query;
    if (query) return;
    if (view === 'browse') loadBrowse(F.media.picked());
    else loadShelf();
  }

  function buildTools() {
    F.controls.render(viewEl, [
      { id: 'view', name: 'Shelf', type: 'choice', value: view, options: [
        { value: 'browse', label: 'Browse' },
        { value: 'saved', label: 'My List (' + savedCount() + ')' },
        { value: 'continue', label: 'Continue (' + continueCount() + ')' }
      ] }
    ], function (id, v) {
      view = v;
      F.store.merge('media', { view: v }, { catalog: 0 });
      applyView();
    });
    var opts = cats.map(function (c, i) { return { value: i, label: c.label }; });
    var cur = F.media.picked();
    if (cur >= cats.length) cur = 0;
    F.controls.render(catsEl, [
      { id: 'catalog', name: 'Catalog', type: 'choice', value: cur, options: opts }
    ], function (id, v) {
      F.media.pick(v);
      if (view === 'browse' && !query) loadBrowse(v);
    });
    catsEl.hidden = view !== 'browse' || !!query;
    if (!F.nav.current()) F.nav.setScope(el, { remember: true });
  }

  /* ---------- on-screen keyboard ---------- */

  var KEY_ROWS = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ0123', '456789.-_\''];
  function paintQuery() { queryEl.textContent = kbText || 'Search titles…'; }

  function buildKeyboard() {
    keysGrid.innerHTML = '';
    KEY_ROWS.forEach(function (row) {
      for (var i = 0; i < row.length; i++) {
        (function (ch) {
          var b = document.createElement('button');
          b.className = 'media-key';
          b.setAttribute('data-focusable', '');
          b.setAttribute('tabindex', '-1');
          b.textContent = ch;
          b.addEventListener('click', function () { kbText += ch.toLowerCase(); paintQuery(); });
          keysGrid.appendChild(b);
        })(row[i]);
      }
    });
    [['Space', function () { kbText += ' '; }], ['Delete', function () { kbText = kbText.slice(0, -1); }],
     ['Clear', function () { kbText = ''; }], ['Search', function () { submitSearch(); }], ['Cancel', function () { closeKeyboard(); }]
    ].forEach(function (pair) {
      var b = document.createElement('button');
      b.className = 'media-key media-key--wide';
      b.setAttribute('data-focusable', '');
      b.setAttribute('tabindex', '-1');
      b.textContent = pair[0];
      b.addEventListener('click', function () { pair[1](); paintQuery(); });
      keysGrid.appendChild(b);
    });
    paintQuery();
  }

  function openKeyboard() {
    kbText = query || '';
    buildKeyboard();
    kbOpen = true;
    keysEl.hidden = false;
    F.nav.setScope(keysEl, { remember: false });
  }

  function closeKeyboard() {
    kbOpen = false;
    keysEl.hidden = true;
    F.nav.setScope(el, { remember: true });
  }

  function submitSearch() {
    var q = kbText.trim();
    closeKeyboard();
    if (q) runSearch(q);
  }

  searchBtn.addEventListener('click', openKeyboard);
  moreBtn.addEventListener('click', function () {
    if (rendered < entries.length) { paintPage(); return; }
    // catalog exhausted locally — addons that declare `skip` can serve another page
    var cat = cats[F.media.picked()];
    if (view !== 'browse' || query || !cat || !cat.pageable || fetchingMore) return;
    fetchingMore = true;
    var token = loadToken;
    setStatus('Loading more…');
    F.media.catalog(cat, function (items) {
      fetchingMore = false;
      if (el.hidden || token !== loadToken) return;
      if (!items || !items.length) { moreBtn.hidden = true; setStatus('That is everything in this catalog.'); return; }
      var seen = {};
      entries.forEach(function (e) { seen[e.item.type + ':' + e.item.id] = true; });
      items.forEach(function (it) { if (!seen[it.type + ':' + it.id]) entries.push({ cat: cat, item: it }); });
      setStatus('');
      paintPage();
    }, 'skip=' + entries.length);
  });

  // The red remote key (and S on a desktop keyboard) saves/removes the focused poster.
  function toggleFocusedSaved() {
    var cur = F.nav.current();
    if (!cur || !cur._entry) return false;
    var entry = cur._entry;
    var now = F.media.toggleSaved(entry.cat, entry.item);
    if (cur._subEl) cur._subEl.textContent = cardSub(entry.item);
    F.toast(now ? 'Saved to My List' : 'Removed from My List', now ? 'ok' : 'info');
    if (view === 'saved' && !now) loadShelf();
    buildTools(); // shelf counts in the labels
    return true;
  }

  F.router.register('media', {
    el: el,
    enter: function () {
      view = F.store.get('media', { catalog: 0 }).view || 'browse';
      wantInitialFocus = true;
      query = '';
      kbOpen = false;
      keysEl.hidden = true;
      setStatus('Loading catalogs…');
      F.media.catalogs(function (cs) {
        cats = cs;
        if (el.hidden) return;
        buildTools();
        if (!cs.length && view === 'browse') { setStatus('No addons reachable. Check the network, or the addon list in js/media.js.'); gridEl.innerHTML = ''; return; }
        applyView();
      });
      F.nav.setScope(el, { remember: true });
    },
    back: function () {
      if (kbOpen) { closeKeyboard(); return true; }
      if (query) { clearSearch(); return true; }
      return false; // router takes us home
    },
    onKey: function (e) {
      if (kbOpen) {
        if (F.nav.isBackKey(e)) { closeKeyboard(); return true; }
        if (e.key && e.key.length === 1) { kbText += e.key.toLowerCase(); paintQuery(); return true; }
        if (e.keyCode === 8) { kbText = kbText.slice(0, -1); paintQuery(); return true; }
        return false; // arrows / OK still drive the keyboard grid
      }
      if (e.keyCode === 403 || (e.key && e.key.toLowerCase() === 's' && F.nav.current() && F.nav.current()._entry)) {
        return toggleFocusedSaved();
      }
      return false;
    }
  });
})(window.framed);

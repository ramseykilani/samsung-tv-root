/*
 * framed — Media browse screen, modelled on Stremio's main surfaces:
 *   Board     Continue Watching + My List rows on top, then one row per catalog
 *   Browse    one catalog as a paged poster grid, with the catalog's own genre filter
 *   My List   the saved library, sortable (added / name / last watched) and type-filtered
 *   Continue  titles with a resume point, newest first
 *   Addons    installed addons; install by URL, remove/disable, restore
 * Search (button above the shelves) opens an on-screen keyboard — the remote has
 * no text entry — and asks every addon, not just the visible catalog. Recent
 * searches are offered under the keyboard.
 * Keys on a poster: OK opens · red (or S) saves/removes · green (or W) marks watched.
 * Grids paint a page at a time: a wall of hundreds of posters makes the d-pad
 * engine measure every card on every keypress, which reads as input lag.
 */
window.framed = window.framed || {};
(function (F) {
  var el = document.getElementById('screen-media');
  var catsEl = document.getElementById('media-cats');
  var filterEl = document.getElementById('media-filter');
  var libEl = document.getElementById('media-libtools');
  var shelvesEl = document.getElementById('media-shelves');
  var shelfBtns = shelvesEl.querySelectorAll('[data-shelf]');
  var statusEl = document.getElementById('media-status');
  var gridEl = document.getElementById('media-grid');
  var moreBtn = document.getElementById('media-more');
  var keysEl = document.getElementById('media-keys');
  var queryEl = document.getElementById('media-query');
  var keysGrid = document.getElementById('media-keys-grid');
  var historyEl = document.getElementById('media-key-history');

  var PAGE = 24;
  var BOARD_CATS_PER_BATCH = 4;
  var BOARD_ROW_ITEMS = 12;
  var cats = [];
  var entries = [];        // [{ cat, item }] currently shown (item may be a saved snapshot)
  var rendered = 0;
  var view = 'board';      // 'board' | 'browse' | 'saved' | 'continue' | 'addons'
  var query = '';          // non-empty while search results are shown
  var genre = '';          // active Discover filter for the picked catalog
  var libSort = 'added';
  var libType = 'all';
  var fetchingMore = false;
  var loadToken = 0;       // stale async loads check this before painting
  var boardCatsLoaded = 0;
  var kbOpen = false;
  var kbText = '';
  var kbMode = 'search';   // 'search' | 'addon'
  var wantInitialFocus = false; // entering Watch should land on content, not the toolbar

  function setStatus(t) { statusEl.textContent = t || ''; }
  function savedCount() { return F.media.savedItems().length; }
  function continueCount() { return F.media.continueItems().length; }

  function cardSub(it) {
    var bits = [];
    if (it.year) bits.push(it.year);
    if (F.media.isSaved(it.type, it.id)) bits.push('In My List');
    if (F.media.isWatched(it.type, it.id)) bits.push('✓ Watched');
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

  function focusFirstCard() {
    if (!wantInitialFocus) return;
    var first = gridEl.querySelector('[data-focusable]');
    if (first) { wantInitialFocus = false; F.nav.focus(first); }
  }

  /* ---------- paged grid (Browse / shelves / search) ---------- */

  function paintPage() {
    var end = Math.min(rendered + PAGE, entries.length);
    for (var i = rendered; i < end; i++) gridEl.appendChild(paintCard(entries[i]));
    rendered = end;
    var cat = cats[F.media.picked()];
    moreBtn.hidden = !(rendered < entries.length || (view === 'browse' && !query && cat && cat.pageable));
    if (!F.nav.current()) F.nav.setScope(el, { remember: true });
    focusFirstCard();
  }

  function showEntries(list, emptyMsg) {
    gridEl.classList.remove('is-board');
    entries = list;
    rendered = 0;
    gridEl.innerHTML = '';
    moreBtn.hidden = true;
    if (!list.length) { setStatus(emptyMsg); return; }
    setStatus('');
    paintPage();
  }

  function dedupe(items) {
    var seen = {}, out = [];
    items.forEach(function (it) {
      var k = it.type + ':' + it.id;
      if (!seen[k]) { seen[k] = true; out.push(it); }
    });
    return out;
  }

  function genreExtra(skip) {
    var parts = [];
    if (genre) parts.push('genre=' + encodeURIComponent(genre));
    if (skip) parts.push('skip=' + skip);
    return parts.join('/');
  }

  function buildFilter(cat) {
    filterEl.innerHTML = '';
    var filters = (cat && cat.filters) || [];
    var genreFilter = null;
    filters.forEach(function (f) { if (f.name === 'genre') genreFilter = f; });
    filterEl.hidden = !genreFilter || view !== 'browse';
    if (!genreFilter) { genre = ''; return; }
    var opts = [{ value: '', label: 'All genres' }].concat(genreFilter.options.map(function (g) { return { value: g, label: g }; }));
    if (!genreFilter.options.length || (genre && genreFilter.options.indexOf(genre) === -1)) genre = '';
    F.controls.render(filterEl, [
      { id: 'genre', name: 'Genre', type: 'choice', value: genre, options: opts }
    ], function (id, v) { genre = v; loadBrowse(F.media.picked()); });
  }

  function loadBrowse(i) {
    var cat = cats[i];
    gridEl.innerHTML = '';
    moreBtn.hidden = true;
    buildFilter(cat);
    if (!cat) { setStatus('No catalog available. Add an addon from the Addons shelf.'); return; }
    var token = ++loadToken;
    setStatus('Loading ' + cat.label + '…');
    F.media.catalog(cat, function (items) {
      if (el.hidden || token !== loadToken) return;
      if (!items || !items.length) { setStatus(genre ? 'Nothing in ' + cat.label + ' for that genre.' : 'Nothing to show in this catalog.'); return; }
      items = dedupe(items);
      showEntries(items.map(function (it) { return { cat: cat, item: it }; }), '');
      setStatus(items.length + ' titles · OK opens · red saves · green marks watched');
    }, genreExtra(0) || undefined);
  }

  /* ---------- Board: Stremio's home rows ---------- */

  function appendRow(title, list) {
    if (!list.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'media-row-wrap';
    var head = document.createElement('div');
    head.className = 'media-row__title';
    head.textContent = title;
    var row = document.createElement('div');
    row.className = 'media-row';
    list.slice(0, BOARD_ROW_ITEMS).forEach(function (entry) { row.appendChild(paintCard(entry)); });
    wrap.appendChild(head);
    wrap.appendChild(row);
    gridEl.appendChild(wrap);
    focusFirstCard();
  }

  function loadBoardCats(token) {
    var batch = cats.slice(boardCatsLoaded, boardCatsLoaded + BOARD_CATS_PER_BATCH);
    boardCatsLoaded += batch.length;
    batch.forEach(function (cat) {
      F.media.catalog(cat, function (items) {
        if (el.hidden || token !== loadToken || !items) return;
        appendRow(cat.label, dedupe(items).map(function (it) { return { cat: cat, item: it }; }));
      });
    });
    moreBtn.hidden = boardCatsLoaded >= cats.length;
    moreBtn.textContent = 'More catalogs';
  }

  function loadBoard() {
    var token = ++loadToken;
    gridEl.classList.add('is-board');
    gridEl.innerHTML = '';
    boardCatsLoaded = 0;
    appendRow('Continue Watching', F.media.continueItems().map(function (c) { return { cat: null, item: c.item }; }));
    appendRow('My List', F.media.savedItems().map(function (it) { return { cat: null, item: it }; }));
    if (cats.length) loadBoardCats(token);
    if (!gridEl.children.length && !cats.length) setStatus('No addons reachable. Check the network, or open the Addons shelf.');
    else setStatus('');
    focusFirstCard();
  }

  /* ---------- library shelves ---------- */

  function buildLibTools() {
    libEl.innerHTML = '';
    libEl.hidden = view !== 'saved';
    if (view !== 'saved') return;
    F.controls.render(libEl, [
      { id: 'sort', name: 'Sort', type: 'choice', value: libSort, options: [
        { value: 'added', label: 'Recently added' }, { value: 'name', label: 'Name' }, { value: 'watched', label: 'Last watched' }] },
      { id: 'type', name: 'Type', type: 'choice', value: libType, options: [
        { value: 'all', label: 'All types' }, { value: 'movie', label: 'Movies' }, { value: 'series', label: 'Series' }] }
    ], function (id, v) {
      if (id === 'sort') libSort = v; else libType = v;
      F.store.merge('media', { libSort: libSort, libType: libType }, { catalog: 0 });
      loadShelf();
    });
  }

  function loadShelf() {
    ++loadToken;
    buildLibTools();
    if (view === 'saved') {
      var saved = F.media.savedItems();
      if (libType !== 'all') saved = saved.filter(function (it) { return it.type === libType; });
      if (libSort === 'name') saved.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      if (libSort === 'watched') saved.sort(function (a, b) {
        var pa = F.media.progressFor(a.type, a.id), pb = F.media.progressFor(b.type, b.id);
        return ((pb && pb.at) || 0) - ((pa && pa.at) || 0);
      });
      showEntries(saved.map(function (it) { return { cat: null, item: it }; }),
        'My List is empty. Open a title and choose “Save to My List”, or press the red button on a poster.');
      if (saved.length) setStatus(saved.length + (saved.length === 1 ? ' title' : ' titles') + ' in My List');
    } else {
      var cont = F.media.continueItems();
      if (libType !== 'all') cont = cont.filter(function (c) { return c.item.type === libType; });
      showEntries(cont.map(function (c) { return { cat: null, item: c.item }; }),
        'Nothing in progress. Start watching something and it will wait here.');
      if (cont.length) setStatus('Pick up where you left off');
    }
  }

  /* ---------- Addons shelf ---------- */

  function addonRow(title, sub, onOk) {
    var b = document.createElement('button');
    b.className = 'media-addon';
    b.setAttribute('data-focusable', '');
    b.setAttribute('tabindex', '-1');
    var n = document.createElement('span');
    n.className = 'media-addon__name';
    n.textContent = title;
    var s = document.createElement('span');
    s.className = 'media-addon__sub';
    s.textContent = sub;
    b.appendChild(n);
    b.appendChild(s);
    b.addEventListener('click', onOk);
    return b;
  }

  function loadAddons() {
    var token = ++loadToken;
    gridEl.classList.add('is-board');
    gridEl.innerHTML = '';
    moreBtn.hidden = true;
    gridEl.appendChild(addonRow('＋ Install addon from URL…', 'Type or paste a manifest URL with the keyboard', function () { openKeyboard('addon'); }));
    setStatus('Loading addons…');
    F.media.addonList(function (list) {
      if (el.hidden || token !== loadToken) return;
      setStatus(list.length + ' addons installed · OK on one removes or disables it');
      list.forEach(function (a) {
        var meta = [a.version ? 'v' + a.version : '', a.resources.join(' · '), a.base].filter(Boolean).join('  ·  ');
        gridEl.appendChild(addonRow(
          a.name + (a.custom ? '' : ' (built-in)') + (a.reachable ? '' : ' — unreachable'),
          (a.description ? a.description + '  ·  ' : '') + meta,
          function () {
            F.media.removeAddon(a);
            F.toast(a.custom ? 'Removed ' + a.name : 'Disabled ' + a.name, 'info');
            refreshCats(function () { loadAddons(); });
          }));
      });
      F.media.disabledAddons().forEach(function (name) {
        gridEl.appendChild(addonRow(name + ' (disabled)', 'OK re-enables this built-in addon', function () {
          F.media.restoreAddon(name);
          F.toast('Enabled ' + name, 'ok');
          refreshCats(function () { loadAddons(); });
        }));
      });
      focusFirstCard();
      if (!F.nav.current()) F.nav.setScope(el, { remember: true });
    });
  }

  /* ---------- search ---------- */

  function runSearch(q) {
    query = q;
    F.media.pushSearch(q);
    catsEl.hidden = true;
    filterEl.hidden = true;
    libEl.hidden = true;
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
    applyView();
  }

  function applyView() {
    catsEl.hidden = view !== 'browse' || !!query;
    filterEl.hidden = view !== 'browse' || !!query;
    libEl.hidden = view !== 'saved' || !!query;
    moreBtn.textContent = 'More titles';
    if (query) return;
    if (view === 'board') loadBoard();
    else if (view === 'browse') loadBrowse(F.media.picked());
    else if (view === 'addons') loadAddons();
    else loadShelf();
  }

  function refreshCats(cb) {
    F.media.catalogs(function (cs) {
      cats = cs;
      if (!el.hidden) buildTools();
      if (cb) cb();
    });
  }

  // The shelf strip is static HTML: Search + shelves as peer buttons, so ◂ ▸ moves
  // along it (a choice control would consume ◂ ▸ and strand Search). Switching
  // shelf also clears any active search — the results belong to no shelf.
  function setView(v) {
    view = v;
    query = '';
    F.store.merge('media', { view: v }, { catalog: 0 });
    paintShelves();
    applyView();
  }

  function paintShelves() {
    for (var i = 0; i < shelfBtns.length; i++) {
      var b = shelfBtns[i];
      var shelf = b.getAttribute('data-shelf');
      b.setAttribute('data-selected', String(shelf === view));
      if (shelf === 'saved') b.textContent = 'My List (' + savedCount() + ')';
      if (shelf === 'continue') b.textContent = 'Continue (' + continueCount() + ')';
    }
  }

  for (var si = 0; si < shelfBtns.length; si++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var shelf = btn.getAttribute('data-shelf');
        if (shelf === 'search') openKeyboard('search');
        else setView(shelf);
      });
    })(shelfBtns[si]);
  }

  function buildTools() {
    paintShelves();
    var opts = cats.map(function (c, i) { return { value: i, label: c.label }; });
    var cur = F.media.picked();
    if (cur >= cats.length) cur = 0;
    F.controls.render(catsEl, [
      { id: 'catalog', name: 'Catalog', type: 'choice', value: cur, options: opts }
    ], function (id, v) {
      F.media.pick(v);
      genre = '';
      if (view === 'browse' && !query) loadBrowse(v);
    });
    catsEl.hidden = view !== 'browse' || !!query;
    if (!F.nav.current()) F.nav.setScope(el, { remember: true });
  }

  /* ---------- on-screen keyboard (search + addon URL entry) ---------- */

  var KEY_ROWS = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ0123', '456789.-/:'];
  function paintQuery() {
    queryEl.textContent = kbText || (kbMode === 'addon' ? 'Addon URL (…/manifest.json)' : 'Search titles…');
  }

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
     ['Clear', function () { kbText = ''; }], [kbMode === 'addon' ? 'Install' : 'Search', function () { submitKeyboard(); }], ['Cancel', function () { closeKeyboard(); }]
    ].forEach(function (pair) {
      var b = document.createElement('button');
      b.className = 'media-key media-key--wide';
      b.setAttribute('data-focusable', '');
      b.setAttribute('tabindex', '-1');
      b.textContent = pair[0];
      b.addEventListener('click', function () { pair[1](); paintQuery(); });
      keysGrid.appendChild(b);
    });
    historyEl.innerHTML = '';
    if (kbMode === 'search') {
      var hist = F.media.searches();
      if (hist.length) {
        var label = document.createElement('span');
        label.className = 'media-keys__history-label';
        label.textContent = 'Recent:';
        historyEl.appendChild(label);
        hist.forEach(function (term) {
          var chip = document.createElement('button');
          chip.className = 'media-key media-key--chip';
          chip.setAttribute('data-focusable', '');
          chip.setAttribute('tabindex', '-1');
          chip.textContent = term;
          chip.addEventListener('click', function () { kbText = term; submitKeyboard(); });
          historyEl.appendChild(chip);
        });
      }
    }
    paintQuery();
  }

  function openKeyboard(mode) {
    kbMode = mode || 'search';
    kbText = kbMode === 'search' ? (query || '') : '';
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

  function submitKeyboard() {
    var text = kbText.trim();
    var mode = kbMode;
    closeKeyboard();
    if (!text) return;
    if (mode === 'addon') {
      setStatus('Contacting addon…');
      F.media.addAddon(text, function (ok, msg) {
        F.toast(ok ? 'Installed ' + msg : msg, ok ? 'ok' : 'error');
        if (ok) refreshCats(function () { if (view === 'addons') loadAddons(); });
        else if (view === 'addons') loadAddons();
      });
    } else runSearch(text);
  }

  moreBtn.addEventListener('click', function () {
    if (view === 'board') { loadBoardCats(loadToken); return; }
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
      dedupe(items).forEach(function (it) { if (!seen[it.type + ':' + it.id]) entries.push({ cat: cat, item: it }); });
      setStatus('');
      paintPage();
    }, genreExtra(entries.length) || undefined);
  });

  // Red (or S): save/remove the focused poster. Green (or W): mark watched/unwatched.
  function focusedEntry() {
    var cur = F.nav.current();
    return cur && cur._entry ? { card: cur, entry: cur._entry } : null;
  }

  function toggleFocusedSaved() {
    var f = focusedEntry();
    if (!f) return false;
    var now = F.media.toggleSaved(f.entry.cat, f.entry.item);
    if (f.card._subEl) f.card._subEl.textContent = cardSub(f.entry.item);
    F.toast(now ? 'Saved to My List' : 'Removed from My List', now ? 'ok' : 'info');
    if (view === 'saved' && !now) loadShelf();
    paintShelves(); // shelf counts in the labels
    return true;
  }

  function toggleFocusedWatched() {
    var f = focusedEntry();
    if (!f) return false;
    var now = F.media.toggleWatched(f.entry.cat, f.entry.item);
    if (f.card._subEl) f.card._subEl.textContent = cardSub(f.entry.item);
    F.toast(now ? 'Marked as watched' : 'Marked as unwatched', now ? 'ok' : 'info');
    return true;
  }

  F.router.register('media', {
    el: el,
    enter: function () {
      var stored = F.store.get('media', { catalog: 0 });
      view = stored.view || 'board';
      libSort = stored.libSort || 'added';
      libType = stored.libType || 'all';
      wantInitialFocus = true;
      query = '';
      genre = '';
      kbOpen = false;
      keysEl.hidden = true;
      setStatus('Loading catalogs…');
      refreshCats(function () {
        if (el.hidden) return;
        if (!cats.length && (view === 'board' || view === 'browse')) { setStatus('No addons reachable. Check the network, or open the Addons shelf.'); gridEl.innerHTML = ''; }
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
        if (e.key && e.key.length === 1) { kbText += e.key; paintQuery(); return true; }
        return false; // arrows / OK still drive the keyboard grid
      }
      var f = focusedEntry();
      if (!f) return false;
      if (e.keyCode === 403 || (e.key && e.key.toLowerCase() === 's')) return toggleFocusedSaved();
      if (e.keyCode === 404 || (e.key && e.key.toLowerCase() === 'w')) return toggleFocusedWatched();
      return false;
    }
  });
})(window.framed);

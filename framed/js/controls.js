/*
 * framed — declarative TV controls. Each control is one focusable row:
 *   Up/Down move between rows (nav engine), Left/Right adjust the value, Enter cycles/acts.
 * spec: { id, name, type: 'range'|'choice'|'swatch'|'action', value, min, max, step, unit,
 *         options:[{value,label,color,disabled}], help, format(v), hidden,
 *         note, gated, fault, confirmOnly }
 * render(container, specs, onChange(id, value, spec)) -> { get, set, setHidden, el(id),
 *         setNote, setGated, setFault }
 * note: a visible reason line (.control__note); gated: reachable but unusable, reason in
 * the note; fault: breach bar + note, OK retries via onChange(id, true, spec, {retry:true}).
 */
window.framed = window.framed || {};
(function (F) {
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function render(container, specs, onChange) {
    // Rebuilding rows destroys the focused element (e.g. changing a filter
    // re-renders its own control). Remember which control held the cursor and
    // put it back on the replacement row, or focus recovery dumps the viewer
    // at the top of the screen.
    var prevFocusId = null;
    if (document.activeElement && container.contains(document.activeElement)) {
      prevFocusId = document.activeElement.getAttribute('data-control-id');
    }
    container.innerHTML = '';
    var rows = {};

    specs.forEach(function (spec) {
      var row = h('div', 'control control--' + spec.type);
      row.setAttribute('data-focusable', '');
      row.setAttribute('tabindex', '-1');
      row.setAttribute('data-control-id', spec.id);
      row.setAttribute('role', spec.type === 'action' ? 'button' : 'group');
      if (spec.type !== 'action') row.setAttribute('data-adjust', 'horizontal');
      if (spec.hidden) row.hidden = true;
      if (spec.gated) row.setAttribute('data-gated', 'true');
      if (spec.fault) row.setAttribute('data-fault', 'true');

      var name = h('span', 'control__name', spec.name);
      var value = h('span', 'control__value');
      var track = h('div', 'control__track');
      row.appendChild(name); row.appendChild(value); row.appendChild(track);
      if (spec.help) row.appendChild(h('div', 'control__help', spec.help));

      var state = { spec: spec, row: row, value: spec.value, valueEl: value, trackEl: track, noteEl: null };
      if (spec.note != null) {
        row.classList.add('control--noted');
        state.noteEl = h('div', 'control__note');
        state.noteEl.innerHTML = spec.note;
        row.appendChild(state.noteEl);
      }
      rows[spec.id] = state;

      if (spec.type === 'range') {
        var bar = h('div', 'range');
        var fill = h('div', 'range__fill');
        var thumb = h('div', 'range__thumb');
        bar.appendChild(fill); bar.appendChild(thumb);
        track.appendChild(bar);
        state.fill = fill; state.thumb = thumb;
        bar.addEventListener('click', function (e) {
          e.stopPropagation();
          var r = bar.getBoundingClientRect();
          var t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          commit(state, snap(spec, spec.min + t * (spec.max - spec.min)));
        });
      } else if (spec.type === 'choice' || spec.type === 'swatch') {
        var wrap = h('div', spec.type === 'swatch' ? 'swatches' : 'choice');
        spec.options.forEach(function (opt) {
          var o = h('button', spec.type === 'swatch' ? 'swatch' : 'choice__opt');
          o.setAttribute('tabindex', '-1');
          o.setAttribute('data-value', String(opt.value));
          if (spec.type === 'swatch') {
            if (opt.color) o.style.background = opt.color; else o.classList.add('swatch--custom');
            o.setAttribute('aria-label', opt.label);
            o.title = opt.label;
          } else {
            o.textContent = opt.label;
          }
          if (opt.disabled) o.setAttribute('data-disabled', 'true');
          o.addEventListener('click', function (e) {
            e.stopPropagation();
            F.nav.focus(row, { noScroll: true });
            commit(state, opt.value);
          });
          wrap.appendChild(o);
        });
        track.appendChild(wrap);
        state.optEls = wrap.children;
      } else if (spec.type === 'action') {
        value.textContent = spec.label || '→';
      }

      row.addEventListener('framed:adjust', function (e) {
        if (spec.gated) { onChange(spec.id, state.value, spec, { rejected: true }); return; }
        if (!adjust(state, e.detail.delta, e.detail.fast)) e.detail.handled = false;
      });
      row.addEventListener('click', function () {
        if (spec.gated) { onChange(spec.id, state.value, spec, { rejected: true }); return; }
        if (spec.fault) { onChange(spec.id, true, spec, { retry: true }); return; }
        if (spec.type === 'action') onChange(spec.id, true, spec);
        else if (spec.confirmOnly) return; // Art values are already applied; OK confirms.
        else if (spec.type === 'choice' || spec.type === 'swatch') adjust(state, 1, false, true);
        else if (spec.type === 'range') adjust(state, 1, false, true);
      });

      paint(state);
      container.appendChild(row);
    });

    function snap(spec, v) {
      var step = spec.step || 1;
      v = Math.round(v / step) * step;
      return Math.max(spec.min, Math.min(spec.max, v));
    }

    // Returns whether the key actually changed (or was consumed by) the row; a
    // no-op at the row's limit lets the nav engine fall through to spatial move.
    function adjust(state, delta, fast, wrap) {
      var spec = state.spec;
      if (spec.type === 'range') {
        var step = (spec.step || 1) * (fast ? (spec.fastStep || 2) : 1);
        var v = snap(spec, state.value + delta * step);
        if (v === state.value && wrap) v = spec.min; // Enter at max wraps to min
        return commit(state, v);
      } else if (spec.type === 'choice' || spec.type === 'swatch') {
        var opts = spec.options, n = opts.length;
        var idx = indexOf(opts, state.value);
        for (var k = 1; k <= n; k++) {
          var j = idx + delta * k;
          if (wrap) j = ((j % n) + n) % n; else if (j < 0 || j >= n) return false;
          if (opts[j].disabled) {
            onChange(spec.id, opts[j].value, spec, { rejected: true });
            if (!wrap) return true; else continue;
          }
          return commit(state, opts[j].value);
        }
      }
      return false;
    }

    function indexOf(opts, v) {
      for (var i = 0; i < opts.length; i++) if (opts[i].value === v) return i;
      return 0;
    }

    function commit(state, v) {
      if (v === state.value) return false;
      state.value = v;
      paint(state);
      onChange(state.spec.id, v, state.spec);
      return true;
    }

    function paint(state) {
      var spec = state.spec;
      if (spec.type === 'range') {
        var t = (state.value - spec.min) / (spec.max - spec.min || 1);
        state.fill.style.width = (t * 100) + '%';
        state.thumb.style.left = (t * 100) + '%';
        state.valueEl.textContent = spec.format ? spec.format(state.value) : (state.value + (spec.unit || ''));
        state.row.setAttribute('aria-valuenow', state.value);
      } else if (spec.type === 'choice' || spec.type === 'swatch') {
        var cur = spec.options[indexOf(spec.options, state.value)];
        state.valueEl.textContent = cur ? cur.label : '';
        for (var i = 0; i < state.optEls.length; i++) {
          state.optEls[i].setAttribute('data-selected', String(spec.options[i].value === state.value));
        }
      }
    }

    if (prevFocusId && rows[prevFocusId] && !rows[prevFocusId].row.hidden &&
        (!document.activeElement || document.activeElement === document.body || !container.contains(document.activeElement))) {
      F.nav.focus(rows[prevFocusId].row);
    }

    function setNote(id, note) {
      var st = rows[id];
      if (!st) return;
      if (note == null || note === '') {
        if (st.noteEl) { st.noteEl.remove(); st.noteEl = null; }
        st.row.classList.remove('control--noted');
        return;
      }
      if (!st.noteEl) {
        st.row.classList.add('control--noted');
        st.noteEl = h('div', 'control__note');
        st.row.appendChild(st.noteEl);
      }
      st.noteEl.innerHTML = note;
    }
    function setGated(id, gated, note) {
      var st = rows[id];
      if (!st) return;
      st.spec.gated = !!gated;
      if (gated) st.row.setAttribute('data-gated', 'true'); else st.row.removeAttribute('data-gated');
      if (note !== undefined) setNote(id, note);
    }
    function setFault(id, fault, note) {
      var st = rows[id];
      if (!st) return;
      st.spec.fault = !!fault;
      if (fault) st.row.setAttribute('data-fault', 'true'); else st.row.removeAttribute('data-fault');
      if (note !== undefined) setNote(id, note);
    }

    return {
      get: function (id) { return rows[id] ? rows[id].value : undefined; },
      set: function (id, v) { if (rows[id]) { rows[id].value = v; paint(rows[id]); } },
      setHidden: function (id, hidden) { if (rows[id]) rows[id].row.hidden = !!hidden; },
      el: function (id) { return rows[id] ? rows[id].row : null; },
      setNote: setNote,
      setGated: setGated,
      setFault: setFault
    };
  }

  F.controls = { render: render };
})(window.framed);

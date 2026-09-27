/* OS97 desktop behaviour: Start menu, clock, windows, taskbar, dialogs. */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var finePointer = window.matchMedia('(pointer: fine) and (min-width: 1024px)');

  /* ---------------- Clock ---------------- */
  var clock = $('#clock');
  function tick() {
    if (!clock) return;
    var now = new Date();
    clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    clock.setAttribute('datetime', now.toISOString());
    clock.title = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  tick();
  setInterval(tick, 15000);

  /* ---------------- Start menu ---------------- */
  var startBtn = $('#start-button');
  var startMenu = $('#start-menu');
  var linksToggle = $('#links-toggle');

  function setStart(open) {
    if (!startBtn || !startMenu) return;
    startMenu.hidden = !open;
    startBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      var first = $('.start-item', startMenu);
      if (first) first.focus({ preventScroll: true });
    } else if (linksToggle) {
      setSub(false);
    }
  }
  function setSub(open) {
    linksToggle.setAttribute('aria-expanded', String(open));
    linksToggle.parentElement.classList.toggle('is-open', open);
  }

  if (startBtn) {
    startBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setStart(startMenu.hidden);
    });
  }
  if (linksToggle) {
    linksToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      setSub(linksToggle.getAttribute('aria-expanded') !== 'true');
      if (linksToggle.getAttribute('aria-expanded') === 'true') {
        var firstSub = $('.start-sub .start-item', linksToggle.parentElement);
        if (firstSub && finePointer.matches) firstSub.focus();
      }
    });
  }
  document.addEventListener('click', function (e) {
    if (startMenu && !startMenu.hidden && !startMenu.contains(e.target)) setStart(false);
  });

  // Keyboard: Esc closes, arrows move through items
  document.addEventListener('keydown', function (e) {
    if (!startMenu || startMenu.hidden) return;
    var items = $$('.start-item', startMenu).filter(function (el) { return el.offsetParent !== null; });
    var i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { setStart(false); startBtn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'ArrowRight' && document.activeElement === linksToggle) { setSub(true); $('.start-sub .start-item', linksToggle.parentElement).focus(); }
    else if (e.key === 'ArrowLeft' && linksToggle && linksToggle.parentElement.contains(document.activeElement) && document.activeElement !== linksToggle) { setSub(false); linksToggle.focus(); }
  });
  // Tab out of the menu closes it
  if (startMenu) {
    startMenu.addEventListener('focusout', function () {
      setTimeout(function () {
        if (!startMenu.contains(document.activeElement) && document.activeElement !== startBtn) setStart(false);
      }, 0);
    });
  }

  /* ---------------- Windows + taskbar ---------------- */
  var windows = $$('[data-window]');
  var tasks = $('#tasks');
  var isHome = document.body.classList.contains('page-home');

  function activate(win) {
    windows.forEach(function (w) {
      var on = w === win;
      w.classList.toggle('is-inactive', !on);
      w.classList.toggle('is-front', on);
      if (w._task) w._task.classList.toggle('is-active', on && !w.classList.contains('is-minimized'));
    });
  }

  function minimize(win) {
    win.classList.add('is-minimized');
    if (win._task) { win._task.classList.remove('is-active'); win._task.setAttribute('aria-pressed', 'false'); }
    var next = windows.filter(function (w) { return !w.classList.contains('is-minimized'); })[0];
    if (next) activate(next);
  }

  function restore(win) {
    win.classList.remove('is-minimized');
    if (win._task) win._task.setAttribute('aria-pressed', 'true');
    activate(win);
  }

  function toggleMax(win) {
    var max = !win.classList.contains('is-maximized');
    win.classList.toggle('is-maximized', max);
    win.style.transform = '';
    var btn = $('.tb-max', win);
    if (btn) {
      btn.setAttribute('aria-label', max ? 'Restore' : 'Maximize');
      $('use', btn).setAttribute('href', max ? '#g-restore' : '#g-max');
    }
    document.body.style.overflow = max ? 'hidden' : '';
  }

  if (windows.length && tasks) {
    tasks.innerHTML = '';
    windows.forEach(function (win) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task';
      btn.setAttribute('aria-pressed', 'true');
      btn.innerHTML = '<svg class="icon icon-16" aria-hidden="true"><use href="#i-' + (win.dataset.icon || 'document') + '"/></svg><span></span>';
      btn.lastChild.textContent = win.dataset.title || document.title;
      btn.title = win.dataset.title || '';
      btn.addEventListener('click', function () {
        if (win.classList.contains('is-minimized')) { restore(win); win.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        else if (win.classList.contains('is-inactive')) activate(win);
        else minimize(win);
      });
      win._task = btn;
      tasks.appendChild(btn);
    });
    activate(windows[0]);
  }

  windows.forEach(function (win) {
    win.addEventListener('pointerdown', function () { if (win.classList.contains('is-inactive')) activate(win); });
    win.addEventListener('focusin', function () { if (win.classList.contains('is-inactive')) activate(win); });

    var minBtn = $('[data-action="minimize"]', win);
    var maxBtn = $('[data-action="maximize"]', win);
    var closeBtn = $('[data-action="close"]', win);
    if (minBtn) minBtn.addEventListener('click', function () { minimize(win); });
    if (maxBtn) maxBtn.addEventListener('click', function () { toggleMax(win); });
    // On the home page "close" just hides the window; elsewhere it navigates home (plain link)
    if (closeBtn && isHome) closeBtn.addEventListener('click', function (e) { e.preventDefault(); minimize(win); });

    var bar = $('.title-bar', win);
    if (!bar) return;
    bar.addEventListener('dblclick', function (e) {
      if (e.target.closest('.title-bar-controls')) return;
      toggleMax(win);
    });

    // Drag windows by their title bar (desktop only). Double-click resets.
    var drag = null;
    bar.addEventListener('pointerdown', function (e) {
      if (!finePointer.matches || e.button !== 0 || e.target.closest('.title-bar-controls') || win.classList.contains('is-maximized')) return;
      var m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(win.style.transform || '');
      var oy = m ? +m[2] : 0;
      drag = { x: e.clientX, y: e.clientY, ox: m ? +m[1] : 0, oy: oy, baseTop: win.getBoundingClientRect().top - oy, moved: false };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      win.classList.add('is-dragging');
      var ny = drag.oy + dy;
      if (drag.baseTop + ny < 0) ny = -drag.baseTop;   // keep the title bar on screen
      win.style.transform = 'translate(' + (drag.ox + dx) + 'px,' + ny + 'px)';
    });
    function endDrag() { if (drag) { drag = null; win.classList.remove('is-dragging'); } }
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var max = $('.window.is-maximized');
    if (max && !document.body.classList.contains('lb-open')) toggleMax(max);
  });

  /* ---------------- Shut down dialog ---------------- */
  var dlg = $('#shutdown-dialog');
  var safeOff = $('#safe-off');
  var lastFocus = null;

  function openDialog() {
    setStart(false);
    lastFocus = document.activeElement;
    dlg.hidden = false;
    var checked = $('input:checked', dlg);
    if (checked) checked.focus();
  }
  function closeDialog() {
    dlg.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $$('[data-action="shutdown"]').forEach(function (b) { b.addEventListener('click', openDialog); });
  $$('[data-action="dialog-cancel"]').forEach(function (b) { b.addEventListener('click', closeDialog); });
  if (dlg) {
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDialog();
      if (e.key === 'Tab') {                         // trap focus inside the dialog
        var f = $$('button, input:checked', dlg);
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDialog(); });
    $('#shutdown-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var choice = $('input:checked', dlg).value;
      dlg.hidden = true;
      if (choice === 'restart') location.reload();
      else if (choice === 'home') location.href = '/';
      else { safeOff.hidden = false; safeOff.focus(); }
    });
  }
  if (safeOff) {
    var wake = function () { safeOff.hidden = true; if (startBtn) startBtn.focus(); };
    safeOff.addEventListener('click', wake);
    safeOff.addEventListener('keydown', wake);
  }

  /* ---------------- Tabs: highlight the section in view ---------------- */
  var tabLinks = $$('.tabs a[href^="#"]');
  if (tabLinks.length && 'IntersectionObserver' in window) {
    var sections = tabLinks.map(function (a) { return document.getElementById(a.hash.slice(1)); }).filter(Boolean);
    var setCurrent = function (id) {
      tabLinks.forEach(function (a) { a.classList.toggle('is-current', a.hash === '#' + id); });
    };
    setCurrent(sections[0].id);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setCurrent(en.target.id); });
    }, { rootMargin: '-10% 0px -70% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ---------------- Gallery: arrange by country / date ---------------- */
  var gallery = $('#gallery');
  var groupsWrap = $('#album-groups');
  var flat = $('#album-flat');
  if (gallery && groupsWrap && flat) {
    var albums = $$('.album-item', groupsWrap);
    albums.forEach(function (li) { li._home = li.parentElement; });
    var arrangeBtns = $$('[data-arrange]', gallery);
    var orderBtn = $('[data-order]', gallery);
    var state = { arrange: 'country', order: 'desc' };
    try {
      var saved2 = JSON.parse(localStorage.getItem('galleryArrange') || '{}');
      if (saved2.arrange === 'date' || saved2.arrange === 'country') state.arrange = saved2.arrange;
      if (saved2.order === 'asc' || saved2.order === 'desc') state.order = saved2.order;
    } catch (err) { /* ignore */ }
    // A link to a country section (e.g. the album page's "Up" button) needs the grouped view
    var jumpTo = location.hash && document.getElementById(location.hash.slice(1));
    if (jumpTo && jumpTo.classList.contains('album-group')) state.arrange = 'country';

    // newest first: by last photo date; oldest first: by first photo date
    var byDate = function (a, b) {
      var ka = state.order === 'desc' ? a.dataset.to + a.dataset.from : a.dataset.from + a.dataset.to;
      var kb = state.order === 'desc' ? b.dataset.to + b.dataset.from : b.dataset.from + b.dataset.to;
      return state.order === 'desc' ? (kb > ka ? 1 : kb < ka ? -1 : 0) : (ka > kb ? 1 : ka < kb ? -1 : 0);
    };

    var arrange = function (save) {
      var sorted = albums.slice().sort(byDate);
      var byCountry = state.arrange === 'country';
      sorted.forEach(function (li) { (byCountry ? li._home : flat).appendChild(li); });
      groupsWrap.hidden = !byCountry;
      flat.hidden = byCountry;
      gallery.classList.toggle('is-by-date', !byCountry);
      arrangeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.arrange === state.arrange)); });
      var desc = state.order === 'desc';
      orderBtn.dataset.order = state.order;
      $('span', orderBtn).textContent = desc ? 'Newest first' : 'Oldest first';
      $('use', orderBtn).setAttribute('href', desc ? '#g-down' : '#g-up');
      orderBtn.setAttribute('aria-label', 'Sort order: ' + (desc ? 'newest' : 'oldest') + ' first. Click for ' + (desc ? 'oldest' : 'newest') + ' first.');
      if (save) {
        try { localStorage.setItem('galleryArrange', JSON.stringify(state)); } catch (err) { /* private mode */ }
      }
    };

    arrangeBtns.forEach(function (b) {
      b.addEventListener('click', function () { state.arrange = b.dataset.arrange; arrange(true); });
    });
    orderBtn.addEventListener('click', function () { state.order = state.order === 'desc' ? 'asc' : 'desc'; arrange(true); });
    $('.gallery-toolbar', gallery).hidden = false;   // only useful with JS
    arrange(false);
    if (jumpTo) jumpTo.scrollIntoView();
  }

  /* ---------------- Album thumbnail size toggle ---------------- */
  var grid = $('.photo-grid');
  var sizeBtns = $$('[data-thumbs]');
  if (grid && sizeBtns.length) {
    var apply = function (size) {
      grid.classList.toggle('is-small', size === 'small');
      sizeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.thumbs === size)); });
      try { localStorage.setItem('thumbs', size); } catch (err) { /* private mode */ }
    };
    var saved = null;
    try { saved = localStorage.getItem('thumbs'); } catch (err) { /* ignore */ }
    if (saved) apply(saved);
    sizeBtns.forEach(function (b) { b.addEventListener('click', function () { apply(b.dataset.thumbs); }); });
  }
})();

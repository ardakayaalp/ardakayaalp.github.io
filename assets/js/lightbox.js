/* OS97 Image Viewer: lightbox + slideshow for album pages.
   Keys: ← → navigate · Space play/pause · F fullscreen · Esc close.
   Touch: swipe left/right to navigate, swipe down to close.
   Deep links: /gallery/album/#photo-5 opens the 5th photo. */
(function () {
  'use strict';

  var grid = document.querySelector('[data-gallery]');
  if (!grid) return;

  var links = Array.prototype.slice.call(grid.querySelectorAll('a.photo'));
  if (!links.length) return;

  var INTERVAL = 4000;
  var photos = links.map(function (a) {
    return { src: a.href, caption: a.dataset.caption || '', name: a.dataset.name || '', date: formatDate(a.dataset.date) };
  });
  var albumTitle = grid.dataset.albumTitle || document.title;

  // "2025-09-15" -> "15 Sep 2025", same style as the album dates (browsers disagree on "Sep"/"Sept")
  function formatDate(iso) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? (+m[3]) + ' ' + months[+m[2] - 1] + ' ' + m[1] : '';
  }

  var idx = 0, timer = null, playing = false, lastFocus = null, root = null, els = {};

  function icon(id) { return '<svg aria-hidden="true"><use href="#' + id + '"/></svg>'; }

  function build() {
    root = document.createElement('div');
    root.className = 'lb';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Image viewer');
    root.innerHTML =
      '<div class="window">' +
        '<div class="title-bar">' +
          '<div class="title-bar-text"><svg class="icon icon-16" aria-hidden="true"><use href="#i-pictures"/></svg><span class="lb-title"></span></div>' +
          '<div class="title-bar-controls"><button type="button" class="tb-btn" data-lb="close" aria-label="Close viewer">' + icon('g-close') + '</button></div>' +
        '</div>' +
        '<div class="lb-stage">' +
          '<div class="lb-spinner">Loading…</div>' +
          '<img class="lb-img" alt="">' +
          '<button type="button" class="lb-zone lb-zone--prev" data-lb="prev" aria-label="Previous photo"><span>' + icon('g-left') + '</span></button>' +
          '<button type="button" class="lb-zone lb-zone--next" data-lb="next" aria-label="Next photo"><span>' + icon('g-right') + '</span></button>' +
        '</div>' +
        '<div class="lb-progress"><span></span></div>' +
        '<div class="lb-controls">' +
          '<button type="button" class="btn" data-lb="prev" aria-label="Previous">' + icon('g-left') + '</button>' +
          '<button type="button" class="btn lb-play" data-lb="play" aria-label="Play slideshow">' + icon('g-play') + '<span class="lb-play-label">Play</span></button>' +
          '<button type="button" class="btn" data-lb="next" aria-label="Next">' + icon('g-right') + '</button>' +
          '<span class="lb-counter" aria-live="polite"></span>' +
          '<p class="lb-caption"></p>' +
          '<time class="lb-date"></time>' +
          '<button type="button" class="btn lb-fs" data-lb="fullscreen" aria-label="Full screen">' + icon('g-full') + '</button>' +
          '<a class="btn" data-lb="open" target="_blank" rel="noopener" aria-label="Open original">' + icon('g-max') + '</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    els.win = root.querySelector('.window');
    els.stage = root.querySelector('.lb-stage');
    els.img = root.querySelector('.lb-img');
    els.spinner = root.querySelector('.lb-spinner');
    els.title = root.querySelector('.lb-title');
    els.counter = root.querySelector('.lb-counter');
    els.caption = root.querySelector('.lb-caption');
    els.date = root.querySelector('.lb-date');
    els.progress = root.querySelector('.lb-progress');
    els.play = root.querySelector('.lb-play');
    els.open = root.querySelector('[data-lb="open"]');
    els.progress.style.setProperty('--lb-interval', INTERVAL + 'ms');

    if (!document.fullscreenEnabled) root.querySelector('.lb-fs').hidden = true;

    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lb]');
      if (!b) { if (e.target === root) close(); return; }
      var act = b.dataset.lb;
      if (act === 'close') close();
      else if (act === 'prev') { stop(); show(idx - 1); }
      else if (act === 'next') { stop(); show(idx + 1); }
      else if (act === 'play') toggle();
      else if (act === 'fullscreen') fullscreen();
    });

    els.img.addEventListener('load', function () {
      els.img.classList.remove('is-loading');
      els.spinner.hidden = true;
      if (playing) restartProgress();
    });
    els.img.addEventListener('error', function () {
      els.spinner.hidden = false;
      els.spinner.textContent = 'Could not load this photo.';
    });

    // swipe
    var sx = 0, sy = 0, st = 0, tracking = false;
    els.stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      tracking = true; sx = e.clientX; sy = e.clientY; st = Date.now();
    });
    els.stage.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy, dt = Date.now() - st;
      if (dt > 800) return;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { stop(); show(idx + (dx < 0 ? 1 : -1)); }
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) close();
    });
    els.stage.addEventListener('pointercancel', function () { tracking = false; });

    root.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {                     // keep focus inside the viewer
        var f = Array.prototype.slice.call(root.querySelectorAll('button:not([hidden]), a[href]')).filter(function (el) { return el.offsetParent !== null; });
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  function preload(i) {
    var p = photos[(i + photos.length) % photos.length];
    if (p && !p._pre) { var im = new Image(); im.src = p.src; p._pre = true; }
  }

  function show(i) {
    idx = (i + photos.length) % photos.length;
    var p = photos[idx];
    if (els.img.getAttribute('src') !== p.src) {
      els.img.classList.add('is-loading');
      els.spinner.hidden = false;
      els.spinner.textContent = 'Loading…';
      els.img.src = p.src;
    }
    els.img.alt = p.caption || p.name;
    els.title.textContent = (p.caption || p.name) + ' - ' + albumTitle;
    els.counter.textContent = (idx + 1) + ' / ' + photos.length;
    els.caption.textContent = p.caption;
    els.date.textContent = p.date;
    els.date.hidden = !p.date;
    els.open.href = p.src;
    if (els.img.complete && els.img.naturalWidth) {
      els.img.classList.remove('is-loading');
      els.spinner.hidden = true;
      if (playing) restartProgress();
    }
    preload(idx + 1);
    preload(idx - 1);
    try { history.replaceState(null, '', '#photo-' + (idx + 1)); } catch (e) { /* file:// */ }
  }

  function open(i, autoplay) {
    if (!root) build();
    lastFocus = document.activeElement;
    root.hidden = false;
    document.body.classList.add('lb-open');
    show(i);
    els.play.focus();   // Space then toggles the slideshow (Esc closes)
    document.addEventListener('keydown', onKey);
    if (autoplay) play();
  }

  function close() {
    stop();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    root.hidden = true;
    document.body.classList.remove('lb-open');
    document.removeEventListener('keydown', onKey);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    var link = links[idx];
    (link || lastFocus || document.body).focus();
  }

  function restartProgress() {
    els.progress.classList.remove('is-running');
    void els.progress.offsetWidth;            // restart CSS animation
    els.progress.classList.add('is-running');
    clearTimeout(timer);
    timer = setTimeout(function () { show(idx + 1); }, INTERVAL);
  }

  function play() {
    playing = true;
    els.play.querySelector('use').setAttribute('href', '#g-pause');
    els.play.querySelector('.lb-play-label').textContent = 'Pause';
    els.play.setAttribute('aria-label', 'Pause slideshow');
    if (els.img.complete && els.img.naturalWidth) restartProgress();
  }
  function stop() {
    if (!playing) return;
    playing = false;
    clearTimeout(timer);
    els.progress.classList.remove('is-running');
    els.play.querySelector('use').setAttribute('href', '#g-play');
    els.play.querySelector('.lb-play-label').textContent = 'Play';
    els.play.setAttribute('aria-label', 'Play slideshow');
  }
  function toggle() { if (playing) stop(); else play(); }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); stop(); show(idx + 1); break;
      case 'ArrowLeft': e.preventDefault(); stop(); show(idx - 1); break;
      case 'Home': e.preventDefault(); stop(); show(0); break;
      case 'End': e.preventDefault(); stop(); show(photos.length - 1); break;
      case 'Escape': if (!document.fullscreenElement) close(); break;
      case ' ':
        if (document.activeElement && document.activeElement.matches('button, a')) return;
        e.preventDefault(); toggle(); break;
      case 'f': case 'F': fullscreen(); break;
    }
  }

  // Pause the slideshow while the tab is hidden
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });

  links.forEach(function (a, i) {
    a.addEventListener('click', function (e) {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;   // allow "open in new tab"
      e.preventDefault();
      open(i, false);
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-slideshow]'), function (b) {
    b.addEventListener('click', function () { open(0, true); });
  });

  var m = /^#photo-(\d+)$/.exec(location.hash);
  if (m) {
    var n = parseInt(m[1], 10) - 1;
    if (n >= 0 && n < photos.length) open(n, false);
  }
})();

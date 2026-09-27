/* Tag filter for the Updates page (?tag=name keeps the filter shareable). */
(function () {
  'use strict';
  var list = document.getElementById('update-list');
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  if (!list || !buttons.length) return;
  var items = Array.prototype.slice.call(list.children);
  var empty = document.getElementById('no-results');

  function apply(tag, push) {
    var shown = 0;
    items.forEach(function (li) {
      var tags = (li.dataset.tags || '').split('|');
      var match = !tag || tags.indexOf(tag) !== -1;
      li.hidden = !match;
      if (match) shown++;
    });
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === tag)); });
    if (empty) empty.hidden = shown > 0;
    if (push) {
      var url = tag ? '?tag=' + encodeURIComponent(tag) : location.pathname;
      history.replaceState(null, '', url);
    }
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () { apply(b.dataset.filter, true); });
  });
  list.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tag]');
    if (!t) return;
    e.preventDefault();
    apply(t.dataset.tag, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  var initial = new URLSearchParams(location.search).get('tag');
  if (initial) apply(initial, false);
})();

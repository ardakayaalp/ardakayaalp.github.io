/* OS97 cross-references for updates: numbered figures with captions, numbered sections,
   and clickable references, written in the Markdown like this:

     ![Caption text, *italics* allowed.](figures/plot.png){#fig:plot}   numbered figure (label optional)
     ## Results {#sec:results}                                           numbered section (label optional)
     As @fig:plot shows (see @sec:results) ...                           "Figure 1" / "Section 2" links

   Headings without a label can still be referenced by their automatic id, e.g. "## Main results"
   -> @sec:main-results. Unknown labels show as "Figure ??" so typos are easy to spot.
   Equations: use \label{eq:x} and \eqref{eq:x} (handled by MathJax). */
(function () {
  'use strict';

  var root = document.querySelector('.prose[data-crossref]');
  if (!root) return;
  var numberSections = root.getAttribute('data-section-numbers') !== 'false';
  root.classList.add('xref-ready');                  // lets CSS style what is left (e.g. inline images)
  var labels = {};                                   // id -> text used by references

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  // Captions come from the image's alt text (plain text), so allow a little Markdown in them.
  function formatCaption(text) {
    return escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function isBlank(node) {
    return node.nodeType === 3 ? !node.textContent.trim() : node.nodeName === 'BR';
  }

  /* ---- 1. Figures: an image alone in its paragraph, optionally followed by {#fig:label} ---- */
  var figN = 0;
  Array.prototype.slice.call(root.querySelectorAll('p > img')).forEach(function (img) {
    var p = img.parentNode;
    var label = null, standalone = true;
    Array.prototype.forEach.call(p.childNodes, function (n) {
      if (n === img || isBlank(n)) return;
      var m = n.nodeType === 3 && /^\s*\{#([\w:.\-]+)\}\s*$/.exec(n.textContent);
      if (m && !label) label = m[1];
      else standalone = false;
    });
    if (!standalone) return;                          // images inside running text stay as they are

    figN++;
    var fig = document.createElement('figure');
    fig.className = 'figure';
    fig.id = label || 'figure-' + figN;
    var link = document.createElement('a');           // click the image to open it full size
    link.className = 'figure-img';
    link.href = img.getAttribute('src');
    link.target = '_blank';
    link.rel = 'noopener';
    link.appendChild(img);
    var cap = document.createElement('figcaption');
    cap.innerHTML = '<span class="figure-num">Figure ' + figN + '.</span> ' + formatCaption(img.getAttribute('alt') || '');
    fig.appendChild(link);
    fig.appendChild(cap);
    p.parentNode.replaceChild(fig, p);
    labels[fig.id] = 'Figure ' + figN;
  });

  /* ---- 2. Sections: number h2 (1, 2, ...) and h3 (1.1, 1.2, ...), add a link mark ---- */
  var h2 = 0, h3 = 0;
  Array.prototype.forEach.call(root.querySelectorAll('h2, h3'), function (h) {
    var title = h.textContent.trim();
    if (!h.id) h.id = title.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
    var num;
    if (h.tagName === 'H2') { h2++; h3 = 0; num = String(h2); }
    else { h3++; num = h2 ? h2 + '.' + h3 : String(h3); }
    if (numberSections) {
      var s = document.createElement('span');
      s.className = 'sec-num';
      s.textContent = num;
      h.insertBefore(document.createTextNode(' '), h.firstChild);
      h.insertBefore(s, h.firstChild);
    }
    var a = document.createElement('a');
    a.className = 'heading-anchor';
    a.href = '#' + h.id;
    a.setAttribute('aria-label', 'Link to this section');
    a.title = 'Link to this section';
    a.textContent = '#';
    h.appendChild(a);
    labels[h.id] = numberSections ? 'Section ' + num : title;
  });

  /* ---- 3. References: @fig:label / @sec:label in the text ---- */
  function resolve(kind, key) {
    if (labels[key]) return { id: key, text: labels[key] };
    var bare = key.replace(/^(fig|sec)[:\-]/, '');     // "@sec:main-results" -> automatic id "main-results"
    if (labels[bare]) return { id: bare, text: labels[bare] };
    return null;
  }
  var refRe = /@((fig|sec)[:\-][\w.:\-]*\w)/g;
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      if (n.parentNode.closest('code, pre, a, script, .MathJax')) return NodeFilter.FILTER_REJECT;
      return n.textContent.indexOf('@') !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  var textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(function (node) {
    var text = node.textContent, last = 0, m, frag = document.createDocumentFragment(), found = false;
    refRe.lastIndex = 0;
    while ((m = refRe.exec(text))) {
      found = true;
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var target = resolve(m[2], m[1]);
      var el;
      if (target) {
        el = document.createElement('a');
        el.className = 'xref';
        el.href = '#' + target.id;
        el.textContent = target.text;
      } else {
        el = document.createElement('span');
        el.className = 'xref xref--missing';
        el.title = 'No figure or section with the label "' + m[1] + '"';
        el.textContent = (m[2] === 'fig' ? 'Figure' : 'Section') + ' ??';
      }
      frag.appendChild(el);
      last = m.index + m[0].length;
    }
    if (!found) return;
    frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });

  /* ---- 4. Jumping to a figure/section: scroll there and flash it briefly ---- */
  function flash(id) {
    var el = id && document.getElementById(id);
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;                               // restart the animation
    el.classList.add('is-flash');
    setTimeout(function () { el.classList.remove('is-flash'); }, 1700);
  }
  window.addEventListener('hashchange', function () { flash(decodeURIComponent(location.hash.slice(1))); });
  root.addEventListener('click', function (e) {          // same link clicked again: no hashchange event
    var a = e.target.closest('a.xref, a.heading-anchor');
    if (a && a.hash === location.hash) flash(decodeURIComponent(a.hash.slice(1)));
  });
  // Figures only get their ids now, so a link like ...#fig:plot needs a manual jump on load.
  if (location.hash) {
    var initial = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (initial && root.contains(initial)) { initial.scrollIntoView(); flash(initial.id); }
  }
})();

// A tiny client-side router for the SPA fixtures (plan M5-E2, handoff to the M6 e2e suite).
// Each shell (docusaurus.html, mkdocs.html, gitbook.html) sets window.SPA before loading this:
//   { site, mount: CSS selector of the element whose content changes per route,
//     mode: 'swap' (render at once) | 'skeleton' (a placeholder first, the page after `delay` ms),
//     wrap(page): the site's markup for a page }
// Routes are ?p=<id>, so a reload of any route serves the same file. Links with data-p navigate
// with history.pushState, like a docs SPA. The text is original filler (MIT, this repository).
(function () {
  'use strict';
  var NOTE = 'Note: every example in this guide assumes Quillmark 3.2 or later, installed with the default plugins. Older releases name some options differently; the migration page lists each rename.';
  var NEXT = ['Read the configuration reference for every option.', 'Join the community forum to ask questions.', 'Report a problem on the issue tracker.'];
  var PAGES = {
    intro: {
      title: 'Introduction',
      paras: [
        'Quillmark turns a folder of Markdown files into a documentation site that loads fast and reads well on any screen. It keeps the source in plain text, so writers and reviewers can work with the tools they already use.',
        'This guide walks through the ideas behind Quillmark: pages, sections, and the build step that ties them together. Each idea comes with a short example that you can copy into a new project and change to suit your needs.',
        'By the end of the guide you will have a small site with a home page, two sections, and a search box. The same structure scales to hundreds of pages without any change to the configuration.',
      ],
      code: 'quill new my-docs\ncd my-docs\nquill serve',
    },
    install: {
      title: 'Installation',
      paras: [
        'Quillmark runs on any machine with a recent JavaScript runtime. The installer checks the version for you and explains how to upgrade when it is too old, so you do not need to look it up first.',
        'Install the command line tool once per machine. It brings the build step, a local preview server, and a checker that finds broken links before your readers do.',
        'If you work behind a company proxy, set the proxy variables before you run the installer. The tool reads the same variables as most package managers, so no extra configuration is needed.',
      ],
      code: 'npm install --global quillmark\nquill --version',
    },
    config: {
      title: 'Configuration',
      paras: [
        'A project is configured in one file at its root. Every option has a sensible default, so a new project starts with an empty file and grows only when you need something different.',
        'Options are grouped by what they change: the look of the site, the way pages are ordered, and what the search index contains. Each group can be split into its own file when the main one grows long.',
        'When an option is spelled wrong, the build stops and names the closest valid option. This keeps a typo from silently turning a feature off on the published site.',
      ],
      code: 'title: My docs\ntheme: plain\nsearch:\n  enabled: true',
    },
  };
  var ORDER = ['intro', 'install', 'config'];
  var spa = window.SPA;
  var esc = function (s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  };
  var page = function (id) {
    var p = PAGES[id];
    return {
      id: id,
      title: p.title,
      body:
        '<h1>' + esc(p.title) + '</h1>' +
        '<div class="admonition note"><p>' + esc(NOTE) + '</p></div>' +
        p.paras.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') +
        '<pre><code>' + esc(p.code) + '</code></pre>' +
        '<h2>Next steps</h2><ul>' + NEXT.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>',
    };
  };
  var current = function () {
    var id = new URLSearchParams(location.search).get('p');
    return id && PAGES[id] ? id : ORDER[0];
  };
  var mount = function () {
    return document.querySelector(spa.mount);
  };
  var render = function (id, instant) {
    var p = page(id);
    var done = function () {
      mount().innerHTML = spa.wrap(p);
      document.title = p.title + ' | ' + spa.site;
    };
    var links = document.querySelectorAll('a[data-p]');
    for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('data-p') === id);
    if (spa.mode === 'skeleton' && !instant) {
      mount().innerHTML = '<div class="skeleton" aria-busy="true"></div>';
      setTimeout(done, spa.delay || 300);
    } else done();
  };
  var go = function (id) {
    history.pushState({ p: id }, '', '?p=' + id);
    render(id, false);
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-p]');
    if (!a) return;
    e.preventDefault();
    go(a.getAttribute('data-p'));
  });
  window.addEventListener('popstate', function () {
    render(current(), false);
  });
  // Test hooks: the changes an SPA makes without a route change.
  window.__spa = {
    pages: ORDER.slice(),
    go: go,
    /** The same route rendered again from scratch: every node is new, nothing changed. */
    rerender: function () {
      render(current(), true);
    },
    /** A banner inserted above the layout: every domPath after it shifts. */
    banner: function () {
      var b = document.createElement('div');
      b.className = 'banner';
      b.textContent = 'This site uses cookies for analytics. OK';
      document.body.insertBefore(b, document.body.firstChild);
    },
    /** Late content on the same route (a lazy section). */
    append: function (text) {
      var p = document.createElement('p');
      p.textContent = text;
      mount().querySelector('article, .md-content__inner, .page-body').appendChild(p);
    },
    /** One block's text changes in place. */
    edit: function (text) {
      mount().querySelectorAll('article p, .md-content__inner p, .page-body p')[1].textContent = text;
    },
  };
  var nav = '';
  for (var i = 0; i < ORDER.length; i++) nav += '<li><a href="?p=' + ORDER[i] + '" data-p="' + ORDER[i] + '">' + PAGES[ORDER[i]].title + '</a></li>';
  var navEl = document.querySelector('[data-spa-nav]');
  if (navEl) navEl.innerHTML = nav;
  render(current(), true);
})();

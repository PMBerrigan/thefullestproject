/**
 * TFP Review Portal — vanilla JS client for the tfp-admin-api worker.
 *
 * Auth: GitHub OAuth via the existing decap-oauth worker popup (same login
 * Decap CMS uses), with a personal-access-token paste fallback. The popup
 * flow only completes on the production origin — use the PAT box or ?mock=1
 * on localhost.
 */
(function() {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  var ADMIN_API = 'https://tfp-admin-api.patrick-m-berrigan.workers.dev';
  var OAUTH_URL = 'https://decap-oauth.patrick-m-berrigan.workers.dev/auth?provider=github&scope=repo';
  var OAUTH_ORIGIN = 'https://decap-oauth.patrick-m-berrigan.workers.dev';
  var TOKEN_KEY = 'tfpAdminToken';
  var MOCK = new URLSearchParams(location.search).get('mock') === '1';
  var APPROVE_CHUNK = 10; // items per /approve call during approve-all

  var ORIGIN_STYLES = {
    'submission':   { bg: 'var(--color-primary)',   label: 'Site Form' },
    'quick-submit': { bg: 'var(--color-secondary)', label: 'Quick Submit' },
    'scraper':      { bg: 'var(--color-accent)',    label: 'Scraper' },
    'bulk-import':  { bg: 'var(--color-text-light)', label: 'Bulk Import' }
  };
  var TYPE_LABELS = {
    submission: 'Website Submissions',
    resource: 'Scraped Resources',
    story: 'Stories & News',
    spotlight: 'Spotlights',
    blog: 'Blog Articles'
  };
  var TYPE_ORDER = ['submission', 'resource', 'story', 'spotlight', 'blog'];

  var state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    user: null,
    queue: { items: [], loaded: false },
    taxonomies: { categories: [], locations: [] },
    siteIndex: null,
    bulk: { rows: [], headers: [], mapping: {} },
    loadedTabs: {}
  };

  // ── Tiny DOM helpers ──────────────────────────────────────────────────────
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function byId(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function toast(message, isError) {
    var t = el('div', 'px-4 py-3 rounded-lg shadow-lg text-sm font-semibold text-white', message);
    t.style.backgroundColor = isError ? 'var(--color-error)' : 'var(--color-primary)';
    byId('toast-region').appendChild(t);
    setTimeout(function() { t.remove(); }, 5000);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function isoWeekKey(iso) {
    var d = new Date((iso || '').slice(0, 10) + 'T12:00:00');
    if (isNaN(d)) return null;
    // Thursday algorithm
    var t = new Date(d);
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    var week1 = new Date(t.getFullYear(), 0, 4);
    var week = 1 + Math.round(((t - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return t.getFullYear() + '-W' + String(week).padStart(2, '0');
  }
  function mondayOf(iso) {
    var d = new Date((iso || '').slice(0, 10) + 'T12:00:00');
    if (isNaN(d)) return '';
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }

  // ── API ───────────────────────────────────────────────────────────────────
  function apiFetch(path, opts) {
    if (MOCK) return mockFetch(path, opts);
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, {
      'Authorization': 'token ' + state.token
    });
    if (opts.body && typeof opts.body === 'string') {
      opts.headers['Content-Type'] = 'application/json';
    }
    return fetch(ADMIN_API + path, opts).then(function(res) {
      if (res.status === 401) {
        signOut('Session expired — please sign in again.');
        throw new Error('Signed out');
      }
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
        return data;
      });
    });
  }

  // ── Mock fixtures (for local dev: /admin/review/?mock=1) ─────────────────
  function mockFetch(path) {
    var fixtures = {
      '/pending': { items: [
        { id: 'sub-20260612-aaaa1111', type: 'submission', status: 'pending', file: 'pending/submissions.json',
          origin: { type: 'quick-submit', detail: 'bookmarklet', submittedAt: '2026-06-11T10:00:00Z' },
          targetFile: 'src/_data/resources/states/VA.json',
          payload: { name: 'Example Respite House', category: ['respite'], location: 'Virginia', description: 'Weekend respite care for families.', website: 'https://example.org', phone: '', source: 'https://example.org', lastScraped: '2026-06-11' } },
        { id: 'res-20260612-bbbb2222', type: 'resource', status: 'pending', file: 'pending/scraped/2026-06-12-resources.json',
          origin: { type: 'scraper', detail: 'national_resources', submittedAt: '2026-06-12T00:01:00Z' },
          targetFile: 'src/_data/resources/national.json',
          payload: { name: 'Adaptive Sports Fund', category: ['sports'], location: 'National', description: 'Grants for adaptive sports equipment.', website: 'https://example.com/asf', phone: '', source: 'https://example.com/asf', lastScraped: '2026-06-12' } },
        { id: 'sty-20260612-cccc3333', type: 'story', status: 'pending', file: 'pending/scraped/2026-06-12-storys.json',
          origin: { type: 'scraper', detail: 'positive_stories', submittedAt: '2026-06-12T00:02:00Z' },
          payload: { title: 'Local teen wins adaptive surfing title', sourceName: 'Example News', sourceUrl: 'https://news.example.com/surf', excerpt: 'An inspiring win on the waves.', category: 'Achievement', date: '2026-06-10' } },
        { id: 'blg-20260612-dddd4444', type: 'blog', status: 'pending', file: 'pending/scraped/2026-06-12-blogs.json',
          origin: { type: 'scraper', detail: 'blog_content', submittedAt: '2026-06-12T00:03:00Z' },
          payload: { title: 'New IEP toolkit released for parents', source: 'Example Times', url: 'https://times.example.com/iep', date: '2026-06-11', category: 'Education', slug: 'new-iep-toolkit-released-for-parents' } }
      ], counts: { submission: 1, resource: 1, story: 1, blog: 1 } },
      '/emails': { total: 3, contacts: [
        { email: 'demo1@example.com', dateAdded: '2026-06-01', source: 'newsletter-form', optIn: 'confirmed' },
        { email: 'demo2@example.com', dateAdded: '2026-06-08', source: 'resource-submission', optIn: 'transactional_only' },
        { email: 'demo3@example.com', dateAdded: '2026-06-10', source: 'newsletter-form', optIn: 'pending_doi' }
      ] },
      '/draft-description': {
        description: 'A pediatric therapy clinic offering physical and occupational therapy for children with developmental and neurological conditions.',
        grounded: true
      },
      '/newsletter-drafts': { drafts: [
        { id: 'nld-20260706-demo1', sourceId: 'sub-20260612-aaaa1111', type: 'resource', flaggedAt: '2026-07-06T02:00:00Z',
          payload: { name: 'Example Respite House', category: ['respite'], location: 'Virginia', website: 'https://example.org' },
          paragraph: 'Example Respite House offers weekend respite care for families in Northern Virginia. It can be a lifeline when caregivers need a planned break, and its sliding-scale pricing makes it accessible to more families.' }
      ] }
    };
    if (fixtures[path.split('?')[0]]) {
      return Promise.resolve(fixtures[path.split('?')[0]]);
    }
    // approve / reject / bulk-import in mock mode just succeed
    return Promise.resolve({ approved: [], rejected: [], failed: [], queued: [], mock: true });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  function signIn() {
    var status = byId('login-status');
    status.textContent = 'Opening GitHub… if nothing happens, allow popups for this site.';
    var popup = window.open(OAUTH_URL, 'tfp-oauth', 'width=600,height=700');
    if (!popup) {
      status.textContent = 'Popup blocked — allow popups or use a personal access token below.';
      return;
    }
    function onMessage(e) {
      if (e.origin !== OAUTH_ORIGIN) return;
      if (e.data === 'authorizing:github') {
        e.source.postMessage(e.data, e.origin);
        return;
      }
      if (typeof e.data === 'string' && e.data.indexOf('authorization:github:success:') === 0) {
        window.removeEventListener('message', onMessage);
        try {
          var payload = JSON.parse(e.data.slice('authorization:github:success:'.length));
          acceptToken(payload.token);
        } catch (err) {
          status.textContent = 'Sign-in failed: could not read the login response.';
        }
      } else if (typeof e.data === 'string' && e.data.indexOf('authorization:github:error:') === 0) {
        window.removeEventListener('message', onMessage);
        status.textContent = 'Sign-in failed — try again or use a personal access token.';
      }
    }
    window.addEventListener('message', onMessage);
  }

  function acceptToken(token) {
    var status = byId('login-status');
    if (!token) { status.textContent = 'No token received.'; return; }
    status.textContent = 'Verifying…';
    fetch('https://api.github.com/user', {
      headers: { Authorization: 'token ' + token }
    }).then(function(res) {
      if (!res.ok) throw new Error('GitHub rejected the token');
      return res.json();
    }).then(function(user) {
      state.token = token;
      state.user = user;
      sessionStorage.setItem(TOKEN_KEY, token);
      showApp();
    }).catch(function(err) {
      status.textContent = 'Sign-in failed: ' + err.message;
    });
  }

  function signOut(message) {
    sessionStorage.removeItem(TOKEN_KEY);
    state.token = '';
    state.user = null;
    byId('app-view').hidden = true;
    byId('login-view').hidden = false;
    if (message) byId('login-status').textContent = message;
  }

  function showApp() {
    byId('login-view').hidden = true;
    byId('app-view').hidden = false;
    if (state.user) {
      var avatar = byId('user-avatar');
      avatar.src = state.user.avatar_url || '';
      avatar.hidden = !state.user.avatar_url;
      byId('user-login').textContent = state.user.login || '';
    }
    loadSiteIndex();
    activateTab('queue');
    revealEditStudio();
  }

  // Edit Studio only exists in the build when site.inlineEditor.enabled is true,
  // so probing for it is also the check for whether the feature is switched on.
  function revealEditStudio() {
    fetch('/admin/edit/', { method: 'HEAD' })
      .then(function(res) {
        if (res.ok) byId('edit-pages-link').hidden = false;
      })
      .catch(function() { /* feature off — leave the link hidden */ });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  var TABS = ['queue', 'newsletter', 'history', 'bulk', 'emails'];
  function activateTab(name) {
    TABS.forEach(function(t) {
      var tab = byId('tab-' + t);
      var panel = byId('panel-' + t);
      var active = t === name;
      tab.setAttribute('aria-selected', String(active));
      tab.className = active
        ? 'px-4 py-2 rounded-t-lg text-sm font-semibold whitespace-nowrap bg-white'
        : 'px-4 py-2 rounded-t-lg text-sm font-semibold whitespace-nowrap text-white/80 hover:text-white';
      tab.style.color = active ? 'var(--color-primary)' : '';
      panel.hidden = !active;
    });
    if (!state.loadedTabs[name]) {
      state.loadedTabs[name] = true;
      ({ queue: loadQueue, newsletter: loadNewsletter, history: loadHistory, bulk: renderBulk, emails: loadEmails })[name]();
    }
  }

  // ── Site index (taxonomies + history data) ────────────────────────────────
  function applySiteIndex(index) {
    state.siteIndex = index;
    state.taxonomies = index.taxonomies || state.taxonomies;
    // location -> {area: true} map feeding the Area dropdown in edit forms
    state.areasByLocation = {};
    (index.resources || []).forEach(function(r) {
      if (!r.area) return;
      var loc = r.location || '';
      (state.areasByLocation[loc] = state.areasByLocation[loc] || {})[r.area] = true;
    });
  }

  function loadSiteIndex() {
    fetch('/api/site-index.json').then(function(res) {
      if (!res.ok) throw new Error('no index');
      return res.json();
    }).then(applySiteIndex).catch(function() { /* selects fall back to free-text inputs */ });
  }

  // ── Review queue ──────────────────────────────────────────────────────────
  function loadQueue() {
    var panel = byId('panel-queue');
    clear(panel);
    panel.appendChild(el('p', 'text-sm', 'Loading review queue…'));

    apiFetch('/pending').then(function(data) {
      state.queue.items = data.items || [];
      renderQueue();
    }).catch(function(err) {
      if (err.message === 'Signed out') return;
      clear(panel);
      var card = el('div', 'card p-6 text-center');
      card.appendChild(el('p', 'mb-4', 'Could not load the queue: ' + err.message));
      var retry = el('button', 'btn-primary', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', loadQueue);
      card.appendChild(retry);
      panel.appendChild(card);
    });
  }

  function renderQueue() {
    var panel = byId('panel-queue');
    clear(panel);
    var items = state.queue.items;

    var badge = byId('queue-count-badge');
    badge.hidden = items.length === 0;
    badge.textContent = String(items.length);
    badge.style.backgroundColor = 'var(--color-secondary)';
    badge.style.color = 'white';

    if (items.length === 0) {
      var empty = el('div', 'card p-8 text-center');
      empty.appendChild(el('div', 'text-4xl mb-3', '✅'));
      empty.appendChild(el('p', 'font-semibold', 'All caught up — no pending items right now.'));
      panel.appendChild(empty);
      return;
    }

    TYPE_ORDER.forEach(function(type) {
      var group = items.filter(function(i) { return i.type === type; });
      if (group.length === 0) return;

      var section = el('section', 'mb-8');
      var head = el('div', 'flex items-center justify-between gap-3 mb-3 flex-wrap');
      head.appendChild(el('h2', 'text-xl font-bold', (TYPE_LABELS[type] || type) + ' (' + group.length + ')'));
      if (group.length > 1) {
        var allBtn = el('button', 'btn-secondary text-sm', 'Approve all ' + group.length);
        allBtn.type = 'button';
        allBtn.addEventListener('click', function() { approveAll(type, group, allBtn); });
        head.appendChild(allBtn);
      }
      section.appendChild(head);

      group.forEach(function(item) { section.appendChild(renderCard(item)); });
      panel.appendChild(section);
    });
  }

  function originBadge(origin) {
    var style = ORIGIN_STYLES[origin && origin.type] || { bg: 'var(--color-text-light)', label: (origin && origin.type) || 'unknown' };
    var tag = el('span', 'tag text-white', style.label + (origin && origin.detail ? ' · ' + origin.detail : ''));
    tag.style.backgroundColor = style.bg;
    return tag;
  }

  function summaryRows(item) {
    var p = item.payload || {};
    if (item.type === 'story') {
      return [['Source', p.sourceName], ['URL', p.sourceUrl], ['Excerpt', p.excerpt], ['Category', p.category], ['Date', fmtDate(p.date)]];
    }
    if (item.type === 'blog') {
      return [['Source', p.source], ['URL', p.url], ['Category', p.category], ['Date', fmtDate(p.date)], ['Slug', p.slug]];
    }
    if (item.type === 'spotlight') {
      return [['Description', p.description], ['Category', p.category], ['Website', p.website], ['Location', p.location]];
    }
    return [['Description', p.description], ['Category', (p.category || []).join(', ')], ['Location', p.location],
            ['Website', p.website], ['Phone', p.phone], ['Goes to', item.targetFile || '']];
  }

  function renderCard(item) {
    var p = item.payload || {};
    var card = el('article', 'card p-5 mb-3');
    card.dataset.id = item.id;

    var top = el('div', 'flex items-start justify-between gap-3 flex-wrap');
    var titleWrap = el('div', 'min-w-0');
    titleWrap.appendChild(el('h3', 'font-bold text-lg break-words', p.name || p.title || '(untitled)'));
    var meta = el('div', 'flex items-center gap-2 mt-1 flex-wrap');
    meta.appendChild(originBadge(item.origin));
    meta.appendChild(el('span', 'text-xs', 'Submitted ' + fmtDate(item.origin && item.origin.submittedAt)));
    titleWrap.appendChild(meta);
    top.appendChild(titleWrap);
    card.appendChild(top);

    var dl = el('dl', 'mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm');
    summaryRows(item).forEach(function(row) {
      if (!row[1]) return;
      var wrap = el('div', 'flex gap-2 min-w-0');
      wrap.appendChild(el('dt', 'font-semibold shrink-0', row[0] + ':'));
      var dd = el('dd', 'break-words min-w-0', String(row[1]));
      if (/^https?:\/\//.test(String(row[1]))) {
        clear(dd);
        var a = el('a', 'underline break-all', String(row[1]));
        a.href = String(row[1]);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.color = 'var(--color-accent)';
        dd.appendChild(a);
      }
      wrap.appendChild(dd);
      dl.appendChild(wrap);
    });
    card.appendChild(dl);

    var editWrap = el('div');
    card.appendChild(editWrap);

    // Newsletter flag — checked items are copied to the Newsletter tab on approval
    var newsletterWrap = null;
    var newsletterCheck = null;
    if (item.type === 'submission' || item.type === 'resource') {
      newsletterWrap = el('label', 'mt-3 flex items-center gap-2 text-sm cursor-pointer');
      newsletterCheck = el('input');
      newsletterCheck.type = 'checkbox';
      newsletterCheck.style.width = '18px';
      newsletterCheck.style.height = '18px';
      newsletterWrap.appendChild(newsletterCheck);
      newsletterWrap.appendChild(el('span', 'font-semibold', '➕ Add to next newsletter'));
      card.appendChild(newsletterWrap);
    }

    var helper = el('p', 'mt-3 text-xs', 'You can change any field (description, category, labels…) before approving — use Review & Edit.');
    helper.style.color = 'var(--color-text-light)';
    card.appendChild(helper);

    var actions = el('div', 'mt-2 flex gap-2 flex-wrap');
    var editBtn = el('button', 'btn-primary text-sm', '✏️ Review & Edit');
    var approveBtn = el('button', 'btn-secondary text-sm', 'Approve as-is');
    var rejectBtn = el('button', 'text-sm px-4 py-2 rounded-lg font-semibold border', 'Reject');
    rejectBtn.style.color = 'var(--color-error)';
    rejectBtn.style.borderColor = 'var(--color-error)';
    [editBtn, approveBtn, rejectBtn].forEach(function(b) {
      b.type = 'button';
      b.style.minHeight = '44px';
    });

    approveBtn.addEventListener('click', function() {
      actOnItem(card, item, 'approve', collectEdits(editWrap, item),
        newsletterCheck ? newsletterCheck.checked : false);
    });
    rejectBtn.addEventListener('click', function() {
      var label = p.name || p.title || item.id;
      if (!confirm('Reject "' + label + '"?' + (item.origin && item.origin.type === 'scraper'
        ? '\n\nScraped items are also blocklisted so they never come back.' : ''))) return;
      actOnItem(card, item, 'reject', null, false);
    });
    function toggleEdit() {
      if (editWrap.firstChild) { clear(editWrap); editBtn.textContent = '✏️ Review & Edit'; }
      else {
        editWrap.appendChild(buildEditForm(item));
        editBtn.textContent = 'Close edit';
        approveBtn.textContent = 'Approve with my edits';
      }
    }
    editBtn.addEventListener('click', toggleEdit);

    actions.appendChild(editBtn);
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    card.appendChild(actions);

    // Scraped items usually arrive with no description — open the edit form
    // right away and flag the empty field so it's obvious it needs filling.
    var isResourceish = item.type === 'submission' || item.type === 'resource';
    if (isResourceish && (!p.description || (item.origin && item.origin.type === 'scraper'))) {
      toggleEdit();
      if (!p.description) {
        var descInput = editWrap.querySelector('[data-key="description"]');
        if (descInput) {
          descInput.style.borderColor = 'var(--color-secondary)';
          autoDraft(card, item, descInput, editWrap);
        }
      }
    }
    return card;
  }

  // Ask the worker for an AI-drafted description and drop it into descInput.
  // Shared by the manual "Draft with AI" button and the automatic draft-on-open
  // path. ui: { onStart, onEnd, silent } — silent suppresses per-card toasts.
  function requestDraft(item, descInput, formParent, ui) {
    ui = ui || {};
    var p = item.payload || {};
    if (ui.onStart) ui.onStart();
    var current = collectEdits(formParent, item) || p;
    return apiFetch('/draft-description', {
      method: 'POST',
      body: JSON.stringify({
        name: current.name || p.name,
        category: current.category || p.category,
        location: current.location || p.location,
        area: current.area || p.area,
        website: current.website || p.website
      })
    }).then(function(data) {
      if (data.description) {
        descInput.value = data.description;
        if (!ui.silent) {
          toast(data.grounded
            ? 'Drafted from the organization\'s own website — review and tweak as needed.'
            : 'Drafted from the available details — please verify before approving.');
        }
        return true;
      }
      if (!ui.silent) toast(data.note || 'No draft returned.', true);
      return false;
    }).catch(function(err) {
      if (err.message !== 'Signed out' && !ui.silent) toast('Draft failed: ' + err.message, true);
      return false;
    }).finally(function() {
      if (ui.onEnd) ui.onEnd();
    });
  }

  // Automatically draft a description the first time an empty-description card
  // scrolls into view — no button click required. Lazy via IntersectionObserver
  // so a long queue doesn't fire dozens of AI calls at once (only visible cards
  // draft), and it never clobbers text the reviewer has already typed.
  function autoDraft(card, item, descInput, formParent) {
    var started = false;
    function run() {
      if (started || descInput.value.trim()) return;
      started = true;
      descInput.placeholder = '✨ Drafting a description with AI…';
      requestDraft(item, descInput, formParent, {
        silent: true,
        onEnd: function() {
          if (!descInput.value.trim()) {
            descInput.placeholder = 'No description yet — add one so visitors know what this resource offers';
          }
        }
      });
    }
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) { if (e.isIntersecting) { obs.disconnect(); run(); } });
      }, { rootMargin: '200px' });
      obs.observe(card);
    } else {
      run();
    }
  }

  var AGE_RANGE_OPTIONS = ['Pediatric', 'Adolescent', 'Adult', 'All Ages'];
  var EDIT_FIELDS = {
    resource: [['name', 'Name'], ['website', 'Website', 'website'], ['description', 'Description', 'textarea'],
               ['category', 'Category', 'category'], ['location', 'Location', 'location'],
               ['area', 'Area', 'area'], ['phone', 'Phone'],
               ['ageRange', 'Age range', 'select'], ['tags', 'Tags (comma-separated)', 'tags']],
    story: [['title', 'Title'], ['sourceName', 'Source name'], ['sourceUrl', 'Source URL'],
            ['excerpt', 'Excerpt', 'textarea'], ['category', 'Category'], ['date', 'Date (YYYY-MM-DD)']],
    spotlight: [['name', 'Name'], ['description', 'Description', 'textarea'], ['category', 'Category'],
                ['website', 'Website'], ['location', 'Location', 'location']],
    blog: [['title', 'Title'], ['source', 'Source'], ['url', 'URL'], ['category', 'Category'], ['date', 'Date (YYYY-MM-DD)']]
  };

  function buildEditForm(item) {
    var fields = EDIT_FIELDS[item.type === 'submission' ? 'resource' : item.type] || EDIT_FIELDS.resource;
    var p = item.payload || {};
    var form = el('div', 'mt-4 p-4 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3');
    form.style.backgroundColor = 'var(--color-warm-light)';
    form.dataset.editForm = '1';

    fields.forEach(function(spec) {
      var key = spec[0], label = spec[1], kind = spec[2] || 'text';
      var wrap = el('div', kind === 'textarea' ? 'sm:col-span-2' : '');
      var fieldId = 'edit-' + item.id + '-' + key;
      var lab = el('label', 'block text-xs font-semibold mb-1', label);
      lab.htmlFor = fieldId;
      wrap.appendChild(lab);

      var input;
      if (kind === 'textarea') {
        input = el('textarea', 'form-input text-sm w-full');
        input.rows = 3;
        input.value = p[key] || '';
      } else if (kind === 'select') {
        // Fixed choices (currently: age range). Keeps entries consistent.
        input = el('select', 'filter-select text-sm w-full');
        var blank = el('option', '', '— select —');
        blank.value = '';
        input.appendChild(blank);
        AGE_RANGE_OPTIONS.forEach(function(optVal) {
          var opt = el('option', '', optVal);
          opt.value = optVal;
          if (optVal === p[key]) opt.selected = true;
          input.appendChild(opt);
        });
        if (p[key] && AGE_RANGE_OPTIONS.indexOf(p[key]) === -1) {
          var ageHint = el('p', 'text-xs mt-1', 'Original: ' + p[key]);
          ageHint.style.color = 'var(--color-text-light)';
          wrap.appendChild(ageHint);
        }
      } else if (kind === 'area') {
        // Dropdown of areas already used for this state, with an explicit
        // "add new" escape hatch — keeps area names consistent.
        input = el('select', 'filter-select text-sm w-full');
        var areaBlank = el('option', '', '— none —');
        areaBlank.value = '';
        input.appendChild(areaBlank);
        var known = (state.areasByLocation && state.areasByLocation[p.location]) || {};
        var areaNames = Object.keys(known);
        if (p[key] && areaNames.indexOf(p[key]) === -1) areaNames.push(p[key]);
        areaNames.sort().forEach(function(a) {
          var opt = el('option', '', a);
          opt.value = a;
          if (a === p[key]) opt.selected = true;
          input.appendChild(opt);
        });
        var addNew = el('option', '', '➕ Add a new area…');
        addNew.value = '__new__';
        input.appendChild(addNew);
        var newInput = el('input', 'form-input text-sm w-full mt-2');
        newInput.type = 'text';
        newInput.placeholder = 'New area name (e.g. Loudoun County)';
        newInput.hidden = true;
        input.addEventListener('change', function() {
          var adding = input.value === '__new__';
          newInput.hidden = !adding;
          if (adding) {
            input.removeAttribute('data-key');
            newInput.dataset.key = key;
            newInput.dataset.kind = 'text';
            newInput.focus();
          } else {
            newInput.removeAttribute('data-key');
            input.dataset.key = key;
          }
        });
        wrap.appendChild(input);
        wrap.appendChild(newInput);
        input.id = fieldId;
        input.dataset.key = key;
        input.dataset.kind = kind;
        form.appendChild(wrap);
        return; // custom wiring done — skip the shared tail below
      } else if (kind === 'category' && state.taxonomies.categories.length) {
        input = el('select', 'filter-select text-sm w-full');
        var current = Array.isArray(p[key]) ? p[key][0] : p[key];
        state.taxonomies.categories.forEach(function(cat) {
          var opt = el('option', '', cat.label);
          opt.value = cat.value;
          if (cat.value === current) opt.selected = true;
          input.appendChild(opt);
        });
        if (current && !state.taxonomies.categories.some(function(c) { return c.value === current; })) {
          var hint = el('p', 'text-xs mt-1', 'Original: ' + current);
          hint.style.color = 'var(--color-text-light)';
          wrap.appendChild(hint);
        }
      } else if (kind === 'location' && state.taxonomies.locations.length) {
        input = el('select', 'filter-select text-sm w-full');
        state.taxonomies.locations.forEach(function(loc) {
          var opt = el('option', '', loc);
          opt.value = loc;
          if (loc === p[key]) opt.selected = true;
          input.appendChild(opt);
        });
      } else if (kind === 'tags') {
        input = el('input', 'form-input text-sm w-full');
        input.type = 'text';
        input.value = Array.isArray(p[key]) ? p[key].join(', ') : (p[key] || '');
      } else {
        input = el('input', 'form-input text-sm w-full');
        input.type = 'text';
        input.value = p[key] || '';
      }
      input.id = fieldId;
      input.dataset.key = key;
      input.dataset.kind = kind;
      wrap.appendChild(input);

      if (kind === 'website') {
        // One-click lookup for scraped resources missing a website
        var searchLink = el('a', 'text-xs underline inline-block mt-1',
          'Search Google for this organization ↗');
        searchLink.style.color = 'var(--color-accent)';
        searchLink.target = '_blank';
        searchLink.rel = 'noopener noreferrer';
        searchLink.href = 'https://www.google.com/search?q=' +
          encodeURIComponent([p.name, p.area, p.location].filter(Boolean).join(' '));
        wrap.appendChild(searchLink);
      }

      if (key === 'description' && (item.type === 'submission' || item.type === 'resource')) {
        // Empty-description cards draft automatically on open (see autoDraft);
        // this button re-drafts on demand after the reviewer edits name/website.
        var draftBtn = el('button', 'btn-secondary text-xs mt-2', '✨ Re-draft with AI');
        draftBtn.type = 'button';
        var descInput = input;
        draftBtn.addEventListener('click', function() {
          requestDraft(item, descInput, form.parentNode, {
            onStart: function() { draftBtn.disabled = true; draftBtn.textContent = 'Drafting…'; },
            onEnd: function() { draftBtn.disabled = false; draftBtn.textContent = '✨ Re-draft with AI'; }
          });
        });
        wrap.appendChild(draftBtn);
      }

      if (kind === 'tags') {
        var tagsHint = el('p', 'text-xs mt-1',
          'Tags become the type-filter chips on that category\'s page (e.g. "safety-beds" adds a Safety Beds filter).');
        tagsHint.style.color = 'var(--color-text-light)';
        wrap.appendChild(tagsHint);
      }

      form.appendChild(wrap);
    });

    if (item.type === 'blog') {
      var note = el('p', 'text-xs sm:col-span-2', 'Full body editing happens in the Content Manager after approval.');
      note.style.color = 'var(--color-text-light)';
      form.appendChild(note);
    }
    return form;
  }

  function collectEdits(editWrap, item) {
    var form = editWrap.querySelector('[data-edit-form]');
    if (!form) return null;
    var payload = JSON.parse(JSON.stringify(item.payload || {}));
    form.querySelectorAll('[data-key]').forEach(function(input) {
      var key = input.dataset.key, kind = input.dataset.kind, value = input.value.trim();
      if (kind === 'category' && Array.isArray(payload[key])) {
        // The control is a single select bound to category[0], but entries can
        // carry more slugs — granular ones like apps-communication and
        // cross-listings like assistive-tech. Replace the primary, keep the rest,
        // or approving an app here silently strips it off every page but one.
        payload[key] = [value].concat(payload[key].slice(1).filter(function(c) {
          return c !== value;
        }));
      } else if (kind === 'tags') {
        payload[key] = value ? value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
      } else {
        payload[key] = value;
      }
    });
    return payload;
  }

  function actOnItem(card, item, action, editedPayload, newsletterFlag) {
    card.style.opacity = '0.5';
    card.querySelectorAll('button').forEach(function(b) { b.disabled = true; });

    var body = { items: [{ id: item.id, file: item.file }] };
    if (editedPayload) body.items[0].payload = editedPayload;
    if (newsletterFlag && action === 'approve') body.items[0].newsletterFlag = true;

    apiFetch('/' + action, { method: 'POST', body: JSON.stringify(body) }).then(function(data) {
      var failure = (data.failed || []).find(function(f) { return f.id === item.id; });
      if (failure && action === 'approve') {
        throw new Error(failure.reason);
      }
      state.queue.items = state.queue.items.filter(function(i) { return i.id !== item.id; });
      renderQueue();
      state.loadedTabs.newsletter = false; // refresh drafts next time the tab opens
      toast(action === 'approve'
        ? (newsletterFlag
            ? 'Approved and flagged for the newsletter — see the Newsletter tab.'
            : 'Approved — live on the site in a few minutes.')
        : 'Rejected' + ((data.blocked || []).length ? ' and blocklisted.' : '.'));
    }).catch(function(err) {
      if (err.message === 'Signed out') return;
      card.style.opacity = '';
      card.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
      toast((action === 'approve' ? 'Approve' : 'Reject') + ' failed: ' + err.message, true);
    });
  }

  function approveAll(type, group, button) {
    if (!confirm('Approve all ' + group.length + ' ' + (TYPE_LABELS[type] || type).toLowerCase() + '? They will publish to the live site.')) return;
    button.disabled = true;
    var chunks = [];
    for (var i = 0; i < group.length; i += APPROVE_CHUNK) chunks.push(group.slice(i, i + APPROVE_CHUNK));

    var done = 0, failures = [];
    function next() {
      if (chunks.length === 0) {
        loadQueue();
        toast(failures.length === 0
          ? 'Approved all ' + done + ' items — live in a few minutes.'
          : 'Approved ' + done + '; ' + failures.length + ' failed (' + failures.map(function(f) { return f.reason; }).join(', ') + ')',
          failures.length > 0);
        return;
      }
      var chunk = chunks.shift();
      button.textContent = 'Approving ' + (done + chunk.length) + ' of ' + group.length + '…';
      apiFetch('/approve', {
        method: 'POST',
        body: JSON.stringify({ items: chunk.map(function(i) { return { id: i.id, file: i.file }; }) })
      }).then(function(data) {
        done += (data.approved || []).length;
        failures = failures.concat(data.failed || []);
        next();
      }).catch(function(err) {
        if (err.message === 'Signed out') return;
        failures.push({ reason: err.message });
        next();
      });
    }
    next();
  }

  // ── History ───────────────────────────────────────────────────────────────
  function loadHistory() {
    var panel = byId('panel-history');
    clear(panel);
    panel.appendChild(el('p', 'text-sm', 'Loading…'));

    fetch('/api/site-index.json').then(function(res) {
      if (!res.ok) throw new Error('site index not available');
      return res.json();
    }).then(function(index) {
      applySiteIndex(index);
      renderHistory(index);
    }).catch(function(err) {
      clear(panel);
      panel.appendChild(el('p', 'card p-6', 'Could not load history: ' + err.message));
    });
  }

  function renderHistory(index) {
    var panel = byId('panel-history');
    clear(panel);

    var note = el('p', 'text-xs mb-4', 'Data as of the last site deploy (' + fmtDate(index.generated) + '). Newly approved items appear after the next deploy finishes.');
    note.style.color = 'var(--color-text-light)';
    panel.appendChild(note);

    // Collect dated entries: [weekKey, kind, label, originKey, dateIso]
    var entries = [];
    (index.resources || []).forEach(function(r) {
      var d = r.dateAdded || r.lastScraped;
      var o = r.origin ? (r.origin.detail === 'legacy-backfill' ? 'scraper (pre-tracking)' : r.origin.type) : 'scraper (pre-tracking)';
      entries.push({ date: d, kind: 'resource', label: r.name + ' (' + r.location + ')', origin: o });
    });
    (index.stories || []).forEach(function(s) {
      entries.push({ date: s.addedDate || s.date, kind: 'story', label: s.title, origin: 'scraper' });
    });
    (index.spotlights || []).forEach(function(s) {
      entries.push({ date: s.approvedAt || s.date, kind: 'spotlight', label: s.name, origin: 'scraper' });
    });
    (index.blog || []).forEach(function(b) {
      entries.push({ date: b.date, kind: 'blog', label: b.title, origin: b.autoGenerated ? 'scraper' : 'editor' });
    });

    var byWeek = {};
    entries.forEach(function(entry) {
      var key = isoWeekKey(entry.date);
      if (!key) return;
      (byWeek[key] = byWeek[key] || []).push(entry);
    });

    var weeks = Object.keys(byWeek).sort().reverse().slice(0, 8);
    if (weeks.length === 0) {
      panel.appendChild(el('p', 'card p-6', 'No dated content found yet.'));
      return;
    }

    weeks.forEach(function(weekKey) {
      var weekEntries = byWeek[weekKey];
      var monday = mondayOf(weekEntries[0].date);
      var section = el('section', 'card p-5 mb-4');
      var head = el('div', 'flex items-center justify-between gap-3 flex-wrap mb-2');
      head.appendChild(el('h2', 'text-lg font-bold', 'Week of ' + fmtDate(monday)));
      head.appendChild(el('span', 'text-sm', weekEntries.length + ' added'));
      section.appendChild(head);

      // Origin breakdown chips — the "where is information coming from" view
      var originCounts = {};
      weekEntries.forEach(function(entry) {
        originCounts[entry.origin] = (originCounts[entry.origin] || 0) + 1;
      });
      var chips = el('div', 'flex gap-2 flex-wrap mb-3');
      Object.keys(originCounts).sort().forEach(function(origin) {
        var style = ORIGIN_STYLES[origin] || { bg: 'var(--color-text-light)', label: origin };
        var chip = el('span', 'tag text-white', (style.label || origin) + ': ' + originCounts[origin]);
        chip.style.backgroundColor = style.bg;
        chips.appendChild(chip);
      });
      section.appendChild(chips);

      var details = el('details');
      details.appendChild(el('summary', 'text-sm cursor-pointer font-semibold', 'Show items'));
      var list = el('ul', 'mt-2 text-sm space-y-1');
      weekEntries.slice(0, 100).forEach(function(entry) {
        list.appendChild(el('li', 'break-words', '[' + entry.kind + '] ' + entry.label + ' — ' + entry.origin));
      });
      if (weekEntries.length > 100) {
        list.appendChild(el('li', 'font-semibold', '… and ' + (weekEntries.length - 100) + ' more'));
      }
      details.appendChild(list);
      section.appendChild(details);
      panel.appendChild(section);
    });
  }

  // ── Bulk import ───────────────────────────────────────────────────────────
  var BULK_TARGETS = ['name', 'website', 'description', 'category', 'location', 'area', 'phone', 'cost', 'ageRange', 'tags', '(skip)'];
  var BULK_AUTOMAP = [
    [/name|org|title/i, 'name'], [/url|web|site|link/i, 'website'], [/desc|about|summary/i, 'description'],
    [/categ|type/i, 'category'], [/state|location|region/i, 'location'], [/area|city|county/i, 'area'],
    [/phone|tel/i, 'phone'], [/cost|price|fee/i, 'cost'], [/age/i, 'ageRange'], [/tag/i, 'tags']
  ];

  function renderBulk() {
    var panel = byId('panel-bulk');
    clear(panel);

    var card = el('div', 'card p-6 mb-4');
    card.appendChild(el('h2', 'text-xl font-bold mb-2', 'Bulk Import Resources'));
    card.appendChild(el('p', 'text-sm mb-4', 'Upload a CSV (first row = column headers) or paste rows below, map the columns, fix any flagged values, then queue everything for review.'));

    var fileLabel = el('label', 'block text-sm font-semibold mb-1', 'CSV file');
    fileLabel.htmlFor = 'bulk-file';
    var fileInput = el('input', 'form-input text-sm mb-4 w-full');
    fileInput.type = 'file';
    fileInput.id = 'bulk-file';
    fileInput.accept = '.csv,text/csv';

    var pasteLabel = el('label', 'block text-sm font-semibold mb-1', 'Or paste CSV text');
    pasteLabel.htmlFor = 'bulk-paste';
    var paste = el('textarea', 'form-input text-sm w-full');
    paste.id = 'bulk-paste';
    paste.rows = 5;
    paste.placeholder = 'name,website,category,location,description\nExample Org,https://example.org,respite,Virginia,Weekend respite care';

    var parseBtn = el('button', 'btn-primary text-sm mt-3', 'Parse');
    parseBtn.type = 'button';

    card.appendChild(fileLabel);
    card.appendChild(fileInput);
    card.appendChild(pasteLabel);
    card.appendChild(paste);
    card.appendChild(parseBtn);
    panel.appendChild(card);

    var resultWrap = el('div');
    resultWrap.id = 'bulk-result';
    panel.appendChild(resultWrap);

    function handleParsed(results) {
      if (!results.data || results.data.length === 0) {
        toast('No rows found in that CSV.', true);
        return;
      }
      state.bulk.headers = results.meta.fields || [];
      state.bulk.rows = results.data;
      state.bulk.mapping = {};
      state.bulk.headers.forEach(function(h) {
        var hit = BULK_AUTOMAP.find(function(m) { return m[0].test(h); });
        state.bulk.mapping[h] = hit ? hit[1] : '(skip)';
      });
      renderBulkPreview(resultWrap);
    }

    parseBtn.addEventListener('click', function() {
      var file = fileInput.files && fileInput.files[0];
      if (file) {
        Papa.parse(file, { header: true, skipEmptyLines: true, complete: handleParsed });
      } else if (paste.value.trim()) {
        Papa.parse(paste.value.trim(), { header: true, skipEmptyLines: true, complete: handleParsed });
      } else {
        toast('Choose a CSV file or paste CSV text first.', true);
      }
    });
  }

  function mapRow(row) {
    var item = {};
    state.bulk.headers.forEach(function(h) {
      var target = state.bulk.mapping[h];
      if (!target || target === '(skip)') return;
      var value = (row[h] || '').trim();
      if (target === 'tags') {
        item.tags = value ? value.split(/[;,]/).map(function(s) { return s.trim(); }).filter(Boolean) : [];
      } else {
        item[target] = value;
      }
    });
    return item;
  }

  function validateItem(item) {
    var problems = [];
    if (!item.name) problems.push('missing name');
    if (!item.description) problems.push('missing description');
    if (!item.location) problems.push('missing location');
    else if (state.taxonomies.locations.length && state.taxonomies.locations.indexOf(item.location) === -1) {
      problems.push('unknown location "' + item.location + '"');
    }
    if (!item.category) problems.push('missing category');
    else if (state.taxonomies.categories.length && !state.taxonomies.categories.some(function(c) { return c.value === item.category; })) {
      problems.push('unknown category "' + item.category + '"');
    }
    if (item.website && !/^https?:\/\//.test(item.website)) problems.push('website is not a URL');
    return problems;
  }

  function renderBulkPreview(wrap) {
    clear(wrap);
    var card = el('div', 'card p-6');
    card.appendChild(el('h3', 'text-lg font-bold mb-3', 'Map columns (' + state.bulk.rows.length + ' rows)'));

    var mapGrid = el('div', 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4');
    state.bulk.headers.forEach(function(h) {
      var wrap2 = el('div');
      var lab = el('label', 'block text-xs font-semibold mb-1', h);
      var sel = el('select', 'filter-select text-sm w-full');
      lab.htmlFor = sel.id = 'map-' + h.replace(/\W+/g, '-');
      BULK_TARGETS.forEach(function(t) {
        var opt = el('option', '', t);
        opt.value = t;
        if (state.bulk.mapping[h] === t) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function() {
        state.bulk.mapping[h] = sel.value;
        renderBulkPreview(wrap);
      });
      wrap2.appendChild(lab);
      wrap2.appendChild(sel);
      mapGrid.appendChild(wrap2);
    });
    card.appendChild(mapGrid);

    var items = state.bulk.rows.map(mapRow);
    var allProblems = items.map(validateItem);
    var badCount = allProblems.filter(function(p) { return p.length > 0; }).length;

    var tableWrap = el('div', 'overflow-x-auto mb-4');
    var table = el('table', 'w-full text-sm');
    var thead = el('thead');
    var headRow = el('tr');
    ['#', 'name', 'category', 'location', 'website', 'issues'].forEach(function(h) {
      headRow.appendChild(el('th', 'text-left p-2 font-semibold border-b', h));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el('tbody');
    items.slice(0, 20).forEach(function(item, i) {
      var tr = el('tr', allProblems[i].length ? '' : '');
      if (allProblems[i].length) tr.style.backgroundColor = '#fef2f2';
      tr.appendChild(el('td', 'p-2 border-b', String(i + 1)));
      tr.appendChild(el('td', 'p-2 border-b', item.name || ''));
      tr.appendChild(el('td', 'p-2 border-b', item.category || ''));
      tr.appendChild(el('td', 'p-2 border-b', item.location || ''));
      tr.appendChild(el('td', 'p-2 border-b break-all', item.website || ''));
      var issueCell = el('td', 'p-2 border-b text-xs', allProblems[i].join('; '));
      issueCell.style.color = 'var(--color-error)';
      tr.appendChild(issueCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    if (items.length > 20) {
      tableWrap.appendChild(el('p', 'text-xs', 'Showing first 20 of ' + items.length + ' rows.'));
    }
    card.appendChild(tableWrap);

    var publishWrap = el('label', 'flex items-center gap-2 text-sm mb-4');
    var publishToggle = el('input');
    publishToggle.type = 'checkbox';
    publishWrap.appendChild(publishToggle);
    publishWrap.appendChild(el('span', '', 'Publish immediately (skip the review queue)'));
    card.appendChild(publishWrap);

    var submitBtn = el('button', 'btn-primary', badCount > 0
      ? 'Fix ' + badCount + ' row(s) before importing'
      : 'Import ' + items.length + ' resources');
    submitBtn.type = 'button';
    submitBtn.disabled = badCount > 0;
    submitBtn.addEventListener('click', function() {
      var publish = publishToggle.checked;
      var confirmMsg = publish
        ? 'PUBLISH ' + items.length + ' resources DIRECTLY to the live site (no review)? This cannot be batch-undone.'
        : 'Queue ' + items.length + ' resources for review?';
      if (!confirm(confirmMsg)) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Importing…';
      apiFetch('/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ items: items, detail: 'csv-import', publish: publish })
      }).then(function(data) {
        toast(publish
          ? 'Published ' + (data.published || 0) + ' resources.'
          : 'Queued ' + (data.accepted || 0) + ' resources for review.');
        if ((data.errors || []).length) {
          toast((data.errors.length) + ' rows were skipped (' + data.errors[0].reason + '…)', true);
        }
        clear(wrap);
        state.loadedTabs.queue = false; // refresh the queue next time it opens
      }).catch(function(err) {
        if (err.message === 'Signed out') return;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Import ' + items.length + ' resources';
        toast('Import failed: ' + err.message, true);
      });
    });
    card.appendChild(submitBtn);

    wrap.appendChild(card);
  }

  // ── Newsletter drafts ─────────────────────────────────────────────────────
  function loadNewsletter() {
    var panel = byId('panel-newsletter');
    clear(panel);
    panel.appendChild(el('p', 'text-sm', 'Loading newsletter drafts…'));

    apiFetch('/newsletter-drafts').then(function(data) {
      clear(panel);
      var drafts = data.drafts || [];

      var intro = el('p', 'text-sm mb-4',
        'Resources you flagged with "Add to next newsletter". Each has an AI-drafted starter paragraph — edit it, save, then use Compile to copy the whole draft.');
      intro.style.color = 'var(--color-text-light)';
      panel.appendChild(intro);

      if (drafts.length === 0) {
        var empty = el('div', 'card p-8 text-center');
        empty.appendChild(el('div', 'text-4xl mb-3', '📰'));
        empty.appendChild(el('p', 'font-semibold', 'Nothing flagged yet.'));
        empty.appendChild(el('p', 'text-sm mt-2', 'Tick "Add to next newsletter" on a resource in the Review Queue before approving it, and it will appear here.'));
        panel.appendChild(empty);
        return;
      }

      var compileBtn = el('button', 'btn-primary text-sm mb-4', 'Compile draft (' + drafts.length + ' items)');
      compileBtn.type = 'button';
      compileBtn.addEventListener('click', function() { showCompiled(panel, drafts); });
      panel.appendChild(compileBtn);

      drafts.forEach(function(draft) {
        var card = el('article', 'card p-5 mb-3');
        var head = el('div', 'flex items-start justify-between gap-3 flex-wrap');
        var titleWrap = el('div', 'min-w-0');
        titleWrap.appendChild(el('h3', 'font-bold text-lg break-words', (draft.payload && draft.payload.name) || '(untitled)'));
        titleWrap.appendChild(el('p', 'text-xs mt-1', 'Flagged ' + fmtDate(draft.flaggedAt) +
          ((draft.payload && draft.payload.website) ? ' · ' + draft.payload.website : '')));
        head.appendChild(titleWrap);
        card.appendChild(head);

        var lab = el('label', 'block text-xs font-semibold mt-3 mb-1', 'Newsletter paragraph (edit freely)');
        var ta = el('textarea', 'form-input text-sm w-full');
        ta.rows = 4;
        ta.value = draft.paragraph || '';
        lab.htmlFor = ta.id = 'draft-' + draft.id;
        card.appendChild(lab);
        card.appendChild(ta);

        var actions = el('div', 'mt-3 flex gap-2 flex-wrap');
        var saveBtn = el('button', 'btn-primary text-sm', 'Save paragraph');
        var removeBtn = el('button', 'text-sm px-4 py-2 rounded-lg font-semibold border', 'Remove from newsletter');
        removeBtn.style.color = 'var(--color-error)';
        removeBtn.style.borderColor = 'var(--color-error)';
        [saveBtn, removeBtn].forEach(function(b) { b.type = 'button'; b.style.minHeight = '44px'; });

        saveBtn.addEventListener('click', function() {
          saveBtn.disabled = true;
          apiFetch('/newsletter-drafts', {
            method: 'POST',
            body: JSON.stringify({ id: draft.id, paragraph: ta.value.trim() })
          }).then(function() {
            saveBtn.disabled = false;
            toast('Paragraph saved.');
          }).catch(function(err) {
            if (err.message === 'Signed out') return;
            saveBtn.disabled = false;
            toast('Save failed: ' + err.message, true);
          });
        });
        removeBtn.addEventListener('click', function() {
          if (!confirm('Remove "' + ((draft.payload && draft.payload.name) || draft.id) + '" from the newsletter list? (The resource itself stays live on the site.)')) return;
          removeBtn.disabled = true;
          apiFetch('/newsletter-drafts', {
            method: 'POST',
            body: JSON.stringify({ id: draft.id, remove: true })
          }).then(function() {
            card.remove();
            toast('Removed from the newsletter list.');
          }).catch(function(err) {
            if (err.message === 'Signed out') return;
            removeBtn.disabled = false;
            toast('Remove failed: ' + err.message, true);
          });
        });

        actions.appendChild(saveBtn);
        actions.appendChild(removeBtn);
        card.appendChild(actions);
        panel.appendChild(card);
      });
    }).catch(function(err) {
      if (err.message === 'Signed out') return;
      clear(panel);
      var card = el('div', 'card p-6 text-center');
      card.appendChild(el('p', 'mb-4', 'Could not load newsletter drafts: ' + err.message));
      var retry = el('button', 'btn-primary', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', function() { state.loadedTabs.newsletter = false; activateTab('newsletter'); });
      card.appendChild(retry);
      panel.appendChild(card);
    });
  }

  function showCompiled(panel, drafts) {
    var existing = byId('compiled-draft');
    if (existing) existing.remove();
    var box = el('div', 'card p-5 mb-4');
    box.id = 'compiled-draft';
    box.appendChild(el('h3', 'font-bold mb-2', 'Compiled newsletter draft'));
    var ta = el('textarea', 'form-input text-sm w-full');
    ta.rows = Math.min(20, drafts.length * 5 + 2);
    ta.value = drafts.map(function(d) {
      var name = (d.payload && d.payload.name) || '';
      var site = (d.payload && d.payload.website) ? '\n' + d.payload.website : '';
      return '★ ' + name + '\n' + (d.paragraph || '') + site;
    }).join('\n\n');
    box.appendChild(ta);
    var copyBtn = el('button', 'btn-secondary text-sm mt-2', 'Copy to clipboard');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function() {
      ta.select();
      document.execCommand('copy');
      toast('Copied — paste it into your newsletter.');
    });
    box.appendChild(copyBtn);
    panel.insertBefore(box, panel.children[2] || null);
  }

  // ── Emails ────────────────────────────────────────────────────────────────
  function loadEmails() {
    var panel = byId('panel-emails');
    clear(panel);
    panel.appendChild(el('p', 'text-sm', 'Loading…'));

    apiFetch('/emails?limit=500').then(function(data) {
      clear(panel);
      if (data.note) {
        panel.appendChild(el('p', 'card p-6', data.note));
        return;
      }
      var contacts = data.contacts || [];

      var chips = el('div', 'flex gap-2 flex-wrap mb-4');
      var confirmed = contacts.filter(function(c) { return c.optIn === 'confirmed'; }).length;
      var monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      var recent = contacts.filter(function(c) { return (c.dateAdded || '') >= monthAgo; }).length;
      [['Total', data.total || contacts.length], ['Opted in', confirmed], ['Added last 30 days', recent]].forEach(function(stat) {
        var chip = el('span', 'tag', stat[0] + ': ' + stat[1]);
        chip.style.backgroundColor = 'var(--color-warm)';
        chip.style.color = 'var(--color-primary)';
        chips.appendChild(chip);
      });
      panel.appendChild(chips);

      var card = el('div', 'card p-4 overflow-x-auto');
      var table = el('table', 'w-full text-sm tabular-nums');
      var thead = el('thead');
      var headRow = el('tr');
      ['Email', 'Date added', 'Source', 'Status'].forEach(function(h) {
        headRow.appendChild(el('th', 'text-left p-2 font-semibold border-b', h));
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = el('tbody');
      contacts.forEach(function(c) {
        var tr = el('tr');
        tr.appendChild(el('td', 'p-2 border-b break-all', c.email));
        tr.appendChild(el('td', 'p-2 border-b whitespace-nowrap', fmtDate(c.dateAdded)));
        tr.appendChild(el('td', 'p-2 border-b', c.source || ''));
        tr.appendChild(el('td', 'p-2 border-b', c.optIn || ''));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
      panel.appendChild(card);
    }).catch(function(err) {
      if (err.message === 'Signed out') return;
      clear(panel);
      panel.appendChild(el('p', 'card p-6', 'Could not load contacts: ' + err.message));
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    byId('sign-in-btn').addEventListener('click', signIn);
    byId('pat-btn').addEventListener('click', function() {
      acceptToken(byId('pat-input').value.trim());
    });
    byId('sign-out-btn').addEventListener('click', function() { signOut(); });

    TABS.forEach(function(t) {
      byId('tab-' + t).addEventListener('click', function() { activateTab(t); });
    });
    // Keyboard arrows on the tablist
    document.querySelector('[role="tablist"]').addEventListener('keydown', function(e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var current = TABS.findIndex(function(t) { return byId('tab-' + t).getAttribute('aria-selected') === 'true'; });
      var next = (current + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      activateTab(TABS[next]);
      byId('tab-' + TABS[next]).focus();
    });

    if (MOCK) {
      state.user = { login: 'mock-admin', avatar_url: '' };
      state.token = 'mock';
      showApp();
    } else if (state.token) {
      acceptToken(state.token);
    }
  });
})();

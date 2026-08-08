// Apps-page filtering: search + function + platform + price.
//
// Separate from categoryFilter.js on purpose. That file drives the 29 generic
// category pages and is built around state/city/area, none of which apply to
// national software. Sharing it would mean branching every code path in a file
// loaded by 29 other pages.
//
// The data-* attributes below are set by _includes/components/app-card.njk.
document.addEventListener('DOMContentLoaded', function() {
  var cards = Array.prototype.slice.call(document.querySelectorAll('.app-card'));
  if (!cards.length) return;

  var searchInput = document.getElementById('app-search');
  var functionFilter = document.getElementById('app-function-filter');
  var platformFilter = document.getElementById('app-platform-filter');
  var priceFilter = document.getElementById('app-price-filter');
  var resultsCount = document.getElementById('app-results-count');
  var noResults = document.getElementById('app-no-results');
  var groups = Array.prototype.slice.call(document.querySelectorAll('[data-app-group]'));

  function attr(el, name) {
    return (el.getAttribute(name) || '').toLowerCase();
  }

  // data-platforms is a comma-joined list ("ios,android,web")
  function cardPlatforms(card) {
    return attr(card, 'data-platforms').split(',').map(function(p) {
      return p.trim();
    }).filter(Boolean);
  }

  function filterCards() {
    var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    var selectedFunction = functionFilter ? functionFilter.value : '';
    var selectedPlatform = platformFilter ? platformFilter.value : '';
    var selectedPrice = priceFilter ? priceFilter.value : '';
    var visibleCount = 0;

    cards.forEach(function(card) {
      var show = true;

      if (searchTerm) {
        var haystack = attr(card, 'data-name') + ' ' + attr(card, 'data-description');
        if (!haystack.includes(searchTerm)) show = false;
      }
      if (selectedFunction && attr(card, 'data-function') !== selectedFunction) {
        show = false;
      }
      if (selectedPlatform && !cardPlatforms(card).includes(selectedPlatform)) {
        show = false;
      }
      if (selectedPrice && attr(card, 'data-pricing') !== selectedPrice) {
        show = false;
      }

      card.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });

    // Hide a whole group (heading + blurb) once none of its cards are showing,
    // otherwise a filter leaves stranded headings over empty space.
    groups.forEach(function(group) {
      var groupCards = Array.prototype.slice.call(group.querySelectorAll('.app-card'));
      var visible = groupCards.filter(function(c) {
        return c.style.display !== 'none';
      }).length;
      group.hidden = visible === 0;
    });

    if (noResults) noResults.hidden = visibleCount !== 0;
    if (resultsCount) {
      resultsCount.textContent = visibleCount + ' app' + (visibleCount !== 1 ? 's' : '') + ' shown';
    }
  }

  // Deep links, e.g. /resources/apps/?function=apps-communication&price=free
  // Mirrors the ?state=/?city=/?type= support on the category pages.
  function applyParam(name, select) {
    if (!select) return;
    var params = new URLSearchParams(window.location.search);
    var value = params.get(name);
    if (!value) return;
    value = value.toLowerCase();
    var hasOpt = Array.prototype.some.call(select.options, function(o) {
      return o.value === value;
    });
    if (hasOpt) select.value = value;
  }

  applyParam('function', functionFilter);
  applyParam('platform', platformFilter);
  applyParam('price', priceFilter);

  if (searchInput) searchInput.addEventListener('input', filterCards);
  if (functionFilter) functionFilter.addEventListener('change', filterCards);
  if (platformFilter) platformFilter.addEventListener('change', filterCards);
  if (priceFilter) priceFilter.addEventListener('change', filterCards);

  filterCards();
});

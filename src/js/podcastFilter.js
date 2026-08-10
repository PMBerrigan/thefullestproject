// Podcast directory filtering: search + topic, over the "Podcasts We Love" grid.
// Same data-attribute contract as the other filters on the site — the attributes
// are set in src/pages/podcast.njk.
document.addEventListener('DOMContentLoaded', function() {
  var grid = document.getElementById('podcast-grid');
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll('.podcast-card'));
  var searchInput = document.getElementById('podcast-search');
  var categorySelect = document.getElementById('podcast-category');
  var resultsCount = document.getElementById('podcast-results-count');
  var noResults = document.getElementById('podcast-no-results');

  function attr(el, name) {
    return (el.getAttribute(name) || '').toLowerCase();
  }

  function filterCards() {
    var term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    var category = categorySelect ? categorySelect.value : '';
    var visibleCount = 0;

    cards.forEach(function(card) {
      var show = true;

      if (term) {
        var haystack = attr(card, 'data-name') + ' ' +
                       attr(card, 'data-description') + ' ' +
                       attr(card, 'data-hosts');
        if (!haystack.includes(term)) show = false;
      }
      if (category && card.getAttribute('data-category') !== category) {
        show = false;
      }

      card.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });

    if (noResults) noResults.hidden = visibleCount !== 0;
    if (resultsCount) {
      resultsCount.textContent = visibleCount + ' podcast' + (visibleCount !== 1 ? 's' : '') + ' shown';
    }
  }

  // ?topic= deep link, matching the ?type=/?function= pattern used elsewhere
  var params = new URLSearchParams(window.location.search);
  var topic = params.get('topic');
  if (topic && categorySelect) {
    var match = Array.prototype.find.call(categorySelect.options, function(o) {
      return o.value.toLowerCase() === topic.toLowerCase();
    });
    if (match) categorySelect.value = match.value;
  }

  if (searchInput) searchInput.addEventListener('input', filterCards);
  if (categorySelect) categorySelect.addEventListener('change', filterCards);

  filterCards();
});

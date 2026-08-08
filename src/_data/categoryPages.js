/**
 * The subset of categories.json that the generic paginated category page
 * (src/pages/preview/category.njk) should build.
 *
 * Some categories have a hand-built template instead, because the generic
 * page's State/City filters don't fit them — apps are national software, not
 * places. Those slugs must be excluded here or Eleventy generates the same
 * permalink twice and fails the build.
 *
 * INVARIANT — keep these two in lockstep:
 *   slug in DEDICATED_TEMPLATES  <->  a template exists with that permalink
 * Add a slug without the template and the page disappears from the site;
 * add the template without the slug and the build dies on a duplicate write.
 */
const fs = require('node:fs');
const path = require('node:path');

// slug -> the template that owns /resources/<slug>/ instead of category.njk
const DEDICATED_TEMPLATES = new Set([
  'apps' // src/pages/apps.njk
]);

module.exports = function() {
  const categories = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'categories.json'), 'utf8')
  );
  return categories.filter(c => !DEDICATED_TEMPLATES.has(c.value));
};

const { HtmlBasePlugin } = require("@11ty/eleventy");
const siteData = require("./src/_data/site.json");

module.exports = function(eleventyConfig) {
  // Rewrite all URLs to include pathPrefix (for GitHub Pages subpath hosting)
  eleventyConfig.addPlugin(HtmlBasePlugin);

  // Pass through static assets
  eleventyConfig.addPassthroughCopy("src/images");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/css/output.css");
  eleventyConfig.addPassthroughCopy("src/admin");

  // The inline page editor is a separate directory on purpose: the blanket
  // copy of src/admin above is unconditional, so keeping it out of there is
  // what lets the flag actually withhold it. Flag off → /admin/edit/ does not
  // exist in the build at all.
  if (siteData.inlineEditor && siteData.inlineEditor.enabled === true) {
    eleventyConfig.addPassthroughCopy({ "src/admin-edit": "admin/edit" });
  }

  eleventyConfig.addPassthroughCopy("src/CNAME");
  eleventyConfig.addPassthroughCopy({ ".nojekyll": ".nojekyll" });

  // Custom collections
  eleventyConfig.addCollection("blogPosts", function(collectionApi) {
    return collectionApi.getFilteredByGlob("src/blog/*.md").sort((a, b) => {
      const aPinned = a.data.pinned ? 1 : 0;
      const bPinned = b.data.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return b.date - a.date;
    });
  });

  eleventyConfig.addCollection("podcastEpisodes", function(collectionApi) {
    return collectionApi.getFilteredByGlob("src/podcast/*.md").sort((a, b) => {
      return b.date - a.date;
    });
  });

  eleventyConfig.addCollection("spotlightPosts", function(collectionApi) {
    return collectionApi.getFilteredByGlob("src/spotlights/*.md").sort((a, b) => {
      return b.date - a.date;
    });
  });

  // Filters
  eleventyConfig.addFilter("dateFormat", function(date) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  });

  eleventyConfig.addFilter("dateISO", function(date) {
    return new Date(date).toISOString().split('T')[0];
  });

  eleventyConfig.addFilter("jsonEscape", function(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  });

  eleventyConfig.addFilter("limit", function(arr, limit) {
    return arr.slice(0, limit);
  });

  eleventyConfig.addFilter("filterByCategory", function(resources, category) {
    if (!category) return resources;
    return resources.filter(r => r.category && r.category.includes(category));
  });

  // Top-level category match against directory.js's computed topCategories
  eleventyConfig.addFilter("filterByTopCategory", function(resources, slug) {
    if (!slug) return resources;
    return resources.filter(r => r.topCategories && r.topCategories.includes(slug));
  });

  // Pull one property off every item in a list (Nunjucks has no `map` filter)
  eleventyConfig.addFilter("pluck", function(items, key) {
    if (!items) return [];
    return items.map(item => item[key]);
  });

  // Entries matching NONE of the given category slugs. Used by the apps page to
  // catch apps that carry no apps-* function slug (e.g. a public submission
  // approved as plain "apps") so they can't silently vanish from the page.
  eleventyConfig.addFilter("rejectByCategories", function(resources, slugs) {
    if (!slugs || !slugs.length) return resources;
    return resources.filter(r => !(r.category || []).some(c => slugs.includes(c)));
  });

  eleventyConfig.addFilter("filterByLocation", function(resources, location) {
    if (!location) return resources;
    return resources.filter(r => r.location === location);
  });

  eleventyConfig.addFilter("filterFeatured", function(items) {
    if (!items) return [];
    return items.filter(item => item.featured);
  });

  eleventyConfig.addFilter("filterActiveGigs", function(gigs) {
    if (!gigs) return [];
    const now = new Date().toISOString().split('T')[0];
    return gigs.filter(g => g.status === 'open' && g.expiresDate >= now);
  });

  return {
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "md", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
};

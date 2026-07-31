/* Preview pane for the block-built pages (Homepage, About Page).
 *
 * Renders the section list top to bottom the way the site will, so reordering,
 * hiding and restyling a section is visible before saving. Uses the same
 * component classes as the real templates — the compiled site CSS is already
 * registered as a preview style by preview-templates.js.
 */
(function () {
  "use strict";

  if (typeof CMS === "undefined" || !window.TFPPreview) return;

  var val = window.TFPPreview.val;

  var BG_CLASSES = {
    white: "",
    warm: "section-warm",
    cool: "section-cool",
    cream: "section-cream",
    primary: "section-primary",
  };
  var PAD_CLASSES = { small: "section-pad-sm", normal: "section-pad", large: "section-pad-lg" };
  var COLUMN_STYLE = {
    "2": "repeat(2,minmax(0,1fr))",
    "3": "repeat(3,minmax(0,1fr))",
    "4": "repeat(4,minmax(0,1fr))",
  };

  function sectionClass(block, defaultPad) {
    var bg = BG_CLASSES[val(block, "background", "white")] || "";
    var pad = PAD_CLASSES[val(block, "padding", defaultPad || "normal")] || "section-pad";
    return (pad + " " + bg).trim();
  }

  var headingStyle = { fontFamily: "var(--font-heading)", color: "var(--color-primary)" };
  var bodyStyle = { fontFamily: "var(--font-body)", color: "var(--color-text-light)" };

  function heading(block, level) {
    return h(level || "h2", { style: headingStyle }, val(block, "heading", ""));
  }

  function grid(columns, children) {
    return h(
      "div",
      { style: { display: "grid", gridTemplateColumns: columns, gap: "16px", marginTop: "16px" } },
      children
    );
  }

  function card(children) {
    return h("div", { className: "card", style: { padding: "20px" } }, children);
  }

  /** Render one block. Returns null for an unknown type so the pane never breaks. */
  function renderBlock(block, index, getAsset) {
    var type = val(block, "type", "");
    if (val(block, "visible", true) === false) {
      return h(
        "div",
        {
          key: index,
          style: {
            padding: "10px 16px", background: "#f1f1f1", color: "#888",
            font: "italic 13px/1.4 system-ui,sans-serif", borderBottom: "1px dashed #ccc",
          },
        },
        "Hidden section: " + (val(block, "heading", "") || type)
      );
    }

    var inner = [];

    switch (type) {
      case "hero":
        return h(
          "section",
          { key: index, className: "hero-gradient text-white " + (PAD_CLASSES[val(block, "padding", "large")] || "section-pad-lg"), style: { textAlign: "center", padding: "48px 24px", color: "#fff" } },
          h("h1", { style: { fontFamily: "var(--font-heading)", fontSize: "38px", fontWeight: 800, margin: "0 0 12px" } }, val(block, "heading", "")),
          h("p", { style: { fontFamily: "var(--font-body)", opacity: 0.9, margin: "0 0 20px" } }, val(block, "subheading", "")),
          h("a", { className: "btn-secondary" }, val(block.get("primaryCta"), "label", "Button"))
        );

      case "pageHeader":
        return h(
          "section",
          { key: index, className: sectionClass(block, "normal"), style: { padding: "40px 24px", textAlign: "center" } },
          h("h1", { style: headingStyle }, val(block, "heading", "")),
          h("p", { style: bodyStyle }, val(block, "body", ""))
        );

      case "text":
        var paragraphs = block.get("paragraphs");
        inner.push(heading(block));
        if (paragraphs && paragraphs.forEach) {
          paragraphs.forEach(function (p, i) {
            inner.push(h("p", { key: i, style: bodyStyle }, p));
          });
        }
        if (val(block, "emphasis", "")) {
          inner.push(h("p", { style: { fontWeight: 700, color: "var(--color-text)" } }, val(block, "emphasis", "")));
        }
        return h(
          "section",
          { key: index, className: sectionClass(block), style: { padding: "40px 24px", textAlign: val(block, "align", "center") === "left" ? "left" : "center" } },
          inner
        );

      case "cardGrid":
        var cards = block.get("cards");
        var cardEls = [];
        if (cards && cards.forEach) {
          cards.forEach(function (c, i) {
            cardEls.push(
              card([
                h("div", { key: "i", style: { fontSize: "26px" } }, val(c, "icon", "")),
                h("h3", { key: "t", style: headingStyle }, val(c, "title", "")),
                h("p", { key: "d", style: Object.assign({ fontSize: "14px" }, bodyStyle) }, val(c, "description", "")),
              ])
            );
          });
        }
        return h(
          "section",
          { key: index, className: sectionClass(block), style: { padding: "40px 24px" } },
          heading(block),
          grid(COLUMN_STYLE[String(val(block, "columns", "3"))] || COLUMN_STYLE["3"], cardEls)
        );

      case "contribute":
        return h(
          "section",
          { key: index, className: sectionClass(block, "small"), style: { padding: "32px 24px" } },
          heading(block),
          h("p", { style: bodyStyle }, val(block, "intro", "")),
          grid("repeat(2,minmax(0,1fr))", [
            card([
              h("h3", { key: "h", style: headingStyle }, val(block.get("primary"), "heading", "")),
              h("p", { key: "b", style: Object.assign({ fontSize: "14px" }, bodyStyle) }, val(block.get("primary"), "body", "")),
              h("a", { key: "c", className: "btn-primary" }, val(block.get("primary"), "ctaLabel", "")),
            ]),
            card([
              h("h3", { key: "h", style: headingStyle }, val(block.get("secondary"), "heading", "")),
              h("p", { key: "b", style: Object.assign({ fontSize: "14px" }, bodyStyle) }, val(block.get("secondary"), "body", "")),
              h("a", { key: "c", className: "btn-secondary" }, val(block.get("secondary"), "ctaLabel", "")),
            ]),
          ])
        );

      case "storyFeed":
      case "spotlight":
        return h(
          "section",
          { key: index, className: sectionClass(block), style: { padding: "40px 24px", textAlign: "center" } },
          heading(block),
          h("p", { style: bodyStyle }, val(block, "subheading", "")),
          h("p", { style: { font: "italic 13px/1.5 system-ui,sans-serif", color: "#999" } },
            type === "storyFeed"
              ? "Stories are pulled in automatically and will appear here on the live site."
              : "The featured organisation appears here on the live site.")
        );

      case "newsletter":
        return h(
          "section",
          { key: index, className: sectionClass(block), style: { padding: "40px 24px", textAlign: "center", color: "#fff" } },
          h("h2", { style: { fontFamily: "var(--font-heading)", color: "#fff" } }, val(block, "heading", "")),
          h("p", { style: { fontFamily: "var(--font-body)", opacity: 0.9 } }, val(block, "body", "")),
          h("a", { className: "btn-secondary" }, val(block, "buttonLabel", "Subscribe"))
        );

      case "stats":
        var stats = block.get("stats");
        var statEls = [];
        if (stats && stats.forEach) {
          stats.forEach(function (s, i) {
            statEls.push(
              card([
                h("div", { key: "v", style: { fontSize: "26px", fontWeight: 800, color: "var(--color-secondary)" } },
                  val(s, "auto", false) === true ? "auto" : val(s, "value", "")),
                h("p", { key: "l", style: Object.assign({ fontSize: "13px" }, bodyStyle) }, val(s, "label", "")),
              ])
            );
          });
        }
        return h(
          "section",
          { key: index, className: sectionClass(block), style: { padding: "40px 24px", textAlign: "center" } },
          heading(block),
          h("p", { style: bodyStyle }, val(block, "body", "")),
          grid("repeat(" + Math.max(statEls.length, 1) + ",minmax(0,1fr))", statEls)
        );

      case "stack":
        var items = block.get("items");
        var itemEls = [];
        if (items && items.forEach) {
          itemEls.push(heading(block));
          items.forEach(function (it, i) {
            itemEls.push(
              card([
                h("h3", { key: "t", style: { fontFamily: "var(--font-heading)", color: "var(--color-secondary)" } }, val(it, "title", "")),
                h("p", { key: "b", style: bodyStyle }, val(it, "body", "")),
              ])
            );
          });
        }
        return h("section", { key: index, className: sectionClass(block), style: { padding: "40px 24px" } }, itemEls);

      case "profiles":
        var people = block.get("people");
        var peopleEls = [];
        if (people && people.forEach) {
          people.forEach(function (p, i) {
            peopleEls.push(
              card([
                h("h3", { key: "n", style: headingStyle }, val(p, "name", "")),
                h("p", { key: "l", style: { fontSize: "13px", fontWeight: 600, color: "var(--color-secondary)" } }, val(p, "location", "")),
                h("p", { key: "b", style: Object.assign({ fontSize: "14px" }, bodyStyle) }, val(p, "paragraph1", "")),
              ])
            );
          });
        }
        return h(
          "section",
          { key: index, className: sectionClass(block), style: { padding: "40px 24px" } },
          heading(block),
          grid("repeat(2,minmax(0,1fr))", peopleEls)
        );

      case "ctaBanner":
        return h(
          "section",
          { key: index, className: sectionClass(block), style: { padding: "40px 24px", textAlign: "center", color: "#fff" } },
          h("h2", { style: { fontFamily: "var(--font-heading)", color: "#fff" } }, val(block, "heading", "")),
          h("p", { style: { fontFamily: "var(--font-body)", opacity: 0.9 } }, val(block, "body", "")),
          h("a", { className: "btn-secondary" }, val(block.get("primaryCta"), "label", ""))
        );

      default:
        return null;
    }
  }

  /** Shared preview component for any page built from a `blocks` list. */
  function makeBlocksPreview(pageLabel) {
    return createClass({
      render: function () {
        var data = this.props.entry.get("data");
        var getAsset = this.props.getAsset;
        var blocks = data.get("blocks");

        var rendered = [];
        if (blocks && blocks.forEach) {
          blocks.forEach(function (block, i) {
            var el = renderBlock(block, i, getAsset);
            if (el) rendered.push(el);
          });
        }

        return h(
          "div",
          null,
          h("div", { className: "tfp-preview-note" }, pageLabel + " — sections appear in the order listed"),
          rendered.length
            ? rendered
            : h("p", { style: { padding: "24px", color: "#888", fontFamily: "system-ui,sans-serif" } },
                "No sections yet. Use “Add Section” to build the page.")
        );
      },
    });
  }

  CMS.registerPreviewTemplate("homepage", makeBlocksPreview("Homepage"));
  CMS.registerPreviewTemplate("about", makeBlocksPreview("About Page"));
})();

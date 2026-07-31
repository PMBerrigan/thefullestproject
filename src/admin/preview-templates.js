/* Decap CMS preview templates.
 *
 * Decap exposes `h` (createElement) and `createClass` as globals — there is no
 * build step here, so everything below is plain ES5-ish vanilla JS in keeping
 * with the rest of src/js/.
 *
 * Preview styles come from the real build:
 *   /css/output.css        compiled Tailwind + custom component classes
 *   /admin/theme-preview.css  brand variables generated from theme.json
 * so what Nicole sees in the preview pane is what the site renders.
 */
(function () {
  "use strict";

  if (typeof CMS === "undefined") return;

  CMS.registerPreviewStyle("/css/output.css");
  CMS.registerPreviewStyle("/admin/theme-preview.css");
  CMS.registerPreviewStyle(
    "body{padding:0;margin:0;background:#fff}" +
      ".tfp-preview-note{font:600 12px/1.4 system-ui,sans-serif;color:#636E72;" +
      "background:#F6EFDC;padding:8px 12px;border-bottom:1px solid #e5ded0}",
    { raw: true }
  );

  /** Read a possibly-missing value out of an Immutable map. */
  function val(map, key, fallback) {
    if (!map || typeof map.get !== "function") return fallback;
    var v = map.get(key);
    return v === undefined || v === null || v === "" ? fallback : v;
  }

  var RADIUS = {
    soft: { button: "0.5rem", card: "0.75rem" },
    rounded: { button: "9999px", card: "1.25rem" },
    square: { button: "0.125rem", card: "0.25rem" },
  };
  var SPACING = { compact: "3rem", comfortable: "4rem", spacious: "6rem" };

  /**
   * Build the same :root block that components/theme-vars.njk emits, but from
   * the values currently in the editor so unsaved edits show immediately.
   */
  function themeVars(data, getAsset) {
    var colors = data.get("colors");
    var hero = data.get("hero");

    var primary = val(colors, "primary", "#3A668C");
    var secondary = val(colors, "secondary", "#D77E5E");
    var accent = val(colors, "accent", "#6A9346");
    var highlight = val(colors, "highlight", "#FDB92E");
    var radius = RADIUS[val(data, "cornerStyle", "soft")] || RADIUS.soft;
    var pad = SPACING[val(data, "sectionSpacing", "comfortable")] || SPACING.comfortable;

    var vars = [
      "--color-primary:" + primary,
      "--color-secondary:" + secondary,
      "--color-accent:" + accent,
      "--color-highlight:" + highlight,
      "--color-warm:" + val(colors, "warm", "#F6EFDC"),
      "--color-warm-light:" + val(colors, "warmSection", "#FCF8EE"),
      "--color-sky:" + val(colors, "coolSection", "#DAF8FE"),
      "--color-primary-dark:color-mix(in srgb," + primary + " 82%,#000)",
      "--color-primary-light:color-mix(in srgb," + primary + " 78%,#fff)",
      "--color-secondary-light:color-mix(in srgb," + secondary + " 75%,#fff)",
      "--color-accent-light:color-mix(in srgb," + accent + " 78%,#fff)",
      "--color-highlight-dark:color-mix(in srgb," + highlight + " 88%,#000)",
      "--font-heading:'" + val(data, "headingFont", "Nunito") + "',sans-serif",
      "--font-body:'" + val(data, "bodyFont", "Open Sans") + "',sans-serif",
      "--radius-button:" + radius.button,
      "--radius-card:" + radius.card,
      "--space-section:" + pad,
    ];

    var style = val(hero, "style", "gradient");
    if (style === "solid") {
      vars.push("--hero-background:var(--color-primary)");
    } else if (style === "image") {
      var image = val(hero, "image", "");
      if (image) {
        var src = getAsset ? getAsset(image).toString() : image;
        var o = Number(val(hero, "overlay", 45)) / 100;
        vars.push(
          "--hero-background:linear-gradient(rgba(0,0,0," + o + "),rgba(0,0,0," + o + ")),url('" +
            src + "') center / cover no-repeat"
        );
      }
    }

    return ":root{" + vars.join(";") + "}";
  }

  /** Load the chosen Google Fonts inside the preview iframe. */
  function fontLink(data) {
    var heading = val(data, "headingFont", "Nunito").replace(/ /g, "+");
    var body = val(data, "bodyFont", "Open Sans").replace(/ /g, "+");
    return h("link", {
      rel: "stylesheet",
      href:
        "https://fonts.googleapis.com/css2?family=" + heading +
        ":wght@400;600;700;800&family=" + body + ":wght@400;500;600&display=swap",
    });
  }

  function swatch(label, color) {
    return h(
      "div",
      { style: { textAlign: "center" } },
      h("div", {
        style: {
          background: color,
          height: "56px",
          borderRadius: "var(--radius-card)",
          border: "1px solid rgba(0,0,0,.08)",
        },
      }),
      h("div", { style: { fontSize: "11px", marginTop: "6px", color: "#636E72" } }, label),
      h("code", { style: { fontSize: "10px", color: "#9aa0a3" } }, color)
    );
  }

  /**
   * Design & Branding preview: a miniature of the real site chrome so colour,
   * font, corner and spacing choices can be judged in context rather than as
   * abstract swatches.
   */
  var ThemePreview = createClass({
    render: function () {
      var data = this.props.entry.get("data");
      var getAsset = this.props.getAsset;
      var colors = data.get("colors");

      return h(
        "div",
        null,
        h("style", null, themeVars(data, getAsset)),
        fontLink(data),
        h("div", { className: "tfp-preview-note" }, "Live preview of your design settings"),

        h(
          "section",
          { className: "hero-gradient", style: { padding: "var(--space-section) 24px", textAlign: "center", color: "#fff" } },
          h("h1", { style: { fontFamily: "var(--font-heading)", fontSize: "34px", fontWeight: 800, margin: "0 0 12px" } },
            "You are not doing this alone."),
          h("p", { style: { fontFamily: "var(--font-body)", opacity: 0.9, margin: "0 0 20px" } },
            "A connection hub for caregivers."),
          h("a", { className: "btn-secondary", style: { borderRadius: "var(--radius-button)" } }, "Find Resources")
        ),

        h(
          "section",
          { className: "section-warm", style: { padding: "var(--space-section) 24px" } },
          h("h2", { style: { fontFamily: "var(--font-heading)", color: "var(--color-primary)", marginTop: 0 } },
            "Warm section background"),
          h("p", { style: { fontFamily: "var(--font-body)", color: "#636E72" } },
            "Body text in your chosen font. Sections alternate between the warm and cool backgrounds below."),
          h(
            "div",
            { style: { display: "flex", gap: "12px", flexWrap: "wrap" } },
            h("a", { className: "btn-primary", style: { borderRadius: "var(--radius-button)" } }, "Primary button"),
            h("a", { className: "btn-secondary", style: { borderRadius: "var(--radius-button)" } }, "Highlight button")
          )
        ),

        h(
          "section",
          { className: "section-cool", style: { padding: "var(--space-section) 24px" } },
          h("h2", { style: { fontFamily: "var(--font-heading)", color: "var(--color-primary)", marginTop: 0 } },
            "Cool section background"),
          h(
            "div",
            { className: "card", style: { padding: "20px", maxWidth: "320px" } },
            h("div", { style: { fontSize: "28px" } }, "📚"),
            h("h3", { style: { fontFamily: "var(--font-heading)", color: "var(--color-primary)", margin: "8px 0" } },
              "A card"),
            h("p", { style: { fontFamily: "var(--font-body)", color: "#636E72", fontSize: "14px", margin: 0 } },
              "Corner style controls how rounded this card and the buttons are.")
          )
        ),

        h(
          "section",
          { style: { padding: "24px" } },
          h("h3", { style: { fontFamily: "var(--font-heading)", fontSize: "14px", color: "#636E72", textTransform: "uppercase", letterSpacing: ".05em" } },
            "Your palette"),
          h(
            "div",
            { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: "12px" } },
            swatch("Primary", val(colors, "primary", "#3A668C")),
            swatch("Secondary", val(colors, "secondary", "#D77E5E")),
            swatch("Accent", val(colors, "accent", "#6A9346")),
            swatch("Highlight", val(colors, "highlight", "#FDB92E")),
            swatch("Warm", val(colors, "warm", "#F6EFDC"))
          )
        )
      );
    },
  });

  CMS.registerPreviewTemplate("theme", ThemePreview);

  // Exposed so blocks-preview.js can reuse the brand variables and font loading.
  window.TFPPreview = { themeVars: themeVars, fontLink: fontLink, val: val };
})();

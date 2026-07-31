/**
 * The complete list of block fields that may be changed by the inline editor.
 *
 * Keyed on (blockType, exact path pattern) rather than on a field name, so
 * `heading` at the top of a block is a different permission from `card.heading`
 * inside it, and a future block type with a field called `heading` is not
 * silently enrolled.
 *
 * `#` stands for one array index. Every pattern contains at most one.
 * `max` is the character limit shown to the editor and enforced server-side.
 * `label` matches the wording in src/admin/config.yml so both tools agree.
 *
 * Derived from the `data-block-field` anchors in
 * src/_includes/components/blocks/*.njk — if you add an anchor there, add it
 * here too or it will render without an editing affordance.
 *
 * Deliberately absent:
 *   - every `*.url` / `*.ctaUrl` — not rendered as text, and a bad href is both
 *     invisible to the person typing it and the one field class where a
 *     `javascript:` value survives Nunjucks autoescaping.
 *   - `stats.#.value` — blocks/stats.njk renders it inside a plain <div> with no
 *     anchor, because of the `{% if stat.auto %}` branch. Nothing to bind.
 *   - `custom` blocks — components/custom/*.njk emit no anchors at all.
 */

export const EDITABLE_FIELDS = {
  hero: {
    heading: { label: "Main heading", max: 120 },
    subheading: { label: "Subheading", max: 400 },
    "primaryCta.label": { label: "Button text", max: 40 },
    "secondaryCta.label": { label: "Button text", max: 40 },
  },
  banner: {
    heading: { label: "Heading", max: 120 },
    subheading: { label: "Intro text", max: 400 },
  },
  pageHeader: {
    heading: { label: "Heading", max: 120 },
    body: { label: "Intro text", max: 600 },
  },
  text: {
    heading: { label: "Heading", max: 120 },
    "paragraphs.#": { label: "Paragraph", max: 1500 },
    emphasis: { label: "Bold closing line", max: 300 },
  },
  cardGrid: {
    heading: { label: "Heading", max: 120 },
    "cards.#.title": { label: "Card title", max: 80 },
    "cards.#.description": { label: "Card text", max: 600 },
  },
  contribute: {
    heading: { label: "Heading", max: 120 },
    intro: { label: "Intro text", max: 600 },
    "primary.heading": { label: "Left card heading", max: 80 },
    "primary.body": { label: "Left card text", max: 600 },
    "primary.ctaLabel": { label: "Left card button", max: 40 },
    "secondary.heading": { label: "Right card heading", max: 80 },
    "secondary.body": { label: "Right card text", max: 600 },
    "secondary.ctaLabel": { label: "Right card button", max: 40 },
  },
  storyFeed: {
    heading: { label: "Heading", max: 120 },
    subheading: { label: "Subheading", max: 400 },
    emptyMessage: { label: "Empty-state message", max: 400 },
    emptyCtaLabel: { label: "Empty-state button", max: 40 },
    browseAllLabel: { label: "Browse-all button", max: 60 },
  },
  spotlight: {
    heading: { label: "Heading", max: 120 },
    subheading: { label: "Subheading", max: 400 },
    viewAllLabel: { label: "View-all button", max: 60 },
  },
  newsletter: {
    heading: { label: "Heading", max: 120 },
    body: { label: "Text", max: 600 },
    buttonLabel: { label: "Button text", max: 40 },
  },
  stats: {
    heading: { label: "Heading", max: 120 },
    body: { label: "Text", max: 600 },
    "stats.#.label": { label: "Stat caption", max: 60 },
    ctaLabel: { label: "Button text", max: 40 },
  },
  stack: {
    heading: { label: "Heading", max: 120 },
    "items.#.title": { label: "Card title", max: 80 },
    "items.#.body": { label: "Card text", max: 800 },
  },
  profiles: {
    heading: { label: "Heading", max: 120 },
    "people.#.name": { label: "Name", max: 80 },
    "people.#.location": { label: "Location", max: 80 },
    "people.#.paragraph1": { label: "Paragraph 1", max: 1500 },
    "people.#.paragraph2": { label: "Paragraph 2", max: 1500 },
    "people.#.highlight": { label: "Highlight", max: 300 },
  },
  ctaBanner: {
    heading: { label: "Heading", max: 120 },
    body: { label: "Text", max: 600 },
    "primaryCta.label": { label: "Button text", max: 40 },
    "secondaryCta.label": { label: "Button text", max: 40 },
  },
  tierCard: {
    heading: { label: "Heading", max: 120 },
    intro: { label: "Intro text", max: 600 },
    "card.heading": { label: "Card heading", max: 80 },
    "card.body": { label: "Card text", max: 800 },
    "card.ctaLabel": { label: "Button text", max: 40 },
    "footnote.text": { label: "Footnote", max: 300 },
  },
  custom: {},
};

/** Which JSON file backs each editable page. */
export const EDITABLE_PAGES = {
  homepage: "src/_data/homepage.json",
  about: "src/_data/about.json",
  getInvolved: "src/_data/getInvolved.json",
};

/** Decap entry name for the ⚙ deep link out to the Content Manager. */
export const CMS_ENTRY = {
  homepage: "homepage",
  about: "about",
  getInvolved: "getInvolved",
};

const FIELD_PATH = /^[A-Za-z][A-Za-z0-9]{0,31}(\.([A-Za-z][A-Za-z0-9]{0,31}|\d{1,3})){0,3}$/;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Collapse array indices so a concrete path can be matched against the table. */
export function toPattern(fieldPath) {
  return fieldPath
    .split(".")
    .map((seg) => (/^\d+$/.test(seg) ? "#" : seg))
    .join(".");
}

/** Look up the rule for a concrete path on a block type. */
export function matchRule(blockType, fieldPath) {
  const rules = EDITABLE_FIELDS[blockType];
  if (!rules) return null;
  return rules[toPattern(fieldPath)] || null;
}

/**
 * Walk a block to the value a field path names.
 *
 * Returns { parent, key, current, rule } on success so the caller can assign,
 * or { error } — never throws, so one stale field becomes one conflict row
 * rather than a 500 that discards the whole batch.
 *
 * Refuses to create keys, to traverse prototype pollution vectors, or to land
 * on anything that is not already a non-empty string. That last rule is what
 * makes the blast radius honest: inline editing can change words, but it can
 * never add or remove content, or flip a boolean like `visible`.
 */
export function resolveLeaf(block, blockType, fieldPath) {
  if (typeof fieldPath !== "string" || !FIELD_PATH.test(fieldPath)) {
    return { error: "field-not-editable" };
  }
  const rule = matchRule(blockType, fieldPath);
  if (!rule) return { error: "field-not-editable" };

  const segments = fieldPath.split(".");
  if (segments.length > 4) return { error: "field-not-editable" };

  let node = block;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (UNSAFE_KEYS.has(seg)) return { error: "field-not-editable" };
    if (/^\d+$/.test(seg)) {
      const idx = Number(seg);
      if (!Array.isArray(node) || idx < 0 || idx >= node.length) return { error: "section-moved" };
      node = node[idx];
    } else {
      if (!node || typeof node !== "object" || Array.isArray(node)) return { error: "section-moved" };
      if (!Object.prototype.hasOwnProperty.call(node, seg)) return { error: "section-moved" };
      node = node[seg];
    }
  }

  const key = segments[segments.length - 1];
  if (UNSAFE_KEYS.has(key)) return { error: "field-not-editable" };

  if (/^\d+$/.test(key)) {
    const idx = Number(key);
    if (!Array.isArray(node) || idx < 0 || idx >= node.length) return { error: "section-moved" };
    const current = node[idx];
    if (typeof current !== "string" || current === "") return { error: "not-text" };
    return { parent: node, key: idx, current, rule };
  }

  if (!node || typeof node !== "object" || Array.isArray(node)) return { error: "section-moved" };
  if (!Object.prototype.hasOwnProperty.call(node, key)) return { error: "section-moved" };
  const current = node[key];
  if (typeof current !== "string" || current === "") return { error: "not-text" };
  return { parent: node, key, current, rule };
}

/**
 * Normalise and check a submitted value.
 * Angle brackets, ampersands and quotes are preserved — every anchored value
 * renders through {{ }}, which Nunjucks autoescapes, and rejecting them would
 * break legitimate copy like "Ages 3 > K" with an opaque error.
 * Internal double spaces are preserved too: deleting one is a real edit.
 */
export function cleanValue(value, max) {
  if (typeof value !== "string") return { error: "not-text" };
  const normalised = value.normalize("NFC");
  if (/[\n\r\t]/.test(normalised)) return { error: "no-line-breaks" };
  // Reject C0/C1 control characters. Written as a code-point scan rather than
  // a regex literal so no escape sequence can be mangled by a tool in between.
  for (let i = 0; i < normalised.length; i++) {
    const code = normalised.charCodeAt(i);
    if (code < 32 || (code >= 127 && code < 160)) return { error: "no-control-characters" };
  }
  const trimmed = normalised.replace(/^\s+|\s+$/g, "");
  if (trimmed === "") return { error: "empty" };
  if (trimmed.length > max) return { error: "too-long" };
  return { value: trimmed };
}

/** Human wording for each machine reason, so the client never invents copy. */
export const REASON_TEXT = {
  "field-not-editable": "This one has to be changed in the Content Manager.",
  "section-moved": "This section moved or was removed while you were working.",
  "not-text": "This one has to be changed in the Content Manager.",
  "changed-elsewhere": "The live text changed while you were working.",
  "no-line-breaks": "Line breaks aren't kept here — use the Content Manager to split a paragraph.",
  "no-control-characters": "That contains characters we can't save. Try retyping it.",
  empty: "Text can't be empty. To remove a whole section, use the Content Manager.",
  "too-long": "That's too long for this spot.",
};

/** A short human name for a block, used in the review list. */
export function blockLabel(block, index) {
  const heading = block && typeof block.heading === "string" && block.heading ? block.heading : "";
  const type = (block && block.type) || "section";
  return heading ? `${heading}` : `${type} (section ${index + 1})`;
}

/**
 * Every editable leaf in a document, expanded over real array lengths.
 * The client makes editable ONLY what this returns, so the client and server
 * allow-lists cannot drift — there is only one.
 */
export function enumerateFields(blocks) {
  const out = [];
  (blocks || []).forEach((block, blockIndex) => {
    if (!block || typeof block !== "object") return;
    if (block.visible === false) return;
    const rules = EDITABLE_FIELDS[block.type];
    if (!rules) return;

    for (const pattern of Object.keys(rules)) {
      const rule = rules[pattern];
      const paths = pattern.includes("#") ? expandPattern(block, pattern) : [pattern];
      for (const path of paths) {
        const slot = resolveLeaf(block, block.type, path);
        if (slot.error) continue;
        out.push({
          blockIndex,
          blockId: block.id || "",
          blockType: block.type,
          field: path,
          value: slot.current,
          label: rule.label,
          blockLabel: blockLabel(block, blockIndex),
          maxLength: rule.max,
        });
      }
    }
  });
  return out;
}

/** Expand the single `#` in a pattern over the length of the array it names. */
function expandPattern(block, pattern) {
  const before = pattern.slice(0, pattern.indexOf("#") - 1);
  let node = block;
  for (const seg of before.split(".")) {
    if (!node || typeof node !== "object") return [];
    node = node[seg];
  }
  if (!Array.isArray(node)) return [];
  return node.map((_, i) => pattern.replace("#", String(i)));
}

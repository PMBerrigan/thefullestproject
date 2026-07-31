/**
 * Locating a JSON value inside the rendered page.
 *
 * Pure functions, no module state, importable from Node so the binding rules
 * can be tested against the real built HTML.
 *
 * The hard part is that two live anchors do not contain their JSON value
 * cleanly. `storyFeed`'s browse-all link renders `{{ browseAllLabel }} &rarr;`,
 * so the element's text has a trailing arrow that is NOT part of the value; and
 * `text.njk` nests `<strong data-block-field="emphasis">` inside
 * `<p data-block-field="paragraphs.N">`, so the paragraph element contains text
 * belonging to a different field. Both are handled by working at the level of
 * individual text nodes rather than element text.
 */

/**
 * Find the single element carrying this field.
 * Zero matches means the block self-hid (spotlight with nothing featured, or
 * storyFeed's empty state when stories exist). Two or more means the template
 * declares the anchor in more than one branch. Neither is bindable, and in both
 * cases the right behaviour is to offer no editing affordance at all.
 */
export function findElement(doc, field) {
  const matches = doc.querySelectorAll(
    '[data-block-index="' + field.blockIndex + '"] [data-block-field="' + cssEscape(field.field) + '"]'
  );
  if (matches.length !== 1) return { error: matches.length === 0 ? "absent" : "ambiguous", matches: matches.length };

  const el = matches[0];
  const section = el.closest("[data-block-index]");
  if (field.blockId && section && section.dataset.blockId && section.dataset.blockId !== field.blockId) {
    return { error: "section-moved", matches: 1 };
  }
  return { el, matches: 1 };
}

/**
 * Find where the value sits inside the element.
 *
 * Only the element's OWN text nodes count — a node whose nearest
 * [data-block-field] ancestor is some other element belongs to that field, not
 * this one. Then the value must appear in exactly one of them, exactly once;
 * anything else is treated as not bindable rather than guessed at.
 *
 * Not finding the value is also the staleness detector: the model comes from
 * the repo's HEAD while the page shows the last deployed build, so if someone
 * saved in the CMS two minutes ago the text will not match and the field goes
 * uneditable instead of silently overwriting a newer value.
 */
export function locateValue(el, value) {
  if (!el || typeof value !== "string" || value === "") return { error: "not-found" };

  const own = ownTextNodes(el);
  const hits = [];
  for (const node of own) {
    const text = node.nodeValue;
    const first = text.indexOf(value);
    if (first === -1) continue;
    if (text.indexOf(value, first + 1) !== -1) return { error: "ambiguous" }; // twice in one node
    hits.push({ node, offset: first });
  }
  if (hits.length !== 1) return { error: hits.length === 0 ? "not-found" : "ambiguous" };

  const { node, offset } = hits[0];
  return {
    node,
    before: node.nodeValue.slice(0, offset),
    after: node.nodeValue.slice(offset + value.length),
    value,
  };
}

/**
 * Repaint the located text node with a new value.
 * Only ever assigns nodeValue on the one node the binding identified — no node
 * is created or removed, no innerHTML, no textContent, no contenteditable. The
 * element's children (a nested <strong>, a sibling <a>) are structurally
 * unreachable from here, which is the point.
 */
export function applyPreview(binding, newValue) {
  if (!binding || !binding.node) return false;
  binding.node.nodeValue = binding.before + newValue + binding.after;
  return true;
}

/** Text nodes directly owned by `el`, excluding any nested anchored field. */
function ownTextNodes(el) {
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out.push(child);
      } else if (child.nodeType === 1 && !child.hasAttribute("data-block-field")) {
        walk(child);
      }
    }
  };
  walk(el);
  return out;
}

/** Minimal attribute-value escape — field paths are [A-Za-z0-9._] in practice. */
function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

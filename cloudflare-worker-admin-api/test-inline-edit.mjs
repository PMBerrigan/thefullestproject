/**
 * Unit tests for the inline editor's field allow-list and path resolution.
 * Node stdlib only, matching the scrapers/test_*.py convention.
 *
 *   node cloudflare-worker-admin-api/test-inline-edit.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDITABLE_FIELDS, EDITABLE_PAGES,
  resolveLeaf, cleanValue, enumerateFields, matchRule, toPattern,
} from "./editable-fields.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

const heroBlock = {
  type: "hero", id: "hero", visible: true,
  heading: "Living Life to the Fullest",
  subheading: "Your connection hub.",
  primaryCta: { label: "Find Resources", url: "/resources/" },
};
const cardBlock = {
  type: "cardGrid", id: "features", visible: true, heading: "How We Can Help",
  cards: [
    { icon: "📍", title: "Directory", description: "Find things.", url: "/resources/" },
    { icon: "🧠", title: "Therapy", description: "Learn things.", url: "/therapy-guide/" },
  ],
};
const statsBlock = {
  type: "stats", id: "coverage", visible: true, heading: "Serving All 50 States", body: "…",
  stats: [{ auto: true, value: "", label: "Resources Listed" }, { auto: false, value: "51", label: "Locations" }],
  ctaLabel: "Browse", ctaUrl: "/resources/",
};

// ─── Path patterns ───────────────────────────────────────────────────────────

test("toPattern collapses array indices", () => {
  assert.equal(toPattern("cards.2.title"), "cards.#.title");
  assert.equal(toPattern("paragraphs.0"), "paragraphs.#");
  assert.equal(toPattern("primaryCta.label"), "primaryCta.label");
});

test("matchRule is keyed on (blockType, path) not on field name", () => {
  assert.ok(matchRule("profiles", "people.0.name"), "profiles.people.#.name should exist");
  assert.equal(matchRule("cardGrid", "people.0.name"), null, "right name, wrong block type");
  // `heading` at the top of tierCard is a different permission from card.heading
  assert.ok(matchRule("tierCard", "heading"));
  assert.ok(matchRule("tierCard", "card.heading"));
  assert.equal(matchRule("hero", "card.heading"), null);
});

// ─── resolveLeaf ─────────────────────────────────────────────────────────────

test("resolveLeaf reads a plain field", () => {
  const slot = resolveLeaf(heroBlock, "hero", "heading");
  assert.equal(slot.current, "Living Life to the Fullest");
  assert.equal(slot.rule.max, 120);
});

test("resolveLeaf reads a nested field", () => {
  assert.equal(resolveLeaf(heroBlock, "hero", "primaryCta.label").current, "Find Resources");
});

test("resolveLeaf reads through an array index", () => {
  assert.equal(resolveLeaf(cardBlock, "cardGrid", "cards.1.title").current, "Therapy");
});

test("resolveLeaf refuses prototype-pollution keys at every position", () => {
  for (const p of ["__proto__", "constructor", "prototype",
                   "primaryCta.__proto__", "__proto__.label", "cards.0.__proto__"]) {
    const slot = resolveLeaf(cardBlock, "cardGrid", p);
    assert.ok(slot.error, `${p} should be refused, got ${JSON.stringify(slot)}`);
  }
});

test("resolveLeaf refuses out-of-range and negative indices", () => {
  assert.ok(resolveLeaf(cardBlock, "cardGrid", "cards.99.title").error);
  // A negative index cannot even match the path grammar.
  assert.equal(resolveLeaf(cardBlock, "cardGrid", "cards.-1.title").error, "field-not-editable");
});

test("resolveLeaf refuses anything that is not already a non-empty string", () => {
  // Booleans, numbers and empty slots are all excluded by one rule, which is
  // what stops inline editing from creating or removing content.
  assert.equal(resolveLeaf(statsBlock, "stats", "stats.0.label").current, "Resources Listed");
  const emptyValue = resolveLeaf({ ...statsBlock }, "stats", "stats.0.value");
  assert.ok(emptyValue.error, "stats.#.value is not in the table at all");
});

test("resolveLeaf never creates a key", () => {
  const block = { type: "hero", heading: "Hi" };
  assert.ok(resolveLeaf(block, "hero", "subheading").error);
  assert.equal("subheading" in block, false, "resolveLeaf must not have added the key");
});

test("resolveLeaf refuses a field absent from the table", () => {
  assert.equal(resolveLeaf(heroBlock, "hero", "visible").error, "field-not-editable");
  assert.equal(resolveLeaf(cardBlock, "cardGrid", "cards.0.url").error, "field-not-editable");
  assert.equal(resolveLeaf(cardBlock, "cardGrid", "columns").error, "field-not-editable");
});

test("resolveLeaf refuses unknown block types", () => {
  assert.equal(resolveLeaf({ type: "nope", heading: "x" }, "nope", "heading").error, "field-not-editable");
});

// ─── cleanValue ──────────────────────────────────────────────────────────────

test("cleanValue rejects empty and whitespace-only", () => {
  assert.equal(cleanValue("", 100).error, "empty");
  assert.equal(cleanValue("   ", 100).error, "empty");
});

test("cleanValue rejects line breaks, tabs and control characters", () => {
  assert.equal(cleanValue("a\nb", 100).error, "no-line-breaks");
  assert.equal(cleanValue("a\tb", 100).error, "no-line-breaks");
  assert.equal(cleanValue("a" + String.fromCharCode(0) + "b", 100).error, "no-control-characters");
  assert.equal(cleanValue("a" + String.fromCharCode(127) + "b", 100).error, "no-control-characters");
  assert.equal(cleanValue("a" + String.fromCharCode(155) + "b", 100).error, "no-control-characters");
});

test("cleanValue rejects over-length", () => {
  assert.equal(cleanValue("x".repeat(41), 40).error, "too-long");
  assert.equal(cleanValue("x".repeat(40), 40).value.length, 40);
});

test("cleanValue preserves angle brackets, ampersands and quotes", () => {
  // Every anchored value renders through {{ }}, which Nunjucks autoescapes.
  // Rejecting these would break legitimate copy with an opaque error.
  assert.equal(cleanValue("Ages 3 > K & up", 100).value, "Ages 3 > K & up");
  assert.equal(cleanValue('She said "hi"', 100).value, 'She said "hi"');
  assert.equal(cleanValue("<not a tag>", 100).value, "<not a tag>");
});

test("cleanValue preserves internal double spaces but trims the ends", () => {
  assert.equal(cleanValue("  a  b  ", 100).value, "a  b");
});

// ─── enumerateFields against the real site data ──────────────────────────────

test("every editable page enumerates fields from its real data file", () => {
  for (const [page, file] of Object.entries(EDITABLE_PAGES)) {
    const doc = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    const fields = enumerateFields(doc.blocks);
    assert.ok(fields.length > 0, `${page} enumerated nothing`);
    for (const f of fields) {
      assert.equal(typeof f.value, "string");
      assert.ok(f.value.length > 0, `${page} ${f.field} enumerated an empty value`);
      assert.ok(f.maxLength >= f.value.length,
        `${page} ${f.field} is already longer (${f.value.length}) than its limit (${f.maxLength})`);
    }
  }
});

test("enumerateFields skips hidden blocks", () => {
  const visible = enumerateFields([{ ...heroBlock }]);
  const hidden = enumerateFields([{ ...heroBlock, visible: false }]);
  assert.ok(visible.length > 0);
  assert.equal(hidden.length, 0);
});

test("enumerateFields expands array patterns over real lengths", () => {
  const fields = enumerateFields([cardBlock]);
  const titles = fields.filter(f => /^cards\.\d+\.title$/.test(f.field)).map(f => f.field);
  assert.deepEqual(titles, ["cards.0.title", "cards.1.title"]);
});

test("enumerateFields never offers a URL or a structural field", () => {
  for (const file of Object.values(EDITABLE_PAGES)) {
    const doc = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    for (const f of enumerateFields(doc.blocks)) {
      assert.ok(!/url$/i.test(f.field), `${f.field} is a URL and must not be inline-editable`);
      assert.ok(!["visible", "background", "padding", "align", "columns", "layout", "borderColor"]
        .includes(f.field), `${f.field} is structural`);
    }
  }
});

test("custom blocks expose nothing", () => {
  assert.deepEqual(EDITABLE_FIELDS.custom, {});
  assert.equal(enumerateFields([{ type: "custom", include: "get-involved-share" }]).length, 0);
});

// ─── The table matches the templates ─────────────────────────────────────────

test("every data-block-field anchor in the templates is in the table", () => {
  const dir = path.join(root, "src/_includes/components/blocks");
  const missing = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".njk"))) {
    const type = file.replace(/\.njk$/, "");
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of html.matchAll(/data-block-field="([^"]+)"/g)) {
      // Anchors interpolate the loop index, e.g. cards.{{ loop.index0 }}.title
      const pattern = m[1].replace(/\{\{[^}]+\}\}/g, "#");
      if (!EDITABLE_FIELDS[type] || !EDITABLE_FIELDS[type][pattern]) {
        missing.push(`${type}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(missing, [], `anchors with no rule (they would render uneditable):\n  ${missing.join("\n  ")}`);
});

test("every rule in the table has a matching anchor in its template", () => {
  const dir = path.join(root, "src/_includes/components/blocks");
  const orphans = [];
  for (const [type, rules] of Object.entries(EDITABLE_FIELDS)) {
    const file = path.join(dir, `${type}.njk`);
    if (!fs.existsSync(file)) { orphans.push(`${type}: no template`); continue; }
    const html = fs.readFileSync(file, "utf8");
    const anchors = new Set(
      [...html.matchAll(/data-block-field="([^"]+)"/g)].map(m => m[1].replace(/\{\{[^}]+\}\}/g, "#"))
    );
    for (const pattern of Object.keys(rules)) {
      if (!anchors.has(pattern)) orphans.push(`${type}: ${pattern}`);
    }
  }
  assert.deepEqual(orphans, [], `rules with no anchor (dead entries):\n  ${orphans.join("\n  ")}`);
});

// ─── Report ──────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`\n${failures.length} FAILED, ${passed} passed\n`);
  for (const f of failures) console.error("  FAIL " + f + "\n");
  process.exit(1);
}
console.log(`All ${passed} inline-edit unit tests passed.`);

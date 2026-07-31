#!/usr/bin/env node
/**
 * Proves the block controls do what the CMS promises: reordering the list
 * reorders the page, and switching a section off removes it.
 *
 * Mutates src/_data/homepage.json, rebuilds, inspects the output, then always
 * restores the original file.
 *
 *   node scripts/verify-block-controls.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DATA = path.join(__dirname, "..", "src", "_data", "homepage.json");
const OUT = path.join(__dirname, "..", "_site", "index.html");

const original = fs.readFileSync(DATA, "utf8");

function build() {
  execSync("npx @11ty/eleventy", { cwd: path.join(__dirname, ".."), stdio: "pipe" });
}

function renderedTypes() {
  const html = fs.readFileSync(OUT, "utf8");
  return [...html.matchAll(/data-block-type="([a-zA-Z]+)"/g)].map((m) => m[1]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log("  PASS " + message);
}

try {
  build();
  const before = renderedTypes();
  console.log("Baseline order:", before.join(" > "));

  // --- Reorder: move the last block to the front -------------------------
  const reordered = JSON.parse(original);
  const moved = reordered.blocks.pop();
  reordered.blocks.unshift(moved);
  fs.writeFileSync(DATA, JSON.stringify(reordered, null, 2) + "\n");
  build();

  const afterReorder = renderedTypes();
  console.log("Reordered     :", afterReorder.join(" > "));
  assert(afterReorder[0] === moved.type, `moving "${moved.type}" to the top moves it on the page`);
  assert(afterReorder.length === before.length, "reordering does not add or drop sections");
  assert(
    [...afterReorder].sort().join() === [...before].sort().join(),
    "reordering preserves the same set of sections"
  );

  // --- Hide: switch one section off --------------------------------------
  const hidden = JSON.parse(original);
  const target = hidden.blocks.find((b) => b.type === "cardGrid");
  target.visible = false;
  fs.writeFileSync(DATA, JSON.stringify(hidden, null, 2) + "\n");
  build();

  const afterHide = renderedTypes();
  console.log("With cardGrid hidden:", afterHide.join(" > "));
  assert(!afterHide.includes("cardGrid"), 'setting visible:false removes "cardGrid" from the page');
  assert(afterHide.length === before.length - 1, "hiding removes exactly one section");

  // --- Variant: change the card grid to 2 columns ------------------------
  const variant = JSON.parse(original);
  variant.blocks.find((b) => b.type === "cardGrid").columns = "2";
  fs.writeFileSync(DATA, JSON.stringify(variant, null, 2) + "\n");
  build();

  // Scope to the cardGrid section — storyFeed legitimately uses 3-column classes too.
  const html = fs.readFileSync(OUT, "utf8");
  const cardGridSection = html.slice(
    html.indexOf('data-block-type="cardGrid"'),
    html.indexOf("</section>", html.indexOf('data-block-type="cardGrid"'))
  );
  assert(
    cardGridSection.includes("grid grid-cols-1 md:grid-cols-2 gap-8"),
    "switching columns to 2 changes the card grid classes"
  );
  assert(
    !cardGridSection.includes("lg:grid-cols-3"),
    "the card grid no longer carries the 3-column class"
  );

  console.log("\nAll block controls verified.");
} finally {
  fs.writeFileSync(DATA, original);
  build();
  console.log("Restored homepage.json and rebuilt.");
}

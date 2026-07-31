#!/usr/bin/env node
/**
 * HTML baseline snapshot + diff.
 *
 * The block-model refactor (Phases 2-3) must not change what the site renders.
 * This captures every built HTML file, then compares a later build against it so
 * a refactor can be proven output-neutral instead of eyeballed.
 *
 *   node scripts/html-baseline.js snapshot [dir]   # capture _site/**\/*.html
 *   node scripts/html-baseline.js diff [dir]       # compare current build to it
 *
 * Default dir is .baseline/ (gitignored).
 *
 * Additive `data-block-*` anchors are expected noise once Phase 2 lands, so
 * `diff` reports them separately from real content changes and only exits
 * non-zero on the latter.
 */

const fs = require("fs");
const path = require("path");

const SITE = path.join(__dirname, "..", "_site");
const DEFAULT_DIR = path.join(__dirname, "..", ".baseline");

function htmlFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function relKey(file, root) {
  return path.relative(root, file).split(path.sep).join("/");
}

/** Strip the anchors Phase 2 adds so they don't read as content changes. */
function stripBlockAnchors(html) {
  return html
    .replace(/\s+data-block-id="[^"]*"/g, "")
    .replace(/\s+data-block-type="[^"]*"/g, "")
    .replace(/\s+data-block-field="[^"]*"/g, "")
    .replace(/\s+data-block-index="[^"]*"/g, "");
}

/** Collapse whitespace so indentation changes in templates don't trip the diff. */
function normalize(html) {
  return stripBlockAnchors(html).replace(/\s+/g, " ").trim();
}

function snapshot(dir) {
  const files = htmlFiles(SITE);
  if (!files.length) {
    console.error("No HTML in _site/. Run `npm run build:11ty` first.");
    process.exit(1);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  for (const file of files) {
    const key = relKey(file, SITE);
    const dest = path.join(dir, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  }
  console.log(`Snapshot: ${files.length} HTML files -> ${path.relative(process.cwd(), dir)}`);
}

function diff(dir) {
  const baseFiles = htmlFiles(dir);
  if (!baseFiles.length) {
    console.error(`No baseline at ${dir}. Run \`snapshot\` first.`);
    process.exit(1);
  }

  const base = new Map(baseFiles.map((f) => [relKey(f, dir), f]));
  const curr = new Map(htmlFiles(SITE).map((f) => [relKey(f, SITE), f]));

  const removed = [...base.keys()].filter((k) => !curr.has(k));
  const added = [...curr.keys()].filter((k) => !base.has(k));
  const changed = [];
  const anchorsOnly = [];

  for (const [key, baseFile] of base) {
    const currFile = curr.get(key);
    if (!currFile) continue;
    const a = fs.readFileSync(baseFile, "utf8");
    const b = fs.readFileSync(currFile, "utf8");
    if (a === b) continue;
    if (normalize(a) === normalize(b)) anchorsOnly.push(key);
    else changed.push({ key, a: normalize(a), b: normalize(b) });
  }

  console.log(`Compared ${base.size} baseline files against ${curr.size} built files.`);
  if (anchorsOnly.length) {
    console.log(`\n  ${anchorsOnly.length} file(s) differ ONLY by block anchors/whitespace (expected):`);
    for (const k of anchorsOnly.slice(0, 10)) console.log(`    ~ ${k}`);
    if (anchorsOnly.length > 10) console.log(`    ... and ${anchorsOnly.length - 10} more`);
  }
  if (added.length) {
    console.log(`\n  ${added.length} new page(s):`);
    for (const k of added) console.log(`    + ${k}`);
  }

  let failed = false;

  if (removed.length) {
    failed = true;
    console.log(`\nFAIL - ${removed.length} page(s) disappeared:`);
    for (const k of removed) console.log(`    - ${k}`);
  }

  if (changed.length) {
    failed = true;
    console.log(`\nFAIL - ${changed.length} page(s) changed content:`);
    for (const { key, a, b } of changed) {
      console.log(`\n  ${key}`);
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      const start = Math.max(0, i - 60);
      console.log(`    baseline: ...${a.slice(start, i + 120)}`);
      console.log(`    current : ...${b.slice(start, i + 120)}`);
    }
  }

  if (failed) process.exit(1);
  console.log("\nPASS - no content changes.");
}

const [, , cmd, dirArg] = process.argv;
const dir = dirArg ? path.resolve(dirArg) : DEFAULT_DIR;

if (cmd === "snapshot") snapshot(dir);
else if (cmd === "diff") diff(dir);
else {
  console.error("Usage: node scripts/html-baseline.js <snapshot|diff> [dir]");
  process.exit(1);
}

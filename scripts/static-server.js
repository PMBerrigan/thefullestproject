#!/usr/bin/env node
/**
 * Minimal static file server for _site/, used by the Playwright e2e suite.
 *
 * Deliberately not `eleventy --serve`: watch mode rebuilds _site while Tailwind
 * writes output.css into the same directory, which races. Tests should run
 * against a finished `npm run build` so what they assert is what deploys.
 *
 *   node scripts/static-server.js [port]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "_site");
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(ROOT, url);

    // Block traversal outside _site/
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, "index.html");
    }

    if (!fs.existsSync(file)) {
      const notFound = path.join(ROOT, "404.html");
      if (fs.existsSync(notFound)) {
        res.writeHead(404, { "Content-Type": TYPES[".html"] });
        res.end(fs.readFileSync(notFound));
      } else {
        res.writeHead(404).end("Not found");
      }
      return;
    }

    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, () => {
    console.log(`Serving _site/ on http://localhost:${PORT}`);
  });

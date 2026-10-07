"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const PORT = Number(process.env.PORT || 3000);
const WEBSITE_DIR = [
  path.join(__dirname, "index.html"),
  __dirname
].find((directory) => fs.existsSync(path.join(directory, "index.html"))) || path.join(__dirname, "index.html");
const REQUIRED_ASSETS = [
  "index.html",
  "style.css",
  "jeftech-mark.svg",
  "images/electrical-service-work.jpg",
  "images/distribution-panel-installation.jpg",
  "images/panel-components.jpg",
  "images/panel-breakers.jpg",
  "work.js"
];

const contentTypes = {
  "/": "text/html; charset=utf-8",
  "/index.html": "text/html; charset=utf-8",
  "/favicon.ico": "image/svg+xml",
  "/style.css": "text/css; charset=utf-8",
  "/jeftech-mark.svg": "image/svg+xml",
  "/work.js": "text/javascript; charset=utf-8",
  "/images/electrical-service-work.jpg": "image/jpeg",
  "/images/distribution-panel-installation.jpg": "image/jpeg",
  "/images/panel-components.jpg": "image/jpeg",
  "/images/panel-breakers.jpg": "image/jpeg"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
}

const server = http.createServer((request, response) => {
  setSecurityHeaders(response);

  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    sendJson(response, 400, { error: "Invalid request URL." });
    return;
  }

  if (pathname === "/healthz" && request.method === "GET") {
    const missingAssets = REQUIRED_ASSETS.filter(
      (asset) => !fs.existsSync(path.join(WEBSITE_DIR, asset))
    );
    sendJson(response, missingAssets.length ? 503 : 200, {
      status: missingAssets.length ? "error" : "ok",
      websiteAssetsAvailable: missingAssets.length === 0,
      missingAssets
    });
    return;
  }

  if (pathname === "/robots.txt" && request.method === "GET") {
    const host = request.headers.host || "";
    const origin = /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ? `https://${host}` : "";
    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    });
    response.end(`User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`);
    return;
  }

  if (pathname === "/sitemap.xml" && request.method === "GET") {
    const host = request.headers.host || "";
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) {
      sendJson(response, 400, { error: "A valid website host is required to generate the sitemap." });
      return;
    }
    const sitemap = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `  <url><loc>https://${host}/</loc></url>`,
      "</urlset>"
    ].join("\n");
    response.writeHead(200, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    });
    response.end(sitemap);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const contentType = contentTypes[pathname];
  if (!contentType) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const assetPath = pathname === "/"
    ? "index.html"
    : pathname === "/favicon.ico"
      ? "jeftech-mark.svg"
      : pathname.slice(1);
  const filePath = path.join(WEBSITE_DIR, assetPath);

  fs.readFile(filePath, (error, data) => {
    if (error) {
      console.error(`Could not read website asset ${pathname} (${error.code || error.message}).`);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Could not load website asset");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": pathname === "/" || pathname === "/index.html" ? "no-cache" : "public, max-age=3600"
    });
    response.end(request.method === "HEAD" ? undefined : data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`JEFTECH website listening on port ${PORT}.`);
  console.log(`Serving website files from ${WEBSITE_DIR}.`);
  const missingAssets = REQUIRED_ASSETS.filter(
    (asset) => !fs.existsSync(path.join(WEBSITE_DIR, asset))
  );
  if (missingAssets.length) {
    console.error(`Required website assets are missing: ${missingAssets.join(", ")}.`);
  }
});

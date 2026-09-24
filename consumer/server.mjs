import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// API source: the publicly deployed Domora API. Never a localhost API.
const API_BASE = process.env.CONSUMER_API_BASE || "https://domora-mu.vercel.app";
const PORT = Number(process.env.PORT || 8787);

// The session cookie the API requires. Loaded from consumer/.env.local so the
// token never ships in the repo (GIT-1).
function loadToken() {
  if (process.env.CONSUMER_SESSION_TOKEN) return process.env.CONSUMER_SESSION_TOKEN;
  const envPath = join(__dirname, ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*CONSUMER_SESSION_TOKEN=(.+?)\s*$/);
      if (m) return m[1];
    }
  }
  return "";
}

const TOKEN = loadToken();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function serveStatic(req, res) {
  const file = req.url === "/" ? "index.html" : req.url.slice(1);
  const safe = normalize(file).replace(/^(\.\.[/\\])+/, "");
  const path = join(__dirname, safe);
  if (!path.startsWith(__dirname)) return notFound(res);
  if (!existsSync(path)) return notFound(res);
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(path));
}

function notFound(res) {
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "consumer route not found" } }));
}

// Relay: the page cannot set cross-site cookies, so the consumer server calls
// the PUBLIC API and injects the session cookie. Only GET + /api/v1 targets.
async function proxy(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const target = url.searchParams.get("target") ?? "";
  const decoded = decodeURIComponent(target);
  if (req.method !== "GET" || !decoded.startsWith("/api/v1/")) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "BAD_REQUEST", message: "proxy target must be a /api/v1 GET" } }));
    return;
  }
  if (!TOKEN) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "CONSUMER_SESSION_TOKEN missing (consumer/.env.local)" } }));
    return;
  }
  const up = await fetch(`${API_BASE}${decoded}`, {
    headers: { cookie: `domora_session=${TOKEN}`, accept: "application/json" },
  });
  const body = await up.text();
  res.writeHead(up.status, { "content-type": "application/json", "x-api-source": API_BASE });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const started = Date.now();
  try {
    if (url.startsWith("/proxy")) {
      void proxy(req, res).catch(() => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "proxy upstream failure" } }));
      });
    } else {
      serveStatic(req, res);
    }
  } finally {
    console.log(`${req.method} ${url} -> ${res.statusCode} (${Date.now() - started}ms)`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Domora Step 8 consumer -> ${API_BASE}`);
  console.log(`Open http://localhost:${PORT}`);
});
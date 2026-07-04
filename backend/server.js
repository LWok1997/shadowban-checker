// X Shadowban Checker - Admin Backend
// Pure Node.js HTTP server - no npm dependencies needed
// Run: node server.js

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

// ── Configuration ──
const PORT = 3456;
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD_HASH = hashPassword("Xcheck2026!");
const DATA_FILE = path.join(__dirname, "data", "visits.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// Ensure data directory exists
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// ── In-memory store ──
let sessions = {}; // token -> { username, expiry }
let visits = loadVisits();

// ── Helpers ──
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function loadVisits() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) { /* ignore */ }
  return [];
}

function saveVisits() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(visits), "utf8");
  } catch (e) { /* ignore */ }
}

function getClientIP(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.connection?.remoteAddress
    || "unknown";
}

function serveFile(res, filePath, contentType) {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end("Not Found");
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function isAuthenticated(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace("Bearer ", "");
  const session = sessions[token];
  if (!session || session.expiry < Date.now()) {
    if (sessions[token]) delete sessions[token];
    return null;
  }
  return session;
}

// ── Stats computation ──
function computeStats() {
  const total = visits.length;
  const today = new Date().toISOString().slice(0, 10);
  const todayVisits = visits.filter(v => v.timestamp?.startsWith(today)).length;
  const uniqueIPs = new Set(visits.map(v => v.ip)).size;
  const uniqueToday = new Set(visits.filter(v => v.timestamp?.startsWith(today)).map(v => v.ip)).size;

  // Page breakdown
  const pages = {};
  visits.forEach(v => {
    const p = v.page || "/";
    pages[p] = (pages[p] || 0) + 1;
  });
  const pageBreakdown = Object.entries(pages)
    .map(([page, count]) => ({ page, count }))
    .sort((a, b) => b.count - a.count);

  // Daily visits (last 30 days)
  const daily = {};
  visits.forEach(v => {
    const day = v.timestamp?.slice(0, 10) || "unknown";
    daily[day] = (daily[day] || 0) + 1;
  });
  const dailyVisits = Object.entries(daily)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Recent visits
  const recent = [...visits].reverse().slice(0, 50);

  return {
    total,
    todayVisits,
    uniqueIPs,
    uniqueToday,
    pageBreakdown,
    dailyVisits,
    recent
  };
}

// ── Request Handler ──
async function handleRequest(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API: Track visit ──
  if (pathname === "/api/track" && method === "POST") {
    const body = await parseBody(req);
    visits.push({
      ip: getClientIP(req),
      page: body.page || "/",
      referrer: body.referrer || "",
      userAgent: req.headers["user-agent"] || "",
      timestamp: new Date().toISOString()
    });
    if (visits.length > 100000) visits = visits.slice(-50000);
    saveVisits();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: Login ──
  if (pathname === "/api/login" && method === "POST") {
    const body = await parseBody(req);
    const pwHash = hashPassword(body.password || "");
    if (body.username === ADMIN_USERNAME && pwHash === ADMIN_PASSWORD_HASH) {
      const token = generateToken();
      sessions[token] = { username: ADMIN_USERNAME, expiry: Date.now() + 86400000 * 7 };
      // Clean old sessions
      Object.keys(sessions).forEach(k => {
        if (sessions[k].expiry < Date.now()) delete sessions[k];
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, token }));
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "用户名或密码错误" }));
    }
    return;
  }

  // ── API: Verify token ──
  if (pathname === "/api/verify" && method === "GET") {
    if (isAuthenticated(req)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }

  // ── API: Get stats (requires auth) ──
  if (pathname === "/api/stats" && method === "GET") {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "未授权" }));
      return;
    }
    const stats = computeStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return;
  }

  // ── Serve static files ──
  if (pathname === "/admin" || pathname === "/admin/") {
    serveFile(res, path.join(PUBLIC_DIR, "dashboard.html"), "text/html; charset=utf-8");
    return;
  }

  // ── Serve tracking script ──
  if (pathname === "/tracker.js") {
    serveFile(res, path.join(__dirname, "tracker.js"), "application/javascript; charset=utf-8");
    return;
  }

  // ── 404 ──
  res.writeHead(404);
  res.end("Not Found");
}

// ── Start Server ──
const server = http.createServer(handleRequest);
server.listen(PORT, "0.0.0.0", () => {
  console.log("✓ Admin backend running on http://localhost:" + PORT);
  console.log("✓ Dashboard: http://localhost:" + PORT + "/admin");
  console.log("✓ Default login: admin / Xcheck2026!");
  console.log("✓ Data file: " + DATA_FILE);
});

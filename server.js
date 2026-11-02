// Vibe X demo server: run `npm install` once, then `node server.js`, and open http://localhost:4300/demo
// Put ANTHROPIC_API_KEY=... in a .env file next to this one to let AI read product photos.
//   /        the shop website
//   /demo    the pitch view: a fake WhatsApp chat beside the live website
// POST /api/message takes { text, image (data URL, optional) }, the same shape a real
// WhatsApp webhook message will be turned into in version 2.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* no .env: keyword rules only */ }
const { parseMessage } = require("./lib/parse");
const { classify, aiEnabled, MODEL } = require("./lib/classify");

const PORT = Number(process.env.PORT) || 4300;
const ROOT = __dirname;
// DESIGN=v1 serves the saved surplus-style design (designs/v1-surplus) instead of the current one.
const PUBLIC = process.env.DESIGN === "v1" ? path.join(ROOT, "designs", "v1-surplus") : path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(DATA, "uploads");
const DB = path.join(DATA, "products.json");
const SEED = path.join(DATA, "seed.json");

fs.mkdirSync(UPLOADS, { recursive: true });
// Seed items store "hoursAgo" so the demo always looks freshly stocked.
// Photos dropped in data/seed-photos/ are given to the sample items in name order.
const SEED_PHOTOS = path.join(DATA, "seed-photos");
fs.mkdirSync(SEED_PHOTOS, { recursive: true });
function writeSeed() {
  const now = Date.now();
  const photos = fs.readdirSync(SEED_PHOTOS).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  const items = JSON.parse(fs.readFileSync(SEED, "utf8")).map(({ hoursAgo, ...p }, i) => ({
    ...p,
    image: photos[i] ? `/seed-photos/${encodeURIComponent(photos[i])}` : p.image,
    createdAt: new Date(now - hoursAgo * 3600e3).toISOString(),
  }));
  fs.writeFileSync(DB, JSON.stringify(items, null, 2));
}
if (!fs.existsSync(DB)) writeSeed();

const load = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const save = (items) => fs.writeFileSync(DB, JSON.stringify(items, null, 2));

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
};

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) return send(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    send(res, 200, buf, TYPES[path.extname(file)] || "application/octet-stream");
  });
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function saveImage(dataUrl, id) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  fs.writeFileSync(path.join(UPLOADS, `${id}.${ext}`), Buffer.from(m[2], "base64"));
  return `/uploads/${id}.${ext}`;
}

// Finds the product a command refers to: best word match, newest first; empty query = newest.
function findTarget(items, query, wantStatus) {
  const pool = items.filter((p) => !wantStatus || p.status === wantStatus);
  if (!pool.length) return null;
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return pool[0];
  let best = null, bestScore = 0;
  for (const p of pool) {
    const hay = `${p.name} ${p.brand || ""} ${p.caption}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

// ---- Customer enquiries ("Ask about this piece") ----
// The website posts here; the owner gets the product photo plus the customer's name and
// number. In the demo it lands in the fake WhatsApp chat via /api/inbox. In version 2,
// sendToOwner() also sends it to the owner's real WhatsApp through the Cloud API.
const INBOX = path.join(DATA, "inbox.json");
const loadInbox = () => { try { return JSON.parse(fs.readFileSync(INBOX, "utf8")); } catch { return []; } };
const saveInbox = (m) => fs.writeFileSync(INBOX, JSON.stringify(m.slice(-200), null, 2));

// Indian mobile numbers: 10 digits starting 6–9, optionally with +91 / 0 in front.
function normalisePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
const prettyPhone = (d) => `+91 ${d.slice(0, 5)} ${d.slice(5)}`;

const recent = new Map(); // ip -> timestamps, a simple flood guard
function tooMany(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  list.push(now);
  recent.set(ip, list);
  return list.length > 5;
}

function sendToOwner(msg) {
  const inbox = loadInbox();
  inbox.push(msg);
  saveInbox(inbox);
  // Version 2: also send to the owner's WhatsApp (image message + text) via the Cloud API.
}

async function handleEnquiry(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req, 20 * 1024)); } catch { return send(res, 400, { error: "Something went wrong. Please try again." }); }
  if (body.website) return send(res, 200, { ok: true }); // hidden field only bots fill in
  const ip = req.socket.remoteAddress || "?";
  if (tooMany(ip)) return send(res, 429, { error: "Too many messages. Please wait a few minutes." });

  const p = load().find((x) => x.id === String(body.productId || ""));
  if (!p) return send(res, 404, { error: "This piece is no longer listed." });
  const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const phone = normalisePhone(body.phone);
  const note = String(body.note || "").trim().slice(0, 300);
  if (!name) return send(res, 400, { error: "Please add your name." });
  if (!phone) return send(res, 400, { error: "Please enter a 10 digit mobile number." });

  const price = p.price ? ` · ₹${p.price.toLocaleString("en-IN")}` : "";
  const hello = encodeURIComponent(`Hi ${name}, this is Vibe X about the ${p.name}${price}.`);
  sendToOwner({
    id: crypto.randomBytes(6).toString("hex"),
    at: new Date().toISOString(),
    kind: "enquiry",
    productId: p.id,
    image: p.image,
    text: `💬 *Enquiry from the website*\n*${p.name}*${price}${p.status === "sold" ? " (marked SOLD)" : ""}\n\n👤 ${name}\n📞 ${prettyPhone(phone)}${note ? `\n💬 “${note}”` : ""}\n\nReply on WhatsApp: https://wa.me/91${phone}?text=${hello}`,
  });
  send(res, 200, { ok: true, phone: prettyPhone(phone) });
}

// ---- Orders ("Order now") ----
// Flow: customer fills details -> pays by UPI/bank/number -> sends payment reference or
// screenshot -> piece goes ON HOLD -> owner checks his bank app and replies
// "confirm VX-1234" (piece becomes SOLD) or "cancel VX-1234" (piece goes back on sale).
const ORDERS = path.join(DATA, "orders.json");
const loadOrders = () => { try { return JSON.parse(fs.readFileSync(ORDERS, "utf8")); } catch { return []; } };
const saveOrders = (o) => fs.writeFileSync(ORDERS, JSON.stringify(o, null, 2));
const lotOf = (id) => "LOT " + String([...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 9000 + 1000);
const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

function newOrderCode(orders) {
  for (;;) {
    const code = "VX-" + String(crypto.randomInt(1000, 10000));
    if (!orders.some((o) => o.code === code)) return code;
  }
}

async function createOrder(req, res) {
  let b;
  try { b = JSON.parse(await readBody(req, 20 * 1024)); } catch { return send(res, 400, { error: "Something went wrong. Please try again." }); }
  if (b.website) return send(res, 200, { ok: true });
  if (tooMany(req.socket.remoteAddress || "?")) return send(res, 429, { error: "Too many attempts. Please wait a few minutes." });
  const p = load().find((x) => x.id === String(b.productId || ""));
  if (!p) return send(res, 404, { error: "This piece is no longer listed." });
  if (p.status === "sold") return send(res, 409, { error: "Sorry, this piece has just sold." });
  if (p.status === "hold") return send(res, 409, { error: "Someone is paying for this piece right now. Tap Enquire and we'll tell you if it frees up." });
  if (!p.price) return send(res, 409, { error: "This piece has no price yet. Tap Enquire and we'll tell you." });
  const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const phone = normalisePhone(b.phone);
  const delivery = b.delivery === "ship" ? "ship" : "pickup";
  const address = String(b.address || "").trim().slice(0, 300);
  const city = String(b.city || "").trim().slice(0, 60);
  const pin = String(b.pin || "").replace(/\D/g, "");
  if (!name) return send(res, 400, { error: "Please add your name." });
  if (!phone) return send(res, 400, { error: "Please enter a 10 digit mobile number." });
  if (delivery === "ship" && (!address || !city || !/^[1-9]\d{5}$/.test(pin))) {
    return send(res, 400, { error: "Please add your full address, city and 6 digit PIN code." });
  }
  const orders = loadOrders();
  const order = {
    id: crypto.randomBytes(8).toString("hex"), code: newOrderCode(orders),
    productId: p.id, productName: p.name, lot: lotOf(p.id), amount: p.price,
    name, phone, delivery, address, city, pin,
    status: "awaiting_payment", createdAt: new Date().toISOString(),
  };
  orders.push(order);
  saveOrders(orders);
  send(res, 200, { id: order.id, code: order.code, amount: order.amount, lot: order.lot });
}

async function orderPaid(req, res, id) {
  let b;
  try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "Something went wrong. Please try again." }); }
  const orders = loadOrders();
  const o = orders.find((x) => x.id === id);
  if (!o) return send(res, 404, { error: "Order not found." });
  if (o.status !== "awaiting_payment") return send(res, 200, { code: o.code, status: o.status });
  const utr = String(b.utr || "").replace(/\s+/g, "").slice(0, 30);
  const proof = saveImage(b.proof, `proof-${o.id}`);
  if (!utr && !proof) return send(res, 400, { error: "Add the payment reference number or a screenshot of the payment." });
  if (utr && !/^[A-Za-z0-9]{6,30}$/.test(utr)) return send(res, 400, { error: "That reference doesn't look right. It's usually a 12 digit number (UPI ref or UTR)." });

  Object.assign(o, { status: "paid", utr: utr || null, proof, paidAt: new Date().toISOString() });
  saveOrders(orders);

  // Put the piece on hold so nobody else pays for it while the owner checks.
  const items = load();
  const p = items.find((x) => x.id === o.productId);
  if (p && !(p.quantity > 1) && p.status === "available") { p.status = "hold"; p.holdFor = o.code; save(items); }

  const where = o.delivery === "ship" ? `🚚 Ship to: ${o.address}, ${o.city} ${o.pin}` : "🏬 Pickup at the store";
  const hello = encodeURIComponent(`Hi ${o.name}, Vibe X here about your order ${o.code} (${o.productName}).`);
  sendToOwner({
    id: crypto.randomBytes(6).toString("hex"), at: new Date().toISOString(), kind: "order",
    image: proof || (p && p.image) || null,
    text: `💰 *New order ${o.code}: check the payment*\n*${o.productName}* · ${inr(o.amount)} · ${o.lot}\n\n👤 ${o.name}\n📞 ${prettyPhone(o.phone)}\n${where}\n🧾 ${utr ? `Payment ref: ${utr}` : "Payment screenshot above"}\n\nCheck your bank or UPI app for ${inr(o.amount)}, then reply:\n*confirm ${o.code}* or *cancel ${o.code}*\n\nMessage customer: https://wa.me/91${o.phone}?text=${hello}`,
  });
  send(res, 200, { code: o.code, status: o.status });
}

// Owner replies "confirm VX-1234" / "cancel VX-1234" in the chat.
function orderCommand(text) {
  const m = /^(confirm|confirmed|ok|cancel|reject)\s+(vx-?\d{4})\b/i.exec(text.trim());
  if (!m) return null;
  const code = m[2].toUpperCase().replace(/^VX-?/, "VX-");
  const orders = loadOrders();
  const o = orders.find((x) => x.code === code);
  if (!o) return `I couldn't find order ${code}.`;
  const items = load();
  const p = items.find((x) => x.id === o.productId);
  const hello = (msg) => `https://wa.me/91${o.phone}?text=${encodeURIComponent(msg)}`;
  if (/^(cancel|reject)/i.test(m[1])) {
    o.status = "cancelled";
    if (p && p.status === "hold" && p.holdFor === o.code) { p.status = "available"; delete p.holdFor; save(items); }
    saveOrders(orders);
    return `❌ ${o.code} cancelled. “${o.productName}” is back on sale.\nTell the customer: ${hello(`Hi ${o.name}, Vibe X here. We couldn't find your payment for order ${o.code}. Could you send the payment screenshot?`)}`;
  }
  if (o.status === "confirmed") return `${o.code} is already confirmed.`;
  o.status = "confirmed";
  o.confirmedAt = new Date().toISOString();
  if (p) {
    if (p.quantity > 1) p.quantity -= 1;
    else { p.status = "sold"; delete p.holdFor; }
    save(items);
  }
  saveOrders(orders);
  const next = o.delivery === "ship" ? "Pack it for shipping" : "Keep it aside for pickup";
  return `✅ ${o.code} confirmed. “${o.productName}” marked ${p && p.status === "sold" ? "SOLD" : `sold (${p ? p.quantity : 0} left)`}.\n${next}. The customer's screen already shows it's confirmed.\nMessage them: ${hello(`Hi ${o.name}, Vibe X here. Payment received for ${o.code} (${o.productName}). ${o.delivery === "ship" ? "We'll share tracking once it ships." : "It's ready for pickup at the store."}`)}`;
}

// ---- Owner key ----
// When OWNER_KEY is set (always set it on a public server), the owner-only parts need it:
// the /demo control screen, posting products, the enquiry/order feed and reset.
// Customers can still browse, order and enquire. With no key (local dev), all is open.
function isOwner(req, url) {
  const key = process.env.OWNER_KEY;
  if (!key) return true;
  const given = req.headers["x-owner-key"] || url.searchParams.get("key") || "";
  const a = Buffer.from(String(given)), b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Product page with share-preview tags, so a link pasted into Instagram or WhatsApp
// shows the product photo. Previews only work once the site is on a public address
// (set PUBLIC_URL), since the apps fetch the page from their own servers.
// v1 (surplus) design's product page, used when DESIGN=v1.
function legacyProductPage(title, head, id) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
${head}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shop.css">
</head><body>
<header class="top"><div class="wrap top-row"><a class="logo" href="/">VIBE<span>X</span></a>
<nav class="nav"><a href="/#rack">New drops</a><a class="nav-ig" href="https://www.instagram.com/vibex.india/" target="_blank" rel="noopener">Instagram ↗</a></nav></div></header>
<main class="wrap pdp" id="pdp" data-id="${escHtml(id)}"></main>
<div class="toast" id="toast" role="status" hidden></div>
<script src="/config.js"></script><script src="/art.js"></script><script src="/order.js"></script><script src="/vendor/qrcode.js"></script><script src="/checkout.js"></script><script src="/pdp.js"></script>
</body></html>`;
}

// Shared frame for server-built pages (product, policies, 404) in the current design.
function pageShell({ title, head = "", body, scripts = [] }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
${head}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/vendor/phosphor/style.css">
<link rel="stylesheet" href="/shop.css">
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="nav-wrap"><nav class="nav" aria-label="Main">
<a class="logo" href="/" aria-label="Vibe X home">Vibe<span>X</span></a>
<div class="nav-links"><a href="/#rack">New drops</a><a href="/#faq">Questions</a><a href="/#visit">Visit</a></div>
<a class="nav-ig" id="ig-top" target="_blank" rel="noopener"><i class="ph ph-instagram-logo" aria-hidden="true"></i><span>Instagram</span></a>
<button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu" aria-label="Open menu"><span></span><span></span></button>
</nav></header>
<div class="menu" id="menu" hidden><a href="/#rack">New drops</a><a href="/#faq">Questions</a><a href="/#visit">Visit the store</a><a href="/returns">Returns and refunds</a><a id="ig-menu" target="_blank" rel="noopener">Instagram <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a></div>
<div id="main">${body}</div>
<footer class="foot"><div class="wrap"><div class="foot-top"><a class="logo logo-big" href="/">Vibe<span>X</span></a>
<nav class="foot-links" aria-label="Policies"><a href="/returns">Returns and refunds</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/#visit">Contact</a></nav></div>
<p class="foot-note">© 2026 Vibe X · The Surplus Room, Srinagar, Kashmir</p></div></footer>
<div class="toast" id="toast" role="status" hidden></div>
<script src="/config.js"></script>${scripts.map((src) => `<script src="${src}"></script>`).join("")}<script src="/ui.js"></script>
</body></html>`;
}

function notFoundPage(res) {
  send(res, 404, pageShell({
    title: "Page not found · Vibe X",
    head: '<meta name="robots" content="noindex">',
    body: `<main class="wrap notfound page-top"><i class="ph ph-compass" aria-hidden="true"></i><h1>This page isn't on the rack</h1>
      <p>The link may be old, or the piece has sold. Everything we have right now is on the home page.</p>
      <a class="btn btn-primary" href="/#rack">See today's drops <i class="ph ph-arrow-right" aria-hidden="true"></i></a></main>`,
  }), "text/html; charset=utf-8");
}

const { LEGAL } = require("./lib/legal");
function legalPage(res, key) {
  const page = LEGAL[key];
  send(res, 200, pageShell({
    title: `${page.title} · Vibe X`,
    head: `<meta name="description" content="${escHtml(page.summary)}">`,
    body: `<main class="wrap legal"><p class="eyebrow">Vibe X policies</p><h1>${escHtml(page.title)}</h1>
      <p class="draft">Draft for Vibe X to review. Nothing here is final until the shop confirms it.</p>${page.html}</main>`,
  }), "text/html; charset=utf-8");
}

function productPage(req, res, id) {
  const p = load().find((x) => x.id === id);
  // Hosts like Render sit behind HTTPS and pass the real scheme in x-forwarded-proto.
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const origin = (process.env.PUBLIC_URL || `${proto}://${req.headers.host}`).replace(/\/$/, "");
  const title = p ? `${p.name}${p.price ? ` · ₹${p.price.toLocaleString("en-IN")}` : ""} · Vibe X` : "Vibe X · The Surplus Room";
  const desc = p
    ? [p.brand, p.category, p.sizes, p.status === "sold" ? "Sold" : "In stock at Vibe X, Srinagar"].filter(Boolean).join(" · ")
    : "Original world-brand surplus. Srinagar, Kashmir.";
  const og = [
    ["og:type", "product"], ["og:site_name", "Vibe X"], ["og:title", title], ["og:description", desc],
    ["og:url", `${origin}/p/${encodeURIComponent(id)}`],
    ...(p && p.image ? [["og:image", origin + p.image], ["og:image:alt", p.name]] : []),
  ].map(([k, v]) => `<meta property="${k}" content="${escHtml(v)}">`).join("\n");
  const head = `<meta name="description" content="${escHtml(desc)}">\n${og}\n<meta name="twitter:card" content="${p && p.image ? "summary_large_image" : "summary"}">`;
  const html = process.env.DESIGN === "v1"
    ? legacyProductPage(title, head, id)
    : pageShell({
        title, head,
        body: `<div class="page-top"><main class="wrap pdp" id="pdp" data-id="${escHtml(id)}"></main></div>`,
        scripts: ["/art.js", "/order.js", "/vendor/qrcode.js", "/checkout.js", "/pdp.js"],
      });
  send(res, p ? 200 : 404, html, "text/html; charset=utf-8");
}

const rupees = (n) => (n ? `₹${n.toLocaleString("en-IN")}` : "price on request");

async function handleMessage(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "bad request" }); }
  const text = String(body.text || "").slice(0, 1000);
  if (!text.trim() && !body.image) return send(res, 400, { error: "empty message" });

  const items = load();
  const orderReply = orderCommand(text);
  if (orderReply) return send(res, 200, { reply: orderReply });
  const parsed = parseMessage(text);

  if (parsed.type === "command") {
    const want = parsed.action === "restock" ? "sold" : parsed.action === "sold" ? "available" : null;
    const target = findTarget(items, parsed.query, want);
    if (!target) return send(res, 200, { reply: "I couldn't find that item on the website. Try a word from its name, like “sold puffer”." });
    if (parsed.action === "remove") {
      save(items.filter((p) => p.id !== target.id));
      return send(res, 200, { reply: `🗑️ Removed “${target.name}” from the website.` });
    }
    if (parsed.action === "sold" && target.quantity > 1) {
      target.quantity -= 1;
      save(items);
      return send(res, 200, { reply: `🏷️ One “${target.name}” sold. ${target.quantity} left on the website.\nReply *sold ${target.name.split(" ")[0].toLowerCase()}* again for the next one.` });
    }
    target.status = parsed.action === "sold" ? "sold" : "available";
    if (parsed.action === "restock" && !target.quantity) target.quantity = 1;
    save(items);
    return send(res, 200, {
      reply: parsed.action === "sold" ? `🏷️ Marked “${target.name}” as SOLD.` : `✅ “${target.name}” is back in stock.`,
    });
  }

  // Rules always run; the AI reader (when configured) decides what the item is from the photo,
  // and the rules fill any price/size it left empty.
  const rules = parsed.product;
  let listing = rules, note = null, by = "rules";
  if (aiEnabled()) {
    try {
      const ai = await classify(text, body.image);
      listing = {
        ...rules,
        name: ai.name || rules.name,
        brand: ai.brand || rules.brand,
        category: ai.category,
        subcategory: ai.subcategory || rules.subcategory,
        price: ai.price ?? rules.price,
        mrp: ai.mrp ?? rules.mrp,
        sizes: ai.sizes || rules.sizes,
        quantity: ai.quantity ?? rules.quantity,
      };
      note = ai.note;
      by = "ai";
    } catch (e) {
      console.warn(`AI reader failed, used keyword rules instead: ${e.message}`);
    }
  }

  const id = crypto.randomBytes(6).toString("hex");
  const product = { id, ...listing, image: saveImage(body.image, id), status: "available", createdAt: new Date().toISOString(), by };
  const fresh = load(); // reload: another message may have landed while the AI was reading
  fresh.unshift(product);
  save(fresh);
  const shelf = [product.category, product.subcategory].filter(Boolean).join(" › ");
  const bits = [product.brand, rupees(product.price), product.sizes, product.quantity > 1 ? `${product.quantity} in stock` : null].filter(Boolean).join(" · ");
  const ask = product.price ? "" : "\n\nNo price found. Reply with the price next time, e.g. *2000*.";
  send(res, 200, { reply: `✅ Added to *${shelf}*:\n*${product.name}*\n${bits}${note ? `\n\nℹ️ ${note}` : ""}${ask}`, product });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = decodeURIComponent(url.pathname);
    try {
      if (req.method === "GET" && p === "/api/products") return send(res, 200, load());
      if (req.method === "POST" && p === "/api/enquiry") return await handleEnquiry(req, res);
      if (req.method === "POST" && p === "/api/orders") return await createOrder(req, res);
      const om = /^\/api\/orders\/([a-f0-9]{16})(\/paid)?$/.exec(p);
      if (om && req.method === "POST" && om[2]) return await orderPaid(req, res, om[1]);
      if (om && req.method === "GET" && !om[2]) {
        const o = loadOrders().find((x) => x.id === om[1]);
        return o ? send(res, 200, { code: o.code, status: o.status }) : send(res, 404, { error: "not found" });
      }
      const ownerOnly = p === "/demo" || p === "/demo.html" || p === "/api/inbox" || p === "/api/message" || p === "/api/reset";
      if (ownerOnly && !isOwner(req, url)) {
        return p.startsWith("/api/") ? send(res, 401, { error: "Owner key required." }) : notFoundPage(res);
      }
      if (req.method === "GET" && p === "/api/inbox") {
        const after = url.searchParams.get("after") || "";
        return send(res, 200, loadInbox().filter((m) => m.at > after));
      }
      if (req.method === "POST" && p === "/api/message") return await handleMessage(req, res);
      if (req.method === "POST" && p === "/api/reset") {
        writeSeed();
        saveInbox([]);
        saveOrders([]);
        for (const f of fs.readdirSync(UPLOADS)) fs.unlinkSync(path.join(UPLOADS, f));
        return send(res, 200, { ok: true });
      }
      if (p.startsWith("/seed-photos/")) return serveFile(res, SEED_PHOTOS, p.slice("/seed-photos/".length));
      if (p.startsWith("/uploads/")) return serveFile(res, UPLOADS, p.slice("/uploads/".length));
      if (p === "/" ) return serveFile(res, PUBLIC, "index.html");
      if (p === "/demo") return serveFile(res, PUBLIC, "demo.html");
      const pm = /^\/p\/([\w-]{1,40})$/.exec(p);
      if (pm) return productPage(req, res, pm[1]);
      const legal = { "/returns": "returns", "/terms": "terms", "/privacy": "privacy" }[p];
      if (legal && process.env.DESIGN !== "v1") return legalPage(res, legal);
      if (!path.extname(p) && process.env.DESIGN !== "v1") return notFoundPage(res);
      return serveFile(res, PUBLIC, p.slice(1));
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  })
  .listen(PORT, () => {
    console.log(`Vibe X demo: http://localhost:${PORT}/demo  (shop only: http://localhost:${PORT}/)`);
    console.log(aiEnabled() ? `Photo reading: ON (${MODEL})` : "Photo reading: OFF (no ANTHROPIC_API_KEY in .env), using keyword rules");
    console.log(process.env.OWNER_KEY ? "Owner key: ON (open /demo?key=YOUR_KEY)" : "Owner key: OFF (fine locally; set OWNER_KEY on a public server)");
  });

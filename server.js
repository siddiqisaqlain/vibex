// Vibe X demo server: run `npm install` once, then `node server.js`, and open http://localhost:4300/demo
// Put ANTHROPIC_API_KEY=... in a .env file next to this one to let AI read product photos.
//   /        the shop website
//   /demo    the pitch view: a simulated WhatsApp chat beside the live website
//   /webhook the real WhatsApp (Meta Cloud API), see lib/whatsapp.js
// POST /api/message takes { text, image (data URL, optional) }, the same shape a real
// WhatsApp webhook message will be turned into in version 2.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* no .env: keyword rules only */ }
const { parseMessage, categoryAnswer, findSubcategory } = require("./lib/parse");
const { classify, aiEnabled, MODEL } = require("./lib/classify");
const wa = require("./lib/whatsapp");
const SHOP_NAME = "Vibe X";

const PORT = Number(process.env.PORT) || 4300;
const ROOT = __dirname;
// DESIGN picks a saved design instead of the current one in public/:
//   public/ = current (surplus price-tag style); saved: v1 first surplus, v2 dark minimal,
//   v3 colourful, v4 surplus look on the v2 layout (all in designs/)
const DESIGNS = { v1: "v1-surplus", v2: "v2-dark", v3: "v3-colour", v4: "v4-mix" };
const PUBLIC = DESIGNS[process.env.DESIGN] ? path.join(ROOT, "designs", DESIGNS[process.env.DESIGN]) : path.join(ROOT, "public");
// Which page frame the active design uses for product, policy and 404 pages ("v1" or "v2").
const SHELL = (() => { try { return JSON.parse(fs.readFileSync(path.join(PUBLIC, "design.json"), "utf8")).shell; } catch { return "v2"; } })();
const DATA = path.join(ROOT, "data"); // seed.json + seed-photos/ ship with the code (read-only)
// Live files (products, photos, orders, messages) go in STORE. On Render that's a persistent
// disk (DATA_DIR=/var/data), so nothing is lost on restart or redeploy. Locally: data/.
const STORE = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DATA;
const LIVE = Boolean(process.env.DATA_DIR); // a real shop: the demo reset is switched off
const UPLOADS = path.join(STORE, "uploads");
const DB = path.join(STORE, "products.json");
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

// Every product gets a unique 4-digit code: the LOT number on the website, and what the
// owner types to change stock ("sold 4795 2"). Older items without one get the number
// the website already showed for them.
const hashLot = (id) => String([...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 9000 + 1000);
function newCode(items) {
  const used = new Set(items.map((p) => p.code));
  for (;;) { const c = String(crypto.randomInt(1000, 10000)); if (!used.has(c)) return c; }
}
function ensureCodes() {
  const items = load();
  let changed = false;
  for (const p of items) {
    if (p.code) continue;
    const used = new Set(items.map((x) => x.code));
    p.code = used.has(hashLot(p.id)) ? newCode(items) : hashLot(p.id);
    changed = true;
  }
  if (changed) fs.writeFileSync(DB, JSON.stringify(items, null, 2));
}
ensureCodes();
const save = (items) => fs.writeFileSync(DB, JSON.stringify(items, null, 2));

// Posts the bot wasn't sure about ("Gucci 2499": clothes or perfume?) wait here, oldest first,
// until the owner answers. They are not on the website until then.
const PENDING = path.join(STORE, "pending.json");
const loadPending = () => { try { return JSON.parse(fs.readFileSync(PENDING, "utf8")); } catch { return []; } };
const savePending = (list) => fs.writeFileSync(PENDING, JSON.stringify(list, null, 2));

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
  const byCode = /^(?:lot|code|#)?\s*#?(\d{4})$/i.exec(query.trim());
  if (byCode) return pool.find((p) => p.code === byCode[1]) || null;
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
const INBOX = path.join(STORE, "inbox.json");
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

// The site's public address, for photo links sent on WhatsApp (Render sets RENDER_EXTERNAL_URL).
const siteUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");

function sendToOwner(msg) {
  const inbox = loadInbox();
  inbox.push(msg);
  saveInbox(inbox);
  // Also to the owner's real WhatsApp, when it's connected (lib/whatsapp.js).
  const img = msg.image && /^\//.test(msg.image) && siteUrl() ? siteUrl() + msg.image : null;
  wa.notifyOwners(msg.text, img);
}

// ---- Real WhatsApp (Cloud API webhook) ----
// Meta calls the hub server; when the owner posts to Vibe X, the hub passes Meta's signed
// message on to this /webhook. We answer 200 at once and do the work after.
async function whatsappWebhook(req, res, url) {
  if (req.method === "GET") {
    const challenge = wa.verify(url);
    if (challenge === null) return send(res, 403, { error: "verify token mismatch" });
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(challenge);
  }
  let raw;
  try { raw = await readBody(req, 1024 * 1024); } catch { return send(res, 413, { error: "too large" }); }
  if (!wa.signatureOk(raw, req.headers["x-hub-signature-256"])) {
    console.warn(`WhatsApp webhook rejected: ${req.headers["x-hub-signature-256"] ? "signature doesn't match WA_APP_SECRET" : "no signature header"}`);
    return send(res, 401, { error: "bad signature" });
  }
  send(res, 200, { ok: true });
  if (!wa.enabled()) return console.warn("WhatsApp webhook called but WA_* / OWNER_WHATSAPP settings are missing");
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }
  wa.handleWebhook(payload, { ownerMessage, shopName: SHOP_NAME, shopKey: "vibex", shopUrl: siteUrl() || "our website", choiceFile: path.join(STORE, "wa-shop.json") },
    raw, req.headers["x-hub-signature-256"]);
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
const ORDERS = path.join(STORE, "orders.json");
const loadOrders = () => { try { return JSON.parse(fs.readFileSync(ORDERS, "utf8")); } catch { return []; } };
const saveOrders = (o) => fs.writeFileSync(ORDERS, JSON.stringify(o, null, 2));
const lotOf = (p) => "LOT " + (p.code || hashLot(p.id));
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
    productId: p.id, productName: p.name, lot: lotOf(p), amount: p.price,
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

const HELP = `📋 *Commands*
*Post a product:* send a photo with a caption, e.g. _Gucci Guilty 2499 3 pcs_ or _Zara shirt 1499 size M x2_. I'll show you name, price and quantity to check, then reply *done* to put it live
*Today's numbers:* _stats_
*Sell:* _sold 4795_ (one) or _sold 4795 2_
*More came in:* _add 4795 3_
*Set stock:* _stock 4795 5_
*Clothes:* I'll ask for the size before it goes live. Put it in the caption to skip that, e.g. _size M L_
*Wrong section:* _move 4795 perfume_ (or clothes, shoes, accessory)
*Take down:* _remove 4795_
*Orders:* _confirm VX-1234_ or _cancel VX-1234_
The 4-digit code is the LOT number on the website, and I send it when you post.
Tip: put *perfume*, *clothes*, *shoes* or *accessory* in the caption and I'll never have to ask which it is.`;

// Owner stock messages: "sold 4795 2", "add 4795 3", "stock 4795 5", "help".
function stockCommand(text) {
  const c = parseMessage(text);
  if (c.type === "help") return HELP;
  if (c.type !== "stock") return null;
  const items = load();
  const p = items.find((x) => x.code === c.code);
  if (!p) return `I couldn't find code ${c.code}. The code is the LOT number on the website. Send *help* to see the commands.`;
  if (c.action === "move") {
    if (p.category === c.category) return `“${p.name}” (#${p.code}) is already in *${c.category}*.`;
    p.category = c.category;
    p.subcategory = findSubcategory(`${p.caption || ""} ${p.name}`, c.category);
    save(items);
    return `↪️ Moved “${p.name}” (#${p.code}) to *${[p.category, p.subcategory].filter(Boolean).join(" › ")}* on the website.`;
  }
  const before = p.quantity || (p.status === "sold" ? 0 : 1);
  let after;
  if (c.action === "sold") {
    if (p.status === "sold" || before === 0) return `“${p.name}” (#${p.code}) is already sold out. Send *add ${p.code} 1* if more came in.`;
    after = Math.max(0, before - c.qty);
  } else if (c.action === "add") {
    after = before + c.qty;
  } else {
    after = c.qty;
  }
  p.quantity = after;
  if (after === 0) { p.status = "sold"; delete p.holdFor; }
  else if (p.status === "sold") p.status = "available";
  save(items);
  const left = after === 0 ? "*SOLD OUT* on the website." : `*${after}* left on the website.`;
  if (c.action === "sold") {
    const n = Math.min(c.qty, before);
    if (n > 0) logActivity({ type: "sold", id: p.id, qty: n, amount: (p.price || 0) * n });
    const over = c.qty > before ? ` (you had only ${before}, so it's now sold out)` : "";
    return `🏷️ Sold ${Math.min(c.qty, before)} × “${p.name}” (#${p.code})${over}. ${left}`;
  }
  if (c.action === "add") return `📦 Added ${c.qty} × “${p.name}” (#${p.code}). ${left}`;
  return `📦 Stock for “${p.name}” (#${p.code}) set to ${after}. ${left}`;
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
  logActivity({ type: "sold", id: o.productId, qty: 1, amount: o.amount, order: o.code });
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
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

// v1 frame (surplus style) for policy and 404 pages.
function v1Shell({ title, head = "", body }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
${head}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shop.css">
</head><body>
<header class="top"><div class="wrap top-row"><a class="logo" href="/">VIBE<span>X</span></a>
<nav class="nav" aria-label="Main"><a href="/#rack">New drops</a><a href="/#visit">Visit</a><a class="nav-ig" href="https://www.instagram.com/vibex.india/" target="_blank" rel="noopener">Instagram ↗</a></nav></div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap"><div class="foot-mark">VIBE<span>X</span></div>
<div class="foot-row mono"><span>© Vibe X · The Surplus Room</span><span>World brands, one destination</span></div>
<nav class="foot-links" aria-label="Policies"><a href="/returns">Returns and refunds</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/#visit">Contact</a></nav></div></footer>
</body></html>`;
}

function notFoundPage(res) {
  const body = SHELL === "v1"
    ? `<div class="notfound"><p class="label">Error 404</p><h1>This page isn't on the rack</h1>
      <p>The link may be old, or the piece has sold. Everything we have right now is on the home page.</p>
      <a class="btn btn-ink" href="/#rack">See today's drops</a></div>`
    : `<main class="wrap notfound page-top"><i class="ph ph-compass" aria-hidden="true"></i><h1>This page isn't on the rack</h1>
      <p>The link may be old, or the piece has sold. Everything we have right now is on the home page.</p>
      <a class="btn btn-primary" href="/#rack">See today's drops <i class="ph ph-arrow-right" aria-hidden="true"></i></a></main>`;
  const frame = SHELL === "v1" ? v1Shell : pageShell;
  send(res, 404, frame({ title: "Page not found · Vibe X", head: '<meta name="robots" content="noindex">', body }), "text/html; charset=utf-8");
}

const { LEGAL } = require("./lib/legal");
function legalPage(res, key) {
  const page = LEGAL[key];
  const inner = `<p class="${SHELL === "v1" ? "label" : "eyebrow"}">Vibe X policies</p><h1>${escHtml(page.title)}</h1>
      <p class="draft">Draft for Vibe X to review. Nothing here is final until the shop confirms it.</p>${page.html}`;
  const frame = SHELL === "v1" ? v1Shell : pageShell;
  send(res, 200, frame({
    title: `${page.title} · Vibe X`,
    head: `<meta name="description" content="${escHtml(page.summary)}">`,
    body: SHELL === "v1" ? `<div class="legal">${inner}</div>` : `<main class="wrap legal">${inner}</main>`,
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
  const html = SHELL === "v1"
    ? legacyProductPage(title, head, id)
    : pageShell({
        title, head,
        body: `<div class="page-top"><main class="wrap pdp" id="pdp" data-id="${escHtml(id)}"></main></div>`,
        scripts: ["/art.js", "/order.js", "/vendor/qrcode.js", "/checkout.js", "/pdp.js"],
      });
  send(res, p ? 200 : 404, html, "text/html; charset=utf-8");
}

const rupees = (n) => (n ? `₹${n.toLocaleString("en-IN")}` : "price on request");

// The demo screen's door into ownerMessage(). The real WhatsApp door is whatsappWebhook().
async function handleMessage(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "bad request" }); }
  const out = await ownerMessage(body);
  send(res, out.status || 200, out);
}

// One message from the owner ({ text, image: data URL }) -> { reply, buttons? }.
// Both the /demo chat and the real WhatsApp webhook come through here.
async function ownerMessage(body) {
  const text = String(body.text || "").slice(0, 1000);
  if (!text.trim() && !body.image) return { status: 400, error: "empty message" };

  const items = load();
  const stockReply = stockCommand(text);
  if (stockReply) return { reply: stockReply };
  const orderReply = orderCommand(text);
  if (orderReply) return { reply: orderReply };
  if (/^(stats|report|status|aaj|today)$/i.test(text.trim())) return { reply: statsReply() };
  const draft = draftReply(text, Boolean(body.image));
  if (draft) return draft;
  const parsed = parseMessage(text);

  if (parsed.type === "command") {
    const want = parsed.action === "restock" ? "sold" : parsed.action === "sold" ? "available" : null;
    const target = findTarget(items, parsed.query, want);
    if (!target) return { reply: "I couldn't find that item on the website. Try a word from its name, like “sold puffer”." };
    if (parsed.action === "remove") {
      save(items.filter((p) => p.id !== target.id));
      return { reply: `🗑️ Removed “${target.name}” from the website.` };
    }
    if (parsed.action === "sold" && target.status !== "sold") logActivity({ type: "sold", id: target.id, qty: 1, amount: target.price || 0 });
    if (parsed.action === "sold" && target.quantity > 1) {
      target.quantity -= 1;
      save(items);
      return { reply: `🏷️ One “${target.name}” sold. ${target.quantity} left on the website.\nReply *sold ${target.name.split(" ")[0].toLowerCase()}* again for the next one.` };
    }
    target.status = parsed.action === "sold" ? "sold" : "available";
    if (parsed.action === "restock" && !target.quantity) target.quantity = 1;
    save(items);
    return {
      reply: parsed.action === "sold" ? `🏷️ Marked “${target.name}” as SOLD.` : `✅ “${target.name}” is back in stock.`,
    };
  }

  // Rules always run; the AI reader (when configured) decides what the item is from the photo,
  // and the rules fill any price/size it left empty.
  const rules = parsed.product;
  let listing = rules, note = null, by = "rules", sure = parsed.sure;
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
      sure = ai.sure;
      by = "ai";
    } catch (e) {
      console.warn(`AI reader failed, used keyword rules instead: ${e.message}`);
    }
  }

  const id = crypto.randomBytes(6).toString("hex");
  const image = saveImage(body.image, id);
  const queue = loadPending();
  queue.push({ id, listing, note, by, image, sure, guess: listing.category });
  savePending(queue);
  if (queue.length > 1) return { reply: `📝 Got “${listing.name}”. I'll show it to you to check after the one above.`, buttons: DRAFT_BUTTONS };
  return { reply: card(queue[0]), buttons: DRAFT_BUTTONS };
}

// ---- Check before it goes live ----
// Every post waits as a draft until the owner says "done". He sees name, price, quantity and
// section, and can change any of them first. Drafts are not on the website.
const CATEGORY_WORDS = { Clothing: "clothes", Fragrances: "perfume", Footwear: "shoes", Accessories: "accessory" };
const SECTION_LABEL = { Clothing: "Clothes", Fragrances: "Perfume", Footwear: "Shoes", Accessories: "Accessory" };
const DRAFT_BUTTONS = ["✅ Done", "✏️ Change", "❌ Cancel"];
// Edit words, so a typo like "pirce 3000" or "qyt 2" still counts.
const EDIT_WORDS = { price: "price", rate: "price", mrp: "mrp", qty: "qty", quantity: "qty", stock: "qty", pcs: "qty", name: "name", brand: "brand", size: "size", sizes: "size" };
function editWord(w) {
  w = w.toLowerCase();
  if (EDIT_WORDS[w]) return EDIT_WORDS[w];
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  };
  const hit = Object.keys(EDIT_WORDS).find((k) => k.length >= 3 && dist(w, k) <= (k.length >= 5 ? 2 : 1));
  return hit ? EDIT_WORDS[hit] : null;
}
const HOW_TO_CHANGE = `Send what's different, e.g.\n*price 2999* · *qty 3* · *name Gucci Guilty EDT* · *size M L* · *mrp 8000*\nWrong section? Send *clothes*, *perfume*, *shoes* or *accessory*.`;

// Clothes need a size before they go live (shoes and perfume don't).
const needsSize = (l) => l.category === "Clothing" && !l.sizes;
// "m l xl" -> "M · L · XL", "free" -> "Free size", "100ml" -> "100 ml"
function formatSizes(v) {
  v = v.trim();
  if (/^(free|free ?size|one ?size|os)$/i.test(v)) return "Free size";
  if (/^\d+\s?ml$/i.test(v)) return v.replace(/\s?ml/i, " ml");
  return v.split(/[\s,\/&]+/).filter(Boolean).map((x) => x.toUpperCase()).join(" · ").replace(/^(UK|US|EU) · /, "$1 ");
}
// A bare size answer: "M", "m l xl", "32 34", "free size", "UK 9"
const SIZE_ONLY = /^(?:(?:xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|\d{2}|uk\s?\d{1,2}|free|free ?size|one ?size)(?:[\s,\/&]+|$))+$/i;

function card(item, changed = "") {
  const l = item.listing;
  const mark = (k) => (changed === k ? " ✏️" : "");
  const section = [SECTION_LABEL[l.category], l.subcategory && l.subcategory !== "Perfume" ? l.subcategory : null].filter(Boolean).join(" › ");
  const lines = [
    `🏷️ Name: *${l.name}*${mark("name")}`,
    `💰 Price: ${l.price ? `*${rupees(l.price)}*` : "❗ *missing*"}${l.mrp ? ` (MRP ${rupees(l.mrp)})` : ""}${mark("price")}`,
    `📦 Quantity: *${l.quantity || 1}*${mark("qty")}`,
    `🗂️ Section: *${section}*${item.sure ? "" : " ❓ my guess"}${mark("section")}`,
  ];
  if (l.brand) lines.splice(1, 0, `✨ Brand: ${l.brand}${mark("brand")}`);
  if (l.category === "Clothing") lines.push(`📏 Size: ${l.sizes ? `*${l.sizes}*` : "❗ *missing*"}${mark("size")}`);
  else if (l.sizes || changed === "size") lines.push(`📏 Size: ${l.sizes || "-"}${mark("size")}`);
  const head = changed ? "✏️ Updated. Check again:" : "📝 Check before it goes on your website:";
  const missing = [!l.price && "the *price* (e.g. *price 2499*)", needsSize(l) && "the *size* (e.g. *M* or *M L XL*, or *free size*)"].filter(Boolean);
  const tail = missing.length
    ? `\n\nBefore it can go live, send ${missing.join(" and ")}.`
    : `\n\nAll good? Reply *done* to post it.\nSomething wrong? Tap *Change* or send e.g. *price 2999*, *qty 3*.`;
  const unsure = item.sure ? "" : `\nNot ${CATEGORY_WORDS[l.category]}? Send *clothes*, *perfume*, *shoes* or *accessory*.`;
  return `${head}\n\n${lines.join("\n")}${tail}${unsure}${item.note ? `\n\nℹ️ ${item.note}` : ""}`;
}

const DONE = /^(✅\s*)?(done|ok|okay|yes|y|post|post it|go|live|send|haan|han|ha|ji|theek|thik|sahi|correct|right|👍)[.!]*$/i;
const CANCEL = /^(❌\s*)?(cancel|no|drop|discard|delete|nahi|nah)[.!]*$/i;
const CHANGE = /^(✏️\s*)?(change|edit|fix)[.!]*$/i;

// The owner's reply while a draft is open: done / cancel / change / an edit. Returns { reply, ... } or null.
function draftReply(text, hasImage) {
  if (hasImage) return null; // a new photo is a new post: it queues behind this one
  const t = text.trim();
  const queue = loadPending();
  const item = queue[0];
  const word = /^\D+$/.test(t) ? categoryAnswer(t) : null;
  // "pirce 3,000" -> "price 3,000": fix the edit word, keep the value.
  const [first, ...rest] = t.split(/\s+/);
  const kind = rest.length ? editWord(first.replace(/[:=\-]+$/, "")) : null;
  const e = kind ? `${kind} ${rest.join(" ")}` : t;
  if (!item) {
    if (DONE.test(t) || CANCEL.test(t) || CHANGE.test(t) || (kind && (kind === "name" || /^[₹\d,.\/-]+$/.test(rest.join(""))))) return { reply: "Nothing is waiting to be checked. Send a product photo with a caption to post it." };
    return null;
  }
  const l = item.listing;
  const next = () => (queue.length ? `\n\n—\n\n${card(queue[0])}` : "");
  const reshow = (changed) => { savePending(queue); return { reply: card(item, changed), buttons: DRAFT_BUTTONS }; };

  if (DONE.test(t)) {
    if (!l.price) return { reply: `💰 It needs a price before it goes live. Send e.g. *price 2499*.`, buttons: ["✏️ Change", "❌ Cancel"] };
    if (needsSize(l)) return { reply: `📏 What size is “${l.name}”? Send e.g. *M*, *M L XL*, *32 34*, or *free size*.`, buttons: ["✏️ Change", "❌ Cancel"] };
    queue.shift();
    savePending(queue);
    const product = publish({ id: item.id, listing: l, by: item.by, image: item.image });
    const win = celebrate(product);
    return { reply: liveReply(product, win) + next(), product, celebrate: win, buttons: queue.length ? DRAFT_BUTTONS : undefined };
  }
  if (CANCEL.test(t)) {
    queue.shift();
    savePending(queue);
    if (item.image) { try { fs.unlinkSync(path.join(UPLOADS, path.basename(item.image))); } catch { /* already gone */ } }
    return { reply: `🗑️ Dropped “${l.name}”. Nothing went on the website.${next()}`, buttons: queue.length ? DRAFT_BUTTONS : undefined };
  }
  if (CHANGE.test(t)) return { reply: `✏️ What should I change on “${l.name}”?\n\n${HOW_TO_CHANGE}`, buttons: ["✅ Done", "❌ Cancel"] };
  if (word) {
    l.category = word;
    l.subcategory = findSubcategory(`${l.caption || ""} ${l.name}`, word);
    item.sure = true;
    return reshow("section");
  }
  if (SIZE_ONLY.test(t) && (l.category === "Clothing" || !/^\d{2}$/.test(t))) { l.sizes = formatSizes(t); return reshow("size"); }
  let m;
  if ((m = /^(?:price|rate|rs\.?|₹)\s*[:=\-]?\s*(?:₹|rs\.?)?\s*([\d,]{2,9})(?:\s*\/-)?$/i.exec(e)) || (m = /^(?:₹|rs\.?)?\s*([\d,]{3,9})(?:\s*\/-)?$/i.exec(e))) {
    const n = Number(m[1].replace(/,/g, ""));
    if (n >= 10) { l.price = n; return reshow("price"); }
  }
  if ((m = /^mrp\s*[:=\-]?\s*(?:₹|rs\.?)?\s*([\d,]{2,9})$/i.exec(e))) { l.mrp = Number(m[1].replace(/,/g, "")); return reshow("price"); }
  if ((m = /^(?:qty|quantity|stock|pcs|pieces|nos)\s*[:=\-]?\s*(\d{1,3})$/i.exec(e)) || (m = /^(\d{1,3})\s*(?:pcs|pc|pieces|piece|nos|qty)$/i.exec(e)) || (m = /^[x×]\s*(\d{1,3})$/i.exec(e))) {
    const n = Number(m[1]);
    if (n > 0) { l.quantity = n; return reshow("qty"); }
  }
  if ((m = /^name\s*[:=\-]?\s+(.{2,80})$/i.exec(e))) { l.name = m[1].trim(); return reshow("name"); }
  if ((m = /^brand\s*[:=\-]?\s+(.{2,40})$/i.exec(e))) { l.brand = m[1].trim(); return reshow("brand"); }
  if ((m = /^sizes?\s*[:=\-]?\s+(.{1,40})$/i.exec(e))) {
    l.sizes = formatSizes(m[1]);
    return reshow("size");
  }
  // Looks like a new product (words and a price)? Queue it behind this one.
  const looks = parseMessage(t);
  if (!kind && looks.type === "product" && looks.product.price && looks.product.name !== "New arrival") {
    const id = crypto.randomBytes(6).toString("hex");
    queue.push({ id, listing: looks.product, note: null, by: "rules", image: null, sure: looks.sure, guess: looks.product.category });
    savePending(queue);
    return { reply: `📝 Got “${looks.product.name}” too. I'll show it to you after “${l.name}”.\n\nFirst, is “${l.name}” ready? Reply *done*, or *cancel* to drop it.`, buttons: DRAFT_BUTTONS };
  }
  return { reply: `🤔 I didn't get that. I'm still holding “${l.name}” for you to check.\n\n${HOW_TO_CHANGE}\n\nOr reply *done* to post it, *cancel* to drop it.`, buttons: DRAFT_BUTTONS };
}

function publish({ id, listing, by, image }) {
  const fresh = load(); // reload: another message may have landed meanwhile
  const product = {
    id, ...listing, code: newCode(fresh), quantity: listing.quantity || 1,
    image, status: "available", createdAt: new Date().toISOString(), by,
  };
  fresh.unshift(product);
  save(fresh);
  return product;
}

// ---- Activity log: posts and sales, for streaks, "today" counts and the stats bar ----
const ACTIVITY = path.join(STORE, "activity.json");
const loadActivity = () => { try { return JSON.parse(fs.readFileSync(ACTIVITY, "utf8")); } catch { return []; } };
function logActivity(ev) {
  const list = loadActivity();
  list.push({ at: new Date().toISOString(), ...ev });
  fs.writeFileSync(ACTIVITY, JSON.stringify(list.slice(-5000), null, 2));
}
// Days are counted in shop time (Srinagar).
const shopDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
function streakDays(acts) {
  const days = new Set(acts.filter((a) => a.type === "post").map((a) => shopDay(a.at)));
  let n = 0;
  for (let d = Date.now(); days.has(shopDay(d)); d -= 864e5) n++;
  return n;
}

// The fun bit: counts and milestones after each post goes live.
function celebrate(product) {
  logActivity({ type: "post", id: product.id, name: product.name });
  const acts = loadActivity();
  const today = shopDay(Date.now());
  const postedToday = acts.filter((a) => a.type === "post" && shopDay(a.at) === today).length;
  const live = load().filter((p) => p.status !== "sold").length;
  const streak = streakDays(acts);
  let milestone = null;
  if ([5, 10, 20, 30, 50].includes(postedToday)) milestone = `🔥 ${postedToday} drops today. You're on fire!`;
  else if (live % 25 === 0) milestone = `🏆 ${live} pieces live on your website!`;
  else if (postedToday === 1) milestone = "🌅 First drop of the day!";
  else if (postedToday === 3) milestone = "⚡ 3 drops today. Keep them coming!";
  return { name: product.name, code: product.code, image: product.image, postedToday, live, streak, milestone };
}

function liveReply(product, win) {
  const shelf = [product.category, product.subcategory].filter(Boolean).join(" › ");
  const bits = [product.brand, rupees(product.price), product.sizes].filter(Boolean).join(" · ");
  const score = [`📈 ${win.postedToday} posted today`, win.streak > 1 ? `🔥 ${win.streak}-day streak` : null, `🛍️ ${win.live} live`].filter(Boolean).join(" · ");
  return `🎉 *LIVE on your website!*\n*${product.name}*\n${bits}\nin ${shelf}\n\n🔢 Code *${product.code}* · ${product.quantity} in stock\nWhen one sells, send *sold ${product.code}*${product.quantity > 1 ? ` (or *sold ${product.code} 2* for two)` : ""}.\nWrong section? Send *move ${product.code} ${product.category === "Fragrances" ? "clothes" : "perfume"}*.\n\n${score}${win.milestone ? `\n${win.milestone}` : ""}`;
}

// ---- Numbers for the owner: the stats bar on /demo, and the "stats" chat command ----
function stats() {
  const items = load();
  const orders = loadOrders();
  const inbox = loadInbox();
  const acts = loadActivity();
  const today = shopDay(Date.now());
  const isToday = (d) => d && shopDay(d) === today;
  const onSale = items.filter((p) => p.status !== "sold");
  const units = (p) => (p.quantity > 0 ? p.quantity : 1);
  const soldToday = acts.filter((a) => a.type === "sold" && isToday(a.at));
  const sections = {};
  for (const p of onSale) sections[p.category] = (sections[p.category] || 0) + 1;
  return {
    live: onSale.length,
    units: onSale.reduce((n, p) => n + units(p), 0),
    stockValue: onSale.reduce((n, p) => n + (p.price || 0) * units(p), 0),
    postedToday: acts.filter((a) => a.type === "post" && isToday(a.at)).length,
    soldToday: soldToday.reduce((n, a) => n + (a.qty || 1), 0),
    salesToday: soldToday.reduce((n, a) => n + (a.amount || 0), 0),
    ordersToCheck: orders.filter((o) => o.status === "paid").length,
    enquiriesToday: inbox.filter((m) => m.kind === "enquiry" && isToday(m.at)).length,
    drafts: loadPending().length,
    lastOne: onSale.filter((p) => p.status === "available" && units(p) === 1).length,
    soldOut: items.filter((p) => p.status === "sold").length,
    streak: streakDays(acts),
    sections,
  };
}
function statsReply() {
  const s = stats();
  const sec = Object.entries(s.sections).map(([k, v]) => `${SECTION_LABEL[k] || k} ${v}`).join(" · ");
  return `📊 *Your website today*\n\n🛍️ ${s.live} pieces live (${s.units} in stock, worth ${inr(s.stockValue)})\n📈 ${s.postedToday} posted today${s.streak > 1 ? ` · 🔥 ${s.streak}-day streak` : ""}\n💸 ${s.soldToday} sold today${s.salesToday ? ` · ${inr(s.salesToday)}` : ""}\n💰 ${s.ordersToCheck} order${s.ordersToCheck === 1 ? "" : "s"} waiting for you to check payment\n💬 ${s.enquiriesToday} enquir${s.enquiriesToday === 1 ? "y" : "ies"} today\n⏳ ${s.lastOne} on their last piece · ${s.soldOut} sold out\n\n${sec}`;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = decodeURIComponent(url.pathname);
    try {
      if (req.method === "GET" && p === "/api/products") return send(res, 200, load());
      if (p === "/webhook" && (req.method === "GET" || req.method === "POST")) return await whatsappWebhook(req, res, url);
      if (req.method === "POST" && p === "/api/enquiry") return await handleEnquiry(req, res);
      if (req.method === "POST" && p === "/api/orders") return await createOrder(req, res);
      const om = /^\/api\/orders\/([a-f0-9]{16})(\/paid)?$/.exec(p);
      if (om && req.method === "POST" && om[2]) return await orderPaid(req, res, om[1]);
      if (om && req.method === "GET" && !om[2]) {
        const o = loadOrders().find((x) => x.id === om[1]);
        return o ? send(res, 200, { code: o.code, status: o.status }) : send(res, 404, { error: "not found" });
      }
      const ownerOnly = p === "/demo" || p === "/demo.html" || p === "/api/inbox" || p === "/api/message" || p === "/api/reset" || p === "/api/stats";
      if (ownerOnly && !isOwner(req, url)) {
        return p.startsWith("/api/") ? send(res, 401, { error: "Owner key required." }) : notFoundPage(res);
      }
      if (req.method === "GET" && p === "/api/inbox") {
        const after = url.searchParams.get("after") || "";
        return send(res, 200, loadInbox().filter((m) => m.at > after));
      }
      if (req.method === "POST" && p === "/api/message") return await handleMessage(req, res);
      if (req.method === "GET" && p === "/api/stats") return send(res, 200, stats());
      // Owner screen add-ons (stats bars, reply buttons, celebration), shared by every design.
      if (p === "/owner-kit.js" || p === "/owner-kit.css") return serveFile(res, path.join(ROOT, "owner"), p.slice(1));
      if (req.method === "POST" && p === "/api/reset") {
        if (LIVE) return send(res, 403, { error: "Reset is switched off on the live shop, so real products and orders can't be wiped." });
        writeSeed();
        ensureCodes();
        saveInbox([]);
        saveOrders([]);
        savePending([]);
        fs.writeFileSync(ACTIVITY, "[]");
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
      if (legal) return legalPage(res, legal);
      if (!path.extname(p)) return notFoundPage(res);
      return serveFile(res, PUBLIC, p.slice(1));
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  })
  .listen(PORT, () => {
    console.log(`Vibe X demo: http://localhost:${PORT}/demo  (shop only: http://localhost:${PORT}/)`);
    console.log(aiEnabled() ? `Photo reading: ON (${MODEL})` : "Photo reading: OFF (no ANTHROPIC_API_KEY in .env), using keyword rules");
    console.log(wa.enabled() ? `WhatsApp: ON (owner ${wa.owners().map((n) => n.slice(0, 4) + "…").join(", ")})` : "WhatsApp: OFF (set WA_TOKEN, WA_PHONE_ID, WA_APP_SECRET, WA_VERIFY_TOKEN, OWNER_WHATSAPP)");
    setTimeout(() => wa.ensureSubscriptions(siteUrl() && `${siteUrl()}/webhook`), 20e3);
    console.log(LIVE ? `Data: ${STORE} (persistent disk; reset off)` : "Data: data/ (demo; not kept on free hosting restarts)");
    console.log(process.env.OWNER_KEY ? "Owner key: ON (open /demo?key=YOUR_KEY)" : "Owner key: OFF (fine locally; set OWNER_KEY on a public server)");
  });

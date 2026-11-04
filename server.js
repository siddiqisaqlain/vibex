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
const { classify, aiEnabled, MODEL, readPurchaseBill } = require("./lib/classify");
const wa = require("./lib/whatsapp");
const createBilling = require("./lib/billing");
const { readJson, writeJson, dailyBackup } = require("./lib/jsonstore");
const SHOP_NAME = "Vibe X";

const PORT = Number(process.env.PORT) || 4300;
const ROOT = __dirname;
// DESIGN picks a saved design instead of the current one in public/:
//   public/ = current (surplus price-tag style); saved: v1 first surplus, v2 dark minimal,
//   v3 colourful, v4 surplus look on the v2 layout, v5 department-store look (all in designs/)
const DESIGNS = { v1: "v1-surplus", v2: "v2-dark", v3: "v3-colour", v4: "v4-mix", v5: "v5-bear", v5c: "v5-classic" };
const PUBLIC = DESIGNS[process.env.DESIGN] ? path.join(ROOT, "designs", DESIGNS[process.env.DESIGN]) : path.join(ROOT, "public");
// Which page frame the active design uses for product, policy and 404 pages ("v1" or "v2").
const SHELL = (() => { try { return JSON.parse(fs.readFileSync(path.join(PUBLIC, "design.json"), "utf8")).shell; } catch { return "v2"; } })();
const DATA = path.join(ROOT, "data"); // seed.json + seed-photos/ ship with the code (read-only)
// Live files (products, photos, orders, messages) go in STORE. On Render that's a persistent
// disk (DATA_DIR=/var/data), so nothing is lost on restart or redeploy. Locally: data/.
const STORE = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DATA;
const LIVE = Boolean(process.env.DATA_DIR); // a real shop: the demo reset is switched off
// The shop's details (name, contact, payment, policy windows, homepage claims): shop.json.
const SHOP = JSON.parse(fs.readFileSync(path.join(ROOT, "shop.json"), "utf8"));
// Online ordering needs real payment details; with demo ones it stays off on the live shop.
const ORDERING_OPEN = !(LIVE && SHOP.pay?.demo);
const UPLOADS = path.join(STORE, "uploads");
const DB = path.join(STORE, "products.json");
const SEED = path.join(DATA, "seed.json");

fs.mkdirSync(UPLOADS, { recursive: true });
wa.setAlertsFile(path.join(STORE, "wa-alerts.json")); // alerts held while the owner is outside WhatsApp's 24 h window
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
// "Gucci Flora 100 mL" -> name "Gucci Flora", sizes "100 ml". Bottle sizes belong in the size
// field (the site shows them as a chip), not in the name. Also tidies a stray " - " left behind.
const VOLUME = /\s*[-–,(]?\s*\b(\d{1,4}(?:[.,]\d)?)\s?(ml|mls|ltr|litres?|liters?)\b\.?\)?/i;
function tidyListing(l) {
  if (!l || !l.name || l.category !== "Fragrances") return l; // clothes sizes like "L" are left alone
  const m = VOLUME.exec(l.name);
  if (m) {
    const rest = (l.name.slice(0, m.index) + " " + l.name.slice(m.index + m[0].length)).replace(/\s+/g, " ").replace(/^[\s\-–,]+|[\s\-–,]+$/g, "").trim();
    if (rest.length >= 2) {
      l.name = rest;
      const vol = `${m[1].replace(",", ".")} ${/^(ltr|lit)/i.test(m[2]) ? "L" : "ml"}`;
      if (!l.sizes) l.sizes = vol;
    }
  }
  l.name = l.name.replace(/\s+[-–]\s*$/, "").trim();
  return l;
}
// Once at start-up: tidy names already on the site (e.g. posts from before this existed).
(() => {
  const items = load();
  let n = 0;
  for (const p of items) { const before = `${p.name}|${p.sizes}`; tidyListing(p); if (`${p.name}|${p.sizes}` !== before) n++; }
  if (n) { fs.writeFileSync(DB, JSON.stringify(items, null, 2)); console.log(`Tidied ${n} product name(s): bottle size moved to the size field`); }
})();
const save = (items) => writeJson(DB, items);
// What customers may see. Cost prices and the shop's own notes never leave the server, and
// hidden items (imported, waiting for a photo) aren't on sale yet.
const PRIVATE_FIELDS = ["cost", "purchasePrice", "supplierId", "hsn", "gstRate", "reorderAt", "barcode", "importKey", "needsCount", "needsName"];
const isPublic = (p) => !p.hidden;
const forCustomers = (p) => { const c = { ...p }; for (const k of PRIVATE_FIELDS) delete c[k]; return c; };
const publicProducts = () => load().filter(isPublic).map(forCustomers);

// Posts the bot wasn't sure about ("Gucci 2499": clothes or perfume?) wait here, oldest first,
// until the owner answers. They are not on the website until then.
const PENDING = path.join(STORE, "pending.json");
const loadPending = () => { try { return JSON.parse(fs.readFileSync(PENDING, "utf8")); } catch { return []; } };
// touch = the owner is working on these drafts now (used to spot old, forgotten ones).
const savePending = (list, touch = true) => {
  if (touch) for (const x of list) x.touched = Date.now();
  fs.writeFileSync(PENDING, JSON.stringify(list, null, 2));
};

// Billing: every sale (portal, WhatsApp, website order) goes through billing.sell(), which
// takes the stock and writes the invoice together. See lib/billing.js.
const billing = createBilling({ STORE, SHOP, load, save, logActivity });
const invoicePage = require("./lib/invoice-page");
const stockImport = require("./lib/import-mybillbook");
const books = require("./lib/books")({ STORE, SHOP, billing, load, save, logActivity });
billing.hooks.partyFor = books.customerFor;
const documents = require("./lib/documents")({ STORE, billing, books, load, save, logActivity });
const reports = require("./lib/reports")({ SHOP, billing, books, documents, load });
const staff = require("./lib/staff")({ STORE });
// Bill settings saved from the portal sit on top of shop.json.
Object.assign(SHOP.billing, books.getSetting("billSettings") || {});
if (books.getSetting("gstin")) SHOP.business.gstin = books.getSetting("gstin");
billing.hooks.canCancel = (inv) => (documents.hasReturn("invoiceId", inv.id) ? `Bill ${inv.number} has a return against it. Cancel the return first.` : null);
// The books get a dated copy every day, kept 30 days on the same disk.
const BOOK_FILES = ["staff.json", "products.json", "invoices.json", "parties.json", "payments.json", "purchases.json", "expenses.json", "books.json", "orders.json", "returns.json", "docs.json"];
if (LIVE) { dailyBackup(STORE, BOOK_FILES); setInterval(() => dailyBackup(STORE, BOOK_FILES), 3600e3).unref(); }
// Bill links in WhatsApp replies. Locally there's no public address, so it's a path.
const billUrl = (inv) => `${process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ""}`.replace(/\/$/, "") + `/bill/${inv.id}`;
const PAY_LABEL = { cash: "Cash", upi: "UPI", card: "Card", credit: "Credit" };
// "bills" in the chat: today's bills from every channel (counter, WhatsApp, website).
function billsReply() {
  const day = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const t = day(Date.now());
  const list = billing.loadInvoices().filter((x) => day(x.at) === t);
  if (!list.length) return "🧾 No bills yet today.";
  const sum = billing.today();
  const where = { counter: "🏬", whatsapp: "💬", website: "🌐" };
  const lines = list.slice(-15).map((x) => `${where[x.source] || ""} ${x.number.split("/").pop()} · ${inr(x.total)} · ${x.lines.map((l) => `${l.qty > 1 ? l.qty + "× " : ""}${l.name}`).join(", ").slice(0, 60)}${x.status === "cancelled" ? " ❌" : ""}`);
  const pay = Object.entries(sum.byPayment).map(([k, v]) => `${PAY_LABEL[k] || k} ${inr(v)}`).join(" · ");
  return `🧾 *Today's bills: ${sum.bills}* · *${inr(sum.total)}*\n${pay}\n\n${lines.join("\n")}${list.length > 15 ? `\n…and ${list.length - 15} earlier` : ""}\n\n🏬 counter · 💬 WhatsApp · 🌐 website`;
}

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
  wa.notifyOwners(msg.text, img, { shop: SHOP_NAME, ...msg.summary });
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

  const p = load().filter(isPublic).find((x) => x.id === String(body.productId || ""));
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
    summary: { kind: "enquiry", ref: `EQ${(p.code || p.id).toString().slice(-6).toUpperCase()}` },
    productId: p.id,
    image: p.image,
    text: `💬 *Enquiry from the website*\n*${p.name}*${price}${p.status === "sold" ? " (marked SOLD)" : ""}\n\n👤 ${name}\n📞 ${prettyPhone(phone)}${note ? `\n💬 “${note}”` : ""}\n\nReply on WhatsApp: https://wa.me/91${phone}?text=${hello}`,
  });
  send(res, 200, { ok: true, phone: prettyPhone(phone) });
}

// ---- Orders ("Order now") ----
// Flow: customer fills details -> pays by UPI/bank/number -> taps "I've paid"
// -> piece goes ON HOLD -> owner checks his bank app and replies
// "confirm VX-1234" (piece becomes SOLD) or "cancel VX-1234" (piece goes back on sale).
const ORDERS = path.join(STORE, "orders.json");
const loadOrders = () => readJson(ORDERS, []);
const saveOrders = (o) => writeJson(ORDERS, o);
const lotOf = (p) => "LOT " + (p.code || hashLot(p.id));
const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

function newOrderCode(orders) {
  for (;;) {
    const code = "VX-" + String(crypto.randomInt(1000, 10000));
    if (!orders.some((o) => o.code === code)) return code;
  }
}

// Discount codes from shop.json → offers, e.g. { code: "FIRST10", percent: 10, firstOrderOnly: true }.
// The server works out the price; the checkout only shows it.
const OFFERS = (SHOP.offers || []).filter((o) => o && o.code && o.percent > 0 && o.percent < 100);
function applyOffer(raw, phone, orders) {
  const want = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!want) return null;
  const offer = OFFERS.find((o) => o.code.toUpperCase() === want);
  if (!offer) return { error: `“${want.slice(0, 20)}” isn't a valid code.` };
  if (offer.firstOrderOnly && orders.some((o) => o.phone === phone && o.status !== "cancelled")) {
    return { error: `${offer.code} is for your first order only, and this number has ordered before.` };
  }
  return { offer };
}

async function createOrder(req, res) {
  let b;
  try { b = JSON.parse(await readBody(req, 20 * 1024)); } catch { return send(res, 400, { error: "Something went wrong. Please try again." }); }
  if (b.website) return send(res, 200, { ok: true });
  if (!ORDERING_OPEN) return send(res, 403, { error: "Online ordering opens soon. Tap Enquire and we'll reply on WhatsApp." });
  if (tooMany(req.socket.remoteAddress || "?")) return send(res, 429, { error: "Too many attempts. Please wait a few minutes." });
  const p = load().filter(isPublic).find((x) => x.id === String(b.productId || ""));
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
  const promo = applyOffer(b.promo, phone, orders);
  if (promo && promo.error) return send(res, 400, { error: promo.error });
  const discount = promo ? Math.round((p.price * promo.offer.percent) / 100) : 0;
  const order = {
    id: crypto.randomBytes(8).toString("hex"), code: newOrderCode(orders),
    productId: p.id, productName: p.name, lot: lotOf(p), amount: p.price - discount,
    ...(promo ? { promo: promo.offer.code, discount, fullPrice: p.price } : {}),
    name, phone, delivery, address, city, pin,
    status: "awaiting_payment", createdAt: new Date().toISOString(),
  };
  orders.push(order);
  saveOrders(orders);
  send(res, 200, { id: order.id, code: order.code, amount: order.amount, lot: order.lot, promo: order.promo || null, discount });
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
    summary: { kind: "order", ref: o.code },
    image: proof || (p && p.image) || null,
    text: `💰 *New order ${o.code}: check the payment*\n*${o.productName}* · ${inr(o.amount)}${o.promo ? ` (${o.promo}: ${inr(o.fullPrice)} − ${inr(o.discount)})` : ""} · ${o.lot}\n\n👤 ${o.name}\n📞 ${prettyPhone(o.phone)}\n${where}\n🧾 ${utr ? `Payment ref: ${utr}` : proof ? "Payment screenshot above" : `Customer tapped "I've paid". Look for note ${o.code}`}\n\nCheck your bank or UPI app for ${inr(o.amount)}, then reply:\n*confirm ${o.code}* or *cancel ${o.code}*\n\nMessage customer: https://wa.me/91${o.phone}?text=${hello}`,
  });
  send(res, 200, { code: o.code, status: o.status });
}

const HELP = `📋 *Commands*
*Post a product:* just send the photo. I'll ask for anything I need (section, name, price, size) one at a time, then show you how it looks. Tap *Post it* and it's live.
_Faster:_ put it all in the caption, e.g. _Zara shirt 1499 M L_, and it's one tap
*Today's numbers:* _stats_
*Today's bills:* _bills_
*Running low:* _low_
*Put an imported item on the website:* send its photo with the code as the caption, e.g. _4795_
*Sell:* _sold 4795_ (one) or _sold 4795 2_
*More came in:* _add 4795 3_
*Set stock:* _stock 4795 5_
*Wrong section:* _move 4795 perfume_ (or clothes, shoes, accessory)
*Take down:* _remove 4795_
*Start over:* _clear_ drops every photo still waiting to be posted
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
  if (c.action === "sold") {
    // Same path as the billing portal: stock comes off and a bill is written in one go.
    if (p.status === "sold" || before === 0) return `“${p.name}” (#${p.code}) is already sold out. Send *add ${p.code} 1* if more came in.`;
    const r = billing.sell([{ productId: p.id, qty: c.qty }], { source: "whatsapp", clamp: true });
    if (r.error) return `⚠️ ${r.error}`;
    const n = r.invoice.lines[0].qty;
    const after = billing.stockOf(r.products.find((x) => x.id === p.id));
    const left = after === 0 ? "*SOLD OUT* on the website." : `*${after}* left on the website.`;
    const over = c.qty > n ? ` (you had only ${n}, so it's now sold out)` : "";
    return `🏷️ Sold ${n} × “${p.name}” (#${p.code})${over}. ${left}\n🧾 Bill ${r.invoice.number} · ${inr(r.invoice.total)}: ${billUrl(r.invoice)}`;
  }
  let after;
  if (c.action === "add") {
    after = before + c.qty;
  } else {
    after = c.qty;
  }
  p.quantity = after;
  if (after === 0) { p.status = "sold"; delete p.holdFor; }
  else if (p.status === "sold") p.status = "available";
  save(items);
  const left = after === 0 ? "*SOLD OUT* on the website." : `*${after}* left on the website.`;
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
    if (o.status === "cancelled") return `${o.code} is already cancelled.`;
    // Already confirmed = already billed: cancelling the bill puts the piece back on sale.
    if (o.invoice) { const r = billing.cancel(o.invoice, `Order ${o.code} cancelled`); if (!r.error) o.invoice = null; }
    o.status = "cancelled";
    if (p && p.status === "hold" && p.holdFor === o.code) { p.status = "available"; delete p.holdFor; save(items); }
    saveOrders(orders);
    return `❌ ${o.code} cancelled. “${o.productName}” is back on sale.\nTell the customer: ${hello(`Hi ${o.name}, Vibe X here. We couldn't find your payment for order ${o.code}. Could you send the payment screenshot?`)}`;
  }
  if (o.status === "confirmed") return `${o.code} is already confirmed.`;
  if (o.status === "cancelled") return `${o.code} was cancelled. Ask the customer to order again.`;
  // Same path as the billing portal: stock comes off and the bill is written in one go.
  const sale = billing.sell([{ productId: o.productId, qty: 1, price: o.amount }], {
    source: "website", order: o.code, holdFor: o.code, payment: "upi",
    customer: { name: o.name, phone: o.phone, address: o.delivery === "ship" ? `${o.address}, ${o.city} ${o.pin}` : "" },
  });
  if (sale.error) return `⚠️ Can't confirm ${o.code}: ${sale.error}\nIf the customer has paid, refund them and send *cancel ${o.code}*.`;
  o.status = "confirmed";
  o.confirmedAt = new Date().toISOString();
  o.invoice = sale.invoice.id;
  saveOrders(orders);
  const next = o.delivery === "ship" ? "Pack it for shipping" : "Keep it aside for pickup";
  const after = sale.products.find((x) => x.id === o.productId);
  return `✅ ${o.code} confirmed. “${o.productName}” marked ${after.status === "sold" ? "SOLD" : `sold (${after.quantity} left)`}.\n🧾 Bill ${sale.invoice.number}: ${billUrl(sale.invoice)}\n${next}. The customer's screen already shows it's confirmed.\nMessage them: ${hello(`Hi ${o.name}, Vibe X here. Payment received for ${o.code} (${o.productName}). ${o.delivery === "ship" ? "We'll share tracking once it ships." : "It's ready for pickup at the store."}`)}`;
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
<script src="/config.js"></script><script src="/art.js"></script><script src="/order.js"></script><script src="/vendor/qrcode.js"></script><script src="/checkout.js"></script><script src="/pdp.js"></script><script src="/newtab.js"></script>
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
<nav class="foot-links" aria-label="Policies"><a href="/returns">Returns and refunds</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a></nav></div>
<p class="foot-note">© 2026 Vibe X · The Surplus Room, Srinagar, Kashmir</p></div></footer>
<div class="toast" id="toast" role="status" hidden></div>
<script src="/config.js"></script>${scripts.map((src) => `<script src="${src}"></script>`).join("")}<script src="/ui.js"></script><script src="/newtab.js"></script>
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
<nav class="foot-links" aria-label="Policies"><a href="/returns">Returns and refunds</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a></nav></div></footer>
<script src="/newtab.js"></script>
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

const legal = require("./lib/legal");
function legalPage(res, key) {
  const page = legal.pages(SHOP)[key];
  const todo = legal.missing(SHOP);
  const banner = todo.length ? `<p class="draft">This page is being finalised. Still to add: ${escHtml(todo.join(", "))}.</p>` : "";
  const inner = `<p class="${SHELL === "v1" ? "label" : "eyebrow"}">Vibe X ${key === "contact" ? "" : "policies"}</p><h1>${escHtml(page.title)}</h1>
      ${banner}${page.html}`;
  const frame = SHELL === "v1" ? v1Shell : pageShell;
  send(res, 200, frame({
    title: `${page.title} · Vibe X`,
    head: `<meta name="description" content="${escHtml(page.summary)}">`,
    body: SHELL === "v1" ? `<div class="legal">${inner}</div>` : `<main class="wrap legal">${inner}</main>`,
  }), "text/html; charset=utf-8");
}

// Hidden previews of saved designs, for showing the client: /preview/classic and /preview/modern.
// Same live stock, orders and checkout as the shop; the shop's own home page is unchanged.
// Not linked from anywhere and marked noindex. Asset paths are pointed at the design's folder.
const PREVIEWS = { classic: "v5-classic", modern: "v5-bear" };
function previewHtml(html, name) {
  const base = `/preview/${name}`;
  return html
    .replace(/(src|href)="\/(?!\/)([^"#?]*\.[a-z0-9]+)"/gi, (m, attr, file) => `${attr}="${base}/${file}"`) // files
    .replace(/href="\/(#[^"]*)?"/g, (m, hash) => `href="${base}/${hash || ""}"`)                          // home links
    .replace("<head>", `<head>\n<meta name="robots" content="noindex, nofollow">\n<script>window.VX_BASE = "${base}";</script>`);
}
function previewRoute(req, res, name, rest) {
  const dir = path.join(ROOT, "designs", PREVIEWS[name]);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (rest === "") { res.writeHead(301, { Location: `/preview/${name}/` }); return res.end(); }
  if (rest === "/") return send(res, 200, previewHtml(fs.readFileSync(path.join(dir, "index.html"), "utf8"), name), "text/html; charset=utf-8");
  const pm = /^\/p\/([\w-]{1,40})$/.exec(rest);
  if (pm) {
    const { p, title, head } = productMeta(req, pm[1]);
    return send(res, p ? 200 : 404, previewHtml(legacyProductPage(title, head, pm[1]), name), "text/html; charset=utf-8");
  }
  if (rest === "/config.js") return sendConfig(res);
  if (rest === "/newtab.js") return serveFile(res, path.join(ROOT, "lib"), "newtab.js");
  return serveFile(res, dir, rest.slice(1));
}

function sendConfig(res) {
  const pub = { ...SHOP, orderingOpen: ORDERING_OPEN };
  res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
  return res.end(`window.SHOP = ${JSON.stringify(pub).replace(/</g, "\\u003c")};\n`);
}

function productMeta(req, id) {
  const p = load().filter(isPublic).find((x) => x.id === id);
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
  return { p, title, head };
}

function productPage(req, res, id) {
  const { p, title, head } = productMeta(req, id);
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
  // Several photos sent together (a WhatsApp album, or many picked at once on /demo).
  const photos = Array.isArray(body.photos) ? body.photos.filter((x) => x && x.image).slice(0, 50) : [];
  if (photos.length > 1) return batchMessage(photos);
  if (photos.length === 1) body = photos[0];
  const text = String(body.text || "").slice(0, 1000);
  if (!text.trim() && !body.image) return { status: 400, error: "empty message" };

  // A photo with an imported item's code: that item goes on the website.
  if (body.image) {
    const live = photoForImported(text, body.image);
    if (live) return live;
  }
  const items = load();
  const stockReply = stockCommand(text);
  if (stockReply) return { reply: stockReply };
  const orderReply = orderCommand(text);
  if (orderReply) return { reply: orderReply };
  if (/^(stats|report|status|aaj|today)$/i.test(text.trim())) return { reply: statsReply() };
  if (/^(bills?|sales|hisab|hisaab)$/i.test(text.trim())) return { reply: billsReply() };
  if (/^(low|low stock|kam)$/i.test(text.trim())) return { reply: reports.lowText() };
  const cleared = !body.image && (clearCommand(text) || choiceReply(text));
  if (cleared) return cleared;
  const batched = !body.image && batchReply(text);
  if (batched) return batched;
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
    if (parsed.action === "sold") {
      if (target.status === "sold") return { reply: `“${target.name}” (#${target.code}) is already sold out.` };
      const r = billing.sell([{ productId: target.id, qty: 1 }], { source: "whatsapp" });
      if (r.error) return { reply: `⚠️ ${r.error}` };
      const left = billing.stockOf(r.products.find((x) => x.id === target.id));
      const bill = `🧾 Bill ${r.invoice.number} · ${inr(r.invoice.total)}: ${billUrl(r.invoice)}`;
      return { reply: left > 0
        ? `🏷️ One “${target.name}” sold. ${left} left on the website.\n${bill}\nReply *sold ${target.name.split(" ")[0].toLowerCase()}* again for the next one.`
        : `🏷️ Marked “${target.name}” as SOLD.\n${bill}` };
    }
    target.status = "available";
    if (parsed.action === "restock" && !target.quantity) target.quantity = 1;
    save(items);
    return { reply: `✅ “${target.name}” is back in stock.` };
  }

  const item = await makeDraft(text, body.image, parsed);
  const queue = loadPending();
  if (forgotten(queue)) return askKeepOld(queue, [item]);
  // A photo sent while a batch is open joins the batch.
  const open = queue.find((x) => x.batch);
  if (open) { item.batch = open.batch; queue.push(item); savePending(queue); return batchNext(queue, "📸 Added that one too.\n\n"); }
  queue.push(item);
  savePending(queue);
  if (queue.length > 1) return { reply: `📸 Got the next one too. I'll ask about it once “${queue[0].listing.name}” is done.` };
  return step(queue[0], { fresh: true });
}

// One photo + caption -> a draft. Rules always run; the AI reader (when configured) decides
// what the item is from the photo, and the rules fill any price/size it left empty.
// Imported items wait off the website until they have a photo. The caption is the item's
// 4-digit code or its barcode, on its own.
function photoForImported(text, image) {
  const key = String(text || "").trim().replace(/^#/, "");
  if (!/^\d{4,13}$/.test(key)) return null;
  const items = load();
  const p = items.find((x) => x.hidden && (x.code === key || x.barcode === key));
  if (!p) return null;
  if (!p.price) return { reply: `“${p.name}” (#${p.code}) has no selling price yet, so it can't go on the website. Add it in the Stock tab, then send the photo again.` };
  if (p.needsName) return { reply: `Item #${p.code} needs a proper name before it can go on the website.` };
  const saved = saveImage(image, p.id);
  if (!saved) return { reply: "I couldn't read that photo. Please send it again." };
  p.image = saved;
  delete p.hidden;
  save(items);
  const win = celebrate(p);
  const left = billing.stockOf(p);
  return { reply: `🎉 *“${p.name}” is on your website!*\n🔢 Code *${p.code}* · ${left > 0 ? `${left} in stock` : "shows as sold out: send *add " + p.code + " 1* when you have stock"}\n📈 ${win.postedToday} posted today · 🛍️ ${win.live} live` };
}

async function makeDraft(text, imageData, parsed = parseMessage(text)) {
  const rules = parsed.type === "product" ? parsed.product : parseMessage("").product;
  let listing = rules, note = null, by = "rules", sure = parsed.type === "product" ? parsed.sure : false;
  if (aiEnabled()) {
    try {
      const ai = await classify(text, imageData);
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
  // The rules miss "m l xl" / "32 34" at the end of a caption; the answer reader gets those.
  if (!listing.sizes) { const a = readAnswer(text); if (a.sizes) listing = { ...listing, sizes: a.sizes }; }
  const id = crypto.randomBytes(6).toString("hex");
  return { id, listing, note, by, image: saveImage(imageData, id), sure, guess: listing.category };
}

// ---- Old, forgotten drafts ----
// Photos the owner never posted (he moved on, or cleared the chat on his phone, which doesn't
// reach us) shouldn't silently mix with new ones. If drafts have waited untouched for a while
// when new photos come in, ask first: just the new ones, or keep both. "clear" drops them all.
const STALE_MS = Number(process.env.DRAFT_STALE_MS) || 5 * 60e3;
const dropDraftImage = (x) => { if (x.image) try { fs.unlinkSync(path.join(UPLOADS, path.basename(x.image))); } catch { /* gone */ } };
const KEEP_BUTTONS = ["🆕 Just the new", "➕ Keep both"];
function forgotten(queue) {
  if (queue.some((x) => x.waitChoice)) return true; // still waiting for that answer
  return queue.length > 0 && Date.now() - Math.max(...queue.map((x) => x.touched || 0)) > STALE_MS;
}
function askKeepOld(queue, fresh) {
  for (const d of fresh) { d.waitChoice = true; delete d.batch; }
  queue.push(...fresh);
  savePending(queue, false);
  const old = queue.filter((x) => !x.waitChoice), nw = queue.filter((x) => x.waitChoice);
  const names = old.slice(0, 3).map((x) => x.listing.name === "New arrival" ? "a photo with no details" : x.listing.name).join(", ") + (old.length > 3 ? "…" : "");
  return {
    reply: `📸 Got ${nw.length === 1 ? "your new photo" : `your ${nw.length} new photos`}.\n\nYou still have *${old.length} from before* that never went live (${names}).\n\nPost just the new ${nw.length === 1 ? "one" : "ones"}, or keep the old ones too?`,
    buttons: KEEP_BUTTONS,
  };
}
// The answer to askKeepOld(). Returns null when nothing is waiting for it.
function choiceReply(text) {
  const queue = loadPending();
  const nw = queue.filter((x) => x.waitChoice);
  if (!nw.length) return null;
  const old = queue.filter((x) => !x.waitChoice);
  const t = text.trim().replace(/^[^\p{L}\p{N}]+/u, "").trim();
  let list, lead = "";
  if (/^(just the new|just new|only new|new only|new|drop old|start fresh)$/i.test(t)) {
    old.forEach(dropDraftImage);
    list = nw;
    lead = `🗑️ Dropped the ${old.length} old one${old.length === 1 ? "" : "s"}.\n\n`;
  } else if (/^(keep both|both|keep|keep all)$/i.test(t)) {
    list = [...old, ...nw];
  } else {
    return { reply: `First, about the photos from before: post just the new ${nw.length === 1 ? "one" : "ones"}, or keep the old ones too?`, buttons: KEEP_BUTTONS };
  }
  for (const x of list) { delete x.waitChoice; x.ask = null; }
  if (list.length > 1) {
    const b = list.find((x) => x.batch)?.batch || crypto.randomBytes(4).toString("hex");
    for (const x of list) x.batch = b;
    markGroupAsk(list);
    savePending(list);
    return batchNext(list, lead);
  }
  delete list[0].batch;
  savePending(list);
  const out = step(list[0], { fresh: true });
  return { ...out, reply: lead + out.reply };
}
// "clear" / "start over": drop every photo waiting to be posted.
function clearCommand(text) {
  if (!/^(clear|clear all|start over|cancel all|discard all)[.!]*$/i.test(text.trim().replace(/^[^\p{L}]+/u, ""))) return null;
  const queue = loadPending();
  if (!queue.length) return { reply: "Nothing is waiting to be posted. 📸 Send a photo whenever you're ready." };
  queue.forEach(dropDraftImage);
  savePending([]);
  return { reply: `🗑️ Cleared ${queue.length === 1 ? "the photo" : `all ${queue.length} photos`} waiting to be posted. Nothing went on the website.\n\n📸 Send new photos whenever you're ready.` };
}

// ---- Many photos at once: today's whole stock in one go ----
// The owner sends every photo together (captions optional, e.g. just "2499 M L"). The bot reads
// them all, then asks ONE question per photo that still needs something, showing that photo,
// and ends with a summary: Post all / Check each.
async function batchMessage(photos) {
  const batch = crypto.randomBytes(4).toString("hex");
  const drafts = [];
  for (let i = 0; i < photos.length; i += 4) { // read 4 at a time
    const part = await Promise.all(photos.slice(i, i + 4).map((p) => makeDraft(String(p.text || "").slice(0, 1000), p.image)));
    drafts.push(...part);
  }
  const queue = loadPending();
  if (forgotten(queue)) return askKeepOld(queue, drafts);
  const open = queue.find((x) => x.batch);
  for (const d of drafts) d.batch = open ? open.batch : batch;
  markGroupAsk(drafts);
  queue.push(...drafts);
  savePending(queue);
  const todo = queue.filter((x) => x.batch && batchMissing(x).length).length;
  const ready = queue.filter((x) => x.batch).length - todo;
  const lead = `📸 Got ${drafts.length} photos${open ? " more" : ""}.${ready ? ` ${ready} ready` : ""}${ready && todo ? "," : ""}${todo ? ` ${todo} need${todo === 1 ? "s" : ""} a detail or two. Let's go 👇` : ""}\n\n`;
  return batchNext(queue, lead);
}

// ---- One question for the whole batch: "Are they all perfume?" ----
// Asked before the per-photo questions when the bot isn't sure what some photos are. The guess
// is what most photos look like; one tap sets the section for all of them.
const GROUP_WORD = { Clothing: "clothes", Fragrances: "perfume", Footwear: "shoes", Accessories: "accessories" };
const GROUP_ROWS = Object.entries(GROUP_WORD).map(([c, w]) => ({ id: `All ${w}`, title: `All ${w}` })).concat([{ id: "Mixed", title: "🔀 Mixed, ask each" }]);
function markGroupAsk(list) {
  if (list.length > 1 && list.some((x) => !x.sure)) for (const x of list) x.groupAsk = true;
}
function groupGuess(items) {
  const count = {};
  for (const x of items) count[x.listing.category] = (count[x.listing.category] || 0) + (x.sure ? 2 : 1); // sure ones count double
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
}
function groupQuestion(items, lead = "") {
  const guess = groupGuess(items);
  const g = GROUP_WORD[guess];
  return {
    reply: `${lead}🗂️ Are they all *${g}*?\n(${items.length} photos)`,
    buttons: [`✅ All ${g}`, "🔀 Mixed", "🗂️ Something else"],
  };
}
function groupAnswer(queue, items, t) {
  let m;
  const word = (m = /^(?:yes,?\s*)?all\s+(.+)$/i.exec(t)) ? m[1].trim().toLowerCase() : null;
  if (word) {
    const cat = Object.keys(GROUP_WORD).find((c) => GROUP_WORD[c] === word) || categoryAnswer(word);
    if (!cat) return { reply: "Which section are they all in?", list: { button: "Choose", rows: GROUP_ROWS } };
    for (const x of items) {
      delete x.groupAsk;
      const l = x.listing;
      if (l.category !== cat) { l.category = cat; l.subcategory = findSubcategory(`${l.caption || ""} ${l.name}`, cat); }
      x.sure = true;
    }
    savePending(queue);
    return batchNext(queue, `👍 All ${GROUP_WORD[cat]}.\n\n`);
  }
  if (/^(mixed|mix|mixed,? ask each|no)$/i.test(t)) {
    for (const x of items) delete x.groupAsk;
    savePending(queue);
    return batchNext(queue, "👍 I'll check each one.\n\n");
  }
  if (/^(something else|other|else)$/i.test(t)) return { reply: "🗂️ Which section are they all in?", list: { button: "Choose", rows: GROUP_ROWS } };
  if (/^(yes|y|haan|ha|ji|ok)$/i.test(t)) return groupAnswer(queue, items, `all ${GROUP_WORD[groupGuess(items)]}`);
  const cat = categoryAnswer(t); // "perfume" on its own = all perfume
  if (cat) return groupAnswer(queue, items, `all ${GROUP_WORD[cat]}`);
  const q = groupQuestion(items);
  return { ...q, reply: `First, one quick question for all ${items.length} photos.\n\n${q.reply}` };
}

// What a batch photo still needs, in the order it's asked.
function batchMissing(item) {
  const l = item.listing;
  return [
    (!l.name || l.name === "New arrival") && "name",
    !l.price && "price",
    needsSize(l) && "size",
    !item.sure && "section",
  ].filter(Boolean);
}
const PLURAL = { Clothing: ["piece of clothing", "clothes"], Fragrances: ["perfume", "perfumes"], Footwear: ["pair of shoes", "shoes"], Accessories: ["accessory", "accessories"] };
const absolute = (img) => (img && siteUrl() && img.startsWith("/") ? siteUrl() + img : img);

// The next batch question, or the summary when nothing is missing.
function batchNext(queue, lead = "") {
  const items = queue.filter((x) => x.batch);
  if (!items.length) return null;
  if (items.some((x) => x.groupAsk)) return groupQuestion(items, lead);
  const todo = items.filter((x) => batchMissing(x).length);
  if (!todo.length) return batchSummary(items, lead);
  const item = todo[0];
  const need = batchMissing(item);
  const l = item.listing;
  const n = items.indexOf(item) + 1;
  const sizeHint = l.category === "Clothing" ? " M L" : "";
  const what = `${SECTION_LABEL[l.category]}${item.sure ? "" : "?"}`;
  let ask, buttons = ["⏭️ Skip", "🗂️ Wrong section"];
  if (need.includes("name")) {
    // Examples fit the section once it's known (e.g. after "All perfume").
    const EG = { Clothing: ["Zara jacket", " 2499 M L"], Fragrances: ["Dior Sauvage", " 3200"], Footwear: ["Nike Air Max", " 4500 UK 9"], Accessories: ["Casio watch", " 1800"] };
    const eg = item.sure ? EG[l.category] : null;
    const wantPrice = need.includes("price");
    const egText = eg ? `*${eg[0]}${wantPrice ? eg[1] : ""}*` : wantPrice ? "*Dior Sauvage 3200* or *Zara jacket 2499 M L*" : "*Dior Sauvage* or *Zara jacket*";
    ask = `${wantPrice ? "What is it, and the price?" : `What is it? (${rupees(l.price)})`}\ne.g. ${egText}`;
  } else if (need.includes("price")) {
    ask = `*${l.name}* · ${what}\nSend the price${need.includes("size") ? " and sizes" : ""}, e.g. *2499${sizeHint}*`;
  } else if (need.includes("size")) {
    ask = `*${l.name}* · ${rupees(l.price)}\nWhich sizes? e.g. *M L XL* or *free size*`;
  } else {
    ask = `*${l.name}* · ${rupees(l.price)}\nIs it *${SECTION_LABEL[l.category]}*?`;
    buttons = ["✅ Yes", "🗂️ Wrong section", "⏭️ Skip"];
  }
  item.ask = "batch";
  savePending(queue);
  return { reply: `${lead}🖼️ Photo ${n} of ${items.length}\n${ask}`, buttons, photo: absolute(item.image) };
}

function batchSummary(items, lead = "") {
  for (const x of items) tidyListing(x.listing);
  const counts = {};
  for (const x of items) counts[x.listing.category] = (counts[x.listing.category] || 0) + 1;
  const mix = Object.entries(counts).map(([c, k]) => `${k} ${(PLURAL[c] || [c, c])[k === 1 ? 0 : 1]}`).join(" · ");
  const lines = items.map((x, i) => `${i + 1}. ${x.listing.name} · ${rupees(x.listing.price)}${x.listing.sizes ? ` · ${x.listing.sizes}` : ""}${(x.listing.quantity || 1) > 1 ? ` · ×${x.listing.quantity}` : ""}`);
  return {
    reply: `${lead}✅ *${items.length} ready to post*\n${mix}\n\n${lines.join("\n")}\n\nPost them all now, or check each one first?`,
    buttons: ["✅ Post all", "👀 Check each", "❌ Cancel all"],
  };
}

// Reads a short batch answer: "Zara jacket 2499 m l x2", "3200", "32 34", "free size".
function readAnswer(text) {
  let t = ` ${String(text).trim()} `;
  const out = {};
  let m;
  if ((m = /\s(?:x\s?(\d{1,3})|(\d{1,3})\s?(?:pcs?|pieces?|nos))(?=\s)/i.exec(t))) { out.quantity = Number(m[1] || m[2]); t = t.replace(m[0], " "); }
  if ((m = /\smrp\s*[:=]?\s*(?:₹|rs\.?)?\s*([\d,]{2,9})(?=\s)/i.exec(t))) { out.mrp = Number(m[1].replace(/,/g, "")); t = t.replace(m[0], " "); }
  // The price: a ₹/rs amount, else the LAST plain number ("Levis 501 1899" -> 1899).
  const money = [...t.matchAll(/\s(?:(?:₹|rs\.?)\s*([\d,]{2,9})|([\d,]{3,9}))(?:\s*\/-)?(?=\s)/gi)];
  if ((m = money.find((x) => x[1]) || money[money.length - 1])) { const n = Number((m[1] || m[2]).replace(/,/g, "")); if (n >= 10) { out.price = n; t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length); } }
  if ((m = /\s(?:sizes?\s*[:=]?\s*)?((?:(?:xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|\d{2}|uk\s?\d{1,2})(?:[\s,\/&]+|$))+|free\s?size|one\s?size)\s*$/i.exec(t))) {
    out.sizes = formatSizes(m[1]); t = t.slice(0, m.index) + " ";
  }
  const name = t.replace(/\s+/g, " ").replace(/^[\s,.\-–:]+|[\s,.\-–:]+$/g, "").trim();
  if (/\p{L}{2}/u.test(name)) out.name = name;
  return out;
}

// The owner's reply while a batch is open. Returns { reply, ... } or null (not about the batch).
function batchReply(text) {
  const queue = loadPending();
  const items = queue.filter((x) => x.batch);
  if (!items.length) return null;
  const raw = text.trim();
  const t = raw.replace(/^[^\p{L}\p{N}₹]+/u, "").trim();
  if (items.some((x) => x.groupAsk)) return groupAnswer(queue, items, t);
  const dropImage = (x) => { if (x.image) try { fs.unlinkSync(path.join(UPLOADS, path.basename(x.image))); } catch { /* gone */ } };
  const todo = items.filter((x) => batchMissing(x).length);

  if (/^cancel all$/i.test(t)) {
    items.forEach(dropImage);
    savePending(queue.filter((x) => !x.batch));
    return { reply: `🗑️ Dropped all ${items.length} photos. Nothing went on the website.` };
  }
  if (!todo.length) {
    if (/^post all$/i.test(t)) {
      const live = items.map((x) => publish({ id: x.id, listing: x.listing, by: x.by, image: x.image }));
      savePending(queue.filter((x) => !x.batch));
      let win;
      for (const p of live) win = celebrate(p);
      const codes = live.map((p) => `🔢 *${p.code}* ${p.name}`).join("\n");
      return {
        reply: `🎉 *${live.length === 2 ? "Both are" : `All ${live.length} are`} live on your website!*\n\n${codes}\n\nWhen one sells, just send *sold* and its code, like *sold ${live[0].code}*.\n\n📈 ${win.postedToday} posted today · 🛍️ ${win.live} live${win.milestone ? `\n${win.milestone}` : ""}`,
        celebrate: { ...win, name: `${live.length} new items`, image: live[0].image },
      };
    }
    if (/^check each$/i.test(t)) {
      for (const x of items) { delete x.batch; x.ask = null; }
      savePending(queue);
      return step(queue[0], { fresh: true });
    }
    return { ...batchSummary(items), reply: `Tap *Post all* to put them all live, or *Check each* to look at them one by one.` };
  }

  const item = todo[0];
  const l = item.listing;
  if (/^(post all|check each)$/i.test(t)) {
    const again = batchNext(queue);
    return { ...again, reply: `${todo.length} still need${todo.length === 1 ? "s" : ""} a detail first.\n\n${again.reply}` };
  }
  if (/^skip$/i.test(t)) {
    dropImage(item);
    const rest = queue.filter((x) => x !== item);
    savePending(rest);
    return batchNext(rest, `⏭️ Skipped that one.\n\n`) || { reply: "⏭️ Skipped. Nothing left to post." };
  }
  if (/^(wrong section|section)$/i.test(t)) {
    item.ask = "batch-section";
    savePending(queue);
    return { reply: `🗂️ Which section is *${l.name === "New arrival" ? `photo ${items.indexOf(item) + 1}` : l.name}*?`, list: { button: "Choose section", rows: SECTION_ROWS } };
  }
  if (item.ask === "batch-section" || (/^yes$/i.test(t) && batchMissing(item).join() === "section")) {
    if (/^yes$/i.test(t)) item.sure = true;
    else if (!answer(item, "section", t)) return { reply: "🗂️ Tap one of the sections.", list: { button: "Choose section", rows: SECTION_ROWS } };
    item.ask = "batch";
    savePending(queue);
    return batchNext(queue);
  }
  // A real command ("sold 4795", "help") isn't an answer.
  const looks = parseMessage(raw);
  if (looks.type !== "product") return null;
  const a = readAnswer(t);
  let used = false;
  if (a.price) { l.price = a.price; used = true; }
  if (a.mrp) { l.mrp = a.mrp; used = true; }
  if (a.quantity) { l.quantity = a.quantity; used = true; }
  if (a.sizes) { l.sizes = a.sizes; used = true; }
  if (a.name && (l.name === "New arrival" || !l.name)) {
    const named = parseMessage(a.name).product;
    l.name = named.name !== "New arrival" ? named.name : a.name;
    if (named.brand && !l.brand) l.brand = named.brand;
    if (!item.sure && parseMessage(a.name).sure) { l.category = named.category; l.subcategory = named.subcategory; item.sure = true; }
    used = true;
  }
  if (!used) {
    const again = batchNext(queue);
    return { ...again, reply: `Hmm, I didn't get that.\n\n${again.reply}` };
  }
  savePending(queue);
  return batchNext(queue, "👍 Got it.\n\n");
}

// ---- Check before it goes live ----
// Every post waits as a draft until the owner says "done". He sees name, price, quantity and
// section, and can change any of them first. Drafts are not on the website.
const SECTION_LABEL = { Clothing: "Clothes", Fragrances: "Perfume", Footwear: "Shoes", Accessories: "Accessory" };
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

// ---- Guided posting: one short question at a time, only for what's missing ----
// Photo in -> (section? name? price? size?) -> preview -> "✅ Post it". Every answer is a tap
// or a plain value ("2499", "M L XL", "Zara denim jacket"); the old "price 2999" style still works.
const SECTION_ROWS = [
  { id: "Clothes", title: "👕 Clothes" }, { id: "Shoes", title: "👟 Shoes" },
  { id: "Perfume", title: "🧴 Perfume" }, { id: "Accessory", title: "👜 Accessory" },
];
const PREVIEW_BUTTONS = ["✅ Post it", "✏️ Change", "❌ Cancel"];
const FIELDS = {
  name: { label: "Name", ask: "🏷️ What's it called?\nType the name, e.g. *North Face Puffer Jacket*" },
  price: { label: "Price", ask: "💰 What's the price?\nJust type the number, e.g. *2499*" },
  qty: { label: "Quantity", ask: "📦 How many pieces do you have?", buttons: ["1", "2", "3"] },
  size: { label: "Size", ask: "📏 Which sizes do you have?\nType them, e.g. *M L XL* or *32 34*", buttons: ["Free size"] },
  section: { label: "Section", ask: "🗂️ Which section does it go in?", list: { button: "Choose section", rows: SECTION_ROWS } },
  brand: { label: "Brand", ask: "✨ Which brand?\nType it, e.g. *Zara*" },
  mrp: { label: "MRP", ask: "🏷️ What's the MRP (original price)?\nJust type the number, e.g. *6999*" },
};
// The first thing still missing, in the order the owner is asked.
function missingField(item) {
  const l = item.listing;
  if (!item.sure) return "section";
  if (!l.name || l.name === "New arrival") return "name";
  if (!l.price) return "price";
  if (needsSize(l)) return "size";
  return null;
}
// Name examples that fit the section once it's known.
const NAME_EG = { Clothing: "North Face Puffer Jacket", Fragrances: "Dior Sauvage EDT", Footwear: "Nike Air Max 90", Accessories: "Casio G-Shock watch" };
function question(item, field, lead = "") {
  const f = FIELDS[field];
  item.ask = field;
  let ask = f.ask;
  if (field === "name") {
    const c = item.listing.category;
    ask = `🏷️ What's it called?\nType the name, e.g. *${(item.sure && NAME_EG[c]) || "Dior Sauvage EDT"}*${c === "Fragrances" ? "\n(Bottle size like *100 ml* is fine too.)" : ""}`;
  }
  const out = { reply: `${lead}${ask}`, buttons: f.buttons, list: f.list };
  if (!f.buttons && !f.list) out.buttons = ["❌ Cancel"];
  return out;
}
function preview(item, lead = "") {
  const l = item.listing;
  const section = [SECTION_LABEL[l.category], l.subcategory && l.subcategory !== "Perfume" ? l.subcategory : null].filter(Boolean).join(" › ");
  const lines = [
    `*${l.name}*`,
    l.brand ? `✨ ${l.brand}` : null,
    `💰 ${rupees(l.price)}${l.mrp ? ` ~MRP ${rupees(l.mrp)}~` : ""}`,
    l.sizes ? `📏 ${l.sizes}` : null,
    `📦 ${l.quantity || 1} ${(l.quantity || 1) > 1 ? "pieces" : "piece"}`,
    `🗂️ ${section}`,
  ].filter(Boolean);
  item.ask = null;
  return { reply: `${lead}👀 This is how it will look on your website:\n\n${lines.join("\n")}${item.note ? `\n\nℹ️ ${item.note}` : ""}\n\nPost it?`, buttons: PREVIEW_BUTTONS };
}
// Whatever comes next for this draft: the next question, or the preview.
function step(item, { fresh = false, changed = false } = {}) {
  tidyListing(item.listing);
  const need = missingField(item);
  const lead = fresh ? `📸 Got it${item.listing.name !== "New arrival" ? `: *${item.listing.name}*` : ""}!\n\n` : changed ? "✏️ Updated.\n\n" : "";
  const out = need ? question(item, need, lead) : preview(item, lead);
  savePending(loadPending().map((x) => (x.id === item.id ? item : x)));
  return out;
}
const changeMenu = (l) => ({
  reply: `✏️ What do you want to change on “${l.name}”?`,
  list: { button: "Choose", rows: [
    { id: "Name", title: "🏷️ Name", description: l.name },
    { id: "Price", title: "💰 Price", description: l.price ? rupees(l.price) : "not set" },
    { id: "Quantity", title: "📦 Quantity", description: String(l.quantity || 1) },
    { id: "Size", title: "📏 Size", description: l.sizes || "not set" },
    { id: "Section", title: "🗂️ Section", description: SECTION_LABEL[l.category] || "" },
    { id: "Brand", title: "✨ Brand", description: l.brand || "not set" },
    { id: "MRP", title: "🏷️ MRP", description: l.mrp ? rupees(l.mrp) : "not set" },
  ] },
});
const FIELD_PICK = { name: "name", price: "price", quantity: "qty", qty: "qty", size: "size", sizes: "size", section: "section", category: "section", brand: "brand", mrp: "mrp" };
const money = (t) => { const m = /^(?:₹|rs\.?)?\s*([\d,]{2,9})(?:\s*\/-)?$/i.exec(t.trim()); const n = m && Number(m[1].replace(/,/g, "")); return n >= 10 ? n : null; };
// The owner's answer to the question the bot just asked. Returns true if it fitted.
function answer(item, field, t) {
  const l = item.listing;
  if (field === "price") { const n = money(t); if (!n) return false; l.price = n; return true; }
  if (field === "mrp") { const n = money(t); if (!n) return false; l.mrp = n; return true; }
  if (field === "qty") { const m = /^(\d{1,3})(?:\s*(?:pcs?|pieces?|nos))?$/i.exec(t); if (!m || !Number(m[1])) return false; l.quantity = Number(m[1]); return true; }
  if (field === "section") {
    const c = categoryAnswer(t);
    if (!c) return false;
    l.category = c;
    l.subcategory = findSubcategory(`${l.caption || ""} ${l.name}`, c);
    item.sure = true;
    return true;
  }
  if (field === "size") { if (t.length > 40) return false; l.sizes = formatSizes(t); return true; }
  if (field === "name") { if (t.length < 2 || t.length > 80) return false; l.name = t; return true; }
  if (field === "brand") { if (t.length < 2 || t.length > 40) return false; l.brand = t; return true; }
  return false;
}
const NOT_UNDERSTOOD = {
  price: "💰 I need just the number, e.g. *2499*.",
  mrp: "🏷️ I need just the number, e.g. *6999*.",
  qty: "📦 Send a number, e.g. *2*.",
  section: "🗂️ Tap one of the sections below.",
  size: "📏 Type the sizes, e.g. *M L XL*.",
  name: "🏷️ Type a short name, e.g. *Zara Denim Jacket*.",
  brand: "✨ Type a short brand name, e.g. *Zara*.",
};

const DONE = /^(✅\s*)?(done|ok|okay|yes|y|post|post it|go|live|send|haan|han|ha|ji|theek|thik|sahi|correct|right|👍)[.!]*$/i;
const CANCEL = /^(❌\s*)?(cancel|no|drop|discard|delete|nahi|nah)[.!]*$/i;
const CHANGE = /^(✏️\s*)?(change|edit|fix)[.!]*$/i;

// The owner's reply while a draft is open. Returns { reply, buttons?, list? } or null (not about the draft).
function draftReply(text, hasImage) {
  if (hasImage) return null; // a new photo is a new post: it queues behind this one
  const raw = text.trim();
  const t = raw.replace(/^[^\p{L}\p{N}₹]+/u, "").trim(); // "👕 Clothes" -> "Clothes"
  const queue = loadPending();
  const item = queue[0];
  // "pirce 3,000" -> "price 3,000": fix the edit word, keep the value.
  const [first, ...rest] = t.split(/\s+/);
  const kind = rest.length ? editWord(first.replace(/[:=\-]+$/, "")) : null;
  const e = kind ? `${kind} ${rest.join(" ")}` : t;
  if (!item) {
    if (DONE.test(raw) || CANCEL.test(raw) || CHANGE.test(raw) || (kind && (kind === "name" || /^[₹\d,.\/-]+$/.test(rest.join(""))))) return { reply: "Nothing is waiting right now. 📸 Send a product photo to put it on your website." };
    return null;
  }
  const l = item.listing;
  const nextUp = (out) => {
    if (!queue.length) return out;
    const n = step(queue[0], { fresh: true });
    return { ...n, reply: `${out.reply}\n\n—\n\n${n.reply}` };
  };

  if (DONE.test(raw)) {
    const need = missingField(item);
    if (need) { const out = step(item); return { ...out, reply: `Almost there! ${out.reply}` }; }
    queue.shift();
    savePending(queue);
    const product = publish({ id: item.id, listing: l, by: item.by, image: item.image });
    const win = celebrate(product);
    return { ...nextUp({ reply: liveReply(product, win) }), product, celebrate: win };
  }
  if (CANCEL.test(raw)) {
    queue.shift();
    savePending(queue);
    if (item.image) { try { fs.unlinkSync(path.join(UPLOADS, path.basename(item.image))); } catch { /* already gone */ } }
    return nextUp({ reply: `🗑️ Dropped “${l.name}”. Nothing went on the website.` });
  }
  if (CHANGE.test(raw)) { item.ask = null; savePending(queue); return changeMenu(l); }
  // Picked a field from the Change menu (or typed just "price").
  const pick = FIELD_PICK[t.toLowerCase()];
  if (pick && !(item.ask === "name" || item.ask === "brand")) {
    const out = question(item, pick);
    item.fromChange = true;
    savePending(queue);
    return out;
  }
  // The answer to the question just asked.
  // ("Prince jacket" as a name is an answer, not a mistyped "price".)
  const isEdit = kind && (["name", "brand", "size"].includes(kind) || /^[₹\d,.\/-]+$/.test(rest.join("")));
  if (item.ask && !isEdit) {
    const changed = Boolean(item.fromChange);
    if (answer(item, item.ask, t)) { delete item.fromChange; return step(item, { changed }); }
    const f = FIELDS[item.ask];
    return { reply: `Hmm, I didn't get that. ${NOT_UNDERSTOOD[item.ask]}`, buttons: f.buttons || ["❌ Cancel"], list: f.list };
  }

  // Shortcuts that still work any time: "price 2999", "qty 3", "M L", "perfume", "2499".
  const word = /^\D+$/.test(t) ? categoryAnswer(t) : null;
  if (word) { answer(item, "section", t); return step(item, { changed: true }); }
  if (SIZE_ONLY.test(t) && (l.category === "Clothing" || !/^\d{2}$/.test(t))) { l.sizes = formatSizes(t); return step(item, { changed: true }); }
  let m;
  if ((m = /^(?:price|rate|rs\.?|₹)\s*[:=\-]?\s*(?:₹|rs\.?)?\s*([\d,]{2,9})(?:\s*\/-)?$/i.exec(e)) || (m = /^(?:₹|rs\.?)?\s*([\d,]{3,9})(?:\s*\/-)?$/i.exec(e))) {
    const n = Number(m[1].replace(/,/g, ""));
    if (n >= 10) { l.price = n; return step(item, { changed: true }); }
  }
  if ((m = /^mrp\s*[:=\-]?\s*(?:₹|rs\.?)?\s*([\d,]{2,9})$/i.exec(e))) { l.mrp = Number(m[1].replace(/,/g, "")); return step(item, { changed: true }); }
  if ((m = /^(?:qty|quantity|stock|pcs|pieces|nos)\s*[:=\-]?\s*(\d{1,3})$/i.exec(e)) || (m = /^(\d{1,3})\s*(?:pcs|pc|pieces|piece|nos|qty)$/i.exec(e)) || (m = /^[x×]\s*(\d{1,3})$/i.exec(e))) {
    const n = Number(m[1]);
    if (n > 0) { l.quantity = n; return step(item, { changed: true }); }
  }
  if ((m = /^name\s*[:=\-]?\s+(.{2,80})$/i.exec(e))) { l.name = m[1].trim(); return step(item, { changed: true }); }
  if ((m = /^brand\s*[:=\-]?\s+(.{2,40})$/i.exec(e))) { l.brand = m[1].trim(); return step(item, { changed: true }); }
  if ((m = /^sizes?\s*[:=\-]?\s+(.{1,40})$/i.exec(e))) { l.sizes = formatSizes(m[1]); return step(item, { changed: true }); }
  // Looks like a new product typed out (words and a price)? Queue it behind this one.
  const looks = parseMessage(t);
  if (!kind && looks.type === "product" && looks.product.price && looks.product.name !== "New arrival") {
    const id = crypto.randomBytes(6).toString("hex");
    queue.push({ id, listing: looks.product, note: null, by: "rules", image: null, sure: looks.sure, guess: looks.product.category });
    savePending(queue);
    return { reply: `📝 Got “${looks.product.name}” too. I'll ask about it after “${l.name}”.`, buttons: PREVIEW_BUTTONS };
  }
  const out = preview(item, `🤔 I didn't get that. Tap a button below, or tap *Change* to fix something.\n\n`);
  savePending(queue);
  return out;
}

function publish({ id, listing, by, image }) {
  tidyListing(listing);
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
  const live = load().filter((p) => isPublic(p) && p.status !== "sold").length;
  const streak = streakDays(acts);
  let milestone = null;
  if ([5, 10, 20, 30, 50].includes(postedToday)) milestone = `🔥 ${postedToday} drops today. You're on fire!`;
  else if (live % 25 === 0) milestone = `🏆 ${live} pieces live on your website!`;
  else if (postedToday === 1) milestone = "🌅 First drop of the day!";
  else if (postedToday === 3) milestone = "⚡ 3 drops today. Keep them coming!";
  return { name: product.name, code: product.code, image: product.image, postedToday, live, streak, milestone };
}

function liveReply(product, win) {
  const shelf = [SECTION_LABEL[product.category] || product.category, product.subcategory && product.subcategory !== "Perfume" ? product.subcategory : null].filter(Boolean).join(" › ");
  const bits = [rupees(product.price), product.sizes, shelf].filter(Boolean).join(" · ");
  const score = [`📈 ${win.postedToday} posted today`, win.streak > 1 ? `🔥 ${win.streak}-day streak` : null, `🛍️ ${win.live} live`].filter(Boolean).join(" · ");
  const two = product.quantity > 1 ? ` (*sold ${product.code} 2* for two)` : "";
  return `🎉 *It's live on your website!*\n*${product.name}*\n${bits}\n\n🔢 Code *${product.code}* · ${product.quantity} in stock\nWhen one sells, just send *sold ${product.code}*${two}.\n\n${score}${win.milestone ? `\n${win.milestone}` : ""}\n\n📸 Send the next photo whenever you're ready.`;
}

// ---- Real recent sales for the shop's "just sold" note (public: item and time only, no buyer) ----
function recentSales() {
  const byId = new Map(load().filter(isPublic).map((p) => [p.id, p]));
  const since = Date.now() - 72 * 3600e3;
  return loadActivity()
    .filter((a) => a.type === "sold" && new Date(a.at) > since && byId.has(a.id))
    .slice(-10).reverse()
    .map((a) => { const p = byId.get(a.id); return { id: p.id, name: p.name, image: p.image || null, qty: a.qty || 1, at: a.at }; });
}

// ---- Numbers for the owner: the stats bar on /demo, and the "stats" chat command ----
function stats() {
  const items = load().filter(isPublic);
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
    // From the bills, so a cancelled bill comes off again.
    soldToday: billing.today().pieces,
    salesToday: billing.today().total,
    billsToday: billing.today().bills,
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
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Same order as the strip on /demo: stock first, then what happened today.
  const sec = Object.entries(s.sections).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${SECTION_LABEL[k] || k} *${v}*`).join(" · ");
  const shop = [
    `📦 In stock: *${s.units}* pcs`,
    `💎 Worth: *${inr(s.stockValue)}*`,
    `⏳ Last piece: *${s.lastOne}*`,
    `✔️ Sold out: *${s.soldOut}*`,
    `🔥 Streak: *${plural(s.streak, "day", "days")}*`,
  ];
  const today = [
    `🛍️ Live on site: *${s.live}*`,
    `📈 Posted today: *${s.postedToday}*`,
    `💸 Sold today: *${s.soldToday}*${s.salesToday ? ` · ${inr(s.salesToday)}` : ""}`,
    `💰 Orders to check: *${s.ordersToCheck}*${s.ordersToCheck ? " ⚠️" : ""}`,
    `💬 Enquiries today: *${s.enquiriesToday}*`,
    s.drafts ? `📝 Waiting for done: *${s.drafts}*` : null,
  ].filter(Boolean);
  return `📊 *Your shop right now*\n\n${shop.join("\n")}${sec ? `\n\n${sec}` : ""}\n\n*Today*\n${today.join("\n")}`;
}

// The ledger link a party can open. Same numbers as the shop sees, read-only.
function ledgerPage({ party, rows, balance }) {
  const sign = party.type === "supplier" ? -1 : 1, b = balance * sign;
  const body = rows.slice().reverse().map((r) => `<tr><td>${escHtml(r.day)}</td><td>${escHtml(r.kind)}<small>${escHtml(r.ref)}</small></td><td class="n">${r.amount * sign > 0 ? "+" : "−"}${inr(Math.abs(r.amount))}</td><td class="n">${inr(r.balance * sign)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Statement · ${escHtml(SHOP.name)}</title>
<style>body{margin:0;background:#f3f1ec;color:#16130f;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.s{max-width:720px;margin:16px auto;background:#fff;padding:20px;border-radius:8px}h1{font-size:20px;margin:0}.b{font-size:24px;font-weight:800;margin:12px 0}table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid #e3ded5;text-align:left;vertical-align:top}th{font-size:12px;color:#6b665e}.n{text-align:right;white-space:nowrap}small{display:block;color:#6b665e;font-size:12px}p{color:#6b665e;margin:2px 0}</style></head>
<body><div class="s"><h1>${escHtml(party.name)}</h1><p>Statement from ${escHtml(SHOP.business?.legalName || SHOP.name)}</p>
<div class="b">${b > 0 ? `Balance due: ${inr(b)}` : b < 0 ? `Credit: ${inr(-b)}` : "All settled"}</div>
<table><thead><tr><th>Date</th><th>Entry</th><th class="n">Amount</th><th class="n">Balance</th></tr></thead><tbody>${body || `<tr><td colspan="4">No entries yet.</td></tr>`}</tbody></table>
${b > 0 && SHOP.pay?.upiId ? `<p style="margin-top:12px">Pay on UPI: ${escHtml(SHOP.pay.upiId)}</p>` : ""}</div></body></html>`;
}

// Evening WhatsApp: items that sold today and are now running low. Once a day, around 8 pm.
function lowStockDigest() {
  const now = new Date(), hour = Number(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
  const day = shopDay(now);
  if (hour < 20 || books.getSetting("lowDigestDay") === day) return;
  books.setSetting("lowDigestDay", day);
  const byId = new Map(load().map((p) => [p.id, p.code]));
  const sold = new Set(loadActivity().filter((a) => a.type === "sold" && shopDay(a.at) === day).map((a) => byId.get(a.id)));
  const text = reports.lowText({ onlyToday: true, soldToday: sold });
  if (text) sendToOwner({ id: crypto.randomBytes(6).toString("hex"), at: now.toISOString(), kind: "low-stock", summary: { kind: "low stock", ref: "today" }, text });
}
if (LIVE) setInterval(() => { try { lowStockDigest(); } catch (e) { console.warn("low stock digest:", e.message); } }, 10 * 60e3).unref();

// ---- Billing portal API (owner key) ----
// Staff logins never receive cost prices.
const noCost = (p) => { const c = { ...p }; delete c.cost; delete c.supplierId; return c; };
const billForStaff = (x) => ({ ...x, lines: x.lines.map(({ cost, ...l }) => l) });
const BILL_FIELDS = ["headerLine", "terms", "email", "youtube", "theme"];
async function billingApi(req, res, route, url, who = { role: "owner" }) {
  const body = async () => { try { return JSON.parse((await readBody(req, 64 * 1024)) || "{}"); } catch { return null; } };
  const reply = (r) => (r.error ? send(res, 409, { error: r.error }) : send(res, 200, r));
  const post = req.method === "POST", get = req.method === "GET";
  if (get && route === "me") return send(res, 200, { role: who.role, name: who.name });
  if (get && route === "products") return send(res, 200, who.role === "staff" ? load().map(noCost) : load());
  if (post && route === "items") { const b = await body(); return b ? reply(billing.saveItem(b, null, newCode)) : send(res, 400, { error: "Bad request." }); }
  let im = /^items\/([\w-]{1,40})$/.exec(route);
  if (post && im) { const b = await body(); return b ? reply(billing.saveItem(b, im[1], newCode)) : send(res, 400, { error: "Bad request." }); }
  if (post && route === "link") { const b = await body(); return b ? reply(documents.linkItem(b)) : send(res, 400, { error: "Bad request." }); }
  if (post && route === "barcodes") { const b = await body(); return b ? reply(billing.giveBarcodes(Array.isArray(b.ids) ? b.ids.slice(0, 500) : [])) : send(res, 400, { error: "Bad request." }); }
  if (get && route === "staff") return send(res, 200, staff.list());
  if (post && route === "staff") { const b = await body(); return b ? reply(staff.add(b)) : send(res, 400, { error: "Bad request." }); }
  im = /^staff\/([a-f0-9]{16})\/remove$/.exec(route);
  if (post && im) return reply(staff.remove(im[1]));
  if (get && route === "settings") return send(res, 200, { ...Object.fromEntries(BILL_FIELDS.map((k) => [k, SHOP.billing[k] ?? ""])), logo: SHOP.billing.logo || "", gstin: SHOP.business.gstin || "", ai: aiEnabled() });
  if (post && route === "settings") {
    let b; try { b = JSON.parse((await readBody(req, 4 * 1024 * 1024)) || "{}"); } catch { return send(res, 400, { error: "Bad request." }); }
    const next = { ...(books.getSetting("billSettings") || {}) };
    for (const k of BILL_FIELDS) if (typeof b[k] === "string") next[k] = b[k].trim().slice(0, 300);
    if (b.logoData) { const saved = saveImage(b.logoData, `logo-${Date.now()}`); if (!saved) return send(res, 400, { error: "The logo must be a JPEG, PNG or WebP image." }); next.logo = saved; }
    if (typeof b.gstin === "string") {
      const g = b.gstin.trim().toUpperCase();
      if (g && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(g)) return send(res, 409, { error: "That GSTIN doesn't look right (15 characters)." });
      books.setSetting("gstin", g); SHOP.business.gstin = g;
    }
    books.setSetting("billSettings", next);
    Object.assign(SHOP.billing, next);
    return send(res, 200, { ok: true });
  }
  if (post && route === "purchases/scan") {
    if (!aiEnabled()) return send(res, 503, { error: "Bill scanning needs an Anthropic API key on the server. Enter this bill by hand for now." });
    let b; try { b = JSON.parse(await readBody(req, 10 * 1024 * 1024)); } catch { return send(res, 400, { error: "That photo is too large." }); }
    try {
      const bill = await readPurchaseBill(b.image);
      const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const items = load();
      bill.lines = bill.lines.map((l) => { const m = items.find((p) => norm(p.name) === norm(l.name)); return { ...l, productId: m?.id || null, matched: m?.name || null }; });
      return send(res, 200, bill);
    } catch (e) { return send(res, 502, { error: `Couldn't read that bill (${e.message}). Enter it by hand.` }); }
  }
  im = /^parties\/([a-f0-9]{16})\/share$/.exec(route);
  if (post && im) { const b = await body(); return reply(books.shareLedger(im[1], b?.on !== false)); }
  // Importing the myBillBook stock file. Preview unless apply=1; a copy is kept before applying.
  if (post && route === "import") {
    let csv;
    try { csv = await readBody(req, 5 * 1024 * 1024); } catch { return send(res, 413, { error: "File too large." }); }
    const before = load();
    const r = stockImport.plan(String(csv), before, { newCode, refreshStock: url.searchParams.get("refreshStock") === "1" });
    if (r.error) return send(res, 400, { error: r.error });
    if (url.searchParams.get("apply") !== "1") return send(res, 200, { preview: true, report: r.report });
    writeJson(path.join(STORE, `products-before-import-${Date.now()}.json`), before);
    save(r.items);
    return send(res, 200, { preview: false, report: r.report });
  }
  if (get && route === "dashboard") return send(res, 200, books.dashboard());
  if (get && route === "parties") return send(res, 200, who.role === "staff" ? books.partyList().map(({ shareToken, ...p }) => p) : books.partyList());
  if (post && route === "parties") { const b = await body(); return b ? reply(books.saveParty(b)) : send(res, 400, { error: "Bad request." }); }
  let m = /^parties\/([a-f0-9]{16})(\/ledger)?$/.exec(route);
  if (m && get && m[2]) return reply(books.ledger(m[1]));
  if (m && post && !m[2]) { const b = await body(); return b ? reply(books.saveParty(b, m[1])) : send(res, 400, { error: "Bad request." }); }
  if (get && route === "payments") return send(res, 200, books.payments.all().slice(-500).reverse());
  if (post && route === "payments") { const b = await body(); return b ? reply(books.addPayment(b)) : send(res, 400, { error: "Bad request." }); }
  if (get && route === "purchases") return send(res, 200, books.purchases.all().slice(-500).reverse());
  if (post && route === "purchases") { const b = await body(); return b ? reply(books.addPurchase(b)) : send(res, 400, { error: "Bad request." }); }
  if (get && route === "expenses") return send(res, 200, { list: books.expenses.all().slice(-500).reverse(), types: books.EXPENSE_TYPES });
  if (post && route === "expenses") { const b = await body(); return b ? reply(books.addExpense(b)) : send(res, 400, { error: "Bad request." }); }
  if (get && route === "returns") return send(res, 200, documents.returns.all().slice(-500).reverse());
  if (post && route === "returns") {
    const b = await body();
    if (!b) return send(res, 400, { error: "Bad request." });
    const run = { sale_return: documents.saleReturn, purchase_return: documents.purchaseReturn, credit_note: (x) => documents.note("credit_note", x), debit_note: (x) => documents.note("debit_note", x) }[b.kind];
    return run ? reply(run(b)) : send(res, 400, { error: "Pick a type." });
  }
  if (get && route === "docs") return send(res, 200, documents.docs.all().slice(-500).reverse());
  if (post && route === "dispatch") { const b = await body(); return b ? reply(documents.dispatchNote(b)) : send(res, 400, { error: "Bad request." }); }
  if (post && route === "docs") { const b = await body(); return b ? reply(documents.saveDoc(b)) : send(res, 400, { error: "Bad request." }); }
  let dm = /^(docs|returns)\/([a-f0-9]{16})\/(cancel|convert)$/.exec(route);
  if (dm && post) {
    if (dm[1] === "returns") return dm[3] === "cancel" ? reply(documents.cancelReturn(dm[2])) : send(res, 404, { error: "not found" });
    const b = (await body()) || {};
    return reply(dm[3] === "cancel" ? documents.cancelDoc(dm[2]) : documents.convertDoc(dm[2], b));
  }
  if (get && route === "orders") return send(res, 200, loadOrders().slice(-200).reverse().map(({ proof, ...o }) => o));
  const om2 = /^orders\/(VX-\d{4})\/(confirm|cancel)$/.exec(route);
  if (post && om2) { const text = orderCommand(`${om2[2]} ${om2[1]}`); return /^[✅❌]/.test(text) ? send(res, 200, { ok: true, text }) : send(res, 409, { error: text.replace(/\n[\s\S]*/, "") }); }
  if (get && route === "reports") return send(res, 200, reports.LIST);
  dm = /^reports\/([a-z0-9]+)(\.csv)?$/.exec(route);
  if (dm && get) {
    const rep = reports.run(dm[1], url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined);
    if (!rep) return send(res, 404, { error: "No such report." });
    if (!dm[2]) return send(res, 200, rep);
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vibex-${dm[1]}.csv"`, "Cache-Control": "no-store" });
    return res.end(reports.csv(rep));
  }
  if (get && route === "cash") return send(res, 200, books.cashbook());
  if (post && route === "cash/opening") { const b = await body(); return b ? reply(books.setOpening(b)) : send(res, 400, { error: "Bad request." }); }
  m = /^(payments|purchases|expenses)\/([a-f0-9]{16})\/cancel$/.exec(route);
  if (m && post) return reply({ payments: books.cancelPayment, purchases: books.cancelPurchase, expenses: books.cancelExpense }[m[1]](m[2]));
  if (get && route === "profit") return send(res, 200, books.profit(url.searchParams.get("from") || "0000-01-01", url.searchParams.get("to") || "9999-12-31"));
  if (req.method === "GET" && route === "invoices") {
    const list = billing.loadInvoices();
    if (who.role === "staff") return send(res, 200, { invoices: list.slice(-100).reverse().map(billForStaff), today: { bills: 0, total: 0, pieces: 0, byPayment: {} }, gst: billing.gstOn() });
    return send(res, 200, { invoices: list.slice(-500).reverse(), today: billing.today(), gst: billing.gstOn() });
  }
  if (req.method === "POST" && route === "invoices") {
    const b = await body();
    if (!b) return send(res, 400, { error: "Bad request." });
    let partyId = b.partyId || null;
    if (b.payment === "credit") {
      // Credit needs someone to owe it: a saved party, or a bill with a mobile number.
      partyId = partyId || books.customerFor(b.customer || {});
      if (!partyId) return send(res, 409, { error: "A credit bill needs the customer's name and mobile, so it can go in their ledger." });
      const total = (b.lines || []).reduce((n, l) => n + Number(l.price || 0) * Number(l.qty || 0) - Number(l.disc || 0), 0)
        + (b.charges || []).reduce((n, c) => n + Number(c.amount || 0), 0);
      const over = (who.role === "staff" || !b.overLimit) && books.creditCheck(partyId, total);
      if (over) return send(res, 409, { error: over, overLimit: true });
    }
    const r = billing.sell(b.lines, { source: "counter", customer: b.customer, payment: b.payment, note: b.note, partyId, charges: b.charges, allowShort: b.allowShort === true, by: who.role === "staff" ? who.name : undefined });
    if (r.error) return send(res, 409, { error: r.error });
    return send(res, 200, { invoice: who.role === "staff" ? billForStaff(r.invoice) : r.invoice, url: `/bill/${r.invoice.id}` });
  }
  const cm = /^invoices\/([a-f0-9]{16})\/cancel$/.exec(route);
  if (req.method === "POST" && cm) {
    const b = (await body()) || {};
    const r = billing.cancel(cm[1], b.reason);
    if (r.error) return send(res, 409, { error: r.error });
    // A cancelled website-order bill cancels the order too, so both stay in step.
    if (r.invoice.order) {
      const orders = loadOrders();
      const o = orders.find((x) => x.code === r.invoice.order);
      if (o && o.status !== "cancelled") { o.status = "cancelled"; o.invoice = null; saveOrders(orders); }
    }
    return send(res, 200, { invoice: r.invoice });
  }
  if (req.method === "POST" && route === "stock") {
    const b = await body();
    if (!b) return send(res, 400, { error: "Bad request." });
    const r = billing.adjust(String(b.productId || ""), { quantity: b.quantity, price: b.price });
    if (r.error) return send(res, 409, { error: r.error });
    return send(res, 200, r);
  }
  return send(res, 404, { error: "not found" });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = decodeURIComponent(url.pathname);
    try {
      if (req.method === "GET" && p === "/api/products") return send(res, 200, publicProducts());
      if (req.method === "GET" && p === "/api/recent-sales") return send(res, 200, recentSales());
      if (p === "/webhook" && (req.method === "GET" || req.method === "POST")) return await whatsappWebhook(req, res, url);
      if (req.method === "POST" && p === "/api/enquiry") return await handleEnquiry(req, res);
      if (req.method === "POST" && p === "/api/orders") return await createOrder(req, res);
      const om = /^\/api\/orders\/([a-f0-9]{16})(\/paid)?$/.exec(p);
      if (om && req.method === "POST" && om[2]) return await orderPaid(req, res, om[1]);
      if (om && req.method === "GET" && !om[2]) {
        const o = loadOrders().find((x) => x.id === om[1]);
        return o ? send(res, 200, { code: o.code, status: o.status }) : send(res, 404, { error: "not found" });
      }
      if (req.method === "POST" && p === "/api/billing/login") {
        let b; try { b = JSON.parse(await readBody(req, 1024)); } catch { return send(res, 400, { error: "Bad request." }); }
        const r = staff.login(b, req.socket.remoteAddress || "?");
        return r.error ? send(res, r.status, { error: r.error }) : send(res, 200, r);
      }
      // Owner key, or a staff login limited to the counter (lib/staff.js).
      if (p.startsWith("/api/billing/")) {
        const route = p.slice("/api/billing/".length);
        const who = isOwner(req, url) ? { role: "owner", name: "Owner" } : staff.who(req.headers["x-session"]);
        if (!who) return send(res, 401, { error: "Please log in." });
        if (who.role === "staff" && !staff.allowed(req.method, route)) return send(res, 403, { error: "Only the owner can do that." });
        return await billingApi(req, res, route, url, who);
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
        let rb = {};
        try { rb = JSON.parse((await readBody(req, 1024)) || "{}"); } catch { /* no body */ }
        if (LIVE && rb.confirm !== "DELETE ALL PRODUCTS AND ORDERS")
          return send(res, 403, { error: "Reset is switched off on the live shop, so real products and orders can't be wiped." });
        if (LIVE) fs.writeFileSync(DB, "[]"); else writeSeed();
        ensureCodes();
        saveInbox([]);
        saveOrders([]);
        savePending([]);
        fs.writeFileSync(ACTIVITY, "[]");
        // The demo reset clears the books too. The live shop's accounts are never reset.
        if (!LIVE) for (const f of ["invoices", "parties", "payments", "purchases", "expenses", "books", "returns", "docs"]) fs.rmSync(path.join(STORE, `${f}.json`), { force: true });
        for (const f of fs.readdirSync(UPLOADS)) fs.unlinkSync(path.join(UPLOADS, f));
        return send(res, 200, { ok: true });
      }
      // The portal page itself is harmless without the key: every call it makes needs it.
      if (p === "/billing") return serveFile(res, path.join(ROOT, "owner"), "billing.html");
      if (p === "/billing-books.js" || p === "/billing-docs.js" || p === "/billing-more.js") return serveFile(res, path.join(ROOT, "owner"), p.slice(1));
      if (p === "/billing-code128.js") return serveFile(res, path.join(ROOT, "owner"), "code128.js");
      if (p === "/billing/labels") return serveFile(res, path.join(ROOT, "owner"), "labels.html");
      const lm = /^\/l\/([a-f0-9]{32})$/.exec(p);
      if (lm && req.method === "GET") {
        const l = books.sharedLedger(lm[1]);
        return l ? send(res, 200, ledgerPage(l), "text/html; charset=utf-8") : notFoundPage(res);
      }
      const bm = /^\/bill\/([a-f0-9]{16})$/.exec(p);
      if (bm && req.method === "GET") {
        const inv = billing.loadInvoices().find((x) => x.id === bm[1]);
        if (!inv) return notFoundPage(res);
        return send(res, 200, invoicePage(inv, SHOP, { thermal: url.searchParams.get("size") === "80", owner: url.searchParams.has("o"), url: `${siteUrl() || `http://${req.headers.host}`}/bill/${inv.id}` }), "text/html; charset=utf-8");
      }
      const dv = /^\/doc\/([a-f0-9]{16})$/.exec(p);
      if (dv && req.method === "GET") {
        const d = documents.printable(dv[1]);
        if (!d) return notFoundPage(res);
        return send(res, 200, invoicePage(d.doc, SHOP, { thermal: url.searchParams.get("size") === "80", owner: url.searchParams.has("o"), title: d.title, labels: d.labels }), "text/html; charset=utf-8");
      }
      if (p.startsWith("/seed-photos/")) return serveFile(res, SEED_PHOTOS, p.slice("/seed-photos/".length));
      if (p.startsWith("/uploads/")) return serveFile(res, UPLOADS, p.slice("/uploads/".length));
      if (p === "/config.js") return sendConfig(res);
      if (p === "/newtab.js") return serveFile(res, path.join(ROOT, "lib"), "newtab.js");
      const pv = /^\/preview\/(classic|modern)(\/.*)?$/.exec(p);
      if (pv) return previewRoute(req, res, pv[1], pv[2] || "");
      if (p === "/" ) return serveFile(res, PUBLIC, "index.html");
      if (p === "/demo") return serveFile(res, PUBLIC, "demo.html");
      const pm = /^\/p\/([\w-]{1,40})$/.exec(p);
      if (pm) return productPage(req, res, pm[1]);
      const legalKey = { "/returns": "returns", "/terms": "terms", "/privacy": "privacy", "/contact": "contact" }[p];
      if (legalKey) return legalPage(res, legalKey);
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
    const todo = legal.missing(SHOP);
    console.log(todo.length ? `Shop details still missing: ${todo.join(", ")}` : "Shop details: complete");
    console.log(`Online ordering: ${ORDERING_OPEN ? "ON" : "OFF until real payment details are in shop.json"}`);
    console.log(LIVE ? `Data: ${STORE} (persistent disk; reset off)` : "Data: data/ (demo; not kept on free hosting restarts)");
    console.log(process.env.OWNER_KEY ? "Owner key: ON (open /demo?key=YOUR_KEY)" : "Owner key: OFF (fine locally; set OWNER_KEY on a public server)");
  });

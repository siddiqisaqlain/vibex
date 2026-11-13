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
const { parseMessage, categoryAnswer, findSubcategory, normaliseCommand } = require("./lib/parse");
const { classify, aiEnabled, MODEL, readPurchaseBill } = require("./lib/classify");
const wa = require("./lib/whatsapp");
const createBilling = require("./lib/billing");
const { sizePairs, withoutSizePairs, optionsOf, applySizePairs, autoDescription, formatSizes, setSizeStock, fitSizeStock } = require("./lib/sizes");
const { readJson, writeJson, dailyBackup } = require("./lib/jsonstore");
const { videoFeed } = require("./lib/youtube");
const createAnalytics = require("./lib/analytics");
const createAccounts = require("./lib/accounts");
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
wa.setSeenFile(path.join(STORE, "wa-seen.json")); // message ids already handled, so Meta's retries after a restart do nothing
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
  writeJson(DB, items);
}
if (!fs.existsSync(DB)) writeSeed();

// A damaged products.json stops the server with a clear message (lib/jsonstore.js) instead of a raw JSON error.
const load = () => readJson(DB, []);

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
  if (changed) writeJson(DB, items);
}
ensureCodes();
// "Gucci Flora 100 mL" -> name "Gucci Flora", sizes "100 ml". Bottle sizes belong in the size
// field (the site shows them as a chip), not in the name. Also tidies a stray " - " left behind.
const VOLUME = /\s*[-–,(]?\s*\b(\d{1,4}(?:[.,]\d)?)\s?(ml|mls|ltr|litres?|liters?)\b\.?\)?/i;
function tidyListing(l) {
  if (!l || !l.name || l.category !== "Fragrances") return l; // clothes sizes like "L" are left alone
  const vols = [];
  for (let m = VOLUME.exec(l.name); m; m = VOLUME.exec(l.name)) {
    const rest = (l.name.slice(0, m.index) + " " + l.name.slice(m.index + m[0].length)).replace(/\s+/g, " ").replace(/^[\s\-–,]+|[\s\-–,]+$/g, "").trim();
    if (rest.length < 2) break;
    l.name = rest;
    vols.push(`${m[1].replace(",", ".")} ${/^(ltr|lit)/i.test(m[2]) ? "L" : "ml"}`);
  }
  if (vols.length && !l.sizes) l.sizes = vols.join(" · ");
  l.name = l.name.replace(/\s+[-–]\s*$/, "").trim();
  return l;
}
// Once at start-up: tidy names already on the site (e.g. posts from before this existed).
(() => {
  const items = load();
  let n = 0;
  for (const p of items) { const before = `${p.name}|${p.sizes}`; tidyListing(p); if (`${p.name}|${p.sizes}` !== before) n++; }
  if (n) { writeJson(DB, items); console.log(`Tidied ${n} product name(s): bottle size moved to the size field`); }
})();
// Once at start-up: descriptions written for the stock already on the site. Never overwrites one.
(() => {
  const seed = require("./lib/descriptions.json");
  const items = load();
  let n = 0;
  for (const p of items) if (!p.description && seed[p.id]) { p.description = seed[p.id]; n++; }
  if (n) { writeJson(DB, items); console.log(`Added ${n} product description(s)`); }
})();
// Once at start-up: real names, read off the bottles, for items posted as just "Zara".
// Only touches that exact name, so a name the owner sets later is never overwritten.
(() => {
  const names = require("./lib/renames.json");
  const items = load();
  let n = 0;
  for (const p of items) if (p.name === "Zara" && names[p.id]) { p.name = names[p.id]; p.brand = p.brand || "Zara"; n++; }
  if (n) { writeJson(DB, items); console.log(`Renamed ${n} product(s)`); }
})();
const save = (items) => { items.forEach(fitSizeStock); writeJson(DB, items); };
// Files that may be rebuilt from nothing (inbox, activity): a damaged one is moved aside as
// <file>.damaged-<time> and logged, so nothing is overwritten unseen and it can still be looked at.
function readOrSetAside(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
  try { return JSON.parse(text); } catch {
    const aside = `${file}.damaged-${Date.now()}`;
    try { fs.renameSync(file, aside); } catch { /* already moved by another call */ }
    console.error(`${path.basename(file)} was damaged: moved to ${path.basename(aside)}, starting a new one.`);
    return fallback;
  }
}
// Copies made before an import / link / unlink: the newest 10 of each kind, so the disk doesn't fill up.
function pruneCopies(keep = 10) {
  let names; try { names = fs.readdirSync(STORE); } catch { return; }
  for (const kind of ["import", "link", "unlink"]) {
    const re = new RegExp(`^products-before-${kind}-(\\d+)\\.json$`);
    const list = names.map((f) => [f, re.exec(f)]).filter(([, m]) => m).sort((a, b) => Number(b[1][1]) - Number(a[1][1]));
    for (const [f] of list.slice(keep)) try { fs.unlinkSync(path.join(STORE, f)); } catch { /* gone */ }
  }
}
pruneCopies();
// What customers may see. Cost prices and the shop's own notes never leave the server, and
// hidden items (imported, waiting for a photo) aren't on sale yet.
const PRIVATE_FIELDS = ["cost", "purchasePrice", "supplierId", "hsn", "gstRate", "reorderAt", "barcode", "importKey", "linkUndo", "needsCount", "needsName"];
const isPublic = (p) => !p.hidden;
const forCustomers = (p) => {
  const c = { ...p, options: optionsOf(p), description: p.description || autoDescription(p) };
  for (const k of PRIVATE_FIELDS) delete c[k];
  delete c.sizePrices;
  delete c.sizeStock; // each option carries its own count
  return c;
};
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
const mbbImport = require("./lib/import-mbb");
const books = require("./lib/books")({ STORE, SHOP, billing, load, save, logActivity });
billing.hooks.partyFor = books.customerFor;
const documents = require("./lib/documents")({ STORE, billing, books, load, save, logActivity, newCode });
const reports = require("./lib/reports")({ SHOP, billing, books, documents, load });
const staff = require("./lib/staff")({ STORE });
// Bill settings saved from the portal sit on top of shop.json.
Object.assign(SHOP.billing, books.getSetting("billSettings") || {});
if (books.getSetting("gstin")) SHOP.business.gstin = books.getSetting("gstin");
billing.hooks.canCancel = (inv) => (documents.hasReturn("invoiceId", inv.id) ? `Bill ${inv.number} has a return against it. Cancel the return first.` : null);
// The books get a dated copy every day, kept 30 days on the same disk.
// customers.json + coins.json are the website accounts and their coin balances (money owed to customers);
// wa-alerts.json holds order alerts the owner hasn't seen yet.
const BOOK_FILES = ["staff.json", "products.json", "invoices.json", "parties.json", "payments.json", "purchases.json", "expenses.json", "books.json", "orders.json", "returns.json", "docs.json", "customers.json", "coins.json", "wa-alerts.json"];
if (LIVE) { dailyBackup(STORE, BOOK_FILES); setInterval(() => dailyBackup(STORE, BOOK_FILES), 3600e3).unref(); }
// Bill links in WhatsApp replies. Locally there's no public address, so it's a path.
const billUrl = (inv) => siteUrl() + `/bill/${inv.id}`;
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
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".cjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
};

// Sent with every reply: keep the browser on https, don't let it guess a file's type, don't let another
// site put this one in a frame, and tell other sites only where a visitor came from, not which page.
const SAFE = { "Strict-Transport-Security": "max-age=31536000", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "strict-origin-when-cross-origin" };

function send(res, status, body, type = "application/json", cache = "no-store") {
  if (res.onSend) { const f = res.onSend; res.onSend = null; f(status, body); } // requestId replies (billingApi)
  res.writeHead(status, { "Content-Type": type, "Cache-Control": cache, ...SAFE });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Files carry a tag made from their size and date. The browser keeps its copy and asks "still the same?"
// (no-cache), and gets a short 304 instead of the whole file again; a new deploy changes the tag at once.
function serveFile(res, base, rel, cache = "no-cache") {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) return send(res, 403, { error: "forbidden" });
  fs.stat(file, (bad, st) => {
    if (bad || !st.isFile()) return send(res, 404, "Not found", "text/plain");
    const tag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
    const has = String(res.req?.headers["if-none-match"] || "").replace(/W\//g, "").split(/\s*,\s*/);
    if (has.includes(tag)) { res.writeHead(304, { ETag: tag, "Cache-Control": cache, ...SAFE }); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, "Not found", "text/plain");
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": cache, ETag: tag, ...SAFE });
      res.end(buf);
    });
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

// Finds the product a command ("sold puffer", "remove 4795") refers to. Returns { p } or { reply } when
// nothing should happen. It never guesses: these commands sell and hide real stock.
//  - no words: ask which item (it used to take the newest one)
//  - a bare number is a code: exactly 4 digits that exist, so "sold 149" can't match a ₹1499 caption
//  - whole words only ("tee" doesn't match "Steel"); a tie lists the items and does nothing
const wordsOf = (t) => String(t || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function findTarget(items, query, wantStatus, verb = "sold") {
  const pool = items.filter((p) => !wantStatus || p.status === wantStatus);
  const q = String(query || "").trim();
  const which = `Which item? Send *${verb}* and its code, e.g. *${verb} 4795*. The 4-digit code is the LOT number on the website.`;
  if (!q) return { reply: which };
  const byCode = /^(?:lot|code|#)?\s*#?\s*(\d+)$/i.exec(q);
  if (byCode) {
    if (byCode[1].length !== 4) return { reply: `“${byCode[1]}” isn't a code. Codes are 4 digits (the LOT number on the website), e.g. *${verb} 4795*.` };
    const p = pool.find((x) => x.code === byCode[1]);
    return p ? { p } : { reply: `I couldn't find code ${byCode[1]}${wantStatus ? ` among the ${wantStatus === "sold" ? "sold-out" : "available"} items` : " on the website"}. The code is the LOT number on the website.` };
  }
  const words = [...new Set(wordsOf(q).filter((w) => w.length > 1))];
  if (!words.length) return { reply: which };
  let bestScore = 0, top = [];
  for (const p of pool) {
    const hay = new Set(wordsOf(`${p.name} ${p.brand || ""} ${p.caption || ""}`));
    const score = words.filter((w) => hay.has(w)).length;
    if (score > bestScore) { bestScore = score; top = [p]; } else if (score && score === bestScore) top.push(p);
  }
  if (!top.length) return { reply: `I couldn't find that item on the website. Try a word from its name, like “${verb} puffer”, or its 4-digit code.` };
  if (top.length > 1) {
    const list = top.slice(0, 8).map((p) => `• *${p.code}* ${p.name}`).join("\n");
    return { reply: `${top.length} items match “${q}”. Which one? Send *${verb}* with its code:\n${list}${top.length > 8 ? `\n…and ${top.length - 8} more` : ""}` };
  }
  return { p: top[0] };
}

// ---- Customer enquiries ("Ask about this piece") ----
// The website posts here; the owner gets the product photo plus the customer's name and
// number. In the demo it lands in the fake WhatsApp chat via /api/inbox. In version 2,
// sendToOwner() also sends it to the owner's real WhatsApp through the Cloud API.
const INBOX = path.join(STORE, "inbox.json");
const loadInbox = () => readOrSetAside(INBOX, []);
const saveInbox = (m) => writeJson(INBOX, m.slice(-200));

// Indian mobile numbers: 10 digits starting 6–9, optionally with +91 / 0 in front.
function normalisePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
const prettyPhone = (d) => `+91 ${d.slice(0, 5)} ${d.slice(5)}`;

// The visitor's real address. Requests come Cloudflare -> Render -> here: Cloudflare sets
// cf-connecting-ip itself (overwriting anything the visitor sends), and Render appends the address
// it saw to x-forwarded-for, so its LAST entry is the real peer. The first entry is whatever the
// visitor typed, which is why it must never be used for limits.
// Cloudflare's published edge ranges (cloudflare.com/ips). cf-connecting-ip is only believed when
// the hop Render saw is one of these; anyone hitting *.onrender.com directly could type it themselves.
const CF_EDGES = new (require("net").BlockList)();
for (const r of ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"]) { const [a, n] = r.split("/"); CF_EDGES.addSubnet(a, +n, "ipv4"); }
for (const r of ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"]) { const [a, n] = r.split("/"); CF_EDGES.addSubnet(a, +n, "ipv6"); }
function fromCloudflare(ip) {
  const s = String(ip || "").replace(/^::ffff:/, "");
  try { return CF_EDGES.check(s, s.includes(":") ? "ipv6" : "ipv4"); } catch { return false; }
}
let ipChecks = 0;
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
  const peer = xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || "?"; // the last hop is added by Render
  const cf = String(req.headers["cf-connecting-ip"] || "").trim();
  // The first few after each start show in Render's logs that the hop really is a Cloudflare edge.
  if (ipChecks < 3 && cf) { ipChecks++; console.log(`client ip check: hops=${xff.length} peerIsCloudflare=${fromCloudflare(peer)}`); }
  return cf && fromCloudflare(peer) ? cf : peer;
}

const recent = new Map(); // ip -> timestamps, a simple flood guard
const FLOOD_MS = 10 * 60e3;
// PIN code -> city, for the order form, so the customer need not type the city. Looked up from India's
// post office list (api.postalpincode.in), kept in memory, and never in the way: no answer in 2.5 s, or
// too many asks from one place, and the form just leaves the city box for the customer to fill.
const pinSeen = new Map(), pinAsks = new Map();
const PIN_LOOKUP = process.env.PIN_LOOKUP === undefined ? "https://api.postalpincode.in/pincode/" : process.env.PIN_LOOKUP;
async function pinPlace(raw, ip) {
  const pin = String(raw || "");
  if (!/^[1-9]\d{5}$/.test(pin)) return {};
  if (pinSeen.has(pin)) return pinSeen.get(pin);
  if (!PIN_LOOKUP) return {};
  const now = Date.now(), a = pinAsks.get(ip);
  if (a && now - a.t < 60e3) { if (++a.n > 20) return {}; } else { if (pinAsks.size > 5000) pinAsks.clear(); pinAsks.set(ip, { t: now, n: 1 }); }
  try {
    const r = await fetch(PIN_LOOKUP + pin, { signal: AbortSignal.timeout(2500) });
    const po = (await r.json())?.[0]?.PostOffice?.[0];
    const clean = (s) => String(s || "").replace(/[^\p{L} .&'-]/gu, "").trim().slice(0, 60);
    const out = po ? { city: clean(po.District), state: clean(po.State) } : {};
    if (r.ok) { if (pinSeen.size > 20000) pinSeen.clear(); pinSeen.set(pin, out); }
    return out;
  } catch { return {}; }
}

function tooMany(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < FLOOD_MS);
  list.push(now);
  recent.set(ip, list);
  return list.length > 5;
}
// Wrong owner keys: 20 in 10 minutes from one address and it gets 429 until they age out.
// The right key is never refused (it's checked before this).
const wrongKeys = new Map(); // ip -> timestamps
const WRONG_KEY_MAX = 20;
function wrongKey(ip) {
  const now = Date.now();
  const list = (wrongKeys.get(ip) || []).filter((t) => now - t < FLOOD_MS);
  list.push(now);
  wrongKeys.set(ip, list);
  return list.length > WRONG_KEY_MAX;
}
// Old entries go, or both maps grow with every address that ever visited.
setInterval(() => {
  const cut = Date.now() - FLOOD_MS;
  for (const m of [recent, wrongKeys]) for (const [ip, list] of m) { const keep = list.filter((t) => t > cut); if (keep.length) m.set(ip, keep); else m.delete(ip); }
}, 60e3).unref();

// The site's public address, for every link we send out. Never the host's own address: customers
// must only ever see the shop's domain, so on Render (which sets RENDER) it falls back to that.
const siteUrl = () => (process.env.PUBLIC_URL || (process.env.RENDER ? "https://vibexindia.com" : "")).replace(/\/$/, "");
// Someone opening a page on the host's address lands on the shop's domain instead. /webhook and
// /api stay put: the WhatsApp router posts to /webhook here, and Render checks /api/products.
function toDomain(req, res, p, url) {
  if (!/\.onrender\.com(:\d+)?$/i.test(req.headers.host || "") || !siteUrl() || siteUrl().includes(".onrender.com")) return false;
  if ((req.method !== "GET" && req.method !== "HEAD") || p === "/webhook" || p.startsWith("/api/")) return false;
  res.writeHead(301, { Location: siteUrl() + url.pathname + url.search });
  res.end();
  return true;
}

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
  const ip = clientIp(req);
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

const { courierFor, feeFor, kgOf } = require("./lib/courier");
const payWindow = require("./lib/paywindow");
const PAY_WINDOW = payWindow.read(SHOP.pay?.window, process.env.ORDER_HOURS);
const ORDER_WINDOW_MS = Number(process.env.ORDER_WINDOW_MS) || PAY_WINDOW.minutes * 60e3;

// Every line of an order. Orders from before the bag had one product, kept in top-level fields.
const orderLines = (o) => o.lines || [{ productId: o.productId, productName: o.productName, lot: o.lot, size: o.size, qty: 1, price: o.amount - (o.shipping || 0) }];
const linesText = (o) => orderLines(o).map((l) => `• ${l.productName}${l.size ? ` · ${l.size}` : ""}${l.qty > 1 ? ` × ${l.qty}` : ""} · ${inr(l.price * l.qty)} · ${l.lot}`).join("\n");

// The bag as it stands now: server prices, stock and courier. Nothing the browser says about money is used.
// Returns { lines, goods, shipping, kg, inside, problems } or { error }.
function priceBag(bag, { pin = "", delivery = "pickup", holdToken = "" } = {}) {
  if (!Array.isArray(bag) || !bag.length) return { error: "Your bag is empty." };
  if (bag.length > 20) return { error: "That's a lot of pieces. Please order 20 or fewer at a time." };
  const items = load().filter(isPublic), lines = [], problems = [];
  for (const b of bag) {
    const p = items.find((x) => x.id === String(b.id || b.productId || ""));
    if (!p) { problems.push({ id: b.id, size: b.size || "", why: "gone", text: "No longer listed" }); continue; }
    const options = optionsOf(p);
    const picked = options.length === 1 ? options[0] : options.find((o) => o.size === String(b.size || ""));
    const say = (why, text) => problems.push({ id: p.id, size: b.size || "", name: p.name, why, text });
    if (p.status === "sold") { say("sold", "Sold out"); continue; }
    if (!p.price) { say("price", "No price yet, ask us"); continue; }
    if (options.length > 1 && !picked) { say("size", "Choose a size"); continue; }
    if (picked?.left === 0) { say("sold", `${picked.size} has just sold out. Please choose another size`); continue; }
    const size = holdSize(p, picked?.size);
    if (p.status === "hold" || holds.blockedFor(p.id, size, holdToken)) { say("hold", "Someone is paying for the last one"); continue; }
    const left = picked?.left ?? billing.stockOf(p);
    const qty = Math.min(Math.max(1, Math.floor(Number(b.qty) || 1)), Math.max(1, left || 1), 9);
    lines.push({ productId: p.id, productName: p.name, lot: lotOf(p), ...(picked?.size ? { size: picked.size } : {}), qty, price: picked?.price ?? p.price, image: p.image || null, _p: p });
  }
  const goods = lines.reduce((n, l) => n + l.price * l.qty, 0);
  let shipping = 0, kg = 0, chargedKg = 0, inside = false;
  if (delivery === "ship" && /^[1-9]\d{5}$/.test(pin)) {
    // One parcel: the weights add up, and the courier is charged on the total.
    const C = SHOP.policy?.courier;
    for (const l of lines) kg += kgOf(C, l._p) * l.qty;
    const f = feeFor(C, kg, pin);
    shipping = f.fee || 0; inside = f.inside; chargedKg = f.chargedKg || 0;
  }
  return { lines, goods, shipping, kg: Math.round(kg * 100) / 100, chargedKg, inside, problems };
}

async function createOrder(req, res) {
  let b;
  try { b = JSON.parse(await readBody(req, 20 * 1024)); } catch { return send(res, 400, { error: "Something went wrong. Please try again." }); }
  if (b.website) return send(res, 200, { ok: true });
  if (!ORDERING_OPEN) return send(res, 403, { error: "Online ordering opens soon. Tap Enquire and we'll reply on WhatsApp." });
  // No sign-in. This phone's account, if it has ordered before; the first order makes one (below).
  let me = customerOf(req);
  if (!payWindow.isOpen(PAY_WINDOW)) return send(res, 409, { error: payWindow.closedText(PAY_WINDOW) });
  if (tooMany(clientIp(req))) return send(res, 429, { error: "Too many attempts. Please wait a few minutes." });
  const given = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const phone = normalisePhone(b.phone);
  // The number-only form (checkout.js, arm "b") asks for the name on the pay screen instead. Until then
  // the order goes by the last four digits, and noName keeps that off bills, greetings and the site.
  const noName = !given && b.nameLater === true && Boolean(phone);
  const name = noName ? `Customer ${phone.slice(-4)}` : given;
  const delivery = b.delivery === "ship" ? "ship" : "pickup";
  const address = String(b.address || "").trim().slice(0, 300);
  const city = String(b.city || "").trim().slice(0, 60);
  const pin = String(b.pin || "").replace(/\D/g, "");
  if (!name) return send(res, 400, { error: "Please add your name." });
  if (!phone) return send(res, 400, { error: "Please enter a 10 digit mobile number." });
  if (delivery === "ship" && (!address || !city || !/^[1-9]\d{5}$/.test(pin))) {
    return send(res, 400, { error: "Please add your full address, city and 6 digit PIN code." });
  }
  // The bag comes from the request (what the customer sees), checked line by line here.
  const bag = Array.isArray(b.lines) ? b.lines : b.productId ? [{ id: b.productId, size: b.size }] : [];
  const q = priceBag(bag, { pin, delivery, holdToken: String(b.holdToken || "") });
  if (q.error) return send(res, 400, { error: q.error });
  // Same answers as before the bag: 404 for a piece that isn't listed, 400 for a missing size.
  const only = (why) => q.problems.length && q.problems.every((x) => x.why === why);
  if (only("gone") && !q.lines.length) return send(res, 404, { error: "This piece is no longer listed.", problems: q.problems });
  if (only("size")) return send(res, 400, { error: "Please choose a size first.", problems: q.problems });
  if (q.problems.length) return send(res, 409, { error: q.problems.length === 1 ? `${q.problems[0].name || "One piece"}: ${q.problems[0].text}.` : "Some pieces in your bag changed. Please check your bag.", problems: q.problems });
  // Coins, only while the shop has redeeming switched on, and never more than the cap.
  const coinsUsed = me && b.useCoins ? accounts.usable(me, q.goods) : 0;
  if (!me) { const made = accounts.create({ name: given }); me = made.customer; setSession(req, res, made.token); }
  const orders = loadOrders();
  const lines = q.lines.map(({ _p, image, ...l }) => l);
  const order = {
    id: crypto.randomBytes(8).toString("hex"), code: newOrderCode(orders), customerId: me.id,
    lines, productId: lines[0].productId, productName: lines.length === 1 ? lines[0].productName : `${lines[0].productName} + ${lines.length - 1} more`,
    lot: lines[0].lot, ...(lines.length === 1 && lines[0].size ? { size: lines[0].size } : {}),
    goods: q.goods, ...(coinsUsed ? { coinsUsed } : {}), amount: q.goods - coinsUsed + q.shipping,
    ...(q.shipping ? { shipping: q.shipping, kg: q.chargedKg } : {}),
    name, ...(noName ? { noName: true } : {}), phone, delivery, address, city, pin, ...(b.hideName ? { hideName: true } : {}),
    ...(b.form === "a" || b.form === "b" ? { form: b.form } : {}),
    status: "awaiting_payment", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ORDER_WINDOW_MS).toISOString(),
  };
  orders.push(order);
  saveOrders(orders);
  if (coinsUsed) accounts.spend(me.id, coinsUsed, order.code);
  accounts.setAddress(me.id, { name: given, phone, delivery, address, city, pin });
  // Nobody else can pay for a last piece during the window.
  const items = load();
  let first = null;
  for (const l of lines) {
    const held = items.find((x) => x.id === l.productId);
    first ||= held;
    if (held && !(held.quantity > 1) && held.status === "available") { held.status = "hold"; held.holdFor = order.code; }
  }
  save(items);
  orderAlert(order, first);
  send(res, 200, { id: order.id, code: order.code, amount: order.amount, goods: order.goods, coinsUsed, lot: order.lot, shipping: q.shipping, left: ORDER_WINDOW_MS, lines: lines.length, ...(noName ? { noName: true } : {}) });
}

// "Hi Aamir," or just "Hi," while the order has no name yet.
const hiTo = (o) => (o.noName ? "Hi" : `Hi ${o.name}`);

// The name for a number-only order, given on the pay screen. Once only: a name already on the order stays.
async function orderName(req, res, id) {
  let b;
  try { b = JSON.parse(await readBody(req, 2 * 1024)); } catch { return send(res, 400, { error: "Something went wrong. Please try again." }); }
  // No flood guard here: it needs the order's own unguessable id and changes one thing, once.
  const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) return send(res, 400, { error: "Please add your name." });
  const orders = loadOrders(), o = orders.find((x) => x.id === id);
  if (!o) return send(res, 404, { error: "Order not found." });
  if (!o.noName) return send(res, 200, { ok: true, name: o.name });
  o.name = name; delete o.noName;
  saveOrders(orders);
  if (o.customerId) accounts.setAddress(o.customerId, { name, phone: o.phone, delivery: o.delivery, address: o.address, city: o.city, pin: o.pin });
  // The bill may already be written (the shop confirmed first): put the name on it too.
  if (o.invoice) { const all = billing.loadInvoices(), inv = all.find((x) => x.id === o.invoice); if (inv && inv.customer && !inv.customer.name) { inv.customer.name = name; billing.saveInvoices(all); } }
  // No second WhatsApp alert: the shop sees the name in the portal and in its confirm reply.
  send(res, 200, { ok: true, name });
}

// "Pay now" pages from before the payment window are still open in some phones: nothing they send counts.
const refused = (res) => send(res, 409, { error: "Please refresh this page and order again." });

function orderAlert(o, p) {
  const where = o.delivery === "ship" ? `🚚 Ship to: ${o.address}, ${o.city} ${o.pin}` : "🏬 Pickup at the store";
  const hello = encodeURIComponent(`${hiTo(o)}, Vibe X here about your order ${o.code} (${o.productName}).`);
  sendToOwner({
    id: crypto.randomBytes(6).toString("hex"), at: new Date().toISOString(), kind: "order",
    summary: { kind: "order", ref: o.code },
    image: (p && p.image) || null,
    text: `💰 *New order ${o.code}: ${Math.round(ORDER_WINDOW_MS / 60e3)} minutes to confirm*\n${linesText(o)}\n*Total ${inr(o.amount)}*${o.coinsUsed ? ` (${inr(o.coinsUsed)} paid in coins)` : ""}${o.shipping ? ` (includes ${inr(o.shipping)} courier for ${o.kg} kg)` : ""}\n\n👤 ${o.noName ? "Name not given yet (number-only form)" : o.name}\n📞 ${prettyPhone(o.phone)}\n${where}\n🧾 Look for note ${o.code}\n\nThe customer is on the payment screen now. When ${inr(o.amount)} reaches your bank, reply:\n*confirm ${o.code}* or *cancel ${o.code}*\n\nMessage customer: https://wa.me/91${o.phone}?text=${hello}`,
  });
}

// The piece stops being held, whatever ended the order.
function letGo(o, items) {
  let any = false;
  for (const l of orderLines(o)) {
    const p = items.find((x) => x.id === l.productId);
    if (!p || p.status !== "hold" || p.holdFor !== o.code) continue;
    p.status = "available"; delete p.holdFor; any = true;
  }
  return any;
}

// The customer went back to change their details: the order they leave behind mustn't hold the piece.
function orderCancel(res, id) {
  const orders = loadOrders(), o = orders.find((x) => x.id === id);
  if (!o) return send(res, 404, { error: "Order not found." });
  if (o.status !== "awaiting_payment") return send(res, 200, { code: o.code, status: o.status });
  o.status = "cancelled"; o.cancelledBy = "customer";
  saveOrders(orders);
  if (o.customerId) accounts.undo(o.customerId, o.code);
  const items = load();
  if (letGo(o, items)) save(items);
  send(res, 200, { code: o.code, status: o.status });
}

const HELP = `📋 *Commands*
*Post a product:* just send the photo. I'll ask for anything I need (section, name, price, size) one at a time, then show you how it looks. Tap *Post it* and it's live.
_Faster:_ put it all in the caption, e.g. _Zara shirt 1499 M L_, and it's one tap
*Today's numbers:* _stats_
*Today's bills:* _bills_
*Running low:* _low_
*Put an imported item on the website:* send its photo with the code as the caption, e.g. _4795_
*Several photos at once:* I'll ask if they're one item or separate items
*More photos of an item:* _photos 4795_, then send the photos (or caption them _photos 4795_). _main 4795_ with a photo makes it the main one
*Sell:* _sold 4795_ (one) or _sold 4795 2_
*More came in:* _add 4795 3_
*Set stock:* _stock 4795 5_
*Wrong section:* _move 4795 perfume_ (or clothes, shoes, accessory)
*Take off the website (stays in stock):* _remove 4795_
*Sizes:* _sizes 4795 50ml 2999 100ml 4999_ (or _sizes 4795 M L XL_)
*Stock of a size:* _stock 4795 100ml 3_ or _add 4795 100ml 2_
*Description:* _desc 4795 your words_
*Start over:* _clear_ drops every photo still waiting to be posted
*Orders:* _orders_ lists the website orders waiting, then _confirm VX-1234_ or _cancel VX-1234_
*Stock in short:* _stock_
*Customer coins:* _coins_, _coins on_ or _coins off_
The 4-digit code is the LOT number on the website, and I send it when you post.
Tip: put *perfume*, *clothes*, *shoes* or *accessory* in the caption and I'll never have to ask which it is.`;

// "desc 4795 Soft cotton tee", "sizes 4795 50ml 2999 100ml 4999", "sold 4795 100ml"
function liveEdit(text) {
  const t = text.trim();
  let m = /^(?:desc|description|about)\s+(\d{4})\s+([\s\S]{5,500})$/i.exec(t);
  const size = !m && /^sizes?\s+(\d{4})\s+(.{1,100})$/i.exec(t);
  const sold = !m && !size && /^sold\s+(\d{4})\s+(\d{1,4}(?:\.\d)?)\s?ml(?:\s+(\d{1,3}))?$/i.exec(t);
  const count = !m && !size && !sold && /^(add|stock)\s+(\d{4})\s+(\d{1,4}(?:\.\d)?)\s?ml\s+(\d{1,4})$/i.exec(t);
  const hit = m || size || sold || count;
  if (!hit) return null;
  const items = load();
  const p = items.find((x) => x.code === (count ? hit[2] : hit[1]));
  if (!p) return `I couldn't find code ${hit[1]}. The code is the LOT number on the website.`;
  if (m) { p.description = m[2].trim(); save(items); return `📝 Description updated for “${p.name}” (#${p.code}).`; }
  if (size) {
    setSizes(p, size[2]);
    save(items);
    return `📏 “${p.name}” (#${p.code}) now comes in: ${optionsOf(p).map((o) => `${o.size} ${inr(o.price)}`).join(", ")}.`;
  }
  const opt = optionsOf(p).find((o) => o.size === `${(sold || count)[count ? 3 : 2]} ml`);
  if (!opt) return `“${p.name}” (#${p.code}) doesn't have ${(sold || count)[count ? 3 : 2]} ml. It has: ${p.sizes || "no sizes set"}.`;
  if (count) {
    const counts = { ...Object.fromEntries(optionsOf(p).map((o) => [o.size, o.left ?? 0])) };
    counts[opt.size] = (/^add/i.test(count[1]) ? counts[opt.size] : 0) + Number(count[4]);
    const r = setSizeStock(p, counts);
    if (r.total === undefined) return `“${p.name}” (#${p.code}) needs two or more sizes for a count per size.`;
    p.quantity = r.total;
    if (p.quantity === 0) { p.status = "sold"; delete p.holdFor; }
    else if (p.status === "sold") p.status = "available";
    delete p.needsCount;
    save(items);
    return `📦 “${p.name}” (#${p.code}): ${Object.entries(p.sizeStock).map(([s, n]) => `${s}: *${n}*`).join(", ")}.`;
  }
  const r = billing.sell([{ productId: p.id, qty: Number(sold[3]) || 1, price: opt.price, size: opt.size }], { source: "whatsapp", clamp: true });
  if (r.error) return `⚠️ ${r.error}`;
  const after = billing.stockOf(r.products.find((x) => x.id === p.id));
  return `🏷️ Sold ${r.invoice.lines[0].qty} × “${p.name}” ${opt.size} (#${p.code}). ${after === 0 ? "*SOLD OUT* on the website." : `*${after}* left on the website.`}\n🧾 Bill ${r.invoice.number} · ${inr(r.invoice.total)}: ${billUrl(r.invoice)}`;
}

// Owner stock messages: "sold 4795 2", "add 4795 3", "stock 4795 5", "help".
function stockCommand(text) {
  const live = liveEdit(text);
  if (live) return live;
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
    if ((p.sizePrices || (p.sizeStock && /ml/.test(p.sizes))) && optionsOf(p).length > 1) return `Which size of “${p.name}” sold? Send ${optionsOf(p).map((o) => `*sold ${p.code} ${o.size.replace(" ", "")}*`).join(" or ")}`;
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
    // Already confirmed = already billed: cancelling the bill puts the piece back on sale. If the bill
    // can't be cancelled (e.g. a return is filed against it), the order stays as it is: a cancelled
    // order with a live bill would hand back coins and stock the shop never got back.
    if (o.invoice) {
      const inv = billing.loadInvoices().find((x) => x.id === o.invoice);
      if (inv && inv.status !== "cancelled") {
        const r = billing.cancel(o.invoice, `Order ${o.code} cancelled`);
        if (r.error) return `⚠️ Can't cancel ${o.code}: ${r.error}`;
      }
      o.invoice = null;
    }
    const lapsed = o.status === "lapsed"; // its piece was released already, and may have sold since
    o.status = "cancelled";
    if (letGo(o, items)) save(items);
    saveOrders(orders);
    if (o.customerId) accounts.undo(o.customerId, o.code);
    if (lapsed) return `❌ ${o.code} closed. If ${o.name} did pay, refund ${inr(o.amount)} to ${prettyPhone(o.phone)}.`;
    return `❌ ${o.code} cancelled. ${orderLines(o).length > 1 ? "Its pieces are" : `“${o.productName}” is`} back on sale.\nTell the customer: ${hello(`${hiTo(o)}, Vibe X here. We couldn't find your payment for order ${o.code}. Could you send the payment screenshot?`)}`;
  }
  if (o.status === "confirmed") return `${o.code} is already confirmed.`;
  if (o.status === "cancelled") return `${o.code} was cancelled. Ask the customer to order again.`;
  // Same path as the billing portal: stock comes off and the bill is written in one go.
  // Coins come off the lines as a discount, so the bill shows the real money received.
  let coinsLeft = o.coinsUsed || 0;
  const sellLines = orderLines(o).map((l, i, all) => {
    const share = i === all.length - 1 ? coinsLeft : Math.min(coinsLeft, Math.round(((o.coinsUsed || 0) * l.price * l.qty) / (o.goods || 1)));
    coinsLeft -= share;
    return { productId: l.productId, qty: l.qty, price: l.price, size: l.size, ...(share ? { disc: share } : {}) };
  });
  const sale = billing.sell(sellLines, {
    source: "website", order: o.code, holdFor: o.code, payment: "upi",
    charges: o.shipping ? [{ label: `Courier (${o.kg} kg)`, amount: o.shipping }] : [],
    customer: { name: o.noName ? "" : o.name, phone: o.phone, address: o.delivery === "ship" ? `${o.address}, ${o.city} ${o.pin}` : "" },
  });
  if (sale.error && o.status === "lapsed") return `⚠️ Can't confirm ${o.code}: “${o.productName}” has gone since the order lapsed.\nIf ${o.name} paid, refund ${inr(o.amount)} to ${prettyPhone(o.phone)}, then send *cancel ${o.code}*.`;
  if (sale.error) return `⚠️ Can't confirm ${o.code}: ${sale.error}\nIf the customer has paid, refund them and send *cancel ${o.code}*.`;
  o.status = "confirmed";
  o.confirmedAt = new Date().toISOString();
  o.invoice = sale.invoice.id;
  saveOrders(orders);
  // Coins for the money actually paid for the goods (not the courier, not coins).
  if (o.customerId) accounts.earn(o.customerId, (o.goods ?? o.amount - (o.shipping || 0)) - (o.coinsUsed || 0), o.code);
  const next = o.delivery === "ship" ? (SHOP.policy?.photoBeforeDispatch ? "📸 Send them a photo of this exact piece on WhatsApp, as the website promises. Then pack it for shipping" : "Pack it for shipping") : "Keep it aside for pickup";
  const after = sale.products.find((x) => x.id === o.productId);
  const marked = orderLines(o).length > 1 ? `${orderLines(o).length} pieces marked sold` : `“${o.productName}” marked ${after.status === "sold" ? "SOLD" : `sold (${after.quantity} left)`}`;
  return `✅ ${o.code} confirmed. ${marked}.\n🧾 Bill ${sale.invoice.number}: ${billUrl(sale.invoice)}\n${next}. The customer's screen already shows it's confirmed.\nMessage them: ${hello(`${hiTo(o)}, Vibe X here. Payment received for ${o.code} (${o.productName}). ${o.delivery === "ship" ? "We'll share tracking once it ships." : "It's ready for pickup at the store."}`)}`;
}

// ---- Owner key ----
// The analytics in short: this period against the one before, where people drop off and why, and the A/B tests.
async function analyticsDigest(days) {
  const day = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10); // IST
  const to = Date.now(), from = to - (days - 1) * 864e5;
  const [r, prev] = await Promise.all([analytics.report(day(from), day(to)), analytics.report(day(from - days * 864e5), day(from - 864e5))]);
  const top = (list, n, f) => (list || []).slice(0, n).map(f);
  return {
    generatedAt: new Date().toISOString(), days, from: r.from, to: r.to,
    totals: r.totals, previous: prev.totals, funnel: r.funnel.map(({ label, n }) => ({ label, n })),
    findings: (r.findings || []).map(({ tone, title, detail }) => ({ tone, title, detail })),
    fixes: top(r.fixes, 8, ({ title, why, people, money, sure }) => ({ title, why, people, money, ...(sure ? { sure } : {}) })),
    stops: top(r.stops, 6, ({ label, n }) => ({ label, n })),
    leftCheckoutAt: r.abandonAt || {},
    stuck: top(r.stuck, 8, ({ kind, where, label, visits }) => ({ kind, where, label, visits })),
    products: top(r.products, 10, ({ name, views, clicks, checkout, paid, conv }) => ({ name, views, taps: clicks, checkout, paid, conv })),
    shelf: r.shelf, categories: r.categories,
    pages: (r.footfall || []).map(({ label, visits, people, medianTime, exitRate, buyers }) => ({ label, visits, people, medianTime, exitRate, buyers })),
    features: (r.features || []).map(({ label, people, share, buyers }) => ({ label, people, share, buyers })),
    searches: top(r.searches, 10, ({ key, people, none }) => ({ term: key, people, foundNothing: none })),
    whatsapp: r.chats ? { people: r.chats.people, taps: r.chats.taps, from: r.chats.places.map(({ label, n }) => ({ label, n })) } : null,
    sources: top(r.sources, 6, ({ key, n, paid, conv }) => ({ key, visits: n, paid, conv })),
    devices: top(r.devices, 4, ({ key, n, paid, conv, frictionRate }) => ({ key, visits: n, paid, conv, frictionRate })),
    delivery: r.delivery, payTabs: r.payTabs, speed: r.speed, ratings: r.ratings,
    guide: r.guide ? { on: r.guide.on, off: r.guide.off, proven: r.guide.proven } : null,
    tests: lab.list().slice(0, 8).map((t) => ({ name: t.name || t.id, status: t.status, metric: lab.METRICS[t.metric] || t.metric, kept: t.kept || null, verdict: t.result?.verdict || null, chance: t.result?.chance ?? null, a: t.result?.a ? { n: t.result.a.n, c: t.result.a.c } : null, b: t.result?.b ? { n: t.result.b.n, c: t.result.b.c } : null })),
  };
}

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
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shop.css">
</head><body>
<header class="top"><div class="wrap top-row"><a class="logo" href="/#feat">VIBE<span>X</span></a>
<nav class="nav"><a href="/#rack">New drops</a><a class="nav-ig" href="https://www.instagram.com/vibex.india/" target="_blank" rel="noopener">Instagram ↗</a></nav></div></header>
<main class="wrap pdp" id="pdp" data-id="${escHtml(id)}"></main>
<div class="toast" id="toast" role="status" hidden></div>
<script src="/config.js"></script><script src="/art.js"></script><script src="/order.js"></script><script src="/vendor/qrcode.js"></script><script src="/checkout.js"></script><script src="/bag.js"></script><script src="/pdp.js"></script><script src="/salebar.js"></script><script src="/newtab.js"></script><script src="/track.js"></script><script src="/lab.js"></script><script src="/guide.js"></script><script src="/rush.js"></script><script src="/race.js"></script>
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
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/vendor/phosphor/style.css">
<link rel="stylesheet" href="/shop.css">
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="nav-wrap"><nav class="nav" aria-label="Main">
<a class="logo" href="/#feat" aria-label="Vibe X, go to Featured">Vibe<span>X</span></a>
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
<script src="/config.js"></script>${scripts.map((src) => `<script src="${src}"></script>`).join("")}<script src="/ui.js"></script><script src="/newtab.js"></script><script src="/track.js"></script><script src="/lab.js"></script><script src="/guide.js"></script><script src="/rush.js"></script><script src="/race.js"></script>
</body></html>`;
}

// v1 frame (surplus style) for policy and 404 pages.
function v1Shell({ title, head = "", body, scripts = [] }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
${head}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shop.css">
</head><body>
<header class="top"><div class="wrap top-row"><a class="logo" href="/#feat">VIBE<span>X</span></a>
<nav class="nav" aria-label="Main"><a href="/#rack">New drops</a><a href="/#visit">Visit</a><a class="nav-ig" href="https://www.instagram.com/vibex.india/" target="_blank" rel="noopener">Instagram ↗</a></nav></div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap"><div class="foot-mark">VIBE<span>X</span></div>
<div class="foot-row mono"><span>© Vibe X · The Surplus Room</span><span>World brands, one destination</span></div>
<nav class="foot-links" aria-label="Policies"><a href="/returns">Returns and refunds</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a></nav></div></footer>
${scripts.length ? `<div class="toast" id="toast" role="status" hidden></div><script src="/config.js"></script>${scripts.map((src) => `<script src="${src}"></script>`).join("")}` : ""}<script src="/newtab.js"></script><script src="/track.js"></script><script src="/lab.js"></script><script src="/guide.js"></script><script src="/rush.js"></script><script src="/race.js"></script>
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
// Canonical link + Open Graph tags for pages whose HTML is not built per request.
function canonicalHead(req, urlPath, title, desc) {
  const origin = siteOrigin(req);
  const tags = [["og:type", "website"], ["og:site_name", SHOP.name], ["og:title", title], ["og:description", desc], ["og:url", origin + urlPath], ["og:image", origin + "/logo.jpg"]]
    .map(([k, v]) => `<meta property="${k}" content="${escHtml(v)}">`).join("\n");
  return `<link rel="canonical" href="${escHtml(origin + urlPath)}">\n${tags}\n<meta name="twitter:card" content="summary">\n`;
}
function legalPage(req, res, key) {
  const page = legal.pages(SHOP)[key];
  const todo = legal.missing(SHOP);
  const banner = todo.length ? `<p class="draft">This page is being finalised. Still to add: ${escHtml(todo.join(", "))}.</p>` : "";
  const inner = `<p class="${SHELL === "v1" ? "label" : "eyebrow"}">Vibe X ${key === "contact" ? "" : "policies"}</p><h1>${escHtml(page.title)}</h1>
      ${banner}${page.html}`;
  const frame = SHELL === "v1" ? v1Shell : pageShell;
  send(res, 200, frame({
    title: `${page.title} · Vibe X`,
    head: `<meta name="description" content="${escHtml(page.summary)}">\n` + canonicalHead(req, "/" + key, `${page.title} · Vibe X`, page.summary),
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

// Visitors, for the owner's /analytics page. Kept on the disk, and written out before a restart.
// People who arrived too late for a piece. Their number is kept only for this, and goes after 30 days.
const WAITING = path.join(STORE, "waitlist.json");
const saveWaiting = (list) => fs.writeFileSync(WAITING, JSON.stringify(list, null, 1));
const loadWaiting = () => { try { const cut = Date.now() - 30 * 864e5; return JSON.parse(fs.readFileSync(WAITING, "utf8")).filter((w) => Date.parse(w.at) > cut); } catch { return []; } };
function kitData() {
  const sold = new Map(loadActivity().filter((a) => a.type === "sold").map((a) => [a.id, Date.parse(a.at)]));
  const items = load().filter(isPublic).filter((p) => !p.needsName && p.price);
  const pieces = items.map((p) => { const at = sold.get(p.id), made = Date.parse(p.createdAt); return { id: p.id, code: p.code, name: p.name, brand: p.brand, price: p.price, mrp: p.mrp, image: p.image, status: p.status, left: billing.stockOf(p), madeAt: made, soldAt: at || 0, soldInMs: at && at > made ? at - made : 0 }; }).sort((a, b) => (b.soldAt || b.madeAt) - (a.soldAt || a.madeAt));
  const status = new Map(items.map((p) => [p.id, p.status]));
  return { pieces, waiting: loadWaiting().map((w) => ({ ...w, back: status.get(w.productId) === "available" })).sort((a, b) => Number(b.back) - Number(a.back)) };
}
const holds = require("./lib/holds")();
// A piece with one size has nothing to choose, so the page sends none: the same rule as an order, or a hold wouldn't protect it.
// One piece left in all, with no count per size: it is one piece whatever size is named, so it gets one hold.
const onePieceInAll = (p) => Boolean(p) && !p.sizeStock && billing.stockOf(p) === 1;
function holdSize(p, size) { if (onePieceInAll(p)) return ""; const options = p ? optionsOf(p) : []; return options.length === 1 ? options[0].size || "" : String(size || ""); }
// The 15 second race for a last piece (lib/races.js). shop.json -> rush.race switches it on.
const races = require("./lib/races")();
const RACE_ON = SHOP.rush?.race === true;
// Visitors who have a last piece in their bag and are on the site now, on any page. Their own page says so every few
// seconds (lib/race.js), and it only counts while the shop can really see them here.
const bagWatch = new Map(), BAG_SEEN_MS = 20e3; // product id -> Map(visitor -> when)
function bagHolders(id, add) {
  const t = Date.now();
  let m = bagWatch.get(id);
  if (add && analytics.isActive(add)) { if (!m) bagWatch.set(id, (m = new Map())); if (m.size < 50 || m.has(add)) m.set(add, t); }
  if (!m) return [];
  for (const [who, at] of m) if (t - at > BAG_SEEN_MS || !analytics.isActive(who)) m.delete(who);
  if (!m.size) bagWatch.delete(id);
  return [...m.keys()];
}
// Only the true last piece gets a hold: with more in stock there's nothing to protect, and no reason to say so.
function isLastPiece(p, size) {
  const options = optionsOf(p), picked = options.find((o) => o.size === size);
  const left = picked?.left ?? billing.stockOf(p);
  return left === 1;
}
// A/B tests and screen recordings (lib/lab.js), fed by the same visitor events.
const lab = require("./lib/lab")({ STORE });
const REC_RATE = Math.max(0, Math.min(100, Number(process.env.REC_RATE ?? 25))); // % of visits recorded
SHOP.recRate = REC_RATE; // for the privacy page
// The number-only checkout form against the usual one: who opened each, who reached the pay screen, who paid.
// One count per visitor, from the site's own events (checkout carries the form in x).
const FORM_TEST = path.join(STORE, "form-test.json");
let formTally = readJson(FORM_TEST, { arms: {}, pay: {}, paid: {} }), formDirty = false;
function formSee(ev) {
  if (ev.e === "checkout" && (ev.x === "a" || ev.x === "b") && ev.v && !formTally.arms[ev.v]) { formTally.arms[ev.v] = ev.x; formDirty = true; }
  else if ((ev.e === "details" || ev.e === "paid") && formTally.arms[ev.v]) { const k = ev.e === "details" ? "pay" : "paid"; if (!formTally[k][ev.v]) { formTally[k][ev.v] = 1; formDirty = true; } }
}
function formResult() {
  const out = { a: { opened: 0, reachedPay: 0, paid: 0 }, b: { opened: 0, reachedPay: 0, paid: 0 } };
  for (const [v, arm] of Object.entries(formTally.arms)) { out[arm].opened++; if (formTally.pay[v]) out[arm].reachedPay++; if (formTally.paid[v]) out[arm].paid++; }
  return { a: { label: "Name and number", ...out.a }, b: { label: "Number only", ...out.b } };
}
setInterval(() => { if (formDirty) { writeJson(FORM_TEST, formTally); formDirty = false; } }, 15e3).unref();
// Names for the analytics page. Several listed pieces can share a name (eleven "Uspa Sweater"), so those carry their lot too.
let anNames = { at: 0, map: {} };
function analyticsNames() {
  if (Date.now() - anNames.at < 5000) return anNames.map;
  const list = load(), key = (p) => String(p.name || "").trim().toLowerCase(), times = {};
  for (const p of list) if (isPublic(p)) times[key(p)] = (times[key(p)] || 0) + 1;
  anNames = { at: Date.now(), map: Object.fromEntries(list.map((p) => [p.id, isPublic(p) && times[key(p)] > 1 ? `${p.name} · ${lotOf(p)}` : p.name])) };
  return anNames.map;
}
// Everything listed on the website right now, so a piece nobody has looked at still shows up in the report.
const analyticsCatalog = () => { const names = analyticsNames(); return load().filter(isPublic).map((p) => ({ id: p.id, name: names[p.id] || p.name, code: lotOf(p), category: p.category || "", subcategory: p.subcategory || "", price: p.price || 0, stock: billing.stockOf(p), status: p.status || "", image: p.image || "", wardrobe: Boolean(p.wardrobe), createdAt: p.createdAt || "" })); };
const analytics = createAnalytics({ onEvent: (ev) => { lab.see(ev); formSee(ev); }, STORE, productName: (id) => analyticsNames()[id] || id, productNames: analyticsNames, catalog: analyticsCatalog });
// SIGTERM (a deploy or restart): see shutdown() next to the server below.

// ---- Customer accounts (lib/accounts.js): bag, wishlist, address, orders, coins ----
const accounts = createAccounts({ STORE, coinsConfig: SHOP.coins || {} });
const COOKIE = "vxs";
const cookieOf = (req) => { const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`).exec(req.headers.cookie || ""); return m ? m[1] : ""; };
const customerOf = (req) => accounts.byToken(cookieOf(req));
// HttpOnly: page scripts (and anything injected into them) can't read it. Secure on the live site.
function setSession(req, res, token) {
  const secure = process.env.RENDER || String(req.headers["x-forwarded-proto"] || "").startsWith("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? Math.floor(accounts.SESSION_MS / 1000) : 0}${secure}`);
}
// What a signed-in customer's own page shows about their orders.
function myOrders(c) {
  const items = load();
  return loadOrders().filter((o) => o.customerId === c.id).slice(-50).reverse().map((o) => ({
    id: o.id, code: o.code, status: o.status, createdAt: o.createdAt, amount: o.amount, shipping: o.shipping || 0, coinsUsed: o.coinsUsed || 0, delivery: o.delivery,
    lines: orderLines(o).map((l) => ({ productId: l.productId, name: l.productName, size: l.size || "", qty: l.qty, price: l.price, image: items.find((x) => x.id === l.productId)?.image || null })),
  }));
}
const accountView = (c) => ({ ...accounts.view(c), orders: myOrders(c) });

async function accountApi(req, res, route) {
  const body = async (n = 16 * 1024) => { try { return JSON.parse((await readBody(req, n)) || "{}"); } catch { return null; } };
  const post = req.method === "POST", me = customerOf(req);
  if (req.method === "GET" && route === "me") return send(res, 200, me ? accountView(me) : { signedIn: false });
  // The bag priced by the server: what checkout shows, and what the order will charge.
  if (post && route === "quote") {
    const b = await body();
    if (!b) return send(res, 400, { error: "Bad request." });
    const q = priceBag(b.lines || [], { pin: String(b.pin || ""), delivery: b.delivery === "ship" ? "ship" : "pickup", holdToken: String(b.holdToken || "") });
    if (q.error) return send(res, 200, { lines: [], goods: 0, shipping: 0, problems: [], empty: true });
    const coins = me ? accounts.usable(me, q.goods) : 0;
    return send(res, 200, { lines: q.lines.map(({ _p, ...l }) => l), goods: q.goods, shipping: q.shipping, kg: q.chargedKg, weightKg: q.kg, inside: q.inside, problems: q.problems, coinsUsable: coins, coinsBalance: me ? accounts.balance(me) : 0, redeemOn: accounts.redeemOn() });
  }
  // Before a phone's first order there's no account: its bag and wishlist stay in the browser.
  if (!me) return send(res, 200, { signedIn: false });
  if (post && route === "bag") { const b = await body(); return b ? send(res, 200, { bag: accounts.setBag(me.id, b.bag).bag }) : send(res, 400, { error: "Bad request." }); }
  if (post && route === "wish") { const b = await body(); return b ? send(res, 200, { wish: accounts.setWish(me.id, b.wish).wish }) : send(res, 400, { error: "Bad request." }); }
  if (post && route === "address") { const b = await body(); return b ? send(res, 200, { address: accounts.setAddress(me.id, b).address }) : send(res, 400, { error: "Bad request." }); }
  return send(res, 404, { error: "not found" });
}

// Newest video on the shop's channel: checked hourly here, so no visitor ever waits on YouTube.
const latestVideo = videoFeed({ ...SHOP.youtube, file: path.join(STORE, "latest-video.json") });
if (SHOP.youtube?.channelId) {
  latestVideo.refresh();
  setInterval(() => latestVideo.refresh(), 3600e3).unref();
}

function sendConfig(res) {
  const pub = { ...SHOP, lab: { tests: lab.publicTests(), rec: REC_RATE }, accounts: { coins: { perRupees: SHOP.coins?.perRupees || 100, maxPct: SHOP.coins?.maxPct || 10 } }, pay: { ...SHOP.pay, window: PAY_WINDOW, closedText: payWindow.closedText(PAY_WINDOW) }, orderingOpen: ORDERING_OPEN, latestVideo: latestVideo.current() };
  res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
  return res.end(`window.SHOP = ${JSON.stringify(pub).replace(/</g, "\\u003c")};\n`);
}

function productMeta(req, id) {
  const p = load().filter(isPublic).find((x) => x.id === id);
  // Hosts like Render sit behind HTTPS and pass the real scheme in x-forwarded-proto.
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const origin = siteUrl() || `${proto}://${req.headers.host}`;
  const title = p ? `${p.name}${p.price ? ` · ₹${p.price.toLocaleString("en-IN")}` : ""} · Vibe X` : "Vibe X · The Surplus Room";
  const desc = p?.description ? p.description.slice(0, 200) : p
    ? [p.brand, p.category, p.sizes, p.status === "sold" ? "Sold" : "In stock at Vibe X, Srinagar"].filter(Boolean).join(" · ")
    : "Original world-brand surplus. Srinagar, Kashmir.";
  const og = [
    ["og:type", "product"], ["og:site_name", "Vibe X"], ["og:title", title], ["og:description", desc],
    ["og:url", `${origin}/p/${encodeURIComponent(id)}`],
    ...(p && p.image ? [["og:image", origin + p.image], ["og:image:alt", p.name]] : []),
  ].map(([k, v]) => `<meta property="${k}" content="${escHtml(v)}">`).join("\n");
  // Canonical link and Product JSON-LD: only fields the product really has (no ratings, reviews, GTINs or condition claims).
  let ld = "";
  if (p) {
    const url = `${origin}/p/${encodeURIComponent(id)}`;
    const product = {
      "@context": "https://schema.org", "@type": "Product", name: p.name, url,
      ...(p.description ? { description: p.description.slice(0, 500) } : {}),
      ...(p.image ? { image: origin + p.image } : {}),
      ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
      ...(p.category ? { category: p.category } : {}),
      ...(p.code ? { sku: String(p.code) } : {}),
      ...(p.price ? { offers: { "@type": "Offer", url, price: String(p.price), priceCurrency: "INR", availability: billing.stockOf(p) > 0 && p.status !== "sold" ? "https://schema.org/InStock" : "https://schema.org/SoldOut", seller: { "@type": "Store", name: SHOP.name } } } : {}),
    };
    const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: SHOP.name, item: origin + "/" },
      { "@type": "ListItem", position: 2, name: p.name, item: url },
    ] };
    ld = [product, crumbs].map((o) => `\n<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("");
  }
  const canon = p ? `<link rel="canonical" href="${escHtml(`${origin}/p/${encodeURIComponent(id)}`)}">\n` : "";
  const head = `${canon}<meta name="description" content="${escHtml(desc)}">\n${og}\n<meta name="twitter:card" content="${p && p.image ? "summary_large_image" : "summary"}">${ld}`;
  return { p, title, head };
}

// The customer's own pages. Everything on them is drawn by account.js from /api/account/me.
function accountPage(res, which) {
  const page = {
    title: which === "bag" ? "Your bag · Vibe X" : "My account · Vibe X",
    head: `<meta name="robots" content="noindex">`,
    scripts: ["/art.js", "/order.js", "/vendor/qrcode.js", "/checkout.js", "/bag.js", "/account.js"],
  };
  const inner = `<div class="acct" id="acct" data-view="${which}"><p class="acct-load">Loading…</p></div>`;
  send(res, 200, SHELL === "v1" ? v1Shell({ ...page, body: inner }) : pageShell({ ...page, body: `<div class="page-top"><main class="wrap">${inner}</main></div>` }), "text/html; charset=utf-8");
}

// robots.txt and sitemap.xml for Google. The sitemap is built from the live product list, so a new
// piece appears in it by itself. Owner, billing, account and API paths are kept out of search.
function siteOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return siteUrl() || `${proto}://${req.headers.host}`;
}
function robotsTxt(req) {
  return [
    "User-agent: *", "Allow: /",
    "Disallow: /api/", "Disallow: /billing", "Disallow: /analytics", "Disallow: /kit", "Disallow: /bag", "Disallow: /account", "Disallow: /bill/", "Disallow: /preview/",
    "", `Sitemap: ${siteOrigin(req)}/sitemap.xml`, "",
  ].join("\n");
}
function sitemapXml(req) {
  const origin = siteOrigin(req);
  const pages = ["/", "/wardrobe", "/returns", "/terms", "/privacy", "/contact"];
  const urls = [...pages, ...load().filter(isPublic).map((x) => `/p/${encodeURIComponent(x.id)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${escHtml(origin + u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

// llms.txt: a plain-text summary of the shop for AI search. Only facts from shop.json.
function llmsTxt(req) {
  const origin = siteOrigin(req);
  const b = SHOP.business || {};
  const pol = SHOP.policy || {};
  const c = pol.courier || {};
  const L = [`# ${SHOP.name}`, "", `> ${SHOP.name} (${SHOP.tagline || "surplus store"}) sells original world-brand surplus clothing, footwear and fragrances from ${SHOP.city}, with shipping across India.`, ""];
  L.push("## Store", "");
  if (b.legalName) L.push(`- Legal name: ${b.legalName}`);
  if (b.address) L.push(`- Address: ${b.address}`);
  if (b.phone) L.push(`- Phone / WhatsApp: ${b.phone}`);
  if (SHOP.maps) L.push(`- Map: ${SHOP.maps}`);
  if (SHOP.instagram) L.push(`- Instagram: ${SHOP.instagram}`);
  if (SHOP.youtube && SHOP.youtube.channel) L.push(`- YouTube: ${SHOP.youtube.channel}`);
  L.push("", "## Shipping and returns", "");
  if (pol.dispatchWorkingDays) L.push(`- Orders are dispatched within ${pol.dispatchWorkingDays} working days.`);
  if (pol.deliveryDays) L.push(`- Delivery takes ${pol.deliveryDays} days after dispatch.`);
  if (c.perKg) L.push(`- Courier charge: Rs ${c.perKg} per kg outside Kashmir${c.insideKashmirPerKg ? `, Rs ${c.insideKashmirPerKg} per kg inside Kashmir` : ""}, charged per started kg.`);
  if (pol.changeOfMindDays) L.push(`- Change-of-mind returns within ${pol.changeOfMindDays} days (see ${origin}/returns for the full terms).`);
  if (pol.damageReportHours) L.push(`- Report a damaged or wrong piece within ${pol.damageReportHours} hours of delivery.`);
  if (pol.refundWorkingDays) L.push(`- Refunds are made within ${pol.refundWorkingDays} working days.`);
  L.push("- Each piece is one of a few, so sizes are limited. Prices are in Indian rupees (INR).", "", "## Pages", "",
    `- [Shop (home)](${origin}/): featured pieces and shop details`,
    `- [Wardrobe](${origin}/wardrobe): browse the pieces`,
    `- [Returns](${origin}/returns)`, `- [Terms](${origin}/terms)`, `- [Privacy](${origin}/privacy)`, `- [Contact](${origin}/contact)`,
    `- [Sitemap](${origin}/sitemap.xml): every product page, /p/<id>`, "");
  return L.join("\n");
}

// Home page: the static file plus canonical, Open Graph and Store JSON-LD. Only facts from shop.json.
function homeHead(req) {
  const origin = siteOrigin(req);
  const b = SHOP.business || {};
  const title = "Vibe X · The Surplus Store, Srinagar";
  const desc = "Original world-brand surplus clothing, footwear and fragrances. Srinagar, Kashmir. Pan-India shipping.";
  const parts = String(b.address || "").split(",").map((x) => x.trim()).filter(Boolean);
  const pin = (String(b.address || "").match(/\b(\d{6})\s*$/) || [])[1];
  const ld = {
    "@context": "https://schema.org", "@type": "Store", "@id": origin + "/#store",
    name: SHOP.name, url: origin + "/", description: desc, image: origin + "/logo.jpg",
    ...(b.phone ? { telephone: b.phone } : {}),
    ...(b.address ? { address: { "@type": "PostalAddress", streetAddress: parts.slice(0, -2).join(", ") || b.address, addressLocality: "Srinagar", addressRegion: "Jammu and Kashmir", ...(pin ? { postalCode: pin } : {}), addressCountry: "IN" } } : {}),
    ...(b.legalName ? { legalName: b.legalName } : {}),
    ...(b.email ? { email: b.email } : {}),
    ...(SHOP.maps ? { hasMap: SHOP.maps } : {}),
    sameAs: [SHOP.instagram, SHOP.youtube && SHOP.youtube.channel].filter(Boolean),
  };
  const og = [["og:type", "website"], ["og:site_name", SHOP.name], ["og:title", title], ["og:description", desc], ["og:url", origin + "/"], ["og:image", origin + "/logo.jpg"]]
    .map(([k, v]) => `<meta property="${k}" content="${escHtml(v)}">`).join("\n");
  return `<link rel="canonical" href="${escHtml(origin + "/")}">\n${og}\n<meta name="twitter:card" content="summary">\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n`;
}
// Visible FAQ + FAQPage JSON-LD. Every answer is built from shop.json policy values already shown on the policy pages.
function homeFaq() {
  const b = SHOP.business || {}, pol = SHOP.policy || {}, c = pol.courier || {};
  const qa = [];
  if (pol.dispatchWorkingDays && pol.deliveryDays) qa.push(["How long does delivery take?", `Orders are dispatched within ${pol.dispatchWorkingDays} working days, and delivery takes ${pol.deliveryDays} days after dispatch. We ship anywhere in India.`]);
  if (c.perKg) qa.push(["How much is the courier charge?", `Rs ${c.perKg} per kg outside Kashmir${c.insideKashmirPerKg ? ` and Rs ${c.insideKashmirPerKg} per kg inside Kashmir` : ""}, charged per started kg.`]);
  if (pol.changeOfMindDays) qa.push(["Can I return something I changed my mind about?", `Yes, within ${pol.changeOfMindDays} days. The full terms are on the Returns page.`]);
  if (pol.damageReportHours) qa.push(["What if my piece arrives damaged or wrong?", `Tell us within ${pol.damageReportHours} hours of delivery.${pol.refundWorkingDays ? ` Refunds are made within ${pol.refundWorkingDays} working days.` : ""}`]);
  qa.push(["How do I pay?", "Pay by UPI when you order, or message us on WhatsApp about the exact piece."]);
  if (b.address) qa.push(["Where is the store?", `${SHOP.name} is at ${b.address}. You can pick a piece up in person or have it shipped.`]);
  if (qa.length < 2) return { html: "", ld: "" };
  const html = `<section class="faq wrap" id="faq" aria-labelledby="faq-h">
    <header class="sec-head"><h2 class="sec-h" id="faq-h">Questions</h2></header>
    <div class="faq-list">${qa.map(([q, a]) => `<details><summary>${escHtml(q)}</summary><p>${escHtml(a)}</p></details>`).join("")}</div>
  </section>

  `;
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qa.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return { html, ld: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n` };
}
function homePage(req, res) {
  let html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const faq = homeFaq();
  html = html.replace("</head>", () => homeHead(req) + faq.ld + "</head>");
  if (faq.html) html = html.replace('<section class="store wrap" id="visit"', () => faq.html + '<section class="store wrap" id="visit"');
  send(res, 200, html, "text/html; charset=utf-8", "no-cache");
}

function wardrobePage(req, res) {
  let html = fs.readFileSync(path.join(PUBLIC, "wardrobe.html"), "utf8");
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
  html = html.replace("</head>", () => canonicalHead(req, "/wardrobe", "The Wardrobe · Vibe X", desc) + "</head>");
  send(res, 200, html, "text/html; charset=utf-8", "no-cache");
}

function productPage(req, res, id) {
  const { p, title, head } = productMeta(req, id);
  const html = SHELL === "v1"
    ? legacyProductPage(title, head, id)
    : pageShell({
        title, head,
        body: `<div class="page-top"><main class="wrap pdp" id="pdp" data-id="${escHtml(id)}"></main></div>`,
        scripts: ["/art.js", "/order.js", "/vendor/qrcode.js", "/checkout.js", "/bag.js", "/pdp.js", "/salebar.js"],
      });
  send(res, p ? 200 : 404, html, "text/html; charset=utf-8");
}

const rupees = (n) => (n ? `₹${n.toLocaleString("en-IN")}` : "price on request");
// What the website can show. saveImage() takes the same three.
const IMAGE_OK = /^data:image\/(jpeg|png|webp);base64,./;
const PHOTO_ONLY = "📷 I can only use photos (JPG/PNG). Please send it as a photo, not a file/video.";
const NO_PHOTO_HELP = "📸 To post a product, send its *photo* (name and price in the caption if you like).\nTo sell: *sold 4795* · stock: *stock 4795 5* · orders: *orders*\nSend *help* for every command.";

// "stock": the shop's stock in a few lines.
function stockSummary(items = load()) {
  const n = billing.stockOf;
  const inStock = items.filter((p) => n(p) > 0);
  const live = inStock.filter(isPublic).length;
  const low = items.filter((p) => n(p) > 0 && n(p) <= (p.reorderAt ?? 1)).length;
  const out = items.filter((p) => n(p) === 0 && isPublic(p)).length;
  return `📦 *Stock:* ${inStock.length} item${inStock.length === 1 ? "" : "s"} in stock, ${inStock.reduce((t, p) => t + n(p), 0)} pieces · ${live} on the website\n${low ? `⚠️ ${low} running low: send *low* to see them\n` : ""}${out ? `${out} sold out on the website\n` : ""}\nTo change one: *stock 4795 5* (set the count) · *add 4795 2* · *sold 4795*`;
}
// "orders": website orders still waiting for the owner to confirm or cancel.
function ordersReply() {
  const open = loadOrders().filter(toConfirm);
  if (!open.length) return "🛍️ No website orders waiting. New ones come here the moment a customer orders.";
  const left = (o) => { const t = lapsesAt(o); return t ? ` · ${Math.max(0, Math.round((t - Date.now()) / 60e3))} min left` : ""; };
  const lines = open.slice(-10).map((o) => `• *${o.code}* · ${inr(o.amount)} · ${o.name} · ${o.productName}${left(o)}`);
  return `🛍️ *${open.length} website order${open.length === 1 ? "" : "s"} waiting*\n${lines.join("\n")}${open.length > 10 ? `\n…and ${open.length - 10} more in /billing` : ""}\n\nWhen the money is in your bank: *confirm ${open[0].code}* (or *cancel ${open[0].code}*)`;
}

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
  let photos = Array.isArray(body.photos) ? body.photos.filter((x) => x && x.image).slice(0, 50) : [];
  // Only JPG/PNG/WebP can go on the website. A video, GIF or iPhone HEIC file is never posted without a photo.
  const unusable = photos.filter((x) => !IMAGE_OK.test(String(x.image))).length;
  if (unusable) {
    photos = photos.filter((x) => IMAGE_OK.test(String(x.image)));
    if (!photos.length) return { reply: PHOTO_ONLY };
    const out = await ownerMessage(photos.length > 1 ? { photos } : photos[0]);
    return { ...out, reply: `⚠️ ${unusable} of ${unusable + photos.length} weren't photos I can use (JPG/PNG only). Please send those again as photos.\n\n${out.reply || ""}` };
  }
  // An album: photos for an item in stock ("photos 4795"), or ask whether it's one item or several.
  if (photos.length > 1) return routePhotos(photos) || albumMessage(photos);
  if (photos.length === 1) body = photos[0];
  if (body.unsupported || (body.image && !IMAGE_OK.test(String(body.image)))) return { reply: PHOTO_ONLY };
  // "bik gaya 4795" -> "sold 4795", "sold 2,342" -> "sold 2342" (only for command-looking text).
  const text = normaliseCommand(String(body.text || "").slice(0, 1000));
  if (!text.trim() && !body.image) return { status: 400, error: "empty message" };

  // A photo with an imported item's code: that item goes on the website.
  if (body.image) {
    const routed = routePhotos([{ text: body.text, image: body.image }]);
    if (routed) return routed;
    const live = photoForImported(text, body.image);
    if (live) return live;
    if (smallState(ALBUM)) return albumMessage([{ text: body.text, image: body.image }]); // joins the album still waiting
  }
  const asked = !body.image && askForPhotos(text);
  if (asked) return asked;
  const items = load();
  const stockReply = stockCommand(text);
  if (stockReply) return { reply: stockReply };
  const orderReply = orderCommand(text);
  if (orderReply) return { reply: orderReply };
  // "coins on" / "coins off": customers can spend their coins only while the owner says so.
  const cm = /^coins?(?:\s+(on|off))?$/i.exec(text.trim());
  if (cm) {
    const on = cm[1] ? accounts.setRedeem(cm[1].toLowerCase() === "on") : accounts.redeemOn();
    const people = accounts.list().filter((c) => accounts.balance(c) > 0);
    const total = people.reduce((n, c) => n + accounts.balance(c), 0);
    return { reply: `🪙 Coins: customers earn 1 coin for every ${inr(SHOP.coins?.perRupees || 100)} they pay (1 coin = ₹1).\nSpending is *${on ? "ON" : "OFF"}*${on ? `: coins can pay up to ${SHOP.coins?.maxPct || 10}% of a bag.` : "."}\n${people.length} customer${people.length === 1 ? " has" : "s have"} ${total} coins in all.\nSend *coins ${on ? "off" : "on"}* to switch it ${on ? "off" : "on"}.` };
  }
  if (/^(stats|report|status|aaj|today)$/i.test(text.trim())) return { reply: statsReply() };
  if (/^(bills?|sales|hisab|hisaab)$/i.test(text.trim())) return { reply: billsReply() };
  if (/^(low|low stock|kam)$/i.test(text.trim())) return { reply: reports.lowText() };
  if (!body.image && /^(stock|stocks|inventory|maal)[.!?]*$/i.test(text.trim())) return { reply: stockSummary(items) };
  if (!body.image && /^(orders?|online orders?|website orders?)[.!?]*$/i.test(text.trim())) return { reply: ordersReply() };
  const album = !body.image && (await albumReply(text));
  if (album) return album;
  const cleared = !body.image && (clearCommand(text) || choiceReply(text));
  if (cleared) return cleared;
  const batched = !body.image && batchReply(text);
  if (batched) return batched;
  const parsed = parseMessage(text);
  // "sold puffer" / "remove 2342" are commands even while a draft waits for an answer (it used to take
  // them as the item's name). A bare "delete" while a draft is open still means drop that draft.
  const isCommand = parsed.type === "command" && !(CANCEL.test(text.trim()) && !parsed.query && loadPending().length);
  const draft = !isCommand && draftReply(text, Boolean(body.image));
  if (draft) return draft;

  if (parsed.type === "command") {
    const want = parsed.action === "restock" ? "sold" : parsed.action === "sold" ? "available" : null;
    // "remove" only takes things off the website, so it only looks at what's on the website.
    const verb = parsed.action === "restock" ? "restock" : parsed.action;
    const found = findTarget(parsed.action === "remove" ? items.filter(isPublic) : items, parsed.query, want, verb);
    if (!found.p) return { reply: found.reply };
    const target = found.p;
    if (parsed.action === "remove") {
      // This is his inventory too, so the item stays for billing and its bills stay whole.
      target.hidden = true;
      target.wasLive = true;
      save(items);
      return { reply: `👁️ “${target.name}” is off the website. It's still in your stock for billing.\nTo show it again, tick *Show on website* in Items.` };
    }
    if (parsed.action === "sold") {
      if (target.status === "sold") return { reply: `“${target.name}” (#${target.code}) is already sold out.` };
      const r = billing.sell([{ productId: target.id, qty: 1 }], { source: "whatsapp" });
      if (r.error) return { reply: `⚠️ ${r.error}` };
      const left = billing.stockOf(r.products.find((x) => x.id === target.id));
      const bill = `🧾 Bill ${r.invoice.number} · ${inr(r.invoice.total)}: ${billUrl(r.invoice)}`;
      return { reply: left > 0
        ? `🏷️ One “${target.name}” sold. ${left} left on the website.\n${bill}\nReply *sold ${target.code}* again for the next one.`
        : `🏷️ Marked “${target.name}” as SOLD.\n${bill}` };
    }
    target.status = "available";
    if (parsed.action === "restock" && !target.quantity) target.quantity = 1;
    save(items);
    return { reply: `✅ “${target.name}” is back in stock.` };
  }

  // Words with no photo never start a post: a product can't go live without its picture.
  if (!body.image) return { reply: NO_PHOTO_HELP };
  const item = await makeDraft(text, body.image, parsed);
  if (!item.image) return { reply: PHOTO_ONLY };
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
  if (!p.wasLive) p.createdAt = new Date().toISOString(); // new from today, not from the day it was imported
  save(items);
  const win = celebrate(p);
  const left = billing.stockOf(p);
  return { reply: `🎉 *“${p.name}” is on your website!*\n📲 Post it to your Status: ${siteUrl() || ""}/kit\n🔢 Code *${p.code}* · ${left > 0 ? `${left} in stock` : "shows as sold out: send *add " + p.code + " 1* when you have stock"}\n📈 ${win.postedToday} posted today · 🛍️ ${win.live} live` };
}

// ---- Several photos of one item ----
// An album (2+ photos sent together) waits in wa-album.json while the bot asks: one item with all of
// them, or separate items? "photos 4795" (or a photo captioned "photos 4795" / "+4795") adds photos to
// an item already in stock instead; "main 4795" makes the photo its main one.
const MAX_PHOTOS = billing.MAX_PHOTOS;
const ALBUM = path.join(STORE, "wa-album.json");
const ADD_TO = path.join(STORE, "wa-add-photos.json"); // after "photos 4795": where the next photos go
const ADD_MS = 15 * 60e3;
const smallState = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const dropUpload = (u) => { if (u) try { fs.unlinkSync(path.join(UPLOADS, path.basename(u))); } catch { /* gone */ } };
const uploadData = (u) => {
  const ext = path.extname(u).slice(1).toLowerCase();
  return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs.readFileSync(path.join(UPLOADS, path.basename(u))).toString("base64")}`;
};
const photoCount = (p) => [p.image, ...(p.images || [])].filter(Boolean).length;
const byCode = (items, code) => items.find((x) => x.code === code) || items.find((x) => x.barcode === code);
const WORD_PHOTOS = /^(?:add\s+)?(?:photos?|pics?|pictures?)\s+(?:to\s+|for\s+)?#?(\d{4,13})$/i;
const PLUS_PHOTOS = /^\+\s*#?(\d{4,13})$/; // as a caption only: "+4795" on its own is "add 1 to stock"
const MAIN_PHOTO = /^main(?:\s+photo)?\s+(?:for\s+)?#?(\d{4,13})$/i;
function photoTarget(text, caption) {
  const t = String(text || "").trim();
  let m;
  if ((m = WORD_PHOTOS.exec(t)) || (caption && (m = PLUS_PHOTOS.exec(t)))) return { code: m[1], main: false };
  if ((m = MAIN_PHOTO.exec(t))) return { code: m[1], main: true };
  return null;
}
// "photos 4795" with no photo: the next photos (within 15 minutes) go to that item.
function askForPhotos(text) {
  const t = photoTarget(text, false);
  if (!t) return null;
  const p = byCode(load(), t.code);
  if (!p) return { reply: `I couldn't find item *${t.code}*. The code is the LOT number on the website (or the item's barcode).` };
  const have = photoCount(p);
  if (have >= MAX_PHOTOS) return { reply: `“${p.name}” (#${p.code}) already has ${MAX_PHOTOS} photos, the most an item can have. Remove some in /billing first.` };
  writeJson(ADD_TO, { code: p.code, main: t.main, at: Date.now() });
  return { reply: t.main
    ? `📸 Send the new main photo for “${p.name}” (#${p.code}).`
    : `📸 Send the photos of “${p.name}” (#${p.code}) now. All together is fine.\nIt has ${have} photo${have === 1 ? "" : "s"}, room for ${MAX_PHOTOS - have} more.` };
}
// Adds photos (data URLs) to an item. The main photo stays unless main is set.
function addPhotos(code, images, { main = false } = {}) {
  let p = byCode(load(), code);
  if (!p) return { reply: `I couldn't find item *${code}*. The code is the LOT number on the website (or the item's barcode). Nothing was added.` };
  const before = photoCount(p);
  if (before >= MAX_PHOTOS) return { reply: `“${p.name}” (#${p.code}) already has ${MAX_PHOTOS} photos, the most an item can have. Remove some in /billing first, then send them again.` };
  const take = images.slice(0, MAX_PHOTOS - before), left = images.length - take.length;
  let added = 0, failed = 0, first = null;
  for (const [i, img] of take.entries()) {
    const r = billing.photos(p.id, { add: img }, (d) => saveImage(d, `${p.id}-${Date.now().toString(36)}${i}`));
    if (r.error) { failed++; continue; }
    p = r.product; added++;
    if (!first) first = [p.image, ...(p.images || [])].filter(Boolean).at(-1);
  }
  if (!added) return { reply: "⚠️ I couldn't read those photos. Please send them again as photos." };
  if (main && first && first !== p.image) { const r = billing.photos(p.id, { main: first }, () => null); if (!r.error) p = r.product; }
  const now = photoCount(p);
  const lines = [main
    ? `📸 New main photo for “${p.name}” (now ${now} photo${now === 1 ? "" : "s"}).${added > 1 ? ` The other ${added - 1} went in after it.` : ""}`
    : `📸 Added ${added} photo${added === 1 ? "" : "s"} to “${p.name}” (now ${now}). ${before ? "Main photo unchanged." : "The first one is its main photo."}`];
  if (left) lines.push(`⚠️ ${left} left out: an item can have ${MAX_PHOTOS} photos at most.`);
  if (failed) lines.push(`⚠️ ${failed} couldn't be read. Please send ${failed === 1 ? "it" : "them"} again.`);
  if (p.hidden) lines.push("👁️ It isn't on the website yet. Tick *Show on website* in /billing when it's ready.");
  return { reply: lines.join("\n") };
}
// Photos that belong to an item already in stock, or null when they're new products.
// list: [{ text, image }]
function routePhotos(list) {
  const wait = smallState(ADD_TO);
  if (wait) try { fs.unlinkSync(ADD_TO); } catch { /* gone */ } // used now, or stale
  const target = list.map((x) => photoTarget(x.text, true)).find(Boolean) || (wait && Date.now() - wait.at < ADD_MS ? wait : null);
  if (target) return addPhotos(target.code, list.map((x) => x.image), { main: target.main });
  // An album with an imported item's code on one photo: that photo puts it on the website, the rest join it.
  if (list.length > 1) {
    const i = list.findIndex((x) => /^#?\d{4,13}$/.test(String(x.text || "").trim()));
    const code = i >= 0 ? String(list[i].text).trim().replace(/^#/, "") : null;
    if (code && load().some((x) => x.hidden && (x.code === code || x.barcode === code))) {
      const live = photoForImported(code, list[i].image);
      if (!live) return null;
      const p = byCode(load(), code);
      if (!p || p.hidden) return live; // no price or name yet: the reply says what's missing
      const more = addPhotos(p.code, list.filter((_, k) => k !== i).map((x) => x.image));
      return { ...live, reply: `${live.reply}\n\n${more.reply}` };
    }
  }
  return null;
}
// 2+ photos together: save them and ask. Photos sent while the question waits join the album.
function albumMessage(photos) {
  const old = smallState(ALBUM);
  const list = old?.photos || [];
  const tag = crypto.randomBytes(4).toString("hex");
  for (const [i, x] of photos.entries()) {
    if (list.length >= 50) break;
    const u = saveImage(x.image, `album-${tag}-${i}`);
    if (u) list.push({ text: String(x.text || "").slice(0, 1000), image: u });
  }
  if (!list.length) return { reply: PHOTO_ONLY };
  writeJson(ALBUM, { at: Date.now(), photos: list });
  return albumQuestion(list, old ? `📸 Got ${photos.length} more, ${list.length} in all.\n\n` : "");
}
function albumQuestion(list, lead = "") {
  const n = list.length, one = Math.min(n, MAX_PHOTOS);
  return {
    reply: `${lead}📸 Got ${n} photos together.\n\nIs it *one item, all ${n} photos* of it? Or are they *separate items*?${n > MAX_PHOTOS ? `\n\n(An item can have ${MAX_PHOTOS} photos, so as one item I'd keep the first ${MAX_PHOTOS}.)` : ""}`,
    buttons: [`One item (${one} photos)`, "Separate items"],
    photo: absolute(list[0].image),
  };
}
// The answer to albumQuestion(). Returns null when no album is waiting, or the text is a command.
async function albumReply(text) {
  const a = smallState(ALBUM);
  if (!a?.photos?.length) return null;
  const t = text.trim().replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const drop = () => { for (const x of a.photos) dropUpload(x.image); try { fs.unlinkSync(ALBUM); } catch { /* gone */ } };
  if (/^(one|1|single|same|ek)\b/i.test(t)) return albumOne(a);
  if (/^(separate|separately|alag|different|each|2)\b/i.test(t)) {
    const photos = a.photos.map((x) => ({ text: x.text, image: uploadData(x.image) }));
    drop();
    return batchMessage(photos);
  }
  if (/^(cancel|cancel all|clear|clear all|drop|discard|delete|start over)[.!]*$/i.test(t)) {
    drop();
    const rest = loadPending().length ? clearCommand("clear") : null;
    return { reply: `🗑️ Dropped the ${a.photos.length} photos. Nothing went on the website.${rest ? `\n\n${rest.reply}` : ""}` };
  }
  if (parseMessage(text).type === "command") return null;
  return albumQuestion(a.photos, `First, about the ${a.photos.length} photos you sent:\n\n`);
}
async function albumOne(a) {
  try { fs.unlinkSync(ALBUM); } catch { /* gone */ }
  const keep = a.photos.slice(0, MAX_PHOTOS), left = a.photos.length - keep.length;
  for (const x of a.photos.slice(MAX_PHOTOS)) dropUpload(x.image);
  const caption = a.photos.map((x) => x.text.trim()).find(Boolean) || "";
  const item = await makeDraft(caption, uploadData(keep[0].image));
  dropUpload(keep[0].image);
  if (!item.image) { keep.slice(1).forEach((x) => dropUpload(x.image)); return { reply: PHOTO_ONLY }; }
  // The rest are already on disk: they only get the draft's name.
  item.images = keep.slice(1).map((x, i) => {
    const name = `${item.id}-${i + 2}${path.extname(x.image)}`;
    try { fs.renameSync(path.join(UPLOADS, path.basename(x.image)), path.join(UPLOADS, name)); return `/uploads/${name}`; } catch { return null; }
  }).filter(Boolean);
  if (!item.images.length) delete item.images;
  const lead = left ? `⚠️ An item can have ${MAX_PHOTOS} photos, so I kept the first ${MAX_PHOTOS} and left out ${left}.\n\n` : "";
  const queue = loadPending();
  if (forgotten(queue)) { const out = askKeepOld(queue, [item]); return { ...out, reply: lead + out.reply }; }
  const open = queue.find((x) => x.batch);
  if (open) { item.batch = open.batch; queue.push(item); savePending(queue); return batchNext(queue, `${lead}📸 Added that one too.\n\n`); }
  queue.push(item);
  savePending(queue);
  if (queue.length > 1) return { reply: `${lead}📸 Got it, one item with ${photoCount(item)} photos. I'll ask about it once “${queue[0].listing.name}” is done.` };
  const out = step(queue[0], { fresh: true });
  return { ...out, reply: lead + out.reply };
}

async function makeDraft(text, imageData, parsed = parseMessage(text)) {
  // "Gucci Flora 50ml 2999 100ml 4999": read the sizes first so they don't end up in the name.
  const pairs = sizePairs(text);
  if (pairs.length) parsed = parseMessage(`${withoutSizePairs(text)} ${pairs[0].price}`);
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
        description: ai.description || rules.description,
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
  if (pairs.length) { listing = applySizePairs({ ...listing, category: "Fragrances" }, pairs); sure = true; }
  const id = crypto.randomBytes(6).toString("hex");
  return { id, listing, note, by, image: saveImage(imageData, id), sure, guess: listing.category };
}

// ---- Old, forgotten drafts ----
// Photos the owner never posted (he moved on, or cleared the chat on his phone, which doesn't
// reach us) shouldn't silently mix with new ones. If drafts have waited untouched for a while
// when new photos come in, ask first: just the new ones, or keep both. "clear" drops them all.
const STALE_MS = Number(process.env.DRAFT_STALE_MS) || 5 * 60e3;
const dropDraftImage = (x) => { for (const u of [x.image, ...(x.images || [])]) if (u) try { fs.unlinkSync(path.join(UPLOADS, path.basename(u))); } catch { /* gone */ } };
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
  if (items.some((x) => x.groupAsk)) return parseMessage(raw).type === "product" ? groupAnswer(queue, items, t) : null;
  const dropImage = (x) => { for (const u of [x.image, ...(x.images || [])]) if (u) try { fs.unlinkSync(path.join(UPLOADS, path.basename(u))); } catch { /* gone */ } };
  const todo = items.filter((x) => batchMissing(x).length);

  if (/^cancel all$/i.test(t)) {
    items.forEach(dropImage);
    savePending(queue.filter((x) => !x.batch));
    return { reply: `🗑️ Dropped all ${items.length} photos. Nothing went on the website.` };
  }
  if (!todo.length) {
    if (/^post all$/i.test(t)) {
      const live = items.filter((x) => x.image).map((x) => publish({ id: x.id, listing: x.listing, by: x.by, image: x.image, images: x.images }));
      savePending(queue.filter((x) => !x.batch || !x.image)); // one with no photo stays as a draft
      if (!live.length) return { reply: "📸 None of these has a photo, so nothing can go on the website. Send the photos again." };
      let win;
      for (const p of live) win = celebrate(p);
      const codes = live.map((p) => `🔢 *${p.code}* ${p.name}`).join("\n");
      return {
        reply: `🎉 *${live.length === 2 ? "Both are" : `All ${live.length} are`} live on your website!*\n\n${codes}\n\nPost them to your Status: ${siteUrl() || ""}/kit\n\nWhen one sells, just send *sold* and its code, like *sold ${live[0].code}*.\n\n📈 ${win.postedToday} posted today · 🛍️ ${win.live} live${win.milestone ? `\n${win.milestone}` : ""}`,
        celebrate: { ...win, name: `${live.length} new items`, image: live[0].image },
      };
    }
    if (/^check each$/i.test(t)) {
      for (const x of items) { delete x.batch; x.ask = null; }
      savePending(queue);
      return step(queue[0], { fresh: true });
    }
    if (parseMessage(raw).type !== "product") return null; // a real command ("sold 4795") still works while they wait
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
const EDIT_WORDS = { price: "price", rate: "price", mrp: "mrp", qty: "qty", quantity: "qty", stock: "qty", pcs: "qty", name: "name", brand: "brand", size: "size", sizes: "size", desc: "description", description: "description", about: "description" };
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
// Sets sizes on a draft or a live product, with prices if each size has one.
function setSizes(l, t) {
  const pairs = sizePairs(t);
  if (pairs.length) return applySizePairs(l, pairs);
  delete l.sizePrices;
  l.sizes = formatSizes(t);
  return l;
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
  description: { label: "Description", ask: "📝 Type a line or two about it, e.g. *Soft cotton, relaxed fit*" },
};
// The first thing still missing, in the order the owner is asked.
function missingField(item) {
  const l = item.listing;
  if (!item.sure) return "section";
  if (!l.name || l.name === "New arrival") return "name";
  if (!l.price) return "price";
  if (needsSize(l) || (l.category === "Fragrances" && !l.sizes && !item.noSize)) return "size";
  return null;
}
// Name examples that fit the section once it's known.
const NAME_EG = { Clothing: "North Face Puffer Jacket", Fragrances: "Dior Sauvage EDT", Footwear: "Nike Air Max 90", Accessories: "Casio G-Shock watch" };
function question(item, field, lead = "") {
  const f = FIELDS[field];
  item.ask = field;
  delete item.inMenu;
  let ask = f.ask;
  if (field === "name") {
    const c = item.listing.category;
    ask = `🏷️ What's it called?\nType the name, e.g. *${(item.sure && NAME_EG[c]) || "Dior Sauvage EDT"}*${c === "Fragrances" ? "\n(Bottle size like *100 ml* is fine too.)" : ""}`;
  }
  const perfumeSize = field === "size" && item.listing.category === "Fragrances";
  if (perfumeSize) ask = "🧴 Which bottle sizes do you have?\nOne size: *100ml*\nPriced per size: *50ml 2999 100ml 4999*";
  const out = { reply: `${lead}${ask}`, buttons: perfumeSize ? ["Skip"] : f.buttons, list: f.list };
  if (!out.buttons && !f.list) out.buttons = ["❌ Cancel"];
  return out;
}
function preview(item, lead = "") {
  const l = item.listing;
  const section = [SECTION_LABEL[l.category], l.subcategory && l.subcategory !== "Perfume" ? l.subcategory : null].filter(Boolean).join(" › ");
  const lines = [
    `*${l.name}*`,
    l.brand ? `✨ ${l.brand}` : null,
    `💰 ${rupees(l.price)}${l.mrp ? ` ~MRP ${rupees(l.mrp)}~` : ""}`,
    l.sizes ? `📏 ${l.sizePrices ? Object.entries(l.sizePrices).map(([k, v]) => `${k} ${rupees(v)}`).join(", ") : l.sizes}` : null,
    l.description ? `📝 ${l.description}` : null,
    `📦 ${l.quantity || 1} ${(l.quantity || 1) > 1 ? "pieces" : "piece"}`,
    `🗂️ ${section}`,
    item.images?.length ? `📷 ${item.images.length + 1} photos` : null,
  ].filter(Boolean);
  item.ask = null;
  delete item.inMenu;
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
    { id: "Description", title: "📝 Description", description: (l.description || "not set").slice(0, 70) },
  ] },
});
const FIELD_PICK = { name: "name", price: "price", quantity: "qty", qty: "qty", size: "size", sizes: "size", section: "section", category: "section", brand: "brand", mrp: "mrp", description: "description" };
const money = (t) => { const m = /^(?:₹|rs\.?)?\s*([\d,]{2,9})(?:\s*\/-)?$/i.exec(t.trim()); const n = m && Number(m[1].replace(/,/g, "")); return n >= 10 ? n : null; };
// The owner's answer to the question the bot just asked. Returns true if it fitted.
function answer(item, field, t) {
  const l = item.listing;
  if (field === "price") { const n = money(t); if (!n) return false; l.price = n; delete l.sizePrices; return true; }
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
  if (field === "size") {
    if (/^skip$/i.test(t)) { item.noSize = true; return true; }
    if (t.length > 100) return false;
    setSizes(l, t);
    return true;
  }
  if (field === "description") { if (t.length < 5 || t.length > 500) return false; l.description = t; return true; }
  if (field === "name") { if (t.length < 2 || t.length > 80) return false; l.name = t; return true; }
  if (field === "brand") { if (t.length < 2 || t.length > 40) return false; l.brand = t; return true; }
  return false;
}
const NOT_UNDERSTOOD = {
  price: "💰 I need just the number, e.g. *2499*.",
  mrp: "🏷️ I need just the number, e.g. *6999*.",
  qty: "📦 Send a number, e.g. *2*.",
  section: "🗂️ Tap one of the sections below.",
  size: "📏 Type the sizes, e.g. *M L XL* or *50ml 100ml*.",
  description: "📝 Type a line or two, up to 500 letters.",
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
  if (item.batch) return null; // batchReply already passed on this text: it's a command, not an answer
  const l = item.listing;
  const nextUp = (out) => {
    if (!queue.length) return out;
    const n = step(queue[0], { fresh: true });
    return { ...n, reply: `${out.reply}\n\n—\n\n${n.reply}` };
  };

  // "ok" / "haan" / "Post it" publish only from the preview (Post it / Change / Cancel). While a
  // question or the Change menu is open, a bare "ok" is not an answer: ask the same thing again.
  if (DONE.test(raw)) {
    const need = missingField(item);
    if (need) { const out = step(item); return { ...out, reply: `Almost there! ${out.reply}` }; }
    if (item.ask) { const out = question(item, item.ask); savePending(queue); return { ...out, reply: `First this one: ${out.reply}` }; }
    if (item.inMenu) { savePending(queue); return { ...changeMenu(l), reply: `Pick what to change, or tap *Cancel*.\n\n${changeMenu(l).reply}` }; }
    if (!item.image) return { reply: `📸 “${l.name}” has no photo, so it can't go on the website. Send its photo, or tap *Cancel*.`, buttons: ["❌ Cancel"] };
    queue.shift();
    savePending(queue);
    const product = publish({ id: item.id, listing: l, by: item.by, image: item.image, images: item.images });
    const win = celebrate(product);
    return { ...nextUp({ reply: liveReply(product, win) }), product, celebrate: win };
  }
  if (CANCEL.test(raw)) {
    queue.shift();
    savePending(queue);
    dropDraftImage(item);
    return nextUp({ reply: `🗑️ Dropped “${l.name}”. Nothing went on the website.` });
  }
  if (CHANGE.test(raw)) { item.ask = null; item.inMenu = true; savePending(queue); return changeMenu(l); }
  // Picked a field from the Change menu (or typed just "price").
  const pick = FIELD_PICK[t.toLowerCase()];
  if (pick && !(item.ask === "name" || item.ask === "brand")) {
    const out = question(item, pick);
    item.fromChange = true;
    delete item.inMenu;
    savePending(queue);
    return out;
  }
  // The answer to the question just asked.
  // ("Prince jacket" as a name is an answer, not a mistyped "price".)
  const isEdit = kind && (["name", "brand", "size", "description"].includes(kind) || /^[₹\d,.\/-]+$/.test(rest.join("")));
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
    if (n >= 10) { l.price = n; delete l.sizePrices; return step(item, { changed: true }); }
  }
  if ((m = /^mrp\s*[:=\-]?\s*(?:₹|rs\.?)?\s*([\d,]{2,9})$/i.exec(e))) { l.mrp = Number(m[1].replace(/,/g, "")); return step(item, { changed: true }); }
  if ((m = /^(?:qty|quantity|stock|pcs|pieces|nos)\s*[:=\-]?\s*(\d{1,3})$/i.exec(e)) || (m = /^(\d{1,3})\s*(?:pcs|pc|pieces|piece|nos|qty)$/i.exec(e)) || (m = /^[x×]\s*(\d{1,3})$/i.exec(e))) {
    const n = Number(m[1]);
    if (n > 0) { l.quantity = n; return step(item, { changed: true }); }
  }
  if ((m = /^name\s*[:=\-]?\s+(.{2,80})$/i.exec(e))) { l.name = m[1].trim(); return step(item, { changed: true }); }
  if ((m = /^brand\s*[:=\-]?\s+(.{2,40})$/i.exec(e))) { l.brand = m[1].trim(); return step(item, { changed: true }); }
  if ((m = /^sizes?\s*[:=\-]?\s+(.{1,100})$/i.exec(e))) { setSizes(l, m[1]); return step(item, { changed: true }); }
  if ((m = /^(?:desc|description|about)\s*[:=\-]?\s+([\s\S]{5,500})$/i.exec(e))) { l.description = m[1].trim(); return step(item, { changed: true }); }
  if (sizePairs(t).length) { setSizes(l, t); return step(item, { changed: true }); }
  // Looks like a new product typed out (words and a price)? It needs its photo: words alone never make a post.
  const looks = parseMessage(t);
  if (!kind && looks.type === "product" && looks.product.price && looks.product.name !== "New arrival") {
    return { reply: `📸 To post “${looks.product.name}” too, send its photo with that caption. I'll ask about it after “${l.name}”.`, buttons: PREVIEW_BUTTONS };
  }
  const out = preview(item, `🤔 I didn't get that. Tap a button below, or tap *Change* to fix something.\n\n`);
  savePending(queue);
  return out;
}

function publish({ id, listing, by, image, images }) {
  tidyListing(listing);
  const fresh = load(); // reload: another message may have landed meanwhile
  const product = {
    id, ...listing, code: newCode(fresh), quantity: listing.quantity || 1,
    image, ...(images?.length ? { images: images.slice(0, MAX_PHOTOS - 1) } : {}), status: "available", createdAt: new Date().toISOString(), by,
  };
  fresh.unshift(product);
  save(fresh);
  return product;
}

// ---- Activity log: posts and sales, for streaks, "today" counts and the stats bar ----
const ACTIVITY = path.join(STORE, "activity.json");
const loadActivity = () => readOrSetAside(ACTIVITY, []);
function logActivity(ev) {
  const list = loadActivity();
  list.push({ at: new Date().toISOString(), ...ev });
  writeJson(ACTIVITY, list.slice(-5000));
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
// How the "just bought" banner names a buyer: first name and city, nothing else. A website buyer can
// tick to stay anonymous; a counter buyer stays anonymous unless the bill was ticked to show them.
function buyerLabel(sale, order, invoice) {
  const shown = order ? (order.hideName || order.noName ? "" : order.name) : invoice?.showName ? invoice.customer?.name : "";
  const word = String(shown || "").trim().split(/\s+/)[0];
  const name = /^\p{L}{2,20}$/u.test(word) ? word[0].toUpperCase() + word.slice(1).toLowerCase() : "";
  const shipped = order?.delivery === "ship" ? String(order.city || "").trim() : "";
  const city = order?.delivery !== "ship" ? "Srinagar" : /^[\p{L} .'-]{2,30}$/u.test(shipped) ? shipped : "";
  if (name) return city ? `${name} from ${city}` : name;
  return city ? `Someone ${order?.delivery === "ship" ? "from" : "in"} ${city}` : "Someone";
}
// Stock names are the shop's own shorthand ("-30 jeans"); customers see them tidied.
const saleName = (name) => String(name).replace(/^[^\p{L}]+/u, "").toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) || "an item";
// Every real sale feeds the banner by itself: website, counter and WhatsApp. Items not on the
// website show too, but have no page to link to.
function recentSales() {
  const byId = new Map(load().filter((p) => !p.needsName).map((p) => [p.id, p]));
  const since = Date.now() - 7 * 864e5; // the banner loops these, so keep a week to play from
  const invoices = new Map(billing.loadInvoices().map((x) => [x.number, x]));
  const orders = new Map(loadOrders().map((x) => [x.code, x]));
  return loadActivity()
    .filter((a) => a.type === "sold" && new Date(a.at) > since && byId.has(a.id) && invoices.get(a.invoice)?.status !== "cancelled")
    .slice(-10).reverse()
    .map((a) => {
      const p = byId.get(a.id);
      const stock = p.status === "sold" ? 0 : p.status === "available" ? billing.stockOf(p) : null;
      return { id: p.id, name: isPublic(p) ? p.name : saleName(p.name), image: p.image || null, qty: a.qty || 1, at: a.at, onSite: isPublic(p), ...(isPublic(p) && stock !== null && stock <= 3 ? { left: stock } : {}), who: buyerLabel(a, orders.get(a.order), invoices.get(a.invoice)) };
    });
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

// ---- Last pieces held for an order nobody has checked ----
// "I've paid" needs no proof, so a last piece could stay off sale for good. If the owner neither
// confirms nor cancels, he's warned, then the order lapses and the piece goes back on sale.
// The times come from the orders file, so a restart loses nothing. Only held pieces lapse:
// items with more in stock aren't held, and those orders wait for him as before.
const HOLD_MS = Number(process.env.ORDER_HOLD_MS) || 12 * 3600e3;
const HOLD_WARN_MS = Number(process.env.ORDER_WARN_MS) || 30 * 60e3;
function sweepHolds(now = Date.now()) {
  const orders = loadOrders();
  const items = load();
  const alerts = [];
  let changedOrders = false, changedItems = false;
  // Nobody confirmed in time: the order ends and the piece goes back on sale. A late confirm still works while it's unsold.
  for (const o of orders) {
    if (o.status !== "awaiting_payment" || !o.expiresAt || now < Date.parse(o.expiresAt)) continue;
    Object.assign(o, { status: "lapsed", lapsedAt: new Date(now).toISOString() });
    changedOrders = true;
    if (letGo(o, items)) changedItems = true;
    alerts.push({ o, kind: "order lapsed", text: `⌛ *${o.code} ran out of time*\n“${o.productName}” · ${inr(o.amount)} · ${o.name}\nNobody confirmed it, so it's closed and the piece is back on sale.\n\nIf the money did arrive, send *confirm ${o.code}*.` });
  }
  for (const o of orders) {
    if (o.status !== "paid" || !o.paidAt) continue;
    const p = items.find((x) => x.id === o.productId);
    if (!p || p.status !== "hold" || p.holdFor !== o.code) continue;
    const paid = Date.parse(o.paidAt);
    if (!o.holdWarnedAt) {
      if (now < paid + HOLD_MS - HOLD_WARN_MS) continue;
      o.holdWarnedAt = new Date(now).toISOString();
      changedOrders = true;
      alerts.push({ o, kind: "order reminder", text: `⏰ *${o.code} still needs checking*\n“${o.productName}” · ${inr(o.amount)} · ${o.name}\nIt goes back on sale in ${Math.round(HOLD_WARN_MS / 60e3)} minutes.\n\nPayment came? Send *confirm ${o.code}*\nNo payment? Send *cancel ${o.code}*` });
      continue;
    }
    // Always a full warning first, even if the server was down for part of the hold.
    if (now < Math.max(paid + HOLD_MS, Date.parse(o.holdWarnedAt) + HOLD_WARN_MS)) continue;
    Object.assign(o, { status: "lapsed", lapsedAt: new Date(now).toISOString() });
    p.status = "available"; delete p.holdFor;
    changedOrders = changedItems = true;
    alerts.push({ o, kind: "order lapsed", text: `⌛ *${o.code} lapsed*\n“${o.productName}” is back on sale, because nobody confirmed the payment.\n\nIf ${o.name} did pay ${inr(o.amount)}: send *confirm ${o.code}* while the piece is unsold. If it has sold, refund them on ${prettyPhone(o.phone)}.` });
  }
  // Save first: a failed alert must not send the same warning again on the next sweep.
  if (changedItems) save(items);
  if (changedOrders) saveOrders(orders);
  for (const { o, kind, text } of alerts) sendToOwner({ id: crypto.randomBytes(6).toString("hex"), at: new Date(now).toISOString(), kind: "order", summary: { kind, ref: o.code }, text });
}
if (LIVE) setInterval(() => { try { sweepHolds(); } catch (e) { console.warn("order holds:", e.message); } }, Number(process.env.ORDER_SWEEP_MS) || 5e3).unref();

// ---- Billing portal API (owner key) ----
// Staff logins never receive cost prices.
const noCost = (p) => { const c = { ...p }; delete c.cost; delete c.supplierId; delete c.linkUndo; return c; };
const billForStaff = (x) => ({ ...x, lines: x.lines.map(({ cost, ...l }) => l) });
const BILL_FIELDS = ["headerLine", "terms", "email", "youtube", "theme"];
const PULSE_FILES = ["products.json", "invoices.json", "orders.json", "parties.json", "payments.json", "purchases.json", "expenses.json", "returns.json"];
const BACKUP_FILES = ["products", "invoices", "parties", "payments", "purchases", "expenses", "returns", "docs", "books", "orders", "customers", "coins"];

// When a paid website order lets go of its piece. Only last pieces are held, so most orders never lapse.
const toConfirm = (o) => (o.status === "awaiting_payment" && o.expiresAt) || (o.status === "paid" && o.paidAt);
function lapsesAt(o, items = load()) {
  if (o.status === "awaiting_payment" && o.expiresAt) return Date.parse(o.expiresAt);
  if (o.status !== "paid" || !o.paidAt) return null;
  const p = (Array.isArray(items) ? items : load()).find((x) => x.id === o.productId);
  return p && p.status === "hold" && p.holdFor === o.code ? Date.parse(o.paidAt) + HOLD_MS : null;
}

// Stock and money waiting on the owner, shown at the top of the dashboard.
function attention() {
  const items = load(), paid = loadOrders().filter(toConfirm);
  const stockOf = billing.stockOf;
  const lapses = paid.map((o) => lapsesAt(o, items)).filter(Boolean);
  return {
    ordersToCheck: paid.length,
    nextLapse: lapses.length ? Math.min(...lapses) : null,
    itemsToCount: items.filter((p) => p.needsCount).length,
    lowStock: items.filter((p) => stockOf(p) > 0 && stockOf(p) <= (p.reorderAt ?? 1)).length,
    noPrice: items.filter((p) => !p.price || p.needsName).length,
  };
}

// ---- One write per requestId ----
// The portal sends a requestId (≤ 64 characters) with every bill, payment, purchase, expense,
// return/note/quote, party and staff add. A tap that is sent twice (slow network, double tap,
// a retry after a timeout) gets the first answer back with repeat: true, and nothing is written
// twice. Kept 48 h on the disk, so a restart in between changes nothing. No requestId = as before.
const REQUEST_IDS = path.join(STORE, "request-ids.json");
const REQUEST_MS = 48 * 3600e3;
const ONCE_ROUTES = /^(invoices|payments|purchases|expenses|returns|docs|dispatch|parties|parties\/[a-f0-9]{16}|staff|items|cash\/opening)$/;
let requestIds = null;
const inFlight = new Map(); // requestId -> promise, for a repeat that lands while the first still runs
function requestStore() {
  if (!requestIds) {
    requestIds = readOrSetAside(REQUEST_IDS, {});
    const cut = Date.now() - REQUEST_MS;
    for (const [k, v] of Object.entries(requestIds)) if (!(v.at > cut)) delete requestIds[k];
  }
  return requestIds;
}
function rememberRequest(id, status, response) {
  const all = requestStore(), cut = Date.now() - REQUEST_MS;
  for (const [k, v] of Object.entries(all)) if (!(v.at > cut)) delete all[k];
  all[id] = { at: Date.now(), status, response };
  writeJson(REQUEST_IDS, all);
}

async function billingApi(req, res, route, url, who = { role: "owner" }) {
  // Read once: the requestId check below and the route both need the body.
  let parsed;
  const body = async () => {
    if (parsed === undefined) { try { parsed = JSON.parse((await readBody(req, 64 * 1024)) || "{}"); } catch { parsed = null; } }
    return parsed;
  };
  const reply = (r) => (r.error ? send(res, 409, { error: r.error }) : send(res, 200, r));
  const post = req.method === "POST", get = req.method === "GET";
  if (post && ONCE_ROUTES.test(route)) {
    const b = await body();
    const rid = b && typeof b.requestId === "string" && b.requestId.length <= 64 && b.requestId.trim() ? `${route}|${b.requestId}` : null;
    if (b) delete b.requestId;
    if (rid) {
      if (inFlight.has(rid)) await inFlight.get(rid).catch(() => {});
      const done = requestStore()[rid];
      if (done) return send(res, done.status, done.response && typeof done.response === "object" ? { ...done.response, repeat: true } : done.response);
      let finish;
      inFlight.set(rid, new Promise((r) => (finish = r)));
      // Whatever this request answers is what a repeat will get. 5xx isn't kept: that one may be tried again.
      res.onSend = (status, out) => { if (status < 500) try { rememberRequest(rid, status, out); } catch (e) { console.error(`request-ids.json: ${e.message}`); } };
      try { return await billingRoute(req, res, route, url, who, body, reply, post, get); }
      finally { inFlight.delete(rid); finish(); }
    }
  }
  return billingRoute(req, res, route, url, who, body, reply, post, get);
}

async function billingRoute(req, res, route, url, who, body, reply, post, get) {
  if (get && route === "me") return send(res, 200, { role: who.role, name: who.name, upi: SHOP.pay.upiId, phone: SHOP.pay.phone, logo: SHOP.billing.logo || "" });
  // A cheap "has anything changed?" so an open portal doesn't download the whole shop every few seconds.
  if (get && route === "pulse") {
    const stamp = (f) => { try { return fs.statSync(path.join(STORE, f)).mtimeMs; } catch { return 0; } };
    const open = who.role === "owner" ? loadOrders().filter(toConfirm) : [], orders = open.length;
    const items = orders ? load() : [];
    // What the portal's big "confirm this order" pop-up needs, without a second request.
    const pending = open.filter((o) => o.status === "awaiting_payment").map((o) => ({ code: o.code, productName: o.productName, pieces: orderLines(o).length, size: o.size, amount: o.amount, shipping: o.shipping || 0, name: o.name, phone: o.phone, delivery: o.delivery, city: o.city, image: items.find((x) => x.id === o.productId)?.image || "", left: Math.max(0, Date.parse(o.expiresAt) - Date.now()) }));
    // alertFailures: WhatsApp alerts that couldn't be sent lately (time, kind, error), for the owner only.
    const alertFailures = who.role === "owner" ? wa.alertFailures().filter((x) => Date.parse(x.at) > Date.now() - 7 * 864e5) : [];
    return send(res, 200, { v: [...PULSE_FILES.map(stamp), orders, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })].join("-"), orders, pending, alertFailures });
  }
  // Everything the shop needs to start again, for keeping a copy off the server's disk.
  if (get && route === "backup") {
    const data = Object.fromEntries(BACKUP_FILES.map((f) => [f, readJson(path.join(STORE, `${f}.json`), null)]));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="vibex-backup-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ takenAt: new Date().toISOString(), ...data }));
  }
  if (get && route === "products") return send(res, 200, who.role === "staff" ? load().map(noCost) : load());
  if (post && route === "items") { const b = await body(); return b ? reply(billing.saveItem(b, null, newCode)) : send(res, 400, { error: "Bad request." }); }
  let im = /^items\/([\w-]{1,40})$/.exec(route);
  if (post && im) {
    const b = await body();
    if (!b) return send(res, 400, { error: "Bad request." });
    const wasHidden = load().find((x) => x.id === im[1])?.hidden;
    const r = billing.saveItem(b, im[1], newCode);
    if (!r.error && wasHidden && !r.product.hidden) celebrate(r.product); // counts as a post, like one from WhatsApp
    return reply(r);
  }
  // Add, remove or choose the main photo. The portal shrinks photos before sending them.
  im = /^items\/([\w-]{1,40})\/photos$/.exec(route);
  if (post && im) {
    let b; try { b = JSON.parse(await readBody(req, 8 * 1024 * 1024)); } catch { return send(res, 400, { error: "That photo is too large." }); }
    return reply(billing.photos(im[1], b, (data, key) => saveImage(data, `${im[1]}-${key || Date.now().toString(36)}`)));
  }
  if (post && route === "link") { const b = await body(); if (!b) return send(res, 400, { error: "Bad request." }); const r = documents.linkItem(b); pruneCopies(); return reply(r); }
  if (post && route === "unlink") { const b = await body(); if (!b) return send(res, 400, { error: "Bad request." }); const r = documents.unlinkItem(b); pruneCopies(); return reply(r); }
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
  // The whole myBillBook export (items, parties, bills, payments): lib/import-mbb.js. Owner only.
  // Preview unless apply=1. Apply copies every file it changes to backups/before-mbb-<time>/ first.
  if (post && route === "import-mbb") {
    if (who.role !== "owner") return send(res, 403, { error: "Only the owner can do that." });
    let data;
    try { data = JSON.parse(await readBody(req, 40 * 1024 * 1024)); } catch (e) { return send(res, e.message === "too large" ? 413 : 400, { error: e.message === "too large" ? "File too large (40 MB at most)." : "That file isn't a myBillBook export (not JSON)." }); }
    const r = url.searchParams.get("apply") === "1" ? mbbImport.apply(data, STORE, SHOP) : mbbImport.preview(data, STORE, SHOP);
    if (r.error) return send(res, 400, { error: r.error });
    return send(res, 200, { ...r, text: mbbImport.text(r) });
  }
  // Importing the myBillBook stock file. Preview unless apply=1; a copy is kept before applying.
  if (post && route === "import") {
    let csv;
    try { csv = await readBody(req, 5 * 1024 * 1024); } catch { return send(res, 413, { error: "File too large." }); }
    const before = load();
    const r = stockImport.plan(String(csv), before, { newCode, refreshStock: url.searchParams.get("refreshStock") === "1" });
    if (r.error) return send(res, 400, { error: r.error });
    if (url.searchParams.get("apply") !== "1") return send(res, 200, { preview: true, report: r.report });
    writeJson(path.join(STORE, `products-before-import-${Date.now()}.json`), before);
    pruneCopies();
    save(r.items);
    return send(res, 200, { preview: false, report: r.report });
  }
  if (get && route === "form-test") return send(res, 200, formResult());
  if (get && route === "dashboard") {
    return send(res, 200, { ...books.dashboard(), today: billing.today(), attention: attention() });
  }
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
  // stillHere: every piece of the order can still be bought, so a follow-up can honestly say "it's still here".
  if (get && route === "orders") { const items = load(), here = new Map(items.map((p) => [p.id, p.status === "available"])); return send(res, 200, loadOrders().slice(-200).reverse().map(({ proof, ...o }) => ({ ...o, lapsesAt: lapsesAt(o, items), stillHere: orderLines(o).every((l) => here.get(l.productId)) }))); }
  // The owner pressed "Follow up" or "Ask for a review": remember when, so nobody is messaged twice.
  const om3 = /^orders\/(VX-\d{4})\/(followed|review-asked)$/.exec(route);
  if (post && om3) {
    const all = loadOrders(), o = all.find((x) => x.code === om3[1]);
    if (!o) return send(res, 404, { error: "No such order." });
    o[om3[2] === "followed" ? "followedAt" : "reviewAskedAt"] = new Date().toISOString();
    saveOrders(all);
    return send(res, 200, { ok: true });
  }
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
    const list = billing.loadInvoices(), dues = books.billDues();
    if (who.role === "staff") return send(res, 200, { invoices: list.slice(-100).reverse().map((x) => ({ ...billForStaff(x), due: dues.get(x.id) || 0 })), today: { bills: 0, total: 0, pieces: 0, byPayment: {} }, gst: billing.gstOn() });
    const shown = (url.searchParams.get("all") === "1" ? list : list.slice(-500)).slice().reverse();
    return send(res, 200, { invoices: shown.map((x) => ({ ...x, due: dues.get(x.id) || 0 })), total: list.length, today: billing.today(), gst: billing.gstOn() });
  }
  if (req.method === "POST" && route === "invoices") {
    const b = await body();
    if (!b) return send(res, 400, { error: "Bad request." });
    let partyId = b.partyId || null;
    const staffSale = who.role === "staff";
    // Staff bill at the counter within limits: stock must be there (no short sales) and no line below
    // the listed price minus the most staff may give off (shop.json billing.staffMaxDiscountPct, else 20%).
    // The owner key keeps full control.
    const opts = { source: "counter", customer: b.customer, payment: b.payment, note: b.note, partyId, charges: b.charges, showName: b.showName === true, received: b.received, paidMode: b.paidMode,
      allowShort: !staffSale && b.allowShort === true, by: staffSale ? who.name : undefined, ...(staffSale ? { floorPct: Number(SHOP.billing?.staffMaxDiscountPct ?? 20) } : {}) };
    if (b.payment === "credit") {
      // Credit needs someone to owe it: a saved party, or a bill with a mobile number.
      partyId = partyId || books.customerFor(b.customer || {});
      if (!partyId) return send(res, 409, { error: "A credit bill needs the customer's name and mobile, so it can go in their ledger." });
      opts.partyId = partyId;
      // The limit is checked on the total sell() will really write (a line with no price uses the listed price).
      const dry = billing.sell(b.lines, { ...opts, dryRun: true });
      if (dry.error) return send(res, 409, { error: dry.error });
      const total = dry.total;
      const received = Math.max(0, Number(b.received) || 0);
      if (received > total) return send(res, 409, { error: "Received can't be more than the bill." });
      const over = (staffSale || !b.overLimit) && books.creditCheck(partyId, total - received);
      if (over) return send(res, 409, { error: over, overLimit: true });
    }
    const r = billing.sell(b.lines, opts);
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
      if (o && o.status !== "cancelled") { o.status = "cancelled"; o.invoice = null; saveOrders(orders); if (o.customerId) accounts.undo(o.customerId, o.code); }
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

// One request. A path or Host header that can't be read (GET /%E0%A4%A) is a 400; it used to throw
// outside the try below and take the whole process down.
async function handle(req, res) {
    let url, p;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
      p = decodeURIComponent(url.pathname);
    } catch { return send(res, 400, { error: "Bad request." }); }
    // Someone guessing the owner key: 20 wrong tries in 10 minutes from one address, then 429.
    // The digest route's ?key is its own key, and a signed-in staff session isn't a guess.
    const givenKey = req.headers["x-owner-key"] || url.searchParams.get("key");
    if (process.env.OWNER_KEY && givenKey && p !== "/api/analytics-digest" && !isOwner(req, url) && !staff.who(req.headers["x-session"]) && wrongKey(clientIp(req)))
      return send(res, 429, { error: "Too many wrong keys. Try again in 10 minutes." });
    try {
      if (toDomain(req, res, p, url)) return;
      if (req.method === "GET" && p === "/api/products") return send(res, 200, publicProducts());
      if (req.method === "GET" && p === "/api/recent-sales") return send(res, 200, recentSales());
      if (req.method === "GET" && p.startsWith("/api/pin/")) return send(res, 200, await pinPlace(p.slice(9), clientIp(req)), "application/json", "public, max-age=86400");
      if (p === "/webhook" && (req.method === "GET" || req.method === "POST")) return await whatsappWebhook(req, res, url);
      if (req.method === "POST" && p === "/api/enquiry") return await handleEnquiry(req, res);
      if (req.method === "POST" && p === "/api/orders") return await createOrder(req, res);
      if (p.startsWith("/api/account/")) return await accountApi(req, res, p.slice("/api/account/".length));
      const om = /^\/api\/orders\/([a-f0-9]{16})(\/paid|\/cancel|\/name)?$/.exec(p);
      if (om && req.method === "POST" && om[2] === "/paid") return refused(res);
      if (om && req.method === "POST" && om[2] === "/name") return await orderName(req, res, om[1]);
      if (om && req.method === "POST" && om[2]) return orderCancel(res, om[1]);
      if (om && req.method === "GET" && !om[2]) {
        const o = loadOrders().find((x) => x.id === om[1]);
        return o ? send(res, 200, { code: o.code, status: o.status, left: o.expiresAt ? Math.max(0, Date.parse(o.expiresAt) - Date.now()) : 0 }) : send(res, 404, { error: "not found" });
      }
      if (req.method === "POST" && p === "/api/billing/login") {
        let b; try { b = JSON.parse(await readBody(req, 1024)); } catch { return send(res, 400, { error: "Bad request." }); }
        const r = staff.login(b, clientIp(req));
        return r.error ? send(res, r.status, { error: r.error }) : send(res, 200, r);
      }
      // Screen recordings from lib/lab-client.js: same rules as /api/t, bigger pieces.
      if (req.method === "POST" && p === "/api/rec") {
        const from = req.headers.origin;
        if (from && new URL(from).host !== req.headers.host) return send(res, 403, { error: "Not allowed." });
        const ua = req.headers["user-agent"] || "";
        if (!ua || /bot|crawl|spider|headless|lighthouse/i.test(ua)) return send(res, 204, "");
        let b; try { b = JSON.parse(await readBody(req, 700 * 1024)); } catch { return send(res, 400, { error: "Bad request." }); }
        const r = lab.addChunk(b, { dev: /ipad|tablet/i.test(ua) ? "Tablet" : /mobi|android|iphone/i.test(ua) ? "Phone" : "Computer" });
        return send(res, r.error ? 400 : 200, r.error ? { error: r.error } : { ok: true });
      }
      // Visitors' browsers report here. It only ever answers "got it", and refuses other websites.
      if (req.method === "POST" && p === "/api/t") {
        const from = req.headers.origin;
        if (from && new URL(from).host !== req.headers.host) return send(res, 403, { error: "Not allowed." });
        let b; try { b = JSON.parse(await readBody(req, 32 * 1024)); } catch { return send(res, 400, { error: "Bad request." }); }
        analytics.ingest(b, { ua: req.headers["user-agent"] || "", ip: clientIp(req) });
        res.writeHead(204); return res.end();
      }
      // Read-only summary for the nightly routine and the mind map. Its own key, not the owner key, so whoever holds
      // it can read the numbers and nothing else. No names, phones, typed notes or single visits.
      if (req.method === "GET" && p === "/api/analytics-digest") {
        // Only the key's SHA-256 is in this public repo (DIGEST_KEY_SHA256 on the server overrides it).
        const want = Buffer.from(process.env.DIGEST_KEY_SHA256 || "16f265c675910ff1d78de7c0de12f9cb6b9c84e4d33ef3bc978c46f55ba84791", "hex");
        const given = String(req.headers["x-digest-key"] || url.searchParams.get("key") || "");
        const got = crypto.createHash("sha256").update(given).digest();
        if (!given || want.length !== 32 || !crypto.timingSafeEqual(got, want)) return send(res, 401, { error: "Digest key required." });
        const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
        try { return send(res, 200, await analyticsDigest(days)); } catch (e) { return send(res, 503, { error: e.message }); }
      }
      if (p.startsWith("/api/analytics/")) {
        if (!isOwner(req, url)) return send(res, 401, { error: "Owner key required." });
        const route = p.slice("/api/analytics/".length), day = /^\d{4}-\d{2}-\d{2}$/;
        if (req.method === "GET" && route === "live") return send(res, 200, analytics.liveNow(url.searchParams.get("seg") || ""));
        if (req.method === "GET" && route === "report") {
          const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
          if (!day.test(from) || !day.test(to) || from > to) return send(res, 400, { error: "Pick a date range." });
          if (Date.parse(to) - Date.parse(from) > 400 * 864e5) return send(res, 400, { error: "Pick 400 days or fewer." });
          try { return send(res, 200, await analytics.report(from, to, url.searchParams.get("seg") || "")); } catch (e) { return send(res, 503, { error: e.message }); }
        }
        if (req.method === "GET" && route === "changes") return send(res, 200, await analytics.changeResults());
        if (req.method === "GET" && route === "tests") return send(res, 200, { tests: lab.list(), metrics: lab.METRICS });
        if (req.method === "POST" && route === "tests") {
          let b; try { b = JSON.parse((await readBody(req, 8192)) || "{}"); } catch { return send(res, 400, { error: "Bad request." }); }
          const r = lab.create(b); return send(res, r.error ? 400 : 200, r);
        }
        const tm = /^tests\/([a-f0-9]{10})\/(start|stop|keep|delete)$/.exec(route);
        if (req.method === "POST" && tm) {
          let b = {}; try { b = JSON.parse((await readBody(req, 1024)) || "{}"); } catch { /* no body */ }
          const r = lab.act(tm[1], tm[2], b); return send(res, r.error ? 400 : 200, r);
        }
        if (req.method === "GET" && route === "recordings") return send(res, 200, { recordings: lab.recordings(url.searchParams.get("flag") || ""), rate: REC_RATE });
        const rm = /^recordings\/([a-f0-9]{16})$/.exec(route);
        if (req.method === "GET" && rm) { const r = lab.recording(rm[1]); return r ? send(res, 200, r) : send(res, 404, { error: "Gone (kept 14 days)." }); }
        if (req.method === "POST" && route === "changes") {
          let b; try { b = JSON.parse((await readBody(req, 4096)) || "{}"); } catch { return send(res, 400, { error: "Bad request." }); }
          const r = analytics.addChange(b);
          return send(res, r.error ? 400 : 200, r);
        }
        const cm = /^changes\/([a-f0-9]{16})\/remove$/.exec(route);
        if (req.method === "POST" && cm) { const r = analytics.removeChange(cm[1]); return send(res, r.error ? 404 : 200, r); }
        return send(res, 404, { error: "not found" });
      }
      if (p === "/analytics") return serveFile(res, path.join(ROOT, "owner"), "analytics.html");
      if (p === "/analytics/lab") return serveFile(res, path.join(ROOT, "owner"), "lab.html");
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
        if (LIVE) writeJson(DB, []); else writeSeed();
        ensureCodes();
        saveInbox([]);
        saveOrders([]);
        savePending([]);
        writeJson(ACTIVITY, []);
        // The demo reset clears the books too. The live shop's accounts are never reset.
        if (!LIVE) for (const f of ["invoices", "parties", "payments", "purchases", "expenses", "books", "returns", "docs"]) fs.rmSync(path.join(STORE, `${f}.json`), { force: true });
        for (const f of fs.readdirSync(UPLOADS)) fs.unlinkSync(path.join(UPLOADS, f));
        return send(res, 200, { ok: true });
      }
      // The portal page itself is harmless without the key: every call it makes needs it.
      if (p === "/billing") return serveFile(res, path.join(ROOT, "owner"), "billing.html");
      if (p === "/billing-books.js" || p === "/billing-docs.js" || p === "/billing-more.js" || p === "/billing-ux.js" || p === "/billing.css") return serveFile(res, path.join(ROOT, "owner"), p.slice(1));
      if (p === "/billing-heic.js") return serveFile(res, path.join(ROOT, "owner"), "heic2any.min.js"); // iPhone photos in Chrome, loaded only when needed
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
      if (p.startsWith("/uploads/")) return serveFile(res, UPLOADS, p.slice("/uploads/".length), "public, max-age=3600"); // an hour: a replaced photo keeps its name
      if (p === "/config.js") return sendConfig(res);
      if (p === "/newtab.js") return serveFile(res, path.join(ROOT, "lib"), "newtab.js");
      if (p === "/track.js") return serveFile(res, path.join(ROOT, "lib"), "track.js");
      if (p === "/lab.js") return serveFile(res, path.join(ROOT, "lib"), "lab-client.js");
      if (p === "/rec.js") return serveFile(res, path.join(ROOT, "node_modules", "@rrweb", "record", "dist"), "record.umd.min.cjs", "public, max-age=86400");
      if (p === "/owner/replay.js") return serveFile(res, path.join(ROOT, "node_modules", "rrweb", "dist"), "rrweb.umd.min.cjs", "public, max-age=86400");
      if (p === "/owner/replay.css") return serveFile(res, path.join(ROOT, "node_modules", "rrweb", "dist"), "style.min.css", "public, max-age=86400");
      if (p === "/guide.js") return serveFile(res, path.join(ROOT, "lib"), "guide.js");
      if (p === "/rush.js") return serveFile(res, path.join(ROOT, "lib"), "rush.js");
      if (p === "/race.js") return serveFile(res, path.join(ROOT, "lib"), "race.js");
      // The Drop Kit: Status cards for the owner, a short link for the card, and a line for anyone who arrives too late.
      if (p === "/kit") return serveFile(res, path.join(ROOT, "owner"), "kit.html");
      const dm = /^\/d\/(\d{1,8})$/.exec(p);
      if (dm && req.method === "GET") {
        const item = load().filter(isPublic).find((x) => String(x.code) === dm[1]);
        res.writeHead(302, { Location: item ? `/p/${encodeURIComponent(item.id)}?utm_source=whatsapp&utm_campaign=drop-${dm[1]}` : "/" });
        return res.end();
      }
      if (req.method === "GET" && p === "/api/kit") {
        if (!isOwner(req, url)) return send(res, 401, { error: "Owner key required." });
        return send(res, 200, kitData());
      }
      if (req.method === "POST" && p === "/api/kit/wait-done") {
        if (!isOwner(req, url)) return send(res, 401, { error: "Owner key required." });
        let b; try { b = JSON.parse(await readBody(req, 1024)); } catch { return send(res, 400, { error: "Bad request." }); }
        saveWaiting(loadWaiting().filter((w) => w.id !== b.id));
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && p === "/api/next-in-line") {
        if (tooMany(clientIp(req))) return send(res, 429, { error: "Too many attempts. Please wait a few minutes." });
        let b; try { b = JSON.parse(await readBody(req, 1024)); } catch { return send(res, 400, { error: "Something went wrong. Please try again." }); }
        const item = load().filter(isPublic).find((x) => x.id === String(b.productId || "")), phone = normalisePhone(b.phone);
        if (!item) return send(res, 404, { error: "This piece is no longer listed." });
        if (!phone) return send(res, 400, { error: "Please enter a 10 digit mobile number." });
        const list = loadWaiting();
        if (!list.some((w) => w.productId === item.id && w.phone === phone)) {
          list.push({ id: crypto.randomBytes(6).toString("hex"), productId: item.id, productName: item.name, phone, at: new Date().toISOString() });
          saveWaiting(list);
          sendToOwner({ text: `🙋 Someone wants “${item.name}”, which has gone. Their number is in your Drop Kit if it comes back.`, summary: { type: "waitlist" } });
        }
        return send(res, 200, { ok: true });
      }
      // How many people are on a piece right now, from real visits only, and the real hold on the last one.
      if (req.method === "GET" && p === "/api/courier") {
        const piece = load().filter(isPublic).find((x) => x.id === String(url.searchParams.get("id") || "")), pin = String(url.searchParams.get("pin") || "");
        if (!piece || !/^[1-9]\d{5}$/.test(pin)) return send(res, 400, { error: "Bad request." });
        return send(res, 200, courierFor(SHOP.policy?.courier, piece, pin));
      }
      if (req.method === "GET" && p === "/api/pulse") {
        const id = String(url.searchParams.get("id") || ""), me = String(url.searchParams.get("s") || "");
        const held = holds.anyOn(id).filter((h) => h.token !== me);
        const piece = load().filter(isPublic).find((x) => x.id === id);
        const { who, ...seen } = analytics.pulse(id, me);
        // The race: only for a true last piece nobody holds yet, and only between visitors the shop has really seen here.
        const mine = holds.anyOn(id).some((h) => h.token === me), last = RACE_ON && piece?.status === "available" && onePieceInAll(piece);
        // Someone with this piece in their bag is a real rival too, wherever on the site they are.
        const fromBag = url.searchParams.get("bag") === "1", holders = last ? bagHolders(id, fromBag ? me : "") : [];
        const here = [...new Set([...who, ...holders])];
        const race = last && !held.length && !mine ? races.see(id, here, me) : null;
        return send(res, 200, { ...seen, heldByOther: held.length > 0, status: piece?.status || "", ...(last ? { last: true, mine, now: Date.now(), inBags: holders.filter((x) => x !== me && !who.includes(x)).length, ...(fromBag ? { name: piece.name } : {}), ...(race ? { race } : {}) } : {}) });
      }
      if (req.method === "POST" && p === "/api/hold") {
        let b; try { b = JSON.parse(await readBody(req, 2048)); } catch { return send(res, 400, { error: "Bad request." }); }
        const item = load().filter(isPublic).find((x) => x.id === String(b.productId || "")), size = holdSize(item, b.size), token = String(b.token || "");
        if (!item || item.status !== "available" || !/^[a-f0-9]{16}$/.test(token) || !isLastPiece(item, size)) return send(res, 200, { held: false });
        const got = holds.take(item.id, size, token, clientIp(req));
        if (got.held) races.end(item.id); // the race is over the moment someone has it
        return send(res, 200, { ...got, now: Date.now() });
      }
      if (req.method === "POST" && p === "/api/hold/release") {
        let b; try { b = JSON.parse(await readBody(req, 2048)); } catch { return send(res, 400, { error: "Bad request." }); }
        const item = load().find((x) => x.id === String(b.productId || ""));
        holds.release(String(b.productId || ""), holdSize(item, b.size), String(b.token || ""));
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && p === "/api/guide") return send(res, 200, await analytics.guideModel());
      const pv = /^\/preview\/(classic|modern)(\/.*)?$/.exec(p);
      if (pv) return previewRoute(req, res, pv[1], pv[2] || "");
      if (req.method === "GET" && p === "/robots.txt") return send(res, 200, robotsTxt(req), "text/plain; charset=utf-8", "public, max-age=3600");
      if (req.method === "GET" && p === "/llms.txt") return send(res, 200, llmsTxt(req), "text/plain; charset=utf-8", "public, max-age=3600");
      if (req.method === "GET" && p === "/sitemap.xml") return send(res, 200, sitemapXml(req), "application/xml; charset=utf-8", "public, max-age=900");
      if (p === "/" ) return homePage(req, res);
      if (p === "/account" || p === "/bag") return accountPage(res, p.slice(1));
      if (p === "/demo") return serveFile(res, PUBLIC, "demo.html");
      if (p === "/wardrobe") return wardrobePage(req, res);
      const pm = /^\/p\/([\w-]{1,40})$/.exec(p);
      if (pm) return productPage(req, res, pm[1]);
      const legalKey = { "/returns": "returns", "/terms": "terms", "/privacy": "privacy", "/contact": "contact" }[p];
      if (legalKey) return legalPage(req, res, legalKey);
      if (!path.extname(p)) return notFoundPage(res);
      return serveFile(res, PUBLIC, p.slice(1));
    } catch (e) {
      send(res, 500, { error: e.message });
    }
}

const server = http.createServer((req, res) => {
  // handle() must never reject: an unhandled rejection would stop the shop for everyone.
  handle(req, res).catch((e) => {
    console.error(`${req.method} ${String(req.url).slice(0, 200)} failed: ${e.stack || e.message}`);
    try { if (!res.headersSent) send(res, 500, { error: "Something went wrong." }); else res.destroy(); } catch { /* connection already gone */ }
  });
});
// Anything that still slips through is logged and the shop keeps running. Every money file is written
// whole (temp file + rename, lib/jsonstore.js), so a failed step leaves the old file, not half a file.
// Many in a row means something is really broken: then exit, and Render starts a fresh process.
let crashes = [];
process.on("unhandledRejection", (e) => console.error(`Unhandled rejection: ${e?.stack || e}`));
process.on("uncaughtException", (e) => {
  console.error(`Uncaught exception: ${e?.stack || e}`);
  crashes = crashes.filter((t) => Date.now() - t < 60e3).concat(Date.now());
  if (crashes.length > 20) { console.error("More than 20 uncaught errors in a minute: exiting so the host restarts the server."); process.exit(1); }
});
// A deploy or restart sends SIGTERM. Meta was already told 200 for messages still in an album wait or
// running, so stop taking new requests, let that WhatsApp work finish (up to 8 s), then exit.
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("SIGTERM: finishing WhatsApp messages in progress, then stopping");
  server.close();
  server.closeIdleConnections?.();
  const left = await wa.drain(Number(process.env.DRAIN_MS) || 8000).catch(() => -1);
  if (left) console.warn(`SIGTERM: ${left} WhatsApp job(s) didn't finish in time`);
  try { analytics.close(); lab.close(); } catch (e) { console.error(`close: ${e.message}`); }
  process.exit(0);
}
process.on("SIGTERM", shutdown);

server.listen(PORT, () => {
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

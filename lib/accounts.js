// Customer accounts: sign in with WhatsApp or Google, then a bag, wishlist, saved address and coins
// that follow them to any phone. Buying needs an account (shop's decision, 2026-11-08).
//
// WhatsApp sign-in costs nothing and needs no SMS: the site shows a code, the customer sends
// "Vibe X login 123456" to the shop's bot from their own WhatsApp, and the number it arrives from
// is the number they own. The page waits for that message and signs them in.
//
// Files (in STORE): customers.json, sessions.json (token hashes only), coins.json (redeem switch).
const path = require("path");
const crypto = require("crypto");
const { readJson, writeJson } = require("./jsonstore");

const SESSION_MS = 180 * 864e5;       // half a year: shoppers shouldn't have to sign in again
const CODE_MS = 10 * 60e3;            // a login code lives 10 minutes
const BAG_MAX = 20, WISH_MAX = 60;
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const clean = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

module.exports = function createAccounts({ STORE, coinsConfig = {}, now = Date.now }) {
  const FILE = path.join(STORE, "customers.json");
  const SESS = path.join(STORE, "sessions.json");
  const COINS = path.join(STORE, "coins.json");
  const all = () => readJson(FILE, []);
  const saveAll = (list) => writeJson(FILE, list);
  const per = Number(coinsConfig.perRupees) || 100;     // 1 coin for every ₹100 paid
  const maxPct = Number(coinsConfig.maxPct) || 10;       // coins can pay up to this % of the bag

  // ---------- sessions ----------
  function sessions() {
    const s = readJson(SESS, {}), t = now();
    let gone = false;
    for (const [k, v] of Object.entries(s)) if (v.exp < t) { delete s[k]; gone = true; }
    if (gone) writeJson(SESS, s);
    return s;
  }
  function startSession(customerId) {
    const token = crypto.randomBytes(32).toString("hex");
    const s = sessions();
    s[sha(token)] = { cid: customerId, exp: now() + SESSION_MS };
    writeJson(SESS, s);
    return token;
  }
  function endSession(token) {
    if (!token) return;
    const s = sessions();
    if (s[sha(token)]) { delete s[sha(token)]; writeJson(SESS, s); }
  }
  function byToken(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const v = sessions()[sha(token)];
    return v ? all().find((c) => c.id === v.cid) || null : null;
  }

  // ---------- customers ----------
  function newCustomer(fields) {
    return { id: crypto.randomBytes(8).toString("hex"), createdAt: new Date(now()).toISOString(), name: "", phone: null, email: null, google: null, address: {}, bag: [], wish: [], coins: [], ...fields };
  }
  function findOrCreate(match, fields) {
    const list = all();
    let c = list.find(match);
    if (!c) { c = newCustomer(fields); list.push(c); }
    else for (const [k, v] of Object.entries(fields)) if (v && !c[k]) c[k] = v; // fill gaps, never overwrite
    c.lastSeen = new Date(now()).toISOString();
    saveAll(list);
    return c;
  }
  function update(id, fn) {
    const list = all(), c = list.find((x) => x.id === id);
    if (!c) return null;
    fn(c);
    saveAll(list);
    return c;
  }

  // ---------- WhatsApp sign-in ----------
  const codes = new Map(); // code -> { pend: hash of the browser's secret, exp, phone }
  function waStart() {
    for (const [k, v] of codes) if (v.exp < now()) codes.delete(k);
    let code;
    do code = String(crypto.randomInt(100000, 1000000)); while (codes.has(code));
    const pending = crypto.randomBytes(24).toString("hex");
    codes.set(code, { pend: sha(pending), exp: now() + CODE_MS, phone: null });
    return { code, pending, expiresIn: CODE_MS };
  }
  // A WhatsApp message came in. Returns the reply to send, or null when it isn't a login.
  const LOGIN = /\blog\s?in\b\D{0,12}(\d{6})\b/i;
  function waMessage(fromDigits, text) {
    const m = LOGIN.exec(String(text || ""));
    if (!m) return null;
    const hit = codes.get(m[1]);
    if (!hit || hit.exp < now()) return "That login code has run out. Go back to the website and tap *Verify on WhatsApp* again.";
    let d = String(fromDigits || "").replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
    if (!/^\d{10}$/.test(d)) return "Sorry, sign-in on the website works with Indian WhatsApp numbers only. Message us and we'll help you order.";
    hit.phone = d;
    return "✅ You're signed in to Vibe X. Go back to the website, your bag is waiting.";
  }
  // The browser asks "has my message arrived?" with the secret only it holds.
  function waCheck(pending) {
    const h = sha(pending || "");
    for (const [code, v] of codes) {
      if (v.pend !== h) continue;
      if (v.exp < now()) { codes.delete(code); return { expired: true }; }
      if (!v.phone) return { waiting: true };
      codes.delete(code);
      const c = findOrCreate((x) => x.phone === v.phone, { phone: v.phone });
      return { customer: c, token: startSession(c.id) };
    }
    return { expired: true };
  }

  // ---------- Google sign-in ----------
  // Google's ID token, checked by Google itself. Only accepted for our own client id.
  async function google(credential, clientId, fetchImpl = fetch) {
    if (!clientId) return { error: "Google sign-in isn't set up yet." };
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(String(credential || ""))) return { error: "Google sign-in failed. Please try again." };
    let info;
    try {
      const r = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!r.ok) return { error: "Google sign-in failed. Please try again." };
      info = await r.json();
    } catch { return { error: "Couldn't reach Google. Please try again." }; }
    const okIss = info.iss === "accounts.google.com" || info.iss === "https://accounts.google.com";
    if (info.aud !== clientId || !okIss || Number(info.exp) * 1000 < now() || !info.sub) return { error: "Google sign-in failed. Please try again." };
    const email = info.email_verified === true || info.email_verified === "true" ? String(info.email || "").toLowerCase() : null;
    const c = findOrCreate((x) => x.google === info.sub || (email && x.email === email), { google: info.sub, email, name: clean(info.name, 60) });
    return { customer: c, token: startSession(c.id) };
  }

  // ---------- bag, wishlist, address ----------
  const sanBag = (bag) => (Array.isArray(bag) ? bag : []).slice(0, BAG_MAX)
    .map((l) => ({ id: clean(l.id, 40), size: clean(l.size, 30), qty: Math.min(9, Math.max(1, Math.floor(Number(l.qty) || 1))) }))
    .filter((l, i, a) => /^[\w-]+$/.test(l.id) && a.findIndex((x) => x.id === l.id && x.size === l.size) === i);
  const sanWish = (w) => [...new Set((Array.isArray(w) ? w : []).map((x) => clean(x, 40)).filter((x) => /^[\w-]+$/.test(x)))].slice(0, WISH_MAX);
  function setBag(id, bag) { return update(id, (c) => { c.bag = sanBag(bag); }); }
  // Signing in on a phone with things already in its bag: both bags join.
  function mergeBag(id, bag) { return update(id, (c) => { c.bag = sanBag([...(c.bag || []), ...sanBag(bag)]); }); }
  function setWish(id, wish) { return update(id, (c) => { c.wish = sanWish(wish); }); }
  function setAddress(id, a = {}) {
    return update(id, (c) => {
      c.address = { name: clean(a.name, 60), phone: String(a.phone || "").replace(/\D/g, "").slice(-10), delivery: a.delivery === "pickup" ? "pickup" : "ship", address: clean(a.address, 300), city: clean(a.city, 60), pin: String(a.pin || "").replace(/\D/g, "").slice(0, 6) };
      if (!c.name && c.address.name) c.name = c.address.name;
    });
  }

  // ---------- coins ----------
  const balance = (c) => Math.max(0, (c?.coins || []).reduce((s, x) => s + x.n, 0));
  const redeemOn = () => Boolean(readJson(COINS, {}).redeem);
  const setRedeem = (on) => { writeJson(COINS, { ...readJson(COINS, {}), redeem: Boolean(on), changedAt: new Date(now()).toISOString() }); return redeemOn(); };
  const earnFor = (paidForGoods) => Math.floor(Math.max(0, paidForGoods) / per);
  // Most coins a bag of this value can use right now.
  function usable(c, goods) { return redeemOn() ? Math.min(balance(c), Math.floor((goods * maxPct) / 100)) : 0; }
  // Each order earns, spends or gives back once, however many times it's confirmed or cancelled.
  function coinEntry(id, n, why, order) {
    if (!n) return null;
    return update(id, (c) => {
      c.coins ||= [];
      if (c.coins.some((x) => x.order === order && x.why === why)) return;
      c.coins.push({ at: new Date(now()).toISOString(), n, why, order });
    });
  }
  const spend = (id, n, order) => coinEntry(id, -Math.abs(n), "spent", order);
  const earn = (id, goodsPaid, order) => coinEntry(id, earnFor(goodsPaid), "earned", order);
  // A cancelled order: coins it earned are taken back, coins it spent come back.
  function undo(id, order) {
    const c = all().find((x) => x.id === id);
    if (!c) return;
    const e = (c.coins || []).find((x) => x.order === order && x.why === "earned" && !c.coins.some((y) => y.order === order && y.why === "earned back"));
    if (e) coinEntry(id, -e.n, "earned back", order);
    const s = (c.coins || []).find((x) => x.order === order && x.why === "spent" && !c.coins.some((y) => y.order === order && y.why === "refunded"));
    if (s) coinEntry(id, -s.n, "refunded", order);
  }

  // What the customer's own page shows. Never other people's data, never Google's id.
  function view(c) {
    return {
      signedIn: true, id: c.id, name: c.name || c.address?.name || "", phone: c.phone, email: c.email, via: c.google ? (c.phone ? "both" : "google") : "whatsapp",
      address: c.address || {}, bag: c.bag || [], wish: c.wish || [],
      coins: { balance: balance(c), redeemOn: redeemOn(), perRupees: per, maxPct, history: (c.coins || []).slice(-30).reverse() },
    };
  }

  return { byToken, endSession, waStart, waMessage, waCheck, google, setBag, mergeBag, setWish, setAddress, view, balance, usable, earn, spend, undo, redeemOn, setRedeem, earnFor, get: (id) => all().find((c) => c.id === id) || null, list: all, SESSION_MS };
};

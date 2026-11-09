// Customer accounts with no sign-in at all (decided 2026-11-09: the least friction, nothing to buy).
// The first order from a phone quietly makes its account and a long-lived cookie on that phone.
// From then on the phone has its orders, saved address (checkout fills itself in), bag, wishlist
// and coins. Before the first order, the bag and wishlist live in the browser.
//
// Files (in STORE): customers.json, sessions.json (token hashes only), coins.json (redeem switch).
const path = require("path");
const crypto = require("crypto");
const { readJson, writeJson } = require("./jsonstore");

const SESSION_MS = 400 * 864e5;       // the longest a browser keeps a cookie
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
    return { id: crypto.randomBytes(8).toString("hex"), createdAt: new Date(now()).toISOString(), name: "", phone: null, address: {}, bag: [], wish: [], coins: [], ...fields };
  }
  function update(id, fn) {
    const list = all(), c = list.find((x) => x.id === id);
    if (!c) return null;
    fn(c);
    saveAll(list);
    return c;
  }

  // ---------- a new account for this phone ----------
  // Made by its first order. Never matched to anyone else by the number typed in: that would hand
  // a stranger's orders and address to whoever types their number.
  function create(fields = {}) {
    const list = all(), c = newCustomer({ ...fields, lastSeen: new Date(now()).toISOString() });
    list.push(c);
    saveAll(list);
    return { customer: c, token: startSession(c.id) };
  }

  // ---------- bag, wishlist, address ----------
  const sanBag = (bag) => (Array.isArray(bag) ? bag : []).slice(0, BAG_MAX)
    .map((l) => ({ id: clean(l.id, 40), size: clean(l.size, 30), qty: Math.min(9, Math.max(1, Math.floor(Number(l.qty) || 1))) }))
    .filter((l, i, a) => /^[\w-]+$/.test(l.id) && a.findIndex((x) => x.id === l.id && x.size === l.size) === i);
  const sanWish = (w) => [...new Set((Array.isArray(w) ? w : []).map((x) => clean(x, 40)).filter((x) => /^[\w-]+$/.test(x)))].slice(0, WISH_MAX);
  function setBag(id, bag) { return update(id, (c) => { c.bag = sanBag(bag); }); }
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

  // What the customer's own page shows. Never other people's data.
  function view(c) {
    return {
      signedIn: true, id: c.id, name: c.name || c.address?.name || "", phone: c.phone || c.address?.phone || null,
      address: c.address || {}, bag: c.bag || [], wish: c.wish || [],
      coins: { balance: balance(c), redeemOn: redeemOn(), perRupees: per, maxPct, history: (c.coins || []).slice(-30).reverse() },
    };
  }

  return { byToken, endSession, create, setBag, setWish, setAddress, view, balance, usable, earn, spend, undo, redeemOn, setRedeem, earnFor, get: (id) => all().find((c) => c.id === id) || null, list: all, SESSION_MS };
};

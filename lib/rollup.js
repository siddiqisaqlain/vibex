// Turns visitor events into one compact record per visit, and records into the report the owner reads.
// Every number on /analytics comes from these records, so a month of visits costs a fraction of its raw events
// and any figure can be cut by device, source or new visitors without touching the raw files.
const MIN_SAMPLE = 5, MAX_STEPS = 200, MAX_VISITS_SHOWN = 200, MAX_PATH = 60, MAX_TAPS = 40, GRID_X = 10, GRID_Y = 16;
const IST = 5.5 * 3600e3, DAY_MS = 24 * 3600e3;
const dayOf = (t) => new Date(t + IST).toISOString().slice(0, 10);

function sourceOf(pg) {
  const u = (pg.utm || "").toLowerCase(), r = (pg.ref || "").toLowerCase();
  const test = (re) => re.test(u) || re.test(r);
  if (pg.br === "Instagram app" || test(/instagram/)) return "Instagram";
  if (pg.br === "Facebook app" || test(/facebook|^fb$|fb\.com/)) return "Facebook";
  if (test(/whatsapp|wa\.me/)) return "WhatsApp";
  if (test(/youtube|youtu\.be/)) return "YouTube";
  if (test(/google|bing|duckduckgo|yahoo/)) return "Search";
  if (u || r) return "Other sites";
  return "Direct or shared link";
}
// Every page the shop has, by kind. Pages added after the first version (the Wardrobe, the bag, the account) each get their own row.
const PAGE_KINDS = [["home", "Home page"], ["product", "Product pages"], ["wardrobe", "The Wardrobe"], ["bag", "Bag"], ["account", "My account"], ["policy", "Policies and contact"], ["other", "Other pages"]];
const PAGE_LABEL = { "/": "Home page", "/wardrobe": "Wardrobe page", "/bag": "Bag page", "/account": "Account page", "/returns": "Returns page", "/terms": "Terms page", "/privacy": "Privacy page", "/contact": "Contact page" };
const kindOf = (p) => (p === "/" ? "home" : /^\/p\//.test(p) ? "product" : p === "/wardrobe" ? "wardrobe" : p === "/bag" ? "bag" : p === "/account" ? "account" : /^\/(returns|terms|privacy|contact)$/.test(p) ? "policy" : "other");
const pageLabel = (p, title) => PAGE_LABEL[p] || title || p;
const pageGroup = (p) => (/^\/p\//.test(p) ? "Product page" : PAGE_LABEL[p] || p);
const WA_PLACE = { updates: "Get order updates button, while paying or after", search: "After a search found nothing", checkout: "From checkout", enquiry: "From the enquiry box", photos: "Asked for real photos", size: "Asked about size", product: "Chat link on a product", dock: "Bottom bar on phones", footer: "Footer", header: "Top of the page or menu", help: "From a help note", page: "Elsewhere on a page" };
const FEATURE = [["search", "Used search"], ["bag_add", "Added to the bag"], ["bag_view", "Opened the bag"], ["wish", "Saved a piece to the wishlist"], ["account", "Opened My account"], ["teaser", "Pressed the Wardrobe card on the home page"], ["wardrobe", "Visited The Wardrobe"], ["wd_open", "Picked up a piece in The Wardrobe"], ["wd_drawer", "Opened a fragrance drawer"], ["wd_order", "Went from The Wardrobe to a product"], ["wa", "Moved to WhatsApp"]];
const isWaTap = (label) => /whatsapp|real photos of this piece/i.test(label); // visits stored before WhatsApp moves were counted properly
const STOP_LABEL = { price: "Price or offer", shipping: "Delivery cost or time", trust: "Not sure about paying online", payment: "Payment didn't work", size: "Size or details unclear", later: "Just looking" };
const SECTION_LABEL = { hero: "Top of the page", feat: "Featured", "wardrobe-teaser": "The Wardrobe card", stats: "Why Vibe X", "ask-dialog": "Checkout or enquiry box", "co-dialog": "Checkout box", top: "Header", foot: "Footer", dialog: "Pop-up", range: "Shop by category", rack: "Fresh off the truck", find: "Find your fit", "looks-sec": "Just landed", how: "How it works", visit: "The store", latest: "Latest video" };
const FIELD_LABEL = { name: "Name", phone: "Phone number", delivery: "Pick up or deliver", address: "Address", pin: "PIN code", city: "City", hideName: "Hide my name", email: "Email", note: "Note" };
const FIELD_ORDER = ["name", "phone", "delivery", "address", "city", "pin", "hideName", "note", "email"];
const PART_LABEL = { photos: "Photos", description: "Description", sizes: "Choose size", facts: "Details", related: "More like this" };
const PART_ORDER = { home: ["hero", "stats", "feat", "wardrobe-teaser", "rack", "find", "looks-sec", "how", "visit", "latest"], product: ["photos", "description", "sizes", "facts", "related"] };
const KIND_LABEL = { rage: "Pressed again and again", dead: "Pressed, nothing happened", invalid: "Form stopped them", formerr: "Saw an error", err: "Site error", abandon: "Gave up", uturn: "Opened and went straight back" };
const zoneLabel = (x) => SECTION_LABEL[x] || PART_LABEL[x] || x;
const inOrder = (rows, order) => [...rows].sort((a, b) => { const i = order.indexOf(a.key), j = order.indexOf(b.key); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
const placeLabel = (raw = "?") => { const x = raw.replace(/: store-pic$/, ": Photos"); const [a, ...rest] = x.split(": "); const what = rest.join(": "), place = SECTION_LABEL[a]; return !what || !place ? x : what === place ? place : `${place}: ${what}`; };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const pick = (o) => Object.entries(o).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
const sum = (a) => a.reduce((x, y) => x + y, 0);
function quantile(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0; }
function spread(values) { const s = [...values].sort((a, b) => a - b); return { n: s.length, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75), slowest: s[s.length - 1] || 0 }; }
const median = (a) => spread(a).median;
// How far a rate could really be from what was measured, from the sample size (95% Wilson interval).
function margin(hits, n) {
  if (!n) return { low: 0, high: 0 };
  const z = 1.96, p = hits / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.round(((c - m) / d) * 1000) / 10, high: Math.round(((c + m) / d) * 1000) / 10 };
}
// Is the gap between two rates more than chance? Two-proportion test; |z| of 2 is about 95% sure.
function isReal(a, n, b, m) {
  if (!n || !m || a + b < MIN_SAMPLE) return false; // the sum below means nothing on a handful of events
  const p = (a + b) / (n + m), se = Math.sqrt(p * (1 - p) * (1 / n + 1 / m));
  return se > 0 && Math.abs(a / n - b / m) / se >= 2;
}
// Crashes in the scripts Instagram and Facebook inject into their in-app browser. Nothing on the site broke.
const APP_NOISE = /Java object is gone|Error invoking postMessage|window\.webkit\.messageHandlers/i;
const sureness = (n) => (n >= 100 ? "strong" : n >= 30 ? "fair" : "weak");

// The room a visitor is in, the same word on the floor plan, live and replayed.
// Inside the payment step: looking at the options, in their UPI app, paying by hand, back and waiting, or out of time.
const PAY_ROOM = { screen: "pay", app: "pay:app", qr: "pay:manual", copy: "pay:manual", other: "pay:manual", back: "pay:back", wa: "pay:back", name: "pay:back", late: "pay:late" };
const PAY_LABEL = { pay: "Looking at how to pay", "pay:app": "In their UPI app", "pay:manual": "QR, UPI ID or bank details", "pay:back": "Waiting for the shop to confirm", "pay:late": "Time ran out" };
const PAY_STAGE = [["screen", "Reached the payment screen"], ["app", "Pressed a UPI app button"], ["qr", "Opened the QR"], ["copy", "Copied the UPI ID, amount or number"], ["other", "Opened Other ways to pay"], ["away", "Left the page (likely to their UPI app)"], ["back", "Came back and waited for the shop"], ["name", "Typed a name on the pay screen"], ["wa", "Pressed Get order updates on WhatsApp"], ["late", "Ran out of time"]];
function roomOf(path, step, zone, box, ps) {
  if (step === "paid") return "sold";
  if (step === "left") return "left";
  if (step === "pay") return PAY_ROOM[ps] || "pay";
  if (step === "details") return box ? `f:${box}` : "f:name";
  if (path === "/") return `z:${zone || "hero"}`;
  const m = /^\/p\/(.+)$/.exec(path || "");
  if (m) return `p:${m[1]}`;
  const kind = kindOf(path || "");
  return kind === "wardrobe" || kind === "bag" || kind === "account" ? `pg:${kind}` : "back";
}

// ---- one record per visit ----
function newRecord(ev) {
  return {
    s: ev.s, v: ev.v, a: ev.t, b: ev.t, eng: 0, fr: 0, val: 0, enq: 0, pc: 0, ab: "", abf: "",
    pg: [], pt: [], ot: [], dw: {}, dp: {}, rch: {}, z: {}, zo: [], bx: {}, pr: {}, st: {}, tp: {}, gd: {}, ac: {}, ft: {}, ptb: {}, sr: {}, fb: [], tm: {}, ld: [], vt: {}, tl: [], rf: {}, ns: {}, nc: {}, nt: {}, sq: {}, wa: [], ps: {}, fp: 0, steps: [],
    _p: "/", _st: "", _z: "", _b: "", _room: "", _ps: "",
  };
}
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const prow = (r, id) => (r.pr[id] ||= { seen: 0, seenMs: 0, clicks: 0, view: 0, co: 0, enq: 0, paid: 0, val: 0, ab: 0, chat: 0, wd: 0 });

function feed(r, ev) {
  if (ev.e === "err" && APP_NOISE.test(ev.x || "")) return; // days stored before the tracker dropped these
  r.a = Math.min(r.a, ev.t); r.b = Math.max(r.b, ev.t);
  const e = ev.e;
  // Anything saved before the tracker knew about the sales banner: its words sit beside a customer's name.
  if ((e === "tap" || e === "rage" || e === "dead") && /\b(just grabbed|just bought|bought)\b/i.test(ev.x || "")) ev = { ...ev, x: "Just bought banner" };
  if (ev.n && (e === "beat" || e === "leave")) { r.eng += ev.n; bump(r.dw, ev.p, ev.n); }
  if (ev.sc !== undefined) r.dp[ev.p] = Math.max(r.dp[ev.p] || 0, ev.sc);
  if (e === "page") {
    if (!r.f) { r.f = { dev: ev.dev, br: ev.br, os: ev.os, lang: ev.lang, tz: ev.tz, ref: ev.ref, camp: ev.camp, utm: ev.utm, nw: ev.nw, w: ev.w, net: ev.net, arm: ev.arm }; r.src = sourceOf(ev); }
    r.pc++; if (r.pg.length < MAX_PATH) { r.pg.push(ev.p); r.pt.push(ev.t); }
    if (ev.pr || ev.p.startsWith("/p/")) { r.rch.p = 1; if (ev.pr) prow(r, ev.pr).view = 1; }
    r._p = ev.p; r._st = ""; r._z = ""; r._b = "";
  } else if (e === "pclick") { r.rch.p = 1; if (ev.pr) prow(r, ev.pr).clicks++; }
  // The bag (2026-11-08): Add to bag, then checkout. No sign-in since 2026-11-09.
  else if (e === "bag_add") { r.rch.p = r.rch.g = 1; bump(r.ac, "bag_add"); if (ev.pr) prow(r, ev.pr).co = 1; }
  else if (e === "bag_view" || e === "bag_checkout" || e === "wish" || e === "wardrobe_teaser") bump(r.ac, e === "wardrobe_teaser" ? "teaser" : e)
  // What they typed into search: the words, how often, and how many pieces it found the last time.
  else if (e === "search") { const k = (ev.x || "").toLowerCase(); bump(r.ac, "search"); if (k && (r.sq[k] || Object.keys(r.sq).length < 12)) r.sq[k] = [(r.sq[k]?.[0] || 0) + 1, ev.n || 0]; }
  else if (e === "wd") { bump(r.ac, `wd_${ev.x}`); if (ev.x === "open" && ev.pr) prow(r, ev.pr).wd = 1; }
  else if (e === "signin") { r.rch.s = 1; }
  else if (e === "checkout") { if ((ev.x === "a" || ev.x === "b") && !r.fa) r.fa = ev.x; r.rch.c = r.rch.g = 1; r._st = "details"; r._b = ""; if (ev.pr) prow(r, ev.pr).co = 1; if (ev.ms) r.tm.dc = ev.ms; }
  else if (e === "details") { r.rch.c = r.rch.g = r.rch.d = 1; r._st = "pay"; r._ps = "screen"; r.ps.screen = 1; if (ev.ms) r.tm.dt = ev.ms; }
  else if (e === "pay") { r.ps[ev.x] = 1; if (ev.x === "app" && ev.r) r.ps[`app:${ev.r}`] = 1; if (ev.x !== "away") r._ps = ev.x; }
  else if (e === "paid") { r.rch.c = r.rch.g = r.rch.d = r.rch.b = 1; r._st = "paid"; r.val += ev.n || 0; r.fp += ev.fp || ev.n || 0; r.ot.push(ev.t); if (ev.ms) r.tm.py = ev.ms; if (ev.pr) { const p = prow(r, ev.pr); p.paid++; p.val += ev.n || 0; } }
  else if (e === "enq") { r.enq++; if (ev.pr) prow(r, ev.pr).enq = 1; }
  else if (e === "wa" || e === "ig") {
    bump(r.ac, e); if (ev.pr) prow(r, ev.pr).chat++;
    // The move to WhatsApp: where from, and the message the site wrote for them. Their reply itself never reaches the site.
    if (e === "wa" && r.wa.length < 8) r.wa.push({ t: ev.t, p: ev.p, pr: ev.pr || "", x: ev.x || "", m: ev.note || "" });
  }
  else if (e === "card") { if (ev.pr) { const p = prow(r, ev.pr); p.seen = 1; p.seenMs += ev.n || 0; } }
  else if (e === "section") { if (ev.p === "/") r.sr[ev.x] = 1; }
  else if (e === "sec") {
    const g = ev.p === "/" ? "home" : ev.p.startsWith("/p/") ? "product" : null;
    if (g) { const z = r.z[`${g}|${ev.x}`] ||= [0, 0, 0, 0]; z[0] += ev.n || 0; z[1]++; z[2] = Math.max(z[2], ev.pk || 0); z[3] += ev.rv || 0; if (g === "home" && r.zo.length < MAX_PATH) r.zo.push(ev.x); }
    r._z = ev.x;
  } else if (e === "field") {
    if (ev.st2 === "checkout" || ev.st2 === "enquiry") {
      const b = r.bx[`${ev.st2}|${ev.x}`] ||= { ms: 0, ed: 0, del: 0, fl: 0, fk: 0, pa: 0, au: 0, bad: 0, vis: 0 };
      b.ms += ev.n || 0; b.ed += ev.ed || 0; b.del += ev.del || 0; b.fl = ev.fl ?? b.fl; b.vis++; b.pa += ev.pa || 0; b.au += ev.au || 0; b.bad = ev.bad ?? b.bad; if (!b.fk && ev.fk) b.fk = ev.fk;
    }
    r._b = ev.x;
  } else if (e === "tap") {
    if (ev.x && (r.tp[ev.x] || Object.keys(r.tp).length < MAX_TAPS)) bump(r.tp, ev.x);
    if (ev.z && ev.sx !== undefined) bump(r.gd, `${ev.z}:${Math.min(GRID_X - 1, Math.floor(ev.sx / (100 / GRID_X)))},${Math.min(GRID_Y - 1, Math.floor(ev.sy / (100 / GRID_Y)))}`);
  } else if (e === "filter") { if (ev.x) bump(r.ft, ev.x); bump(r.ac, "filter"); }
  else if (["map", "call", "video", "yt", "copy", "enq_open"].includes(e)) bump(r.ac, e);
  else if (e === "pay_tab") { if (ev.x) bump(r.ptb, ev.x); }
  else if (e === "choice") { if (ev.r) r.dl = ev.r; }
  else if (e === "perf") { if (ev.n && r.ld.length < 12) r.ld.push(ev.n); }
  else if (e === "vit") { for (const k of ["lcp", "inp", "cls", "ttfb"]) if (ev[k] !== undefined) r.vt[k] = Math.max(r.vt[k] || 0, ev[k]); }
  else if (e === "fb") {
    if (r.fb.length < 6) r.fb.push({ t: ev.t, x: ev.x, r: ev.r, note: ev.note || "", pr: ev.pr || "", st2: ev.st2 || "", p: ev.p });
  }
  if (e === "nudge" && ev.x) { if (ev.ctl) r.nc[ev.x] = 1; else r.ns[ev.x] = 1; }
  if (e === "nudge_tap" && ev.x) r.nt[ev.x] = 1;
  if (e === "pred" && r.pf === undefined) r.pf = ev.pb; // the first guess, made before the outcome was known
  if (e === "abandon") { r.ab = ev.x || "?"; r._st = "left"; if (ev.pr) prow(r, ev.pr).ab++; if (ev.n) r.tm[ev.x === "pay" ? "gp" : "gd"] = ev.n; if (ev.f) r.abf = ev.f; }
  if (e === "abandon" || ["rage", "dead", "invalid", "formerr", "err"].includes(e)) {
    r.fr++;
    const where = pageGroup(ev.p);
    const label = e === "abandon" ? (ev.x === "pay" ? "Left on the payment step" : `Left the details form${ev.f ? ` at: ${FIELD_LABEL[ev.f] || ev.f}` : " before typing"}`) : e === "invalid" ? FIELD_LABEL[ev.x] || ev.x || "?" : e === "rage" || e === "dead" ? placeLabel(ev.x) : ev.x || "?";
    bump(r.st, `${e}\u0001${e === "abandon" ? "Checkout" : where}\u0001${label}`);
    if (e === "invalid") bump(r.ac, `bad:${ev.x}`);
    if (e === "formerr" && r._b) bump(r.ac, `bad:${r._b}`);
  }
  const room = roomOf(r._p, r._st, r._z, r._b, r._ps);
  if (room !== r._room && r.tl.length < MAX_PATH) { r.tl.push([ev.t, room]); r._room = room; }
  if (e === "abandon" || ["rage", "dead", "invalid", "formerr", "err"].includes(e)) r.rf[r._room || room] = 1;
  if (!["beat", "leave", "perf", "card", "vit", "pred"].includes(e) && r.steps.length < MAX_STEPS) r.steps.push(ev);
}
const hasStart = (r) => Boolean(r.f); // heartbeats from before a day's first page don't make a visit

// Which visits a filter keeps: "dev:Phone", "src:Instagram" or "new:1".
function segmentTest(seg) {
  const m = /^(dev|src|new):(.+)$/.exec(seg || "");
  if (!m) return () => true;
  if (m[1] === "dev") return (r) => r.f.dev === m[2];
  if (m[1] === "src") return (r) => r.src === m[2];
  return (r) => Boolean(r.f.nw) === (m[2] === "1");
}

// ---- adding records up ----
function newTotals() { return { visitors: new Set(), newVisitors: new Set(), visits: 0, pages: 0, eng: [], bounced: 0, paid: 0, value: 0, enq: 0, friction: 0 }; }
function addTotals(t, r) {
  t.visitors.add(r.v); if (r.f.nw) t.newVisitors.add(r.v);
  t.visits++; t.pages += r.pc; t.eng.push(r.eng);
  if (r.pc === 1 && r.eng < 10e3 && !r.rch.c) t.bounced++;
  if (r.rch.b) { t.paid++; t.value += r.val; }
  t.enq += r.enq; if (r.fr) t.friction++;
}
function readTotals(t) {
  return {
    visitors: t.visitors.size, visits: t.visits, pages: t.pages, newVisitors: t.newVisitors.size,
    medianEngaged: median(t.eng), pagesPerVisit: t.visits ? Math.round((t.pages / t.visits) * 10) / 10 : 0,
    bounceRate: pct(t.bounced, t.visits), orders: t.paid, value: t.value, conversion: pct(t.paid, t.visits), conversionRange: margin(t.paid, t.visits),
    enquiries: t.enq, frictionRate: pct(t.friction, t.visits), friction: t.friction,
  };
}

function newReport({ from, to }) {
  const oneDay = from === to, buckets = new Map();
  if (oneDay) for (let h = 0; h < 24; h++) buckets.set(String(h).padStart(2, "0"), { key: String(h).padStart(2, "0"), visitors: new Set(), pages: 0, orders: 0 });
  else for (let d = Date.parse(from); d <= Date.parse(to); d += DAY_MS) { const k = new Date(d).toISOString().slice(0, 10); buckets.set(k, { key: k, visitors: new Set(), pages: 0, orders: 0 }); }
  return {
    from, to, oneDay, buckets, totals: newTotals(), funnel: { product: 0, bag: 0, checkout: 0, details: 0, paid: 0 }, heat: Array.from({ length: 7 }, () => Array(24).fill(0)),
    pg: {}, pr: {}, stuck: {}, abandonAt: { details: 0, pay: 0 }, abandonField: {}, feedback: [], stops: {}, ratings: { good: 0, ok: 0, bad: 0 }, zones: { home: {}, product: {} }, boxes: { checkout: {}, enquiry: {} }, opened: { checkout: 0, enquiry: 0 },
    times: { dc: [], dt: [], py: [], gd: [], gp: [] }, payTabs: {}, delivery: {}, pressed: {}, grids: {}, secSet: {}, homeVisits: 0, scroll: { "Home page": [0, 0, 0, 0], "Product page": [0, 0, 0, 0], base: { "Home page": 0, "Product page": 0 } },
    acts: {}, filters: {}, bySource: {}, byDevice: {}, campaigns: {}, referrers: {}, browsers: {}, systems: {}, places: {}, languages: {}, nets: {}, widths: {}, outcomes: {}, load: [], vit: { lcp: [], inp: [], cls: [], ttfb: [] },
    speedOutcome: { fast: [0, 0], slow: [0, 0] }, arms: { on: { n: 0, paid: 0 }, off: { n: 0, paid: 0 } }, helps: {}, bands: [0, 0, 0, 0].map(() => ({ n: 0, paid: 0, guess: 0 })), received: 0, listed: 0, rooms: {}, edges: {}, timeline: oneDay ? { t0: Date.parse(from) - IST, step: 15 * 60e3, slots: Array.from({ length: 96 }, () => ({ rooms: {}, edges: {} })) } : null, recent: [],
    payStage: {}, formTest: { a: { opened: 0, reachedPay: 0, paid: 0 }, b: { opened: 0, reachedPay: 0, paid: 0 } }, foot: {}, feat: {}, sq: {}, chat: { taps: 0, people: 0, buyers: 0, place: {}, prod: {}, list: [] }, wdr: { visits: 0, opened: 0, buyers: 0 },
  };
}
const outcomeOf = (r) => (r.rch.b ? "Paid" : r.enq ? "Enquired" : r.ab ? "Left checkout" : r.rch.p ? "Browsed products" : "Looked around");
const room = (R, k) => (R.rooms[k] ||= { people: 0, buyers: 0, stuck: 0, ended: 0, times: [], came: 0, next: {} });

function addRecord(R, r) {
  addTotals(R.totals, r);
  const paid = Boolean(r.rch.b);
  if (r.rch.p) R.funnel.product++; if (r.rch.g) R.funnel.bag++; if (r.rch.c) R.funnel.checkout++; if (r.rch.d) R.funnel.details++; if (paid) R.funnel.paid++;
  r.pg.forEach((p, i) => {
    const t = r.pt[i], local = new Date(t + IST), b = R.buckets.get(R.oneDay ? local.toISOString().slice(11, 13) : local.toISOString().slice(0, 10));
    if (b) { b.visitors.add(r.v); b.pages++; }
    R.heat[local.getUTCDay()][local.getUTCHours()]++;
    const row = R.pg[p] ||= { path: p, views: 0, visits: 0, time: 0, exits: 0, lands: 0 };
    row.views++; if (i === 0) row.lands++;
  });
  for (const t of r.ot) { const local = new Date(t + IST), b = R.buckets.get(R.oneDay ? local.toISOString().slice(11, 13) : local.toISOString().slice(0, 10)); if (b) b.orders++; }
  const uniq = new Set(r.pg);
  for (const p of uniq) { const row = R.pg[p]; row.visits++; row.time += r.dw[p] || 0; }
  const last = r.pg[r.pg.length - 1]; if (R.pg[last]) R.pg[last].exits++;
  // footfall: every kind of page, who walked through it and what became of them
  const bucketOf = (t) => { const local = new Date(t + IST).toISOString(); return R.oneDay ? local.slice(11, 13) : local.slice(0, 10); };
  const kinds = new Map();
  r.pg.forEach((p, i) => { const k = kindOf(p), f = R.foot[k] ||= { views: 0, visits: 0, people: new Set(), times: [], lands: 0, exits: 0, buyers: 0, trend: {} }; f.views++; if (!kinds.has(k)) kinds.set(k, r.pt[i]); });
  for (const [k, t] of kinds) { const f = R.foot[k], ms = sum([...uniq].filter((p) => kindOf(p) === k).map((p) => r.dw[p] || 0)); f.visits++; f.people.add(r.v); if (paid) f.buyers++; if (ms) f.times.push(ms); bump(f.trend, bucketOf(t)); }
  if (r.pg.length) { R.foot[kindOf(r.pg[0])].lands++; R.foot[kindOf(last)].exits++; }
  // the newer parts of the site: did anyone use them, and did those people buy?
  const ac = r.ac, oldWa = ac.wa ? 0 : sum(Object.entries(r.tp).filter(([k]) => isWaTap(k)).map(([, n]) => n)), waTaps = ac.wa || oldWa;
  const used = { search: ac.search, bag_add: ac.bag_add || (r.rch.g ? 1 : 0), bag_view: ac.bag_view || (uniq.has("/bag") ? 1 : 0), wish: ac.wish, account: uniq.has("/account") ? 1 : 0, teaser: ac.teaser, wardrobe: uniq.has("/wardrobe") ? 1 : 0, wd_open: ac.wd_open, wd_drawer: ac.wd_drawer, wd_order: ac.wd_order, wa: waTaps };
  for (const [k, n] of Object.entries(used)) if (n) { const f = R.feat[k] ||= { n: 0, people: 0, buyers: 0 }; f.n += n; f.people++; if (paid) f.buyers++; }
  for (const [k, [n, hits]] of Object.entries(r.sq || {})) { const q = R.sq[k] ||= { n: 0, people: 0, none: 0, hits: 0 }; q.n += n; q.people++; q.hits = hits; if (!hits) q.none++; }
  if (uniq.has("/wardrobe")) { R.wdr.visits++; if (ac.wd_open) R.wdr.opened++; if (paid) R.wdr.buyers++; }
  if (waTaps) {
    const C = R.chat; C.taps += waTaps; C.people++; if (paid) C.buyers++;
    for (const w of r.wa || []) { bump(C.place, w.x || "page"); if (w.pr) bump(C.prod, w.pr); C.list.push({ ...w, s: r.s, src: r.src, dev: r.f.dev, paid }); }
    if (C.list.length > 600) { C.list.sort((a, b) => b.t - a.t); C.list.length = 300; }
  }
  for (const [id, x] of Object.entries(r.pr)) {
    const p = R.pr[id] ||= { id, views: 0, clicks: 0, checkout: 0, enq: 0, paid: 0, value: 0, abandon: 0, chat: 0, time: 0, seen: 0, seenTime: 0, wd: 0 };
    p.wd += x.wd || 0;
    p.views += x.view; p.clicks += x.clicks; p.checkout += x.co; p.enq += x.enq; p.paid += x.paid; p.value += x.val; p.abandon += x.ab; p.chat += x.chat; p.seen += x.seen; p.seenTime += x.seenMs; p.time += r.dw[`/p/${id}`] || 0;
  }
  const seenKinds = new Set();
  for (const [k, n] of Object.entries(r.st)) { const row = R.stuck[k] ||= { n: 0, visits: 0 }; row.n += n; row.visits++; seenKinds.add(k); }
  r.pg.forEach((p, i) => { if (p.startsWith("/p/") && i < r.pg.length - 1 && (r.dw[p] || 0) < 5e3) { const k = `uturn\u0001Product page\u0001${p.slice(3)}`; const row = R.stuck[k] ||= { n: 0, visits: 0, id: p.slice(3) }; row.n++; if (!seenKinds.has(k)) { row.visits++; seenKinds.add(k); } } });
  if (r.ab in R.abandonAt) R.abandonAt[r.ab]++;
  if (r.abf) bump(R.abandonField, r.abf);
  for (const f of r.fb) { if (f.x === "stop") bump(R.stops, f.r); else if (f.r in R.ratings) R.ratings[f.r]++; R.feedback.push(f); }
  if (R.feedback.length > 400) { R.feedback.sort((a, b) => b.t - a.t); R.feedback.length = 200; }
  if (r.pg.includes("/")) R.homeVisits++;
  for (const x of Object.keys(r.sr)) bump(R.secSet, x);
  const groups = { "Home page": false, "Product page": false };
  for (const [p, d] of Object.entries(r.dp)) {
    const g = R.scroll[pageGroup(p)]; if (!g || p === "base") continue;
    groups[pageGroup(p)] = true;
    [25, 50, 75, 100].forEach((m, i) => { if (d >= (m === 100 ? 95 : m)) g[i]++; });
  }
  for (const k of Object.keys(groups)) if (groups[k]) R.scroll.base[k]++;
  for (const [k, z] of Object.entries(r.z)) {
    const [g, x] = k.split("|"), set = R.zones[g];
    if (!set) continue;
    const row = set[x] ||= { times: [], total: 0, read: 0, back: 0, deep: [], buyers: 0, rv: 0 };
    row.times.push(z[0]); row.total += z[0]; if (z[0] >= 4000) row.read++; if (z[1] > 1) row.back++; if (z[2]) row.deep.push(z[2]); row.rv += z[3]; if (paid) row.buyers++;
  }
  if (r.bx) for (const [k, b] of Object.entries(r.bx)) {
    const [form, x] = k.split("|"), set = R.boxes[form];
    if (!set) continue;
    const row = set[x] ||= { key: x, times: [], hes: [], keys: 0, people: 0, corrected: 0, empty: 0, pasted: 0, auto: 0, refocus: 0, bad: 0, buyers: 0, errors: 0 };
    row.people++; row.times.push(b.ms); if (b.fk) row.hes.push(b.fk); row.keys += b.ed; if (b.del) row.corrected++; if (!b.fl) row.empty++; if (b.pa) row.pasted++; if (b.au) row.auto++; if (b.vis > 1) row.refocus++; if (b.bad) row.bad++; if (paid) row.buyers++;
    row.errors += r.ac[`bad:${x}`] || 0;
  }
  for (const k of Object.keys(r.ps || {})) { const q = R.payStage[k] ||= { n: 0, paid: 0 }; q.n++; if (paid) q.paid++; }
  if (r.fa) { const a = R.formTest[r.fa]; a.opened++; if (r.rch.d) a.reachedPay++; if (paid) a.paid++; }
  if (r.rch.c) R.opened.checkout++;
  if (r.ac.enq_open) R.opened.enquiry++;
  for (const k of ["dc", "dt", "py", "gd", "gp"]) if (r.tm[k]) R.times[k].push(r.tm[k]);
  for (const [k, n] of Object.entries(r.ptb)) bump(R.payTabs, k, n);
  if (r.dl) bump(R.delivery, r.dl);
  for (const [x, n] of Object.entries(r.tp)) { const row = R.pressed[x] ||= { n: 0, people: 0, buyers: 0 }; row.n += n; row.people++; if (paid) row.buyers++; }
  for (const [k, n] of Object.entries(r.gd)) bump(R.grids, k, n);
  for (const [k, n] of Object.entries(r.ac)) if (!k.startsWith("bad:")) bump(R.acts, k, n);
  if (r.enq) bump(R.acts, "enq", r.enq);
  for (const [k, n] of Object.entries(r.ft)) bump(R.filters, k, n);
  const dev = r.f.dev || "Unknown";
  for (const [o, key] of [[R.bySource, r.src], [R.byDevice, dev]]) { const s = o[key] ||= { key, n: 0, paid: 0, friction: 0, engaged: 0 }; s.n++; s.paid += paid ? 1 : 0; s.friction += r.fr ? 1 : 0; s.engaged += r.eng; }
  const f = r.f;
  if (f.camp) bump(R.campaigns, f.camp); if (f.ref) bump(R.referrers, f.ref); if (f.br) bump(R.browsers, f.br); if (f.os) bump(R.systems, f.os); if (f.tz) bump(R.places, f.tz); if (f.lang) bump(R.languages, f.lang.slice(0, 2).toLowerCase()); if (f.net) bump(R.nets, f.net);
  if (f.w) bump(R.widths, f.w < 400 ? "Small phone" : f.w < 768 ? "Large phone" : f.w < 1200 ? "Tablet or small laptop" : "Large screen");
  bump(R.outcomes, outcomeOf(r));
  if (R.load.length < 200000) R.load.push(...r.ld);
  for (const k of ["lcp", "inp", "cls", "ttfb"]) if (r.vt[k] !== undefined) R.vit[k].push(r.vt[k]);
  if (r.vt.lcp !== undefined) { const b = R.speedOutcome[r.vt.lcp > 4000 ? "slow" : "fast"]; b[0]++; if (paid) b[1]++; }
  // the guide: did it help, and were its guesses right?
  if (R.arms[r.f.arm]) { R.arms[r.f.arm].n++; if (paid) R.arms[r.f.arm].paid++; }
  for (const [o, f] of [[r.ns, "shown"], [r.nc, "held"]]) for (const x of Object.keys(o)) { const h = R.helps[x] ||= { key: x, shown: 0, shownPaid: 0, held: 0, heldPaid: 0, tapped: 0 }; h[f]++; if (paid) h[`${f}Paid`]++; if (r.nt[x]) h.tapped++; }
  if (r.pf !== undefined) { const b = R.bands[r.pf < 10 ? 0 : r.pf < 30 ? 1 : r.pf < 60 ? 2 : 3]; b.n++; b.guess += r.pf; if (paid) b.paid++; }
  R.received += r.val; R.listed += r.fp || r.val;
  // the floor plan: who went through each room, and on to where
  const seen = new Set();
  r.tl.forEach(([t, k], i) => {
    const q = room(R, k), next = r.tl[i + 1], stay = next ? next[0] - t : Math.max(0, r.b - t);
    if (!seen.has(k)) { seen.add(k); q.people++; if (paid) q.buyers++; if (r.rf[k]) q.stuck++; }
    q.times.push(stay);
    if (next) { bump(q.next, next[1]); bump(R.edges, `${k}>${next[1]}`); } else q.ended++;
    if (R.timeline) {
      const T = R.timeline, a = Math.floor((t - T.t0) / T.step), z = Math.min(a + Math.ceil(Math.max(stay, 1) / T.step), T.slots.length);
      for (let s = Math.max(0, a); s < z; s++) { const c = T.slots[s].rooms[k] ||= [0, 0, 0]; c[0]++; if (r.rf[k]) c[1]++; if (k === "sold") c[2]++; }
      if (next && a >= 0 && a < T.slots.length) bump(T.slots[a].edges, `${k}>${next[1]}`);
    }
  });
  if (r.steps?.length) { R.recent.push(r); if (R.recent.length > MAX_VISITS_SHOWN * 2) { R.recent.sort((a, b) => b.a - a.a); R.recent.length = MAX_VISITS_SHOWN; } }
}

// ---- reading it out ----
function finish(R, { name = (id) => id, catalog = [], prevTotals = null, recentExtra = [] } = {}) {
  const totals = readTotals(R.totals), n = R.totals.visits;
  const funnel = [
    { key: "visit", label: "Came to the site", n }, { key: "product", label: "Looked at a product", n: R.funnel.product }, { key: "bag", label: "Added to bag", n: R.funnel.bag }, { key: "checkout", label: "Started checkout", n: R.funnel.checkout },
    { key: "details", label: "Filled in their details", n: R.funnel.details }, { key: "paid", label: "Order confirmed", n: R.funnel.paid },
  ];
  const trend = [...R.buckets.values()].map((b) => ({ ...b, visitors: b.visitors.size }));
  const pages = Object.values(R.pg).map((r) => {
    const id = (/^\/p\/(.+)$/.exec(r.path) || [])[1];
    return { path: r.path, label: id ? name(id) : pageLabel(r.path), views: r.views, visits: r.visits, avgTime: Math.round(r.time / Math.max(1, r.visits)), lands: r.lands, exits: r.exits, exitRate: pct(r.exits, r.visits) };
  }).sort((a, b) => b.views - a.views);
  // Every product listed on the website gets a row, looked at or not, so nothing on the shelf is invisible here.
  const listed = new Map(catalog.map((c) => [c.id, c])), prRows = Object.values(R.pr);
  for (const c of catalog) if (!R.pr[c.id]) prRows.push({ id: c.id, views: 0, clicks: 0, checkout: 0, enq: 0, paid: 0, value: 0, abandon: 0, chat: 0, time: 0, seen: 0, seenTime: 0, wd: 0 });
  const products = prRows.map((r) => {
    const c = listed.get(r.id);
    return { ...r, name: c?.name || name(r.id), avgTime: Math.round(r.time / Math.max(1, r.views)), conv: pct(r.paid, r.views), convRange: margin(r.paid, r.views), seenTime: Math.round(r.seenTime / Math.max(1, r.seen)), tapRate: pct(r.clicks, r.seen),
      listed: Boolean(c), code: c?.code || "", category: c?.category || "", subcategory: c?.subcategory || "", price: c?.price || 0, stock: c?.stock ?? null, status: c?.status || "", image: c?.image || "", wardrobe: Boolean(c?.wardrobe), listedAt: c?.createdAt || "" };
  }).sort((a, b) => b.views - a.views || b.clicks - a.clicks || b.seen - a.seen || String(b.listedAt).localeCompare(String(a.listedAt)));
  const onSite = products.filter((p) => p.listed), cats = {};
  for (const p of onSite) { const c = cats[p.category || "Other"] ||= { key: p.category || "Other", products: 0, opened: 0, never: 0, seen: 0, views: 0, bag: 0, paid: 0, value: 0, chat: 0 }; c.products++; if (p.views) c.opened++; else c.never++; c.seen += p.seen; c.views += p.views; c.bag += p.checkout; c.paid += p.paid; c.value += p.value; c.chat += p.chat; }
  const shelf = { listed: onSite.length, opened: onSite.filter((p) => p.views).length, never: onSite.filter((p) => !p.views).length, unseen: onSite.filter((p) => !p.views && !p.seen).length, sold: onSite.filter((p) => p.paid).length, gone: products.length - onSite.length };
  const bucketKeys = [...R.buckets.keys()];
  const footfall = PAGE_KINDS.filter(([k]) => R.foot[k]).map(([key, label]) => { const f = R.foot[key], t = spread(f.times); return { key, label, views: f.views, visits: f.visits, people: f.people.size, share: pct(f.visits, n), medianTime: t.median, lands: f.lands, exits: f.exits, exitRate: pct(f.exits, f.visits), buyers: f.buyers, buyRate: pct(f.buyers, f.visits), trend: bucketKeys.map((b) => f.trend[b] || 0) }; });
  const features = FEATURE.filter(([k]) => R.feat[k]).map(([key, label]) => ({ key, label, ...R.feat[key], share: pct(R.feat[key].people, n), buyRate: pct(R.feat[key].buyers, R.feat[key].people) }));
  const searches = Object.entries(R.sq).map(([key, q]) => ({ key, ...q })).sort((a, b) => b.people - a.people || b.n - a.n).slice(0, 80);
  const C = R.chat, chats = {
    taps: C.taps, people: C.people, buyers: C.buyers, share: pct(C.people, n), places: pick(C.place).map((r) => ({ ...r, label: WA_PLACE[r.key] || r.key })), products: pick(C.prod).slice(0, 20).map((r) => ({ ...r, label: name(r.key) })),
    list: [...C.list].sort((a, b) => b.t - a.t).slice(0, 200).map((w) => ({ t: w.t, who: w.s.slice(0, 6), page: w.pr ? name(w.pr) : pageLabel(w.p), product: w.pr ? name(w.pr) : "", where: WA_PLACE[w.x] || WA_PLACE.page, text: w.m, source: w.src, device: w.dev, bought: Boolean(w.paid) })),
  };
  const wardrobe = { ...R.wdr, teaser: R.feat.teaser?.people || 0, toProduct: R.feat.wd_order?.people || 0, drawers: R.feat.wd_drawer?.people || 0, pieces: products.filter((p) => p.wd).map((p) => ({ id: p.id, label: p.name, n: p.wd })).sort((a, b) => b.n - a.n) };
  const stuck = Object.entries(R.stuck).map(([k, r]) => { const [kind, where, label] = k.split("\u0001"); return { kind, where, label: kind === "uturn" ? name(r.id || label) : label, n: r.n, visits: r.visits }; }).sort((a, b) => b.visits - a.visits || b.n - a.n).slice(0, 40);
  const zones = Object.fromEntries(Object.entries(R.zones).map(([g, o]) => {
    const rows = Object.entries(o).map(([key, z]) => { const s = spread(z.times), base = g === "home" ? R.homeVisits : Math.max(1, Object.keys(R.pg).filter((p) => p.startsWith("/p/")).reduce((c, p) => c + R.pg[p].visits, 0)); return { key, label: zoneLabel(key), people: s.n, medianTime: s.median, p25: s.p25, p75: s.p75, totalTime: z.total, readRate: pct(z.read, s.n), backRate: pct(z.back, s.n), seenDepth: median(z.deep), reversals: Math.round((z.rv / Math.max(1, s.n)) * 10) / 10, reach: pct(s.n, base), buyers: z.buyers }; });
    return [g, inOrder(rows, PART_ORDER[g])];
  }));
  const forms = Object.fromEntries(Object.entries(R.boxes).map(([form, o]) => {
    const rows = Object.values(o).map((b) => {
      const s = spread(b.times), h = spread(b.hes);
      return { key: b.key, label: FIELD_LABEL[b.key] || b.key, people: b.people, medianTime: s.median, p25: s.p25, p75: s.p75, slowest: s.slowest, hesitate: h.median, keys: Math.round(b.keys / Math.max(1, b.people)), corrected: b.corrected, empty: b.empty, pasted: b.pasted, autofilled: b.auto, refocused: b.refocus, invalid: b.bad, errors: b.errors, quit: form === "checkout" ? R.abandonField[b.key] || 0 : 0, buyers: b.buyers };
    });
    return [form, { opened: R.opened[form], boxes: inOrder(rows, FIELD_ORDER) }];
  }));
  const T = R.times, stepTimes = { deciding: median(T.dc), details: median(T.dt), paying: median(T.py), gaveUpDetails: median(T.gd), gaveUpPaying: median(T.gp), range: { deciding: spread(T.dc), details: spread(T.dt), paying: spread(T.py) } };
  const presses = Object.entries(R.pressed).map(([x, r]) => ({ label: placeLabel(x), n: r.n, people: r.people, buyRate: pct(r.buyers, r.people) })).sort((a, b) => b.n - a.n).slice(0, 80);
  const sections = inOrder(Object.entries(R.secSet).map(([key, c]) => ({ key, label: SECTION_LABEL[key] || key, n: c, share: pct(c, R.homeVisits) })), PART_ORDER.home);
  const rows = (o) => Object.values(o).map((r) => ({ ...r, conv: pct(r.paid, r.n), convRange: margin(r.paid, r.n), frictionRate: pct(r.friction, r.n), avgEngaged: Math.round(r.engaged / Math.max(1, r.n)) })).sort((a, b) => b.n - a.n);
  const sources = rows(R.bySource), devices = rows(R.byDevice);
  const v = R.vit, vit = { lcp: spread(v.lcp), inp: spread(v.inp), cls: spread(v.cls), ttfb: spread(v.ttfb) };
  const sp = spread(R.load);
  // what's in each room, ready for it to open up
  const zoneOf = (k) => (zones.home.find((z) => `z:${z.key}` === k) || (k.startsWith("f:") ? forms.checkout.boxes.find((b) => `f:${b.key}` === k) : null));
  const gridOf = (x) => { const out = []; for (const [k, c] of Object.entries(R.grids)) { const [z, xy] = k.split(":"); if (z === x) { const [a, b] = xy.split(","); out.push([Number(a), Number(b), c]); } } return out; };
  const plan = Object.entries(R.rooms).map(([key, r]) => {
    const s = spread(r.times), z = zoneOf(key), next = pick(r.next).slice(0, 4).map((e) => ({ key: e.key, label: roomLabel(e.key, name), n: e.n }));
    return { key, label: roomLabel(key, name), people: r.people, buyers: r.buyers, stuck: r.stuck, ended: r.ended, medianTime: key === "sold" || key === "left" ? 0 : z?.medianTime ?? s.median, p25: z?.p25 ?? s.p25, p75: z?.p75 ?? s.p75, next, buyRate: pct(r.buyers, r.people), buyRange: margin(r.buyers, r.people), exitRate: pct(r.ended, r.people), detail: z || null, grid: key.startsWith("z:") ? gridOf(key.slice(2)) : key.startsWith("p:") ? gridOf("photos") : [] };
  });
  const list = [...R.recent, ...recentExtra].sort((a, b) => b.a - a.a).slice(0, MAX_VISITS_SHOWN).map((r) => ({
    s: r.s.slice(0, 6), start: r.a, end: r.b, engaged: r.eng, pages: r.pc, source: r.src, device: r.f.dev, browser: r.f.br, returning: !r.f.nw, outcome: r.rch.b ? "Paid" : r.enq ? "Enquired" : r.ab ? "Left checkout" : r.rch.c ? "Opened checkout" : r.rch.p ? "Browsed products" : "Looked around", friction: r.fr, value: r.val,
    steps: r.steps.map((e) => ({ t: e.t, e: e.e, p: e.p, x: e.e === "sec" ? zoneLabel(e.x) : e.e === "field" ? FIELD_LABEL[e.x] || e.x : e.e === "tap" ? placeLabel(e.x) : e.x, key: e.e === "sec" || e.e === "field" ? e.x : undefined, r: e.r, note: e.note, f: e.f, n: ["paid", "details", "sec", "field", "abandon"].includes(e.e) ? e.n : undefined, ms: e.ms, ed: e.ed, del: e.del, fl: e.fl, fk: e.fk, product: e.pr ? name(e.pr) : undefined })),
  }));
  const feedback = [...R.feedback].sort((a, b) => b.t - a.t).slice(0, 200).map((f) => ({ t: f.t, kind: f.x, r: f.r, label: STOP_LABEL[f.r] || f.r, note: f.note, product: f.pr ? name(f.pr) : "", step: f.st2, where: pageGroup(f.p) }));
  const sum_ = {
    from: R.from, to: R.to, totals, prev: prevTotals, funnel, trend, oneDay: R.oneDay, heat: R.heat, pages, products, formTest: [["a", "Name and number"], ["b", "Number only, name on the pay screen"]].map(([key, label]) => { const a = R.formTest[key]; return { key, label, ...a, payRate: pct(a.reachedPay, a.opened), paidRate: pct(a.paid, a.opened) }; }).concat([]).map((row, i, all) => ({ ...row, proven: isReal(all[0].reachedPay, all[0].opened, all[1].reachedPay, all[1].opened) })), payStages: [...PAY_STAGE.filter(([k]) => R.payStage[k]).map(([key, label]) => ({ key, label, ...R.payStage[key] })), ...Object.entries(R.payStage).filter(([k]) => k.startsWith("app:")).map(([k, q]) => ({ key: k, label: `Chose ${k.slice(4) === "other" ? "another UPI app" : k.slice(4)}`, ...q }))], shelf, categories: Object.values(cats).sort((a, b) => b.views - a.views || b.products - a.products), footfall, features, searches, chats, wardrobe, zones, forms, stepTimes, payTabs: pick(R.payTabs), delivery: pick(R.delivery), presses, stuck, abandonAt: R.abandonAt, feedback,
    stops: pick(R.stops).map((r) => ({ ...r, label: STOP_LABEL[r.key] || r.key })), ratings: R.ratings, sections, homeVisits: R.homeVisits, scroll: R.scroll, acts: R.acts, filters: pick(R.filters).slice(0, 12), sources, devices,
    campaigns: pick(R.campaigns), referrers: pick(R.referrers).slice(0, 15), browsers: pick(R.browsers), systems: pick(R.systems), places: pick(R.places).slice(0, 15), languages: pick(R.languages).slice(0, 10), networks: pick(R.nets), screens: pick(R.widths),
    outcomes: pick(R.outcomes), speed: { n: sp.n, median: sp.median, slow: sp.p75 }, vitals: vit, speedOutcome: R.speedOutcome, visits: list, plan, edges: pick(R.edges).slice(0, 80).map((e) => { const [a, b] = e.key.split(">"); return { a, b, n: e.n }; }),
    timeline: R.timeline ? { t0: R.timeline.t0, step: R.timeline.step, slots: R.timeline.slots } : null,
  };
  const A = R.arms, HELP = { size_help: "Help with size", assure: "Original, returns and delivery facts", promise: "The Vibe X promise beside the Order button", address_help: "Help with the address box", pay_help: "Help paying", come_back: "Reminder of a piece they looked at", watching: "Others looking right now", rival: "Someone else ordering it", hold: "Last one held for them", gone: "A piece they looked at has gone", won: "It's yours" };
  sum_.guide = {
    on: { ...A.on, rate: pct(A.on.paid, A.on.n), range: margin(A.on.paid, A.on.n) }, off: { ...A.off, rate: pct(A.off.paid, A.off.n), range: margin(A.off.paid, A.off.n) }, proven: isReal(A.on.paid, A.on.n, A.off.paid, A.off.n),
    helps: Object.values(R.helps).map((h) => ({ ...h, label: HELP[h.key] || h.key, shownRate: pct(h.shownPaid, h.shown), heldRate: pct(h.heldPaid, h.held), proven: isReal(h.shownPaid, h.shown, h.heldPaid, h.held) })).sort((a, b) => b.shown - a.shown),
    bands: R.bands.map((b, i) => ({ label: ["Under 10%", "10 to 29%", "30 to 59%", "60% and over"][i], n: b.n, guessed: Math.round(b.guess / Math.max(1, b.n)), actual: pct(b.paid, b.n), range: margin(b.paid, b.n) })),
    price: { received: R.received, listed: R.listed, given: R.listed - R.received },
  };
  sum_.fixes = fixes(sum_);
  sum_.findings = findings(sum_, R.abandonField);
  return sum_;
}
function roomLabel(k, name) {
  if (k.startsWith("z:")) return zoneLabel(k.slice(2));
  if (k.startsWith("f:")) return FIELD_LABEL[k.slice(2)] || k.slice(2);
  if (k.startsWith("p:")) return name(k.slice(2));
  if (PAY_LABEL[k]) return PAY_LABEL[k];
  return { sold: "Sold", left: "Walked out", back: "Other pages", "pg:wardrobe": "The Wardrobe", "pg:bag": "Bag", "pg:account": "My account" }[k] || k;
}

// The surprise: what to fix first, by what it's likely costing. Every figure says how sure it is.
function fixes(s) {
  const out = [], t = s.totals, f = Object.fromEntries(s.funnel.map((x) => [x.key, x.n]));
  const aov = t.orders ? Math.round(t.value / t.orders) : 0;
  const add = (x) => out.push({ ...x, money: Math.round(x.money || 0) });
  const payRate = f.details ? f.paid / f.details : 0, formRate = f.checkout ? f.paid / f.checkout : 0;
  for (const b of s.forms.checkout.boxes) {
    if (b.quit < 2) continue;
    add({ room: `f:${b.key}`, title: `${b.quit} people gave up in the ${b.label} box`, why: `Typical time here is ${Math.round(b.medianTime / 1000)}s, ${b.corrected} of ${b.people} corrected it, and ${b.empty} left it empty.`, people: b.quit, money: b.quit * payRate * aov, sure: sureness(b.people) });
  }
  if (f.details - f.paid >= 2) add({ room: "pay", title: `${f.details - f.paid} people finished the form but never paid`, why: `That's ${pct(f.details - f.paid, f.details)}% of everyone who reached payment. See the reasons they gave on The leak.`, people: f.details - f.paid, money: (f.details - f.paid) * aov * 0.5, sure: sureness(f.details), assume: "assumes half would have paid" });
  if (f.product - f.bag >= 2) add({ room: "p:", title: `${f.product - f.bag} people opened a product and never added it to the bag`, why: `${pct(f.bag, f.product)}% of people who open a product add it to the bag.`, people: f.product - f.bag, money: (f.product - f.bag) * 0.1 * formRate * aov, sure: sureness(f.product), assume: "assumes 1 in 10 could be won" });
  if (f.bag - f.checkout >= 2) add({ room: "p:", title: `${f.bag - f.checkout} people added to the bag but never pressed Checkout`, why: `${pct(f.checkout, f.bag)}% of bags reach checkout.`, people: f.bag - f.checkout, money: (f.bag - f.checkout) * 0.5 * formRate * aov, sure: sureness(f.bag), assume: "assumes half could be won" });
  const so = s.speedOutcome, fast = so.fast, slow = so.slow, enoughBuyers = t.orders >= 2; // one sale can't be compared with anything
  if (enoughBuyers && slow[0] >= 5 && fast[0] >= 5 && slow[1] / slow[0] < fast[1] / fast[0]) add({ room: "", title: `${slow[0]} people waited over 4 seconds for the page`, why: `${pct(slow[1], slow[0])}% of them bought, against ${pct(fast[1], fast[0])}% of people on faster loads.`, people: slow[0], money: slow[0] * (fast[1] / fast[0] - slow[1] / slow[0]) * aov, sure: isReal(slow[1], slow[0], fast[1], fast[0]) ? sureness(slow[0]) : "weak", chance: !isReal(slow[1], slow[0], fast[1], fast[0]) });
  const rate = t.visits ? t.orders / t.visits : 0, dv = s.devices.filter((d) => d.n >= 5);
  if (dv.length > 1 && enoughBuyers) {
    const best = [...dv].sort((a, b) => b.paid / b.n - a.paid / a.n)[0], worst = [...dv].sort((a, b) => a.paid / a.n - b.paid / b.n)[0];
    if (best !== worst && best.paid / best.n > worst.paid / worst.n) add({ room: "", title: `${worst.key} visitors buy less than ${best.key.toLowerCase()} visitors`, why: `${worst.conv}% against ${best.conv}%.`, people: worst.n, money: worst.n * (best.paid / best.n - worst.paid / worst.n) * aov, sure: isReal(best.paid, best.n, worst.paid, worst.n) ? sureness(worst.n) : "weak", chance: !isReal(best.paid, best.n, worst.paid, worst.n) });
  }
  for (const r of s.stuck.filter((x) => (x.kind === "rage" || x.kind === "dead" || x.kind === "err") && x.visits >= 2).slice(0, 4)) {
    const err = r.kind === "err", where = `On the ${r.where.toLowerCase()}.`;
    add({ room: "", title: err ? `${r.visits} people hit a site error` : `${r.visits} people pressed "${r.label}" and nothing helped`, why: err ? `${where} ${r.label}` : `${where} It may look like a button, or be too slow to answer.`, people: r.visits, money: r.visits * rate * aov, sure: sureness(r.visits) });
  }
  for (const x of out) if (x.people < 5) x.sure = "weak";
  return out.sort((a, b) => Number(Boolean(a.chance)) - Number(Boolean(b.chance)) || b.money - a.money || b.people - a.people).slice(0, 12);
}

// The numbers, said in plain words. Nothing is claimed from fewer than MIN_SAMPLE people.
function findings(s, abandonField) {
  const out = [], bad = (title, detail) => out.push({ tone: "bad", title, detail }), good = (title, detail) => out.push({ tone: "good", title, detail });
  const f = Object.fromEntries(s.funnel.map((x) => [x.key, x.n]));
  const steps = [["product", "bag", "looked at a product but never added it to the bag", "Check price, photos and size info on the product pages."], ["bag", "checkout", "added to the bag but never pressed Checkout", "Show the total and delivery cost in the bag, and remind them the bag is waiting."], ["checkout", "details", "started checkout but left the details form", "Ask for fewer details, or show delivery cost sooner."], ["details", "paid", "filled in their details but the order was never confirmed", "The payment step is losing them. See their reasons below."]];
  let worst = null;
  for (const [a, b, what, fix] of steps) if (f[a] >= MIN_SAMPLE) { const lost = pct(f[a] - f[b], f[a]); if (!worst || lost > worst.lost) worst = { lost, gone: f[a] - f[b], of: f[a], what, fix }; }
  if (worst?.gone) bad(`Biggest leak: ${worst.lost}% ${worst.what}`, `${worst.gone} of ${worst.of} people. ${worst.fix}`);
  const field = Object.entries(abandonField).sort((a, b) => b[1] - a[1])[0];
  if (field?.[1] >= MIN_SAMPLE) bad(`The "${FIELD_LABEL[field[0]] || field[0]}" box is where most people give up on the form`, `${field[1]} people stopped there.`);
  const stuck = s.stuck.find((r) => (r.kind === "rage" || r.kind === "dead") && r.visits >= MIN_SAMPLE);
  if (stuck) bad(`${stuck.visits} people pressed "${stuck.label}" and nothing helped`, `On the ${stuck.where.toLowerCase()}. It may look like a button, or be too slow to answer.`);
  const err = s.stuck.find((r) => r.kind === "err" && r.visits >= MIN_SAMPLE);
  if (err) bad(`${err.visits} people hit a site error`, err.label);
  const top = s.stops[0];
  if (top && top.n >= MIN_SAMPLE && top.key !== "later") bad(`Most-given reason for leaving checkout: ${top.label}`, `${top.n} people chose this.`);
  const look = s.products.find((p) => p.views >= 10 && p.checkout === 0 && p.enq === 0);
  if (look) bad(`${look.name}: ${look.views} people looked, nobody tried to buy`, "Check the price, the photo or the description.");
  const sh = s.shelf;
  if (sh.listed >= MIN_SAMPLE && s.totals.visits >= 20 && sh.never >= 3) bad(`${sh.never} of the ${sh.listed} products on the website were never opened`, `${sh.unseen ? `${sh.unseen} of them never even came onto anyone's screen. ` : ""}They may sit too far down the rack, or the photo isn't pulling people in. See Products, Never opened.`);
  const miss = s.searches.find((q) => q.none >= 2 && q.none === q.people);
  if (miss) bad(`${miss.people} people searched "${miss.key}" and found nothing`, "If the shop has it, list it or add the word to its name.");
  if (s.speed.n >= MIN_SAMPLE && s.speed.slow > 4000) bad(`The site is slow for 1 in 4 visitors: over ${Math.round(s.speed.slow / 100) / 10} seconds to load`, "Most people here are on phones. Smaller photos would help.");
  const low = s.sections.filter((x) => x.share < 30);
  if (s.homeVisits >= MIN_SAMPLE && low.length) bad(`Few people reach "${low[low.length - 1].label}"`, `Only ${low[low.length - 1].share}% of home page visitors scroll that far.`);
  const dv = s.devices.filter((d) => d.n >= MIN_SAMPLE);
  if (dv.length > 1) {
    const hi = [...dv].sort((a, b) => b.frictionRate - a.frictionRate)[0], lo = [...dv].sort((a, b) => a.frictionRate - b.frictionRate)[0];
    if (hi.frictionRate - lo.frictionRate >= 15) bad(`${hi.key} visitors get stuck more often`, `${hi.frictionRate}% hit a problem, against ${lo.frictionRate}% on ${lo.key.toLowerCase()}.`);
  }
  const src = s.sources.filter((x) => x.paid >= MIN_SAMPLE).sort((a, b) => b.conv - a.conv)[0];
  if (src) good(`${src.key} brings the buyers`, `${src.conv}% of those visits ended in an order (${src.paid} of ${src.n}).`);
  const star = s.products.filter((p) => p.paid >= MIN_SAMPLE).sort((a, b) => b.conv - a.conv)[0];
  if (star) good(`${star.name} sells well once seen`, `${star.paid} orders from ${star.views} people.`);
  const r = s.ratings, said = r.good + r.ok + r.bad;
  if (said >= MIN_SAMPLE) (r.good / said >= 0.6 ? good : bad)(`${pct(r.good, said)}% said the experience was easy or good`, `${r.good} good, ${r.ok} okay, ${r.bad} hard, from ${said} answers.`);
  if (s.totals.visits >= 20 && s.totals.frictionRate < 10) good("Very few people are getting stuck", `Only ${s.totals.frictionRate}% of visits hit a problem.`);
  if (s.totals.visits >= MIN_SAMPLE && s.totals.bounceRate < 35) good("People stay and look around", `Only ${s.totals.bounceRate}% left straight away.`);
  return out;
}

// ---- what the guide learns ----
// Which behaviours go with buying, as a plain table of weights: nothing about any one person.
const STARTER = { ready: false, n: 0, buyers: 0, base: -3.5, w: { co: 3, dt: 1.2, long: 0.6, sizes: 0.5, back: 0.5, two: 0.4, desc: 0.3, rack: 0.2, filt: 0.2, stuck: -0.4 } };
function signalsOf(r) {
  const on = {};
  if (r.f.dev === "Phone") on.phone = 1;
  if (r.src === "Instagram") on.insta = 1;
  if (r.src === "Search") on.search = 1;
  if (!r.f.nw) on.back = 1;
  if (Object.values(r.pr).filter((p) => p.view).length >= 2) on.two = 1;
  if (Object.entries(r.dw).some(([p, ms]) => p.startsWith("/p/") && ms >= 30e3)) on.long = 1;
  if (r.z["product|sizes"]) on.sizes = 1;
  if (r.z["product|description"]) on.desc = 1;
  if ((r.z["home|rack"]?.[0] || 0) >= 20e3) on.rack = 1;
  if (r.ac.filter) on.filt = 1;
  if (r.fr - (r.ab ? 1 : 0) > 0) on.stuck = 1;
  if (r.rch.c) on.co = 1;
  if (r.rch.d) on.dt = 1;
  return on;
}
const newFit = () => ({ buy: 0, not: 0, yes: {}, no: {} });
function addFit(F, r) { const b = Boolean(r.rch.b); if (b) F.buy++; else F.not++; const o = b ? F.yes : F.no; for (const k of Object.keys(signalsOf(r))) bump(o, k); }
// Until there are enough real sales to learn from, it keeps to careful starting guesses and says so.
function readFit(F) {
  if (F.buy < 15 || F.buy + F.not < 300) return { ...STARTER, n: F.buy + F.not, buyers: F.buy };
  const w = {};
  for (const k of new Set([...Object.keys(F.yes), ...Object.keys(F.no)])) {
    const a = F.yes[k] || 0, b = F.no[k] || 0, n = a + b, ratio = Math.log(((a + 0.5) / (F.buy + 1)) / ((b + 0.5) / (F.not + 1)));
    w[k] = Math.round(ratio * (n / (n + 30)) * 100) / 100; // a rare behaviour only counts for a little
  }
  return { ready: true, n: F.buy + F.not, buyers: F.buy, base: Math.round(Math.log((F.buy + 0.5) / (F.not + 0.5)) * 100) / 100, w };
}

// A report straight from a list of events: the tests' way in, and the rule the worker follows.
function summarise(events, { name = (id) => id, catalog = [], from, to, prevTotals = null, seg = "" } = {}) {
  const by = new Map();
  for (const ev of [...events].sort((a, b) => a.t - b.t)) { let r = by.get(ev.s); if (!r) by.set(ev.s, r = newRecord(ev)); feed(r, ev); }
  const R = newReport({ from, to }), keep = segmentTest(seg);
  for (const r of by.values()) if (hasStart(r) && keep(r)) addRecord(R, r);
  return finish(R, { name, catalog, prevTotals });
}

module.exports = { PAY_LABEL, pageLabel, kindOf, WA_PLACE, APP_NOISE, STARTER, newFit, addFit, readFit, signalsOf, summarise, newRecord, feed, hasStart, newReport, addRecord, finish, newTotals, addTotals, readTotals, segmentTest, roomOf, roomLabel, zoneLabel, dayOf, sourceOf, margin, isReal, FIELD_LABEL, SECTION_LABEL, DAY_MS, MAX_VISITS_SHOWN };

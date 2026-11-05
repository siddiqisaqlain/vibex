// The owner's /analytics page: who's here now, what they do, and where they get stuck.
// lib/track.js sends events here. Each day is one append-only file in analytics/, so a bad line
// can only lose that line. No IP address or browser string is kept, only device type and browser.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readJson, writeJson } = require("./jsonstore");

const ACTIVE_MS = 40e3, FORGET_MS = 30 * 60e3, KEEP_DAYS = 400, DAY_FILE_LIMIT = 30 * 1024 * 1024;
const FLUSH_MS = 3000, IP_LIMIT = 300, MIN_SAMPLE = 5, MAX_STEPS = 60, MAX_VISITS_SHOWN = 200;
const IST = 5.5 * 3600e3;
const DAY_MS = 24 * 3600e3;
const dayOf = (t) => new Date(t + IST).toISOString().slice(0, 10);
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|headless|lighthouse|pingdom|uptime|curl|wget|python-requests/i;

const FIELDS = {
  page: ["pr", "title", "ref", "utm", "camp", "w", "lang", "tz", "nw", "st"],
  beat: ["n", "sc"], leave: ["n", "sc"], perf: ["n"], section: ["x"], pclick: ["pr", "x"], filter: ["x"], wa: ["pr"], ig: ["pr"],
  map: [], call: [], video: [], yt: [], copy: ["x"], rage: ["x"], dead: ["x"], invalid: ["x"], formerr: ["x"], err: ["x"], enq_open: ["pr"], enq: ["pr"],
  checkout: ["pr", "n"], details: ["pr", "n"], pay_tab: ["x"], paid: ["pr", "n"], abandon: ["pr", "x", "f", "n"], fb: ["x", "r", "note", "pr", "st2"],
};
const NUMS = new Set(["n", "w", "sc", "nw", "st"]);
const LIMITS = { title: 80, ref: 80, utm: 40, camp: 60, lang: 12, tz: 40, note: 300, x: 120, f: 30, r: 16, st2: 10, pr: 40 };
const FEEDBACK = { stop: new Set(["price", "shipping", "trust", "payment", "size", "later"]), done: new Set(["good", "ok", "bad"]), open: new Set(["good", "ok", "bad"]) };
const hideNumbers = (s) => s.replace(/\+?\d[\d\s-]{5,}\d/g, "•••"); // a phone or account number typed into a note

function clean(raw) {
  const f = raw && FIELDS[raw.e];
  if (!f || typeof raw.p !== "string" || !/^\/[\w\-./]{0,120}$/.test(raw.p)) return null;
  const out = { e: raw.e, p: raw.p };
  for (const k of f) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    if (NUMS.has(k)) { const n = Number(v); if (Number.isFinite(n) && n >= 0) out[k] = Math.round(Math.min(n, 1e9)); continue; }
    out[k] = String(v).slice(0, LIMITS[k]);
  }
  if (out.pr && !/^[\w-]+$/.test(out.pr)) delete out.pr;
  if (raw.e === "fb") {
    if (!FEEDBACK[out.x]?.has(out.r)) return null;
    if (out.note) out.note = hideNumbers(out.note.trim());
  }
  return out;
}
function device(ua) {
  const os = /android/i.test(ua) ? "Android" : /iphone|ipad|ipod/i.test(ua) ? "iOS" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "Other";
  const dev = /ipad|tablet/i.test(ua) ? "Tablet" : /mobi|android|iphone/i.test(ua) ? "Phone" : "Computer";
  const br = /instagram/i.test(ua) ? "Instagram app" : /fban|fbav/i.test(ua) ? "Facebook app" : /edg\//i.test(ua) ? "Edge" : /samsungbrowser/i.test(ua) ? "Samsung Internet" : /firefox|fxios/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Other";
  return { dev, os, br };
}
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
const pageGroup = (p) => (/^\/p\//.test(p) ? "Product page" : p === "/" ? "Home page" : p);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const pick = (o) => Object.entries(o).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
const STOP_LABEL = { price: "Price or offer", shipping: "Delivery cost or time", trust: "Not sure about paying online", payment: "Payment didn't work", size: "Size or details unclear", later: "Just looking" };
const SECTION_LABEL = { hero: "Top of the page", feat: "Featured", stats: "Why Vibe X", "ask-dialog": "Checkout or enquiry box", "co-dialog": "Checkout box", top: "Header", foot: "Footer", dialog: "Pop-up", range: "Shop by category", rack: "Fresh off the truck", find: "Find your fit", "looks-sec": "Just landed", how: "How it works", visit: "The store", latest: "Latest video" };
const FIELD_LABEL = { name: "Name", phone: "Phone number", address: "Address", pin: "PIN code", city: "City", email: "Email", note: "Note" };

// Group a flat list of events into visits.
// "rack: Fresh off the truck" with the page's own word for the section swapped for a readable one
const placeLabel = (x = "?") => { const [a, ...rest] = x.split(": "); const what = rest.join(": "), place = SECTION_LABEL[a]; return !what || !place ? x : what === place ? place : `${place}: ${what}`; };
function visitsOf(events) {
  const by = new Map();
  for (const ev of events) {
    let v = by.get(ev.s);
    if (!v) by.set(ev.s, v = { s: ev.s, v: ev.v, start: ev.t, end: ev.t, pages: [], steps: [], engaged: 0, friction: 0, reach: {}, value: 0, enq: 0, dwell: {}, depth: {} });
    v.start = Math.min(v.start, ev.t); v.end = Math.max(v.end, ev.t);
    if (ev.n && (ev.e === "beat" || ev.e === "leave")) { v.engaged += ev.n; v.dwell[ev.p] = (v.dwell[ev.p] || 0) + ev.n; }
    if (ev.sc !== undefined) v.depth[ev.p] = Math.max(v.depth[ev.p] || 0, ev.sc);
    if (ev.e === "page") {
      if (!v.first) { v.first = ev; v.source = sourceOf(ev); }
      v.pages.push(ev.p);
      if (ev.pr || ev.p.startsWith("/p/")) v.reach.product = true;
    }
    if (ev.e === "pclick") v.reach.product = true;
    if (ev.e === "checkout") v.reach.checkout = true;
    if (ev.e === "details") { v.reach.checkout = v.reach.details = true; }
    if (ev.e === "paid") { v.reach.checkout = v.reach.details = v.reach.paid = true; v.value += ev.n || 0; }
    if (ev.e === "enq") v.enq++;
    if (["rage", "dead", "invalid", "formerr", "err"].includes(ev.e)) v.friction++;
    if (ev.e === "abandon") { v.friction++; v.abandoned = ev.x; }
    if (!["beat", "leave", "perf"].includes(ev.e) && v.steps.length < MAX_STEPS) v.steps.push(ev);
  }
  return [...by.values()].filter((v) => v.first); // heartbeats from before a day's first page don't make a visit
}

function totalsOf(visits) {
  const pages = visits.reduce((n, v) => n + v.pages.length, 0);
  const paid = visits.filter((v) => v.reach.paid);
  const bounced = visits.filter((v) => v.pages.length === 1 && v.engaged < 10e3 && !v.reach.checkout).length;
  return {
    visitors: new Set(visits.map((v) => v.v)).size, visits: visits.length, pages,
    newVisitors: new Set(visits.filter((v) => v.first.nw).map((v) => v.v)).size,
    medianEngaged: median(visits.map((v) => v.engaged)), pagesPerVisit: visits.length ? Math.round((pages / visits.length) * 10) / 10 : 0,
    bounceRate: pct(bounced, visits.length), orders: paid.length, value: paid.reduce((n, v) => n + v.value, 0),
    conversion: pct(paid.length, visits.length), enquiries: visits.reduce((n, v) => n + v.enq, 0),
    frictionRate: pct(visits.filter((v) => v.friction > 0).length, visits.length),
  };
}

// Everything the page shows for a date range.
function summarise(events, { name = (id) => id, from, to, prevTotals = null } = {}) {
  const visits = visitsOf(events), totals = totalsOf(visits);
  const n = visits.length;
  const count = (fn) => { const o = {}; for (const v of visits) { const k = fn(v); if (k) o[k] = (o[k] || 0) + 1; } return pick(o); };

  const funnel = [
    { key: "visit", label: "Came to the site", n },
    { key: "product", label: "Looked at a product", n: visits.filter((v) => v.reach.product).length },
    { key: "checkout", label: "Pressed Order now", n: visits.filter((v) => v.reach.checkout).length },
    { key: "details", label: "Filled in their details", n: visits.filter((v) => v.reach.details).length },
    { key: "paid", label: "Pressed I've paid", n: visits.filter((v) => v.reach.paid).length },
  ];

  // trend: hours for one day, days otherwise
  const oneDay = from === to, buckets = new Map();
  if (oneDay) for (let h = 0; h < 24; h++) buckets.set(String(h).padStart(2, "0"), { key: String(h).padStart(2, "0"), visitors: new Set(), pages: 0, orders: 0 });
  else for (let d = Date.parse(from); d <= Date.parse(to); d += DAY_MS) { const k = new Date(d).toISOString().slice(0, 10); buckets.set(k, { key: k, visitors: new Set(), pages: 0, orders: 0 }); }
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const ev of events) {
    if (ev.e !== "page" && ev.e !== "paid") continue;
    const local = new Date(ev.t + IST);
    const b = buckets.get(oneDay ? local.toISOString().slice(11, 13) : local.toISOString().slice(0, 10));
    if (ev.e === "paid") { if (b) b.orders++; continue; }
    if (b) { b.visitors.add(ev.v); b.pages++; }
    heat[local.getUTCDay()][local.getUTCHours()]++;
  }
  const trend = [...buckets.values()].map((b) => ({ ...b, visitors: b.visitors.size }));

  // pages
  const pg = {};
  for (const v of visits) {
    v.pages.forEach((p, i) => {
      const r = pg[p] ||= { path: p, views: 0, visits: new Set(), time: 0, exits: 0, lands: 0, title: "" };
      r.views++; r.visits.add(v.s); if (i === 0) r.lands++;
    });
    for (const [p, ms] of Object.entries(v.dwell)) if (pg[p]) pg[p].time += ms;
    const last = v.pages[v.pages.length - 1]; if (pg[last]) pg[last].exits++;
  }
  const pages = Object.values(pg).map((r) => {
    const id = (/^\/p\/(.+)$/.exec(r.path) || [])[1];
    return { path: r.path, label: id ? name(id) : r.path === "/" ? "Home page" : r.path, views: r.views, visits: r.visits.size, avgTime: Math.round(r.time / Math.max(1, r.visits.size)), lands: r.lands, exits: r.exits, exitRate: pct(r.exits, r.visits.size) };
  }).sort((a, b) => b.views - a.views);

  // products
  const pr = {};
  const prow = (id) => (pr[id] ||= { id, name: name(id), views: new Set(), clicks: 0, checkout: new Set(), enq: new Set(), paid: 0, value: 0, abandon: 0, chat: 0, time: 0 });
  for (const ev of events) {
    if (!ev.pr) continue;
    if (ev.e === "page") prow(ev.pr).views.add(ev.s);
    else if (ev.e === "pclick") prow(ev.pr).clicks++;
    else if (ev.e === "checkout") prow(ev.pr).checkout.add(ev.s);
    else if (ev.e === "enq") prow(ev.pr).enq.add(ev.s);
    else if (ev.e === "paid") { prow(ev.pr).paid++; prow(ev.pr).value += ev.n || 0; }
    else if (ev.e === "abandon") prow(ev.pr).abandon++;
    else if (ev.e === "wa" || ev.e === "ig") prow(ev.pr).chat++;
  }
  for (const v of visits) for (const [p, ms] of Object.entries(v.dwell)) { const id = (/^\/p\/(.+)$/.exec(p) || [])[1]; if (id && pr[id]) pr[id].time += ms; }
  const products = Object.values(pr).map((r) => ({ ...r, views: r.views.size, checkout: r.checkout.size, enq: r.enq.size, avgTime: Math.round(r.time / Math.max(1, r.views.size)), conv: pct(r.paid, r.views.size) }))
    .sort((a, b) => b.views - a.views || b.clicks - a.clicks);

  // what stopped people
  const stuck = {};
  const hit = (kind, label, where, s) => { const k = `${kind}|${where}|${label}`; const r = stuck[k] ||= { kind, label, where, n: 0, visits: new Set() }; r.n++; r.visits.add(s); };
  const abandonAt = { details: 0, pay: 0 }, abandonField = {};
  for (const ev of events) {
    const where = pageGroup(ev.p);
    if (ev.e === "rage") hit("rage", placeLabel(ev.x), where, ev.s);
    else if (ev.e === "dead") hit("dead", placeLabel(ev.x), where, ev.s);
    else if (ev.e === "invalid") hit("invalid", FIELD_LABEL[ev.x] || ev.x || "?", where, ev.s);
    else if (ev.e === "formerr") hit("formerr", ev.x || "?", where, ev.s);
    else if (ev.e === "err") hit("err", ev.x || "?", where, ev.s);
    else if (ev.e === "abandon") {
      if (ev.x in abandonAt) abandonAt[ev.x]++;
      hit("abandon", ev.x === "pay" ? "Left on the payment step" : `Left the details form${ev.f ? ` at: ${FIELD_LABEL[ev.f] || ev.f}` : " before typing"}`, "Checkout", ev.s);
      if (ev.f) abandonField[ev.f] = (abandonField[ev.f] || 0) + 1;
    }
  }
  // Opened a product and turned straight back: the page didn't give them what they came for.
  for (const v of visits) v.pages.forEach((p, i) => {
    if (p.startsWith("/p/") && i < v.pages.length - 1 && (v.dwell[p] || 0) < 5e3) hit("uturn", name(p.slice(3)), "Product page", v.s);
  });
  const stuckList = Object.values(stuck).map((r) => ({ ...r, visits: r.visits.size })).sort((a, b) => b.visits - a.visits || b.n - a.n).slice(0, 40);

  // what they told us
  const feedback = [], stops = {}, ratings = { good: 0, ok: 0, bad: 0 };
  for (const ev of events) {
    if (ev.e !== "fb") continue;
    if (ev.x === "stop") stops[ev.r] = (stops[ev.r] || 0) + 1; else if (ev.r in ratings) ratings[ev.r]++;
    feedback.push({ t: ev.t, kind: ev.x, r: ev.r, label: STOP_LABEL[ev.r] || ev.r, note: ev.note || "", product: ev.pr ? name(ev.pr) : "", step: ev.st2 || "", where: pageGroup(ev.p) });
  }
  feedback.sort((a, b) => b.t - a.t);

  // sections and scrolling
  const homeVisits = visits.filter((v) => v.pages.includes("/")).length;
  const secSet = {};
  for (const ev of events) if (ev.e === "section" && ev.p === "/") (secSet[ev.x] ||= new Set()).add(ev.s);
  const sections = Object.entries(secSet).map(([key, s]) => ({ key, label: SECTION_LABEL[key] || key, n: s.size, share: pct(s.size, homeVisits) })).sort((a, b) => b.n - a.n);
  const scroll = { "Home page": [0, 0, 0, 0], "Product page": [0, 0, 0, 0] };
  for (const v of visits) for (const [p, d] of Object.entries(v.depth)) {
    const g = scroll[pageGroup(p)]; if (!g) continue;
    [25, 50, 75, 100].forEach((m, i) => { if (d >= (m === 100 ? 95 : m)) g[i]++; });
  }

  const acts = {};
  for (const ev of events) if (["wa", "ig", "map", "call", "video", "yt", "filter", "copy", "enq_open", "enq"].includes(ev.e)) acts[ev.e] = (acts[ev.e] || 0) + 1;
  const filters = {};
  for (const ev of events) if (ev.e === "filter" && ev.x) filters[ev.x] = (filters[ev.x] || 0) + 1;
  const load = events.filter((e) => e.e === "perf" && e.n).map((e) => e.n).sort((a, b) => a - b);

  // who converts: visits and orders for each group, so a big group isn't mistaken for a good one
  const bySource = {}, byDevice = {};
  for (const v of visits) {
    const s = bySource[v.source] ||= { key: v.source, n: 0, paid: 0, friction: 0, engaged: 0 };
    s.n++; s.paid += v.reach.paid ? 1 : 0; s.friction += v.friction ? 1 : 0; s.engaged += v.engaged;
    const d = byDevice[v.first.dev] ||= { key: v.first.dev, n: 0, paid: 0, friction: 0, engaged: 0 };
    d.n++; d.paid += v.reach.paid ? 1 : 0; d.friction += v.friction ? 1 : 0; d.engaged += v.engaged;
  }
  const rows = (o) => Object.values(o).map((r) => ({ ...r, conv: pct(r.paid, r.n), frictionRate: pct(r.friction, r.n), avgEngaged: Math.round(r.engaged / Math.max(1, r.n)) })).sort((a, b) => b.n - a.n);
  const sources = rows(bySource), devices = rows(byDevice);

  const list = [...visits].sort((a, b) => b.start - a.start).slice(0, MAX_VISITS_SHOWN).map((v) => ({
    s: v.s.slice(0, 6), start: v.start, end: v.end, engaged: v.engaged, pages: v.pages.length, source: v.source, device: v.first.dev, browser: v.first.br, returning: !v.first.nw,
    outcome: v.reach.paid ? "Paid" : v.enq ? "Enquired" : v.abandoned ? "Left checkout" : v.reach.checkout ? "Opened checkout" : v.reach.product ? "Browsed products" : "Looked around",
    friction: v.friction, value: v.value,
    steps: v.steps.map((e) => ({ t: e.t, e: e.e, p: e.p, x: e.x, r: e.r, note: e.note, f: e.f, n: e.e === "paid" || e.e === "details" ? e.n : undefined, product: e.pr ? name(e.pr) : undefined })),
  }));

  const sum = {
    from, to, totals, prev: prevTotals, funnel, trend, oneDay, heat, pages, products, stuck: stuckList, abandonAt, feedback: feedback.slice(0, 200), stops: pick(stops).map((r) => ({ ...r, label: STOP_LABEL[r.key] || r.key })), ratings,
    sections, homeVisits, scroll, acts, filters: pick(filters).slice(0, 12), sources, devices,
    campaigns: count((v) => v.first.camp), referrers: count((v) => v.first.ref).slice(0, 15), browsers: count((v) => v.first.br), systems: count((v) => v.first.os), places: count((v) => v.first.tz).slice(0, 15), languages: count((v) => (v.first.lang || "").slice(0, 2).toLowerCase()).slice(0, 10),
    outcomes: count((v) => (v.reach.paid ? "Paid" : v.enq ? "Enquired" : v.abandoned ? "Left checkout" : v.reach.product ? "Browsed products" : "Looked around")),
    speed: { n: load.length, median: median(load), slow: load.length ? load[Math.floor(load.length * 0.75)] : 0 }, visits: list,
  };
  sum.findings = findings(sum, FIELD_LABEL, abandonField);
  return sum;
}

// The numbers, said in plain words. Nothing is claimed from fewer than MIN_SAMPLE people.
function findings(s, fields, abandonField) {
  const out = [], bad = (title, detail) => out.push({ tone: "bad", title, detail }), good = (title, detail) => out.push({ tone: "good", title, detail });
  const f = Object.fromEntries(s.funnel.map((x) => [x.key, x.n]));
  const steps = [["product", "checkout", "looked at a product but never pressed Order now", "Check price, photos and size info on the product pages."], ["checkout", "details", "started checkout but left the details form", "Ask for fewer details, or show delivery cost sooner."], ["details", "paid", "filled in their details but never pressed I've paid", "The payment step is losing them. See their reasons below."]];
  let worst = null;
  for (const [a, b, what, fix] of steps) if (f[a] >= MIN_SAMPLE) { const lost = pct(f[a] - f[b], f[a]); if (!worst || lost > worst.lost) worst = { lost, gone: f[a] - f[b], of: f[a], what, fix }; }
  if (worst?.gone) bad(`Biggest leak: ${worst.lost}% ${worst.what}`, `${worst.gone} of ${worst.of} people. ${worst.fix}`);
  const field = Object.entries(abandonField).sort((a, b) => b[1] - a[1])[0];
  if (field?.[1] >= MIN_SAMPLE) bad(`The "${fields[field[0]] || field[0]}" box is where most people give up on the form`, `${field[1]} people stopped there.`);
  const stuck = s.stuck.find((r) => (r.kind === "rage" || r.kind === "dead") && r.visits >= MIN_SAMPLE);
  if (stuck) bad(`${stuck.visits} people pressed "${stuck.label}" and nothing helped`, `On the ${stuck.where.toLowerCase()}. It may look like a button, or be too slow to answer.`);
  const err = s.stuck.find((r) => r.kind === "err" && r.visits >= MIN_SAMPLE);
  if (err) bad(`${err.visits} people hit a site error`, err.label);
  const top = s.stops[0];
  if (top && top.n >= MIN_SAMPLE && top.key !== "later") bad(`Most-given reason for leaving checkout: ${top.label}`, `${top.n} people chose this.`);
  const look = s.products.find((p) => p.views >= 10 && p.checkout === 0 && p.enq === 0);
  if (look) bad(`${look.name}: ${look.views} people looked, nobody tried to buy`, "Check the price, the photo or the description.");
  if (s.speed.n >= MIN_SAMPLE && s.speed.slow > 4000) bad(`The site is slow for 1 in 4 visitors: over ${Math.round(s.speed.slow / 100) / 10} seconds to load`, "Most people here are on phones. Smaller photos would help.");
  const low = s.sections.filter((x) => x.share < 30);
  if (s.homeVisits >= MIN_SAMPLE && low.length) bad(`Few people reach "${low[low.length - 1].label}"`, `Only ${low[low.length - 1].share}% of home page visitors scroll that far.`);
  const dv = s.devices.filter((d) => d.n >= MIN_SAMPLE);
  if (dv.length > 1) {
    const hi = [...dv].sort((a, b) => b.frictionRate - a.frictionRate)[0], lo = [...dv].sort((a, b) => a.frictionRate - b.frictionRate)[0];
    if (hi.frictionRate - lo.frictionRate >= 15) bad(`${hi.key} visitors get stuck more often`, `${hi.frictionRate}% hit a problem, against ${lo.frictionRate}% on ${lo.key.toLowerCase()}.`);
  }
  const src = s.sources.filter((x) => x.n >= MIN_SAMPLE && x.paid > 0).sort((a, b) => b.conv - a.conv)[0];
  if (src) good(`${src.key} brings the buyers`, `${src.conv}% of those visits ended in an order (${src.paid} of ${src.n}).`);
  const star = s.products.filter((p) => p.views >= MIN_SAMPLE && p.paid > 0).sort((a, b) => b.conv - a.conv)[0];
  if (star) good(`${star.name} sells well once seen`, `${star.paid} orders from ${star.views} people.`);
  const r = s.ratings, said = r.good + r.ok + r.bad;
  if (said >= MIN_SAMPLE) (r.good / said >= 0.6 ? good : bad)(`${pct(r.good, said)}% said the experience was easy or good`, `${r.good} good, ${r.ok} okay, ${r.bad} hard, from ${said} answers.`);
  if (s.totals.visits >= 20 && s.totals.frictionRate < 10) good("Very few people are getting stuck", `Only ${s.totals.frictionRate}% of visits hit a problem.`);
  if (s.totals.visits >= MIN_SAMPLE && s.totals.bounceRate < 35) good("People stay and look around", `Only ${s.totals.bounceRate}% left straight away.`);
  return out;
}

module.exports = function createAnalytics({ STORE, productName = (id) => id, now = Date.now }) {
  const DIR = path.join(STORE, "analytics");
  const CHANGES = path.join(DIR, "changes.json");
  fs.mkdirSync(DIR, { recursive: true });
  const live = new Map(), recent = [];
  const perIp = new Map();
  let buffer = [];

  const fileOf = (day) => path.join(DIR, `${day}.jsonl`);
  function flushSync() {
    if (!buffer.length) return;
    const rows = buffer; buffer = [];
    const byDay = {};
    for (const ev of rows) (byDay[dayOf(ev.t)] ||= []).push(JSON.stringify(ev));
    for (const [day, lines] of Object.entries(byDay)) {
      try { if (fs.statSync(fileOf(day)).size > DAY_FILE_LIMIT) continue; } catch { /* first of the day */ }
      fs.appendFileSync(fileOf(day), `${lines.join("\n")}\n`);
    }
  }
  function sweep() {
    const cut = now() - FORGET_MS;
    for (const [k, v] of live) if (v.last < cut) live.delete(k);
    perIp.clear();
  }
  function prune() {
    const oldest = dayOf(now() - KEEP_DAYS * DAY_MS);
    for (const f of fs.readdirSync(DIR)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < oldest) fs.rmSync(path.join(DIR, f), { force: true });
  }
  const timers = [setInterval(flushSync, FLUSH_MS), setInterval(sweep, 60e3), setInterval(prune, DAY_MS)];
  timers.forEach((t) => t.unref());
  prune();

  // One batch from one browser. Anything not on the list above is dropped, not stored.
  function ingest(body, { ua = "", ip = "?" } = {}) {
    if (BOT.test(ua) || !ua) return 0;
    const seen = (perIp.get(ip) || 0) + 1;
    perIp.set(ip, seen);
    if (seen > IP_LIMIT) return 0;
    const ok = /^[a-f0-9]{16}$/;
    if (!body || !ok.test(body.v) || !ok.test(body.s) || !Array.isArray(body.ev)) return 0;
    let kept = 0;
    const t = now();
    for (const raw of body.ev.slice(0, 40)) {
      const c = clean(raw);
      if (!c) continue;
      const ev = { t, v: body.v, s: body.s, ...c };
      if (c.e === "page") Object.assign(ev, device(ua));
      buffer.push(ev);
      kept++;
      note(ev);
    }
    return kept;
  }
  function note(ev) {
    let r = live.get(ev.s);
    if (!r) { if (live.size > 5000) return; live.set(ev.s, r = { s: ev.s, v: ev.v, start: ev.t, last: ev.t, p: ev.p, pages: 0, friction: 0, gone: false }); }
    r.last = ev.t; r.gone = ev.e === "leave";
    if (ev.e === "leave") return;
    if (ev.e === "page") { r.p = ev.p; r.pr = ev.pr; r.title = ev.title; r.pages++; if (!r.source) { r.nw = ev.nw; r.source = sourceOf(ev); r.dev = ev.dev; r.br = ev.br; } r.step = ""; }
    if (ev.e === "checkout") r.step = "At checkout: details";
    if (ev.e === "details") r.step = "At checkout: paying";
    if (ev.e === "paid") r.step = "Paid";
    if (ev.e === "abandon") r.step = "Left checkout";
    if (["rage", "dead", "invalid", "formerr", "err", "abandon"].includes(ev.e)) r.friction++;
    if (ev.sc !== undefined) r.sc = Math.max(r.sc || 0, ev.sc);
    if (!["beat", "perf", "section"].includes(ev.e)) { recent.push(ev); if (recent.length > 60) recent.shift(); }
  }
  function liveNow() {
    const t = now();
    const people = [...live.values()].filter((r) => t - r.last < ACTIVE_MS && !r.gone).sort((a, b) => a.start - b.start);
    const places = {};
    for (const r of people) { const k = r.p; (places[k] ||= { path: k, label: r.pr ? productName(r.pr) : r.p === "/" ? "Home page" : r.title || r.p, n: 0 }).n++; }
    return {
      at: t, active: people.length,
      places: Object.values(places).sort((a, b) => b.n - a.n),
      people: people.slice(0, 50).map((r) => ({ id: r.s.slice(0, 6), label: r.pr ? productName(r.pr) : r.p === "/" ? "Home page" : r.title || r.p, path: r.p, source: r.source, device: r.dev, browser: r.br, since: t - r.start, pages: r.pages, step: r.step, friction: r.friction, returning: r.nw === 0, scroll: r.sc || 0 })),
      feed: recent.slice(-30).reverse().map((e) => ({ t: e.t, e: e.e, who: e.s.slice(0, 6), p: e.p, x: e.x, r: e.r, note: e.note, product: e.pr ? productName(e.pr) : undefined })),
    };
  }
  async function eventsBetween(from, to) {
    flushSync();
    const out = [];
    for (let d = Date.parse(from); d <= Date.parse(to); d += DAY_MS) {
      const day = new Date(d).toISOString().slice(0, 10);
      let text;
      try { text = await fs.promises.readFile(fileOf(day), "utf8"); } catch { continue; }
      for (const line of text.split("\n")) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* one bad line, skip it */ } }
    }
    return out;
  }
  const dayShift = (day, n) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);
  async function report(from, to) {
    const events = await eventsBetween(from, to);
    const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
    const before = visitsOf(await eventsBetween(dayShift(from, -span), dayShift(from, -1)));
    return summarise(events, { name: productName, from, to, prevTotals: before.length ? totalsOf(before) : null });
  }

  // The loop's last step: what the owner changed, and what happened to the numbers after.
  const changes = () => readJson(CHANGES, []);
  function addChange(b) {
    const note = String(b?.note || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(b?.day || "") ? b.day : dayOf(now());
    if (!note) return { error: "Say what you changed." };
    const row = { id: crypto.randomBytes(8).toString("hex"), day, note, at: new Date(now()).toISOString() };
    writeJson(CHANGES, [...changes(), row]);
    return { change: row };
  }
  function removeChange(id) {
    const list = changes();
    if (!list.some((c) => c.id === id)) return { error: "Not found." };
    writeJson(CHANGES, list.filter((c) => c.id !== id));
    return { ok: true };
  }
  // The 7 days before against the days since (up to 7), so it's fair the week after a change.
  async function changeResults() {
    const today = dayOf(now());
    const out = [];
    for (const c of changes().sort((a, b) => b.day.localeCompare(a.day)).slice(0, 12)) {
      const end = dayShift(c.day, 7) < today ? dayShift(c.day, 7) : today;
      const after = c.day < today ? totalsOf(visitsOf(await eventsBetween(dayShift(c.day, 1), end))) : null;
      out.push({ ...c, before: totalsOf(visitsOf(await eventsBetween(dayShift(c.day, -7), dayShift(c.day, -1)))), after, days: after ? Math.round((Date.parse(end) - Date.parse(c.day)) / DAY_MS) : 0 });
    }
    return out;
  }
  const close = () => { timers.forEach(clearInterval); flushSync(); };
  return { ingest, liveNow, report, addChange, removeChange, changeResults, flushSync, close };
};
module.exports.summarise = summarise;
module.exports.clean = clean;
module.exports.dayOf = dayOf;

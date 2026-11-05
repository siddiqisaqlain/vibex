// The owner's /analytics page: who's here now, what they do, and where they get stuck.
// lib/track.js sends events here. This file only takes them in and answers "who's here now"; the sums run on
// their own thread (lib/analytics-worker.js) so the shop never waits for a report. No IP address or browser
// string is kept, only device type and browser.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const { readJson, writeJson } = require("./jsonstore");
const { summarise, roomOf, roomLabel, zoneLabel, dayOf, sourceOf, isReal, FIELD_LABEL } = require("./rollup");

const ACTIVE_MS = 40e3, FORGET_MS = 30 * 60e3, DAY_MS = 24 * 3600e3, FLUSH_MS = 3000;
const KEEP_DAYS = 400, RAW_DAYS = 14, DAY_FILE_LIMIT = 300 * 1024 * 1024;
const BUDGET_MB = Number(process.env.ANALYTICS_BUDGET_MB || 400); // the disk is shared with orders and photos
// Many customers can share one mobile network address here, so the guard is per visit, with a high ceiling per address.
const VISIT_LIMIT = 400, IP_LIMIT = Number(process.env.ANALYTICS_IP_LIMIT || 20000), LIVE_MAX = 40000, LIVE_PEOPLE = 60, EDGE_MS = 60e3;
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|headless|lighthouse|pingdom|uptime|curl|wget|python-requests/i;

const FIELDS = {
  page: ["pr", "title", "ref", "utm", "camp", "w", "h", "lang", "tz", "nw", "st", "net"],
  beat: ["n", "sc"], leave: ["n", "sc"], perf: ["n"], section: ["x"], pclick: ["pr", "x"], filter: ["x"], wa: ["pr"], ig: ["pr"],
  map: [], call: [], video: [], yt: [], copy: ["x"], rage: ["x"], dead: ["x"], invalid: ["x"], formerr: ["x"], err: ["x"], enq_open: ["pr"], enq: ["pr"],
  checkout: ["pr", "n", "ms"], details: ["pr", "n", "ms"], pay_tab: ["x"], paid: ["pr", "n", "ms"], abandon: ["pr", "x", "f", "n"], fb: ["x", "r", "note", "pr", "st2"],
  in: ["x"], fin: ["x"], sec: ["x", "n", "pk", "rv"], field: ["x", "n", "ed", "del", "fl", "fk", "pa", "au", "bad", "st2"], card: ["pr", "n"], tap: ["x", "z", "sx", "sy"], choice: ["x", "r"],
  vit: ["lcp", "inp", "cls", "ttfb"],
};
const NUMS = new Set(["n", "w", "h", "sc", "nw", "st", "ms", "ed", "del", "fl", "fk", "pa", "au", "bad", "pk", "rv", "sx", "sy", "lcp", "inp", "cls", "ttfb"]);
const LIVE_ONLY = new Set(["in", "fin"]); // where someone is this second; the finished stay is what gets kept
const NAME_ONLY = new Set(["in", "fin", "sec", "field"]); // x is a section or box name here, never free text
const LIMITS = { title: 80, ref: 80, utm: 40, camp: 60, lang: 12, tz: 40, note: 300, x: 120, f: 30, r: 16, st2: 10, pr: 40, z: 30, net: 8 };
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
  if (NAME_ONLY.has(raw.e) && !/^[a-zA-Z][\w-]{0,29}$/.test(out.x || "")) return null;
  if (out.z && !/^[a-zA-Z][\w-]{0,29}$/.test(out.z)) delete out.z;
  if (raw.e === "choice" && !(out.x === "delivery" && ["pickup", "ship"].includes(out.r))) return null;
  if (raw.e === "tap") out.x = hideNumbers(out.x || "");
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
const stepWord = { details: "At checkout: details", pay: "At checkout: paying", paid: "Paid", left: "Left checkout" };

module.exports = function createAnalytics({ STORE, productName = (id) => id, productNames = () => ({}), now = Date.now, budgetMb = BUDGET_MB }) {
  const DIR = path.join(STORE, "analytics");
  const CHANGES = path.join(DIR, "changes.json");
  fs.mkdirSync(DIR, { recursive: true });
  const live = new Map(), recent = [], perIp = new Map(), perVisit = new Map(), moves = [];
  let buffer = [], writing = false;
  const stats = { taken: 0, droppedBot: 0, droppedLimit: 0, droppedBad: 0 };

  const fileOf = (day) => path.join(DIR, `${day}.jsonl`);
  const group = (rows) => { const byDay = {}; for (const ev of rows) (byDay[dayOf(ev.t)] ||= []).push(JSON.stringify(ev)); return byDay; };
  const tooBig = (day) => { try { return fs.statSync(fileOf(day)).size > DAY_FILE_LIMIT; } catch { return false; } };
  function flushSync() {
    if (!buffer.length) return;
    const rows = buffer; buffer = [];
    for (const [day, lines] of Object.entries(group(rows))) if (!tooBig(day)) fs.appendFileSync(fileOf(day), `${lines.join("\n")}\n`);
  }
  // Written without blocking, so a busy minute of visitors can't hold up a customer's page.
  async function flush() {
    if (writing || !buffer.length) return;
    writing = true;
    const rows = buffer; buffer = [];
    try { for (const [day, lines] of Object.entries(group(rows))) if (!tooBig(day)) await fs.promises.appendFile(fileOf(day), `${lines.join("\n")}\n`); }
    catch (e) { console.error("analytics write failed:", e.message); }
    writing = false;
  }
  function sweep() {
    const cut = now() - FORGET_MS;
    for (const [k, v] of live) if (v.last < cut) live.delete(k);
    perIp.clear(); perVisit.clear();
  }

  // ---- the thread that does the sums ----
  let worker = null, nextId = 1;
  const waiting = new Map();
  function thread() {
    if (worker) return worker;
    worker = new Worker(path.join(__dirname, "analytics-worker.js"), { workerData: { DIR, RAW_DAYS, KEEP_DAYS, BUDGET: budgetMb * 1024 * 1024 }, resourceLimits: { maxOldGenerationSizeMb: 300 } });
    worker.unref();
    worker.on("message", ({ id, ok, error }) => { const w = waiting.get(id); if (!w) return; waiting.delete(id); if (error) w.reject(new Error(error)); else w.resolve(ok); });
    // If a huge report runs it out of room, only the report fails: the shop carries on.
    const gone = (e) => { worker = null; for (const w of waiting.values()) w.reject(e instanceof Error ? e : new Error("Report stopped. Try fewer days.")); waiting.clear(); };
    worker.on("error", gone); worker.on("exit", gone);
    return worker;
  }
  const ask = (job, args) => new Promise((resolve, reject) => { const id = nextId++; waiting.set(id, { resolve, reject }); thread().postMessage({ id, job, args }); });
  const cache = new Map(); // the same report asked for twice in a row
  async function report(from, to, seg = "") {
    const key = `${from}|${to}|${seg}`, hit = cache.get(key);
    if (hit && (hit.taken === stats.taken || (now() - hit.at < 8000 && stats.taken - hit.taken > 5000))) return hit.val; // small numbers are always current
    flushSync();
    const taken = stats.taken, val = await ask("report", { from, to, seg, today: dayOf(now()), names: productNames() });
    cache.clear(); cache.set(key, { at: now(), taken, val });
    return val;
  }
  const prune = () => ask("prune", { today: dayOf(now()) }).catch((e) => console.error("analytics prune failed:", e.message));
  const timers = [setInterval(flush, FLUSH_MS), setInterval(sweep, 60e3), setInterval(prune, 6 * 3600e3)];
  timers.forEach((t) => t.unref());
  const firstPrune = setTimeout(prune, 30e3); firstPrune.unref();

  // One batch from one browser. Anything not on the list above is dropped, not stored.
  function ingest(body, { ua = "", ip = "?" } = {}) {
    if (BOT.test(ua) || !ua) { stats.droppedBot++; return 0; }
    const ok = /^[a-f0-9]{16}$/;
    if (!body || !ok.test(body.v) || !ok.test(body.s) || !Array.isArray(body.ev)) { stats.droppedBad++; return 0; }
    const batch = body.ev.slice(0, 40), byIp = (perIp.get(ip) || 0) + batch.length, byVisit = (perVisit.get(body.s) || 0) + batch.length;
    perIp.set(ip, byIp); perVisit.set(body.s, byVisit);
    if (byIp > IP_LIMIT || byVisit > VISIT_LIMIT) { stats.droppedLimit += batch.length; return 0; }
    let kept = 0;
    const t = now();
    for (const raw of batch) {
      const c = clean(raw);
      if (!c) { stats.droppedBad++; continue; }
      // When it happened in their browser, not when the batch arrived: the browser says how long ago.
      const ago = Number(raw.d);
      const ev = { t: Number.isFinite(ago) && ago > 0 && ago < 5 * 60e3 ? t - Math.round(ago) : t, v: body.v, s: body.s, ...c };
      if (c.e === "page") Object.assign(ev, device(ua));
      if (!LIVE_ONLY.has(c.e)) buffer.push(ev);
      kept++;
      note(ev);
    }
    stats.taken += kept;
    return kept;
  }
  function note(ev) {
    let r = live.get(ev.s);
    if (!r) { if (live.size > LIVE_MAX) return; live.set(ev.s, r = { s: ev.s, v: ev.v, start: ev.t, last: ev.t, p: ev.p, pages: 0, friction: 0, gone: false, step: "", zone: "", box: "", room: "" }); }
    r.last = Math.max(r.last, ev.t); r.gone = ev.e === "leave";
    if (ev.e === "leave") return;
    const before = r.room;
    if (ev.e === "page") { r.p = ev.p; r.pr = ev.pr; r.title = ev.title; r.pages++; if (!r.source) { r.nw = ev.nw; r.source = sourceOf(ev); r.dev = ev.dev; r.br = ev.br; } r.step = ""; r.zone = ""; r.box = ""; }
    if (ev.e === "in") { r.zone = ev.x; r.zoneAt = ev.t; }
    if (ev.e === "fin") { r.box = ev.x; r.boxAt = ev.t; }
    if (ev.e === "field") r.box = "";
    if (ev.e === "checkout") r.step = "details";
    if (ev.e === "details") r.step = "pay";
    if (ev.e === "paid") r.step = "paid";
    if (ev.e === "abandon") r.step = "left";
    if (["rage", "dead", "invalid", "formerr", "err", "abandon"].includes(ev.e)) r.friction++;
    if (ev.sc !== undefined) r.sc = Math.max(r.sc || 0, ev.sc);
    const was = before; r.room = roomOf(r.p, r.step, r.zone, r.box);
    if (["rage", "dead", "invalid", "formerr", "err", "abandon"].includes(ev.e)) r.hurtIn = r.room;
    if (was && was !== r.room) { moves.push([ev.t, was, r.room]); if (moves.length > 20000) moves.splice(0, 10000); }
    if (!["beat", "perf", "section", "in", "fin", "sec", "field", "card", "tap", "vit"].includes(ev.e)) { recent.push(ev); if (recent.length > 60) recent.shift(); }
  }
  // Everyone in the shop by room, however many there are, plus the people behind a sample of it.
  function liveNow(seg = "") {
    const t = now(), m = /^(dev|src|new):(.+)$/.exec(seg || "");
    const fits = !m ? () => true : m[1] === "dev" ? (r) => r.dev === m[2] : m[1] === "src" ? (r) => r.source === m[2] : (r) => (r.nw === 1) === (m[2] === "1");
    const people = [], rooms = {}, places = {};
    for (const r of live.values()) {
      if (t - r.last >= ACTIVE_MS || r.gone || !fits(r)) continue;
      people.push(r);
      const k = r.room || "z:hero", q = rooms[k] ||= { n: 0, bad: 0, good: 0, label: "" };
      q.n++; if (r.hurtIn === k) q.bad++; if (r.step === "paid") q.good++;
      (places[r.p] ||= { path: r.p, label: r.pr ? productName(r.pr) : r.p === "/" ? "Home page" : r.title || r.p, n: 0 }).n++;
    }
    for (const [k, q] of Object.entries(rooms)) q.label = roomLabel(k, productName);
    const edges = {};
    for (let i = moves.length - 1; i >= 0 && t - moves[i][0] < EDGE_MS; i--) { const k = `${moves[i][1]}>${moves[i][2]}`; edges[k] = (edges[k] || 0) + 1; }
    const top = people.sort((a, b) => b.friction - a.friction || a.start - b.start).slice(0, LIVE_PEOPLE);
    return {
      at: t, active: people.length, rooms, edges, dropped: stats.droppedLimit,
      places: Object.values(places).sort((a, b) => b.n - a.n),
      people: top.map((r) => ({ id: r.s.slice(0, 6), label: r.pr ? productName(r.pr) : r.p === "/" ? "Home page" : r.title || r.p, path: r.p, room: r.room, source: r.source, device: r.dev, browser: r.br, since: t - r.start, pages: r.pages, step: stepWord[r.step] || "", friction: r.friction, returning: r.nw === 0, scroll: r.sc || 0, zone: r.zone || "", zoneLabel: r.zone ? zoneLabel(r.zone) : "", zoneFor: r.zone ? t - r.zoneAt : 0, box: r.box || "", boxLabel: r.box ? FIELD_LABEL[r.box] || r.box : "", boxFor: r.box ? t - r.boxAt : 0 })),
      feed: recent.slice(-30).reverse().map((e) => ({ t: e.t, e: e.e, who: e.s.slice(0, 6), p: e.p, x: e.x, r: e.r, note: e.note, product: e.pr ? productName(e.pr) : undefined })),
    };
  }
  const dayShift = (day, n) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

  // The loop's last step: what the owner changed, and what happened to the numbers after.
  const changes = () => readJson(CHANGES, []);
  function addChange(b) {
    const note_ = String(b?.note || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(b?.day || "") ? b.day : dayOf(now());
    if (!note_) return { error: "Say what you changed." };
    const row = { id: crypto.randomBytes(8).toString("hex"), day, note: note_, at: new Date(now()).toISOString() };
    writeJson(CHANGES, [...changes(), row]);
    return { change: row };
  }
  function removeChange(id) {
    const list = changes();
    if (!list.some((c) => c.id === id)) return { error: "Not found." };
    writeJson(CHANGES, list.filter((c) => c.id !== id));
    return { ok: true };
  }
  // The 7 days before against the days since (up to 7), so it's fair the week after a change, and says if it's more than chance.
  async function changeResults() {
    flushSync();
    const today = dayOf(now()), out = [];
    for (const c of changes().sort((a, b) => b.day.localeCompare(a.day)).slice(0, 12)) {
      const end = dayShift(c.day, 7) < today ? dayShift(c.day, 7) : today;
      const before = await ask("totals", { from: dayShift(c.day, -7), to: dayShift(c.day, -1), today });
      const after = c.day < today ? await ask("totals", { from: dayShift(c.day, 1), to: end, today }) : null;
      out.push({ ...c, before, after, days: after ? Math.round((Date.parse(end) - Date.parse(c.day)) / DAY_MS) : 0, proven: after ? isReal(before.orders, before.visits, after.orders, after.visits) : false });
    }
    return out;
  }
  const close = () => { timers.forEach(clearInterval); clearTimeout(firstPrune); flushSync(); worker?.terminate(); };
  return { ingest, liveNow, report, addChange, removeChange, changeResults, flushSync, flush, prune, close, stats };
};
module.exports.summarise = summarise;
module.exports.clean = clean;
module.exports.dayOf = dayOf;

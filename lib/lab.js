// The owner's lab: A/B tests and screen recordings, kept on the shop's own disk like the rest of the analytics.
// Tests: each visitor is put in one version by their random visit id, at the same time as everyone else, so a
// sale or a busy week lifts both versions equally. A version wins only when it is very likely better
// (95 %), enough people saw each one, and the test ran its full length.
// Recordings: a share of visits are recorded with rrweb (lib/lab-client.js), with everything typed hidden
// and checkout and account text blanked. Kept 14 days, inside a disk budget.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { readJson, writeJson } = require("./jsonstore");

const DAY_MS = 864e5, KEEP_REC_DAYS = 14, MAX_REC_BYTES = 4 * 1024 * 1024, MAX_CHUNK = 600 * 1024;
const METRICS = { checkout: "Started an order", paid: "Paid for an order", bag_add: "Added to bag", pclick: "Opened a product", wa: "Messaged on WhatsApp" };
const FIELDS = ["headline", "headline2", "lede", "cta", "jump", "look"];
const LIMIT = { headline: 60, headline2: 60, lede: 220, cta: 30, jump: 30, look: 24 };
// A "look" is a whole-site style switch (a class on <html>, styled in shop.css), for testing a colour or a
// layout instead of hero words. Only looks the stylesheet knows: "ink-buttons" = black order buttons.
const LOOKS = ["ink-buttons"];
const ID = /^[a-f0-9]{16}$/;

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
function content(raw) {
  const out = {};
  for (const k of FIELDS) { const v = clip(raw?.[k], LIMIT[k]); if (v && (k !== "look" || LOOKS.includes(v))) out[k] = v; }
  return Object.keys(out).length ? out : null;
}
function audienceOk(a) { return a === "" || a === "new" || a === "returning" || /^cat:[\w &-]{1,30}$/.test(a); }

// ---- the maths: chance that B beats A, from the two conversion rates (Beta posteriors, sampled) ----
function gamma(k) { // Marsaglia and Tsang, for k >= 1
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = Math.random(), u2 = Math.random(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const beta = (a, b) => { const x = gamma(a); return x / (x + gamma(b)); };
function chanceBWins(a, b, draws = 20000) {
  let wins = 0;
  for (let i = 0; i < draws; i++) if (beta(1 + b.c, 1 + b.n - b.c) > beta(1 + a.c, 1 + a.n - a.c)) wins++;
  return wins / draws;
}

module.exports = function createLab({ STORE, now = Date.now, budgetMb = Number(process.env.REC_BUDGET_MB || 150) }) {
  const DIR = path.join(STORE, "analytics", "lab"), REC = path.join(DIR, "rec");
  const TESTS = path.join(DIR, "tests.json"), TALLY = path.join(DIR, "tally.json"), INDEX = path.join(REC, "index.json");
  fs.mkdirSync(REC, { recursive: true });
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

  // ---------------- tests ----------------
  let tests = readJson(TESTS, []);
  const tally = readJson(TALLY, {}); // test id -> { arms: { visitor: "a"|"b" }, conv: { visitor: 1 } }
  let dirty = false;
  const saveTests = () => writeJson(TESTS, tests);
  const saveTally = () => { if (dirty) { writeJson(TALLY, tally); dirty = false; } };

  function create(b) {
    const name = clip(b?.name, 80), metric = METRICS[b?.metric] ? b.metric : "checkout", audience = clip(b?.audience, 40);
    const vb = content(b?.b);
    if (!name) return { error: "Give the test a name." };
    if (!vb) return { error: "Write at least one line for version B." };
    if (!audienceOk(audience)) return { error: "Unknown audience." };
    const days = Math.max(7, Math.min(60, Math.round(Number(b?.days) || 14)));
    const t = {
      id: crypto.randomBytes(5).toString("hex"), name, metric, audience, days, status: "draft", created: new Date(now()).toISOString(),
      variants: [{ key: "a", label: "A · current", content: content(b?.a) }, { key: "b", label: "B · new", content: vb }],
    };
    tests.push(t); saveTests();
    return { test: t };
  }
  function act(id, what, body = {}) {
    const t = tests.find((x) => x.id === id);
    if (!t) return { error: "No such test." };
    const at = new Date(now()).toISOString();
    if (what === "start") {
      if (t.status !== "draft") return { error: "Only a draft can start." };
      const clash = tests.find((x) => x.status === "running" && x.id !== id && x.audience === t.audience);
      if (clash) return { error: `"${clash.name}" is already testing the hero for the same visitors. Stop it first.` };
      t.status = "running"; t.started = at; tally[id] = { arms: {}, conv: {} }; dirty = true;
    } else if (what === "stop") {
      if (t.status !== "running") return { error: "It isn't running." };
      t.status = "stopped"; t.ended = at; t.result = result(t);
    } else if (what === "keep") { // show the chosen version to everyone, from now on
      if (!["running", "stopped"].includes(t.status)) return { error: "Stop the test first." };
      const key = body.key === "a" ? "a" : "b";
      if (t.status === "running") { t.ended = at; t.result = result(t); }
      for (const o of tests) if (o.status === "kept" && o.audience === t.audience) o.status = "stopped";
      t.status = "kept"; t.kept = key;
    } else if (what === "delete") {
      if (t.status === "running") return { error: "Stop it first." };
      tests = tests.filter((x) => x.id !== id); delete tally[id]; dirty = true;
    } else return { error: "Unknown action." };
    saveTests(); saveTally();
    return { test: t };
  }

  // What the shop's pages need: running tests and kept winners, nothing else.
  function publicTests() {
    return tests.filter((t) => t.status === "running" || t.status === "kept").map((t) => ({
      id: t.id, audience: t.audience, status: t.status, kept: t.kept,
      variants: t.status === "kept" ? t.variants.filter((v) => v.key === t.kept).map((v) => ({ key: v.key, content: v.content })) : t.variants.map((v) => ({ key: v.key, content: v.content })),
    }));
  }

  function result(t) {
    const r = tally[t.id] || { arms: {}, conv: {} };
    const arm = { a: { n: 0, c: 0 }, b: { n: 0, c: 0 } };
    for (const [v, k] of Object.entries(r.arms)) { if (!arm[k]) continue; arm[k].n++; if (r.conv[v]) arm[k].c++; }
    const rate = (x) => (x.n ? x.c / x.n : 0);
    const chance = arm.a.n && arm.b.n ? chanceBWins(arm.a, arm.b) : 0.5;
    const lift = rate(arm.a) ? rate(arm.b) / rate(arm.a) - 1 : null;
    const ranDays = t.started ? ((t.ended ? Date.parse(t.ended) : now()) - Date.parse(t.started)) / DAY_MS : 0;
    const need = 100, enough = arm.a.n >= need && arm.b.n >= need, long = ranDays >= t.days;
    let verdict, call = null;
    if (!enough || !long) {
      const parts = [];
      if (!long) parts.push(`${Math.ceil(t.days - ranDays)} more day${Math.ceil(t.days - ranDays) === 1 ? "" : "s"}`);
      if (!enough) parts.push(`${Math.max(need - arm.a.n, need - arm.b.n)} more visitors in the smaller version`);
      verdict = `Too early to call: needs ${parts.join(" and ")}.`;
    } else if (chance >= 0.95) { verdict = "B is better. Keep B."; call = "b"; }
    else if (chance <= 0.05) { verdict = "A is better. Keep A (the current page)."; call = "a"; }
    else verdict = "No clear winner. The difference could be luck: keep A, or try a bolder B.";
    return { a: { ...arm.a, rate: rate(arm.a) }, b: { ...arm.b, rate: rate(arm.b) }, chance, lift, ranDays, verdict, call, metric: METRICS[t.metric] };
  }
  const list = () => tests.slice().reverse().map((t) => ({ ...t, result: t.status === "running" ? result(t) : t.result || null }));

  // ---------------- recordings ----------------
  let index = readJson(INDEX, {}); // visit id -> summary
  let indexDirty = false;
  const recFile = (s, day) => path.join(REC, day, `${s}.jsonl.gz`); // each piece its own gzip member: they read back as one
  function addChunk(body, { dev = "" } = {}) {
    if (!body || !ID.test(body.s) || !ID.test(body.v) || !Array.isArray(body.ev) || !body.ev.length) return { error: "bad" };
    const line = JSON.stringify({ pg: clip(body.p, 120), ev: body.ev });
    if (line.length > MAX_CHUNK) return { error: "too big" };
    let r = index[body.s];
    const t = now();
    if (!r) {
      if (usedBytes() > budgetMb * 1024 * 1024) return { error: "full" };
      r = index[body.s] = { s: body.s, v: body.v, day: dayOf(t), start: t, last: t, bytes: 0, pages: [], flags: {}, w: Number(body.w) || 0, dev };
    }
    if (r.v !== body.v) return { error: "bad" };
    const gz = zlib.gzipSync(line + "\n");
    if (r.bytes + gz.length > MAX_REC_BYTES) return { error: "long" };
    fs.mkdirSync(path.join(REC, r.day), { recursive: true });
    fs.appendFileSync(recFile(r.s, r.day), gz);
    r.bytes += gz.length; r.last = t;
    // How long the visit lasted, from the browser's own clock (uploads arrive in bursts).
    for (const e of body.ev) { const ts = Number(e && e.timestamp); if (Number.isFinite(ts)) { r.t0 = Math.min(r.t0 ?? ts, ts); r.t1 = Math.max(r.t1 ?? ts, ts); } }
    const pg = clip(body.p, 120);
    if (pg && r.pages[r.pages.length - 1] !== pg && r.pages.length < 30) r.pages.push(pg);
    indexDirty = true;
    return { ok: true };
  }
  let usedCache = { at: 0, n: 0 };
  function usedBytes() {
    if (now() - usedCache.at < 60e3) return usedCache.n;
    let n = 0; for (const r of Object.values(index)) n += r.bytes;
    usedCache = { at: now(), n }; return n;
  }
  function recording(s) {
    const r = ID.test(s) && index[s];
    if (!r) return null;
    let text = ""; try { text = zlib.gunzipSync(fs.readFileSync(recFile(s, r.day))).toString("utf8"); } catch { return null; }
    const events = [];
    for (const line of text.split("\n")) { if (!line) continue; try { events.push(...JSON.parse(line).ev); } catch { /* a cut-off last line */ } }
    events.sort((a, b) => a.timestamp - b.timestamp);
    return { ...summary(r), events };
  }
  const summary = (r) => ({ id: r.s, start: r.start, length: r.t1 != null ? r.t1 - r.t0 : r.last - r.start, pages: r.pages, flags: r.flags, dev: r.dev || "", src: r.src || "", returning: !!r.ret, kb: Math.round(r.bytes / 1024) });
  function recordings(flag = "") {
    return Object.values(index).filter((r) => r.bytes > 0 && (!flag || r.flags[flag])).sort((a, b) => b.start - a.start).slice(0, 300).map(summary);
  }
  function pruneRec() {
    const cut = dayOf(now() - KEEP_REC_DAYS * DAY_MS);
    let days = []; try { days = fs.readdirSync(REC).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(); } catch { /* none yet */ }
    const drop = (day) => { fs.rmSync(path.join(REC, day), { recursive: true, force: true }); for (const [s, r] of Object.entries(index)) if (r.day === day) delete index[s]; indexDirty = true; };
    for (const d of days) if (d < cut) drop(d);
    // Over budget: the oldest days go first.
    days = days.filter((d) => d >= cut);
    while (days.length > 1) { let n = 0; for (const r of Object.values(index)) n += r.bytes; if (n <= budgetMb * 1024 * 1024) break; drop(days.shift()); }
    usedCache.at = 0;
  }

  // ---------------- events from the shop's own tracker (lib/analytics.js hands every kept event here) ----------------
  const FLAG = { rage: "rage", dead: "dead", abandon: "left", paid: "paid", checkout: "checkout", err: "error" };
  function see(ev) {
    if (ev.e === "xp") {
      const t = tests.find((x) => x.id === ev.x && x.status === "running");
      const r = t && tally[t.id];
      if (r && (ev.r === "a" || ev.r === "b") && !r.arms[ev.v]) { r.arms[ev.v] = ev.r; dirty = true; }
    } else {
      for (const t of tests) {
        if (t.status !== "running" || t.metric !== ev.e) continue;
        const r = tally[t.id];
        if (r?.arms[ev.v] && !r.conv[ev.v]) { r.conv[ev.v] = 1; dirty = true; }
      }
    }
    const rec = index[ev.s];
    if (rec) {
      if (FLAG[ev.e] && !rec.flags[FLAG[ev.e]]) { rec.flags[FLAG[ev.e]] = 1; indexDirty = true; }
      if (ev.e === "page" && !rec.dev) { rec.dev = ev.dev; rec.ret = ev.nw === 0; rec.src = ev.ref || ev.utm || ""; indexDirty = true; }
    }
  }

  const save = () => { saveTally(); if (indexDirty) { writeJson(INDEX, index); indexDirty = false; } };
  const timers = [setInterval(save, 15e3), setInterval(pruneRec, 6 * 3600e3)];
  timers.forEach((t) => t.unref());
  setTimeout(pruneRec, 20e3).unref();
  const close = () => { save(); timers.forEach(clearInterval); };

  return { create, act, list, publicTests, result, see, addChunk, recording, recordings, pruneRec, close, save, METRICS };
};
module.exports.chanceBWins = chanceBWins;

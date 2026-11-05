// Visitor analytics: what gets stored, what never does, and the owner lock. Runs the real server.
// `node tests/analytics.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { summarise, clean } = require("../lib/analytics.js");

const PORT = 4797;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-analytics-"));
const base = `http://127.0.0.1:${PORT}`;
const PHONE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "" };
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env, stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/products`); break; } catch { await wait(100); } }

const id = (n) => String(n).repeat(16).slice(0, 16);
const post = (body, headers = {}) => fetch(`${base}/api/t`, { method: "POST", headers: { "Content-Type": "text/plain", "User-Agent": PHONE, ...headers }, body: JSON.stringify(body) });
const owner = (p, opts = {}) => fetch(`${base}/api/analytics/${p}`, { ...opts, headers: { "x-owner-key": "k", ...opts.headers } });
const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
let n = 0;
const check = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FAILED: ${name}`); console.error(e); srv.kill(); process.exit(1); } };

await check("the owner lock holds", async () => {
  for (const p of ["live", `report?from=${day}&to=${day}`, "changes"]) assert.equal((await fetch(`${base}/api/analytics/${p}`)).status, 401);
});
await check("form timing keeps box names and counts, and never what was typed", () => {
  const f = clean({ e: "field", p: "/p/s1", x: "phone", n: 9000, ed: 12, del: 3, fl: 1, st2: "checkout", value: "9876543210", text: "my address" });
  assert.deepEqual(f, { e: "field", p: "/p/s1", x: "phone", n: 9000, ed: 12, del: 3, fl: 1, st2: "checkout" });
  assert.equal(clean({ e: "tap", p: "/", x: "Filters", z: "Lal Chowk road", sx: 10, sy: 20 }).z, undefined, "a section name is never free text");
  assert.equal(clean({ e: "field", p: "/", x: "98765 43210", n: 1 }), null); // a box name is never free text
  assert.equal(clean({ e: "field", p: "/", x: "9876543210", n: 1 }), null);
  assert.equal(clean({ e: "sec", p: "/", x: "my secret words", n: 1 }), null);
  assert.equal(clean({ e: "choice", p: "/", x: "address", r: "Lal Chowk" }), null);
  assert.equal(clean({ e: "tap", p: "/", x: "Call 98765 43210" }).x, "Call •••");
});
await check("every section and box adds up by person", () => {
  const t = 1e12, ev = (s, e, x = {}) => ({ t, v: s, s, e, p: "/", ...x });
  const start = (s) => [ev(s, "page", { dev: "Phone", br: "Chrome", os: "Android", nw: 1 })];
  const d = summarise([
    ...start("a"), ...start("b"),
    ev("a", "sec", { x: "rack", n: 20000 }), ev("a", "sec", { x: "rack", n: 10000 }), ev("b", "sec", { x: "rack", n: 6000 }), ev("b", "sec", { x: "hero", n: 2000 }),
    ev("a", "checkout", { pr: "s1", n: 999, ms: 40000 }), ev("a", "field", { x: "name", n: 5000, ed: 8, del: 0, fl: 1, st2: "checkout" }),
    ev("a", "field", { x: "phone", n: 4000, ed: 10, del: 2, fl: 0, st2: "checkout" }), ev("a", "field", { x: "phone", n: 3000, ed: 4, del: 1, fl: 1, st2: "checkout" }),
    ev("a", "abandon", { pr: "s1", x: "details", f: "phone", n: 15000 }), ev("b", "tap", { x: "rack: Filters" }), ev("b", "choice", { x: "delivery", r: "ship" }),
  ], { from: "2026-01-01", to: "2026-01-01" });
  assert.deepEqual(d.zones.home.map((z) => z.key), ["hero", "rack"]);
  assert.equal(d.zones.home[1].people, 2);
  assert.equal(d.zones.home[1].totalTime, 36000);
  const [nm, ph] = d.forms.checkout.boxes;
  assert.equal(nm.key, "name"); assert.equal(ph.medianTime, 7000); assert.equal(ph.keys, 14);
  assert.equal(ph.corrected, 1); assert.equal(ph.quit, 1); assert.equal(ph.empty, 0, "filled by the end");
  assert.equal(d.stepTimes.deciding, 40000); assert.equal(d.stepTimes.gaveUpDetails, 15000);
  assert.equal(d.presses[0].n, 1); assert.equal(d.delivery[0].key, "ship");
});
await check("live shows the exact section and box", async () => {
  const v = id(7), s = id(8);
  await post({ v, s, ev: [{ e: "page", p: "/", title: "Vibe X", nw: 1, st: 1 }, { e: "in", p: "/", x: "rack" }] });
  let me = (await (await owner("live")).json()).people.find((p) => p.id === s.slice(0, 6));
  assert.equal(me.zoneLabel, "Fresh off the truck");
  await post({ v, s, ev: [{ e: "checkout", p: "/", pr: "s1", n: 999 }, { e: "fin", p: "/", x: "phone" }] });
  me = (await (await owner("live")).json()).people.find((p) => p.id === s.slice(0, 6));
  assert.equal(me.boxLabel, "Phone number");
  await post({ v, s, ev: [{ e: "field", p: "/", x: "phone", n: 3000, ed: 4, del: 0, fl: 1, st2: "checkout" }, { e: "leave", p: "/", n: 1 }] });
  me = (await (await owner("live")).json()).people.find((p) => p.id === s.slice(0, 6));
  assert.equal(me, undefined);
});
await check("a problem counts in the room it happened, not every room of the visit", () => {
  const ev = (t, e, x = {}) => ({ t, v: "a", s: "a", e, p: "/", ...x });
  const d = summarise([ev(1e12, "page", { dev: "Phone", br: "Chrome", nw: 1 }), ev(1e12 + 1, "in", {}), ev(1e12 + 2, "sec", { x: "hero", n: 3000 }), ev(1e12 + 3, "sec", { x: "rack", n: 3000 }), ev(1e12 + 4, "dead", { x: "rack: Photo" })], { from: "2026-01-01", to: "2026-01-01" });
  const room = (k) => d.plan.find((r) => r.key === k);
  assert.equal(room("z:rack").stuck, 1); assert.equal(room("z:hero").stuck, 0);
});
await check("something unproven never leads the fix list", () => {
  const t = 1e12, list = [], add = (s, dev, buys) => { list.push({ t, v: s, s, e: "page", p: "/", dev, br: "Chrome", nw: 1 }); if (buys) list.push({ t, v: s, s, e: "paid", p: "/", n: 3000 }); };
  for (let i = 0; i < 12; i++) add(`p${i}`, "Phone", i < 2);
  for (let i = 0; i < 6; i++) add(`c${i}`, "Computer", i < 2);
  const f = summarise(list, { from: "2026-01-01", to: "2026-01-01" }).fixes.find((x) => /buy less/.test(x.title));
  assert.equal(f.chance, true); assert.equal(f.sure, "weak");
});
await check("what to fix first says how sure it is and what it's likely worth", () => {
  const t = 1e12, ev = (s, e, x = {}) => ({ t, v: s, s, e, p: "/p/s1", ...x }), list = [];
  for (let i = 0; i < 40; i++) {
    const s = `v${i}`;
    list.push(ev(s, "page", { dev: "Phone", br: "Chrome", nw: 1, pr: "s1" }), ev(s, "checkout", { pr: "s1", n: 3000 }), ev(s, "field", { x: "address", n: 30000, ed: 40, del: 2, fl: 1, st2: "checkout" }));
    if (i % 4 === 0) list.push(ev(s, "abandon", { pr: "s1", x: "details", f: "address", n: 30000 }));
    else { list.push(ev(s, "details", { pr: "s1", n: 3000 })); if (i % 2) list.push(ev(s, "paid", { pr: "s1", n: 3000 })); }
  }
  const d = summarise(list, { from: "2026-01-01", to: "2026-01-01" }), fix = d.fixes.find((f) => f.room === "f:address");
  assert.equal(fix.people, 10);
  assert.ok(fix.money > 0); assert.equal(fix.sure, "fair");
  assert.ok(d.totals.conversionRange.low < d.totals.conversion && d.totals.conversionRange.high > d.totals.conversion);
});
await check("a visit shows up live, then goes", async () => {
  const r = await post({ v: id(1), s: id(2), ev: [{ e: "page", p: "/", title: "Vibe X", w: 390, nw: 1, st: 1, tz: "Asia/Kolkata" }] });
  assert.equal(r.status, 204);
  const l = await (await owner("live")).json();
  assert.equal(l.active, 1);
  assert.equal(l.people[0].label, "Home page");
  assert.equal(l.people[0].device, "Phone");
  await post({ v: id(1), s: id(2), ev: [{ e: "leave", p: "/", n: 1000 }] });
  assert.equal((await (await owner("live")).json()).active, 0);
});
await check("bots, other sites and junk are refused", async () => {
  await post({ v: id(3), s: id(4), ev: [{ e: "page", p: "/" }] }, { "User-Agent": "Googlebot/2.1" });
  await post({ v: "nope", s: id(4), ev: [{ e: "page", p: "/" }] });
  await post({ v: id(3), s: id(4), ev: [{ e: "made-up", p: "/" }, { e: "page", p: "javascript:alert(1)" }] });
  assert.equal((await (await owner("live")).json()).active, 0);
  assert.equal((await post({ v: id(3), s: id(4), ev: [] }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await fetch(`${base}/api/t`, { method: "POST", body: "{not json" })).status, 400);
});
await check("no IP address, browser string or stray field reaches the disk", async () => {
  await post({ v: id(5), s: id(6), ev: [{ e: "invalid", p: "/p/x", x: "phone", value: "9876543210", phone: "9876543210" }, { e: "page", p: "/", ip: "1.2.3.4" }] }, { "X-Forwarded-For": "203.0.113.9" });
  const r = await (await owner(`report?from=${day}&to=${day}`)).json();
  assert.ok(r.totals.visits >= 2);
  const text = fs.readFileSync(path.join(dir, "analytics", `${day}.jsonl`), "utf8");
  assert.ok(!/203\.0\.113|1\.2\.3\.4|9876543210|Mozilla/.test(text));
});
await check("feedback notes lose phone numbers and bad choices are dropped", async () => {
  assert.equal(clean({ e: "fb", p: "/", x: "stop", r: "price", note: "call me on +91 98765 43210 ok" }).note, "call me on ••• ok");
  assert.equal(clean({ e: "fb", p: "/", x: "stop", r: "<script>" }), null);
});
await check("the change log saves and removes", async () => {
  const h = { "Content-Type": "application/json" };
  assert.equal((await owner("changes", { method: "POST", headers: h, body: "{}" })).status, 400);
  const { change } = await (await owner("changes", { method: "POST", headers: h, body: JSON.stringify({ note: "Moved the video", day }) })).json();
  const list = await (await owner("changes")).json();
  assert.equal(list[0].note, "Moved the video");
  assert.equal(list[0].after, null); // too soon to say
  assert.equal((await owner(`changes/${change.id}/remove`, { method: "POST" })).status, 200);
  assert.equal((await (await owner("changes")).json()).length, 0);
});
await check("the page and tracker are served, and every shop page loads the tracker", async () => {
  assert.equal((await fetch(`${base}/analytics`)).status, 200);
  assert.equal((await fetch(`${base}/track.js`)).status, 200);
  for (const p of ["/", "/privacy"]) assert.match(await (await fetch(base + p)).text(), /\/track\.js/);
});

// ---- the sums, on a made-up day ----
const T0 = Date.parse("2026-11-05T06:00:00Z");
const visit = (s, list, dev = "Phone") => list.map((e, i) => ({ t: T0 + i * 1000, v: `v${s}`, s: `s${s}`, p: "/", ...(e.e === "page" ? { dev, br: "Chrome", os: "Android", nw: 1 } : {}), ...e }));
const P = { e: "page", p: "/p/a", pr: "a" };
const ev = [
  ...visit(1, [{ e: "page" }]),
  ...visit(2, [{ e: "page" }, P, { e: "beat", p: "/p/a", n: 20000 }, { e: "checkout", pr: "a", n: 1000 }, { e: "details", pr: "a", n: 1000 }, { e: "paid", pr: "a", n: 1000 }]),
  ...visit(3, [P, { e: "beat", p: "/p/a", n: 15000 }, { e: "checkout", pr: "a", n: 1000 }, { e: "invalid", x: "phone" }, { e: "abandon", pr: "a", x: "details", f: "phone", n: 9000 }, { e: "fb", x: "stop", r: "shipping" }]),
  ...visit(4, [P, { e: "rage", p: "/p/a", x: "pdp: photo" }, { e: "page", p: "/" }]),
  ...visit(5, [{ e: "page" }, { e: "section", x: "rack" }, { e: "section", x: "latest" }]),
  ...visit(6, [{ e: "page" }, { e: "section", x: "rack" }]),
];
const r = summarise(ev, { name: (i) => `Item ${i}`, from: "2026-11-05", to: "2026-11-05" });
await check("the funnel counts each visit once", () => {
  assert.deepEqual(r.funnel.map((f) => f.n), [6, 3, 2, 1, 1]);
  assert.equal(r.totals.orders, 1);
  assert.equal(r.totals.value, 1000);
  assert.equal(r.totals.conversion, 16.7);
});
await check("stuck moments are found", () => {
  assert.equal(r.totals.frictionRate, 33.3);
  assert.ok(r.stuck.some((x) => x.kind === "abandon" && /Phone number/.test(x.label)));
  assert.ok(r.stuck.some((x) => x.kind === "invalid" && x.label === "Phone number"));
  assert.ok(r.stuck.some((x) => x.kind === "rage"));
  assert.ok(r.stuck.some((x) => x.kind === "uturn" && x.label === "Item a")); // visit 4 turned straight back
  assert.equal(r.stops[0].key, "shipping");
});
await check("sections are a share of home page visits", () => {
  assert.equal(r.sections.find((s) => s.key === "rack").share, 40); // 2 of 5 home visits
  assert.equal(r.sections.find((s) => s.key === "latest").label, "Latest video");
});
await check("the product row adds up", () => {
  const a = r.products.find((p) => p.id === "a");
  assert.deepEqual([a.views, a.checkout, a.abandon, a.paid, a.value], [3, 2, 1, 1, 1000]);
});
await check("nothing is claimed from too few people", () => {
  const few = summarise(ev.filter((e) => ["s1", "s2", "s3"].includes(e.s)), { name: (i) => i, from: "2026-11-05", to: "2026-11-05" });
  assert.equal(few.findings.length, 0);
});
await check("an empty range works", () => {
  const e = summarise([], { from: "2026-11-05", to: "2026-11-05" });
  assert.equal(e.totals.visits, 0);
  assert.equal(e.totals.conversion, 0);
});
await check("the time an event happened comes from the browser, not the batch", async () => {
  const v = id(3), s = id(4);
  await post({ v, s, ev: [{ e: "page", p: "/", title: "x", nw: 1, st: 1, d: 12000 }, { e: "sec", p: "/", x: "rack", n: 5000, d: 1000 }] });
  const r = await (await owner(`report?from=${day}&to=${day}`)).json(), me = r.visits.find((x) => x.s === s.slice(0, 6));
  const [a, b] = me.steps;
  assert.ok(b.t - a.t >= 10000 && b.t - a.t <= 12500, `gap was ${b.t - a.t}`);
});
await check("many people on one network address are all counted", async () => {
  const before = (await (await owner(`report?from=${day}&to=${day}`)).json()).totals.visits;
  for (let i = 0; i < 60; i++) { const h = (0x1000 + i).toString(16).padStart(16, "a"); await post({ v: h, s: h, ev: Array.from({ length: 10 }, (_, k) => (k ? { e: "beat", p: "/", n: 1000 } : { e: "page", p: "/", title: "x", nw: 1, st: 1 })) }); }
  const after = (await (await owner(`report?from=${day}&to=${day}`)).json()).totals.visits;
  assert.equal(after - before, 60);
});
await check("the report can be cut by device", async () => {
  const phone = await (await owner(`report?from=${day}&to=${day}&seg=dev:Phone`)).json(), pc = await (await owner(`report?from=${day}&to=${day}&seg=dev:Computer`)).json();
  assert.ok(phone.totals.visits > 0); assert.equal(pc.totals.visits, 0);
});
await check("analytics stays inside its disk budget, and never touches the shop's files", async () => {
  const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-budget-")), dir2 = path.join(STORE, "analytics");
  fs.mkdirSync(dir2); fs.writeFileSync(path.join(STORE, "orders.json"), "keep me");
  const createAnalytics = require("../lib/analytics.js"), a = createAnalytics({ STORE, budgetMb: 400 });
  const old = new Date(Date.now() + 5.5 * 3600e3 - 20 * 864e5).toISOString().slice(0, 10), t = Date.parse(old);
  const line = (s2, e, x = {}) => JSON.stringify({ t, v: s2, s: s2, e, p: "/", ...x });
  fs.writeFileSync(path.join(dir2, `${old}.jsonl`), [line("a", "page", { dev: "Phone", br: "Chrome", nw: 1 }), line("a", "sec", { x: "rack", n: 5000 })].join(String.fromCharCode(10)) + String.fromCharCode(10));
  assert.equal((await a.report(old, old)).totals.visits, 1);
  await a.prune();
  assert.equal(fs.existsSync(path.join(dir2, `${old}.jsonl`)), false, "old raw file goes");
  assert.equal((await a.report(old, old)).zones.home[0].totalTime, 5000, "the visit is still counted from its record");
  a.close();
  const tiny = createAnalytics({ STORE, budgetMb: 0 });
  await tiny.prune();
  assert.equal(fs.existsSync(path.join(dir2, `${old}.vis.gz`)), false, "over budget, the oldest records go");
  assert.equal(fs.readFileSync(path.join(STORE, "orders.json"), "utf8"), "keep me");
  tiny.close();
});
await check("a day's events survive a restart", async () => {
  await post({ v: id(7), s: id(8), ev: [{ e: "page", p: "/" }] });
  const down = new Promise((res) => srv.on("exit", res));
  srv.kill("SIGTERM");
  await down;
  if (process.platform !== "win32") assert.match(fs.readFileSync(path.join(dir, "analytics", `${day}.jsonl`), "utf8"), new RegExp(id(8)));
});
srv.kill();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`all ${n} analytics checks passed`);

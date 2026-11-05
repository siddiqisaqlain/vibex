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

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
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "" };
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
await check("in-app browser crashes aren't counted as site errors, and real ones are", () => {
  assert.equal(clean({ e: "err", p: "/", x: "Uncaught Error: Error invoking postMessage: Java object is gone" }), null);
  assert.equal(clean({ e: "err", p: "/", x: "TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers.x')" }), null);
  assert.equal(clean({ e: "err", p: "/", x: "TypeError: boom (/shop.js:12)" }).x, "TypeError: boom (/shop.js:12)");
  const t = 1e12, ev = (e, x = {}) => ({ t, v: "a", s: "a", e, p: "/", ...x });
  const d = summarise([ev("page", { dev: "Phone", br: "Instagram app", os: "Android", nw: 1 }), ev("err", { x: "Uncaught Error: Java object is gone" })], { from: "2026-01-01", to: "2026-01-01" });
  assert.equal(d.stuck.length, 0, "days stored before the filter come out clean too");
  assert.equal(d.totals.frictionRate, 0);
});
await check("one sale proves nothing, and an error isn't something pressed", () => {
  const t = 1e12, ev = (s, e, x = {}) => ({ t, v: s, s, e, p: "/", ...x }), list = [];
  for (let i = 0; i < 335; i++) list.push(ev(`p${i}`, "page", { dev: "Phone", br: "Instagram app", os: "Android", nw: 1 }));
  for (let i = 0; i < 19; i++) list.push(ev(`c${i}`, "page", { dev: "Computer", br: "Chrome", os: "macOS", nw: 1, ref: "facebook.com" }));
  list.push(ev("c0", "paid", { pr: "s1", n: 7199 }));
  for (const s of ["p1", "p2"]) list.push(ev(s, "err", { x: "TypeError: boom (/shop.js:12)" }));
  const d = summarise(list, { from: "2026-01-01", to: "2026-01-01", name: () => "Jacket" });
  assert.ok(!d.fixes.some((f) => /buy less than/.test(f.title)), "no device verdict from one order");
  assert.ok(!d.findings.some((f) => /brings the buyers|sells well/.test(f.title)), "no winner from one order");
  const err = d.fixes.find((f) => /site error/.test(f.title));
  assert.equal(err.title, "2 people hit a site error");
  assert.ok(!d.fixes.some((f) => /pressed "TypeError/.test(f.title)));
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
await check("a buyer's name from the sales banner is never stored", () => {
  for (const x of ["Aamir from Srinagar just grabbed Lattafa Khamrah", "Sana from Delhi bought Nuptse Puffer", "rack: Aamir from Srinagar just bought x"]) {
    assert.equal(clean({ e: "tap", p: "/", x }).x, "Just bought banner");
    assert.equal(clean({ e: "rage", p: "/", x }).x, "Just bought banner");
  }
  const saved = { t: 1e12, v: "a", s: "a", e: "tap", p: "/", x: "Aamir from Srinagar just grabbed Lattafa" };
  const d = summarise([{ t: 1e12, v: "a", s: "a", e: "page", p: "/", dev: "Phone", nw: 1 }, saved], { from: "2026-01-01", to: "2026-01-01" });
  assert.ok(!JSON.stringify(d).includes("Aamir"), "older saved taps are cleaned when read");
});
await check("the guide learns from visits, starts careful, and keeps nothing personal", async () => {
  const { STARTER, newFit, addFit, readFit, newRecord, feed } = require("../lib/rollup.js");
  const F = newFit(), make = (i, buys) => { const s = `v${i}`, r = newRecord({ t: 1e12, s, v: s }); const ev = (e, x = {}) => feed(r, { t: 1e12, v: s, s, e, p: "/", ...x }); ev("page", { dev: "Phone", nw: 1 }); if (buys) { ev("checkout", { pr: "s1" }); ev("paid", { pr: "s1", n: 3000 }); } return r; };
  for (let i = 0; i < 10; i++) addFit(F, make(i, true));
  assert.equal(readFit(F).ready, false, "too few to learn from");
  for (let i = 10; i < 400; i++) addFit(F, make(i, i % 12 === 0));
  const m = readFit(F);
  assert.equal(m.ready, true); assert.ok(m.w.co > 1, "pressing Order now should raise the chance"); assert.ok(m.base < 0);
  assert.deepEqual(Object.keys(m).sort(), ["base", "buyers", "n", "ready", "w"]);
  const pub = await (await fetch(`${base}/api/guide`)).json();
  assert.ok(pub.w.co > 0); assert.equal(pub.ready, false); assert.ok(STARTER.w.co);
});
await check("the report compares with and without help, and what was really received", () => {
  const list = [], add = (s, arm, buy) => { const ev = (e, x = {}) => list.push({ t: 1e12, v: s, s, e, p: "/", ...x }); ev("page", { dev: "Phone", nw: 1, arm }); ev("pred", { pb: 20 }); ev("nudge", { x: "assure", ...(arm === "off" ? { ctl: 1 } : {}) }); if (buy) ev("paid", { pr: "s1", n: 2700, fp: 3000 }); };
  for (let i = 0; i < 20; i++) add(`a${i}`, "on", i < 8);
  for (let i = 0; i < 20; i++) add(`b${i}`, "off", i < 2);
  const g = summarise(list, { from: "2026-01-01", to: "2026-01-01" }).guide;
  assert.equal(g.on.rate, 40); assert.equal(g.off.rate, 10); assert.equal(g.proven, true);
  assert.equal(g.helps[0].shown, 20); assert.equal(g.helps[0].held, 20); assert.equal(g.helps[0].shownRate, 40);
  assert.equal(g.bands[1].n, 40); assert.equal(g.bands[1].actual, 25);
  assert.deepEqual(g.price, { received: 27000, listed: 30000, given: 3000 });
});
await check("the guide doesn't share saved names with the rest of the shop", () => {
  const root = path.resolve(import.meta.dirname, ".."), mine = [...fs.readFileSync(path.join(root, "lib/guide.js"), "utf8").matchAll(/"(vx-[a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(mine.length >= 2);
  for (const f of fs.readdirSync(path.join(root, "public")).filter((x) => x.endsWith(".js"))) { const t = fs.readFileSync(path.join(root, "public", f), "utf8"); for (const k of mine) assert.ok(!t.includes(`"${k}"`), `${f} also uses ${k}`); }
});
await check("a hold is real: one person, ten minutes, and it can't be hogged", () => {
  const createHolds = require("../lib/holds.js");
  let t = 1000; const h = createHolds({ now: () => t, ms: 600000 });
  const a = h.take("s1", "M", "a".repeat(16), "1.1.1.1");
  assert.equal(a.held, true); assert.equal(a.until, 601000);
  const b = h.take("s1", "M", "b".repeat(16), "2.2.2.2");
  assert.equal(b.held, false); assert.equal(b.taken, true);
  assert.ok(h.blockedFor("s1", "M", "b".repeat(16))); assert.equal(h.blockedFor("s1", "M", "a".repeat(16)), null);
  t += 300000; assert.equal(h.take("s1", "M", "a".repeat(16), "1.1.1.1").until, 601000, "pressing again can't stretch it");
  h.take("s2", "", "a".repeat(16), "1.1.1.1"); assert.equal(h.blockedFor("s1", "M", "b".repeat(16)), null, "one piece at a time");
  h.release("s2", "", "c".repeat(16)); assert.ok(h.blockedFor("s2", "", "b".repeat(16)), "only the holder can release it");
  h.release("s2", "", "a".repeat(16)); assert.equal(h.blockedFor("s2", "", "b".repeat(16)), null);
  h.take("s3", "", "d".repeat(16), "9.9.9.9"); t += 700000; assert.equal(h.blockedFor("s3", "", "b".repeat(16)), null, "it runs out");
  for (let i = 0; i < 3; i++) assert.equal(h.take(`x${i}`, "", String(i).repeat(16), "7.7.7.7").held, true);
  assert.equal(h.take("x9", "", "9".repeat(16), "7.7.7.7").held, false, "one address can't lock up the shop");
});
await check("while the last piece is held, the server refuses everyone else's order", async () => {
  const list = await (await fetch(`${base}/api/products`)).json(), item = list.find((x) => x.status === "available" && x.price && (x.options || []).length === 1);
  if (!item) return; // the demo stock in this run has none with one size
  const A = "a".repeat(16), B = "b".repeat(16), hold = (token) => fetch(`${base}/api/hold`, { method: "POST", body: JSON.stringify({ productId: item.id, token }) }).then((r) => r.json());
  const order = (holdToken) => fetch(`${base}/api/orders`, { method: "POST", body: JSON.stringify({ productId: item.id, name: "Test", phone: "9000000000", delivery: "pickup", holdToken }) });
  const got = await hold(A);
  if (!got.held) return; // more than one left, so there's nothing to hold
  assert.equal((await hold(B)).taken, true);
  assert.equal((await order(B)).status, 409, "someone else is refused");
  assert.equal((await (await fetch(`${base}/api/pulse?id=${item.id}&s=${B}`)).json()).heldByOther, true);
  assert.equal((await (await fetch(`${base}/api/pulse?id=${item.id}&s=${A}`)).json()).heldByOther, false);
  const mine = await order(A), body = await mine.json();
  assert.equal(mine.status, 200, "the holder can order"); assert.equal(body.amount, item.price, "at the selling price");
  await fetch(`${base}/api/orders/${body.id}/cancel`, { method: "POST" }); // they went back, so the order holds nothing
  await fetch(`${base}/api/hold/release`, { method: "POST", body: JSON.stringify({ productId: item.id, token: A }) });
  assert.equal((await order(B)).status, 200, "released, so it's open again");
});
await check("the numbers on the page are only ever real", async () => {
  const none = await (await fetch(`${base}/api/pulse?id=nobody&s=${"e".repeat(16)}`)).json();
  assert.equal(none.watching, 0); assert.equal(none.today, 0); assert.equal(none.heldByOther, false);
  const code = fs.readFileSync(path.resolve(import.meta.dirname, "../lib/rush.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  for (const word of ["Math.random", "/api/orders", "promo", "discount", "amount"]) assert.ok(!code.includes(word), `rush.js has ${word}`);
  assert.ok(!/beforeunload|history\.pushState|preventDefault/.test(code), "nothing may stop someone leaving");
  assert.ok(!/\.price\b/.test(code), "rush.js can't read a price");
});
await check("the Drop Kit: a short link, an owner's list, and a line for latecomers", async () => {
  const list = await (await fetch(`${base}/api/products`)).json(), item = list.find((x) => x.code);
  const r = await fetch(`${base}/d/${item.code}`, { redirect: "manual" });
  assert.equal(r.status, 302); assert.match(r.headers.get("location"), /utm_source=whatsapp&utm_campaign=drop-/);
  assert.equal((await fetch(`${base}/d/99999999`, { redirect: "manual" })).headers.get("location"), "/");
  assert.equal((await fetch(`${base}/api/kit`)).status, 401, "the kit is the owner's");
  const kit = await (await fetch(`${base}/api/kit`, { headers: { "x-owner-key": "k" } })).json();
  assert.ok(kit.pieces.some((p) => p.id === item.id));
  const line = (phone) => fetch(`${base}/api/next-in-line`, { method: "POST", body: JSON.stringify({ productId: item.id, phone }) });
  assert.equal((await line("123")).status, 400);
  assert.equal((await line("9876543210")).status, 200); await line("9876543210");
  let w = (await (await fetch(`${base}/api/kit`, { headers: { "x-owner-key": "k" } })).json()).waiting;
  assert.equal(w.length, 1, "asked twice, listed once");
  await fetch(`${base}/api/kit/wait-done`, { method: "POST", headers: { "x-owner-key": "k" }, body: JSON.stringify({ id: w[0].id }) });
  w = (await (await fetch(`${base}/api/kit`, { headers: { "x-owner-key": "k" } })).json()).waiting;
  assert.equal(w.length, 0, "their number goes once it's dealt with");
  assert.equal((await fetch(`${base}/api/kit/wait-done`, { method: "POST", body: "{}" })).status, 401);
});
await check("the promise only repeats the shop's policy, and the price stays out of it", () => {
  const pdp = fs.readFileSync(new URL("../public/pdp.js", import.meta.url), "utf8"), block = pdp.slice(pdp.indexOf("function promise(p)"), pdp.indexOf("function render()"));
  assert.ok(block.includes("P.changeOfMindDays") && block.includes("P.damageReportHours"), "the numbers come from shop.json");
  assert.doesNotMatch(block, /\b(7|48) (days|hours)\b/, "no number typed in by hand");
  assert.doesNotMatch(block, /discount|% off|price/i, "it says nothing about price");
  const legal = fs.readFileSync(new URL("../lib/legal.js", import.meta.url), "utf8");
  assert.match(legal, /whenever you find out/); assert.match(legal, /seal is unbroken/); assert.match(legal, /you pay the return shipping/);
  assert.equal(JSON.parse(fs.readFileSync(new URL("../shop.json", import.meta.url), "utf8")).policy.photoBeforeDispatch, true, "the owner agreed to this promise");
});
await check("courier: worked out on the server, kept apart from the selling price, and no codes", async () => {
  const { courierFor } = require("../lib/courier.js"), rate = { perKg: 130, kashmirPins: ["190"], kg: { default: 1, Footwear: 2, Puffer: 1.5 } };
  assert.equal(courierFor(rate, { category: "Footwear" }, "110001").fee, 260);
  assert.equal(courierFor(rate, { category: "Clothing", subcategory: "Puffer" }, "110001").fee, 260, "subcategory first: 1.5 kg is charged as 2 started kg, not the 1 kg a plain Clothing piece gets");
  assert.equal(courierFor(rate, { category: "Clothing" }, "110001").fee, 130, "the category weight (default 1 kg) when no subcategory matches");
  assert.equal(courierFor({ ...rate, insideKashmirPerKg: 100 }, { category: "Footwear" }, "190001").fee, 200, "inside Kashmir pays its own rate per kg");
  assert.equal(courierFor(rate, { category: "Clothing" }, "190001").fee, null, "inside Kashmir has no charge set");
  const piece = (await (await fetch(`${base}/api/products`)).json()).find((x) => x.status === "available" && x.price && (x.options || []).length <= 1);
  assert.equal((await (await fetch(`${base}/api/courier?id=${piece.id}&pin=110001`)).json()).fee, 130 * (piece.category === "Footwear" ? 2 : 1));
  const shop = JSON.parse(fs.readFileSync(new URL("../shop.json", import.meta.url), "utf8"));
  assert.ok(!shop.offers && !JSON.stringify(shop.claims.ticker).includes("FIRST10"));
  assert.equal((await fetch(`${base}/api/courier?id=x&pin=1`)).status, 400);
});
await check("the count, clock and ending note stay off until the owner switches them on", () => {
  assert.equal(JSON.parse(fs.readFileSync(new URL("../shop.json", import.meta.url), "utf8")).rush.live, false);
  const code = fs.readFileSync(new URL("../lib/rush.js", import.meta.url), "utf8");
  for (const part of ["if (!live || !on || !text", "if (live) once(\"hold\")", "if (live) { clock", "if (live && on && dlg)"]) assert.ok(code.includes(part), part);
});
await check("the guide has no way to touch a price", () => {
  const code = fs.readFileSync(path.resolve(import.meta.dirname, "../lib/guide.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  for (const word of ["/api/orders", "promo", "discount", "amount", "price", "countdown"]) assert.ok(!code.toLowerCase().includes(word), `guide.js mentions ${word}`);
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
  assert.deepEqual(r.funnel.map((f) => f.n), [6, 3, 2, 2, 1, 1]); // visit, product, bag, checkout, details, paid
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
await check("search words, Wardrobe moves and WhatsApp links are kept safely", () => {
  assert.equal(clean({ e: "search", p: "/", x: "  Puma   jacket ", n: 3 }).x, "Puma jacket");
  assert.equal(clean({ e: "search", p: "/", x: "call me on 98765 43210", n: 0 }).x, "call me on •••", "a number typed into search is hidden");
  assert.equal(clean({ e: "search", p: "/", x: "a" }), null);
  assert.equal(clean({ e: "search", p: "/", x: "x".repeat(90) }).x.length, 40);
  assert.equal(clean({ e: "wd", p: "/wardrobe", x: "anything typed" }), null, "only known Wardrobe moves");
  assert.deepEqual(clean({ e: "wd", p: "/wardrobe", x: "open", pr: "s1" }), { e: "wd", p: "/wardrobe", x: "open", pr: "s1" });
  const wa = clean({ e: "wa", p: "/p/s1", pr: "s1", x: "made up place", note: "Hi Vibe X, I paid for order VX-1234. My number is 9876543210" });
  assert.equal(wa.x, undefined); assert.match(wa.note, /VX-1234/); assert.doesNotMatch(wa.note, /9876543210/);
  assert.deepEqual(clean({ e: "wardrobe_teaser", p: "/" }), { e: "wardrobe_teaser", p: "/" });
});
await check("every product on the website is in the report, looked at or not", () => {
  const t = Date.parse("2026-11-11T06:00:00Z"), ev = (s, e, x = {}) => ({ t: t + (x.dt || 0), v: s, s, e, p: "/", ...x }), list = [];
  for (let i = 0; i < 30; i++) list.push(ev(`v${i}`, "page", { dev: "Phone", br: "Chrome", nw: 1 }), ev(`v${i}`, "card", { pr: "j1", n: 2000 }), ev(`v${i}`, "page", { p: "/p/j1", pr: "j1", dt: 1000 }));
  list.push(ev("v0", "bag_add", { p: "/p/j1", pr: "j1", dt: 2000 }), ev("v1", "card", { pr: "f1", n: 900 }), ev("v2", "page", { p: "/p/old", pr: "old", dt: 3000 }));
  const catalog = [{ id: "j1", name: "Jacket", category: "Clothing", price: 9100, stock: 1 }, { id: "f1", name: "Zara Gold · LOT 11", category: "Fragrances" }, { id: "f2", name: "Zara Gold · LOT 12", category: "Fragrances" }, ...[3, 4, 5].map((i) => ({ id: `f${i}`, name: `Perfume ${i}`, category: "Fragrances" }))];
  const d = summarise(list, { from: "2026-11-11", to: "2026-11-11", catalog, name: (id) => ({ old: "Sold jacket" }[id] || id) });
  assert.deepEqual(d.shelf, { listed: 6, opened: 1, never: 5, unseen: 4, sold: 0, gone: 1 });
  assert.equal(d.products.length, 7);
  const f2 = d.products.find((p) => p.id === "f2");
  assert.deepEqual([f2.name, f2.listed, f2.views, f2.seen], ["Zara Gold · LOT 12", true, 0, 0]);
  assert.equal(d.products.find((p) => p.id === "old").listed, false, "a piece that's gone keeps its history, marked as gone");
  assert.deepEqual(d.categories.map((c) => [c.key, c.products, c.opened, c.never, c.views, c.bag]), [["Clothing", 1, 1, 0, 30, 1], ["Fragrances", 5, 0, 5, 0, 0]]);
  assert.ok(d.findings.some((f) => /5 of the 6 products on the website were never opened/.test(f.title)));
});
await check("footfall for the newer pages, searches, and moves to WhatsApp", () => {
  const t = Date.parse("2026-11-11T06:00:00Z"), ev = (s, e, x = {}) => ({ t: t + (x.dt || 0), v: s, s, e, p: "/", ...x }), start = (s) => ev(s, "page", { dev: "Phone", br: "Chrome", nw: 1 });
  const d = summarise([
    start("a"), ev("a", "wardrobe_teaser", { dt: 500 }), ev("a", "page", { p: "/wardrobe", dt: 1000 }), ev("a", "wd", { p: "/wardrobe", x: "open", pr: "j1", dt: 2000 }), ev("a", "beat", { p: "/wardrobe", n: 9000, dt: 3000 }), ev("a", "wd", { p: "/wardrobe", x: "order", pr: "j1", dt: 3500 }),
    ev("a", "page", { p: "/p/j1", pr: "j1", dt: 4000 }), ev("a", "bag_add", { p: "/p/j1", pr: "j1", dt: 5000 }), ev("a", "page", { p: "/bag", dt: 6000 }), ev("a", "bag_view", { p: "/bag", n: 9100, dt: 6100 }),
    start("b"), ev("b", "search", { x: "Crocs", n: 0 }), ev("b", "wa", { x: "search", note: "Hi Vibe X! Do you have Crocs?", dt: 900 }), ev("b", "page", { p: "/account", dt: 2000 }), ev("b", "page", { p: "/returns", dt: 3000 }),
    start("c"), ev("c", "search", { x: "crocs", n: 0 }), ev("c", "search", { x: "puma", n: 4, dt: 100 }), ev("c", "page", { p: "/p/j1", pr: "j1", dt: 200 }), ev("c", "wa", { p: "/p/j1", pr: "j1", x: "photos", note: "Hi Vibe X, can you send me real photos of Jacket? (LOT 7)", dt: 300 }),
    start("old"), ev("old", "tap", { x: "top: WhatsApp us" }), // a visit stored before WhatsApp moves were counted
  ], { from: "2026-11-11", to: "2026-11-11", name: () => "Jacket" });
  const foot = Object.fromEntries(d.footfall.map((f) => [f.key, f]));
  assert.deepEqual(Object.keys(foot), ["home", "product", "wardrobe", "bag", "account", "policy"]);
  assert.deepEqual([foot.wardrobe.visits, foot.wardrobe.medianTime, foot.bag.visits, foot.account.people, foot.policy.exits, foot.home.lands], [1, 9000, 1, 1, 1, 4]);
  assert.equal(foot.wardrobe.trend.reduce((a, b) => a + b, 0), 1);
  const feat = Object.fromEntries(d.features.map((f) => [f.key, f.people]));
  assert.deepEqual(feat, { search: 2, bag_add: 1, bag_view: 1, account: 1, teaser: 1, wardrobe: 1, wd_open: 1, wd_order: 1, wa: 3 });
  assert.deepEqual(d.searches.map((q) => [q.key, q.people, q.none]), [["crocs", 2, 2], ["puma", 1, 0]]);
  assert.ok(d.findings.some((f) => /2 people searched "crocs" and found nothing/.test(f.title)));
  assert.deepEqual([d.chats.people, d.chats.taps, d.chats.list.length], [3, 3, 2]);
  assert.deepEqual(d.chats.list.map((c) => [c.where, c.product, c.text]), [["After a search found nothing", "", "Hi Vibe X! Do you have Crocs?"], ["Asked for real photos", "Jacket", "Hi Vibe X, can you send me real photos of Jacket? (LOT 7)"]]);
  assert.deepEqual([d.wardrobe.visits, d.wardrobe.opened, d.wardrobe.teaser, d.wardrobe.toProduct, d.wardrobe.pieces[0].n], [1, 1, 1, 1, 1]);
  assert.equal(d.acts.wa, 2, "WhatsApp moves now show under What they press");
  assert.ok(d.plan.some((p) => p.key === "pg:wardrobe" && p.label === "The Wardrobe") && d.plan.some((p) => p.key === "pg:bag"));
  const visit = d.visits.find((v) => v.steps.some((s) => s.e === "wa" && /real photos/.test(s.note || "")));
  assert.ok(visit, "the message shows in that visit's story");
});
await check("the live report lists the shop's products, and tells pieces with one name apart", async () => {
  const posted = [];
  for (const caption of ["Uspa Sweater 799 size M", "Uspa Sweater 799 size L", "Gucci Flora perfume 4999"]) {
    const r = await fetch(`${base}/api/message`, { method: "POST", headers: { "Content-Type": "application/json", "x-owner-key": "k" }, body: JSON.stringify({ text: caption, image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }) });
    posted.push(r.status);
  }
  const list = await (await fetch(`${base}/api/products`)).json();
  const d = await (await owner(`report?from=${day}&to=${day}`)).json();
  assert.equal(d.shelf.listed, list.length, `posting gave ${posted}`);
  for (const p of list) assert.ok(d.products.some((x) => x.id === p.id && x.listed), `${p.name} is in the report`);
  const twins = list.filter((p) => list.filter((q) => q.name.toLowerCase() === p.name.toLowerCase()).length > 1);
  for (const p of twins) assert.match(d.products.find((x) => x.id === p.id).name, /· LOT /);
});
await check("on the payment step, the owner sees exactly where each person is", async () => {
  assert.equal(clean({ e: "pay", p: "/p/s1", x: "typed words" }), null);
  assert.deepEqual(clean({ e: "pay", p: "/p/s1", x: "app", r: "GPay" }), { e: "pay", p: "/p/s1", x: "app", r: "GPay" });
  const v = id(5), s = id(6), send = (ev) => post({ v, s, ev: ev.map((e) => ({ p: "/p/s1", ...e })) });
  const me = async () => (await (await owner("live")).json()).people.find((p) => p.id === s.slice(0, 6));
  await send([{ e: "page", pr: "s1", nw: 1 }, { e: "checkout", pr: "s1", n: 4500 }, { e: "details", pr: "s1", n: 4500 }]);
  let p = await me();
  assert.deepEqual([p.pay, p.room, p.amount], ["Looking at the payment screen", "pay", 4500]);
  await send([{ e: "pay", x: "app", r: "PhonePe" }]);
  p = await me(); assert.deepEqual([p.pay, p.room], ["Pressed PhonePe, still on the page", "pay:app"]);
  await send([{ e: "pay", x: "away" }, { e: "beat", n: 1000 }]);
  p = await me(); assert.equal(p.pay, "In PhonePe, paying");
  const live = await (await owner("live")).json();
  assert.equal(live.rooms["pay:app"].label, "In their UPI app");
  await send([{ e: "pay", x: "back" }]);
  p = await me(); assert.deepEqual([p.pay, p.room], ["Back from their app, waiting for the shop to confirm", "pay:back"]);
  await send([{ e: "pay", x: "late" }]);
  assert.equal((await me()).room, "pay:late");
  const d = await (await owner(`report?from=${day}&to=${day}`)).json();
  const st = Object.fromEntries(d.payStages.map((x) => [x.key, x.n]));
  assert.deepEqual([st.screen, st.app, st.away, st.back, st.late, st["app:PhonePe"]], [1, 1, 1, 1, 1, 1]);
  assert.ok(d.plan.some((x) => x.key === "pay:app") && d.plan.some((x) => x.key === "pay:back"));
});
await check("someone paying in their UPI app stays on the live floor while the page is in the background", () => {
  let t = 1e12; const createAnalytics = require("../lib/analytics.js");
  const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-payaway-")), a = createAnalytics({ STORE, now: () => t });
  const go = (s, ev) => a.ingest({ v: s, s, ev: ev.map((e) => ({ p: "/p/s1", ...e })) }, { ua: PHONE });
  go(id(1), [{ e: "page", nw: 1 }, { e: "checkout", n: 999 }, { e: "details" }, { e: "pay", x: "app", r: "GPay" }, { e: "pay", x: "away" }]);
  go(id(2), [{ e: "page", nw: 1 }]);
  t += 3 * 60e3;
  const l = a.liveNow();
  assert.deepEqual(l.people.map((p) => p.pay), ["In GPay, paying"], "the browser has gone quiet, the payer is still shown");
  t += 4 * 60e3;
  assert.equal(a.liveNow().active, 0, "after the payment window they're gone");
  a.close(); fs.rmSync(STORE, { recursive: true, force: true });
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

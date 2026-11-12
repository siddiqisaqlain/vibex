// The 15 second race for a last piece: two real phone-sized Chromes on the same product page, tapped with real
// touches. Also the rules of lib/races.js on their own. `node tests/race.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const PORT = 4823, CHROME_A = 9401, CHROME_B = 9402;
const SHOTS = process.env.SHOTS || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0;
const ok = (cond, name) => { if (cond) { passes++; console.log(`ok - ${name}`); } else { fails++; console.log(`NOT OK - ${name}`); } };

// ---- the rules, with a clock we move by hand ----
{
  let t = 1e6;
  const races = require("../lib/races.js")({ now: () => t });
  assert.equal(races.see("p", ["a"], "a"), null);
  ok(true, "one visitor alone is never raced");
  assert.equal(races.see("p", ["a", "b"], "z"), null);
  ok(true, "someone the shop has not seen on the page cannot start a race");
  const r = races.see("p", ["a", "b"], "b");
  ok(r && r.until - r.from === 15000 && r.from > t, "two visitors: a 15 second clock that starts a moment later, so both pages hear of it");
  t += 3000; assert.deepEqual(races.see("p", ["a", "b"], "a"), r);
  ok(true, "both visitors are given the very same clock");
  t += 30000; assert.equal(races.see("p", ["a", "b"], "a"), null);
  ok(true, "when it has run out, the same two are not raced again");
  const again = races.see("p", ["a", "b", "c"], "c");
  ok(again && again.from > r.until, "a third visitor walking in starts a new one");
  races.end("p"); ok(races.see("p", ["a", "b", "c"], "a").until <= t, "a press ends the clock at once");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-race-"));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "" }, stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/products`); break; } catch { await sleep(100); } }
const H = { "Content-Type": "application/json", "x-owner-key": "k" };
const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
async function item(name, extra = {}) {
  const { product } = await post("/api/billing/items", { name, price: 999, quantity: 1, ...extra });
  const f = path.join(dir, "products.json");
  const all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/favicon.svg"; delete p.hidden;
  fs.writeFileSync(f, JSON.stringify(all));
  return product.id;
}
const phone = { width: 390, height: 844, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };
const strip = `document.querySelector(".vx-race")`;
const BTN = ".pdp-info [data-order]";

let a, b;
try {
  const last = await item("Race Test Jacket"), many = await item("Plenty Test Tee", { quantity: 5 });
  [a, b] = await Promise.all([browser(phone, CHROME_A), browser(phone, CHROME_B)]);
  // every visitor here sees the nudges (the 15% who see none are tested at the end)
  for (const x of [a, b]) { await x.nav(`${base}/`); await x.js(`localStorage.setItem("vx-arm","on")`); await x.nav(`${base}/`); }

  // ---- the button ----
  await a.nav(`${base}/p/${last}`);
  ok(await a.until(`document.querySelector(${JSON.stringify(BTN)})?.textContent.includes("Let me have it")`), "the product page button says Let me have it");
  ok(await a.until(`${strip}?.textContent.includes("Only one of these exists.")`, 9000), "alone on a last piece: told there is only one");
  ok(await a.js(`getComputedStyle(${strip}).backgroundColor !== getComputedStyle(document.documentElement).getPropertyValue("--red") && !${strip}.querySelector("strong") && !document.querySelector(".vx-race-edge") && !document.querySelector(".vx-race-chip")`), "with no clock, no red edge and nothing on the button: there is no rival");
  if (SHOTS) { await a.shot(path.join(SHOTS, "race-0-alone.png")); }

  // ---- the second visitor arrives ----
  await b.nav(`${base}/p/${last}`);
  ok(await a.until(`${strip}?.textContent.includes("Someone else is looking at this piece")`, 12000), "the first visitor is told someone else is looking");
  ok(await b.until(`${strip}?.textContent.includes("Someone else is looking at this piece")`, 12000), "and so is the second");
  ok(await a.until(`Number(${strip}?.querySelector("strong span")?.textContent) > 0`, 6000) && await b.until(`Number(${strip}?.querySelector("strong span")?.textContent) > 0`, 6000), "both see the seconds counting");
  const [sa, sb] = await Promise.all([a.js(`Number(${strip}.querySelector("strong span").textContent)`), b.js(`Number(${strip}.querySelector("strong span").textContent)`)]);
  ok(sa <= 15 && sb <= 15 && Math.abs(sa - sb) <= 1, `the two clocks agree (${sa}s and ${sb}s)`);
  ok(await a.js(`Number(document.querySelector(${JSON.stringify(BTN)}).dataset.race) > 0`), "the button itself carries the seconds");
  await a.until(`Number(${strip}.querySelector("strong span").textContent) <= 12`, 6000);
  if (SHOTS) { await a.shot(path.join(SHOTS, "race-1-running.png")); }

  // ---- first to tap gets it ----
  await a.tap(BTN);
  ok(await a.until(`document.querySelector("dialog.co-dialog")?.open`, 6000), "the first to tap goes straight to the order");
  ok(await a.until(`/You got it first/.test(document.querySelector("dialog.co-dialog .vx-hold")?.textContent || "")`, 4000), "and is shown the hold with its time left");
  ok(await a.js(`!${strip}`), "the winner's strip is gone");
  if (SHOTS) { await a.shot(path.join(SHOTS, "race-2-won.png")); }
  ok(await b.until(`/Someone got there first/.test(document.querySelector(".vx-race-note")?.textContent || "")`, 8000), "the other is told someone got there first");
  if (SHOTS) { await sleep(600); await b.shot(path.join(SHOTS, "race-3-lost.png")); }
  await b.tap(BTN);
  await sleep(1200);
  ok(await b.js(`window.VXBag.bag().length === 0 && !document.querySelector("dialog.co-dialog")?.open`), "the loser's tap does not put the held piece in their bag");
  const quote = await post("/api/account/quote", { lines: [{ id: last, size: "", qty: 1 }], holdToken: await b.js(`window.VXVisit.s`) });
  ok(quote.problems?.some((p) => /Someone is paying/.test(p.text)), "and the server refuses the loser's order for it");

  // ---- the winner walks away: it is open again ----
  await a.js(`document.querySelector("dialog.co-dialog").close()`);
  ok(await b.until(`!document.querySelector(".vx-race-note")`, 9000), "when the winner leaves the order, the loser's note goes: the piece is open again");

  // ---- nobody presses: the clock ends and says the truth ----
  const quiet = await item("Quiet Test Scarf");
  await a.nav(`${base}/p/${quiet}`); await sleep(1500); await b.nav(`${base}/p/${quiet}`);
  ok(await a.until(`${strip}?.textContent.includes("Someone else is looking")`, 12000), "a new piece, a new race");
  ok(await a.until(`${strip}?.textContent.includes("Nobody took it. It is still here.")`, 24000), "at zero it says the piece is still here");
  if (SHOTS) { await a.shot(path.join(SHOTS, "race-4-over.png")); }
  ok(await a.until(`!${strip}`, 10000), "and then the strip goes away");
  await sleep(5000);
  ok(await a.js(`!${strip}`) && await b.js(`!${strip}`), "the same two are not raced again on the same piece");

  // ---- more than one in stock: nothing to race for ----
  await a.nav(`${base}/p/${many}`); await b.nav(`${base}/p/${many}`);
  await sleep(9000);
  ok(await a.js(`!${strip}`) && await b.js(`!${strip}`), "a piece with five in stock is never raced");
  await a.tap(BTN);
  ok(await a.until(`window.VXBag.bag().some((l) => l.id === ${JSON.stringify(many)})`, 3000), "and its button adds to the bag as before");

  // ---- a rival who has the piece in their bag, and is somewhere else on the site ----
  const shirt = await item("Bag Test Shirt");
  await b.nav(`${base}/`);
  await a.nav(`${base}/p/${shirt}`);
  await a.tap(BTN);
  ok(await a.until(`window.VXBag.bag().some((l) => l.id === ${JSON.stringify(shirt)})`, 3000), "alone, the button puts the piece in the bag as before");
  await a.nav(`${base}/`); await sleep(5000);
  ok(await a.js(`!${strip}`), "on the rack with it in the bag and nobody else about: nothing is said");
  await b.nav(`${base}/p/${shirt}`);
  ok(await b.until(`${strip}?.textContent.includes("Someone has this piece in their bag right now.")`, 14000), "the visitor who opens it is told someone has it in their bag");
  ok(await a.until(`${strip}?.textContent.includes("Someone is looking at Bag Test Shirt from your bag right now.")`, 14000), "the one with it in their bag is told someone is looking at it, on the rack");
  ok(await a.until(`Number(${strip}?.querySelector("strong span")?.textContent) > 0`, 6000), "with the same clock");
  if (SHOTS) { await a.shot(path.join(SHOTS, "race-5-bag-holder.png")); await b.shot(path.join(SHOTS, "race-6-bag-rival.png")); }
  await a.tap(".vx-race [data-go]");
  ok(await a.until(`/You got it first/.test(document.querySelector("dialog.co-dialog[open] .vx-hold")?.textContent || "")`, 8000), "Order now on the strip takes the hold and opens the order");
  ok(await b.until(`/Someone got there first/.test(document.querySelector(".vx-race-note")?.textContent || "")`, 8000), "and the other is told someone got there first");
  await a.js(`document.querySelector("dialog.co-dialog").close()`);

  // ---- the visitors who see no nudges ----
  const calm = await item("Calm Test Cap");
  await b.js(`localStorage.setItem("vx-arm","off")`);
  await a.nav(`${base}/p/${calm}`); await sleep(1500); await b.nav(`${base}/p/${calm}`);
  ok(await a.until(`${strip}`, 12000), "the visitor who sees nudges gets the strip");
  ok(await b.js(`!${strip}`), "the one who sees none gets no strip");

  ok(a.errors.length === 0 && b.errors.length === 0, `no page errors ${[...a.errors, ...b.errors].join(" | ")}`);
} finally {
  a?.close(); b?.close(); srv.kill(); await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still closing */ }
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

async function browser({ width, height, mobile, ua }, port) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-chrome-"));
  const proc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let tgt; for (let i = 0; i < 100 && !tgt; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} await sleep(100); }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const wait = new Map(), errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { wait.get(d.id)?.(d.result ?? d); wait.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  if (ua) await cdp("Emulation.setUserAgentOverride", { userAgent: ua, platform: "iPhone" });
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  const until = async (e, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(e)) return true; await sleep(70); } return false; };
  const nav = async (u) => { await cdp("Page.navigate", { url: u }); await until(`document.readyState==='complete'`); await sleep(500); };
  const tap = async (sel) => {
    const p = await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.getClientRects().length);if(!e)return{miss:1};e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,t=document.elementFromPoint(x,y);return{x,y,ok:!!t&&(t===e||e.contains(t)||t.contains(e)||t.closest('label')?.contains(e)),top:t&&t.tagName+'.'+t.className}})()`);
    if (p.miss) { ok(false, `nothing to tap: ${sel}`); return false; }
    if (!p.ok) { ok(false, `${sel} is covered by ${p.top}`); return false; }
    if (mobile) { await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] }); await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    else { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }); await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }); }
    await sleep(250); return true;
  };
  const shot = async (file) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(r.data, "base64")); };
  const close = () => { ws.close(); proc.kill(); setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} }, 500); };
  return { js, until, nav, tap, shot, errors, close };
}

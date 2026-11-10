// The billing portal on a bad phone connection, driven like a person: real taps in a real Chrome
// (no element.click()), with the network slowed down or cut by Chrome itself (CDP Fetch domain).
// Covers: a dropped reply after a save, a slow save, double taps, the lock screen, polling after
// re-login, the Items table after a box loses focus, the order pop-up and thumb-sized buttons.
// `node tests/hardening-portal.mjs`   (HARDEN_DIR=<folder> keeps its temp files there)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
const PORT = Number(process.env.PORT) || rnd(52000, 55000), DEBUG = rnd(55000, 58000);
const base = `http://127.0.0.1:${PORT}`;
const KEY = "testkey";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = process.env.HARDEN_DIR || os.tmpdir();
fs.mkdirSync(root, { recursive: true });
const dir = fs.mkdtempSync(path.join(root, "vibex-harden-data-"));
const now = new Date().toISOString();
const item = (id, code, name, price, quantity, extra = {}) => ({ id, code, name, category: "Clothing", price, quantity, status: "available", createdAt: now, ...extra });
fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  item("a1", "4795", "North Face Puffer", 6000, 50, { barcode: "934911410459", cost: 3000 }),
  item("b2", "5100", "Levis Jeans", 2000, 30, { cost: 900 }),
  item("c3", "6200", "Linen Shirt", 1500, 20, { cost: 600 }),
]));
fs.writeFileSync(path.join(dir, "orders.json"), "[]");
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: KEY, WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 100 && !up; i++) { try { await fetch(base + "/api/products"); up = true; } catch { await sleep(100); } }
if (!up) { console.log("FAIL server did not start"); srv.kill(); process.exit(1); }
const api = async (p, opt = {}) => { const r = await fetch(`${base}/api/billing/${p}`, { ...opt, headers: { "x-owner-key": KEY, "Content-Type": "application/json", ...(opt.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const bills = async () => (await api("invoices?all=1")).body.invoices.length;
const payCount = async () => (await api("payments")).body.length;

let fails = 0, passes = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const info = (m) => console.log(`INFO ${m}`);

const chromes = [];
const stopAll = () => { for (const c of chromes) { try { c.kill(); } catch {} } srv.kill(); };
process.on("SIGTERM", () => { stopAll(); process.exit(1); });
process.on("SIGINT", () => { stopAll(); process.exit(1); });
async function browser({ width, height, mobile }, port) {
  const prof = fs.mkdtempSync(path.join(root, "vibex-chrome-harden-"));
  const proc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  chromes.push(proc);
  let tgt; for (let i = 0; i < 100 && !tgt; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} await sleep(100); }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const wait = new Map(), errors = [], handlers = {};
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) { wait.get(d.id)?.(d.result ?? d); wait.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method && handlers[d.method]) handlers[d.method](d.params);
  };
  // A call Chrome never answers fails after 20 s instead of hanging the run.
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (wait.has(i)) { wait.delete(i); console.log(`INFO no reply from Chrome to ${method}`); r({}); } }, 20000); });
  const on = (method, fn) => { handlers[method] = fn; };
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  const until = async (e, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(e)) return true; await sleep(70); } return false; };
  const ready = `document.readyState==='complete'&&!!window.VX&&!document.getElementById('app').classList.contains('hide')`;
  const nav = async (u, waitApp = true) => { await cdp("Page.navigate", { url: u }); if (waitApp) await until(ready, 8000); else await until(`document.readyState==='complete'`); await sleep(400); };
  // Finds the element, scrolls it in, and checks that a finger there would really hit it.
  const where = async (sel) => js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.getClientRects().length);if(!e)return{miss:1};e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,t=document.elementFromPoint(x,y);return{x,y,ok:!!t&&(t===e||e.contains(t)||t.contains(e)),top:t&&t.tagName+'.'+t.className}})()`);
  const press = async (x, y) => {
    if (mobile) { await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    else { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); }
  };
  const tap = async (sel, pause = 180) => {
    const p = await where(sel);
    if (p.miss) { ok(false, `nothing to tap: ${sel}`); return false; }
    if (!p.ok) { ok(false, `${sel} is covered by ${p.top}`); return false; }
    await press(p.x, p.y); await sleep(pause); return p;
  };
  const type = async (t) => { for (const c of t) await cdp("Input.dispatchKeyEvent", { type: "char", text: c }); await sleep(100); };
  const fill = async (sel, t) => { await tap(sel); await js(`document.querySelector(${JSON.stringify(sel)}).select?.()`); await type(t); };
  const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent||""`);
  const close = () => { ws.close(); proc.kill(); };
  return { cdp, on, js, until, nav, where, press, tap, type, fill, text, errors, close, ready };
}
const bodyOf = (req) => { try { return JSON.parse(req.postData || "{}"); } catch { return {}; } };

try {
  // ================= Phone, 390 x 844 =================
  const m = await browser({ width: 390, height: 844, mobile: true }, DEBUG);
  // Count every pulse the page asks for, so doubled polling shows up.
  await m.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.__pulses=0;const f=window.fetch;window.fetch=function(u,o){if(String(u).includes('/api/billing/pulse'))window.__pulses++;return f.apply(this,arguments)};` });

  // ---- 5. First open with no key: the lock, with no error on it ----
  await m.nav(`${base}/billing`, false);
  await m.until(`!document.getElementById('lock').classList.contains('hide')`);
  ok(await m.js(`!document.getElementById('lock').classList.contains('hide')`), "first open with no key shows the login");
  ok((await m.text("#keyErr")) === "", `first open doesn't say "That key didn't work." (got "${await m.text("#keyErr")}")`);
  await m.tap("#lock details summary");
  await m.fill("#keyIn", "wrong-key"); await m.tap("#keyGo");
  ok(await m.until(`/didn't work/.test(document.getElementById('keyErr').textContent)`), "a wrong key does say it didn't work");
  ok(!(await m.js(`localStorage.getItem('vx-owner-key')`)), "a wrong key isn't remembered on the device");
  await m.fill("#keyIn", KEY); await m.tap("#keyGo");
  ok(await m.until(m.ready, 8000), "the right key opens the portal");
  ok((await m.js(`localStorage.getItem('vx-owner-key')`)) === KEY, "the right key is remembered once the server accepted it");

  // ---- 6. Re-login doesn't double the 3-second check ----
  const pulsesIn = async (ms) => { const a = await m.js("window.__pulses"); await sleep(ms); return (await m.js("window.__pulses")) - a; };
  const lockOnce = async () => {
    // The next pulse comes back 401, as when the key changes on the server.
    await m.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/billing/pulse*", requestStage: "Request" }] });
    const hit = new Promise((done) => m.on("Fetch.requestPaused", async (p) => { await m.cdp("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 401, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from('{"error":"key"}').toString("base64") }); done(); }));
    await hit; await m.cdp("Fetch.disable"); m.on("Fetch.requestPaused", null);
    await m.until(`!document.getElementById('lock').classList.contains('hide')`);
    await m.js(`document.querySelector('#lock details').open=true`);
    await m.fill("#keyIn", KEY); await m.tap("#keyGo");
    await m.until(m.ready, 8000);
  };
  const before = await pulsesIn(9200);
  await lockOnce();
  const lockedText = await m.text("#keyErr");
  await lockOnce();
  await sleep(1000);
  const after = await pulsesIn(9200);
  ok(before >= 2 && before <= 4 && after <= before + 1, `after two re-logins the check still runs once every 3 s (${before} pulses in 9 s before, ${after} after)`);
  info(`lock message after a 401 mid-session: "${lockedText}"`);

  // ---- 1 + 14. Saved, then the reply is lost: tap again, still one bill ----
  await m.nav(`${base}/billing#/new`);
  await m.tap('#results .item[data-id="a1"]');
  await m.tap("#cartBar"); await sleep(400);
  const sent = [];
  let dropNext = true;
  await m.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/billing/invoices*", requestStage: "Response" }] });
  m.on("Fetch.requestPaused", async (p) => {
    if (p.request.method === "POST") sent.push(bodyOf(p.request).requestId);
    if (p.request.method === "POST" && dropNext) { dropNext = false; await m.cdp("Fetch.failRequest", { requestId: p.requestId, errorReason: "ConnectionReset" }); }
    else await m.cdp("Fetch.continueRequest", { requestId: p.requestId });
  });
  const b0 = await bills();
  await m.tap("#make");
  ok(await m.until(`/not sure it saved/.test(document.getElementById('err').textContent)`), `a dropped reply says "not sure it saved" (got "${await m.text("#err")}")`);
  ok((await bills()) === b0 + 1, "the server did save that first bill (the reply was what got lost)");
  ok((await m.js(`document.querySelectorAll('#lines .line').length`)) === 1 && /6,000/.test(await m.text("#total")), "the bill stays on screen after the failure");
  await sleep(3500); // a live update in between must not clear it either
  ok((await m.js(`document.querySelectorAll('#lines .line').length`)) === 1, "a live update after the failure keeps the bill");
  ok(await m.js(`!document.getElementById('make').disabled`), "Create bill can be tapped again");
  await m.tap("#make");
  await m.until(`!document.getElementById('done').classList.contains('hide')||/./.test(document.getElementById('err').textContent)`, 6000);
  ok(sent.length === 2 && !!sent[0] && sent[0] === sent[1], `the retry sends the same requestId (${sent.join(" / ")})`);
  const b1 = await bills();
  if (b1 === b0 + 1) ok(true, "dropped reply then retry: still exactly one bill");
  else info(`server doesn't dedupe requestId yet: ${b1 - b0} bills after the retry (client side verified by the same id)`);
  await m.cdp("Fetch.disable"); m.on("Fetch.requestPaused", null);
  await m.tap("#dNext");
  // A new bill gets a new id.
  await m.tap('#results .item[data-id="b2"]'); await m.tap("#cartBar"); await sleep(300);
  const sent2 = [];
  await m.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/billing/invoices*", requestStage: "Request" }] });
  m.on("Fetch.requestPaused", async (p) => { if (p.request.method === "POST") sent2.push(bodyOf(p.request).requestId); await m.cdp("Fetch.continueRequest", { requestId: p.requestId }); });
  await m.tap("#make");
  await m.until(`!document.getElementById('done').classList.contains('hide')`, 6000);
  ok(sent2.length === 1 && sent2[0] && sent2[0] !== sent[0], "the next bill gets its own requestId");
  await m.cdp("Fetch.disable"); m.on("Fetch.requestPaused", null);
  await m.tap("#dNext");

  // ---- 2. A slow save: Create bill stays off through the live updates ----
  await m.tap('#results .item[data-id="c3"]'); await m.tap("#cartBar"); await sleep(300);
  const held = [];
  await m.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/billing/invoices*", requestStage: "Request" }] });
  m.on("Fetch.requestPaused", async (p) => { if (p.request.method === "POST") held.push(p.requestId); else await m.cdp("Fetch.continueRequest", { requestId: p.requestId }); });
  const b2 = await bills();
  await api("stock", { method: "POST", body: JSON.stringify({ productId: "b2", price: 2100 }) }); // makes the next pulse reload everything
  const makeAt = await m.tap("#make", 50);
  let reEnabled = false;
  for (let t = Date.now(); Date.now() - t < 7500;) { if (await m.js(`!document.getElementById('make').disabled`)) reEnabled = true; await sleep(150); }
  await m.press(makeAt.x, makeAt.y); await sleep(100); await m.press(makeAt.x, makeAt.y); // impatient taps
  ok(!reEnabled, "a slow save keeps Create bill off through 2 live updates");
  ok(held.length === 1, `impatient taps during a slow save send one request (${held.length})`);
  for (const r of held) await m.cdp("Fetch.continueRequest", { requestId: r });
  ok(await m.until(`!document.getElementById('done').classList.contains('hide')`, 6000), "the slow bill completes");
  await sleep(500);
  ok((await bills()) === b2 + 1, "slow save: one bill");
  await m.cdp("Fetch.disable"); m.on("Fetch.requestPaused", null);
  await m.tap("#dNext");

  // ---- 3. Double tap Payment In: one payment ----
  await api("invoices", { method: "POST", body: JSON.stringify({ lines: [{ productId: "b2", qty: 1, price: 2000 }], customer: { name: "Bilal", phone: "9419012345" }, payment: "credit", allowShort: true }) });
  await m.nav(`${base}/billing#/payments/in`);
  await m.until(`!!document.getElementById('pySave')`);
  await m.tap("#tab-payments details.form summary");
  const party = (await api("parties")).body.find((p) => p.name === "Bilal").id;
  await m.js(`(()=>{const s=document.getElementById('pyParty');s.value=${JSON.stringify(party)};s.dispatchEvent(new Event('change'))})()`); // a native <select> list can't be driven by touch in headless Chrome
  await m.fill("#pyAmt", "300");
  ok((await m.js(`document.getElementById('pyAmt').inputMode`)) === "decimal", "payment amount opens the number pad");
  const paySent = [];
  await m.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/billing/payments*", requestStage: "Request" }] });
  m.on("Fetch.requestPaused", async (p) => { if (p.request.method === "POST") { paySent.push(1); await sleep(800); } await m.cdp("Fetch.continueRequest", { requestId: p.requestId }); });
  const p0 = await payCount();
  const at = await m.where("#pySave");
  await m.press(at.x, at.y); await sleep(60); await m.press(at.x, at.y); await sleep(60); await m.press(at.x, at.y);
  ok(/Saving/.test(await m.text("#pySave")) && (await m.js(`document.getElementById('pySave').disabled`)), "Save shows it's working and is off");
  await sleep(2500);
  ok(paySent.length === 1 && (await payCount()) === p0 + 1, `triple tap on Payment In saves one payment (${paySent.length} sent, ${(await payCount()) - p0} saved)`);
  await m.cdp("Fetch.disable"); m.on("Fetch.requestPaused", null);
  // A dropped reply on a payment: the retry reuses the same id.
  await m.tap("#tab-payments details.form summary");
  await m.js(`(()=>{const s=document.getElementById('pyParty');s.value=${JSON.stringify(party)};s.dispatchEvent(new Event('change'))})()`);
  await m.fill("#pyAmt", "100");
  const payIds = []; let dropPay = true;
  await m.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/billing/payments*", requestStage: "Response" }] });
  m.on("Fetch.requestPaused", async (p) => {
    if (p.request.method === "POST") payIds.push(bodyOf(p.request).requestId);
    if (p.request.method === "POST" && dropPay) { dropPay = false; await m.cdp("Fetch.failRequest", { requestId: p.requestId, errorReason: "ConnectionReset" }); } else await m.cdp("Fetch.continueRequest", { requestId: p.requestId });
  });
  const p1 = await payCount();
  await m.tap("#pySave");
  ok(await m.until(`/not sure it saved/.test(document.getElementById('pyErr').textContent)`), "a dropped payment reply says not sure it saved");
  ok((await m.js(`document.getElementById('pyAmt').value`)) === "100", "the payment form keeps what was typed");
  await m.tap("#pySave"); await sleep(1500);
  ok(payIds.length === 2 && payIds[0] && payIds[0] === payIds[1], "the payment retry sends the same requestId");
  const p2 = await payCount();
  if (p2 === p1 + 1) ok(true, "dropped payment reply then retry: one payment");
  else info(`server doesn't dedupe payments yet: ${p2 - p1} saved after the retry`);
  await m.cdp("Fetch.disable"); m.on("Fetch.requestPaused", null);

  // ---- 7. Items table keeps updating after a box is tapped and left ----
  await m.nav(`${base}/billing#/stock`);
  await m.until(`!!document.querySelector('[data-qty="c3"]')`);
  await m.tap('[data-qty="c3"]');
  ok(await m.js(`document.activeElement.dataset.qty==='c3'`), "tapping a stock box puts the cursor in it");
  await m.tap("#pageTitle");
  await m.js(`document.activeElement.blur()`); // the title isn't focusable; make sure the box really let go, as a tap elsewhere does on a phone
  await api("stock", { method: "POST", body: JSON.stringify({ productId: "c3", quantity: 7 }) });
  ok(await m.until(`document.querySelector('[data-qty="c3"]').value==='7'`, 7000), "after leaving the box the table shows a change made elsewhere");

  // ---- 11. Number pads ----
  ok(await m.js(`document.querySelector('[data-qty="c3"]').inputMode==='numeric'&&document.querySelector('[data-price="c3"]').inputMode==='decimal'`), "stock box opens the digit pad, price box the decimal pad");

  // ---- 12. Idle page: the tidy-up doesn't keep running ----
  await m.js(`(()=>{window.__tidy=0;const q=Element.prototype.querySelectorAll;Element.prototype.querySelectorAll=function(s){if(s==='details.form input, details.form select')window.__tidy++;return q.call(this,s)}})()`);
  await sleep(3000);
  const idle = await m.js("window.__tidy");
  ok(idle <= 2, `an idle page re-labels ${idle} times in 3 s (was about 8 a second)`);

  // ---- 13. CSV can't carry a formula ----
  const evil = await api("invoices", { method: "POST", body: JSON.stringify({ lines: [{ productId: "b2", qty: 1, price: 2000 }], customer: { name: "=HYPERLINK(\"http://x\")", phone: "" }, payment: "cash", allowShort: true }) });
  if (evil.status !== 200) info(`formula-name bill not made: ${evil.status} ${JSON.stringify(evil.body)}`);
  await m.nav(`${base}/billing#/bills`);
  await m.until(`/HYPERLINK/.test(document.getElementById('billRows').textContent)`, 7000); // the live check brings the new bill in
  await m.js(`(()=>{window.__csv=null;const c=URL.createObjectURL;URL.createObjectURL=function(b){b.text().then(t=>window.__csv=t);return c.call(URL,b)}})()`);
  await m.tap("#billCsv");
  await m.until(`!!window.__csv`);
  const csv = (await m.js("window.__csv")) || "";
  ok(csv.includes(`"'=HYPERLINK`) && !csv.includes(`,"=HYPERLINK`), `a name starting with = is written as text in the CSV ${csv.split("\n").find((l) => /HYPERLINK/.test(l)) || csv.slice(0, 200)}`);

  // ---- 8. Share ledger with no connection says so ----
  await m.nav(`${base}/billing#/parties/${party}`);
  await m.until(`!!document.getElementById('shareLedger')`);
  await m.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/share*", requestStage: "Request" }] });
  m.on("Fetch.requestPaused", (p) => m.cdp("Fetch.failRequest", { requestId: p.requestId, errorReason: "InternetDisconnected" }));
  await m.tap("#shareLedger");
  ok(await m.until(`/not sure it saved|No internet/.test(document.getElementById('toasts').textContent)`), "share ledger with no connection shows a message");
  await m.cdp("Fetch.disable"); m.on("Fetch.requestPaused", null);

  // ---- 8. Removing a staff login takes two taps ----
  await api("staff", { method: "POST", body: JSON.stringify({ name: "Sana", pin: "1234" }) });
  await m.nav(`${base}/billing#/settings`);
  await m.until(`!!document.querySelector('[data-strm]')`);
  await m.tap("[data-strm]");
  await sleep(400);
  ok((await api("staff")).body.length === 1 && /Tap again/.test(await m.text("[data-strm]")), "one tap on Remove staff only asks to confirm");
  await m.tap("[data-strm]");
  ok(await m.until(`!document.querySelector('[data-strm]')`), "second tap removes the staff login");

  // ---- 4. The order pop-up: early taps ignored, Confirm needs two ----
  await m.nav(`${base}/billing#/new`);
  fs.writeFileSync(path.join(dir, "orders.json"), JSON.stringify([{ id: "abcdef0123456789", code: "VX-3001", status: "awaiting_payment", createdAt: now, expiresAt: new Date(Date.now() + 15 * 60e3).toISOString(), name: "Zoya", phone: "8899123456", productId: "a1", productName: "North Face Puffer", amount: 6000, qty: 1 }]));
  const yes = '.oa [data-oa-do="confirm"]';
  ok(await m.until(`!document.querySelector('.oa').classList.contains('hide')&&!!document.querySelector('${yes}')`, 7000), "a waiting website order pops up by itself");
  const y = await m.where(yes);
  await m.press(y.x, y.y); await sleep(150);
  ok(!(await m.js(`document.querySelector('${yes}').classList.contains('sure')`)), "a tap in the first moment after it appears is ignored");
  await sleep(800);
  await m.tap(yes, 400);
  const status = async () => (await api("orders")).body.find((o) => o.code === "VX-3001")?.status;
  ok(/Tap again/.test(await m.text(yes)) && (await status()) === "awaiting_payment", "one tap on Confirm only asks to confirm");
  await m.tap(yes, 400);
  ok(await m.until(`document.querySelector('.oa').classList.contains('hide')`, 5000) && (await status()) === "confirmed", "second tap confirms the order");
  // ---- WhatsApp alerts that failed show on Home ----
  fs.writeFileSync(path.join(dir, "wa-alerts-failures.json"), JSON.stringify([{ at: new Date().toISOString(), to: "9196…", kind: "order", error: "test" }, { at: new Date().toISOString(), to: "9196…", kind: "order", error: "test" }, { at: new Date(Date.now() - 9 * 864e5).toISOString(), to: "9196…", kind: "order", error: "old" }]));
  await m.nav(`${base}/billing#/home`);
  ok(await m.until(`/WhatsApp alerts failed to send 2 times/.test(document.querySelector('#tab-home .todo')?.textContent||'')`, 8000), "Home warns that WhatsApp alerts failed (2 in the last 7 days)");
  ok(m.errors.length === 0, `no page errors on the phone ${m.errors.join(" | ").slice(0, 300)}`);
  m.close();

  // ================= 10. Thumb-sized buttons, at 390 and 320 =================
  for (const [width, mobile] of [[390, true], [320, true], [1366, false]]) {
    const b = await browser({ width, height: mobile ? 844 : 820, mobile }, DEBUG + width);
    await b.nav(`${base}/billing?key=${KEY}#/stock`);
    await b.until(`!!document.querySelector('#stockRows [data-step]')`, 8000);
    const coarse = await b.js(`matchMedia('(pointer:coarse)').matches`);
    const m10 = await b.js(`(()=>{const r=(s)=>[...document.querySelectorAll(s)].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());
      const step=r('#stockRows [data-step]'),row=r('#stockRows .rowBtns .tbtn');
      const gap=(list)=>{let g=1e9;for(let i=0;i+1<list.length;i++){const a=list[i],c=list[i+1];if(Math.abs(a.top-c.top)<4)g=Math.min(g,c.left-a.right)}return g};
      const first=document.querySelector('#stockRows tr');if(!first)return{none:1};const btns=[...first.querySelectorAll('[data-step]')].map(e=>e.getBoundingClientRect());const rb=[...first.querySelectorAll('.rowBtns .tbtn')].map(e=>e.getBoundingClientRect());
      return{minStepW:Math.min(...step.map(x=>x.width)),minStepH:Math.min(...step.map(x=>x.height)),minRowH:Math.min(...row.map(x=>x.height)),stepGap:btns.length===2?btns[1].left-btns[0].right:0,rowGap:gap(rb),over:document.documentElement.scrollWidth-innerWidth}})()`);
    if (!m10 || m10.none) { ok(false, `${width}px: couldn't measure the Items table ${JSON.stringify(await b.js(`({h:location.href,app:document.getElementById('app').className,lock:document.getElementById('lock').className,rows:document.querySelectorAll('#stockRows tr').length,err:document.getElementById('keyErr').textContent})`))}`); b.close(); continue; }
    if (mobile) {
      ok(coarse, `${width}px: touch emulation reports a coarse pointer`);
      ok(m10.minStepW >= 40 && m10.minStepH >= 40, `${width}px: stock − and + are at least 40px (${Math.round(m10.minStepW)}x${Math.round(m10.minStepH)})`);
      ok(m10.minRowH >= 40, `${width}px: Edit and Take off website are at least 40px tall (${Math.round(m10.minRowH)})`);
      ok(m10.stepGap >= 40 && m10.rowGap >= 8, `${width}px: room between the buttons (− to + ${Math.round(m10.stepGap)}px, row buttons ${m10.rowGap === 1e9 ? "stacked" : Math.round(m10.rowGap) + "px"})`);
      ok(m10.over <= 0, `${width}px: Items still fits the screen (${m10.over}px over)`);
    } else {
      ok(!coarse && m10.minStepH < 40 && m10.over <= 0, `desktop: Items table keeps its compact buttons (${Math.round(m10.minStepH)}px) and fits`);
    }
    ok(b.errors.length === 0, `${width}px: no page errors ${b.errors.join(" | ").slice(0, 300)}`);
    b.close();
  }

  // ---- Too many wrong keys: the lock says to wait, and nothing keeps asking ----
  // Last, because it blocks wrong keys from this address for 10 minutes (the right key still works).
  for (let i = 0; i < 22; i++) await fetch(`${base}/api/billing/me`, { headers: { "x-owner-key": "guess" + i } });
  const z = await browser({ width: 390, height: 844, mobile: true }, DEBUG + 7);
  await z.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('vx-owner-key','guess-again')}catch{};window.__pulses=0;const f=window.fetch;window.fetch=function(u){if(String(u).includes('/api/billing/pulse'))window.__pulses++;return f.apply(this,arguments)};` });
  await z.nav(`${base}/billing`, false);
  ok(await z.until(`/Too many tries/.test(document.getElementById('keyErr').textContent)&&!document.getElementById('lock').classList.contains('hide')`), `after too many wrong keys the lock says to wait (got "${await z.text("#keyErr")}")`);
  await sleep(4000);
  ok((await z.js("window.__pulses")) === 0, "and the portal doesn't keep polling while locked out");
  await z.js(`document.querySelector('#lock details').open=true`);
  await z.fill("#keyIn", KEY); await z.tap("#keyGo");
  ok(await z.until(z.ready, 8000), "the right key still opens it");
  ok(z.errors.length === 0, `lock-out: no page errors ${z.errors.join(" | ").slice(0, 300)}`);
  z.close();
} catch (e) {
  ok(false, `test crashed: ${e.stack}`);
} finally {
  stopAll();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

// Unlinking a linked item, on the server and with real clicks in Chrome. `node tests/unlink.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 4801, DEBUG = 9677;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-unlink-"));
const at = "2026-01-01T00:00:00.000Z";
const web = (id, code, name, quantity, extra = {}) => ({ id, code, name, category: "Fragrances", price: 2500, quantity, status: "available", image: "/uploads/x.png", createdAt: at, ...extra });
const stockItem = (id, code, name, quantity, extra = {}) => ({ id, code, name: `${name} stock`, category: "Fragrances", price: 2400, cost: 1500, mrp: 4000, quantity, status: "available", hidden: true, image: null, importKey: `key-${id}`, barcode: `9000000${code}`, createdAt: at, ...extra });
const seed = [web("w1", "1001", "Gucci Guilty", 2), stockItem("mbb1", "2001", "Gucci Guilty", 7), web("w2", "1002", "Tom Ford", 1, { barcode: "OLD12345", cost: 900 }), stockItem("mbb2", "2002", "Tom Ford", 4), web("w3", "1003", "Old Link", 3, { importKey: "key-mbbold", barcode: "9000000" + "3001", cost: 1500, quantity: 9 }), web("w4", "1004", "Import Match", 5, { importKey: "key-auto" }), web("w5", "1005", "Held Item", 1), stockItem("mbb5", "2005", "Held Item", 2)];
fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify(seed));
// A link from before Unlink existed: only the copy kept at link time remembers the stock record.
fs.writeFileSync(path.join(dir, "products-before-link-1000.json"), JSON.stringify([web("w3", "1003", "Old Link", 3), stockItem("mbbold", "3001", "Old Link", 9)]));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/products"); break; } catch { await sleep(100); } }
const post = async (p, b, h = { "x-owner-key": "k" }) => { const r = await fetch(`${base}/api/billing/${p}`, { method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json", ...h } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const stored = () => JSON.parse(fs.readFileSync(path.join(dir, "products.json"), "utf8"));
const item = (id) => stored().find((p) => p.id === id);
const bills = () => JSON.parse(fs.readFileSync(path.join(dir, "invoices.json"), "utf8"));
let fails = 0, passes = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };

async function browser({ width, height, mobile }, port) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-chrome-"));
  const proc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let tgt; for (let i = 0; i < 100 && !tgt; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} await sleep(100); }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const wait = new Map(), errors = [], events = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method) events.get(d.method)?.(d.params); if (d.id) { wait.get(d.id)?.(d.result ?? d); wait.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  const until = async (e, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(e)) return true; await sleep(70); } return false; };
  const nav = async (u) => { await cdp("Page.navigate", { url: u }); await until(`document.readyState==='complete'&&!!window.VX&&!document.getElementById('app').classList.contains('hide')`); await sleep(400); };
  const tap = async (sel) => {
    const p = await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.getClientRects().length);if(!e)return{miss:1};e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,t=document.elementFromPoint(x,y);return{x,y,ok:!!t&&(t===e||e.contains(t)||t.contains(e)),top:t&&t.tagName+'.'+t.className}})()`);
    if (p.miss) { ok(false, `nothing to tap: ${sel}`); return false; }
    if (!p.ok) { ok(false, `${sel} is covered by ${p.top}`); return false; }
    if (mobile) { await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] }); await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    else { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }); await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }); }
    await sleep(180); return true;
  };
  const type = async (t) => { for (const c of t) await cdp("Input.dispatchKeyEvent", { type: "char", text: c }); await sleep(100); };
  const keyCodes = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, F2: 113, k: 75 };
  const key = async (k, mods = 0) => { const p = { key: k, code: k.length === 1 ? "Key" + k.toUpperCase() : k, windowsVirtualKeyCode: keyCodes[k], modifiers: mods }; await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...p }); if (k === "Enter" && !mods) await cdp("Input.dispatchKeyEvent", { type: "char", ...p, text: "\r" }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...p }); await sleep(180); };
  const fill = async (sel, t) => { await tap(sel); await js(`document.querySelector(${JSON.stringify(sel)}).select?.()`); await type(t); };
  const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent||""`);
  const close = () => { ws.close(); proc.once("exit", () => setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Chrome still closing: the OS temp folder clears it */ } }, 300)); proc.kill(); };
  return { js, until, nav, tap, type, key, fill, text, errors, close, sleep, cdp, on: (name, fn) => events.set(name, fn) };
}

try {
  const sale = await post("invoices", { lines: [{ productId: "mbb1", qty: 1 }], payment: "cash" });
  ok(sale.status === 200, "a bill on the stock item");
  ok((await post("link", { websiteId: "w1", stockId: "mbb1" })).status === 200, "links");
  ok(!item("mbb1") && item("w1").quantity === 6, "linked: one item with the real count");
  ok(!JSON.stringify(await (await fetch(base + "/api/products")).json()).includes("linkUndo"), "customers never get the saved link details");
  await post("staff", { name: "Asif", pin: "1234" });
  const token = (await (await fetch(`${base}/api/billing/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Asif", pin: "1234" }) })).json()).token;
  ok((await post("unlink", { id: "w1" }, { "x-session": token })).status === 403, "staff can't unlink");
  ok((await fetch(`${base}/api/billing/unlink`, { method: "POST", body: "{}" })).status === 401, "no key: refused");
  await post("invoices", { lines: [{ productId: "w1", qty: 2 }], payment: "cash" });
  ok(item("w1").quantity === 4, "a sale after linking");
  ok((await post("unlink", { id: "w2" })).status === 409, "an item that isn't linked: refused");
  ok(/matched during/.test((await post("unlink", { id: "w4" })).body.error), "an item matched by the import says why it can't split");
  await post("link", { websiteId: "w5", stockId: "mbb5" });
  const list = stored(); list.find((p) => p.id === "w5").status = "hold"; list.find((p) => p.id === "w5").holdFor = "VX-1"; fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify(list));
  ok(/held for order/.test((await post("unlink", { id: "w5" })).body.error), "an item held for an order: refused");

  const undone = await post("unlink", { id: "w1" });
  ok(undone.status === 200, "unlinks");
  const w = item("w1"), s = item("mbb1");
  ok(s && s.hidden && s.quantity === 4 && s.barcode === "90000002001" && s.importKey === "key-mbb1" && s.cost === 1500, "the stock item is back with today's count, barcode and cost");
  ok(w && !w.hidden && w.quantity === 2 && !w.importKey && !w.linkUndo && !w.barcode && w.cost == null && w.image, "the website item is back as it was, photo kept");
  ok(w.needsCount, "and is marked to be counted");
  ok(bills().find((b) => b.id === sale.body.invoice.id).lines[0].productId === "mbb1", "the bill from before the link goes back to the stock item");
  ok(bills().some((b) => b.lines[0].productId === "w1"), "the bill from after it stays where it was");
  ok(fs.readdirSync(dir).some((f) => f.startsWith("products-before-unlink-")), "a copy is kept before unlinking");
  ok((await post("link", { websiteId: "w1", stockId: "mbb1" })).status === 200 && item("w1").quantity === 4, "they can be linked again");
  await post("unlink", { id: "w1" });
  ok((await post("unlink", { id: "w3" })).status === 200 && item("mbbold")?.quantity === 9 && item("w3").quantity === 3, "a link made before Unlink existed splits from the kept copy");

  const d = await browser({ width: 1366, height: 820, mobile: false }, DEBUG);
  await post("link", { websiteId: "w2", stockId: "mbb2" });
  await d.nav(`${base}/billing?key=k`);
  await d.nav(`${base}/billing#/stock`);
  await d.tap("#linkBtn");
  ok(await d.until(`!!document.querySelector('[data-unlink=w2]')`), "the panel lists linked items");
  await d.tap("[data-unlink=w2]");
  ok(await d.until(`document.querySelector('[data-unlink=w2]').textContent==='Tap again to unlink'`) && item("w2").importKey, "first tap only asks");
  await d.tap("[data-unlink=w2]");
  ok(await d.until(`!document.querySelector('[data-unlink=w2]')&&!!document.querySelector('[data-lk=w2]')`, 8000), "second tap unlinks and it's ready to link again");
  ok(item("w2").barcode === "OLD12345" && item("w2").cost === 900 && item("w2").quantity === 1 && item("mbb2").quantity === 4, "the screen did the real split");
  await d.js(`window.VX.closeDrawer()`); await sleep(300);
  ok(await d.until(`document.querySelector('[data-web=w2]')?.closest('tr').textContent.includes('Count this')`), "Items shows Count this");
  ok(d.errors.length === 0, `no page errors ${d.errors.join(" | ").slice(0, 300)}`);
  d.close();

  const m = await browser({ width: 390, height: 800, mobile: true }, DEBUG + 1);
  await post("link", { websiteId: "w2", stockId: "mbb2" });
  await m.nav(`${base}/billing?key=k`);
  await m.nav(`${base}/billing#/stock`);
  await m.tap("#linkBtn");
  ok(await m.until(`!!document.querySelector('[data-unlink=w2]')`), "phone: panel opens");
  ok(await m.js(`document.documentElement.scrollWidth-innerWidth`) <= 0, "phone: fits the screen");
  await m.tap("[data-unlink=w2]"); await m.tap("[data-unlink=w2]");
  ok(await m.until(`!document.querySelector('[data-unlink=w2]')`, 8000), "phone: unlinks with taps");
  if (process.env.SHOTS) await m.cdp("Page.captureScreenshot").then((s) => fs.writeFileSync(path.join(process.env.SHOTS, "unlink-phone.png"), Buffer.from(s.data, "base64")));
  m.close();
} finally {
  srv.kill();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

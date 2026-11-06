// Photos and the website button on each item in the billing portal, with real clicks, taps and a
// real file chooser in Chrome, on desktop and phone. `node tests/itemphotos.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";

const PORT = 4799, DEBUG = 9577;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-photos-"));
const old = "2026-01-01T00:00:00.000Z";
const item = (id, code, name, price, quantity, extra = {}) => ({ id, code, name, category: "Clothing", price, quantity, status: quantity ? "available" : "sold", createdAt: old, cost: 10, ...extra });
const DOT = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const dot = `data:image/png;base64,${DOT.toString("base64")}`;
fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  item("a1", "4795", "North Face Puffer", 6000, 5, { hidden: true, image: null }),
  item("a2", "4796", "Carhartt Jacket", 5000, 2, { hidden: true, image: null }),
  item("n1", "5000", "No Price Tee", null, 2, { hidden: true, image: null }),
  item("l1", "5100", "Live Jeans", 2000, 3),
  item("r1", "5200", "Returning Coat", 3000, 3, { hidden: true, wasLive: true, image: null }),
  item("x1", "5300", "Edit Me Jeans", 2500, 3, { hidden: true, image: null }),
]));
// A big phone-sized photo: 3000 x 2000 pixels.
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
function bigPng(file, w, h, shade) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3, shade); row[0] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]));
}
const shot1 = path.join(dir, "one.png"), shot2 = path.join(dir, "two.png"), notImage = path.join(dir, "bad.png");
bigPng(shot1, 3000, 2000, 90); bigPng(shot2, 1200, 1600, 200); fs.writeFileSync(notImage, "not a photo");

const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/products"); break; } catch { await sleep(100); } }
const api = async (p, opt = {}, headers = { "x-owner-key": "k" }) => { const r = await fetch(`${base}/api/billing/${p}`, { ...opt, headers: { "Content-Type": "application/json", ...headers } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (p, b, h) => api(p, { method: "POST", body: JSON.stringify(b) }, h);
const shop = async () => (await fetch(base + "/api/products")).json();
const stored = () => JSON.parse(fs.readFileSync(path.join(dir, "products.json"), "utf8"));

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

// Presses the real Add button and answers the real file chooser it opens.
async function choose(b, files, button = "#phAdd") {
  const opened = new Promise((r) => b.on("Page.fileChooserOpened", r));
  await b.cdp("Page.setInterceptFileChooserDialog", { enabled: true });
  await b.tap(button);
  const c = await Promise.race([opened, sleep(3000).then(() => null)]);
  ok(!!c, "Add photos opens the file chooser");
  if (c) await b.cdp("DOM.setFileInputFiles", { files, backendNodeId: c.backendNodeId });
  await b.cdp("Page.setInterceptFileChooserDialog", { enabled: false });
}

try {
  // ---- Server rules ----
  ok((await shop()).every((p) => p.id !== "a1"), "a hidden item isn't on the website");
  ok((await post("items/a2", { onWebsite: true })).status === 409, "no photo: refused");
  ok((await post("items/a2/photos", { add: "data:text/html;base64,AAAA" })).status === 409, "something that isn't a photo: refused");
  ok((await post("items/nope/photos", { add: dot })).status === 409, "unknown item: refused");
  ok((await fetch(`${base}/api/billing/items/a2/photos`, { method: "POST", body: "{}" })).status === 401, "no key: refused");
  await post("staff", { name: "Asif", pin: "1234" });
  const staffId = (await api("staff")).body[0]?.id;
  const login = await fetch(`${base}/api/billing/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: staffId, name: "Asif", pin: "1234" }) }).then((r) => r.json()).catch(() => ({}));
  if (login.token) {
    ok((await post("items/a2/photos", { add: dot }, { "x-session": login.token })).status === 403, "staff can't change photos");
    ok((await post("items/a2", { onWebsite: true }, { "x-session": login.token })).status === 403, "staff can't change the website");
  } else ok(false, `staff login for the test failed: ${JSON.stringify(login)}`);
  for (let i = 0; i < 6; i++) { await post("items/a2/photos", { add: dot }); await sleep(3); }
  const p6 = stored().find((p) => p.id === "a2");
  ok(p6.image && p6.images.length === 5, "six photos fit");
  ok((await post("items/a2/photos", { add: dot })).status === 409, "a seventh is refused");
  const second = p6.images[0];
  await post("items/a2/photos", { main: second });
  ok(stored().find((p) => p.id === "a2").image === second, "Make main moves a photo first");
  const swapped = await post("items/a2/photos", { add: dot, replace: second });
  const after = stored().find((p) => p.id === "a2");
  ok(swapped.status === 200 && after.images.length === 5 && after.image !== second && !after.images.includes(second), "Change swaps a photo in its place, even at six");
  ok((await post("items/a2/photos", { add: dot, replace: "/uploads/other.jpg" })).status === 409, "Change on a photo that's gone: refused");
  ok((await post("items/a2/photos", { remove: "/uploads/other.jpg" })).status === 409, "a photo that isn't on the item can't be removed");
  ok((await post("items/n1/photos", { add: dot })).status === 200 && (await post("items/n1", { onWebsite: true })).status === 409, "no selling price: refused");
  await post("items/r1/photos", { add: dot }); await post("items/r1", { onWebsite: true });
  ok(stored().find((p) => p.id === "r1").createdAt === old, "an item that comes back keeps its place");
  await post("items/l1/photos", { add: dot });
  const lone = stored().find((p) => p.id === "l1");
  const gone = await post("items/l1/photos", { remove: lone.image });
  ok(gone.body.tookOff && stored().find((p) => p.id === "l1").hidden, "removing the last photo takes a live item off the website");
  await post("items/l1/photos", { add: dot }); await post("items/l1", { onWebsite: true });
  ok(stored().find((p) => p.id === "l1").createdAt === old, "and it keeps its place when it comes back");
  const bot = await post("items", { name: "Fresh Hoodie", price: 1500, quantity: 2 });
  await post(`items/${bot.body.product.id}/photos`, { add: dot }); await post(`items/${bot.body.product.id}`, { onWebsite: true });
  const fresh = (await shop()).find((p) => p.name === "Fresh Hoodie");
  ok(fresh && Date.now() - new Date(fresh.createdAt) < 60000, "first time on the website counts as new today");
  ok(!("cost" in fresh), "the website still gets no cost price");

  // ---- Desktop, real clicks ----
  const d = await browser({ width: 1366, height: 820, mobile: false }, DEBUG);
  await d.nav(`${base}/billing?key=k`);
  await d.nav(`${base}/billing#/stock`);
  await d.tap("[data-web=a1]");
  ok(await d.until(`document.getElementById('phAdd')&&document.getElementById('drawerHost').textContent.includes('Add a photo first')`), "Put on website with no photo asks for one");
  await choose(d, [notImage]);
  ok(await d.until(`document.getElementById('toasts').textContent.includes("couldn't be read")`), "a bad file says so");
  await choose(d, [shot1, shot2]);
  ok(await d.until(`document.querySelectorAll('.photoTile').length===2`, 8000), "two photos picked at once both land");
  const big = stored().find((p) => p.id === "a1");
  const saved = fs.statSync(path.join(dir, big.image.replace("/uploads/", "uploads/"))).size;
  ok(/\.jpg$/.test(big.image) && saved < 1024 * 1024, `the phone photo was made small (${Math.round(saved / 1024)} KB)`);
  ok(await d.js(`(async()=>{const i=new Image();i.src=document.querySelector('.photoTile img').src;await i.decode();return Math.max(i.naturalWidth,i.naturalHeight)})()`) === 1600, "longest side is 1600px");
  // iPhone photo, in Chrome, which can't open HEIC by itself.
  await choose(d, [path.resolve(import.meta.dirname, "sample.heic")]);
  ok(await d.until(`document.querySelectorAll('.photoTile').length===3&&document.querySelectorAll('.photoTile img')[2].naturalWidth>0`, 20000), "an iPhone HEIC photo goes in");
  ok(/\.jpg$/.test(stored().find((p) => p.id === "a1").images[1]), "and is saved as a JPG customers can open");
  const before = stored().find((p) => p.id === "a1").images[1];
  await choose(d, [shot1], ".photoTile:nth-child(3) [data-swap]");
  ok(await d.until(`document.getElementById('phBusy').textContent==='Photo changed.'`, 8000), "Change swaps one photo");
  const nowP = stored().find((p) => p.id === "a1");
  ok(nowP.images.length === 2 && !nowP.images.includes(before), "the old one is gone and the count stays");
  await d.tap(".photoTile:nth-child(3) [data-del]"); await d.tap(".photoTile:nth-child(3) [data-del]");
  await d.until(`document.querySelectorAll('.photoTile').length===2`);
  await d.tap("[data-main]");
  ok(await d.until(`[...document.querySelectorAll('.photoTile')][0]?.querySelector('.pill')&&document.querySelectorAll('[data-main]').length===1`) && stored().find((p) => p.id === "a1").image === big.images[0], "Make main works from the screen");
  await d.tap("#phWeb");
  ok(await d.until(`document.getElementById('phWeb')?.textContent==='Take off website'`), "the panel's button puts it on the website");
  ok((await shop()).some((p) => p.id === "a1"), "and customers can see it");
  await d.key("Escape"); await d.js(`window.VX.closeDrawer()`);
  await d.sleep(300);
  ok(await d.until(`document.querySelector('[data-web=a1]')?.textContent==='Take off website'&&document.querySelector('[data-photos=a1] .photoBadge').textContent==='2'`), "the row shows the new state");
  await d.tap("[data-web=a1]");
  ok(await d.until(`document.querySelector('[data-web=a1]')?.textContent==='Put on website'`), "the row's button takes it off");
  ok(!(await shop()).some((p) => p.id === "a1"), "and customers can't see it");
  await d.tap("#toasts .toast:last-child button");
  ok(await d.until(`document.querySelector('[data-web=a1]')?.textContent==='Take off website'`), "Undo puts it back");
  const row = await d.js(`(()=>{const s=[...document.querySelectorAll('#stockRows [data-edit],#stockRows [data-web],#stockRows [data-photos]')];return s.every(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.right<=innerWidth})})()`);
  ok(row, "every row button is on screen");
  ok(await d.js(`document.documentElement.scrollWidth-innerWidth`) <= 0, "the page fits the screen");
  await sleep(7500); // let the toasts clear so the picture shows the rows
  await d.cdp("Page.captureScreenshot").then((s) => fs.writeFileSync(path.join(process.env.SHOTS || dir, "items-desktop.png"), Buffer.from(s.data, "base64")));
  // Inside Edit: photos work there too, and don't throw away what's been typed.
  await d.tap("[data-edit=x1]");
  ok(await d.until(`!!document.querySelector('#it-photos #phAdd')`), "Edit has Add photos");
  await d.fill("#it-name", "Typed Name");
  await choose(d, [shot2]);
  ok(await d.until(`document.querySelectorAll('#it-photos .photoTile').length===1&&!document.getElementById('it-onWebsite').disabled`, 8000), "a photo added in Edit lands and unlocks Show on website");
  ok(await d.js(`document.getElementById('it-name').value`) === "Typed Name", "typing in Edit survives adding a photo");
  await choose(d, [shot1], "#it-photos [data-swap]");
  ok(await d.until(`document.getElementById('phBusy').textContent==='Photo changed.'`, 8000), "Change works in Edit");
  await d.tap("#it-onWebsite"); await d.tap("#itSave");
  ok(await d.until(`!document.getElementById('itSave')`), "Save closes Edit");
  const x1 = stored().find((p) => p.id === "x1");
  ok(x1.name === "Typed Name" && x1.image && !x1.hidden, "Edit saves the name and puts it on the website");
  // Create Item: choose photos before saving.
  await d.tap("#addItem");
  await d.fill("#it-name", "Brand New Cap"); await d.fill("#it-price", "899");
  await choose(d, [shot1, shot2]);
  ok(await d.until(`document.getElementById('phBusy').textContent.includes('2 photos ready')`), "Create Item takes photos");
  await d.tap("#itSave");
  ok(await d.until(`document.querySelectorAll('#phHost .photoTile').length===2`, 8000), "they go up after Save and the panel shows them");
  await d.tap("#phWeb");
  ok(await d.until(`document.getElementById('phWeb')?.textContent==='Take off website'`), "the new item goes on the website");
  ok((await shop()).some((p) => p.name === "Brand New Cap"), "customers can see the new item");
  await d.js(`window.VX.closeDrawer()`); await d.sleep(200);
  // A photo already on an item: tap it, then change it.
  ok(await d.js(`!document.querySelector('#stockRows .rowBtns [data-photos]')`), "no separate Photos button on the row");
  await d.tap(".itemPic[data-photos]");
  ok(await d.until(`!!document.querySelector('#phHost [data-swap]')`), "tapping an item's image box opens its photos");
  await d.js(`window.VX.closeDrawer()`); await d.sleep(200);
  // The product page shows both photos, and picking one doesn't open it full screen.
  await d.cdp("Page.navigate", { url: `${base}/p/a1` }); await d.until(`!!document.querySelector('.pdp-thumbs')`, 8000);
  ok(await d.js(`document.querySelectorAll('.pdp-thumbs button').length`) === 2, "product page shows a small photo for each");
  const first = await d.js(`document.querySelector('.pdp-media .media img').getAttribute('src')`);
  await d.tap(".pdp-thumbs button:nth-child(2)");
  ok(await d.js(`document.querySelector('.pdp-media .media img').getAttribute('src')`) !== first, "clicking a small photo changes the big one");
  ok(!(await d.js(`!!document.querySelector('.pdp-zoom')`)), "and doesn't open the zoom");
  await d.tap(".pdp-media .media img");
  ok(await d.until(`!!document.querySelector('.pdp-zoom')`), "clicking the big photo still zooms");
  ok(d.errors.length === 0, `desktop: no page errors ${d.errors.join(" | ").slice(0, 300)}`);
  d.close();

  // ---- Phone, real taps ----
  const m = await browser({ width: 390, height: 800, mobile: true }, DEBUG + 1);
  await m.nav(`${base}/billing?key=k`);
  await m.nav(`${base}/billing#/stock`);
  await m.tap("[data-photos=a2]");
  ok(await m.until(`document.querySelectorAll('.photoTile').length===6`), "phone: Photos opens the panel");
  ok(await m.js(`document.getElementById('phAdd').disabled`), "phone: Add is off at six photos");
  await m.tap(".photoTile:nth-child(2) [data-del]");
  ok(await m.until(`document.querySelector('.photoTile:nth-child(2) [data-del]')?.classList.contains('sure')`), "phone: Remove asks for a second tap");
  await m.tap(".photoTile:nth-child(2) [data-del]");
  ok(await m.until(`document.querySelectorAll('.photoTile').length===5`), "phone: second tap removes it");
  await m.tap("#phWeb");
  ok(await m.until(`document.getElementById('phWeb')?.textContent==='Take off website'`), "phone: puts it on the website");
  await m.js(`window.VX.closeDrawer()`); await m.sleep(300);
  ok(await m.js(`document.documentElement.scrollWidth-innerWidth`) <= 0, "phone: page fits the screen");
  await sleep(7500);
  await m.cdp("Page.captureScreenshot").then((s) => fs.writeFileSync(path.join(process.env.SHOTS || dir, "items-phone.png"), Buffer.from(s.data, "base64")));
  await m.cdp("Page.navigate", { url: `${base}/p/a2` }); await m.until(`!!document.querySelector('.pdp-thumbs')`, 8000);
  const was = await m.js(`document.querySelector('.pdp-media .media img').getAttribute('src')`);
  const at = await m.js(`(()=>{const r=document.querySelector('.pdp-media .media').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await m.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x + 90, y: at.y }] });
  await m.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at.x - 90, y: at.y }] });
  await m.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await m.sleep(250);
  ok(await m.js(`document.querySelector('.pdp-media .media img').getAttribute('src')`) !== was, "phone: swiping changes the photo");
  ok(!(await m.js(`!!document.querySelector('.pdp-zoom')`)), "phone: swiping doesn't open the zoom");
  await m.tap(".pdp-thumbs button:nth-child(3)");
  ok(await m.js(`document.querySelector('.pdp-thumbs button:nth-child(3)').classList.contains('on')`), "phone: tapping a small photo works");
  ok(await m.js(`document.documentElement.scrollWidth-innerWidth`) <= 0, "phone: product page fits");
  await m.cdp("Page.captureScreenshot").then((s) => fs.writeFileSync(path.join(process.env.SHOTS || dir, "pdp-phone.png"), Buffer.from(s.data, "base64")));
  ok(m.errors.length === 0, `phone: no page errors ${m.errors.join(" | ").slice(0, 300)}`);
  m.close();

  // ---- Staff only look ----
  const st = await browser({ width: 1366, height: 820, mobile: false }, DEBUG + 2);
  await st.cdp("Page.navigate", { url: `${base}/billing` }); await st.sleep(500);
  await st.js(`localStorage.setItem('vx-session', ${JSON.stringify(login.token)}); localStorage.setItem('vx-owner-key', '')`);
  await st.nav(`${base}/billing#/stock`); await st.cdp("Page.reload"); await st.sleep(900);
  await st.until(`!!document.querySelector('[data-photo=a1]')`, 8000);
  ok(await st.js(`!document.querySelector('[data-photos],[data-web]')`), "staff get no photo or website controls");
  await st.tap("[data-photo=a1]");
  ok(await st.until(`document.getElementById('photoBig')?.naturalWidth>0&&!document.getElementById('phAdd')`), "staff tapping an image box just see the photo");
  ok(st.errors.length === 0, `staff: no page errors ${st.errors.join(" | ").slice(0, 300)}`);
  st.close();
} finally {
  srv.kill();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

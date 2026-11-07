// Search on the home page, with real clicks, taps and keys, on a computer and a phone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 4873, DEBUG = 9681;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-search-"));
const old = new Date(Date.now() - 5 * 864e5).toISOString();
const item = (id, code, name, brand, category, subcategory, price, extra = {}) => ({ id, code, name, brand, category, subcategory, price, mrp: null, sizes: extra.sizes || "", quantity: 2, status: "available", createdAt: old, image: null, caption: name, by: "rules", ...extra });
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  item("p1", "4795", "North Face Nuptse Puffer", "The North Face", "Clothing", "Puffer", 6500, { sizes: "M · L" }),
  item("p2", "4796", "Carhartt Detroit Jacket", "Carhartt", "Clothing", "Jacket", 5200, { sizes: "L" }),
  item("p3", "9379", "Zara Tender Amber", "Zara", "Fragrances", "Perfume", 999, { sizes: "100 ml" }),
  item("p4", "9380", "Gucci Flora", "Gucci", "Fragrances", "Perfume", 4200),
  item("p5", "9381", "Zara Man Gold", "Zara", "Fragrances", "Perfume", 1199, { status: "sold", quantity: 0 }),
  item("p6", "5000", "Nike Air Max 90", "Nike", "Footwear", "Sneakers", 4800),
  ...Array.from({ length: 14 }, (_, i) => item("z" + i, String(6000 + i), `Zara Filler Scent ${i}`, "Zara", "Fragrances", "Perfume", 900 + i)),
]));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/products"); break; } catch { await sleep(100); } }

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
  const nav = async (u) => { await cdp("Page.navigate", { url: u }); await until(`document.readyState==='complete'`); await sleep(400); };
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


const names = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].map(e=>e.textContent.trim())`;
const rackNames = names("#grid .card .name");
const boxNames = names(".sr-item b");

async function home(b) {
  await b.nav(base + "/");
  await b.js(`sessionStorage.setItem("vx-intro","1")`);
  await b.nav(base + "/");
  await b.until(`document.querySelectorAll("#grid .card").length>0`);
  await b.js(`scrollTo(0,0)`); await sleep(200);
}

async function run(b, label) {
  await home(b);
  ok(await b.tap("#search-btn"), `${label}: the magnifier opens search`);
  ok(await b.js(`!document.getElementById("search").hidden && document.activeElement.id==="search-q"`), `${label}: the box is open with the cursor in it`);
  await b.type("puff");
  let got = await b.js(boxNames);
  ok(got.length === 1 && got[0] === "North Face Nuptse Puffer", `${label}: "puff" finds the puffer as you type (${got})`);
  await b.js(`document.getElementById("search-q").select()`); await b.type("perfume");
  got = await b.js(boxNames);
  ok(got.length === 6 && await b.js(`/See all 17/.test(document.querySelector(".sr-all").textContent)`), `${label}: "perfume" finds fragrances, shows 6 and offers all 17`);
  await b.js(`document.getElementById("search-q").select()`); await b.type("zara gold");
  got = await b.js(`[...document.querySelectorAll(".sr-item")].map(e=>e.textContent.replace(/\\s+/g," ").trim())`);
  ok(got.length === 1 && /Sold/.test(got[0]), `${label}: two words narrow it; a sold piece says Sold (${got})`);
  await b.js(`document.getElementById("search-q").select()`); await b.type("4796");
  ok((await b.js(boxNames))[0] === "Carhartt Detroit Jacket", `${label}: an item code finds its piece`);
  await b.js(`document.getElementById("search-q").select()`); await b.type("rolex");
  ok(await b.js(`/Nothing matches/.test(document.getElementById("search-out").textContent) && !!document.querySelector(".sr-none a[href*='wa.me']")`), `${label}: no match says so and offers WhatsApp`);
  await b.js(`document.getElementById("search-q").select()`); await b.type("jackets");
  await b.key("Enter"); await sleep(900);
  got = await b.js(rackNames);
  ok(got.length === 1 && got[0] === "Carhartt Detroit Jacket", `${label}: Enter filters the rack (${got})`);
  ok(await b.js(`document.getElementById("search").hidden`), `${label}: and the box closes`);
  ok(/“jackets”/.test(await b.text("#active")), `${label}: a chip shows the search`);
  const r = await b.js(`document.getElementById("rack").getBoundingClientRect().top`);
  ok(r < 200 && r > -400, `${label}: the page moved to the rack (${Math.round(r)})`);
  await b.tap('#active [data-clear="q"]'); await sleep(300);
  ok((await b.js(rackNames)).length > 1 && await b.js(`document.getElementById("active").hidden`), `${label}: the chip's × brings everything back`);
  // tap a result to open its page
  await b.js(`scrollTo(0,0)`); await sleep(200);
  await b.tap("#search-btn");
  ok(await b.js(`document.getElementById("search-q").value==="jackets"`), `${label}: reopening keeps the last search`);
  await b.type("gucci"); await sleep(150);
  await b.tap(".sr-item");
  ok(await b.until(`location.pathname==="/p/p4"`), `${label}: tapping a result opens its page`);
  // tapping outside closes
  await home(b);
  await b.tap("#search-btn"); await b.type("nike");
  ok(await b.js(boxNames).then((x) => x.length === 1), `${label}: reopened, typing replaces the last search`);
  await b.tap("#stats"); await sleep(250);
  ok(await b.js(`document.getElementById("search").hidden`), `${label}: a tap elsewhere closes it`);
  // the VIBEX logo opens search, and stays on the home page
  await home(b);
  await b.tap(".top .logo .lg-x"); await sleep(250);
  ok(await b.js(`!document.getElementById("search").hidden && location.pathname==="/" && !location.hash`), `${label}: tapping the logo opens search`);
  await b.tap(".top .logo .lg-x"); await sleep(120); await b.tap(".top .logo .lg-x"); await sleep(250);
  ok(await b.js(`!document.getElementById("search").hidden`), `${label}: more taps on the logo keep it open`);
  await b.type("gucci"); await sleep(150);
  ok((await b.js(boxNames))[0] === "Gucci Flora", `${label}: and you can type straight away`);
  // on a product page the logo still goes home
  await b.nav(base + "/p/p4");
  await b.tap(".logo");
  ok(await b.until(`location.pathname==="/"`), `${label}: on a product page the logo goes home`);
  ok(await b.js(`document.documentElement.scrollWidth<=innerWidth`), `${label}: page fits the screen`);
}

let d, m;
try {
  ok((await fetch(base + "/search.js")).ok, "search.js is served");
  d = await browser({ width: 1366, height: 820, mobile: false }, DEBUG);
  await run(d, "desktop");
  await home(d);
  await d.key("/"); await sleep(150);
  ok(await d.js(`!document.getElementById("search").hidden`), "desktop: / opens search");
  await d.key("Escape");
  ok(await d.js(`document.getElementById("search").hidden && document.activeElement.id==="search-btn"`), "desktop: Esc closes it");
  // a shared link
  await d.nav(base + "/?q=north%20face"); await d.until(`document.querySelectorAll("#grid .card").length>0`); await sleep(500);
  ok((await d.js(rackNames)).join() === "North Face Nuptse Puffer", "desktop: /?q= opens the shop already searched");
  // "/" typed into another box is just a character
  await home(d);
  await d.tap('[data-jump="Fragrances"]'); await sleep(200);
  ok(d.errors.length === 0, `desktop: no page errors ${d.errors.join(" | ")}`);
  d.close();

  m = await browser({ width: 390, height: 800, mobile: true }, DEBUG + 1);
  await run(m, "phone");
  await home(m);
  await m.tap("#search-btn");
  const box = await m.js(`(()=>{const r=document.getElementById("search").getBoundingClientRect();return {l:r.left,w:r.width}})()`);
  ok(box.l === 0 && box.w === 390, "phone: the box spans the screen");
  const fs16 = await m.js(`getComputedStyle(document.getElementById("search-q")).fontSize`);
  ok(fs16 === "16px", "phone: 16px text, so iPhones don't zoom in");
  ok(m.errors.length === 0, `phone: no page errors ${m.errors.join(" | ")}`);
  m.close();
} catch (e) { ok(false, "crashed: " + (e.stack || e)); d?.close(); m?.close(); }
srv.kill();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

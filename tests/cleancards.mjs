// Cards without buttons, and Add to bag opening a size sheet when no size is chosen.
// A real phone-sized Chrome, tapped with real touches. `node tests/cleancards.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 4811, CHROME = 9391;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0;
const ok = (cond, name) => { if (cond) { passes++; console.log(`ok - ${name}`); } else { fails++; console.log(`NOT OK - ${name}`); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-clean-"));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "" }, stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/products`); break; } catch { await sleep(100); } }
const H = { "Content-Type": "application/json", "x-owner-key": "k" };
const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
const get = async (p) => (await fetch(base + p, { headers: H })).json();
async function item(name, sizes, sizeStock) {
  const { product } = await post("/api/billing/items", { name, price: 999, sizes, ...(sizeStock ? { sizeStock } : {}) });
  const f = path.join(dir, "products.json");
  const all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/favicon.svg"; delete p.hidden;
  fs.writeFileSync(f, JSON.stringify(all));
  return product.id;
}

let b;
try {
  const jacket = await item("Clean Test Jacket", "M L XL", { M: 1, L: 0, XL: 5 });
  const web = (await get("/api/products")).find((p) => p.id === jacket);
  ok(web?.options?.length === 3, "the test jacket is on the site with three sizes");

  b = await browser({ width: 390, height: 844, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }, CHROME);
  const card = `article.card[data-id="${jacket}"]`;

  // ---- the rack: cards are photo, name and price ----
  await b.nav(`${base}/`); // the first visit plays the intro over the page
  await b.nav(`${base}/`);
  await b.until(`document.querySelector(${JSON.stringify(card)})`);
  ok(await b.js(`!document.querySelector(".card .actions") && !document.querySelector(".card .enq") && !document.querySelector(".card .order")`), "no card has a button under it");
  ok(await b.js(`Boolean(document.querySelector(${JSON.stringify(card + " .media .vx-quick")}))`), "the photo carries a small bag button");
  ok(await b.js(`Boolean(document.querySelector(${JSON.stringify(card + " .price b")})?.textContent.includes("999"))`), "the card still shows its name and price");
  await b.tap(`${card} .media .cover`);
  ok(await b.until(`location.pathname === "/p/${jacket}" || window.__opened`, 4000) || (await newTabOpened(b, jacket)), "a tap on the photo opens the product page");
  await b.nav(`${base}/p/${jacket}`);
  await b.until(`document.querySelector(".pdp-sizes .pill")`);
  ok(await b.js(`!document.querySelector(".pdp-sizes .pill.on")`), "no size is chosen for them");
  ok(await b.js(`document.querySelector(".pdp-info .order-now")?.textContent.includes("Add to bag")`), "the product page has Add to bag");
  await b.tap(".pdp-info .order-now");
  ok(await b.until(`document.querySelector("dialog.vx-sizes")?.open`, 3000), "Add to bag with no size opens the size sheet");
  ok((await b.js(`window.VXBag.bag().length`)) === 0, "nothing is in the bag yet");
  ok(await b.js(`(()=>{const d=document.querySelector("dialog.vx-sizes").getBoundingClientRect();return Math.abs(d.bottom-innerHeight)<2&&d.width>=innerWidth-1})()`), "on a phone the sheet sits at the bottom, full width");
  ok(await b.js(`[...document.querySelectorAll(".vx-size")].map(x=>x.dataset.size+(x.disabled?"!":"")).join(",")`) === "M,L!,XL", "every size is listed, the sold-out one can't be tapped");
  ok(await b.js(`document.querySelector('.vx-size[data-size="M"]').textContent.includes("Last one")`), "a size with one piece says Last one");
  await b.shot(path.join(os.tmpdir(), "vibex-clean-sheet.png"));
  await b.tap(`.vx-size[data-size="L"]`);
  ok(await b.js(`document.querySelector("dialog.vx-sizes").open && window.VXBag.bag().length === 0`), "a tap on the sold-out size does nothing");
  await b.tap(`.vx-size[data-size="XL"]`);
  ok(await b.until(`window.VXBag.bag().length === 1`, 3000), "a tap on a size adds it to the bag");
  ok((await b.js(`JSON.stringify(window.VXBag.bag())`)) === JSON.stringify([{ id: jacket, size: "XL", qty: 1 }]), "in the size they tapped");
  ok(await b.js(`!document.querySelector("dialog.vx-sizes").open`), "the size sheet closes");
  ok(await b.until(`document.querySelector(".vx-addbar.on") && /Added to bag/.test(document.querySelector(".vx-addbar").textContent)`, 4000), "and a small bar says it was added");
  ok(await b.js(`!document.querySelector("dialog[open]")`), "nothing covers the page: they can keep shopping");
  ok((await b.js(`document.querySelector(".pdp-sizes .pill.on")?.dataset.pick`)) === "XL", "the page now shows the size they chose");

  // A size picked on the page itself: Add to bag adds it straight away, no sheet.
  await b.tap(`.pdp-sizes .pill[data-pick="M"]`);
  await b.tap(".pdp-info .order-now");
  ok(await b.until(`window.VXBag.bag().length === 2`, 3000), "with a size already picked on the page, Add to bag adds it at once");
  ok(await b.js(`!document.querySelector("dialog.vx-sizes").open`), "and the size sheet stays shut");

  ok(b.errors.length === 0, `no page errors ${b.errors.join(" | ")}`);

} finally {
  b?.close(); srv.kill(); await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still closing */ }
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

// Product links open in a new tab (lib/newtab.js): look for it among the browser's pages.
async function newTabOpened(br, id) {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`http://127.0.0.1:${CHROME}/json`)).json();
    if (list.some((t) => t.url.endsWith(`/p/${id}`))) return true;
    await sleep(100);
  }
  return false;
}

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

// Several photos per item, end to end. WhatsApp (real webhook, fake Meta Graph API): an album asks
// "one item or separate items?", "photos 4795" adds photos to an item, the 10-photo limit. Then the
// shop in headless Chrome with real CDP touches and mouse moves (hit-tested, never element.click()):
// card photo counts, desktop hover, the product page gallery, and the portal's uploads on a bad network.
// `node tests/multiphoto.mjs`   (SHOTS=<folder> keeps the screenshots there)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";

const OWNER = "919000000007";
const SECRET = "test-secret";
const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
const PORT = rnd(20000, 29000), DEBUG = rnd(30000, 39000);
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scratch = process.env.SCRATCH || os.tmpdir();
fs.mkdirSync(scratch, { recursive: true });
const dir = fs.mkdtempSync(path.join(scratch, "data-"));
const SHOTS = process.env.SHOTS || dir;
fs.mkdirSync(SHOTS, { recursive: true });
const uploads = path.join(dir, "uploads");
fs.mkdirSync(uploads, { recursive: true });

// Real PNGs in different colours, so a test can tell which photo is showing.
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
function png(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
const COLOURS = [[200, 40, 40], [40, 140, 60], [40, 70, 200], [230, 180, 30], [120, 40, 160], [20, 160, 170], [240, 120, 20], [90, 90, 90], [160, 110, 60], [30, 30, 30]];
const photo = (name, i) => { fs.writeFileSync(path.join(uploads, name), png(400, 500, COLOURS[i % COLOURS.length])); return `/uploads/${name}`; };
const many = (id, n) => Array.from({ length: n }, (_, i) => photo(`${id}-${i}.png`, i));

const old = "2026-01-01T00:00:00.000Z";
const item = (id, code, name, price, extra = {}) => ({ id, code, name, category: "Clothing", subcategory: "Jackets", price, quantity: 3, status: "available", createdAt: old, cost: 10, sizes: "M · L", ...extra });
const g4 = many("gal", 4), p2 = many("puf", 2), f9 = many("full9", 9), f10 = many("full10", 10), b3 = many("brk", 2);
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  item("gal1", "6001", "Gallery Jacket", 4999, { image: g4[0], images: g4.slice(1), createdAt: new Date().toISOString() }),
  item("one1", "6002", "Single Tee", 999, { image: photo("one-0.png", 3) }),
  item("brk1", "6003", "Broken Photo Coat", 2999, { image: b3[0], images: ["/uploads/missing-file.png", b3[1]] }),
  item("puf1", "4795", "North Face Puffer", 6000, { image: p2[0], images: p2.slice(1) }),
  item("nin1", "4796", "Nine Photo Coat", 3000, { image: f9[0], images: f9.slice(1) }),
  item("ten1", "4797", "Ten Photo Coat", 3000, { image: f10[0], images: f10.slice(1) }),
  item("imp1", "5000", "Imported Jeans", 2000, { hidden: true, image: null }),
]));

// ---- Fake Meta Graph API ----
const PHOTO = png(60, 75, [180, 60, 60]);
const sent = [];
const graph = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    if (req.url.endsWith("/messages")) { sent.push(JSON.parse(b)); return res.end(JSON.stringify({ messages: [{ id: "wamid.x" }] })); }
    if (req.url.startsWith("/media-file")) { res.setHeader("Content-Type", "image/png"); return res.end(PHOTO); }
    if (/\/media\w+/.test(req.url)) return res.end(JSON.stringify({ url: `http://127.0.0.1:${graph.address().port}/media-file`, mime_type: "image/png" }));
    res.end("{}");
  });
});
await new Promise((r) => graph.listen(0, "127.0.0.1", r));

const srv = spawn(process.execPath, ["server.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", WA_TOKEN: "t", WA_PHONE_ID: "123", WA_APP_SECRET: SECRET,
    OWNER_WHATSAPP: OWNER, WA_ALBUM_MS: "400", DRAFT_STALE_MS: "3600000", PUBLIC_URL: "https://shop.example", WA_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, ANTHROPIC_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 80; i++) { try { await fetch(`${base}/api/products`); break; } catch { await sleep(100); } }

let fails = 0, passes = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); return c; };
const stored = () => JSON.parse(fs.readFileSync(path.join(dir, "products.json"), "utf8"));
const shop = async () => (await fetch(`${base}/api/products`)).json();
const count = (p) => [p.image, ...(p.images || [])].filter(Boolean).length;

// ---- WhatsApp helpers ----
let seq = 0;
async function webhook(messages) {
  sent.length = 0;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: messages.map((m) => ({ id: `wamid.m${++seq}`, from: OWNER, ...m })) } }] }] });
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
  for (let i = 0; i < 80 && !sent.length; i++) await sleep(50);
  await sleep(150);
  return sent.slice();
}
const one = async (messages) => { const r = await webhook(messages); if (r.length !== 1) console.log(`  (expected one reply, got ${r.length}: ${JSON.stringify(r).slice(0, 300)})`); return r[r.length - 1] || {}; };
const text = (t) => one([{ type: "text", text: { body: t } }]);
const tapButton = (title) => one([{ type: "interactive", interactive: { type: "button_reply", button_reply: { id: title, title } } }]);
const album = (n, captions = []) => one(Array.from({ length: n }, (_, i) => ({ type: "image", image: { id: `media${seq}x${i}`, caption: captions[i] || "" } })));
const body = (m) => m.interactive?.body?.text || m.text?.body || m.image?.caption || "";
const buttons = (m) => (m.interactive?.type === "button" ? m.interactive.action.buttons.map((b) => b.reply.title) : []);

// ---- Chrome over CDP ----
async function browser({ width, height, mobile }, port) {
  const prof = fs.mkdtempSync(path.join(scratch, "chrome-"));
  const proc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let tgt; for (let i = 0; i < 100 && !tgt; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} await sleep(100); }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const wait = new Map(), errors = [], events = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method) events.get(d.method)?.(d.params); if (d.id) { wait.get(d.id)?.(d.result ?? d); wait.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `try{sessionStorage.setItem("vx-intro","1")}catch{}` }); // the home page's intro is its own test
  const size = async (w, h) => cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await size(width, height);
  if (mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  const until = async (e, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(e)) return true; await sleep(70); } return false; };
  const go = async (u, ready) => { await cdp("Page.navigate", { url: u }); await until(`document.readyState==='complete'`); if (ready) await until(ready, 10000); await sleep(300); };
  // Where a real finger or mouse would land on sel: its centre, and only if nothing covers it there.
  const spot = async (sel, scroll = true) => js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.getClientRects().length);if(!e)return{miss:1};${scroll ? "e.scrollIntoView({block:'center',behavior:'instant'});" : ""}const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,t=document.elementFromPoint(x,y);return{x,y,w:r.width,ok:!!t&&(t===e||e.contains(t)||t.contains(e)),top:t&&t.tagName+'.'+t.className}})()`);
  const tap = async (sel, scroll = true) => {
    const p = await spot(sel, scroll);
    if (p.miss) { ok(false, `nothing to tap: ${sel}`); return false; }
    if (!p.ok) { ok(false, `${sel} is covered by ${p.top}`); return false; }
    if (mobile) { await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] }); await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    else { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }); await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }); }
    await sleep(200); return true;
  };
  const swipe = async (sel, dx) => {
    const p = await spot(sel, false);
    if (p.miss || !p.ok) { ok(false, `can't swipe ${sel}: ${p.top || "missing"}`); return; }
    const x0 = p.x + (dx < 0 ? 0.3 : -0.3) * p.w;
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: p.y }] });
    for (let k = 1; k <= 6; k++) { await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * k) / 6, y: p.y + k }] }); await sleep(16); }
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(450);
  };
  const key = async (k, code) => { for (const type of ["rawKeyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: code }); await sleep(200); };
  const shot = async (file, clip) => { const s = await cdp("Page.captureScreenshot", clip ? { clip: { ...clip, scale: 1 } } : {}); fs.writeFileSync(path.join(SHOTS, file), Buffer.from(s.data, "base64")); };
  const close = () => new Promise((done) => { ws.close(); proc.once("exit", () => { try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch { /* still closing */ } done(); }); proc.kill(); setTimeout(done, 3000); });
  return { js, until, go, tap, swipe, key, shot, spot, close, errors, cdp, size, on: (n, f) => events.set(n, f) };
}
// The photo actually showing in the gallery, found the way a finger would find it.
const showing = `(()=>{const g=document.querySelector('.pdp-gal');if(!g)return null;if(g.getBoundingClientRect().top<0||g.getBoundingClientRect().bottom>innerHeight)g.scrollIntoView({block:'center',behavior:'instant'});const r=g.getBoundingClientRect(),t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return t&&t.tagName==='IMG'?t.getAttribute('src'):(t&&t.className)})()`;
const homeReady = `!!document.querySelector('.card[data-id=gal1]')`;

let d, m;
try {
  // ======== WhatsApp ========
  let r = await album(4, ["Zara wool coat clothes 4999 M L"]);
  ok(/one item, all 4 photos/.test(body(r)), "an album asks: one item, all 4 photos, or separate items?");
  ok(JSON.stringify(buttons(r)) === JSON.stringify(["One item (4 photos)", "Separate items"]), `with two buttons (${buttons(r).join(" / ")})`);
  ok(buttons(r).every((b) => b.length <= 20), "button titles fit WhatsApp's 20 letters");
  ok(r.interactive?.header?.image?.link?.startsWith("https://shop.example/uploads/"), "the question shows the album's first photo");
  r = await tapButton("One item (4 photos)");
  ok(/how it will look/.test(body(r)) && /Zara wool coat/i.test(body(r)), "One item: the album's caption fills the one item");
  ok(/📷 4 photos/.test(body(r)), "the preview shows the photo count");
  r = await tapButton("✅ Post it");
  ok(/live on your website/i.test(body(r)), "Post it puts it live");
  let coat = (await shop()).find((p) => /zara wool coat/i.test(p.name));
  ok(coat && coat.image && coat.images?.length === 3, `one product with 4 photos (${coat && count(coat)})`);
  ok(coat && [coat.image, ...coat.images].every((u) => fs.existsSync(path.join(uploads, path.basename(u)))), "every photo file is on disk");
  ok(!fs.readdirSync(uploads).some((f) => f.startsWith("album-")), "the album's waiting copies are cleared");

  r = await album(3, ["Tee one clothes 999 M", "Tee two clothes 1099 L", "Tee three clothes 1199 XL"]);
  ok(/one item, all 3 photos/.test(body(r)), "another album asks again");
  r = await tapButton("Separate items");
  ok(/3 ready to post/.test(body(r)) && buttons(r).includes("✅ Post all"), "Separate items: today's batch flow (summary with Post all)");
  r = await tapButton("✅ Post all");
  const tees = (await shop()).filter((p) => /^tee (one|two|three)/i.test(p.name));
  ok(tees.length === 3 && tees.every((p) => p.image && !p.images), "3 separate products, one photo each");

  r = await text("photos 4795");
  ok(/Send the photos of “North Face Puffer” \(#4795\)/.test(body(r)) && /room for 8 more/.test(body(r)), "'photos 4795' asks for the photos and says how many fit");
  const pufMain = stored().find((p) => p.id === "puf1").image;
  r = await album(3);
  ok(/Added 3 photos to “North Face Puffer” \(now 5\)\. Main photo unchanged\./.test(body(r)), `then 3 photos are added (${body(r).slice(0, 90)})`);
  let puf = stored().find((p) => p.id === "puf1");
  ok(count(puf) === 5 && puf.image === pufMain, "stored: 5 photos, same main");
  r = await one([{ type: "image", image: { id: "mediaplus", caption: "+4795" } }]);
  ok(/Added 1 photo to “North Face Puffer” \(now 6\)/.test(body(r)), "a photo captioned '+4795' is added");
  ok(stored().find((p) => p.id === "puf1").quantity === 3, "and '+4795' as a caption didn't touch the stock");
  r = await one([{ type: "image", image: { id: "mediamain", caption: "main 4795" } }]);
  puf = stored().find((p) => p.id === "puf1");
  ok(/New main photo for “North Face Puffer” \(now 7 photos\)/.test(body(r)) && puf.image !== pufMain && puf.images.includes(pufMain), "'main 4795' with a photo makes it the main photo, the old one stays");
  r = await album(2, ["photos 4795"]);
  ok(/Added 2 photos to “North Face Puffer” \(now 9\)/.test(body(r)), "an album captioned 'photos 4795' goes straight to that item");
  r = await text("photos 4797");
  ok(/already has 10 photos, the most an item can have/.test(body(r)), "'photos' on an item with 10 is refused politely");
  r = await album(3, ["pics 4796"]);
  ok(/Added 1 photo to “Nine Photo Coat” \(now 10\)/.test(body(r)) && /2 left out: an item can have 10 photos at most/.test(body(r)), "more than fit: the first ones go in, the rest are named as left out");
  ok(count(stored().find((p) => p.id === "nin1")) === 10, "stored: exactly 10");
  r = await text("photos 9999");
  ok(/couldn't find item \*9999\*/.test(body(r)), "an unknown code says so");

  r = await album(12, ["Big album jacket clothes 2999 M"]);
  ok(/one item, all 12 photos/.test(body(r)) && /keep the first 10/.test(body(r)) && buttons(r)[0] === "One item (10 photos)", "an album of 12 says one item keeps the first 10");
  r = await tapButton("One item (10 photos)");
  ok(/kept the first 10 and left out 2/.test(body(r)) && /📷 10 photos/.test(body(r)), "One item: 10 kept, the owner is told 2 were left out");
  r = await tapButton("❌ Cancel");
  ok(/Dropped/.test(body(r)) && !fs.readdirSync(uploads).some((f) => f.startsWith("album-")), "Cancel drops it and its files");

  r = await album(3, ["5000"]);
  const jeans = (await shop()).find((p) => p.id === "imp1");
  ok(/is on your website/.test(body(r)) && /Added 2 photos to “Imported Jeans” \(now 3\)/.test(body(r)), "an album captioned with an imported item's code: it goes live, the rest join its gallery");
  ok(jeans && count(jeans) === 3, "the imported item is on the website with 3 photos");

  r = await album(2);
  r = await text("sold 6002");
  ok(/sold/i.test(body(r)) && !/one item/i.test(body(r)), "a command still works while an album waits");
  r = await text("hello");
  ok(/First, about the 2 photos/.test(body(r)), "other words while an album waits: it asks again");
  r = await text("cancel");
  ok(/Dropped the 2 photos/.test(body(r)), "'cancel' drops the waiting album");

  const api = await shop();
  ok(Array.isArray(api.find((p) => p.id === "gal1").images) && !("cost" in api[0]), "/api/products carries images[] (and still no cost)");

  // ======== Shop: phone ========
  m = await browser({ width: 390, height: 844, mobile: true }, DEBUG);
  await m.go(`${base}/`, homeReady);
  ok(await m.until(`(()=>{const b=document.querySelector('.card[data-id=gal1] .pcount');return b&&b.getClientRects().length&&b.textContent.trim()==='4'})()`), "phone: a 4-photo item's card shows a photo count of 4");
  ok(await m.js(`!document.querySelector('.card[data-id=one1] .pcount')`), "phone: a 1-photo item has no count");
  await m.js(`document.querySelector('.card[data-id=gal1]').scrollIntoView({block:'center'})`); await sleep(500);
  const cardBox = await m.js(`(()=>{const r=document.querySelector('.card[data-id=gal1]').getBoundingClientRect();return{x:Math.max(0,r.left-4)+scrollX,y:Math.max(0,r.top-4)+scrollY,width:Math.min(innerWidth,r.width+8),height:r.height+8}})()`);
  await m.shot("phone-card.png", cardBox);
  ok(await m.js(`!document.querySelector('.alt-shot')`), "phone: no second photo is fetched for cards");
  await m.tap(".card[data-id=gal1] .cover");
  ok(await m.until(`location.pathname==='/p/gal1'&&!!document.querySelector('.pdp-gal')`, 8000), "phone: tapping the card opens the product page with its gallery");
  await sleep(500);
  ok(await m.js(`document.querySelector('.pdp-count').textContent`) === "1/4" && await m.js(`document.querySelectorAll('.pdp-dots i').length`) === 4, "phone: counter 1/4 and 4 dots");
  ok(await m.js(`getComputedStyle(document.querySelector('.pdp-thumbs')).display==='none'`), "phone: dots instead of small photos");
  ok(await m.js(showing) === g4[0], "phone: the main photo shows first");
  ok(await m.js(`!document.querySelector('.pdp-real')`), "phone: 'real photos on WhatsApp' is hidden when there are several photos");
  ok(await m.js(`[...document.querySelectorAll('.pdp-track img')].every(i=>i.getAttribute('width')&&i.getAttribute('height'))`), "gallery photos carry width and height");
  await m.swipe(".pdp-gal", -200);
  ok(await m.js(`document.querySelector('.pdp-count').textContent`) === "2/4" && await m.js(showing) === g4[1], "phone: swiping left shows photo 2 and the counter says 2/4");
  ok(await m.js(`document.querySelector('.pdp-dots i:nth-child(2)').classList.contains('on')`), "phone: the second dot lights up");
  ok(await m.js(`!document.querySelector('.pdp-zoom')`), "phone: a swipe doesn't open the zoom");
  await m.shot("phone-gallery.png");
  await m.swipe(".pdp-gal", -200); await m.swipe(".pdp-gal", -200); await m.swipe(".pdp-gal", -200);
  ok(await m.js(`document.querySelector('.pdp-count').textContent`) === "4/4", "phone: swiping past the last photo stays on it");
  await m.swipe(".pdp-gal", 200);
  ok(await m.js(`document.querySelector('.pdp-count').textContent`) === "3/4" && await m.js(showing) === g4[2], "phone: swiping right goes back");
  // Two fingers are a pinch, not a swipe.
  const gp = await m.spot(".pdp-gal", false);
  await m.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: gp.x - 20, y: gp.y, id: 1 }, { x: gp.x + 20, y: gp.y, id: 2 }] });
  for (let k = 1; k <= 5; k++) await m.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: gp.x - 20 - k * 25, y: gp.y, id: 1 }, { x: gp.x + 20 + k * 10, y: gp.y, id: 2 }] });
  await m.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(400);
  ok(await m.js(`document.querySelector('.pdp-count').textContent`) === "3/4", "phone: a two-finger pinch doesn't change the photo");
  ok(await m.js(`visualViewport.scale`) > 1.2, "phone: the pinch zooms the page as usual (the gallery doesn't block it)");
  await m.cdp("Emulation.setPageScaleFactor", { pageScaleFactor: 1 }); await sleep(300);
  ok(await m.until(`Math.abs(visualViewport.scale-1)<0.01`), "phone: (zoomed back out for the next checks)");
  await m.tap(".pdp-gal", false);
  ok(await m.until(`!!document.querySelector('dialog.pdp-zoom[open]')`), "phone: tapping the photo opens it full screen");
  const zsrc = `document.querySelector('.pdp-zstage img').getAttribute('src')`, zimg = `document.querySelector('.pdp-zstage img')`;
  ok(await m.js(zsrc) === g4[2] && await m.js(`document.querySelector('.pdp-zthumbs button:nth-child(3)').classList.contains('on')`), "phone: the viewer opens on the same photo, its small photo marked");
  ok(await m.js(`(()=>{const r=document.querySelector('.pdp-zpanel').getBoundingClientRect();return r.width===innerWidth&&getComputedStyle(document.querySelector('.pdp-zpanel')).backgroundColor==='rgb(255, 255, 255)'})()`), "phone: the viewer is a white panel over the page, not a black screen");
  ok(await m.js(`document.querySelector('.pdp-zname').textContent.includes('Gallery Jacket')&&!!document.querySelector('.pdp-zadd')`), "phone: the name, price and Add to bag sit under the photo");
  // A tap zooms into that spot, a drag looks around, another tap goes back.
  const zs = await m.js(`(()=>{const r=document.querySelector('.pdp-zstage').getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height}})()`);
  const origin = `(()=>{const o=getComputedStyle(${zimg}).transformOrigin.split(' ').map(parseFloat);return[o[0]/${zs.w},o[1]/${zs.h}]})()`;
  const tapAt = async (x, y) => { await m.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); await m.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(450); };
  await tapAt(zs.l + zs.w * 0.25, zs.t + zs.h * 0.3);
  ok(await m.js(`${zimg}.classList.contains('zoomed')`) && Math.abs(await m.js(`new DOMMatrix(getComputedStyle(${zimg}).transform).a`) - 2.5) < 0.05, "phone: a tap on the big photo zooms it 2.5 times");
  const o1 = await m.js(origin);
  ok(Math.abs(o1[0] - 0.25) < 0.02 && Math.abs(o1[1] - 0.3) < 0.02, "phone: it zooms on the spot that was tapped");
  await m.shot("phone-zoomed.png");
  const zc = { x: zs.l + zs.w / 2, y: zs.t + zs.h / 2 };
  await m.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: zc.x, y: zc.y }] });
  for (let k = 1; k <= 6; k++) { await m.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: zc.x - k * 15, y: zc.y - k * 10 }] }); await sleep(16); }
  await m.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(450);
  const o2 = await m.js(origin);
  ok(o2[0] > o1[0] + 0.05 && o2[1] > o1[1] + 0.03, "phone: dragging a finger moves around the zoomed photo");
  ok(await m.js(`${zimg}.classList.contains('zoomed')`) && await m.js(zsrc) === g4[2], "phone: the drag doesn't change the photo or zoom out");
  await tapAt(zc.x, zc.y);
  ok(await m.js(`!${zimg}.classList.contains('zoomed')`), "phone: tapping again shows the whole photo");
  await m.swipe(".pdp-zstage img", -200);
  ok(await m.js(zsrc) === g4[3], "phone: swiping in the viewer moves to the next photo");
  await m.tap(".pdp-zthumbs button:nth-child(2)", false);
  ok(await m.js(zsrc) === g4[1], "phone: tapping a small photo shows that one");
  await m.tap(".pdp-zthumbs button:nth-child(4)", false);
  await m.tap(".pdp-zoom .pdp-zclose", false);
  ok(await m.until(`!document.querySelector('.pdp-zoom')`) && await m.js(`document.querySelector('.pdp-count').textContent`) === "4/4", "phone: closing the zoom leaves the page on that photo");
  // A photo file that's gone drops out of the gallery.
  await m.go(`${base}/p/brk1`, `!!document.querySelector('.pdp-media img')`); await sleep(900);
  ok(await m.js(`document.querySelector('.pdp-count')?.textContent`) === "1/2" && await m.js(`[...document.querySelectorAll('.pdp-media img')].every(i=>!i.complete||i.naturalWidth>0)`), "a missing photo file is left out (1/2, no broken image)");
  await m.go(`${base}/p/one1`, `!!document.querySelector('.pdp-media img')`);
  ok(await m.js(`!document.querySelector('.pdp-gal')&&!document.querySelector('.pdp-count')`), "a 1-photo item has a plain photo, no counter");
  ok(await m.js(`!!document.querySelector('.pdp-real')`) === Boolean(await m.js(`window.SHOP&&window.SHOP.whatsapp`)), "a 1-photo item keeps the 'real photos on WhatsApp' link");
  // 320 px: nothing pushes the page sideways.
  await m.size(320, 700);
  for (const u of ["/", "/p/gal1"]) {
    await m.go(base + u, u === "/" ? homeReady : `!!document.querySelector('.pdp-gal')`); await sleep(400);
    ok(await m.js(`document.documentElement.scrollWidth-innerWidth`) <= 0, `320px: ${u} has no sideways scroll`);
  }
  ok(m.errors.length === 0, `phone: no page errors ${m.errors.join(" | ").slice(0, 300)}`);
  await m.close(); m = null;

  // ======== Shop: desktop ========
  d = await browser({ width: 1366, height: 900, mobile: false }, DEBUG + 1);
  await d.go(`${base}/`, homeReady);
  await d.js(`document.querySelector('.card[data-id=gal1]').scrollIntoView({block:'center'})`); await sleep(600);
  ok(await d.js(`!document.querySelector('.card[data-id=gal1] .alt-shot')`), "desktop: the second photo isn't fetched before a hover");
  const c = await d.spot(".card[data-id=gal1] .media", false);
  ok(c.ok, `desktop: the card's photo is under the mouse (${c.top})`);
  await d.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x - 30, y: c.y - 30 });
  await d.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
  ok(await d.until(`(()=>{const a=document.querySelector('.card[data-id=gal1] .alt-shot');return a&&a.getAttribute('src')===${JSON.stringify(g4[1])}&&a.complete&&getComputedStyle(a).opacity==='1'})()`), "desktop: hovering fades in the second photo");
  await sleep(400);
  const hb = await d.js(`(()=>{const r=document.querySelector('.card[data-id=gal1]').getBoundingClientRect();return{x:r.left-6+scrollX,y:r.top-6+scrollY,width:r.width+12,height:r.height+12}})()`);
  await d.shot("desktop-hover.png", hb);
  await d.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  ok(await d.until(`getComputedStyle(document.querySelector('.card[data-id=gal1] .alt-shot')).opacity==='0'`), "desktop: moving away shows the main photo again");
  ok(await d.js(`!document.querySelector('.card[data-id=one1] .alt-shot')`), "desktop: 1-photo cards have nothing to swap");
  ok(await d.js(`(()=>{const b=document.querySelector('.card[data-id=gal1] .pcount');return !!b&&b.textContent.trim()==='4'})()`), "desktop: the card shows the count too");
  // Product page
  await d.go(`${base}/p/gal1`, `!!document.querySelector('.pdp-gal')`);
  ok(await d.js(`document.querySelectorAll('.pdp-thumbs button').length`) === 4 && await d.js(`getComputedStyle(document.querySelector('.pdp-dots')).display==='none'`), "desktop: 4 small photos, no dots");
  await d.tap(".pdp-thumbs button:nth-child(3)");
  ok(await d.js(`document.querySelector('.pdp-count').textContent`) === "3/4" && await d.js(showing) === g4[2], "desktop: clicking the 3rd small photo shows it (3/4)");
  ok(await d.js(`!document.querySelector('.pdp-zoom')`), "desktop: and doesn't open the zoom");
  await d.key("ArrowRight", 39);
  ok(await d.js(`document.querySelector('.pdp-count').textContent`) === "4/4" && await d.js(`document.querySelector('.pdp-thumbs button:nth-child(4)').classList.contains('on')`), "desktop: the right arrow key moves on");
  await d.key("ArrowRight", 39);
  ok(await d.js(`document.querySelector('.pdp-count').textContent`) === "1/4", "desktop: and wraps round to the first");
  await d.key("ArrowLeft", 37);
  ok(await d.js(`document.querySelector('.pdp-count').textContent`) === "4/4", "desktop: the left arrow key goes back");
  await d.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: (await d.spot(".pdp-gal")).x, y: (await d.spot(".pdp-gal")).y }); await sleep(300); // the arrows show on hover
  await d.tap(".pdp-arrow.next", false);
  ok(await d.js(`document.querySelector('.pdp-count').textContent`) === "1/4", "desktop: the › button on the photo moves on");
  await d.tap(".pdp-gal", false);
  ok(await d.until(`!!document.querySelector('dialog.pdp-zoom[open]')`), "desktop: clicking the photo opens the zoom");
  ok(await d.js(`(()=>{const p=document.querySelector('.pdp-zpanel').getBoundingClientRect();return p.width===980&&p.left>100&&getComputedStyle(document.querySelector('.pdp-zoom')).backgroundColor==='rgba(0, 0, 0, 0.8)'})()`), "desktop: it is a 980px panel with the page dimmed around it");
  await d.until(`(()=>{const i=document.querySelector('.pdp-zstage img');return i.complete&&i.naturalWidth>0})()`);
  const dst = await d.js(`(()=>{const s=document.querySelector('.pdp-zstage'),r=s.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height,img:s.querySelector('img').getBoundingClientRect().width,max:s.scrollHeight-s.clientHeight}})()`);
  ok(dst.img === 980 && dst.max > 100, "desktop: the photo is as wide as the panel, taller than the screen");
  await d.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: dst.l + dst.w / 2, y: dst.t + dst.h - 10 }); await sleep(150);
  ok(await d.js(`document.querySelector('.pdp-zstage').scrollTop`) === dst.max, "desktop: moving the mouse down travels to the bottom of the photo");
  await d.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: dst.l + dst.w / 2, y: dst.t + 10 }); await sleep(150);
  ok(await d.js(`document.querySelector('.pdp-zstage').scrollTop`) === 0, "desktop: and moving it up goes back to the top");
  await d.shot("desktop-viewer.png");
  await d.tap(".pdp-zstep.next", false);
  ok(await d.js(`document.querySelector('.pdp-zthumbs button:nth-child(2)').classList.contains('on')`), "desktop: the › button in the viewer moves on");
  await d.tap(".pdp-zthumbs button:nth-child(4)", false);
  ok(await d.js(`document.querySelector('.pdp-zstage img').getAttribute('src')`) === g4[3], "desktop: clicking a small photo shows that one");
  await d.key("ArrowRight", 39); await d.key("ArrowRight", 39);
  ok(await d.js(`document.querySelector('.pdp-zthumbs button:nth-child(2)').classList.contains('on')`), "desktop: arrow keys move through photos in the viewer");
  await d.key("Escape", 27);
  ok(await d.until(`!document.querySelector('.pdp-zoom')`) && await d.js(`document.querySelector('.pdp-count').textContent`) === "2/4", "desktop: Escape closes the zoom on that photo");
  await d.tap(".pdp-gal", false); await d.until(`!!document.querySelector('dialog.pdp-zoom[open]')`);
  await d.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: 40, y: 450, button: "left", clickCount: 1 }); await d.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: 40, y: 450, button: "left", clickCount: 1 });
  ok(await d.until(`!document.querySelector('.pdp-zoom')`), "desktop: clicking the dimmed page closes the viewer");
  await d.tap(".pdp-gal", false); await d.until(`!!document.querySelector('dialog.pdp-zoom[open]')`);
  await d.tap(".pdp-zadd", false);
  ok(await d.until(`!document.querySelector('.pdp-zoom')&&!!document.querySelector('.vx-sizes')`), "desktop: Add to bag in the viewer closes it and asks for the size");
  const html = await (await fetch(`${base}/p/gal1`)).text();
  ok(html.includes(`property="og:image" content="https://shop.example${g4[0]}"`), "the share preview (og:image) is still the main photo");
  ok(d.errors.length === 0, `desktop: no page errors ${d.errors.join(" | ").slice(0, 300)}`);

  // ======== Portal: 10 photos over a slow network, one lost answer ========
  const fresh = await (await fetch(`${base}/api/billing/items`, { method: "POST", headers: { "Content-Type": "application/json", "x-owner-key": "k" }, body: JSON.stringify({ name: "Upload Test Jacket", price: 1500, quantity: 1 }) })).json();
  const pid = fresh.product.id;
  await d.go(`${base}/billing?key=k`, `!!window.VX`);
  await d.go(`${base}/billing#/stock`, `!!document.querySelector('[data-photos=${pid}]')`);
  await d.tap(`[data-photos=${pid}]`);
  ok(await d.until(`!!document.getElementById('phAdd')`), "portal: the item's photo panel opens");
  const files = Array.from({ length: 10 }, (_, i) => { const f = path.join(dir, `up${i}.png`); fs.writeFileSync(f, png(900, 1200, COLOURS[i])); return f; });
  await d.cdp("Network.enable");
  await d.cdp("Network.emulateNetworkConditions", { offline: false, latency: 250, downloadThroughput: 60000, uploadThroughput: 60000 });
  // The answer to the 3rd upload is lost after the server saved it, like a phone losing signal.
  let calls = 0;
  d.on("Fetch.requestPaused", (e) => { calls++; if (calls === 3) d.cdp("Fetch.failRequest", { requestId: e.requestId, errorReason: "ConnectionReset" }); else d.cdp("Fetch.continueRequest", { requestId: e.requestId }); });
  await d.cdp("Fetch.enable", { patterns: [{ urlPattern: `*/api/billing/items/${pid}/photos`, requestStage: "Response" }] });
  const opened = new Promise((res) => d.on("Page.fileChooserOpened", res));
  await d.cdp("Page.setInterceptFileChooserDialog", { enabled: true });
  await d.tap("#phAdd");
  const chooser = await Promise.race([opened, sleep(3000).then(() => null)]);
  ok(!!chooser, "portal: Add photos opens the file chooser (several at once)");
  ok(await d.js(`document.getElementById('phFile').multiple`), "portal: the chooser allows picking several");
  if (chooser) await d.cdp("DOM.setFileInputFiles", { files, backendNodeId: chooser.backendNodeId });
  await d.cdp("Page.setInterceptFileChooserDialog", { enabled: false });
  ok(await d.until(`/Uploading [2-9] of 10/.test(document.getElementById('phBusy')?.textContent||'')`, 15000), `portal: progress reads "Uploading n of 10"`);
  ok(await d.until(`!!document.getElementById('phRetry')`, 60000), "portal: after the lost answer, a 'Try it again' button");
  ok(/1 photo didn't upload/.test(await d.js(`document.getElementById('phBusy').textContent`)), "portal: it says 1 photo didn't upload");
  const before = count(stored().find((p) => p.id === pid));
  ok(before === 10, `portal: the server did save all 10 (${before})`);
  await d.cdp("Fetch.disable");
  await d.cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await d.tap("#phRetry");
  ok(await d.until(`!document.getElementById('phRetry')&&document.querySelectorAll('.photoTile').length===10`, 15000), "portal: Try again finishes, 10 photos shown");
  const after = stored().find((p) => p.id === pid), list = [after.image, ...(after.images || [])];
  ok(list.length === 10 && new Set(list).size === 10, `portal: retrying added no duplicate (${list.length} stored)`);
  ok(await d.js(`document.querySelector('.photoCount')?.textContent.startsWith('10 of 10 photos')`) && await d.js(`document.getElementById('phAdd').disabled`), "portal: shows 10 of 10 and Add is off");
  const second = after.images[0];
  await d.tap(".photoTile:nth-child(1) [data-move][data-by='1']");
  const moved = await d.until(`document.getElementById('phBusy').textContent==='Main photo changed.'`);
  ok(moved && stored().find((p) => p.id === pid).image === second, `portal: ▶ on the main photo swaps it with the 2nd (new main) ${moved} ${stored().find((p) => p.id === pid).image} ${second}`);
  await d.tap(".photoTile:nth-child(3) [data-move][data-by='-1']");
  ok(await d.until(`document.getElementById('phBusy').textContent==='Order changed.'`), "portal: ◀ moves a photo earlier");
  const bad = await (await fetch(`${base}/api/billing/items/${pid}/photos`, { method: "POST", headers: { "Content-Type": "application/json", "x-owner-key": "k" }, body: JSON.stringify({ order: ["/uploads/x.png"] }) })).json();
  ok(/changed meanwhile/.test(bad.error || ""), "server: a reorder that isn't the same photos is refused");
  ok(d.errors.length === 0, `portal: no page errors ${d.errors.join(" | ").slice(0, 300)}`);
} catch (e) {
  fails++; console.error(e); console.error("--- server log ---\n" + log.slice(-3000));
} finally {
  if (m) await m.close();
  if (d) await d.close();
  srv.kill(); graph.close();
  if (!process.env.KEEP) fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${passes} passed, ${fails} failed. Screenshots: ${SHOTS}`);
process.exit(fails ? 1 : 0);

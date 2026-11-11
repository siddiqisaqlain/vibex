// Pay step on a phone vs a computer: phones get a button per UPI app (they can't scan their own screen),
// computers get the QR. Real taps through Chrome. `node tests/payphone.mjs` (SHOTS=dir saves screenshots)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 4797, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;
let fails = 0, passes = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };

async function run(sms) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-payphone-"));
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", ORDER_HOURS: "0-24", RENDER: "", PUBLIC_URL: "", PAY_SMS_TOKEN: sms ? "t0ken-for-tests-1234567890" : "" } });
  for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/products"); break; } catch { await sleep(100); } }
  const { product } = await (await fetch(base + "/api/billing/items", { method: "POST", headers: { "Content-Type": "application/json", "x-owner-key": "k" }, body: JSON.stringify({ name: "Puma jacket", price: 2400, quantity: 3 }) })).json();
  const f = path.join(dir, "products.json"), all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/logo.jpg"; delete p.hidden; fs.writeFileSync(f, JSON.stringify(all));
  try {
    for (const dev of [{ name: "iPhone", width: 390, height: 844, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" },
                       { name: "computer", width: 1280, height: 800, mobile: false }]) {
      const tag = `${dev.name}${sms ? " +sms" : ""}`;
      const b = await browser(dev, 9790 + (sms ? 2 : 0) + (dev.mobile ? 0 : 1));
      try {
        await b.nav(`${base}/p/${encodeURIComponent(product.id)}?form=a`); // the usual form (numberonly.mjs covers the other)
        await b.tap(".pdp-info .order-now");
        await b.until(`document.querySelector(".co-form") || document.querySelector("[data-checkout]")`);
        if (await b.js(`!!document.querySelector("[data-checkout]") && !document.querySelector(".co-form")`)) await b.tap("[data-checkout]");
        ok(await b.until(`!!document.querySelector(".co-form")`), `${tag}: details step opens`);
        await b.fill("input[name=phone]", "9876500021");
        await b.fill("input[name=name]", "Aamir");
        await b.tap("input[name=delivery][value=pickup]");
        await b.tap(".co-form .co-cta");
        ok(await b.until(`!!document.querySelector(".co-pay")`), `${tag}: pay step opens`);
        await sleep(300);
        const v = await b.js(`(()=>{const q=document.querySelector(".co-qr"),vis=(e)=>!!e&&e.checkVisibility();
          return {apps:[...document.querySelectorAll(".co-upi-apps a")].filter(vis).map(a=>a.textContent.trim()), hrefs:[...document.querySelectorAll(".co-upi-apps a")].map(a=>a.getAttribute("href")),
            qrShown:vis(q), more:!!document.querySelector(".co-qr-more"), note:[...document.querySelectorAll(".co-small")].some(e=>/payment note/.test(e.textContent)),
            exact:!!document.querySelector(".co-exact"), amount:document.querySelector(".co-amount b").textContent}})()`);
        if (dev.mobile) {
          ok(v.apps.join(",") === "GPay,PhonePe,Paytm,Other UPI app", `${tag}: app buttons shown first (${v.apps})`);
          ok(v.hrefs[0].startsWith("gpay://upi/pay?") && v.hrefs.every((h) => /[?&]am=\d/.test(h) && /[?&]tn=/.test(h)), `${tag}: every app link carries amount and note`);
          ok(!v.qrShown && v.more, `${tag}: QR tucked away behind a tap`);
          if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, `pay-${tag.replace(/\W+/g, "-")}.png`));
          await b.tap(".co-qr-more summary");
          ok(await b.until(`document.querySelector(".co-qr").checkVisibility()`), `${tag}: tapping "Show the QR" reveals it`);
        } else {
          ok(v.apps.length === 0 && v.qrShown, `${tag}: QR shown, no app buttons`);
          if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, `pay-${tag.replace(/\W+/g, "-")}.png`));
        }
        ok(sms ? !v.note && v.exact : v.note, `${tag}: payment-note line ${sms ? "hidden (paise tag matches it)" : "kept"}`);
        ok(b.errors.length === 0, `${tag}: no page errors ${b.errors.join(" | ")}`);
      } finally { b.close(); }
    }
  } finally { srv.kill(); await sleep(300); }
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
    await sleep(200); return true;
  };
  const fill = async (sel, t) => { await tap(sel); for (const c of t) await cdp("Input.dispatchKeyEvent", { type: "char", text: c }); await sleep(100); };
  const shot = async (file) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(r.data, "base64")); };
  const close = () => { ws.close(); proc.kill(); setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} }, 500); };
  return { js, until, nav, tap, fill, shot, errors, close };
}

await run(false);
// The paise tag only exists with the bank-SMS check (lib/smspay.js).
if (fs.existsSync(path.resolve(import.meta.dirname, "../lib/smspay.js"))) await run(true);
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

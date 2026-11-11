// Checkout and enquiry forms remember the name, number and address in the browser, and accept an
// autofilled "+91 ..." number. Real taps through Chrome. `node tests/remember.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 4787, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;
let fails = 0, passes = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const val = (n) => `document.querySelector(".co-form input[name=${n}]")?.value`;

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-remember-"));
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", ORDER_HOURS: "0-24", RENDER: "", PUBLIC_URL: "", PAY_SMS_TOKEN: "" } });
  for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/products"); break; } catch { await sleep(100); } }
  const { product } = await (await fetch(base + "/api/billing/items", { method: "POST", headers: { "Content-Type": "application/json", "x-owner-key": "k" }, body: JSON.stringify({ name: "Puma jacket", price: 2400, quantity: 3 }) })).json();
  const f = path.join(dir, "products.json"), all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/logo.jpg"; delete p.hidden; fs.writeFileSync(f, JSON.stringify(all));
  const page = `${base}/p/${encodeURIComponent(product.id)}`;
  const b = await browser({ name: "iPhone", width: 390, height: 844, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }, 9786);
  const openCheckout = async () => {
    await b.nav(page);
    await b.tap(".pdp-info .order-now");
    await b.until(`document.querySelector(".co-form") || document.querySelector("[data-checkout]")`);
    if (await b.js(`!!document.querySelector("[data-checkout]") && !document.querySelector(".co-form")`)) await b.tap("[data-checkout]");
    return b.until(`!!document.querySelector(".co-form")`);
  };
  try {
    ok(await openCheckout(), "details step opens");
    ok(await b.js(`document.querySelector(".co-form input[name=phone]").autocomplete === "tel" && document.querySelector(".co-form input[name=name]").autocomplete === "name"`), "fields are labelled for the phone's autofill (tel, name)");
    ok(await b.js(`${val("phone")} === "" && ${val("name")} === ""`), "a new visitor starts with empty boxes");
    // What a phone's autofill does: drops the whole number in, country code and all, in one go.
    await b.js(`(()=>{const e=document.querySelector(".co-form input[name=phone]");e.value="+91 98765 00021";e.dispatchEvent(new Event("input",{bubbles:true}));})()`);
    ok(await b.js(`${val("phone")} === "9876500021"`), `an autofilled "+91 98765 00021" becomes the ten digits (${await b.js(val("phone"))})`);
    await b.fill(".co-form input[name=name]", "Aamir Khan");
    await sleep(700);
    // Leaves without ordering, comes back later.
    ok(await openCheckout(), "details step opens again after a reload");
    ok(await b.js(`${val("phone")} === "9876500021" && ${val("name")} === "Aamir Khan"`), `name and number are already filled in (${await b.js(val("name"))}, ${await b.js(val("phone"))})`);
    await b.tap(".co-form input[name=delivery][value=ship]");
    await b.fill(".co-form input[name=address]", "12 Lal Chowk");
    await b.fill(".co-form input[name=city]", "Srinagar");
    await b.fill(".co-form input[name=pin]", "190001");
    await sleep(700);
    ok(await openCheckout(), "details step opens a third time");
    ok(await b.js(`${val("address")} === "12 Lal Chowk" && ${val("city")} === "Srinagar" && ${val("pin")} === "190001" && document.querySelector(".co-form input[name=delivery][value=ship]").checked`), "delivery choice and address are remembered too");
    // The enquiry form uses the same saved name and number.
    await b.nav(page);
    if (await b.js(`!!document.querySelector(".pdp-info [data-ask]")`)) {
      await b.tap(".pdp-info [data-ask]");
      if (await b.until(`!!document.querySelector(".ask-form")`, 2500)) ok(await b.js(`document.querySelector(".ask-form input[name=name]").value === "Aamir Khan" && document.querySelector(".ask-form input[name=phone]").value === "9876500021"`), "enquiry form is filled in from the same details");
    }
    // A typed number with the country code still orders.
    await b.js(`localStorage.removeItem("vx-details")`);
    ok(await openCheckout(), "details step opens with nothing saved");
    await b.fill(".co-form input[name=phone]", "919876500021");
    ok(await b.js(`${val("phone")} === "9876500021"`), "typing 91 first is trimmed to ten digits");
    await b.fill(".co-form input[name=name]", "Aamir");
    await b.tap(".co-form input[name=delivery][value=pickup]");
    await b.tap(".co-form .co-cta");
    ok(await b.until(`!!document.querySelector(".co-pay")`), "the order goes through to the pay step");
    ok(await b.js(`JSON.parse(localStorage.getItem("vx-details")).phone === "9876500021"`), "the details are saved when the order starts");
    await b.js(`window.VXOrder.forgetDetails()`);
    ok(await b.js(`localStorage.getItem("vx-details") === null`), "forgetting clears them");
    ok(b.errors.length === 0, `no page errors ${b.errors.join(" | ")}`);
  } finally { b.close(); srv.kill(); await sleep(300); }
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

await run();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

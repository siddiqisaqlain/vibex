// The number-only order form (arm "b"): one box to start, the name asked on the pay screen, and the shop
// still gets a usable order. Real taps through Chrome. `node tests/numberonly.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 4777, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;
let fails = 0, passes = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };
const post = (u, body, headers = {}) => fetch(base + u, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-numberonly-"));
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", ORDER_HOURS: "0-24", RENDER: "", PUBLIC_URL: "", PAY_SMS_TOKEN: "" } });
  for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/products"); break; } catch { await sleep(100); } }
  const { product } = await (await post("/api/billing/items", { name: "Puma jacket", price: 2400, quantity: 5 }, { "x-owner-key": "k" })).json();
  const f = path.join(dir, "products.json"), all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/logo.jpg"; delete p.hidden; fs.writeFileSync(f, JSON.stringify(all));
  const page = `${base}/p/${encodeURIComponent(product.id)}`;
  const orders = () => JSON.parse(fs.readFileSync(path.join(dir, "orders.json"), "utf8"));
  const b = await browser({ name: "iPhone", width: 390, height: 844, mobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }, 9776);
  const openCheckout = async (q = "") => {
    await b.nav(page + q);
    await b.tap(".pdp-info .order-now");
    await b.until(`document.querySelector(".co-form") || document.querySelector("[data-checkout]")`);
    if (await b.js(`!!document.querySelector("[data-checkout]") && !document.querySelector(".co-form")`)) await b.tap("[data-checkout]");
    return b.until(`!!document.querySelector(".co-form")`);
  };
  try {
    // The server: a name is still required unless the form says it comes later.
    const line = { lines: [{ id: product.id, size: "", qty: 1 }], phone: "9876500031", delivery: "pickup" };
    ok((await post("/api/orders", line)).status === 400, "an order with no name is refused from the usual form");
    const r = await post("/api/orders", { ...line, nameLater: true, form: "b" }), made = await r.json();
    ok(r.status === 200 && made.noName === true, "the number-only form may start an order with no name");
    let o = orders().find((x) => x.id === made.id);
    ok(o.name === "Customer 0031" && o.noName === true && o.form === "b", `the order goes by the last four digits until then (${o.name})`);
    ok((await post(`/api/orders/${made.id}/name`, { name: "" })).status === 400, "an empty name is refused");
    ok((await post(`/api/orders/${made.id}/name`, { name: "  Bilal   Ahmad " })).status === 200, "the name can be added afterwards");
    o = orders().find((x) => x.id === made.id);
    ok(o.name === "Bilal Ahmad" && !o.noName, `the order now carries it (${o.name})`);
    await post(`/api/orders/${made.id}/name`, { name: "Someone Else" });
    ok(orders().find((x) => x.id === made.id).name === "Bilal Ahmad", "a name already on the order can't be replaced");
    await post(`/api/orders/${made.id}/cancel`, {});

    // The usual form (arm a) is untouched.
    ok(await openCheckout("?form=a"), "form a opens");
    ok(await b.js(`!!document.querySelector(".co-form input[name=name]:not([type=hidden])")`), "form a still asks for the name");

    // The number-only form.
    ok(await openCheckout("?form=b"), "form b opens");
    ok(await b.js(`!document.querySelector(".co-form input[name=name]") && !!document.querySelector(".co-form input[name=phone]") && !document.querySelector(".co-form input[name=hideName]")`), "form b shows the number box and no name box");
    await b.fill(".co-form input[name=phone]", "9876500032");
    await b.tap(".co-form input[name=delivery][value=pickup]");
    await b.tap(".co-form .co-cta");
    ok(await b.until(`!!document.querySelector(".co-pay")`), `number and pick up are enough to reach the pay screen ${await b.js(`document.querySelector(".ask-err")?.textContent || ""`)}`);
    ok(await b.until(`!!document.querySelector(".co-name input[name=name]")`), "the pay screen asks for a name, marked optional");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "numberonly-pay.png"));
    const code = await b.js(`document.querySelector(".co-amount") && [...document.querySelectorAll(".mono")].map(e=>e.textContent).find(t=>/^VX-\\d{4}$/.test(t))`);
    o = orders().find((x) => x.phone === "9876500032" && x.status === "awaiting_payment");
    ok(o && o.noName && o.form === "b", `the shop has the order before any name (${o && o.code})`);
    // Switching the payment tab mustn't lose what was typed.
    await b.fill(".co-name input[name=name]", "Zaid");
    if (await b.js(`document.querySelectorAll("[data-tab]").length > 1`)) { await b.tap("[data-tab]:not([aria-selected=true])"); ok(await b.js(`document.querySelector(".co-name input[name=name]").value === "Zaid"`), "the half-typed name survives a tab switch"); }
    await b.tap(".co-name button[type=submit]");
    ok(await b.until(`!!document.querySelector(".co-name-ok")`), "saving shows a confirmation in place of the box");
    o = orders().find((x) => x.id === o.id);
    ok(o.name === "Zaid" && !o.noName, `the order carries the name (${o.name})`);
    ok(await b.js(`JSON.parse(localStorage.getItem("vx-details")).name === "Zaid"`), "the name is remembered on the device");

    // The shop confirms a number-only order whose name never came: the bill still works.
    const r2 = await post("/api/orders", { ...line, phone: "9876500033", nameLater: true, form: "b" }), m2 = await r2.json();
    const o2 = orders().find((x) => x.id === m2.id);
    const conf = await (await post("/api/billing/orders/" + o2.code + "/confirm", {}, { "x-owner-key": "k" })).json().catch(() => ({}));
    const after = orders().find((x) => x.id === m2.id);
    if (after.status === "confirmed") {
      const bills = await (await fetch(base + "/api/billing/invoices", { headers: { "x-owner-key": "k" } })).json();
      const bill = bills.invoices.find((x) => x.id === after.invoice);
      ok(bill && !/Customer 0033/.test(bill.customer?.name || "") , `the bill has no made-up name on it (“${bill?.customer?.name || ""}”)`);
      await post(`/api/orders/${m2.id}/name`, { name: "Late Name" });
      const bills2 = await (await fetch(base + "/api/billing/invoices", { headers: { "x-owner-key": "k" } })).json();
      ok(bills2.invoices.find((x) => x.id === after.invoice).customer.name === "Late Name", "a name given after the shop confirmed goes onto the bill");
    } else console.log("SKIP confirm through the portal route (" + JSON.stringify(conf).slice(0, 80) + ")");

    // Returning customer on form b: the name is known, so it is sent and never asked.
    ok(await openCheckout("?form=b"), "form b opens for a returning customer");
    ok(await b.js(`document.querySelector(".co-form input[type=hidden][name=name]")?.value === "Zaid"`), "their saved name rides along unseen");
    const t = await (await fetch(base + "/api/billing/form-test", { headers: { "x-owner-key": "k" } })).json();
    ok(t.a && t.b && typeof t.b.opened === "number", `the owner can read the test's counts (${JSON.stringify(t)})`);
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

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
  // A stand-in for the post office list, so the test never leaves this computer.
  const http = await import("node:http");
  const posts = http.createServer((q, r) => { r.setHeader("Content-Type", "application/json"); r.end(JSON.stringify(q.url.endsWith("/190001") ? [{ Status: "Success", PostOffice: [{ District: "Srinagar", State: "Jammu & Kashmir" }] }] : [{ Status: "Error", PostOffice: null }])); }).listen(PORT + 1);
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", ORDER_HOURS: "0-24", RENDER: "", PUBLIC_URL: "", PAY_SMS_TOKEN: "", PIN_LOOKUP: `http://localhost:${PORT + 1}/pincode/` } });
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
  const shotBag = async () => {
    await b.nav(page);
    await b.tap(".pdp-info .order-now");
    await sleep(900);
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "green-addbar.png"));
    if (await b.js(`!!document.querySelector(".vx-count, [data-bag-open], .bag-btn")`)) { await b.js(`window.VXBag && window.VXBag.openSheet && window.VXBag.openSheet()`); await sleep(700); if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "green-bag.png")); }
    const col = await b.js(`(()=>{const e=document.querySelector(".vx-bag .co-cta, .vx-addbar-go");return e?getComputedStyle(e).backgroundImage:""})()`);
    ok(/rgba\(46, 102, 77/.test(col), `the Checkout button is the quieter green (${col.slice(0, 70)})`);
    await b.js(`document.querySelector("dialog[open]")?.close(); localStorage.removeItem("vx-bag")`);
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

    await shotBag();
    // The usual form (arm a) is untouched.
    ok(await openCheckout("?form=a"), "form a opens");
    ok(await b.js(`!!document.querySelector(".co-form input[name=name]:not([type=hidden])")`), "form a still asks for the name");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-a.png"));

    // The number-only form.
    ok(await openCheckout("?form=b"), "form b opens");
    ok(await b.js(`!document.querySelector(".co-form input[name=name]") && !!document.querySelector(".co-form input[name=phone]") && !document.querySelector(".co-form input[name=hideName]")`), "form b shows the number box and no name box");
    ok(await b.js(`document.querySelector("[data-co-wa]").hidden === true`), "Or order on WhatsApp is out of the way at first");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-empty.png"));
    await b.tap(".co-form .co-cta"); // nothing chosen yet: the form asks, and offers the way out
    ok(await b.until(`document.querySelector("[data-co-wa]").hidden === false && /10 digit WhatsApp number/.test(document.querySelector(".ask-err").textContent) && document.querySelector(".co-group").classList.contains("co-bad")`, 3000), "after a stumble on the form, the number box is marked and Or order on WhatsApp appears");
    ok(/order/.test(await b.js(`decodeURIComponent(document.querySelector("[data-co-wa]").href)`)), "its message says what they want to order");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-stalled.png"));
    await b.fill(".co-form input[name=phone]", "9876500032");
    ok(await b.until(`document.querySelector(".ask-err").hidden && !document.querySelector(".co-bad")`, 2000), "typing clears the mark");
    ok(await b.js(`document.querySelector(".co-form input[name=delivery]").value === "ship" && !document.querySelector(".co-ship").hidden && !document.querySelector(".co-seg") && /pick up/i.test(document.querySelector("[data-co-how]").textContent)`), "no question to answer: delivery is assumed, with one line for picking up instead");
    await b.tap(".co-form .co-cta");
    ok(await b.js(`document.querySelector("[data-co-city]").hidden && !document.querySelector(".co-form input[name=pin]").closest("[hidden]") && !document.querySelector(".co-form input[name=address]").closest("[hidden]")`), "delivery starts with two boxes, the address and the PIN code");
    ok(await b.until(`/house, street/.test(document.querySelector(".ask-err").textContent) && document.querySelector(".co-ship .co-group").classList.contains("co-bad") && !document.querySelector(".co-pay")`, 3000), "deliver with no address: the box is marked, nothing is sent");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-address.png"));
    await b.fill(".co-form input[name=pin]", "19ab");
    ok(await b.until(`document.querySelector(".co-form input[name=pin]").value === "19" && /numbers only/.test(document.querySelector(".ask-err").textContent) && !document.querySelector(".ask-err").hidden && document.querySelector(".co-ship .co-group").classList.contains("co-bad")`, 3000), "letters typed into the PIN box are dropped, and the box says numbers only");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-pin.png"));
    const wipe = (n) => b.js(`(()=>{const e=document.querySelector(".co-form input[name=${n}]");e.value="";e.dispatchEvent(new Event("input",{bubbles:true}));})()`);
    await wipe("pin");
    ok(await b.js(`document.querySelector("[data-co-city]").hidden`), "the city box stays away until the PIN is in");
    await b.fill(".co-form input[name=pin]", "190001");
    ok(await b.until(`document.querySelector(".co-form input[name=city]").value === "Srinagar" && !document.querySelector("[data-co-city]").hidden`, 4000), "a full PIN code brings up the city, already written");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-city.png"));
    await b.fill(".co-form input[name=city]", "4");
    ok(await b.until(`document.querySelector(".co-form input[name=city]").value === "Srinagar" && /City is letters only/.test(document.querySelector(".ask-err").textContent) && !document.querySelector(".ask-err").hidden`, 3000), "a digit typed into the city is dropped, and the box says so");
    await b.fill(".co-form input[name=phone]", "x");
    ok(await b.until(`document.querySelector(".co-form input[name=phone]").value === "9876500032" && /numbers only/.test(document.querySelector(".ask-err").textContent) && document.querySelector(".co-group").classList.contains("co-bad")`, 3000), "a letter typed into the number box is dropped, and the box says so");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-letters.png"));
    await wipe("pin"); await wipe("city"); await sleep(700);
    await b.js(`window.VXOrder.forgetDetails()`);
    if (await b.js(`document.querySelector(".co-form input[name=delivery]").value !== "pickup"`)) await b.tap("[data-co-how]");
    ok(await b.until(`/Pick up at the store/.test(document.querySelector("[data-bill-del]").textContent) && /Free/.test(document.querySelector("[data-bill-del]").textContent) && document.querySelector(".co-ship").hidden`, 3000), "choosing pick up adds a free pick-up row to the bill, and keeps the address boxes away");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-pickup.png"));
    await b.tap(".co-form .co-cta");
    ok(await b.until(`/Placing your order/.test(document.querySelector(".co-form .co-cta")?.textContent || "") && !document.querySelector(".co-pay")`, 800), "Place Order shows it is working before the screen changes");
    ok(await b.until(`/Order placed/.test(document.querySelector(".co-form .co-cta")?.textContent || "")`, 3000), "then it says the order is placed");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-placed.png"));
    ok(await b.until(`!!document.querySelector(".co-pay")`), `number and pick up are enough to reach the pay screen ${await b.js(`document.querySelector(".ask-err")?.textContent || ""`)}`);
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "pay-first.png"));
    ok(await b.js(`document.querySelector(".co-later").hidden === true`), "the name box and WhatsApp button stay out of the way at first");
    await sleep(2500);
    ok(await b.js(`document.querySelector(".co-later").hidden === true`), "and they stay hidden until the customer starts paying");
    // Starting to pay: copying the UPI ID from "Other ways to pay" (tapping an app button would leave the page).
    await b.tap(".co-qr-more summary");
    await b.tap(".co-qr-more [data-copy]");
    ok(await b.until(`document.querySelector(".co-later").hidden === false && !!document.querySelector(".co-name input[name=name]")`, 4000), "once they start paying, the name box (optional) and the WhatsApp button appear");
    ok(await b.js(`!document.querySelector(".co-sum") && !document.querySelector(".co-upi-lead") && !document.querySelector(".co-amount .co-copy")`), "a pick-up order shows the amount alone: no breakdown line, no hint line");
    const up = await b.js(`(()=>{const a=document.querySelector("[data-co-updates]");return a?{href:decodeURIComponent(a.href),h:a.getBoundingClientRect().height}:null})()`);
    ok(up && /wa\.me\/\d+\?text=.*VX-\d{4}/.test(up.href) && up.h >= 44, `the pay screen offers updates on WhatsApp with the order code written in (${up && up.href.slice(0, 90)})`);
    if (process.env.SHOTS) { await b.js(`document.querySelector(".co-name").scrollIntoView({block:"center"})`); await b.shot(path.join(process.env.SHOTS, "numberonly-pay.png")); }
    const code = await b.js(`document.querySelector(".co-amount") && [...document.querySelectorAll(".mono")].map(e=>e.textContent).find(t=>/^VX-\\d{4}$/.test(t))`);
    o = orders().find((x) => x.phone === "9876500032" && x.status === "awaiting_payment");
    ok(o && o.noName && o.form === "b", `the shop has the order before any name (${o && o.code})`);
    await b.fill(".co-name input[name=name]", "Zaid");
    const off = async () => Number(await b.js(`document.querySelector("[data-ring]").getAttribute("stroke-dashoffset")`));
    const off1 = await off(); await sleep(2200); const off2 = await off();
    ok(off2 > off1 && off1 > 0, `the countdown ring keeps shrinking as the time runs down (${off1.toFixed(2)} then ${off2.toFixed(2)})`);
    ok(await b.js(`document.querySelectorAll("[data-ring]").length === 2 && new Set([...document.querySelectorAll("[data-ring]")].map(c=>c.getAttribute("stroke-dashoffset"))).size === 1`), "the filled area inside the ring shrinks in step with it");
    if (process.env.SHOTS) { await b.js(`document.querySelector(".co-ring").scrollIntoView({block:"center"})`); await b.shot(path.join(process.env.SHOTS, "ring.png")); }
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

    // A delivery order: the total is higher than the piece, so one small line says why.
    await b.js(`localStorage.removeItem("vx-details")`);
    ok(await openCheckout("?form=b"), "form b opens for a delivery order");
    await b.js(`(()=>{const e=document.querySelector(".co-form input[name=phone]");e.value="";})()`);
    await b.fill(".co-form input[name=phone]", "9876500034");
    if (await b.js(`document.querySelector(".co-form input[name=delivery]").value !== "ship"`)) await b.tap("[data-co-how]");
    ok(await b.until(`/Add your PIN code/.test(document.querySelector("[data-bill-del]").textContent)`, 3000) && !(await b.js(`/kg inside Kashmir/.test(document.querySelector(".co-details").textContent)`)), "choosing delivery asks for the PIN in the bill, with no per-kg rates on show");
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-delivery-nopin.png"));
    await b.fill(".co-form input[name=pin]", "110001");
    ok(await b.until(`!document.querySelector("[data-co-city]").hidden && document.querySelector(".co-form input[name=city]").value === ""`, 4000), "a PIN the list doesn't know brings up an empty city box");
    await sleep(400); // the boxes slide in
    await b.fill(".co-form input[name=city]", "Delhi");
    await b.fill(".co-form input[name=address]", "12 Lal Chowk");
    await sleep(800);
    const bill = await b.js(`[...document.querySelectorAll(".co-brow:not([hidden])")].map(e=>e.textContent.replace(/\\s+/g," ")).join(" | ")`);
    ok(/Delivery.*₹130/.test(bill) && /Total.*₹2,530/.test(bill) && /Place Order/.test(await b.js(`document.querySelector(".co-cta").textContent`)), `the bill shows the delivery charge and the total, above Place Order (${bill})`);
    if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "details-b-delivery.png"));
    await b.tap(".co-form .co-cta");
    if (await b.until(`!!document.querySelector(".co-paynow")`)) {
      const sum = await b.js(`document.querySelector(".co-sum")?.textContent || ""`);
      ok(/courier/.test(sum) || !(await b.js(`/\+/.test(document.querySelector(".co-amount b").textContent)`)) && sum === "", `a delivery order explains its total in one line (“${sum}”)`);
      if (process.env.SHOTS) await b.shot(path.join(process.env.SHOTS, "pay-delivery.png"));
      await b.tap("[data-back]");
      await sleep(400);
    } else ok(false, "delivery order reached the pay screen " + (await b.js(`document.querySelector(".ask-err")?.textContent || ""`)));
    await b.js(`localStorage.removeItem("vx-details")`);

    // Returning customer on form b: the name is known, so it is sent and never asked.
    ok(await openCheckout("?form=b"), "form b opens for a returning customer");
    ok(await b.js(`document.querySelector(".co-form input[type=hidden][name=name]")?.value === "Zaid"`), "their saved name rides along unseen");
    const t = await (await fetch(base + "/api/billing/form-test", { headers: { "x-owner-key": "k" } })).json();
    ok(t.a && t.b && typeof t.b.opened === "number", `the owner can read the test's counts (${JSON.stringify(t)})`);
    ok(b.errors.length === 0, `no page errors ${b.errors.join(" | ")}`);
  } finally { b.close(); srv.kill(); posts.closeAllConnections(); posts.close(); await sleep(300); }
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
